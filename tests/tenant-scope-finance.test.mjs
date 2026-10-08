import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const financeController = readFileSync('apps/api/src/finance-operations/finance-operations.controller.ts', 'utf8');
const financeService = readFileSync('apps/api/src/finance-operations/finance-operations.service.ts', 'utf8');
const financeDto = readFileSync('apps/api/src/finance-operations/dto/finance-operations.dto.ts', 'utf8');
const extensionsController = readFileSync('apps/api/src/extensions/extensions.controller.ts', 'utf8');
const extensionsService = readFileSync('apps/api/src/extensions/extensions.service.ts', 'utf8');
const extensionsDto = readFileSync('apps/api/src/extensions/dto/extensions.dto.ts', 'utf8');
const financeExtensions = extensionsService.slice(extensionsService.indexOf('async fiscalPeriods('), extensionsService.indexOf('  async devices('));

test('finance operations derive company and branch from authenticated user', () => {
  assert.match(financeController, /@CurrentUser\(\) user: AuthUser/);
  assert.match(financeController, /this\.service\.list\(user, type, status, limit, cursor, companyId, branchId\)/);
  assert.match(financeService, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(financeService, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(financeService, /companyId: scope\.companyId,\s*branchId: scope\.branchId/);
});

test('legacy finance tenant fields are optional and cannot become tenant authority', () => {
  assert.match(financeDto, /companyId\?: string/);
  assert.match(financeDto, /branchId\?: string/);
  assert.doesNotMatch(financeDto, /companyId!:\s*string/);
  assert.doesNotMatch(financeDto, /branchId!:\s*string/);
  assert.match(financeService, /assertRequestedScope\(this\.prisma, user, scope, dto\.companyId, dto\.branchId\)/);
  assert.doesNotMatch(financeService, /companyId:\s*dto\.companyId/);
  assert.doesNotMatch(financeService, /branchId:\s*dto\.branchId/);
});

test('finance transaction list and mutations remain company and branch scoped', () => {
  assert.match(financeService, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(financeService, /companyId: scope\.companyId,\s*branchId: scope\.branchId,\s*\.\.\.\(type/);
  assert.match(financeService, /scopedTransaction\(tx, user, scope, id\)/);
  assert.doesNotMatch(financeService, /findUnique\(\{ where: \{ id \} \}\)/);
});

test('finance tax and accounting posting retain token tenant context', () => {
  assert.match(financeService, /calculateTax\(tx, dto\.taxCodeId, dto\.amount, scope\.companyId, transactionDate, expectedTaxScopes\)/);
  assert.match(financeService, /companyId: scope\.companyId,\s*branchId: scope\.branchId,\s*eventType/);
  assert.match(financeService, /payload: \{\s*companyId: scope\.companyId,\s*branchId: scope\.branchId/);
});

test('finance idempotency is company scoped and rejects branch or payload reuse', () => {
  assert.match(financeService, /companyId_idempotencyKey: \{ companyId: scope\.companyId, idempotencyKey \}/);
  assert.match(financeService, /if \(existing\.branchId !== scope\.branchId\)/);
  assert.match(financeService, /Idempotency key sudah digunakan untuk transaksi keuangan dengan payload berbeda/);
  assert.match(financeService, /finance:\$\{scope\.companyId\}:\$\{scope\.branchId\}/);
});

test('finance lifecycle mutations are audited inside token company', () => {
  assert.match(financeService, /action: 'CREATE_FINANCE_TRANSACTION'/);
  assert.match(financeService, /action: 'APPROVE_FINANCE_TRANSACTION'/);
  assert.match(financeService, /action: 'POST_FINANCE_TRANSACTION'/);
  assert.match(financeService, /companyId: scope\.companyId,\s*userId: user\.sub/);
});

test('fiscal periods, bank statements, and reconciliations receive AuthUser', () => {
  assert.match(extensionsController, /fiscalPeriods\(user, companyId, branchId\)/);
  assert.match(extensionsController, /createFiscalPeriod\(dto, user\)/);
  assert.match(extensionsController, /bankStatements\(user, companyId, branchId\)/);
  assert.match(extensionsController, /importBankStatement\(dto, user\)/);
  assert.match(extensionsController, /reconciliations\(user, companyId, branchId\)/);
  assert.match(extensionsController, /createReconciliation\(dto, user\)/);
});

test('finance extension records and foreign statements are tenant scoped and audited', () => {
  assert.match(extensionsService, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(extensionsService, /where: \{ companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(extensionsService, /scopedBankStatement\(tx, user, scope, dto\.statementId\)/);
  assert.match(extensionsService, /action: 'CREATE_FISCAL_PERIOD'/);
  assert.match(extensionsService, /'CLOSE_FISCAL_PERIOD'/);
  assert.match(extensionsService, /Nama file bank statement wajib sebagai identitas idempoten/);
  assert.match(extensionsService, /source: dto\.source\.trim\(\)/);
  assert.match(extensionsService, /fileName: dto\.fileName\.trim\(\)/);
  assert.match(extensionsService, /'IMPORT_BANK_STATEMENT'/);
  assert.match(extensionsService, /'CREATE_BANK_RECONCILIATION'/);
});

test('finance extension legacy tenant fields are compatibility-only', () => {
  assert.match(extensionsDto, /export class CreateFiscalPeriodDto[\s\S]*companyId\?: string[\s\S]*branchId\?: string/);
  assert.match(extensionsDto, /export class ImportBankStatementDto[\s\S]*companyId\?: string[\s\S]*branchId\?: string/);
  assert.match(extensionsDto, /export class CreateReconciliationDto[\s\S]*companyId\?: string[\s\S]*branchId\?: string/);
  assert.doesNotMatch(financeExtensions, /companyId:\s*dto\.companyId/);
  assert.doesNotMatch(financeExtensions, /branchId:\s*dto\.branchId/);
});
