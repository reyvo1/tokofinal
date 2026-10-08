import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { blockingFindings, evaluateAudit, vulnerabilityCounts } from '../scripts/ci-audit-production-deps.mjs';

test('production dependency audit blocks high/critical but records lower severities', () => {
  const safe = { metadata: { vulnerabilities: { info: 0, low: 2, moderate: 1, high: 0, critical: 0, total: 3 } } };
  const bad = { metadata: { vulnerabilities: { low: 0, moderate: 0, high: 2, critical: 1, total: 3 } } };
  assert.deepEqual(vulnerabilityCounts(safe), { info: 0, low: 2, moderate: 1, high: 0, critical: 0, total: 3 });
  assert.equal(evaluateAudit(safe).passed, true);
  assert.equal(evaluateAudit(bad).blocking, 3);
  assert.equal(evaluateAudit(bad).passed, false);
});

test('GitHub full-system simulation requires source-bound production dependency audit evidence', () => {
  const workflow = fs.readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');
  const summary = fs.readFileSync('scripts/ci-write-full-system-summary.mjs', 'utf8');
  const audit = fs.readFileSync('scripts/ci-audit-production-deps.mjs', 'utf8');
  assert.match(workflow, /id: dependency_audit/);
  assert.match(workflow, /npm run ci:audit:production/);
  assert.match(summary, /npm-audit-production-latest\.json/);
  assert.match(summary, /dependencyAudit: gateStatus/);
  assert.match(summary, /T360_CI_STEP_DEPENDENCY_AUDIT/);
  assert.match(audit, /--omit=dev/);
  assert.match(audit, /--audit-level=high/);
  assert.match(audit, /autoFix: false/);
  assert.doesNotMatch(audit, /audit fix/);
});


test('production dependency audit preserves actionable blocking package/advisory details', () => {
  const audit = {
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: {
      example: {
        name: 'example', severity: 'high', isDirect: true, range: '<2.0.0',
        via: [{ source: 123, name: 'example', severity: 'high', title: 'prototype pollution', range: '<2.0.0', url: 'https://example.invalid/advisory' }],
        effects: [], nodes: ['node_modules/example'], fixAvailable: { name: 'example', version: '2.0.0', isSemVerMajor: false },
      },
    },
  };
  assert.equal(blockingFindings(audit).length, 1);
  assert.equal(blockingFindings(audit)[0].name, 'example');
  const evaluated = evaluateAudit(audit);
  assert.equal(evaluated.findings[0].fixAvailable.version, '2.0.0');
  const source = fs.readFileSync('scripts/ci-audit-production-deps.mjs', 'utf8');
  assert.match(source, /blockingFindings: evaluated\.findings/);
  assert.match(source, /AUDIT_BLOCKER package=/);
});
