import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sales = read('apps/api/src/sales/sales.service.ts');
const transactionUom = read('apps/api/src/common/transaction-uom.ts');
const dto = read('apps/api/src/sales/dto/create-sale.dto.ts');
const masterDto = read('apps/api/src/master-data/dto/master-data.dto.ts');
const master = read('apps/api/src/master-data/master-data.service.ts');
const pricing = read('apps/api/src/common/product-pricing.ts');
const pos = read('apps/pos/app/page.tsx');
const admin = read('apps/admin/app/modules/master-data.tsx');
const sqliteMigration = read('database/migrations/T360-20260911-unit-conversion/sqlite-expand.sql');
const pgMigration = read('database/migrations/T360-20260911-unit-conversion/postgresql-expand.sql');
const schemas = ['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma'].map((name)=>read(`apps/api/prisma/${name}`));

test('selling-unit conversion is traceable in every SaleItem schema and additive migrations', () => {
  for (const schema of schemas) {
    assert.match(schema, /model SaleItem[\s\S]*unitCode\s+String\?[\s\S]*unitQuantity\s+Int\?[\s\S]*quantityFactor\s+Int\s+@default\(1\)[\s\S]*sourceBarcode\s+String\?/);
  }
  for (const migration of [sqliteMigration, pgMigration]) {
    assert.match(migration, /unitCode/); assert.match(migration, /unitQuantity/); assert.match(migration, /quantityFactor/); assert.match(migration, /sourceBarcode/);
  }
});

test('barcode conversion is integer-base-stock safe and primary barcode remains one base unit', () => {
  assert.match(masterDto, /quantityFactor\?: number/);
  assert.match(masterDto, /@IsInt\(\) @Min\(1\) quantityFactor/);
  assert.match(master, /Number\.isSafeInteger\(factor\)/);
  assert.match(master, /Barcode utama wajib mewakili 1 base unit produk/);
  assert.match(master, /quantityFactor > 1 wajib memakai unitCode berbeda/);
});

test('sale DTO sends barcode identity and server resolves conversion authoritatively', () => {
  assert.match(dto, /barcodeCode\?: string/);
  assert.match(sales, /resolveSellingUnitLine/);
  assert.match(transactionUom, /productBarcode\.findUnique\(\{[\s\S]*where: \{ code: sourceBarcode \}/);
  assert.match(transactionUom, /barcode\.productId !== product\.id/);
  assert.match(transactionUom, /baseQuantity = unitQuantity \* quantityFactor/);
  assert.match(sales, /quantity: item\.conversion\.baseQuantity/);
  assert.match(sales, /sourceBarcode: item\.conversion\.sourceBarcode/);
});

test('unit-specific pricing falls back to factor-scaled base price instead of undercharging packages', () => {
  assert.match(pricing, /unitFactor\?: number/);
  assert.match(pricing, /!rows\[0\]\.unitCode && unit/);
  assert.match(pricing, /return selected\.mul\(factor\)/);
  assert.match(transactionUom, /packageFallback = new Prisma\.Decimal\(variantSalePrice \?\? product\.salePrice\)\.mul\(quantityFactor\)/);
  assert.match(sales, /sellingUnitPrice\.mul\(conversion\.unitQuantity\)/);
});

test('POS keeps package quantity separate from base stock and blocks unsafe offline package sales', () => {
  assert.match(pos, /type CartItem = \{ product: Product; quantity: number; unitCode: string; quantityFactor: number; productUnitId\?: string; variantId\?: string; barcodeCode\?: string \}/);
  assert.match(pos, /usedOtherBase/);
  assert.match(pos, /Math\.floor\(\(stock - usedOtherBase\) \/ factor\)/);
  assert.match(pos, /barcodeCode: item\.barcodeCode/);
  assert.match(pos, /Penjualan unit\/kemasan hasil scan membutuhkan server online/);
  assert.match(pos, /serverLine\?\.sellingUnitPrice/);
});

test('Admin exposes unit conversion and unit-specific authoritative pricing', () => {
  assert.match(admin, /Barcode & Konversi Unit/);
  assert.match(admin, /Isi per unit/);
  assert.match(admin, /unitCode:barcode\.unitCode/);
  assert.match(admin, /Harga Cabang \/ Segmen \/ Unit \/ Kuantitas/);
  assert.match(admin, /Harga per unit jual/);
  assert.match(master, /Harga unit \$\{unitCode\} membutuhkan barcode\/konversi aktif/);
});
