import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const mapping = JSON.parse(read('config/admin-contextual-workflow-map.json'));
const page = read('apps/admin/app/page.tsx');

test('P1 maps all canonical contextual destinations exactly once', () => {
  assert.ok(mapping.expectedContextualViews >= 62, 'P1 62-route baseline is a regression floor; later phases may add canonical destinations');
  assert.equal(mapping.rows.length, mapping.expectedContextualViews);
  const keys = mapping.rows.map((row) => `${row.workspace}/${row.view}`);
  assert.equal(new Set(keys).size, mapping.expectedContextualViews);
  assert.ok(mapping.rows.every((row) => row.status === 'SOURCE_IMPLEMENTED'));
});

test('P1 routes the six formerly mixed Admin workspaces by active contextual view', () => {
  for (const token of [
    "activeDomainView.key === 'requests'",
    "commerceSection=\"fulfillment\"",
    "mode={(activeDomainView?.key ?? 'overview') as 'overview'|'traceability'|'transfers'|'stocktake'|'returns'}",
    "activeDomainView?.key === 'delivery' ? <DeliveryLifecycle",
    "<AssetsFleetView token={token} mode={(activeDomainView?.key ?? 'assets')",
    "<ExtensionsView token={token} mode=\"notifications\" />",
  ]) assert.ok(page.includes(token), `missing contextual routing token: ${token}`);
});

test('P1 separates the two partial Reports and Intelligence workspaces', () => {
  for (const token of [
    '<ReportingWorkspace token={token} mode="financial" />',
    '<ReportingWorkspace token={token} mode="operations" />',
    '<ReportingWorkspace token={token} mode="scheduled" />',
    '<AiWorkspace token={token} mode="ai" />',
    '<AiWorkspace token={token} mode="forecast" />',
    '<AutomationWorkspace token={token} mode="automation" />',
    '<AutomationWorkspace token={token} mode="schedules" />',
  ]) assert.ok(page.includes(token), `missing semantic split: ${token}`);
});

test('P1 formerly monolithic modules expose explicit contextual mode contracts', () => {
  const contracts = [
    ['apps/admin/app/modules/operations.tsx', "type InventoryControlMode = 'overview' | 'traceability' | 'transfers' | 'stocktake' | 'returns'"],
    ['apps/admin/app/modules/operations-control.tsx', "type OperationsControlMode = 'inspections' | 'evidence' | 'gate-pass'"],
    ['apps/admin/app/modules/assets-fleet.tsx', "type AssetsFleetMode = 'assets' | 'maintenance' | 'vehicles' | 'trips'"],
    ['apps/admin/app/modules/reporting-workspace.tsx', "type ReportingMode = 'financial' | 'operations' | 'scheduled'"],
    ['apps/admin/app/modules/r3-operations.tsx', "type R3OperationsMode = 'reporting' | 'devices' | 'connections'"],
  ];
  for (const [file, token] of contracts) assert.ok(read(file).includes(token), `${file} missing ${token}`);
});

test('P1 contextual audit is fail-closed and passes current source', () => {
  const run = spawnSync(process.execPath, ['scripts/audit-admin-contextual-workflows.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /\d+\/\d+ contextual destinations mapped/);
});
