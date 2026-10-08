import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const service = read('apps/api/src/assets/assets.service.ts');
const dto = read('apps/api/src/assets/dto/assets.dto.ts');
const schemas = ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);

test('W5 serial lifecycle has a dedicated CONSUMED state in every profile', () => {
  for (const schema of schemas) assert.match(schema, /enum SerialStatus \{[\s\S]*CONSUMED/);
});

test('maintenance part DTO accepts explicit serial ids', () => {
  assert.match(dto, /serialIds\?: string\[\]/);
  assert.match(dto, /@IsString\(\{ each: true \}\)/);
});

test('maintenance serial consumption requires exact unique quantity and AVAILABLE ownership', () => {
  assert.match(service, /new Set\(\(part\.serialIds \?\? \[\]\)/);
  assert.match(service, /serialIds\.length !== part\.quantity/);
  assert.match(service, /inventorySerial\.findMany\([\s\S]*status: 'AVAILABLE'/);
  assert.match(service, /warehouseId: part\.warehouseId, productId: part\.productId/);
});

test('maintenance serial consumption uses atomic compare-and-update and traces work order', () => {
  assert.match(service, /inventorySerial\.updateMany/);
  assert.match(service, /status: 'CONSUMED'/);
  assert.match(service, /referenceType: 'MaintenanceWorkOrder'/);
  assert.match(service, /serialUpdate\.count !== part\.quantity/);
  assert.match(service, /serialIds, quantity: part\.quantity/);
});

test('PostgreSQL deployment has expand migration for new serial state', () => {
  const migration = read('database/migrations/T360-20260911-maintenance-serial-consumption/postgresql-expand.sql');
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'CONSUMED'/);
});
