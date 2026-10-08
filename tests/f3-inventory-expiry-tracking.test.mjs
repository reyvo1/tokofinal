import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('F3 expiry tracking is first-class and requires batch semantics', () => {
  for (const file of ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma']) {
    const schema = read(file);
    assert.match(schema, /trackBatch\s+Boolean\s+@default\(false\)[\s\S]*trackExpiry\s+Boolean\s+@default\(false\)/);
  }
  const dto = read('apps/api/src/products/dto/create-product.dto.ts');
  const service = read('apps/api/src/products/products.service.ts');
  assert.match(dto, /trackExpiry\?: boolean/);
  assert.match(service, /dto\.trackExpiry && !dto\.trackBatch/);
  assert.match(service, /nextTrackExpiry && !nextTrackBatch/);
});

test('F3 goods receipt fails closed for missing or expired traceability data', () => {
  const service = read('apps/api/src/goods-receipts/goods-receipts.service.ts');
  assert.match(service, /poItem\.product\.trackBatch && !batchNumber/);
  assert.match(service, /poItem\.product\.trackExpiry/);
  assert.match(service, /Tanggal kedaluwarsa wajib/);
  assert.match(service, /expiryDate <= new Date\(\)/);
  assert.match(service, /Tanggal kedaluwarsa batch .* berbeda dari batch yang sudah terdaftar/);
});

test('F3 fulfillment uses FEFO and never consumes expired batches', () => {
  const service = read('apps/api/src/orders/orders.service.ts');
  assert.match(service, /expiryDate: \{ gt: now \}/);
  assert.match(service, /const batches = \[\.\.\.expiringBatches, \.\.\.nonExpiringBatches\]/);
  assert.match(service, /orderBy: \[\{ expiryDate: 'asc' \}, \{ createdAt: 'asc' \}\]/);
});

test('F3 batch pre-registration and operator UI enforce expiry configuration', () => {
  const ext = read('apps/api/src/extensions/extensions.service.ts');
  const master = read('apps/admin/app/modules/master-data.tsx');
  const ops = read('apps/admin/app/modules/operations.tsx');
  assert.match(ext, /inventory\.product\.trackExpiry && !expiryDate/);
  assert.match(ext, /Batch yang sudah kedaluwarsa tidak boleh dipraregistrasi/);
  assert.match(master, /Expiry wajib per batch/);
  assert.match(ops, /required=\{Boolean\(productById\.get\(batchForm\.productId\)\?\.trackExpiry\)\}/);
  assert.match(ops, /expired\?'EXPIRED':'ACTIVE'/);
});

test('F3 expiry migration keeps SQLite and PostgreSQL parity', () => {
  const sqlite = read('database/migrations/T360-20260923-inventory-expiry-tracking/sqlite-expand.sql');
  const pg = read('database/migrations/T360-20260923-inventory-expiry-tracking/postgresql-expand.sql');
  assert.match(sqlite, /trackExpiry/);
  assert.match(pg, /trackExpiry/);
  assert.match(pg, /IF NOT EXISTS/);
});
