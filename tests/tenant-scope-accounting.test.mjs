import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync('apps/api/src/accounting-core/accounting-core.controller.ts', 'utf8');
const service = readFileSync('apps/api/src/accounting-core/accounting-core.service.ts', 'utf8');
const dto = readFileSync('apps/api/src/accounting-core/dto/accounting-core.dto.ts', 'utf8');

test('accounting endpoints derive tenant context from authenticated user', () => {
  assert.match(controller, /@CurrentUser\(\) user: AuthUser/);
  assert.match(controller, /listEvents\(user, limit, cursor, companyId\)/);
  assert.match(controller, /createTaxCode\(dto, user\)/);
  assert.match(controller, /postManual\(dto, user\)/);
  assert.match(service, /TENANT_CONTEXT_REQUIRED/);
  assert.match(service, /TENANT_ACCESS_DENIED/);
});

test('accounting event list is company and branch scoped', () => {
  assert.match(service, /companyId: scope\.companyId/);
  assert.match(service, /branchId: scope\.branchId/);
  assert.match(service, /assertRequestedScope\(this\.prisma, user, scope, requestedCompanyId\)/);
});

test('tax codes and posting rules use token company instead of dto company', () => {
  assert.match(service, /companyId_code_version: \{ companyId: scope\.companyId, code/);
  assert.match(service, /companyId_code_version: \{ companyId: scope\.companyId, code: dto\.code/);
  assert.doesNotMatch(service, /companyId_code: \{ companyId: dto\.companyId/);
  assert.doesNotMatch(service, /companyId_code_version: \{ companyId: dto\.companyId/);
  assert.match(dto, /companyId\?: string/);
});

test('tax preview and manual tax lines are company scoped', () => {
  assert.match(service, /calculateTax\(this\.prisma, taxCodeId, amount, scope\.companyId\)/);
  assert.match(service, /where: \{ id: \{ in: taxCodeIds \}, companyId: scope\.companyId \}/);
  assert.match(service, /denyTenantAccess\(tx, user, scope, 'TaxCode'/);
});

test('manual accounting event uses token branch and preserves idempotency identity', () => {
  assert.match(service, /companyId: scope\.companyId, branchId: scope\.branchId, eventType: dto\.eventType/);
  assert.match(service, /existing\.branchId !== scope\.branchId/);
  assert.match(service, /Idempotency key sudah digunakan untuk event atau branch yang berbeda/);
  assert.match(service, /POST_MANUAL_ACCOUNTING_EVENT/);
});

test('cross-tenant attempts and accounting mutations are audited', () => {
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(service, /action: 'UPSERT_TAX_CODE'/);
  assert.match(service, /action: 'UPSERT_ACCOUNTING_POSTING_RULE'/);
});
