import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertCompleteNpmAudit,
  evaluateAudit,
} from '../scripts/ci-audit-production-deps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const empty = () => ({
  auditReportVersion: 2,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  vulnerabilities: {},
});
const vulnerable = () => ({
  ...empty(),
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  vulnerabilities: {
    sharp: { name: 'sharp', severity: 'high', isDirect: false, via: ['CVE-2026-96889'], effects: [], nodes: ['node_modules/sharp'] },
  },
});

const invalids = [
  ['empty response', {}],
  ['empty metadata', { metadata: {}, vulnerabilities: {} }],
  ['missing findings', { metadata: empty().metadata }],
  ['npm error', { ...empty(), error: { code: 'ENOAUDIT' } }],
  ['missing high count', (() => { const v = empty(); delete v.metadata.vulnerabilities.high; return v; })()],
  ['missing total count', (() => { const v = empty(); delete v.metadata.vulnerabilities.total; return v; })()],
  ['negative count', (() => { const v = empty(); v.metadata.vulnerabilities.high = -1; return v; })()],
  ['fractional count', (() => { const v = empty(); v.metadata.vulnerabilities.high = 0.5; return v; })()],
  ['inconsistent total', (() => { const v = empty(); v.metadata.vulnerabilities.total = 1; return v; })()],
  ['hidden high severity', (() => { const v = empty(); v.vulnerabilities = vulnerable().vulnerabilities; return v; })()],
  ['missing high details', (() => { const v = vulnerable(); v.vulnerabilities = {}; return v; })()],
  ['wrong severity', (() => { const v = vulnerable(); v.vulnerabilities.sharp.severity = 'low'; return v; })()],
  ['wrong name', (() => { const v = vulnerable(); v.vulnerabilities.sharp.name = 'other'; return v; })()],
];

test('complete valid npm v2 report is the only source of a clean PASS', () => {
  assert.doesNotThrow(() => assertCompleteNpmAudit(empty()));
  assert.equal(evaluateAudit(empty()).passed, true);
  const bad = evaluateAudit(vulnerable());
  assert.equal(bad.passed, false);
  assert.equal(bad.blocking, 1);
  assert.equal(bad.findings[0].name, 'sharp');
});

test('tampered, incomplete, and inconsistent npm audit reports always fail closed', () => {
  for (const [label, fixture] of invalids) {
    assert.throws(() => evaluateAudit(fixture), /NPM_AUDIT_INVALID/, label);
  }
});

test('real audit runner returns FAIL for malformed success output and HIGH findings', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 't360-audit-guard-'));
  try {
    const bin = path.join(parent, 'bin');
    fs.mkdirSync(bin);
    const npm = path.join(bin, 'npm');
    // The CLI is invoked using its original npm audit arguments. Stub only
    // stdout/stderr so this test requires no public registry or project install.
    fs.writeFileSync(npm, `#!/bin/sh\nprintf '%s\\n' "\$(cat \"$T360_TEST_AUDIT_FIXTURE\")"\nexit "\${T360_TEST_AUDIT_EXIT:-0}"\n`);
    fs.chmodSync(npm, 0o755);
    const output = path.join(parent, 'audit.json');
    for (const [label, report, exitCode, expected] of [
      ['clean', empty(), 0, 'PASS'],
      ['tampered metadata', invalids.find(([name]) => name === 'hidden high severity')[1], 0, 'FAIL'],
      ['invalid success', {}, 0, 'FAIL'],
      ['real high severity', vulnerable(), 1, 'FAIL'],
      ['npm infrastructure failure', { error: { code: 'ENOTFOUND' } }, 1, 'FAIL'],
    ]) {
      const fixture = path.join(parent, 'input.json');
      fs.writeFileSync(fixture, JSON.stringify(report));
      const run = spawnSync(process.execPath, ['scripts/ci-audit-production-deps.mjs'], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
          T360_NPM_AUDIT_OUTPUT: output,
          T360_TEST_AUDIT_FIXTURE: fixture,
          T360_TEST_AUDIT_EXIT: String(exitCode),
        },
        encoding: 'utf8',
        timeout: 12_000,
      });
      assert.ifError(run.error);
      assert.equal(run.status, expected === 'PASS' ? 0 : 2, `${label}: ${run.stderr}\n${run.stdout}`);
      const recorded = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.equal(recorded.status, expected, label);
      assert.equal(recorded.scope, 'production-dependencies');
      assert.deepEqual(recorded.policy.blockSeverities, ['high', 'critical']);
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
