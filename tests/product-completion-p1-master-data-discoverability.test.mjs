import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const mapping = JSON.parse(read('config/admin-contextual-workflow-map.json'));
const domain = read('apps/admin/app/domain-workspaces.ts');
const master = read('apps/admin/app/modules/master-data.tsx');

test('P1 separates category hierarchy and customer into distinct contextual destinations', () => {
  const keys = new Set(mapping.rows.map((row) => `${row.workspace}/${row.view}`));
  assert.ok(keys.has('master-data/catalog'));
  assert.ok(keys.has('master-data/customers'));
  assert.ok(mapping.expectedContextualViews >= 62, 'P1 62-route baseline is a regression floor; later phases may add canonical destinations');
  assert.match(domain, /key: 'catalog', label: 'Kategori & Subkategori'/);
  assert.match(domain, /key: 'customers', label: 'Customer'/);
  assert.doesNotMatch(domain, /label: 'Kategori & Customer'/);
  assert.match(master, /mode==='catalog'/);
  assert.match(master, /mode==='customers'/);
});

test('P1 category operator flow exposes explicit hierarchy actions instead of a hidden generic form', () => {
  for (const token of [
    'Tambah kategori utama',
    'Tambah subkategori',
    'Simpan subkategori',
    'Root / kategori utama',
    'Urutan dalam parent',
    'orderedCategoryRows',
    'categoryTreeRows',
    'categoryProductCount',
  ]) assert.ok(master.includes(token), `missing category hierarchy UX token: ${token}`);
});

test('P1 customer workflow is not rendered inside category-only contextual surface', () => {
  const catalogStart = master.indexOf("mode==='catalog'");
  const customerStart = master.indexOf("mode==='customers'");
  assert.ok(catalogStart >= 0 && customerStart > catalogStart);
  const catalogBlock = master.slice(catalogStart, customerStart);
  assert.doesNotMatch(catalogBlock, /Customer Master/);
  assert.match(master.slice(customerStart), /Customer Master/);
});
