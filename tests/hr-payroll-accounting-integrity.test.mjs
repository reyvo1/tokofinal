import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const payroll = read('apps/api/src/payroll/payroll.service.ts');
const controller = read('apps/api/src/payroll/payroll.controller.ts');
const dto = read('apps/api/src/payroll/dto/payroll.dto.ts');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const financeDto = read('apps/api/src/finance-operations/dto/finance-operations.dto.ts');
const seed = read('apps/api/prisma/seed.ts');
const admin = read('apps/admin/app/modules/hr-payroll.tsx');
const schemas = ['apps/api/prisma/schema.prisma', 'apps/api/prisma/schema.postgresql.prisma', 'apps/api/prisma/schema.sqlite.prisma'].map(read);

test('payroll period blocks overlapping ranges and locks attendance before attendance-based calculation', () => {
  assert.match(payroll, /startDate: \{ lte: endDate \}/);
  assert.match(payroll, /endDate: \{ gte: startDate \}/);
  assert.match(payroll, /LOCK_PAYROLL_ATTENDANCE/);
  assert.match(payroll, /pendingCorrections \|\| pendingLeave \|\| pendingOvertime \|\| unresolvedRecords/);
  assert.match(payroll, /allLocked: scoped\.length > 0 && scoped\.every/);
  assert.match(payroll, /attendance-not-locked/);
});

test('payroll calculation is serializable, effective-dated and uses taxable components rather than gross blindly', () => {
  assert.match(payroll, /async calculateRun[\s\S]*?return serializableTx\(this\.prisma/);
  assert.match(payroll, /effectiveFrom: \{ lte: period\.endDate \}/);
  assert.match(payroll, /effectiveTo: null/);
  assert.match(payroll, /const taxableAmount = positiveType && definition\.taxable \? calculated\.amount : 0/);
  assert.match(payroll, /taxableIncome \+= taxableAmount/);
  assert.match(payroll, /evaluatePayrollFormula\(definition\.formula/);
  assert.match(payroll, /formula-error:/);
});


test('effective-dated employee payroll profiles support history and split-period segmentation', () => {
  for (const schema of schemas) {
    assert.doesNotMatch(schema, /employeeId\s+String\s+@unique/);
    assert.match(schema, /@@unique\(\[employeeId, effectiveFrom\]\)/);
    assert.match(schema, /@@index\(\[companyId, employeeId, effectiveFrom\]\)/);
  }
  assert.match(payroll, /private buildEffectiveSegments/);
  assert.match(payroll, /private allocateTemporalAmounts/);
  assert.match(payroll, /employeeTaxProfile\.findMany\(\{ where: \{[\s\S]*?effectiveFrom: \{ lte: period\.endDate \}[\s\S]*?effectiveTo: \{ gte: period\.startDate \}/);
  assert.match(payroll, /employeeSocialSecurityProfile\.findMany\(\{ where: \{[\s\S]*?effectiveFrom: \{ lte: period\.endDate \}[\s\S]*?effectiveTo: \{ gte: period\.startDate \}/);
  const pg = read('database/migrations/T360-20260911-payroll-liability-integrity/postgresql-expand.sql');
  const sqlite = read('database/migrations/T360-20260911-payroll-liability-integrity/sqlite-expand.sql');
  assert.match(pg, /DROP CONSTRAINT IF EXISTS "EmployeeTaxProfile_employeeId_key"/);
  assert.match(pg, /EmployeeSocialSecurityProfile_employeeId_effectiveFrom_key/);
  assert.match(sqlite, /DROP INDEX IF EXISTS "EmployeeTaxProfile_employeeId_key"/);
  assert.match(sqlite, /EmployeeSocialSecurityProfile_employeeId_effectiveFrom_key/);
});

test('tax and social rules require verified parameters and cannot have overlapping approved versions', () => {
  assert.match(payroll, /requiresOfficialRateImport=true/);
  assert.match(payroll, /Tax rate harus berupa desimal 0\.\.1/);
  assert.match(payroll, /Progressive tax rate harus berupa desimal 0\.\.1/);
  assert.match(payroll, /Tax rule version .* sudah APPROVED pada rentang tanggal yang bertumpang tindih/);
  assert.match(payroll, /Social-security rule version .* sudah APPROVED pada rentang tanggal yang bertumpang tindih/);
  assert.match(payroll, /Setiap program social-security wajib memiliki code/);
  assert.match(controller, /@Post\('tax-rule-sets\/:id\/approve'\)/);
  assert.match(controller, /@Post\('social-security-rule-sets\/:id\/approve'\)/);
});

test('approval rejects incomplete or review-required payroll results', () => {
  assert.match(payroll, /results\.length !== activeEmployeeCount \|\| run\.employeeCount !== activeEmployeeCount/);
  assert.match(payroll, /this\.traceRequiresReview\(result\.calculationTrace\)/);
  assert.match(payroll, /hasil payroll masih REQUIRES_REVIEW/);
});

test('payroll accounting resolves configurable mappings and balances expense to exact recognized credits', () => {
  for (const code of ['__PAYROLL_EXPENSE__', '__SALARY_PAYABLE__', '__PAYROLL_TAX_PAYABLE__', '__PAYROLL_OTHER_PAYABLE__']) {
    assert.match(payroll, new RegExp(code));
    assert.match(seed, new RegExp(code));
  }
  assert.match(payroll, /client\.payrollAccountingMapping\.findMany/);
  assert.match(payroll, /const debit = run\.netTotal\.plus\(run\.taxTotal\)\.plus\(payrollOtherPayable\)/);
  assert.match(payroll, /businessDate: period\.endDate/);
  assert.match(seed, /code: 'PAYROLL-POSTED', eventType: 'PAYROLL_POSTED'/);
});

test('posting payroll creates one pending salary payment per employee result', () => {
  assert.match(payroll, /tx\.payrollPayment\.upsert/);
  assert.match(payroll, /where: \{ payrollResultId: result\.id \}/);
  assert.match(payroll, /paymentMethod: 'PENDING_SELECTION'/);
  assert.match(payroll, /status: paymentCount \? 'POSTED' : 'PAID'/);
});

test('salary settlement posts Dr salary payable Cr cash-bank and requires bank reference', () => {
  assert.match(payroll, /eventType: 'PAYROLL_SALARY_PAYMENT'/);
  assert.match(payroll, /accountCodes: \{ salaryPayable: accounts\.salaryPayable, settlement: settlementAccount\.code \}/);
  assert.match(payroll, /settlementAccount\.code !== '1101' && !dto\.externalReference\?\.trim\(\)/);
  assert.match(seed, /code: 'PAYROLL-SALARY-PAYMENT', eventType: 'PAYROLL_SALARY_PAYMENT'/);
  assert.match(seed, /accountCodeKey: 'salaryPayable', side: 'DEBIT'/);
  assert.match(seed, /accountCodeKey: 'settlement', side: 'CREDIT'/);
  assert.match(admin, /Referensi transfer bank/);
  assert.match(admin, /Konfirmasi transfer gaji/);
  assert.doesNotMatch(admin, /window\.prompt/);
  assert.match(admin, /paymentMethod: 'BANK_TRANSFER', externalReference/);
});

test('payroll liability settlement is run-scoped and prevents paying beyond recognized tax or social liabilities', () => {
  assert.match(financeDto, /'PAYROLL_LIABILITY_PAYMENT'/);
  assert.match(finance, /private async payrollLiabilitySnapshot/);
  assert.match(finance, /status: \{ in: \['POSTED', 'PAID'\] \}/);
  assert.match(finance, /liabilityAccountCode === '2103'/);
  assert.match(finance, /OR: \[\{ id: rootRunId \}, \{ adjustmentOfRunId: rootRunId \}\]/);
  assert.match(finance, /chainRuns\.reduce\(\(sum, item\) => sum\.add\(item\.deductionTotal\)\.add\(item\.employerContributionTotal\)/);
  assert.match(finance, /gross\.greaterThan\(liability\.available\)/);
  assert.match(finance, /row\.grossAmount\.greaterThan\(liability\.available\)/);
  assert.match(seed, /code: 'PAYROLL-LIABILITY-PAYMENT', eventType: 'PAYROLL_LIABILITY_PAYMENT'/);
});

test('payroll payment schema and migration persist settlement audit fields consistently', () => {
  for (const schema of schemas) {
    assert.match(schema, /PAYROLL_LIABILITY_PAYMENT/);
    assert.match(schema, /settlementAccountCode String\?/);
    assert.match(schema, /accountingEventId String\?\s+@unique/);
  }
  const pg = read('database/migrations/T360-20260911-payroll-liability-integrity/postgresql-expand.sql');
  const sqlite = read('database/migrations/T360-20260911-payroll-liability-integrity/sqlite-expand.sql');
  assert.match(pg, /PAYROLL_LIABILITY_PAYMENT/);
  assert.match(pg, /settlementAccountCode/);
  assert.match(pg, /accountingEventId/);
  assert.match(sqlite, /settlementAccountCode/);
  assert.match(sqlite, /accountingEventId/);
});

test('payslips are withheld until employee salary payments are complete', () => {
  assert.match(payroll, /if \(run\.status !== 'PAID'\).*Slip gaji hanya dapat diterbitkan/);
  assert.match(controller, /@Post\('runs\/:id\/publish-payslips'\)/);
});

test('admin HR uses real backend DTO and exposes controlled payroll lifecycle', () => {
  assert.match(admin, /payrollPeriodId: selectedPeriodId/);
  assert.doesNotMatch(admin, /periodYear|periodMonth/);
  for (const path of ['lock-attendance', 'calculate', 'approve', 'post-accounting']) assert.match(admin, new RegExp(path));
  assert.match(admin, /\/payroll\/payments\/\$\{payment\.id\}\/settle/);
  assert.match(admin, /type: 'PAYROLL_LIABILITY_PAYMENT'/);
  assert.match(admin, /Posting final dilakukan dari menu Akuntansi setelah pembayaran eksternal benar-benar dilakukan/);
});

test('settlement DTO carries auditable payment details', () => {
  assert.match(dto, /class SettlePayrollPaymentDto/);
  assert.match(dto, /settlementAccountCode!: string/);
  assert.match(dto, /paymentMethod!: string/);
  assert.match(dto, /externalReference\?: string/);
  assert.match(dto, /paidAt\?: string/);
});


test('Postman collection exposes payroll lifecycle and settlement endpoints', () => {
  const postman = read('docs/Toko360.postman_collection.json');
  assert.match(postman, /13 HR & Payroll Integrity/);
  assert.match(postman, /payroll\/periods\/\{\{payrollPeriodId\}\}\/lock-attendance/);
  assert.match(postman, /payroll\/runs\/\{\{payrollRunId\}\}\/post-accounting/);
  assert.match(postman, /payroll\/payments\/\{\{payrollPaymentId\}\}\/settle/);
  assert.match(postman, /PAYROLL_LIABILITY_PAYMENT/);
  assert.match(postman, /REPLACE_REAL_BANK_REFERENCE/);
});
