import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../apps/admin/app/modules/master-data.tsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/master-data/master-data.controller.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/api/src/master-data/master-data.service.ts', import.meta.url), 'utf8');

test('F3 INV-05B warehouse operator UI supports create edit and lifecycle', () => {
  assert.match(admin, /async function saveWarehouse\(/);
  assert.match(admin, /editingWarehouseId\?'PATCH':'POST'/);
  assert.match(admin, /function editWarehouse\(/);
  assert.match(admin, /async function toggleWarehouse\(/);
  assert.match(admin, />Edit<\/button>/);
  assert.match(admin, /\{x\.isActive\?'Nonaktifkan':'Aktifkan'\}/);
});

test('F3 INV-05B warehouse lifecycle remains tenant scoped in API', () => {
  assert.match(controller, /@Patch\('warehouses\/:id'\)/);
  assert.match(controller, /@Permissions\('master_data\.manage'\)/);
  assert.match(service, /async updateWarehouse\(id: string, dto: UpdateWarehouseDto, user: AuthUser\)/);
  assert.match(service, /const existing = await this\.warehouse\(this\.prisma, user, id\)/);
  assert.match(service, /await this\.branch\(this\.prisma, user, targetBranch\)/);
  assert.match(service, /isActive: dto\.isActive/);
});
