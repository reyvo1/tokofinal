import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const controller = fs.readFileSync('apps/api/src/reports/reports.controller.ts', 'utf8');
const service = fs.readFileSync('apps/api/src/reports/reports.service.ts', 'utf8');
const dto = fs.readFileSync('apps/api/src/reports/dto/create-report-job.dto.ts', 'utf8');

test('every report endpoint receives authenticated tenant context', () => {
  for (const method of ['dashboard', 'profitLoss', 'inventoryValuation', 'createJob', 'listJobs']) {
    assert.match(controller, new RegExp(`${method}\\([^;]*user`, 's'));
  }
  assert.match(controller, /@CurrentUser\(\) user: AuthUser/g);
});

test('report service requires company and branch and audits cross-tenant access', () => {
  assert.match(service, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(service, /assertRequestedScope\(this\.prisma, user, scope/);
  assert.match(service, /where: \{ id: scope\.branchId, companyId: scope\.companyId \}/);
});

test('dashboard scopes sales orders inventory and receipts to token branch', () => {
  assert.match(service, /async dashboard\(user: AuthUser\)/);
  assert.match(service, /branchId: scope\.branchId,[\s\S]*branch: \{ companyId: scope\.companyId \}/);
  assert.match(service, /companyId: scope\.companyId, warehouseId: \{ in: warehouseIds \}/);
  assert.match(service, /inventory\.aggregate\(\{[\s\S]*warehouseId: \{ in: warehouseIds \}/);
  assert.match(service, /goodsReceipt\.findMany\(\{[\s\S]*warehouseId: \{ in: warehouseIds \}/);
});

test('profit and loss only groups accounts in token company and branch', () => {
  assert.match(service, /entityType = 'Report'/);
  assert.match(service, /account: \{ branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \} \}/);
  assert.match(service, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId,[\s\S]*netProfit/);
});

test('inventory valuation validates requested warehouse inside token tenant', () => {
  assert.match(service, /branchWarehouseIds\(this\.prisma, user, scope\)/);
  assert.match(service, /id: warehouseId,[\s\S]*branchId: scope\.branchId,[\s\S]*branch: \{ companyId: scope\.companyId \}/);
  assert.match(service, /if \(!warehouse\) return this\.denyTenantAccess\(this\.prisma, user, scope, 'Warehouse', warehouseId\)/);
  assert.match(service, /warehouseId: \{ in: warehouseIds \}/);
});

test('report jobs derive tenant envelope and requester from token', () => {
  assert.match(service, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId,[\s\S]*requestedById: user\.sub/);
  assert.match(service, /where: \{[\s\S]*companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId/);
  assert.match(service, /action: 'CREATE_REPORT_JOB'/);
  assert.doesNotMatch(service, /companyId:\s*dto\.companyId/);
  assert.doesNotMatch(service, /branchId:\s*dto\.branchId/);
});

test('legacy report tenant fields are compatibility-only', () => {
  assert.match(dto, /Kompatibilitas lama; company tetap berasal dari token\./);
  assert.match(dto, /Kompatibilitas lama; branch tetap berasal dari token\./);
  assert.match(dto, /companyId\?: string/);
  assert.match(dto, /branchId\?: string/);
  assert.doesNotMatch(dto, /companyId!:\s*string/);
  assert.doesNotMatch(dto, /branchId!:\s*string/);
});
