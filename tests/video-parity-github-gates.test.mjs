import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(file)=>fs.readFileSync(file,'utf8');
const visualMap=JSON.parse(read('config/p5-visual-surface-map.json'));
const navigation=read('apps/admin/app/navigation.ts');
const p5Audit=read('scripts/audit-p5-visual-rebuild.mjs');
const r7Probe=read('scripts/ci-r7-ui-probe.mjs');
const summary=read('scripts/ci-write-full-system-summary.mjs');
const stage19=read('scripts/run-tenant-http-db-integration.mjs');
const r8=read('scripts/ci-r8-reporting-security-probe.mjs');

test('P5 visual authority covers every current Admin workspace including Manufacturing without stale numeric gates',()=>{
  const navigationRoutes=[...navigation.matchAll(/\{ key: '([^']+)', route: '([^']+)', label: '([^']+)'/g)].map((match)=>match[2]);
  assert.deepEqual(visualMap.admin.primaryWorkspaces.map((item)=>item.route),navigationRoutes);
  assert.equal(visualMap.admin.representativeContextualRoutes.length,Math.max(0,navigationRoutes.length-1));
  assert.ok(visualMap.admin.representativeContextualRoutes.includes('/manufacturing/recipes'));
  assert.match(p5Audit,/navigationWorkspaces/);
  assert.doesNotMatch(p5Audit,/primary workspace harus 14|contextual representative harus 13/);
  assert.match(r7Probe,/p5-visual-surface-map\.json/);
  assert.doesNotMatch(r7Probe,/expectedWorkspaces\.length === 14/);
  assert.match(summary,/expectedP5Screenshots/);
  assert.match(summary,/v\.workspaceCount === expectedP5Screenshots\.adminPrimary/);
  assert.doesNotMatch(summary,/screenshotCounts\?\.adminPrimary === 14|v\.workspaceCount >= 14/);
});

test('Stage-19 materializes company UNIT masters before creating mandatory-unit products',()=>{
  assert.match(stage19,/type: 'UNIT'/);
  assert.match(stage19,/branchId: null/);
  assert.match(stage19,/state\.masterReferenceIds\.push\(unitA\.id, unitB\.id\)/);
  assert.match(stage19,/name: 'Stage19 Product A', unit: unitA\.code/);
  assert.match(stage19,/name: 'Stage19 Product B', unit: unitB\.code/);
});

test('R8 low-stock probe validates minStock together with the dynamic base-unit label',()=>{
  assert.match(r8,/const expectedLowStockLine = `sisa 2 \${baseUnit\.code} \(min 10 \${baseUnit\.code}\)`/);
  assert.match(r8,/includes\(expectedLowStockLine\)/);
  assert.doesNotMatch(r8,/includes\('sisa 2 \(min 10\)'\)/);
});
