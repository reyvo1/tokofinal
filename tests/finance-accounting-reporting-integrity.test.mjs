import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const reports = read('apps/api/src/reports/reports.service.ts');
const reportsController = read('apps/api/src/reports/reports.controller.ts');
const reportDto = read('apps/api/src/reports/dto/create-report-job.dto.ts');
const accounting = read('apps/api/src/accounting-core/accounting-core.service.ts');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const extensions = read('apps/api/src/extensions/extensions.service.ts');
const worker = read('apps/worker/src/index.ts');
const owner = read('apps/admin/app/owner.tsx');
const accountingUi = read('apps/admin/app/modules/accounting.tsx');
const seed = read('apps/api/prisma/seed.ts');

test('dashboard revenue and profit are sourced from journal activity instead of storefront payment-state guesses', () => {
  assert.match(reports, /this\.accountActivity\(scope, start, now\)/);
  assert.match(reports, /source: 'POSTED_JOURNAL'/);
  assert.match(reports, /financialActivity\.filter\(\(row\) => row\.type === 'REVENUE'\)/);
  assert.match(reports, /financialActivity\.filter\(\(row\) => row\.type === 'EXPENSE'\)/);
  assert.doesNotMatch(reports, /status: \{ in: \['PAID','PROCESSING','PACKED','SHIPPED','COMPLETED'\] \}/);
});

test('analytics nets sale returns and derives cash movement from cash-bank journal lines', () => {
  assert.match(reports, /'ONLINE_ORDER_CREDIT_FULFILLED', 'SALE_RETURN'/);
  assert.match(reports, /\['SALE_RETURN','ORDER_RETURN'\]\.includes\(event\.eventType\) \? -Number\(event\.netAmount\)/);
  assert.match(reports, /code: \{ in: \['1101', '1102', '1103'\] \}/);
  assert.match(reports, /description\.startsWith\('BALANCE_TRANSFER '\)/);
  assert.match(reports, /cashIn: amount\.cashIn/);
  assert.match(reports, /cashOut: amount\.cashOut/);
  assert.match(reports, /netCashFlow: amount\.cashIn - amount\.cashOut/);
});

test('date-only report ranges include the complete final business day in company timezone', () => {
  assert.match(reports, /const timeZone = await this\.companyTimeZone\(scope\.companyId\)/);
  assert.match(reports, /parseBusinessDateBoundary\(fromValue, businessMonthStart\(now, timeZone\), timeZone, false\)/);
  assert.match(reports, /parseBusinessDateBoundary\(toValue, now, timeZone, true\)/);
  assert.match(reports, /Tanggal awal tidak boleh melebihi tanggal akhir/);
  assert.doesNotMatch(reports, /T23:59:59\.999Z/);
});

test('core finance reports expose trial balance, balance sheet, ledger, tax summary and integrity controls', () => {
  for (const route of ['trial-balance', 'balance-sheet', 'general-ledger', 'tax-summary', 'financial-integrity']) {
    assert.match(reportsController, new RegExp(`@Get\\('${route}'\\)`));
  }
  assert.match(reports, /async trialBalance\(/);
  assert.match(reports, /async balanceSheet\(/);
  assert.match(reports, /async generalLedger\(/);
  assert.match(reports, /async taxSummary\(/);
  assert.match(reports, /async financialIntegrity\(/);
});

test('trial balance and balance sheet use double-entry normal balances and current earnings', () => {
  assert.match(reports, /\['ASSET', 'EXPENSE'\]\.includes\(type\) \? debit\.sub\(credit\) : credit\.sub\(debit\)/);
  assert.match(reports, /balanced: totalDebit\.equals\(totalCredit\)/);
  assert.match(reports, /const currentEarnings = revenue\.sub\(expenses\)/);
  assert.match(reports, /const totalEquity = postedEquity\.add\(currentEarnings\)/);
  assert.match(reports, /balanced: totalAssets\.equals\(totalLiabilitiesAndEquity\)/);
});

test('general ledger and finance reports remain scoped to authenticated company and branch', () => {
  assert.match(reports, /account: \{ branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \} \}/);
  assert.match(reports, /lines: \{ some: \{ account: \{ branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \}/);
  assert.match(reports, /await this\.assertRequestedScope\(this\.prisma, user, scope, requestedCompanyId, requestedBranchId, 'TrialBalanceReport'\)/);
  assert.match(reports, /await this\.assertRequestedScope\(this\.prisma, user, scope, requestedCompanyId, requestedBranchId, 'BalanceSheetReport'\)/);
  assert.match(reports, /await this\.assertRequestedScope\(this\.prisma, user, scope, requestedCompanyId, requestedBranchId, 'TaxSummaryReport'\)/);
});

test('tax summary uses posted signed tax transactions so returns reduce the same tax period', () => {
  assert.match(reports, /status: 'POSTED'/);
  assert.match(reports, /row\.direction === 'OUTPUT'/);
  assert.match(reports, /row\.direction === 'INPUT' && codeMap\.get\(row\.taxCodeId\)\?\.recoverable/);
  assert.match(reports, /row\.direction === 'WITHHOLDING'/);
  assert.match(reports, /Retur tersimpan sebagai TaxTransaction bernilai negatif/);
});

test('financial integrity treats structural imbalance and failed accounting events as blockers', () => {
  assert.match(reports, /status: 'FAILED'/);
  assert.match(reports, /const structuralMismatch = \(trialDifference\.isZero\(\) \? 0 : 1\) \+ \(balanceSheetDifference\.isZero\(\) \? 0 : 1\)/);
  assert.match(reports, /const blockers = unbalancedJournalIds\.length \+ postedEventsMissingJournal \+ failedEvents \+ structuralMismatch/);
  assert.match(reports, /status: blockers > 0 \? 'FAIL' : warnings > 0 \? 'WARN' : 'PASS'/);
});

test('inventory valuation returns a whole-branch live summary independent of page size', () => {
  assert.match(reports, /const valuationRows = await this\.prisma\.inventory\.findMany/);
  assert.match(reports, /new Prisma\.Decimal\(row\.product\.costPrice\)\.mul\(row\.quantity\)/);
  assert.match(reports, /inventoryValue: Number\(inventoryValue\)/);
  assert.match(reports, /source: 'LIVE_INVENTORY'/);
  assert.match(owner, /function inventoryValueOf\(value: Valuation\)/);
  assert.match(owner, /'summary' in value/);
  assert.match(owner, /'inventoryValue' in summary/);
  assert.match(owner, /const total = inventoryValueOf\(valData\)/);
});

test('tax calculation and tax posting honor company and effective business date', () => {
  assert.match(accounting, /effectiveAt: Date = new Date\(\)/);
  assert.match(accounting, /taxCode\.effectiveFrom && taxCode\.effectiveFrom > effectiveAt/);
  assert.match(accounting, /taxCode\.effectiveTo && taxCode\.effectiveTo < effectiveAt/);
  assert.match(accounting, /expectedScopes\?\.length && !expectedScopes\.includes\(taxCode\.scope\)/);
  assert.match(accounting, /OUTPUT: \['SALE', 'SHIPPING', 'OTHER'\]/);
  assert.match(accounting, /INPUT: \['PURCHASE', 'EXPENSE', 'ASSET', 'SHIPPING', 'OTHER'\]/);
  assert.match(accounting, /companyId: input\.companyId/);
  assert.match(accounting, /taxCode\.effectiveFrom > businessDate/);
  assert.match(accounting, /taxCode\.effectiveTo < businessDate/);
  assert.match(finance, /calculateTax\(tx, dto\.taxCodeId, dto\.amount, scope\.companyId, transactionDate, expectedTaxScopes\)/);
});

test('tax payment has a dedicated liability-to-settlement posting rule instead of generic balance transfer', () => {
  assert.match(finance, /dto\.type === 'TAX_PAYMENT'/);
  assert.match(finance, /\['2103', '2201', '2202'\]\.includes\(taxPayableAccount\.code\)/);
  assert.match(finance, /isTaxPayment/);
  assert.match(finance, /taxPayable: row\.debitAccountCode, settlement: row\.creditAccountCode/);
  assert.match(finance, /if \(type === 'TAX_PAYMENT'\) return 'TAX_PAYMENT'/);
  assert.match(seed, /code: 'TAX-PAYMENT', eventType: 'TAX_PAYMENT'/);
  assert.match(seed, /accountCodeKey: 'taxPayable', side: 'DEBIT', amountKey: 'gross'/);
  assert.match(accountingUi, /<option value="TAX_PAYMENT">Bayar pajak<\/option>/);
  // Bentuk berubah, niat tidak: pajak didebet dari akun utang yang KASIR PILIH, bukan kode yang
  // tertanam di source. Kode '2201' sebagai default hardcode pernah membuat jurnal masuk ke akun
  // milik template; server tetap=white-list 2103/2201/2202, jadi UI harus menawarkan tepat itu.
  assert.match(accountingUi, /TAX_PAYABLE_ALLOWED = \['2103', '2201', '2202'\]/,
    'UI harus mencerminkan daftar putih akun pajak dari server, bukan menawarkannya lebih luas');
  assert.doesNotMatch(accountingUi, /taxPayableAccount: '2201'/,
    'akun pajak tidak boleh lagi punya default hardcode di form');
  // Akun utang didebit dari PILIHAN KASIR (divalidasi tipe LIABILITY), bukan kode literal. Bentuknya
  // berubah karena `roleAccount()` membungkus nilai itu — sebelumnya `debitAccountCode` menerima
  // string apa pun, termasuk akun bertipe salah yang akan ditolak server saat posting.
  assert.match(accountingUi, /debitAccountCode: roleAccount\(form\.taxPayableAccount, 'akun utang pajak', 'LIABILITY'\)!/,
    'pajak harus didebet dari akun utang yang dipilih kasir, divalidasi bertipe LIABILITY');
  assert.match(accountingUi, /creditAccountCode: form\.settlementAccount/,
    'dan dikredit ke rekening kas/bank yang dipilih');
});

test('fiscal periods use company-timezone day boundaries, reject overlap and refuse unsafe close', () => {
  assert.match(extensions, /companyTimeZone\(this\.prisma, scope\.companyId\)/);
  assert.match(extensions, /parseBusinessDateBoundary\(dto\.startDate, now, timeZone, false\)/);
  assert.match(extensions, /parseBusinessDateBoundary\(dto\.endDate, now, timeZone, true\)/);
  assert.doesNotMatch(extensions, /function boundaryDate\(/);
  assert.match(extensions, /startDate: \{ lte: endDate \}/);
  assert.match(extensions, /endDate: \{ gte: startDate \}/);
  assert.match(extensions, /FISCAL_PERIOD_CLOSE_BLOCKED/);
  assert.match(extensions, /const unbalancedJournals = journalGroups\.filter/);
  assert.match(extensions, /FISCAL_PERIOD_SOFT_CLOSE_BLOCKED/);
  assert.match(extensions, /postedEventsMissingJournal/);
  assert.match(extensions, /pendingFinanceTransactions/);
  assert.match(extensions, /status: 'CALCULATED'/);
});

test('report exports advertise only implemented formats and worker renders each declared finance report', () => {
  assert.match(reportDto, /const REPORT_TYPES = \[/);
  for (const type of ['PROFIT_LOSS', 'TRIAL_BALANCE', 'BALANCE_SHEET', 'GENERAL_LEDGER', 'TAX_SUMMARY']) {
    assert.match(reportDto, new RegExp(`'${type}'`));
    assert.match(worker, new RegExp(`reportType === '${type}'`));
  }
  assert.match(reportDto, /@IsIn\(\['CSV','XLSX','PDF'\]\)/);
  assert.match(worker, /if \(normalized === 'CSV'\)/);
  assert.match(worker, /if \(normalized === 'XLSX'\)/);
  assert.match(worker, /if \(normalized === 'PDF'\)/);
  assert.match(worker, /renderXlsx\(csv\)/);
  assert.match(worker, /renderPdf\(csv, `Toko360 \${reportType}`\)/);
  assert.match(reports, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(reports, /application\/pdf/);
});

test('owner suite surfaces journal-backed balance sheet and financial integrity instead of raw order revenue', () => {
  assert.match(owner, /\/reports\/balance-sheet\?asOf=/);
  assert.match(owner, /\/reports\/financial-integrity\?asOf=/);
  assert.match(owner, /POSISI & INTEGRITAS/);
  assert.match(owner, /Total Ekuitas \+ Laba Berjalan/);
  assert.match(owner, /integrity\.blockers/);
});
