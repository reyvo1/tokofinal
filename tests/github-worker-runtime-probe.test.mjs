import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateWorkerProbeBaseUrl } from '../scripts/ci-worker-runtime-probe.mjs';

test('worker runtime probe accepts localhost API only and rejects remote/production targets', () => {
  assert.equal(validateWorkerProbeBaseUrl('http://127.0.0.1:4000/api/v1'), 'http://127.0.0.1:4000/api/v1');
  assert.equal(validateWorkerProbeBaseUrl('http://localhost:4000'), 'http://localhost:4000/api/v1');
  assert.throws(() => validateWorkerProbeBaseUrl('https://127.0.0.1:4000/api/v1'), /HTTP localhost/);
  assert.throws(() => validateWorkerProbeBaseUrl('http://example.com/api/v1'), /localhost/);
  assert.throws(() => validateWorkerProbeBaseUrl('http://127.0.0.1:4000/admin'), /\/api\/v1/);
});

test('GitHub full-system workflow runs worker report job probe on exact persistent runtime', () => {
  const workflow = fs.readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');
  assert.match(workflow, /id: worker_probe/);
  assert.match(workflow, /npm run ci:worker:probe/);
  assert.match(workflow, /T360_WORKER_PROBE_BASE_URL: http:\/\/127\.0\.0\.1:4000\/api\/v1/);
  const start = workflow.indexOf('id: runtime_start');
  const probe = workflow.indexOf('id: worker_probe');
  const staging = workflow.indexOf('id: staging_certification');
  assert.ok(start >= 0 && probe > start && staging > probe, 'worker probe must run after exact runtime starts and before staging certification');
});

test('API and worker honor explicit shared REPORT_EXPORT_DIR before workspace-local fallback', () => {
  const api = fs.readFileSync('apps/api/src/reports/reports.service.ts', 'utf8');
  const worker = fs.readFileSync('apps/worker/src/index.ts', 'utf8');
  const prepare = fs.readFileSync('scripts/ci-prepare-github-simulation.mjs', 'utf8');
  for (const source of [api, worker]) {
    assert.match(source, /const configured = process\.env\.REPORT_EXPORT_DIR\?\.trim\(\)/);
    assert.match(source, /mkdirSync\(dir, \{ recursive: true \}\)/);
  }
  assert.match(prepare, /REPORT_EXPORT_DIR/);
  assert.match(prepare, /logs', 'report-exports/);
});

test('worker probe is a required aggregate GitHub simulation gate', () => {
  const summary = fs.readFileSync('scripts/ci-write-full-system-summary.mjs', 'utf8');
  assert.match(summary, /github-worker-runtime-probe-latest\.json/);
  assert.match(summary, /workerRuntime: gateStatus/);
  for (const gate of ['builtBrowser', 'workerRuntime', 'apiRuntimeSweep', 'notificationProviderProbe', 'stagingCertification']) {
    assert.match(summary, new RegExp(`'${gate}'`));
  }
  assert.match(summary, /T360_CI_STEP_WORKER_PROBE/);
});
