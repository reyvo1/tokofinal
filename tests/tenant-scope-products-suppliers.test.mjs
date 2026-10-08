import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const productController = read('apps/api/src/products/products.controller.ts');
const productService = read('apps/api/src/products/products.service.ts');
const supplierController = read('apps/api/src/suppliers/suppliers.controller.ts');
const supplierService = read('apps/api/src/suppliers/suppliers.service.ts');
const purchaseOrders = read('apps/api/src/purchase-orders/purchase-orders.service.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const advancedInventory = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
const fleet = read('apps/api/src/fleet/fleet.service.ts');
const extensions = read('apps/api/src/extensions/extensions.service.ts');
const storefront = read('apps/storefront/app/page.tsx');
const seed = read('apps/api/prisma/seed.ts');
const sqliteSchema = read('apps/api/prisma/schema.sqlite.prisma');
const postgresSchema = read('apps/api/prisma/schema.postgresql.prisma');
const activeSchema = read('apps/api/prisma/schema.prisma');
const migrationReadme = read('database/migrations/T360-20260802-145524-product-supplier-ownership/README.md');
const sqliteExpand = read('database/migrations/T360-20260802-145524-product-supplier-ownership/sqlite-expand.sql');
const postgresExpand = read('database/migrations/T360-20260802-145524-product-supplier-ownership/postgresql-expand.sql');
const sqliteBackfill = read('database/migrations/T360-20260802-145524-product-supplier-ownership/sqlite-backfill.sql');
const postgresBackfill = read('database/migrations/T360-20260802-145524-product-supplier-ownership/postgresql-backfill.sql');
const adr = read('docs/adr/ADR-T360-20260802-145524-PRODUCT-SUPPLIER-OWNERSHIP.md');

test('Product and Supplier have nullable company ownership in every Prisma profile', () => {
  for (const schema of [sqliteSchema, postgresSchema, activeSchema]) {
    assert.match(schema, /model Product \{[\s\S]*?companyId\s+String\?/);
    assert.match(schema, /model Product \{[\s\S]*?company\s+Company\?\s+@relation\(fields: \[companyId\], references: \[id\]\)/);
    assert.match(schema, /model Supplier \{[\s\S]*?companyId\s+String\?/);
    assert.match(schema, /model Supplier \{[\s\S]*?company\s+Company\?\s+@relation\(fields: \[companyId\], references: \[id\]\)/);
    assert.match(schema, /@@index\(\[companyId, isActive, name, id\]\)/);
    assert.match(schema, /@@index\(\[companyId, name, id\]\)/);
  }
});

test('expand migrations are additive and provider specific', () => {
  assert.match(sqliteExpand, /ALTER TABLE "Product"[\s\S]*ADD COLUMN "companyId" TEXT/);
  assert.match(sqliteExpand, /ALTER TABLE "Supplier"[\s\S]*ADD COLUMN "companyId" TEXT/);
  assert.doesNotMatch(sqliteExpand, /DROP TABLE|DROP COLUMN|NOT NULL/i);
  assert.match(postgresExpand, /ADD CONSTRAINT "Product_companyId_fkey"/);
  assert.match(postgresExpand, /ADD CONSTRAINT "Supplier_companyId_fkey"/);
  assert.doesNotMatch(postgresExpand, /DROP TABLE|DROP COLUMN|SET NOT NULL/i);
});

test('backfill only resolves a single company and leaves conflicts visible', () => {
  for (const script of [sqliteBackfill, postgresBackfill]) {
    assert.match(script, /HAVING COUNT\(DISTINCT "companyId"\) = 1/);
    assert.match(script, /unresolved_product/);
    assert.match(script, /unresolved_supplier/);
    assert.match(script, /"companyId" IS NULL/);
  }
  assert.match(migrationReadme, /jangan menjalankan `prisma db push` pada production/i);
  assert.match(adr, /Konflik ownership tidak dipilih secara arbitrer/);
});

test('product catalog resolves authenticated tenant or trusted public branch code', () => {
  assert.match(productController, /@CurrentUser\(\) user: AuthUser \| undefined/);
  assert.match(productController, /@Query\('branchCode'\) branchCode\?: string/);
  assert.match(productService, /private async resolveScope\(/);
  assert.match(productService, /code: 'BRANCH_CODE_REQUIRED'/);
  assert.match(productService, /where: \{ code: normalizedCode, isActive: true \}/);
  assert.match(productService, /companyId: scope\.companyId,[\s\S]*?isActive: true/);
});

test('product inventory and public response remain branch scoped', () => {
  assert.match(productService, /warehouse: \{[\s\S]*?branchId: scope\.branchId,[\s\S]*?branch: \{ companyId: scope\.companyId \}/);
  assert.match(productService, /items: pricedItems\.map\(\(\{ companyId: _companyId, \.\.\.item \}\) => item\)/);
  assert.match(productService, /const \{ companyId: _companyId, \.\.\.publicProduct \} = pricedProduct/);
  assert.match(storefront, /products\?branchCode=\$\{encodeURIComponent\(branchCode\)\}&limit=100/);
  assert.match(storefront, /function changeBranch/);
});

test('product writes and supplier writes derive ownership from authenticated company', () => {
  assert.match(productController, /create\(@Body\(\) dto: CreateProductDto, @CurrentUser\(\) user: AuthUser\)/);
  assert.match(productService, /companyId: scope\.companyId,[\s\S]*?costPrice: new Prisma\.Decimal/);
  assert.match(productService, /action: 'CREATE_PRODUCT'/);
  assert.match(supplierController, /@CurrentUser\(\) user: AuthUser/);
  assert.match(supplierService, /where: \{ companyId: scope\.companyId/);
  assert.match(supplierService, /data: \{ \.\.\.dto, companyId: scope\.companyId/);
  assert.match(supplierService, /action: 'CREATE_SUPPLIER'/);
});

test('purchase orders reject cross-company supplier and product references', () => {
  assert.match(purchaseOrders, /supplier\.findFirst\(\{[\s\S]*?companyId: scope\.companyId/);
  assert.match(purchaseOrders, /product\.findMany\(\{[\s\S]*?companyId: scope\.companyId/);
  assert.match(purchaseOrders, /denyTenantAccess\(user, scope, 'Supplier'/);
  assert.match(purchaseOrders, /denyTenantAccess\(user, scope, 'Product'/);
});

test('sales and public orders enforce product company ownership before inventory posting', () => {
  assert.match(sales, /product\.findMany\(\{[\s\S]*?companyId: scope\.companyId/);
  assert.match(sales, /denyTenantAccess\(user, scope, 'Product'/);
  assert.match(orders, /companyId: branch\.companyId, isActive: true/);
  assert.match(orders, /reason: 'PUBLIC_PRODUCT_COMPANY_MISMATCH'/);
  assert.match(orders, /item\.product\.companyId !== order\.branch\.companyId/);
});

test('inventory fleet and extension paths retain product company checks', () => {
  assert.match(advancedInventory, /companyId: scope\.companyId, isActive: true/);
  assert.match(advancedInventory, /StockTransferProduct/);
  assert.match(advancedInventory, /StockOpnameProduct/);
  assert.match(fleet, /id: item\.productId, companyId: scope\.companyId, isActive: true/);
  assert.match(extensions, /product: \{ companyId: scope\.companyId, isActive: true \}/);
});

test('seed assigns ownership to demo product and supplier records', () => {
  assert.match(seed, /supplier\.upsert\([\s\S]*?update: \{ companyId: company\.id \}/);
  assert.match(seed, /create: \{ companyId: company\.id, code: 'SUP-001'/);
  assert.match(seed, /product\.upsert\([\s\S]*?update: \{ companyId: company\.id/);
  assert.match(seed, /companyId: company\.id, categoryId: category\.id/);
});

test('tenant denial and migration rollback evidence are documented', () => {
  assert.match(productService, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(supplierService, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(adr, /Rollback aplikasi ke commit sebelumnya/);
  assert.match(migrationReadme, /Contract migration/);
});
