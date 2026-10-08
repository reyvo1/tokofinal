import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const schemas = ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);
const locationCore = read('apps/api/src/common/location-inventory.ts');
const service = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
const controller = read('apps/api/src/advanced-inventory/advanced-inventory.controller.ts');
const dto = read('apps/api/src/advanced-inventory/dto/advanced-inventory.dto.ts');
const admin = read('apps/admin/app/modules/operations.tsx');
const sqlite = read('database/migrations/T360-20260923-inventory-condition-ledger/sqlite-expand.sql');
const postgres = read('database/migrations/T360-20260923-inventory-condition-ledger/postgresql-expand.sql');

test('F3 condition schema is first-class and parity-safe', () => {
  for (const schema of schemas) {
    assert.match(schema, /enum InventoryCondition \{[\s\S]*AVAILABLE[\s\S]*DAMAGED[\s\S]*QUARANTINE[\s\S]*LOST[\s\S]*\}/);
    assert.match(schema, /model InventoryConditionBalance \{/);
    assert.match(schema, /@@unique\(\[locationId, productId, condition\]\)/);
    assert.match(schema, /model InventoryConditionMovement \{/);
  }
  assert.match(sqlite, /InventoryConditionBalance/);
  assert.match(postgres, /CREATE TYPE "InventoryCondition" AS ENUM/);
});

test('condition invariant is integrated with canonical location stock mutations', () => {
  assert.match(locationCore, /prepareConditionInventory/);
  assert.match(locationCore, /INVENTORY_CONDITION_DRIFT/);
  assert.match(locationCore, /INVENTORY_CONDITION_AVAILABLE_DRIFT/);
  assert.match(locationCore, /depositLocationStock[\s\S]*incrementAvailableCondition/);
  assert.match(locationCore, /consumeAvailableLocationStock[\s\S]*decrementAvailableCondition/);
  assert.match(locationCore, /consumeLocationReservations[\s\S]*decrementAvailableCondition/);
  assert.match(locationCore, /adjustLocationStock[\s\S]*decrementAvailableCondition/);
  assert.match(locationCore, /relocateLocationStock[\s\S]*decrementAvailableCondition[\s\S]*incrementAvailableCondition/);
});

test('condition API is tenant-scoped, permissioned, reservation-safe, audited and outboxed', () => {
  assert.match(dto, /MoveInventoryConditionDto/);
  assert.match(dto, /IsIn\(\['AVAILABLE','DAMAGED','QUARANTINE','LOST'\]\)/);
  assert.match(controller, /@Get\('condition-balances'\)[\s\S]*@Permissions\('inventory\.view'\)/);
  assert.match(controller, /@Post\('condition-movements'\)[\s\S]*@Permissions\('inventory\.adjust'\)/);
  assert.match(service, /warehouse\(this\.prisma, user, scope, dto\.warehouseId, 'branch', true\)/);
  assert.match(service, /free\.available < dto\.quantity/);
  assert.match(service, /InventoryConditionMovement/);
  assert.match(service, /MOVE_INVENTORY_CONDITION/);
  assert.match(service, /inventory\.condition\.moved/);
});

test('Admin exposes real condition balance and condition movement flow', () => {
  assert.match(admin, /CONDITION CONTROL/);
  assert.match(admin, /DAMAGED/);
  assert.match(admin, /QUARANTINE/);
  assert.match(admin, /LOST/);
  assert.match(admin, /\/advanced-inventory\/condition-balances/);
  assert.match(admin, /\/advanced-inventory\/condition-movements/);
  assert.match(admin, /Stok fisik tetap, sellable stock disesuaikan server/);
});
