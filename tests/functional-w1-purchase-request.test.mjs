import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../apps/api/src/purchase-orders/purchase-requests.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/purchase-orders/purchase-requests.controller.ts', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../apps/api/src/purchase-orders/purchase-orders.module.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../apps/admin/app/page.tsx', import.meta.url), 'utf8');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma'].map((name) => readFileSync(new URL(`../apps/api/prisma/${name}`, import.meta.url), 'utf8'));

for (const schema of schemas) {
  test('purchase request schema is present and traceable to approval and purchase order', () => {
    assert.match(schema, /model PurchaseRequest\s*\{[\s\S]*approvalRequestId\s+String\?\s+@unique[\s\S]*purchaseOrderId\s+String\?\s+@unique/);
    assert.match(schema, /model PurchaseRequestItem\s*\{[\s\S]*quantity\s+Int[\s\S]*estimatedUnitCost\s+Decimal/);
  });
}

test('purchase request API implements controlled lifecycle and canonical approval', () => {
  assert.match(controller, /@Controller\('purchase-requests'\)/);
  assert.match(controller, /@Post\(':id\/submit'\)/);
  assert.match(controller, /@Post\(':id\/decision'\)/);
  assert.match(controller, /@Post\(':id\/convert'\)/);
  assert.match(service, /this\.platform\.createApprovalRequest/);
  assert.match(service, /status: 'SUBMITTING'/);
  assert.match(service, /entityType: 'PurchaseRequest', entityId: id, status: 'PENDING'/);
  assert.match(service, /this\.platform\.decideApproval/);
  assert.match(service, /\['DRAFT', 'SUBMITTING'\]\.includes\(request\.status\)/);
  assert.match(service, /request\.status !== 'APPROVED'/);
});

test('purchase request conversion is retry-safe and cannot create duplicate purchase orders', () => {
  assert.match(service, /idempotencyKey: `purchase-request:\$\{request\.id\}`/);
  assert.match(service, /status: 'CONVERTED'/);
  assert.match(service, /purchaseOrderId: order\.id/);
  assert.match(service, /request\.status === 'CONVERTED' && request\.purchaseOrderId/);
});

test('purchase request enforces tenant warehouse supplier and product scope', () => {
  assert.match(service, /branchId: scope\.branchId/);
  assert.match(service, /companyId: scope\.companyId/);
  assert.match(service, /Supplier tidak ditemukan pada company aktif/);
  assert.match(service, /produk tidak ditemukan pada company aktif/i);
});

test('purchase orders module wires purchase request service and canonical platform approval', () => {
  assert.match(moduleSource, /imports: \[PlatformModule\]/);
  assert.match(moduleSource, /PurchaseRequestsController/);
  assert.match(moduleSource, /PurchaseRequestsService/);
});

test('admin procurement surface can create submit decide and convert purchase requests', () => {
  assert.match(admin, /read<PurchaseRequest\[]>\('\/purchase-requests'/);
  assert.match(admin, /addPurchaseRequest/);
  assert.match(admin, /purchaseRequestAction/);
  assert.match(admin, /'submit' \| 'approve' \| 'reject' \| 'convert' \| 'cancel'/);
  assert.match(admin, /Requester tidak boleh menyetujui permintaannya sendiri/);
});

test('expand migrations exist for SQLite and PostgreSQL', () => {
  const sqlite = readFileSync(new URL('../database/migrations/T360-20260911-purchase-request/sqlite-expand.sql', import.meta.url), 'utf8');
  const postgres = readFileSync(new URL('../database/migrations/T360-20260911-purchase-request/postgresql-expand.sql', import.meta.url), 'utf8');
  assert.match(sqlite, /CREATE TABLE IF NOT EXISTS "PurchaseRequest"/);
  assert.match(sqlite, /PurchaseRequestItem/);
  assert.match(postgres, /CREATE TABLE IF NOT EXISTS "PurchaseRequest"/);
  assert.match(postgres, /PurchaseRequestItem/);
});
