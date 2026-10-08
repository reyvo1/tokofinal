#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';
import { assertRuntimeDatabaseTarget, expectedPostgresTarget } from './lib/runtime-target-identity.mjs';

const DEFAULT_OUTPUT = 'handoff/quality/github-worker-runtime-probe-latest.json';

function required(env, key) {
  const value = String(env[key] ?? '').trim();
  if (!value) throw new Error(`${key} wajib tersedia untuk worker runtime probe.`);
  return value;
}

export function validateWorkerProbeBaseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('T360_WORKER_PROBE_BASE_URL tidak valid.'); }
  if (url.protocol !== 'http:') throw new Error('Worker probe CI hanya menerima HTTP localhost non-production.');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Worker probe CI hanya boleh menarget localhost.');
  if (url.username || url.password) throw new Error('Worker probe URL tidak boleh memuat kredensial.');
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname && pathname !== '/api/v1') throw new Error('Worker probe URL harus root API /api/v1 atau origin localhost.');
  url.pathname = pathname || '/api/v1';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function safeEvidenceTarget(url) {
  return { protocol: url.protocol.replace(':', ''), host: url.hostname, port: url.port || '80' };
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, signal: AbortSignal.timeout(15_000) });
  const contentType = response.headers.get('content-type') || '';
  if (options.raw) return { response, body: Buffer.from(await response.arrayBuffer()), contentType };
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, contentType };
}

function writeEvidence(root, output, data) {
  const target = path.resolve(root, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
  return target;
}

export async function runWorkerRuntimeProbe({ root = process.cwd(), env = process.env, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const sourceIdentity = sourceFingerprint(root);
  const output = env.T360_WORKER_PROBE_OUTPUT || DEFAULT_OUTPUT;
  const startedAt = new Date().toISOString();
  const checks = [];
  let baseUrl = null;
  let expectedBuildArtifactId = null;
  let databaseTarget = null;

  const finish = (status, error = null, extra = {}) => {
    const result = {
      generatedAt: new Date().toISOString(), startedAt, status, environment: 'GITHUB_ACTIONS_NON_PRODUCTION',
      sourceIdentity, buildArtifactId: expectedBuildArtifactId, databaseTarget, target: baseUrl ? safeEvidenceTarget(new URL(baseUrl)) : null,
      checks, productionTouched: false, ...(error ? { error } : {}), ...extra,
    };
    writeEvidence(root, output, result);
    return result;
  };

  // Invalidate previous PASS before any network/auth attempt.
  finish('FAIL', 'Worker runtime probe attempt belum selesai.');

  try {
    baseUrl = validateWorkerProbeBaseUrl(required(env, 'T360_WORKER_PROBE_BASE_URL'));
    const expectedSource = required(env, 'T360_EXPECTED_SOURCE_FINGERPRINT');
    if (expectedSource !== sourceIdentity.value) throw new Error('Expected source fingerprint berbeda dari checkout saat ini.');
    expectedBuildArtifactId = required(env, 'T360_EXPECTED_BUILD_ARTIFACT_ID');
    const artifact = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', sourceIdentity.value);
    if (artifact.current.id !== expectedBuildArtifactId) throw new Error('Expected build artifact ID berbeda dari manifest exact artifact.');
    databaseTarget = expectedPostgresTarget(required(env, 'T360_CI_EXPECTED_HOST'), required(env, 'T360_CI_EXPECTED_DATABASE'));
    const email = required(env, 'T360_UAT_ADMIN_EMAIL');
    const password = required(env, 'T360_UAT_ADMIN_PASSWORD');

    const health = await request(baseUrl, '/health');
    if (!health.response.ok || health.body?.status !== 'ok') throw new Error(`Health worker probe gagal HTTP ${health.response.status}.`);
    if (health.body?.release?.sourceFingerprint !== sourceIdentity.value) throw new Error('Runtime source fingerprint worker probe berbeda.');
    if (health.body?.release?.buildArtifactId !== expectedBuildArtifactId) throw new Error('Runtime build artifact worker probe berbeda.');
    assertRuntimeDatabaseTarget(health.body?.release?.databaseTarget, databaseTarget, 'Worker probe runtime database target');
    checks.push({ name: 'runtime-identity', ok: true });

    const login = await request(baseUrl, '/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    if (!login.response.ok || !login.body?.accessToken) throw new Error(`Worker probe login gagal HTTP ${login.response.status}.`);
    const authHeaders = { authorization: `Bearer ${login.body.accessToken}` };
    checks.push({ name: 'admin-login', ok: true });

    const created = await request(baseUrl, '/reports/jobs', {
      method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ reportType: 'INVENTORY', format: 'CSV', filters: {} }),
    });
    if (!created.response.ok || !created.body?.id) throw new Error(`Create report job gagal HTTP ${created.response.status}.`);
    const jobId = created.body.id;
    checks.push({ name: 'report-job-created', ok: true, jobId });

    const deadline = Date.now() + Math.max(5_000, Number(env.T360_WORKER_PROBE_TIMEOUT_MS || 45_000));
    let completed = null;
    while (Date.now() < deadline) {
      const listed = await request(baseUrl, '/reports/jobs?limit=100', { headers: authHeaders });
      if (!listed.response.ok || !Array.isArray(listed.body?.items)) throw new Error(`List report jobs gagal HTTP ${listed.response.status}.`);
      const job = listed.body.items.find((item) => item?.id === jobId);
      if (job?.status === 'FAILED') throw new Error(`Worker menandai report job FAILED: ${job.errorMessage || 'tanpa detail'}`);
      if (job?.status === 'DONE') { completed = job; break; }
      await sleep(500);
    }
    if (!completed) throw new Error('Worker tidak menyelesaikan report job sebelum timeout.');
    if (Number(completed.progress) !== 100 || !completed.outputUrl) throw new Error('Report job DONE tetapi progress/outputUrl tidak valid.');
    checks.push({ name: 'worker-processed-report-job', ok: true, status: completed.status, progress: completed.progress });

    const downloaded = await request(baseUrl, `/reports/jobs/${encodeURIComponent(jobId)}/download`, { headers: authHeaders, raw: true });
    if (!downloaded.response.ok) throw new Error(`Download worker export gagal HTTP ${downloaded.response.status}.`);
    if (!/text\/csv/i.test(downloaded.contentType)) throw new Error(`Worker export bukan CSV: ${downloaded.contentType || '<missing>'}.`);
    if (!downloaded.body || downloaded.body.length < 3) throw new Error('Worker export CSV kosong/tidak valid.');
    const preview = downloaded.body.toString('utf8', 0, Math.min(downloaded.body.length, 200));
    if (!preview.includes(',')) throw new Error('Worker export CSV tidak memiliki struktur kolom yang diharapkan.');
    checks.push({ name: 'api-downloads-worker-output', ok: true, bytes: downloaded.body.length, contentType: downloaded.contentType });

    return finish('PASS', null, { reportJob: { id: jobId, reportType: 'INVENTORY', format: 'CSV', outputBytes: downloaded.body.length } });
  } catch (error) {
    return finish('FAIL', error instanceof Error ? error.message : String(error));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await runWorkerRuntimeProbe();
  console.log(`GitHub worker runtime probe ${result.status}${result.error ? ` — ${result.error}` : ''}`);
  if (result.status !== 'PASS') process.exitCode = 2;
}
