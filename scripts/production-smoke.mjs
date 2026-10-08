#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { assertRuntimeDatabaseTarget, expectedPostgresTarget, shortHash } from './lib/runtime-target-identity.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff', 'quality', 'production-smoke-latest.json');
const current = sourceFingerprint(root);
const CONFIRM = 'RUN_T360_PRODUCTION_SMOKE';
const checks = [];
let token = '';
let productionTouched = false;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} wajib tersedia.`); return value; }

function readEvidence(relative, label) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`${label} tidak ditemukan: ${relative}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${label} JSON invalid: ${error.message}`); }
}
function sameDb(a, b) {
  return a?.profile === 'postgresql' && b?.profile === 'postgresql' && a.hostHash === b.hostHash && a.databaseHash === b.databaseHash;
}
async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}
async function check(id, fn) {
  const started = Date.now();
  try { const detail = await fn(); checks.push({ id, status: 'PASS', durationMs: Date.now() - started, detail }); return true; }
  catch (error) { checks.push({ id, status: 'FAIL', durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }); return false; }
}

let error = null;
let target = null;
let expectedBuildArtifactId = null;
try {
  if (process.env.T360_PRODUCTION_SMOKE_CONFIRM !== CONFIRM) throw new Error(`T360_PRODUCTION_SMOKE_CONFIRM harus ${CONFIRM}.`);
  const baseUrl = required('T360_PRODUCTION_BASE_URL').replace(/\/$/, '');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') throw new Error('Production smoke wajib menggunakan HTTPS.');
  const expectedHost = required('T360_PRODUCTION_EXPECTED_HOST');
  if (parsed.hostname !== expectedHost) throw new Error('Production host tidak cocok dengan T360_PRODUCTION_EXPECTED_HOST.');
  const expectedFingerprint = required('T360_PRODUCTION_EXPECTED_SOURCE_FINGERPRINT');
  if (expectedFingerprint !== current.value) throw new Error('Expected production fingerprint harus sama dengan checkout source saat ini.');
  expectedBuildArtifactId = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', current.value).current.id;
  const configuredArtifactId = required('T360_PRODUCTION_EXPECTED_BUILD_ARTIFACT_ID');
  if (configuredArtifactId !== expectedBuildArtifactId) throw new Error('Expected production build artifact harus sama dengan manifest build yang sudah diuji.');
  const expectedDatabaseTarget = expectedPostgresTarget(required('T360_PRODUCTION_EXPECTED_DB_HOST'), required('T360_PRODUCTION_EXPECTED_DB_NAME'));
  target = { applicationHostHash: shortHash(parsed.hostname.toLowerCase()), databaseTarget: expectedDatabaseTarget };

  const schemaEvidence = readEvidence('handoff/quality/production-schema-latest.json', 'Production schema verification');
  if (schemaEvidence.status !== 'PASS' || schemaEvidence.sourceIdentity?.value !== current.value || schemaEvidence.readOnly !== true || schemaEvidence.businessMutationsPerformed !== false) throw new Error('Production schema verification belum PASS/read-only pada source saat ini.');
  if (!sameDb(schemaEvidence.databaseTarget, expectedDatabaseTarget)) throw new Error('Production schema verification berasal dari database berbeda dengan target smoke.');
  checks.push({ id: 'PRODUCTION_SCHEMA_PREREQUISITE', status: 'PASS', detail: { readOnly: true } });

  const email = required('T360_PRODUCTION_TEST_EMAIL');
  const password = required('T360_PRODUCTION_TEST_PASSWORD');

  productionTouched = true;
  const healthOk = await check('PUBLIC_HEALTH_AND_RELEASE_IDENTITY', async () => {
    const { response, body } = await request(baseUrl, '/api/v1/health');
    if (!response.ok || body?.status !== 'ok') throw new Error(`health HTTP ${response.status}`);
    if (body?.release?.sourceFingerprint !== expectedFingerprint) throw new Error(`deployed fingerprint mismatch: ${body?.release?.sourceFingerprint || '<missing>'}`);
    if (body?.release?.buildArtifactId !== expectedBuildArtifactId) throw new Error(`deployed build artifact mismatch: ${body?.release?.buildArtifactId || '<missing>'}`);
    assertRuntimeDatabaseTarget(body?.release?.databaseTarget, expectedDatabaseTarget, 'Production runtime database target');
    const requiredHeaders = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'strict-transport-security': null };
    for (const [name, expected] of Object.entries(requiredHeaders)) {
      const value = response.headers.get(name);
      if (!value || (expected && value.toUpperCase() !== expected.toUpperCase())) throw new Error(`security header ${name} invalid/missing`);
    }
    return { runtimeSourceFingerprint: body.release.sourceFingerprint, runtimeBuildArtifactId: body.release.buildArtifactId, runtimeDatabaseTarget: body.release.databaseTarget, version: body.release.version || null };
  });
  if (!healthOk) throw new Error('Production health/release identity gagal; kredensial tidak dikirim ke target ini.');

  const loginOk = await check('PRODUCTION_LOGIN_SESSION', async () => {
    const { response, body } = await request(baseUrl, '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!response.ok || !body?.accessToken || !body?.user?.sid) throw new Error(`login HTTP ${response.status}`);
    if (body?.code === 'TWO_FACTOR_REQUIRED') throw new Error('Akun production smoke membutuhkan flow 2FA manual; gunakan akun smoke khusus yang disetujui.');
    token = body.accessToken;
    return { sessionRegistered: true };
  });
  if (!loginOk) throw new Error('Production login/session smoke gagal; protected checks dihentikan.');

  if (token) {
    const headers = { authorization: `Bearer ${token}` };
    await check('PRODUCTION_OPS_HEALTH', async () => {
      const { response } = await request(baseUrl, '/api/v1/platform/ops-health', { headers });
      if (!response.ok) throw new Error(`ops-health HTTP ${response.status}`);
      return { status: response.status };
    });
    await check('PRODUCTION_FINANCIAL_INTEGRITY', async () => {
      const { response } = await request(baseUrl, '/api/v1/reports/financial-integrity', { headers });
      if (!response.ok) throw new Error(`financial-integrity HTTP ${response.status}`);
      return { status: response.status };
    });
    await check('PRODUCTION_LOGOUT_REVOCATION', async () => {
      const logout = await request(baseUrl, '/api/v1/auth/logout', { method: 'POST', headers });
      if (!logout.response.ok) throw new Error(`logout HTTP ${logout.response.status}`);
      const after = await request(baseUrl, '/api/v1/auth/sessions', { headers });
      if (after.response.status !== 401) throw new Error(`revoked token masih diterima: HTTP ${after.response.status}`);
      return { logoutStatus: logout.response.status, revokedTokenStatus: after.response.status };
    });
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
  checks.push({ id: 'PRODUCTION_SMOKE_PREFLIGHT', status: 'FAIL', error });
}
const passed = !error && checks.length >= 6 && checks.every((item) => item.status === 'PASS');
const result = {
  generatedAt: new Date().toISOString(), environment: 'PRODUCTION', status: passed ? 'PASS' : 'FAIL', productionTouched,
  businessMutationsPerformed: false, sourceIdentity: current, buildArtifactId: expectedBuildArtifactId, target, runtimeSourceFingerprint: checks.find((x) => x.id === 'PUBLIC_HEALTH_AND_RELEASE_IDENTITY')?.detail?.runtimeSourceFingerprint || null, runtimeBuildArtifactId: checks.find((x) => x.id === 'PUBLIC_HEALTH_AND_RELEASE_IDENTITY')?.detail?.runtimeBuildArtifactId || null,
  checks, error,
  note: 'Smoke production hanya melakukan health/read-only verification plus login/logout session lifecycle; tidak membuat transaksi bisnis.',
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`Production smoke: ${result.status} — evidence: ${output}`);
if (!passed) process.exitCode = 1;
