import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const sqliteSchema = readFileSync('apps/api/prisma/schema.sqlite.prisma', 'utf8');
const postgresSchema = readFileSync('apps/api/prisma/schema.postgresql.prisma', 'utf8');

function models(schema) { return [...schema.matchAll(/^model\s+(\w+)/gm)].map((match) => match[1]); }

test('T360-20260829: schema promo & price history ada di SQLite dan PostgreSQL', () => {
  for (const model of ['PromoRule', 'ProductPriceHistory']) {
    assert.ok(models(sqliteSchema).includes(model), `${model} harus ada di schema sqlite`);
    assert.ok(models(postgresSchema).includes(model), `${model} harus ada di schema postgresql`);
  }
  assert.match(sqliteSchema, /@@unique\(\[companyId, code\]\)/);
});

test('T360-20260829: endpoint laporan baru terdaftar di controller reports', () => {
  const controller = readFileSync('apps/api/src/reports/reports.controller.ts', 'utf8');
  for (const route of ["@Get('peak-hours')", "@Get('dead-stock')", "@Get('customer-rfm')", "@Get('jobs/:id/download')"]) {
    assert.ok(controller.includes(route), `${route} harus terdaftar`);
  }
});

test('T360-20260829: promotions module lengkap dan terdaftar di app.module', () => {
  assert.equal(existsSync('apps/api/src/promotions/promotions.module.ts'), true);
  assert.equal(existsSync('apps/api/src/promotions/promotions.service.ts'), true);
  assert.equal(existsSync('apps/api/src/promotions/promotions.controller.ts'), true);
  const appModule = readFileSync('apps/api/src/app.module.ts', 'utf8');
  assert.match(appModule, /import \{ PromotionsModule \}/);
  assert.match(appModule, /PromotionsModule,/);
  const service = readFileSync('apps/api/src/promotions/promotions.service.ts', 'utf8');
  assert.match(service, /export function computeDiscount/);
});

test('T360-20260829: promo preview read-only, tidak membuat transaksi penjualan', () => {
  const service = readFileSync('apps/api/src/promotions/promotions.service.ts', 'utf8');
  const previewBody = service.slice(service.indexOf('async preview'), service.indexOf('export function computeDiscount') > 0 ? undefined : undefined);
  assert.match(service, /Preview read-only/);
  assert.doesNotMatch(previewBody, /sale\.create/);
  assert.doesNotMatch(previewBody, /inventoryMovement\.create/);
});

test('T360-20260829: permission promotion didefinisikan di seed', () => {
  const seed = readFileSync('apps/api/prisma/seed.ts', 'utf8');
  assert.match(seed, /'promotion\.view','promotion\.manage'/);
  assert.match(seed, /\['CASHIER', \[.*'promotion\.view'/);
});

test('T360-20260829: worker mengeksekusi ReportJob secara atomik', () => {
  const worker = readFileSync('apps/worker/src/index.ts', 'utf8');
  assert.match(worker, /async function processReportJobs/);
  assert.match(worker, /status: 'PENDING' \}/, 'klaim job harus dari status PENDING');
  assert.match(worker, /processReportJobs\(\);/);
  assert.match(worker, /function csvCell/);
});

test('T360-20260829: struk digital punya tombol WhatsApp dan print CSS', () => {
  const receipt = readFileSync('apps/api/src/sales/receipt.controller.ts', 'utf8');
  assert.match(receipt, /wa\.me\/\?text=/);
  assert.match(receipt, /window\.print/);
  assert.match(receipt, /@media print/);
  assert.doesNotMatch(receipt, /unitCost: true/);
});

test('T360-20260829: ops-health endpoint terdaftar di platform', () => {
  const controller = readFileSync('apps/api/src/platform/platform.controller.ts', 'utf8');
  assert.match(controller, /@Get\('ops-health'\)/);
  const service = readFileSync('apps/api/src/platform/platform.service.ts', 'utf8');
  assert.match(service, /async opsHealth/);
  assert.match(service, /webhookDelivery\.count/);
});

test('T360-20260829: products update mencatat riwayat harga otomatis', () => {
  const service = readFileSync('apps/api/src/products/products.service.ts', 'utf8');
  assert.match(service, /productPriceHistory\.createMany/);
  assert.match(service, /async priceHistory/);
  const controller = readFileSync('apps/api/src/products/products.controller.ts', 'utf8');
  assert.match(controller, /@Patch\(':id'\)/);
  assert.match(controller, /@Get\(':id\/price-history'\)/);
});

test('T360-20260829: work item value pack 2 terdaftar', () => {
  const file = existsSync('work-items/active/T360-20260829-000000-value-pack-2.json')
    ? 'work-items/active/T360-20260829-000000-value-pack-2.json'
    : 'work-items/completed/T360-20260829-000000-value-pack-2.json';
  const workItem = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(workItem.id, 'T360-20260829-000000');
  assert.equal(workItem.impacts.accounting, 'NONE');
  assert.equal(workItem.impacts.inventory, 'NONE');
});
