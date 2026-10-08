import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('apps/api/src/advanced-inventory/advanced-inventory.service.ts', 'utf8');
const dto = readFileSync('apps/api/src/advanced-inventory/dto/advanced-inventory.dto.ts', 'utf8');
const controller = readFileSync('apps/api/src/advanced-inventory/advanced-inventory.controller.ts', 'utf8');
const admin = readFileSync('apps/admin/app/modules/operations.tsx', 'utf8');
const sqlite = readFileSync('apps/api/prisma/schema.sqlite.prisma', 'utf8');
const postgres = readFileSync('apps/api/prisma/schema.postgresql.prisma', 'utf8');

test('F3 transfer requires canonical batch and serial manifests', () => {
  assert.match(dto, /serialNumbers\?: string\[\]/);
  assert.match(service, /Batch wajib untuk transfer produk/);
  assert.match(service, /Jumlah serial transfer .* harus sama dengan quantity/);
  assert.match(service, /inventoryBatch\.updateMany/);
  assert.match(service, /status: 'IN_TRANSIT'/);
  assert.match(service, /status: 'AVAILABLE'.*referenceType: 'StockTransferReceipt'/s);
});

test('F3 serial transfer has SQLite/PostgreSQL schema parity', () => {
  assert.match(sqlite, /enum SerialStatus[\s\S]*IN_TRANSIT/);
  assert.match(postgres, /enum SerialStatus[\s\S]*IN_TRANSIT/);
  assert.match(sqlite, /model StockTransferItem[\s\S]*serialNumbers\s+Json\?/);
  assert.match(postgres, /model StockTransferItem[\s\S]*serialNumbers\s+Json\?/);
});

test('F3 stock opname snapshots and adjusts tracked batches', () => {
  assert.match(service, /BATCH_INVENTORY_DRIFT/);
  assert.match(service, /snapshotItems\.push\(\.\.\.batches\.map/);
  assert.match(service, /if \(item\.batchNumber\)/);
  assert.match(service, /Stok bebas batch .* tidak cukup untuk adjustment opname/);
});

test('F3 exposes derived in-transit and reorder visibility to operators', () => {
  assert.match(controller, /Get\('transit-balances'\)/);
  assert.match(controller, /Get\('reorder-visibility'\)/);
  assert.match(service, /condition: 'IN_TRANSIT'/);
  assert.match(service, /projectedAvailable = row\.available \+ inboundInTransit/);
  assert.match(admin, /title="Stok Dalam Perjalanan"/);
  assert.match(admin, /title="Minimum Stok & Reorder Visibility"/);
});

test('F3 Admin transfer flow captures batch and serial data', () => {
  assert.match(admin, /Produk ini memakai batch; pilih nomor batch/);
  assert.match(admin, /serialText\.split/);
  assert.match(admin, /batchNumber: transferForm\.batchNumber\.trim\(\)/);
  assert.match(admin, /serialNumbers: serialNumbers\.length/);
  assert.match(admin, /batch \$\{item\.batchNumber\}/);
});
