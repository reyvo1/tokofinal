import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

function extractObjectAfter(source, marker, fromIndex = 0) {
  const markerIndex = source.indexOf(marker, fromIndex);
  assert.notEqual(markerIndex, -1, `Marker tidak ditemukan: ${marker}`);
  const openIndex = source.indexOf('{', markerIndex + marker.length);
  assert.notEqual(openIndex, -1, `Object setelah marker tidak ditemukan: ${marker}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  assert.fail(`Object setelah marker tidak tertutup: ${marker}`);
}

for (const schema of ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma']) {
  test(`F2 ProductVariant schema parity: ${schema}`,()=>{
    const s=read(schema);
    assert.match(s,/model ProductVariant \{/);
    assert.match(s,/productId\s+String/);
    assert.match(s,/@@unique\(\[productId, code\]\)/);
    assert.match(s,/variantId\s+String\?/);
    assert.match(s,/variant\s+ProductVariant\?/);
  });
}

test('F2 ProductVariant API exposes tenant-owned CRUD and variant-aware barcode/price',()=>{
  const controller=read('apps/api/src/master-data/master-data.controller.ts');
  const service=read('apps/api/src/master-data/master-data.service.ts');
  assert.match(controller,/products\/:productId\/variants/);
  assert.match(controller,/createVariant/);
  assert.match(controller,/updateVariant/);
  assert.match(service,/productVariant\.findFirst\(\{ where: \{ id: variantId, productId, product: \{ companyId:/);
  assert.match(service,/variantId: variant\?\.id \?\? null/);
  assert.match(service,/where: \{ productId, variantId: targetVariantId/);
});

test('F2 ProductVariant pricing resolver prefers variant then product fallback',()=>{
  const s=read('apps/api/src/common/product-pricing.ts');
  assert.match(s,/variantId\?: string \| null/);
  assert.match(s,/variantSalePrice/);
  assert.match(s,/variantScore/);
  assert.match(s,/variantSalePrice \?\? input\.product\.salePrice/);
});

test('F2 ProductVariant is searchable and returned in product catalog',()=>{
  const s=read('apps/api/src/products/products.service.ts');
  assert.match(s,/variants: \{ some:/);
  assert.match(s,/variants: \{ where: \{ isActive: true \}/);

  const listMethod = s.indexOf('async list(');
  const findOneMethod = s.indexOf('async findOne(');
  assert.notEqual(listMethod, -1);
  assert.notEqual(findOneMethod, -1);
  const listSource = s.slice(listMethod, findOneMethod);
  const findOneSource = s.slice(findOneMethod);
  for (const methodSource of [listSource, findOneSource]) {
    const relationInclude = extractObjectAfter(methodSource, 'include:');
    const barcodes = extractObjectAfter(relationInclude, 'barcodes:');
    assert.match(barcodes,/orderBy:/);
    assert.match(barcodes,/include:\s*\{[\s\S]*variant:\s*true/);
    assert.match(barcodes,/productUnit:\s*true/);
  }
});

test('F2 Admin manages variants and binds barcode/pricing to a variant',()=>{
  const s=read('apps/admin/app/modules/master-data.tsx');
  assert.match(s,/VARIANT PRODUK/);
  assert.match(s,/saveVariant/);
  assert.match(s,/toggleVariant/);
  assert.match(s,/variantId:barcode\.variantId\|\|undefined/);
  assert.match(s,/variantId:price\.variantId\|\|undefined/);
});

test('F2 ProductVariant expand migrations exist for SQLite and PostgreSQL',()=>{
  const sqlite=read('database/migrations/T360-20260923-product-variant/sqlite-expand.sql');
  const pg=read('database/migrations/T360-20260923-product-variant/postgresql-expand.sql');
  for(const s of [sqlite,pg]){
    assert.match(s,/ProductVariant/);
    assert.match(s,/variantId/);
    assert.match(s,/ProductBarcode/);
    assert.match(s,/ProductPrice/);
  }
});
