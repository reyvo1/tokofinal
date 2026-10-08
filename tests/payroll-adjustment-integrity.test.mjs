import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const payroll = read('apps/api/src/payroll/payroll.service.ts');
const controller = read('apps/api/src/payroll/payroll.controller.ts');
const dto = read('apps/api/src/payroll/dto/payroll.dto.ts');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const admin = read('apps/admin/app/modules/hr-payroll.tsx');
const seed = read('apps/api/prisma/seed.ts');
const worker = read('apps/worker/src/index.ts');
const payrollDoc = read('docs/HRIS-ATTENDANCE-PAYROLL.md');
const postman = read('docs/Toko360.postman_collection.json');
const schemas = ['apps/api/prisma/schema.prisma', 'apps/api/prisma/schema.sqlite.prisma', 'apps/api/prisma/schema.postgresql.prisma'].map(read);

const pgMigration = read('database/migrations/T360-20260912-payroll-differential-adjustment/postgresql-expand.sql');
const sqliteMigration = read('database/migrations/T360-20260912-payroll-differential-adjustment/sqlite-expand.sql');

test('payroll adjustment lineage and settlement direction exist in every runtime schema and expand migration', () => {
  for (const schema of schemas) {
    assert.match(schema, /adjustmentOfRunId String\?/);
    assert.match(schema, /adjustmentSequence Int\s+@default\(0\)/);
    assert.match(schema, /adjustmentReason String\?/);
    assert.match(schema, /adjustmentPostingDate DateTime\?/);
    assert.match(schema, /direction\s+String\s+@default\("OUTBOUND"\)/);
    assert.match(schema, /@@unique\(\[companyId, branchId, adjustmentOfRunId, adjustmentSequence\]\)/);
  }
  for (const migration of [pgMigration, sqliteMigration]) {
    assert.match(migration, /adjustmentOfRunId/);
    assert.match(migration, /adjustmentPostingDate/);
    assert.match(migration, /PayrollPayment/);
    assert.match(migration, /direction/);
  }
});

test('adjustment endpoint is permissioned, auditable, reasoned, and can choose an open accounting posting date', () => {
  assert.match(dto, /class CreatePayrollAdjustmentRunDto/);
  assert.match(dto, /@MinLength\(5\) reason!/);
  assert.match(dto, /postingDate\?: string/);
  assert.match(controller, /@Permissions\('payroll\.manage'\) @Post\('runs\/:id\/adjustments'\)/);
  assert.match(controller, /createAdjustmentRun\(id, dto, user\)/);
  assert.match(payroll, /if \(source\.adjustmentOfRunId\).*Adjustment harus dibuat dari payroll run reguler/);
  assert.match(payroll, /!\['POSTED', 'PAID'\]\.includes\(source\.status\)/);
  assert.match(payroll, /CREATE_PAYROLL_ADJUSTMENT_RUN/);
  assert.match(payroll, /documentType: 'PAYROLL_ADJUSTMENT', prefix: 'PAYADJ'/);
  assert.match(payroll, /adjustmentPostingDate: dto\.postingDate \? parseDate/);
});

test('adjustment calculation stores only the differential against source plus earlier posted adjustments', () => {
  assert.match(payroll, /recognitionRunIds = \[source\.id, \.\.\.priorAdjustments\.map/);
  assert.match(payroll, /recognizedGross = recognized\.reduce/);
  assert.match(payroll, /decimal\(gross\)\.minus\(recognizedGross\)/);
  assert.match(payroll, /decimal\(net\)\.minus\(recognizedNet\)/);
  assert.match(payroll, /source: 'ADJUSTMENT_DIFFERENTIAL'/);
  assert.match(payroll, /const lineKey = .*componentId.*code.*componentType/);
  assert.doesNotMatch(payroll, /const lineKey = .*source/);
  assert.match(payroll, /targetAmount: target\?\.amount \?\? 0, recognizedAmount: prior\?\.amount \?\? 0/);
  assert.match(payroll, /if \(!isAdjustment && period\.status !== 'OPEN'\)/);
  assert.match(payroll, /CALCULATE_PAYROLL_ADJUSTMENT_RUN/);
  assert.doesNotMatch(payroll, /adjustmentOfRunId[\s\S]{0,250}grossTotal: source\.grossTotal/);
});

test('adjustment approval rejects empty or review-required corrections instead of approving a no-op', () => {
  assert.match(payroll, /hasDifference = \[run\.grossTotal, run\.deductionTotal, run\.taxTotal, run\.employerContributionTotal, run\.netTotal\]/);
  assert.match(payroll, /Adjustment tidak memiliki selisih/);
  assert.match(payroll, /APPROVE_PAYROLL_ADJUSTMENT_RUN/);
  assert.match(payroll, /needsReview = results\.filter/);
});

test('adjustment posting is signed, period-safe, and refuses hidden tax or social overpayment', () => {
  assert.match(payroll, /eventType: 'PAYROLL_ADJUSTMENT'/);
  assert.match(payroll, /fiscalPeriod && fiscalPeriod\.status !== 'OPEN'/);
  assert.match(payroll, /status: \{ not: 'CANCELLED' \}/);
  assert.match(payroll, /'DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'POSTED', 'PAID'/);
  assert.match(payroll, /Koreksi pajak melebihi utang pajak payroll yang belum dibayar\/belum dicadangkan settlement/);
  assert.match(payroll, /Koreksi BPJS\/potongan melebihi kewajiban yang belum dibayar\/belum dicadangkan settlement/);
  assert.match(payroll, /pushSigned\(accounts\.payrollExpense, expenseDelta, 'DEBIT'\)/);
  assert.match(payroll, /journalLines\.length \|\| !debitTotal\.equals\(creditTotal\)/);
  assert.match(payroll, /taxAmount: run\.taxTotal, status: 'POSTED'/);
  assert.match(payroll, /POST_PAYROLL_ADJUSTMENT_ACCOUNTING/);
});

test('negative salary adjustment reduces unpaid instruction first and creates recovery only for already-paid excess', () => {
  assert.match(payroll, /direction: 'OUTBOUND', status: 'PROCESSING'/);
  assert.match(payroll, /status: \{ in: \['PENDING', 'FAILED'\] \}/);
  assert.match(payroll, /Reduced by payroll adjustment/);
  assert.match(payroll, /salaryPayableReduction = salaryPayableReduction\.plus\(applied\)/);
  assert.match(payroll, /recoveryByResult\.set\(result\.id, reductionNeeded\)/);
  assert.match(payroll, /direction: 'RECOVERY'/);
  assert.match(payroll, /Mapping __PAYROLL_RECEIVABLE__ wajib dikonfigurasi/);
});

test('employee recovery has a real receivable account and real cash-bank settlement event', () => {
  assert.match(seed, /\['1204','Piutang Karyawan \/ Payroll Recovery',AccountType\.ASSET\]/);
  assert.match(seed, /componentCode: '__PAYROLL_RECEIVABLE__', debitCode: '1204'/);
  assert.match(seed, /code: 'PAYROLL-EMPLOYEE-RECOVERY', eventType: 'PAYROLL_EMPLOYEE_RECOVERY'/);
  assert.match(seed, /accountCodeKey: 'settlement', side: 'DEBIT'/);
  assert.match(seed, /accountCodeKey: 'payrollReceivable', side: 'CREDIT'/);
  assert.match(payroll, /eventType: 'PAYROLL_EMPLOYEE_RECOVERY'/);
  assert.match(payroll, /SETTLE_PAYROLL_RECOVERY/);
});

test('payroll liability settlement aggregates the source and adjustment chain to prevent paying the old run amount twice', () => {
  assert.match(finance, /const rootRunId = run\.adjustmentOfRunId \?\? run\.id/);
  assert.match(finance, /OR: \[\{ id: rootRunId \}, \{ adjustmentOfRunId: rootRunId \}\]/);
  assert.match(finance, /referenceId: \{ in: chainRunIds \}/);
  assert.match(finance, /chainRuns\.reduce\(\(sum, item\) => sum\.add\(item\.taxTotal\)/);
  assert.match(payroll, /adjustmentOfRunId: null, status: \{ in: \['POSTED', 'PAID'\] \}/);
  assert.match(payroll, /adjustmentCount: chainRuns\.length - 1/);
});

test('Admin exposes an explicit adjustment workflow and distinguishes salary outflow from employee recovery', () => {
  assert.match(admin, /Buat adjustment/);
  assert.match(admin, /Hitung selisih/);
  assert.match(admin, /Posting selisih/);
  assert.match(admin, /Nilai di bawah adalah <strong>selisih<\/strong>/);
  assert.match(admin, /Recovery ke perusahaan/);
  assert.match(admin, /Konfirmasi penerimaan recovery/);
  assert.doesNotMatch(admin, /window\.prompt/);
});

test('regular payroll creation ignores adjustment rows and regular salary payments are explicitly outbound', () => {
  assert.match(payroll, /payrollPeriodId: dto\.payrollPeriodId, adjustmentOfRunId: null, status: \{ not: 'CANCELLED' \}/);
  assert.match(payroll, /paymentMethod: 'PENDING_SELECTION', direction: 'OUTBOUND', amount: result\.netPay/);
});

test('adjustment lineage survives payslip and payroll reporting surfaces', () => {
  assert.match(payroll, /payrollRunNumber: run\.number, adjustmentOfRunId: run\.adjustmentOfRunId, adjustmentSequence: run\.adjustmentSequence, adjustmentReason: run\.adjustmentReason/);
  assert.match(worker, /'runType','adjustmentOfRunId','adjustmentSequence','adjustmentReason','adjustmentPostingDate'/);
  assert.match(worker, /row\.adjustmentOfRunId \? 'ADJUSTMENT' : 'REGULAR'/);
});

test('operator documentation and Postman expose the differential adjustment lifecycle', () => {
  assert.match(payrollDoc, /differential adjustment run/);
  assert.match(payrollDoc, /Piutang Karyawan \/ Payroll Recovery/);
  assert.match(postman, /Buat adjustment payroll/);
  assert.ok(postman.includes('payroll/runs/{{payrollRunId}}/adjustments'));
});

test('zero-delta reconciliation rows are not published as correction payslips', () => {
  assert.match(payroll, /const allResults = await this\.prisma\.payrollResult\.findMany/);
  assert.match(payroll, /run\.adjustmentOfRunId \? allResults\.filter/);
  assert.match(payroll, /result\.grossPay, result\.taxableIncome, result\.employeeContribution, result\.employerContribution, result\.incomeTax, result\.otherDeductions, result\.netPay/);
});

test('pre-posting payroll cancellation exists so an abandoned adjustment cannot permanently block the chain', () => {
  assert.match(dto, /class CancelPayrollRunDto/);
  assert.match(controller, /@Post\('runs\/:id\/cancel'\)/);
  assert.match(payroll, /!\['DRAFT', 'REVIEW', 'APPROVED'\]\.includes\(run\.status\)/);
  assert.match(payroll, /Run POSTED\/PAID tetap immutable/);
  assert.match(payroll, /CANCEL_PAYROLL_ADJUSTMENT_RUN/);
  assert.match(admin, /Batalkan adjustment/);
  assert.match(admin, /payroll-cancel-title/);
  assert.ok(postman.includes('payroll/runs/{{payrollRunId}}/cancel'));
});

test('adjustment sequence is database-unique per source chain to close concurrent creation races', () => {
  for (const schema of schemas) assert.match(schema, /@@unique\(\[companyId, branchId, adjustmentOfRunId, adjustmentSequence\]\)/);
  for (const migration of [pgMigration, sqliteMigration]) assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_companyId_branchId_adjustmentOfRunId_adjustmentSequence_key"/);
});

