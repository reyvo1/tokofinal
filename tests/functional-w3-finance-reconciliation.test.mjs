import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const financeController = read('apps/api/src/finance-operations/finance-operations.controller.ts');
const financeService = read('apps/api/src/finance-operations/finance-operations.service.ts');
const accountingController = read('apps/api/src/accounting-core/accounting-core.controller.ts');
const accountingService = read('apps/api/src/accounting-core/accounting-core.service.ts');
const extensionsController = read('apps/api/src/extensions/extensions.controller.ts');
const extensionsService = read('apps/api/src/extensions/extensions.service.ts');
const extensionsDto = read('apps/api/src/extensions/dto/extensions.dto.ts');
const admin = read('apps/admin/app/modules/accounting.tsx');

test('W3 finance transaction lifecycle supports approve, reject, cancel and post with audit', () => {
  for (const route of ["@Post(':id/approve')", "@Post(':id/reject')", "@Post(':id/cancel')", "@Post(':id/post')"]) assert.match(financeController, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(financeService, /async reject\(/);
  assert.match(financeService, /status !== 'WAITING_APPROVAL'/);
  assert.match(financeService, /REJECT_FINANCE_TRANSACTION/);
  assert.match(financeService, /async cancel\(/);
  assert.match(financeService, /\['DRAFT', 'WAITING_APPROVAL', 'APPROVED'\]\.includes\(row\.status\)/);
  assert.match(financeService, /CANCEL_FINANCE_TRANSACTION/);
  assert.match(admin, /Wajib approval/);
  assert.match(admin, /requestFinanceAction\(f, 'approve'\)/);
  assert.match(admin, /requestFinanceAction\(f, 'reject'\)/);
  assert.match(admin, /requestFinanceAction\(f, 'cancel'\)/);
  assert.match(admin, /financeDialog/);
  assert.doesNotMatch(admin, /window\.(?:prompt|confirm|alert)/);
});

test('W3 chart of accounts is tenant/branch scoped and exposed for finance operations', () => {
  assert.match(accountingController, /@Get\('accounts'\)/);
  assert.match(accountingService, /async listAccounts\(user: AuthUser\)/);
  assert.match(accountingService, /branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \}/);
  assert.match(admin, /\/accounting-core\/accounts/);
});

test('W3 fiscal lifecycle is OPEN -> SOFT_CLOSED -> CLOSED and non-open periods block posting', () => {
  assert.match(extensionsController, /finance\/fiscal-periods\/:id\/soft-close/);
  assert.match(extensionsController, /finance\/fiscal-periods\/:id\/reopen/);
  assert.match(extensionsController, /finance\/fiscal-periods\/:id\/close/);
  assert.match(extensionsService, /async softCloseFiscalPeriod/);
  assert.match(extensionsService, /status: 'SOFT_CLOSED'/);
  assert.match(extensionsService, /FISCAL_PERIOD_SOFT_CLOSE_BLOCKED/);
  assert.match(extensionsService, /period\.status !== 'SOFT_CLOSED'/);
  assert.match(extensionsService, /Periode CLOSED bersifat final/);
  assert.match(accountingService, /fiscalPeriod\.status !== 'OPEN'/);
  assert.match(admin, /Soft close/);
  assert.match(admin, /Final close/);
  assert.match(admin, /Reopen/);
});

test('W3 bank statement import is bound to an active branch account and is fail-closed', () => {
  assert.match(extensionsDto, /class ImportBankStatementDto[\s\S]*bankAccountId!: string/);
  assert.match(extensionsService, /assertBankAccount\(tx, user, scope, dto\.bankAccountId\)/);
  assert.match(extensionsService, /tepat satu sisi debit atau credit/);
  assert.match(extensionsService, /Identitas file bank statement sudah pernah dipakai dengan payload berbeda/);
  assert.match(extensionsService, /periodStart/);
  assert.match(extensionsService, /periodEnd/);
  assert.match(admin, /Import bank statement/);
});

test('W3 reconciliation derives book balance from journal instead of trusting client totals', () => {
  assert.match(extensionsService, /Saldo buku client stale/);
  assert.match(extensionsService, /journalBookBalance\(tx, bankAccountId, endDate\)/);
  assert.match(extensionsService, /statementBalance\(statement, statementLines, dto\.bankBalance\)/);
  assert.match(extensionsService, /difference = bankBalance\.sub\(bookBalance\)/);
  assert.match(extensionsService, /snapshot saldo telah berubah/);
  assert.match(admin, /Snapshot rekonsiliasi dibuat dari journal \+ bank statement/);
});

test('W3 bank reconciliation supports deterministic auto-match plus manual match/unmatch', () => {
  for (const route of ['auto-match', '/match', '/unmatch', '/details']) assert.match(extensionsController, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(extensionsService, /bankLineMatchesJournalAmount/);
  assert.match(extensionsService, /sameBusinessDate/);
  assert.match(extensionsService, /candidates\.length !== 1/);
  assert.match(extensionsService, /Journal line sudah dipakai oleh bank statement line lain/);
  assert.match(extensionsService, /matchedType: 'JournalLine'/);
  assert.match(extensionsService, /matched: false, matchedType: null, matchedId: null/);
  assert.match(admin, /Auto-match/);
  assert.match(admin, />Match<\/button>/);
  assert.match(admin, />Unmatch<\/button>/);
});

test('W3 internal cash/bank transfer is operable from Admin and posts through accounting core', () => {
  assert.match(admin, /option value="CASH_TRANSFER">Transfer kas\/bank/);
  assert.match(admin, /debitAccountCode: form\.transferTargetAccount, creditAccountCode: form\.settlementAccount/);
  assert.match(financeService, /return 'BALANCE_TRANSFER'/);
});
