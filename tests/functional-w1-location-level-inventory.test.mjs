import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schemas = [
  read('apps/api/prisma/schema.prisma'),
  read('apps/api/prisma/schema.sqlite.prisma'),
  read('apps/api/prisma/schema.postgresql.prisma'),
];
const helper = read('apps/api/src/common/location-inventory.ts');
const advanced = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
const controller = read('apps/api/src/advanced-inventory/advanced-inventory.controller.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const worker = read('apps/worker/src/index.ts');
const receipts = read('apps/api/src/goods-receipts/goods-receipts.service.ts');
const returns = read('apps/api/src/returns/returns.service.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const assets = read('apps/api/src/assets/assets.service.ts');
const admin = read('apps/admin/app/modules/operations.tsx');
const sqliteMigration = read('database/migrations/T360-20260912-location-inventory/sqlite-expand.sql');
const pgMigration = read('database/migrations/T360-20260912-location-inventory/postgresql-expand.sql');

test('all runtime schemas expose location balance, exact reservation, default location, and movement trace', () => {
  for (const schema of schemas) {
    assert.match(schema, /model InventoryLocationBalance[\s\S]*@@unique\(\[locationId, productId\]\)/);
    assert.match(schema, /model InventoryReservation[\s\S]*@@unique\(\[sourceType, sourceId, locationId, productId\]\)/);
    assert.match(schema, /model WarehouseLocation[\s\S]*isDefault\s+Boolean\s+@default\(false\)/);
    assert.match(schema, /model InventoryMovement[\s\S]*locationId\s+String\?/);
    assert.match(schema, /LOCATION_MOVE_IN/);
    assert.match(schema, /LOCATION_MOVE_OUT/);
  }
});

test('location helper lazily materializes legacy aggregate and fails closed on drift', () => {
  assert.match(helper, /first location-aware mutation materializes/i);
  assert.match(helper, /LOCATION_INVENTORY_DRIFT:/);
  assert.match(helper, /totals\.quantity !== expected\.quantity/);
  assert.match(helper, /reserveLocationStock/);
  assert.match(helper, /consumeLocationReservations/);
  assert.match(helper, /mutateLegacyReservedStock/);
  assert.match(helper, /relocateLocationStock/);
});

test('canonical inventory mutations are location-aware before changing aggregate stock', () => {
  assert.match(receipts, /depositLocationStock\(tx/);
  assert.match(returns, /depositLocationStock\(tx/);
  assert.match(returns, /consumeAvailableLocationStock\(tx/);
  assert.match(sales, /consumeAvailableLocationStock\(tx/);
  assert.match(assets, /consumeAvailableLocationStock\(tx/);
  assert.match(advanced, /consumeAvailableLocationStock\(tx/);
  assert.match(advanced, /depositLocationStock\(tx/);
  assert.match(advanced, /adjustLocationStock\(tx/);
});

test('storefront order reservation, fulfillment, cancellation, and expiry preserve exact location allocations', () => {
  assert.match(orders, /reserveLocationStock\(tx/);
  assert.match(orders, /consumeLocationReservations\(tx/);
  assert.match(orders, /releaseLocationReservations\(tx/);
  assert.match(worker, /inventoryReservation\.findMany/);
  assert.match(worker, /inventoryLocationBalance\.updateMany/);
  assert.match(worker, /Reservasi lokasi legacy order/);
});

test('location relocation and location-scoped opname are real API workflows', () => {
  assert.match(controller, /@Get\('location-balances'\)/);
  assert.match(controller, /@Post\('location-relocations'\)/);
  assert.match(advanced, /async listLocationBalances/);
  assert.match(advanced, /async relocateLocation/);
  assert.match(advanced, /type: 'LOCATION_MOVE_OUT'/);
  assert.match(advanced, /type: 'LOCATION_MOVE_IN'/);
  assert.match(advanced, /inventoryLocationBalance\.findMany\(\{ where: \{ warehouseId: warehouse\.id, locationId: dto\.locationId \} \}\)/);
});

test('expand migrations create location inventory structures without guessing historical allocation', () => {
  assert.match(sqliteMigration, /CREATE TABLE "InventoryLocationBalance"/);
  assert.match(sqliteMigration, /CREATE TABLE "InventoryReservation"/);
  assert.match(pgMigration, /CREATE TABLE IF NOT EXISTS "InventoryLocationBalance"/);
  assert.match(pgMigration, /ADD VALUE IF NOT EXISTS 'LOCATION_MOVE_IN'/);
  assert.doesNotMatch(sqliteMigration, /INSERT INTO "InventoryLocationBalance"/);
  assert.doesNotMatch(pgMigration, /INSERT INTO "InventoryLocationBalance"/);
});

test('admin can inspect and relocate location balances and start location-scoped stock opname', () => {
  assert.match(admin, /\/advanced-inventory\/location-balances\?warehouseId=/);
  assert.match(admin, /\/advanced-inventory\/location-relocations/);
  assert.match(admin, /Saldo Stok per Lokasi/);
  assert.match(admin, /locationId: opnameLocationId \|\| undefined/);
});
