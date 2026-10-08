import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(p,'utf8');
const schemas=['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);
const masterController=read('apps/api/src/master-data/master-data.controller.ts');
const masterService=read('apps/api/src/master-data/master-data.service.ts');
const pricing=read('apps/api/src/common/product-pricing.ts');
const sales=read('apps/api/src/sales/sales.service.ts');
const products=read('apps/api/src/products/products.service.ts');
const guard=read('apps/api/src/auth/jwt-auth.guard.ts');
const apiKeys=read('apps/api/src/auth/api-keys.service.ts');
const apiController=read('apps/api/src/auth/api-keys.controller.ts');
const rolesGuard=read('apps/api/src/auth/roles.guard.ts');
const pos=read('apps/pos/app/page.tsx');
const store=read('apps/storefront/app/page.tsx');
const admin=read('apps/admin/app/page.tsx');
const backfill=read('scripts/backfill-master-ownership.mjs');
function models(s){return [...s.matchAll(/^model\s+(\w+)/gm)].map(m=>m[1]);}

test('W1 schemas keep parity for master references, multi-barcode and product pricing',()=>{
 for(const schema of schemas){
  for(const m of ['MasterReference','ProductBarcode','ProductPrice']) assert.ok(models(schema).includes(m),`${m} missing`);
  assert.match(schema,/model Customer \{[\s\S]*companyId String\?/);
  assert.match(schema,/model Category \{[\s\S]*companyId String\?/);
 }
 assert.deepEqual(models(schemas[0]),models(schemas[1]));
 assert.deepEqual(models(schemas[1]),models(schemas[2]));
});

test('W1 master data exposes executable CRUD surfaces for required operational masters',()=>{
 for(const path of ['categories','customers','branches','warehouses','warehouse-locations','references']) assert.match(masterController,new RegExp(`['\"]${path}`));
 assert.match(masterController,/products\/:productId\/barcodes/);
 assert.match(masterController,/products\/:productId\/prices/);
 assert.match(masterService,/CREATE_MASTER_REFERENCE/);
 assert.match(masterService,/CREATE_PRODUCT_BARCODE/);
 assert.match(masterService,/CREATE_PRODUCT_PRICE/);
 assert.match(admin,/MasterDataView/);
});

test('customer and category ownership migration is fail-closed for ambiguous legacy rows',()=>{
 assert.match(backfill,/where: \{ companyId: null \}/);
 assert.match(backfill,/unresolved\.length/);
 assert.match(backfill,/process\.exitCode = 1/);
 assert.match(masterService,/companyId: scope\.companyId/);
});

test('branch/segment/minQty prices are server authoritative in quote and sale',()=>{
 assert.match(pricing,/Priority: branch\+segment/);
 assert.match(pricing,/minQty: \{ lte:/);
 assert.match(sales,/resolveSellingLine\(this\.prisma/);
 assert.match(sales,/resolveSellingLine\(tx/);
 assert.match(sales,/sellingUnitPrice/);
 assert.match(sales,/baseUnitPrice/);
 assert.match(products,/effectiveSalePrice/);
 assert.match(pos,/effectiveSalePrice/);
 assert.match(store,/effectiveSalePrice/);
});

test('alternate product barcode participates in catalog and POS search',()=>{
 assert.match(products,/barcodes: \{ some: \{ code: query \}/);
 assert.match(products,/barcodes: \{ orderBy:/);
 // The POS side moved from an inline `product.barcodes?.some(...)` inside a filter to the shared
 // `fuzzyRank` helper, which takes the barcode list as one of its searched fields. Assert the
 // ALTERNATE barcodes still reach the matcher — asserting the old inline expression would lock in a
 // particular spelling rather than the behaviour this test is about. Deliberately loose on
 // punctuation: the point is that every barcode variant is a searched field, not how it is spliced.
 assert.match(pos,/fuzzyRank\(inCategory, q,/);
 assert.match(pos,/\(product\.barcodes \?\? \[\]\)\.map\(\(barcode\) => barcode\.code\)/,
   'alternate barcodes must still be searched, not just the primary one');
});

test('API keys are one-time secrets with scoped authentication and branch isolation',()=>{
 assert.match(apiController,/@Controller\('api-keys'\)/);
 assert.match(apiKeys,/randomBytes\(32\)\.toString\('base64url'\)/);
 assert.match(apiKeys,/secretHash: this\.hash\(token\)/);
 assert.match(apiKeys,/timingSafeEqual/);
 assert.match(apiKeys,/Header x-toko360-branch-id wajib/);
 assert.match(guard,/x-api-key/);
 assert.match(guard,/x-toko360-branch-id/);
 assert.match(rolesGuard,/Endpoint role-only tidak dapat diakses dengan API key/);
});
