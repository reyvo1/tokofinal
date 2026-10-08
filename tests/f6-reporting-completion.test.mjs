import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const service = read('apps/api/src/reports/reports.service.ts');
const controller = read('apps/api/src/reports/reports.controller.ts');
const dto = read('apps/api/src/reports/dto/create-report-job.dto.ts');
const worker = read('apps/worker/src/index.ts');
const ui = read('apps/admin/app/modules/reporting-workspace.tsx');
// Report types moved to the canonical catalogue so the exportable list no longer
// depends on which workspace the operator is standing in.
const reportCatalog = read('apps/admin/app/report-catalog.ts');
const accounting = read('apps/admin/app/modules/accounting.tsx');

test('F6 exposes journal-backed financial reports and period comparison', () => {
  for (const route of ['profit-loss','trial-balance','balance-sheet','general-ledger','cash-flow','margin','period-comparison','dimension-comparison','drill-down']) {
    assert.match(controller, new RegExp(`@Get\\('${route}'\\)`));
  }
  assert.match(service, /source: 'POSTED_JOURNAL'/);
  assert.match(service, /async periodComparison\(/);
  assert.match(service, /previousFrom/);
  assert.match(service, /changePercent/);
});

test('F6 drill-down binds report account to journal posting event and source', () => {
  assert.match(service, /async reportDrillDown\(/);
  assert.match(service, /accountingPosting\.findMany/);
  assert.match(service, /journalNumber: line\.journalEntry\.number/);
  assert.match(service, /accountingEvent: posting\?\.event \?\? null/);
  assert.match(ui, /Akun → Jurnal → Accounting Event → Source/);
  assert.match(ui, /accountingEvent\.sourceType/);
});

test('F6 comparison remains company and role scoped and cost center is dimension-backed', () => {
  assert.match(service, /user\.roles\.includes\('SUPER_ADMIN'\) \|\| user\.roles\.includes\('OWNER'\)/);
  assert.match(service, /where: \{ companyId: scope\.companyId/);
  assert.match(service, /dimensions\.costCenterId/);
  assert.match(service, /UNASSIGNED/);
  assert.match(ui, /Perbandingan Cabang/);
  assert.match(ui, /Cost Center/);
});

test('F6 async catalog covers valuation comparison and cost center exports', () => {
  for (const type of ['INVENTORY_VALUATION','BRANCH_COMPARISON','COST_CENTER','PERIOD_COMPARISON']) {
    assert.match(dto, new RegExp(`'${type}'`));
    assert.match(worker, new RegExp(`job\\.reportType === '${type}'`));
    assert.match(reportCatalog, new RegExp(`'${type}'`));
  }
  assert.match(worker, /renderXlsx\(csv\)/);
  assert.match(worker, /renderPdf\(csv/);
});

test('F6 report job filters are server validated before queueing', () => {
  assert.match(service, /private async validateReportFilters/);
  assert.match(service, /Filter days harus integer 1-3650/);
  assert.match(service, /accountCode report tidak ditemukan pada branch aktif/);
  assert.match(service, /warehouseId report tidak ditemukan pada branch aktif/);
  assert.match(service, /filters: filters as Prisma\.InputJsonValue/);
});

test('F6 operator workspace is mounted in canonical finance reports view', () => {
  assert.match(accounting, /import ReportingWorkspace from '\.\/reporting-workspace'/);
  assert.match(accounting, /show\('reports'\) && <ReportingWorkspace token=\{token\}/);
  assert.match(ui, /Laporan Keuangan & Perbandingan/);
  assert.match(ui, /Tax Summary/);
  assert.match(ui, /ASYNC REPORT JOB/);
});
