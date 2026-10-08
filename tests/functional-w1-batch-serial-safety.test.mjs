import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('apps/api/src/extensions/extensions.service.ts', 'utf8');
const dto = readFileSync('apps/api/src/extensions/dto/extensions.dto.ts', 'utf8');
const adminMaster = readFileSync('apps/admin/app/modules/master-data.tsx', 'utf8');
const adminOps = readFileSync('apps/admin/app/modules/operations.tsx', 'utf8');

test('batch manual hanya pre-registration zero quantity dan wajib trackBatch', () => {
  assert.match(service, /if \(!inventory\.product\.trackBatch\)/);
  assert.match(service, /\(dto\.quantity \?\? 0\) !== 0/);
  assert.match(service, /Kuantitas batch tidak boleh ditambah manual/);
  assert.match(service, /quantity: 0/);
  assert.match(dto, /Hanya 0 untuk pre-registration/);
});

test('serial manual wajib trackSerial dan tidak boleh melebihi stok fisik', () => {
  assert.match(service, /if \(!inventory\.product\.trackSerial\)/);
  assert.match(service, /physicalSerials >= inventory\.quantity/);
  assert.match(service, /status: \{ in: \['AVAILABLE', 'RESERVED', 'RETURNED', 'DAMAGED'\] \}/);
  assert.match(service, /Serial baru melebihi stok fisik produk/);
});

test('Admin exposes warehouse locations and traceability operations', () => {
  assert.match(adminMaster, /\/master-data\/warehouse-locations/);
  assert.match(adminOps, /\/inventory-batches/);
  assert.match(adminOps, /\/inventory-serials/);
});
