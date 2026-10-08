import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma'].map((name) => read(`apps/api/prisma/${name}`));
const helper = read('apps/api/src/common/transaction-uom.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const orderDto = read('apps/api/src/orders/dto/create-order.dto.ts');
const returns = read('apps/api/src/returns/returns.service.ts');
const orderReturnDto = read('apps/api/src/returns/dto/order-return.dto.ts');
const products = read('apps/api/src/products/products.service.ts');
const storefront = read('apps/storefront/app/page.tsx');
const sqliteMigration = read('database/migrations/T360-20260925-p2a-transaction-uom-lineage/sqlite-expand.sql');
const postgresMigration = read('database/migrations/T360-20260925-p2a-transaction-uom-lineage/postgresql-expand.sql');

const snapshotPattern = (model) => new RegExp(`model ${model} \\{[\\s\\S]*variantId\\s+String\\?[\\s\\S]*productUnitId\\s+String\\?[\\s\\S]*unitCode\\s+String\\?[\\s\\S]*unitQuantity\\s+Int\\?[\\s\\S]*quantityFactor\\s+Int\\s+@default\\(1\\)[\\s\\S]*sourceBarcode\\s+String\\?[\\s\\S]*quantity\\s+Int`);

test('P2A persists immutable UOM snapshots on online order and every return family in all schemas', () => {
  for (const schema of schemas) {
    for (const model of ['OrderItem', 'OrderReturnItem', 'SaleReturnItem', 'PurchaseReturnItem']) {
      assert.match(schema, snapshotPattern(model), `${model} must persist transaction UOM lineage`);
    }
  }
  for (const migration of [sqliteMigration, postgresMigration]) {
    for (const model of ['OrderItem', 'OrderReturnItem', 'SaleReturnItem', 'PurchaseReturnItem']) {
      assert.match(migration, new RegExp(model));
    }
    assert.match(migration, /productUnitId/);
    assert.match(migration, /unitQuantity/);
    assert.match(migration, /quantityFactor/);
    assert.match(migration, /sourceBarcode/);
  }
});

test('P2A uses one ProductUnit authority for POS and storefront orders', () => {
  assert.match(sales, /resolveSellingUnitLine/);
  assert.match(orders, /resolveSellingUnitLine/);
  assert.match(helper, /client\.productUnit\.findFirst/);
  assert.match(helper, /id: input\.productUnitId\.trim\(\), productId: product\.id, isActive: true/);
  assert.match(helper, /barcode\.productUnitId/);
  assert.match(helper, /Number\.isSafeInteger\(quantityFactor\)/);
  assert.match(helper, /baseQuantity = unitQuantity \* quantityFactor/);
  assert.match(helper, /packageFallback = new Prisma\.Decimal\(variantSalePrice \?\? product\.salePrice\)\.mul\(quantityFactor\)/);
  assert.match(helper, /variantSalePrice: packageFallback/);
});

test('P2A online order persists transaction quantity separately from base inventory quantity', () => {
  assert.match(orderDto, /Jumlah dalam unit transaksi yang dipilih/);
  assert.match(orderDto, /productUnitId\?: string/);
  assert.match(orderDto, /variantId\?: string/);
  assert.match(orders, /unitQuantity: item\.conversion\.unitQuantity|unitQuantity: item\.conversion\.unitQuantity/);
  assert.match(orders, /quantityFactor: item\.conversion\.quantityFactor/);
  assert.match(orders, /quantity: item\.conversion\.baseQuantity/);
  assert.match(orders, /reservationQuantities\.set\(item\.productId,[\s\S]*item\.quantity/);
  assert.match(orders, /consumeLocationReservations\([\s\S]*quantity: value\.quantity/);
});

test('P2A fulfillment keeps inventory in base units while shipment and accounting preserve selling UOM', () => {
  assert.match(orders, /uomSnapshotVersion: 1/);
  assert.match(orders, /unitQuantity: item\.unitQuantity \?\? item\.quantity/);
  assert.match(orders, /quantityFactor: item\.quantityFactor/);
  assert.match(orders, /baseQuantity: item\.quantity/);
  assert.match(orders, /quantity: item\.unitQuantity \?\? item\.quantity, unitAmount: item\.unitPrice/);
  assert.match(orders, /unitCost\)\.mul\(item\.quantity\)/);
});

test('P2A returns copy historical snapshots and never reconstruct order-return conversion from current ProductUnit', () => {
  assert.match(returns, /variantId: original\.variantId \?\? null/);
  assert.match(returns, /productUnitId: original\.productUnitId \?\? null/);
  assert.match(returns, /sourceBarcode: original\.sourceBarcode \?\? null/);
  assert.match(returns, /const factor = Math\.max\(1, Number\(original\.quantityFactor \?\? 1\)\)/);
  assert.match(returns, /const requestedBaseQty = requestedUnitQty \* factor/);
  assert.match(returns, /unitQuantity: requestedUnitQty/);
  assert.match(returns, /quantity: requestedBaseQty/);
  assert.match(returns, /allocateHistoricalRemainder\(original\.netSubtotal, allocation\.net, requestedBaseQty, original\.quantity, allocation\.quantity\)/);
  assert.match(returns, /requestedQuantity === remainingQuantity/);
  assert.match(returns, /original\.sub\(alreadyAllocated\)\.toDecimalPlaces\(2\)/);
  const customerReturnBlock = returns.slice(returns.indexOf('async createCustomerOrderReturn'), returns.indexOf('async startOrderReturnInspection'));
  assert.doesNotMatch(customerReturnBlock, /productUnit\.find|productPrice\.find|resolveSellingUnitLine/);
  assert.match(orderReturnDto, /UOM transaksi historis OrderItem/);
});

test('P2A server exposes authoritative ProductUnit price and storefront sends selected UOM identity', () => {
  assert.match(products, /effectiveSalePrice: await resolveProductUnitPrice/);
  assert.match(products, /variantSalePrice: unit\.variant\?\.salePrice \? new Prisma\.Decimal\(unit\.variant\.salePrice\)\.mul\(Number\(unit\.quantityFactor\)\) : undefined/);
  assert.match(storefront, /function sellingOptions\(product: Product\)/);
  assert.match(storefront, /Unit penjualan/);
  assert.match(storefront, /productUnitId: item\.productUnitId, variantId: item\.variantId/);
  assert.match(storefront, /Math\.min\(quantity, maxUnitQuantity\(item\.product, item\.quantityFactor\)\)/);
  assert.match(storefront, /maxQuantity: orderItem\.unitQuantity \?\?/);
  assert.match(storefront, /Jumlah \(\{returnForm\.unitCode\}\)/);
});
