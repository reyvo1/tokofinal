import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(new URL(`../${p}`, import.meta.url),'utf8');
const schemas=['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma'].map(n=>read(`apps/api/prisma/${n}`));
const dto=read('apps/api/src/master-data/dto/master-data.dto.ts');
const controller=read('apps/api/src/master-data/master-data.controller.ts');
const service=read('apps/api/src/master-data/master-data.service.ts');
const admin=read('apps/admin/app/modules/master-data.tsx');
const sqlite=read('database/migrations/T360-20260923-product-multi-uom/sqlite-expand.sql');
const postgres=read('database/migrations/T360-20260923-product-multi-uom/postgresql-expand.sql');

test('ProductUnit is first-class with SQLite/PostgreSQL schema parity',()=>{
  for(const schema of schemas){
    assert.match(schema,/model ProductUnit \{[\s\S]*scopeKey\s+String[\s\S]*unitCode\s+String[\s\S]*quantityFactor\s+Int[\s\S]*isDefaultSale\s+Boolean[\s\S]*isDefaultPurchase\s+Boolean[\s\S]*@@unique\(\[productId, scopeKey, unitCode\]\)/);
    assert.match(schema,/model ProductBarcode \{[\s\S]*productUnitId\s+String\?/);
    assert.match(schema,/model ProductPrice \{[\s\S]*productUnitId\s+String\?/);
  }
  for(const migration of [sqlite,postgres]){assert.match(migration,/ProductUnit/);assert.match(migration,/productUnitId/);assert.match(migration,/quantityFactor/);}
});

test('Multi-UOM DTO requires safe integer alternative factor',()=>{
  assert.match(dto,/class CreateProductUnitDto/);
  assert.match(dto,/@IsInt\(\) @Min\(2\) quantityFactor/);
  assert.match(dto,/isDefaultSale/); assert.match(dto,/isDefaultPurchase/);
});

test('Multi-UOM API exposes tenant-scoped lifecycle endpoints',()=>{
  assert.match(controller,/@Get\('products\/:productId\/units'\)/);
  assert.match(controller,/@Post\('products\/:productId\/units'\)/);
  assert.match(controller,/@Patch\('products\/:productId\/units\/:id'\)/);
  assert.match(service,/product: \{ companyId: this\.scope\(user\)\.companyId \}/);
  assert.match(service,/CREATE_PRODUCT_UNIT/); assert.match(service,/UPDATE_PRODUCT_UNIT/);
});

test('ProductUnit is authoritative for barcode and price snapshots',()=>{
  assert.match(service,/requestedUnit[\s\S]*unitCode: requestedUnit\.unitCode[\s\S]*quantityFactor: requestedUnit\.quantityFactor/);
  assert.match(service,/productUnitId: requestedUnit\?\.id \?\? null/);
  assert.match(service,/productBarcode\.updateMany\([\s\S]*productUnitId: id[\s\S]*quantityFactor:/);
  assert.match(service,/productPrice\.updateMany\([\s\S]*productUnitId: id[\s\S]*unitCode:/);
});

test('Admin exposes first-class Multi-UOM operator flow and binds barcode/pricing to it',()=>{
  assert.match(admin,/eyebrow="MULTI-UOM"/);
  assert.match(admin,/Satuan & Kemasan Produk/);
  assert.match(admin,/Default penjualan/); assert.match(admin,/Default pembelian/);
  assert.match(admin,/productUnitId:barcode\.productUnitId/);
  assert.match(admin,/productUnitId:price\.productUnitId/);
});
