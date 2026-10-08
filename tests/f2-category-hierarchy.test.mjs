import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('F2 category schema supports tenant hierarchy lifecycle in SQLite and PostgreSQL', async () => {
  for (const path of ['apps/api/prisma/schema.sqlite.prisma', 'apps/api/prisma/schema.postgresql.prisma', 'apps/api/prisma/schema.prisma']) {
    const schema = await read(path);
    assert.match(schema, /model Category \{[\s\S]*parentId\s+String\?/);
    assert.match(schema, /parent\s+Category\?\s+@relation\("CategoryHierarchy"/);
    assert.match(schema, /children\s+Category\[\]\s+@relation\("CategoryHierarchy"\)/);
    assert.match(schema, /isActive\s+Boolean\s+@default\(true\)/);
    assert.match(schema, /sortOrder\s+Int\s+@default\(0\)/);
    assert.match(schema, /@@unique\(\[companyId, slug\]\)/);
  }
});

test('F2 category API validates tenant parent, cycles and deactivation dependencies', async () => {
  const dto = await read('apps/api/src/master-data/dto/master-data.dto.ts');
  const service = await read('apps/api/src/master-data/master-data.service.ts');
  for (const token of ['parentId', 'sortOrder', 'isActive']) assert.ok(dto.includes(token), `category DTO missing ${token}`);
  assert.match(service, /assertCategoryParent/);
  assert.match(service, /Hierarchy kategori membentuk siklus/);
  assert.match(service, /Parent kategori tidak ditemukan pada perusahaan ini/);
  assert.match(service, /Nonaktifkan subkategori aktif terlebih dahulu/);
  assert.match(service, /Kategori masih digunakan produk aktif/);
  assert.match(service, /Nama kategori sudah digunakan pada level hierarchy yang sama/);
});

test('F2 category operator UI provides create edit parent and lifecycle actions', async () => {
  const admin = await read('apps/admin/app/modules/master-data.tsx');
  assert.match(admin, /Kategori & Subkategori/);
  assert.match(admin, /Parent kategori/);
  assert.match(admin, /Root \/ kategori utama/);
  assert.match(admin, /saveCategory/);
  assert.match(admin, /editCategory/);
  assert.match(admin, /toggleCategory/);
  assert.match(admin, /Tambah kategori utama/);
  assert.match(admin, /Tambah subkategori/);
  assert.match(admin, /orderedCategoryRows/);
  assert.match(admin, /categoryTreeRows/);
  assert.match(admin, /Simpan perubahan/);
  assert.match(admin, /Nonaktifkan/);
  assert.match(admin, /categories\.filter\(x=>x\.isActive/);
});

test('F2 category migration keeps SQLite PostgreSQL parity and tenant slug uniqueness', async () => {
  const sqlite = await read('database/migrations/T360-20260923-category-hierarchy/sqlite-expand.sql');
  const postgres = await read('database/migrations/T360-20260923-category-hierarchy/postgresql-expand.sql');
  for (const sql of [sqlite, postgres]) {
    assert.match(sql, /parentId/);
    assert.match(sql, /sortOrder/);
    assert.match(sql, /isActive/);
    assert.match(sql, /Category_companyId_slug_key/);
    assert.match(sql, /Category_companyId_parentId_isActive_sortOrder_name_idx/);
  }
});
