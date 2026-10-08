import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dto = readFileSync(new URL('../apps/api/src/reports/dto/create-report-job.dto.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../apps/worker/src/index.ts', import.meta.url), 'utf8');
// The operator report-type selector is canonical in report-catalog.ts. It used to be
// duplicated per surface (accounting.tsx + reporting-workspace.tsx), which made the
// exportable catalogue depend on which workspace the operator was standing in.
const catalog = readFileSync(new URL('../apps/admin/app/report-catalog.ts', import.meta.url), 'utf8');
const catalogJson = readFileSync(new URL('../config/report-type-catalog.json', import.meta.url), 'utf8');
const reporting = readFileSync(new URL('../apps/admin/app/modules/reporting-workspace.tsx', import.meta.url), 'utf8');
const automation = readFileSync(new URL('../apps/admin/app/modules/automation-workspace.tsx', import.meta.url), 'utf8');
const admin = `${catalog}\n${catalogJson}\n${reporting}\n${automation}`;

const required = ['SALES','PRODUCTS','CASHIER','CHANNELS','CUSTOMERS','DISCOUNTS','RETURNS','INVENTORY','INVENTORY_MOVEMENTS','BATCH_EXPIRY','STOCK_OPNAME','PURCHASES','SUPPLIERS','MARGIN','CASH_FLOW','PROFIT_LOSS','TRIAL_BALANCE','BALANCE_SHEET','GENERAL_LEDGER','TAX_SUMMARY','AUDIT_LOG'];

test('report job catalog covers core commerce procurement inventory finance and audit surfaces', () => {
  for (const type of required) {
    assert.match(dto, new RegExp(`'${type}'`), `DTO missing ${type}`);
    assert.match(admin, new RegExp(`'${type}'`), `Admin missing ${type}`);
  }
  for (const type of required.filter((value) => !['SALES','PRODUCTS','PROFIT_LOSS','TRIAL_BALANCE','BALANCE_SHEET','GENERAL_LEDGER','TAX_SUMMARY'].includes(value))) {
    assert.match(worker, new RegExp(`job\\.reportType === '${type}'|job\\.reportType === 'INVENTORY' \\|\\| job\\.reportType === 'INVENTORY_MOVEMENTS'`), `Worker missing ${type}`);
  }
});

test('admin can enqueue asynchronous report jobs and authenticated downloads in CSV XLSX PDF', () => {
  assert.match(admin, /\/reports\/jobs\?limit=50/);
  assert.match(admin, /method: 'POST'[\s\S]*reportType, format, filters/);
  assert.match(admin, /<option>CSV<\/option><option>XLSX<\/option><option>PDF<\/option>/);
  assert.match(admin, /\/reports\/jobs\/\$\{row\.id\}\/download/);
  assert.match(admin, /Authorization: `Bearer \$\{token\}`/);
  assert.match(worker, /renderXlsx\(csv\)/);
  assert.match(worker, /renderPdf\(csv/);
});
