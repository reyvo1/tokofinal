#!/usr/bin/env node
import crypto from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { assertRuntimeDatabaseTarget, expectedPostgresTarget } from './lib/runtime-target-identity.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

function env(name, required = true) {
  const value = process.env[name];
  if (required && !value) throw new Error(`${name} wajib tersedia.`);
  return value;
}

const root = process.cwd();
const sourceIdentity = sourceFingerprint(root);
const output = process.env.STAGING_CERT_OUTPUT || path.join(root, 'handoff', 'quality', 'staging-certification-latest.json');
const checks = [];
let token = '';
let baseUrl = '';
let parsedBaseUrl = null;
let expectedSourceFingerprint = null;
let expectedDatabaseTarget = null;
let expectedBuildArtifactId = null;
let email = '';
let password = '';

function appTarget() {
  return parsedBaseUrl ? { hostHash: crypto.createHash('sha256').update(parsedBaseUrl.hostname).digest('hex').slice(0, 16) } : null;
}

async function writeReport(passed, error = null) {
  const report = {
    generatedAt: new Date().toISOString(), environment: 'STAGING', passed, sourceIdentity,
    target: appTarget(), databaseTarget: expectedDatabaseTarget, buildArtifactId: expectedBuildArtifactId, checks, ...(error ? { error } : {}),
  };
  const rendered = JSON.stringify(report, null, 2) + '\n';
  await writeFile(output, rendered, 'utf8');
  console.log(rendered.trimEnd());
  return report;
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, ok: true, durationMs: Date.now() - started, detail });
    return true;
  } catch (error) {
    checks.push({ name, ok: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function main() {
  try {
    baseUrl = (env('STAGING_BASE_URL') ?? '').replace(/\/$/, '');
    parsedBaseUrl = new URL(baseUrl);
    const expectedHost = env('STAGING_EXPECTED_HOST');
    if (parsedBaseUrl.hostname !== expectedHost) throw new Error('STAGING_BASE_URL host tidak cocok dengan STAGING_EXPECTED_HOST.');
    expectedSourceFingerprint = env('STAGING_EXPECTED_SOURCE_FINGERPRINT', false) || sourceIdentity.value;
    if (expectedSourceFingerprint !== sourceIdentity.value) throw new Error('STAGING_EXPECTED_SOURCE_FINGERPRINT harus sama dengan source checkout saat ini.');
    expectedDatabaseTarget = expectedPostgresTarget(env('STAGING_EXPECTED_DB_HOST'), env('STAGING_EXPECTED_DB_NAME'));
    expectedBuildArtifactId = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', sourceIdentity.value).current.id;
    email = env('STAGING_TEST_EMAIL');
    password = env('STAGING_TEST_PASSWORD');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: 'preflight', ok: false, durationMs: 0, error: message });
    await writeReport(false, message);
    process.exitCode = 2;
    return;
  }

  const healthOk = await check('public-health', async () => {
    const { response, body } = await request('/api/v1/health');
    if (!response.ok || body?.status !== 'ok') throw new Error(`health HTTP ${response.status}`);
    if (body?.release?.sourceFingerprint !== expectedSourceFingerprint) throw new Error(`runtime source fingerprint mismatch: ${body?.release?.sourceFingerprint || '<missing>'}`);
    assertRuntimeDatabaseTarget(body?.release?.databaseTarget, expectedDatabaseTarget, 'Staging runtime database target');
    if (body?.release?.buildArtifactId !== expectedBuildArtifactId) throw new Error(`runtime build artifact mismatch: ${body?.release?.buildArtifactId || '<missing>'}`);
    return { status: response.status, service: body.service, runtimeSourceFingerprint: body.release.sourceFingerprint, runtimeBuildArtifactId: body.release.buildArtifactId, runtimeDatabaseTarget: body.release.databaseTarget };
  });
  if (!healthOk) {
    await writeReport(false, 'Health/source/database identity preflight gagal; staging credentials tidak dikirim.');
    process.exitCode = 2;
    return;
  }

  await check('login-and-session-registry', async () => {
    const { response, body } = await request('/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    if (!response.ok || !body?.accessToken || !body?.user?.sid) throw new Error(`login HTTP ${response.status}`);
    token = body.accessToken;
    return { status: response.status, sessionRegistered: true };
  });

  if (token) {
    const authHeaders = { authorization: `Bearer ${token}` };
    await check('session-list', async () => {
      const { response, body } = await request('/api/v1/auth/sessions', { headers: authHeaders });
      if (!response.ok || !Array.isArray(body) || !body.some((item) => item.current)) throw new Error(`sessions HTTP ${response.status}`);
      return { status: response.status, activeRows: body.length };
    });
    await check('ops-health', async () => {
      const { response, body } = await request('/api/v1/platform/ops-health', { headers: authHeaders });
      if (!response.ok) throw new Error(`ops-health HTTP ${response.status}`);
      return { status: response.status, keys: body && typeof body === 'object' ? Object.keys(body).slice(0, 20) : [] };
    });
    await check('financial-integrity', async () => {
      const { response, body } = await request('/api/v1/reports/financial-integrity', { headers: authHeaders });
      if (!response.ok) throw new Error(`financial-integrity HTTP ${response.status}`);
      return { status: response.status, result: body };
    });
    await check('logout-revokes-session', async () => {
      const logout = await request('/api/v1/auth/logout', { method: 'POST', headers: authHeaders });
      if (!logout.response.ok) throw new Error(`logout HTTP ${logout.response.status}`);
      const after = await request('/api/v1/auth/sessions', { headers: authHeaders });
      if (after.response.status !== 401) throw new Error(`revoked token masih diterima: HTTP ${after.response.status}`);
      return { logoutStatus: logout.response.status, revokedTokenStatus: after.response.status };
    });
  }

  const passed = checks.length >= 5 && checks.every((item) => item.ok);
  await writeReport(passed, passed ? null : 'Satu atau lebih staging certification check gagal.');
  if (!passed) process.exitCode = 2;
}

await main();
