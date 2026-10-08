import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const delivery=fs.readFileSync('apps/admin/app/modules/delivery-lifecycle.tsx','utf8');
const payroll=fs.readFileSync('apps/admin/app/modules/hr-payroll.tsx','utf8');
const owner=fs.readFileSync('apps/admin/app/owner.tsx','utf8');
const workflow=fs.readFileSync('.github/workflows/full-system-simulation.yml','utf8');

test('GitHub first-run Admin TypeScript regressions are guarded by explicit narrowing',()=>{
  assert.match(delivery,/sourceResults:Array<\{templateItemId\?:string\|null;code:string;label:string\}>/);
  assert.match(payroll,/satisfies Array<\[string, LiabilityBucket, 'payrollTaxLiabilityAccount' | 'socialLiabilityAccount'\]>/);
  assert.match(owner,/function inventoryValueOf\(value: Valuation\): number/);
  assert.match(owner,/const total = inventoryValueOf\(valData\)/);
});

test('heavy GitHub workflow collects independent diagnostics before build-failure barrier',()=>{
  assert.match(workflow,/id: build_gate[\s\S]*continue-on-error: true/);
  assert.match(workflow,/Audit production dependencies[\s\S]*if: always\(\)[\s\S]*id: dependency_audit/);
  assert.match(workflow,/Verify 12 critical UAT scenarios[\s\S]*if: always\(\)[\s\S]*id: critical_coverage/);
  assert.match(workflow,/Validate CI-only container composition[\s\S]*if: always\(\)[\s\S]*id: compose_validation/);
  const barrier=workflow.indexOf('Stop artifact-dependent simulation after collecting independent diagnostics when build fails');
  const audit=workflow.indexOf('Audit production dependencies');
  const coverage=workflow.indexOf('Verify 12 critical UAT scenarios');
  const compose=workflow.indexOf('Validate CI-only container composition');
  const postgres=workflow.indexOf('Prepare PostgreSQL staging schema and bootstrap seed');
  assert.ok(barrier>audit && barrier>coverage && barrier>compose && postgres>barrier);
});
