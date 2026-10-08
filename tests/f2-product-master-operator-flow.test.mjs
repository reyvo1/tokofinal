import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('F2 product master exposes real create edit lifecycle operator flow', async () => {
  const admin = await read('apps/admin/app/modules/master-data.tsx');
  assert.match(admin, /MASTER PRODUK/);
  assert.match(admin, /Tambah Barang/);
  assert.match(admin, /\/products\?limit=100&includeInactive=true/);
  assert.match(admin, /method:editingProductId\?'PATCH':'POST'/);
  assert.match(admin, /Edit produk/);
  assert.match(admin, /Nonaktifkan/);
  assert.match(admin, /Aktifkan produk/);
  assert.match(admin, /Simpan perubahan/);
});

test('F2 product master exposes tax and inventory tracking configuration', async () => {
  const admin = await read('apps/admin/app/modules/master-data.tsx');
  const dto = await read('apps/api/src/products/dto/create-product.dto.ts');
  const service = await read('apps/api/src/products/products.service.ts');
  for (const token of ['taxCategoryCode', 'trackBatch', 'trackSerial', 'allowNegativeStock']) {
    assert.ok(admin.includes(token), `admin missing ${token}`);
    assert.ok(dto.includes(token), `dto missing ${token}`);
    assert.ok(service.includes(token), `service missing ${token}`);
  }
  assert.match(admin, /Tax category/);
  assert.match(admin, /Track batch/);
  assert.match(admin, /Serial tracking/);
  assert.match(admin, /Negative stock/);
});

test('F2 inactive product visibility is admin-only and public catalog remains active-only', async () => {
  const controller = await read('apps/api/src/products/products.controller.ts');
  const service = await read('apps/api/src/products/products.service.ts');
  assert.match(controller, /@Query\('includeInactive'\) includeInactive\?: string/);
  assert.match(service, /canManageProducts/);
  assert.match(service, /\['SUPER_ADMIN', 'OWNER', 'ADMIN'\]/);
  assert.match(service, /includeInactiveValue === 'true' && canManageProducts/);
  assert.match(service, /\.\.\.\(includeInactive \? \{\} : \{ isActive: true \}\)/);
});

test('F2 product update persists editable SKU tax and tracking fields', async () => {
  const service = await read('apps/api/src/products/products.service.ts');
  for (const token of ['dto.sku', 'dto.productType', 'dto.taxCategoryCode', 'dto.salesTaxCodeId', 'dto.purchaseTaxCodeId', 'dto.trackBatch', 'dto.trackSerial', 'dto.allowNegativeStock']) {
    assert.ok(service.includes(token), `update service missing ${token}`);
  }
});
