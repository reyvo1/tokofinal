import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const schemaPaths = [
  'apps/api/prisma/schema.prisma',
  'apps/api/prisma/schema.sqlite.prisma',
  'apps/api/prisma/schema.postgresql.prisma',
];
const schemas = schemaPaths.map(read);
const modelBody = (schema, name) => {
  const match = schema.match(new RegExp(`^model\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(match, `model ${name} harus ada`);
  return match[1];
};

test('dynamic UOM schema requires explicit product base unit and StaffMemo parity in every runtime schema', () => {
  for (const schema of schemas) {
    const product = modelBody(schema, 'Product');
    const memo = modelBody(schema, 'StaffMemo');
    assert.match(product, /\n\s*unit\s+String\s*\n/);
    assert.doesNotMatch(product, /unit\s+String[^\n]*@default\s*\(/);
    for (const field of ['companyId','branchId','userId','operationKey','requestHash','title','body','isPinned','archivedAt','createdAt','updatedAt']) {
      assert.match(memo, new RegExp(`\\b${field}\\b`), `${field} harus ada pada StaffMemo`);
    }
    assert.match(memo, /@@unique\(\[userId, branchId, operationKey\]\)/);
    assert.match(memo, /@@index\(\[companyId, branchId, userId, archivedAt, isPinned, updatedAt\]\)/);
    assert.match(modelBody(schema, 'Company'), /staffMemos\s+StaffMemo\[\]/);
    assert.match(modelBody(schema, 'Branch'), /staffMemos\s+StaffMemo\[\]/);
    assert.match(modelBody(schema, 'User'), /staffMemos\s+StaffMemo\[\]/);
  }
});

test('dynamic UOM + memo migration is registered, expand-only, and PostgreSQL removes legacy Product.unit default', () => {
  const order = JSON.parse(read('config/expand-migration-order.json'));
  const name = 'T360-20261004-dynamic-uom-staff-memo';
  const index = order.migrations.indexOf(name);
  assert.ok(index >= 0, 'migration dynamic UOM + memo harus tetap terdaftar');
  assert.ok(order.migrations.slice(index + 1).includes('T360-20261005-p6a-retail-transaction-completion'), 'migration P6A harus berada setelah dynamic UOM + memo, bukan menggantikannya');
  const sqlite = read(`database/migrations/${name}/sqlite-expand.sql`);
  const postgres = read(`database/migrations/${name}/postgresql-expand.sql`);
  const docs = read(`database/migrations/${name}/README.md`);
  for (const sql of [sqlite, postgres]) {
    assert.match(sql, /StaffMemo/);
    assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  }
  assert.match(postgres, /ALTER TABLE "Product" ALTER COLUMN "unit" DROP DEFAULT/i);
  assert.match(docs, /SQLite/i);
  assert.match(docs, /legacy databases may retain the historical column default/i);
});

test('product create and bulk contracts require a real base unit and never default to PCS', () => {
  const createDto = read('apps/api/src/products/dto/create-product.dto.ts');
  const bulkDto = read('apps/api/src/products/dto/bulk-products.dto.ts');
  const service = read('apps/api/src/products/products.service.ts');
  const transactionUom = read('apps/api/src/common/transaction-uom.ts');
  assert.match(createDto, /unit!:\s*string/);
  assert.doesNotMatch(createDto, /unit\?:\s*string/);
  assert.match(bulkDto, /unit!:\s*string/);
  assert.doesNotMatch(bulkDto, /unit\?:\s*string/);
  assert.match(service, /requireActiveUnit/);
  assert.match(service, /type: 'UNIT'/);
  assert.match(service, /branchId: null/);
  assert.match(service, /Base unit tidak dapat diubah/);
  assert.match(service, /bulk[^\n]*base unit|base unit[^\n]*bulk/i);
  assert.doesNotMatch(service, /['"]PCS['"]|['"]pcs['"]/);
  assert.doesNotMatch(transactionUom, /['"]PCS['"]|['"]pcs['"]/);
  assert.match(transactionUom, /masterReference\.findFirst/);
  assert.match(transactionUom, /Base unit .* tidak aktif pada master UNIT/);
  assert.match(transactionUom, /Unit jual .* tidak aktif pada master UNIT/);
});


test('runtime Product fixtures remain compatible with mandatory dynamic UNIT contract', () => {
  const rawSqlFixtures = [
    'tests/post1c-mobile-draft-posting-runtime.test.mjs',
    'tests/post1c-telegram-audit-runtime.test.mjs',
    'tests/post1c-telegram-command-runtime.test.mjs',
  ];
  for (const fixture of rawSqlFixtures) {
    const source = read(fixture);
    const inserts = [...source.matchAll(/INSERT INTO Product \(([^)]*)\)/g)];
    assert.ok(inserts.length > 0, `${fixture} harus benar-benar membuat Product runtime`);
    for (const match of inserts) {
      const columns = match[1].split(',').map((value) => value.trim());
      assert.ok(columns.includes('unit'), `${fixture} wajib menulis Product.unit eksplisit`);
    }
    assert.match(source, /INSERT INTO MasterReference[^\n]+type[^\n]+code[^\n]+name/,
      `${fixture} harus materialize master UNIT, bukan mengandalkan default schema`);
    assert.match(source, /'UNIT',\s*'PCS'/,
      `${fixture} harus mengonfigurasi UNIT fixture secara eksplisit`);
  }

  const reportFixture = read('tests/post1a-consolidated-report-reconciliation.test.mjs');
  assert.match(reportFixture, /prisma\.masterReference\.create/,
    'fixture sale/report harus mendaftarkan master UNIT sebelum memakai SalesService');
  assert.match(reportFixture, /type:\s*'UNIT'/);
  assert.match(reportFixture, /branchId:\s*null/);
  assert.match(reportFixture, /unit:\s*'PCS'/);
});

test('master data makes UNIT company-wide, validates selling units and blocks deactivation while in use', () => {
  const source = read('apps/api/src/master-data/master-data.service.ts');
  assert.match(source, /requireUnitMaster/);
  assert.match(source, /companyId, branchId: null, type: 'UNIT'/);
  assert.match(source, /assertUnitReferenceCanDeactivate/);
  assert.match(source, /masih dipakai produk\/konversi\/barcode\/harga/);
  assert.match(source, /quantityFactor wajib integer minimal 1/);
  assert.match(source, /Barcode utama wajib mewakili 1 base unit produk/);
  assert.doesNotMatch(source, /['"]PCS['"]|['"]pcs['"]/);
});

test('operator product surfaces source base unit from UNIT master and CSV import requires explicit unit', () => {
  const master = read('apps/admin/app/modules/master-data.tsx');
  const bulk = read('apps/admin/app/modules/product-bulk-labels.tsx');
  const pos = read('apps/pos/app/page.tsx');
  const storefront = read('apps/storefront/app/page.tsx');
  assert.match(master, /unitRefs/);
  assert.match(master, /Base unit/);
  assert.match(master, /unitRefs/);
  assert.match(master, /unitRefs\.filter\([^\n]+\)\.map\(/);
  assert.doesNotMatch(master, /<option[^>]*>PCS<\/option>/);
  assert.match(master, /String\(product\.retailCeilingPrice\)/);
  assert.match(bulk, /unit/);
  assert.match(bulk, /wajib/i);
  for (const source of [bulk, pos, storefront]) assert.doesNotMatch(source, /\|\|\s*['"]PCS['"]|\?\?\s*['"]PCS['"]|unit\s*:\s*['"]PCS['"]|unit\s*:\s*['"]pcs['"]/);
  assert.match(storefront, /belum memiliki base unit dari master UNIT/);
});

test('stock alerts and digest display authoritative product unit instead of static pcs text', () => {
  const stockAlert = read('apps/api/src/sales/stock-alert.service.ts');
  const digest = read('apps/api/src/reports/daily-digest.service.ts');
  for (const source of [stockAlert, digest]) {
    assert.match(source, /unit/);
    assert.doesNotMatch(source, /\bpcs\b/i);
  }
});

test('StaffMemo API is authenticated user-only, tenant/branch/user scoped, idempotent and audited', () => {
  const controller = read('apps/api/src/staff-memos/staff-memos.controller.ts');
  const service = read('apps/api/src/staff-memos/staff-memos.service.ts');
  const module = read('apps/api/src/staff-memos/staff-memos.module.ts');
  const app = read('apps/api/src/app.module.ts');
  assert.match(controller, /@Controller\('staff-memos'\)/);
  assert.doesNotMatch(controller, /@Public/);
  assert.doesNotMatch(controller, /@Roles|@Permissions/);
  assert.match(controller, /idempotency-key/);
  assert.match(service, /user\.authType === 'API_KEY'/);
  assert.match(service, /companyId: user\.companyId, branchId: user\.branchId, userId: user\.sub/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(service, /userId_branchId_operationKey/);
  assert.match(service, /P2002/);
  assert.match(service, /CREATE_STAFF_MEMO/);
  assert.match(service, /ARCHIVE_STAFF_MEMO/);
  assert.match(module, /StaffMemosController/);
  assert.match(app, /StaffMemosModule/);
});

test('Memo is mounted for Admin, POS and Employee Portal against one canonical API', () => {
  const surfaces = [
    ['apps/admin/app/staff-memo.tsx','apps/admin/app/page.tsx','admin'],
    ['apps/pos/app/staff-memo.tsx','apps/pos/app/page.tsx','pos'],
    ['apps/employee-portal/app/staff-memo.tsx','apps/employee-portal/app/employee-portal-app.tsx','employee'],
  ];
  for (const [widgetPath, hostPath, marker] of surfaces) {
    const widget = read(widgetPath);
    const host = read(hostPath);
    assert.match(widget, /\/staff-memos/);
    assert.match(widget, /Idempotency-Key/);
    assert.match(widget, new RegExp(`data-staff-memo-surface=["']${marker}["']`));
    assert.match(host, /StaffMemoWidget/);
    assert.doesNotMatch(widget, /localStorage|sessionStorage/);
  }
});

test('Browser UAT is expanded for dynamic UNIT and exact-runtime StaffMemo lifecycle without weakening existing gates', () => {
  const browser = read('scripts/browser-uat.mjs');
  assert.match(browser, /master-data\/references\?type=UNIT/);
  assert.match(browser, /DYNAMIC_UNIT_MASTER_RUNTIME/);
  assert.match(browser, /unit: uatUnitCode/);
  assert.match(browser, /STAFF_MEMO_RUNTIME/);
  assert.match(browser, /idempotentRetry: true/);
  for (const marker of ['STAFF_MEMO_ADMIN_SURFACE','STAFF_MEMO_POS_SURFACE','STAFF_MEMO_EMPLOYEE_SURFACE']) assert.match(browser, new RegExp(marker));
  assert.match(browser, /P5_V4_ADMIN_VISUAL_IDENTITY/);
  assert.match(browser, /POS_AUTHENTICATED_RUNTIME/);
  assert.match(browser, /EMPLOYEE_PORTAL_AUTHENTICATED_RUNTIME/);
  for (const probe of ['scripts/ci-p2a-multi-uom-runtime-probe.mjs','scripts/ci-r4-core-business-probe.mjs','scripts/ci-r8-reporting-security-probe.mjs']) {
    const source = read(probe);
    assert.ok(/type:\s*'UNIT'/.test(source) || /references\?type=UNIT/.test(source), `${probe} harus resolve UNIT aktif`);
    assert.doesNotMatch(source, /unit:\s*['"]pcs['"]|unit:\s*['"]PCS['"]/);
  }
});
