import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

function assertContainsAll(source, values) {
  for (const value of values) {
    assert.ok(
      source.includes(value),
      `Expected source to contain: ${value}`,
    );
  }
}

test('finance and reporting expose enterprise workspaces without hiding reporting inside finance', () => {
  const source = read('apps/admin/app/domain-workspaces.ts');
  const nav = read('apps/admin/app/navigation.ts');
  assertContainsAll(source, [
    "key: 'ledger'", "key: 'tax'", "key: 'fiscal'", "key: 'payables'", "key: 'receivables'", "key: 'banking'",
    "workspaceKey: 'reports'", "key: 'financial'", "key: 'operations'", "key: 'scheduled'", "key: 'owner'",
    'Jurnal & accounting ledger', 'Fiscal period & close', 'Financial reports'
  ]);
  assert.match(nav, /label: 'Laporan & Analitik'/);
});

test('master data and organization expose product multi-UOM, pricing, branch and warehouse as first-class workspaces', () => {
  const source = read('apps/admin/app/domain-workspaces.ts');
  assertContainsAll(source, [
    "workspaceKey: 'master-data'", "key: 'catalog'", "key: 'products'", "key: 'pricing'", "key: 'references'",
    "workspaceKey: 'organization'", "key: 'organization'", "key: 'locations'",
    'Produk, variant, barcode & multi-UOM', 'Harga retail, grosir & unit', 'Cabang dan gudang tenant'
  ]);
});

test('page resolves active domain workspace and passes authoritative mode', () => {
  const source = read('apps/admin/app/page.tsx');

  assertContainsAll(source, [
    'resolvedDomainViewFromPath',
    'activeDomainView',
    'AccountingView',
    'MasterDataView',
  ]);

  assert.match(
    source,
    /AccountingView[\s\S]{0,1200}(mode|activeDomainView)|(mode|activeDomainView)[\s\S]{0,1200}AccountingView/,
  );
  assert.match(
    source,
    /MasterDataView[\s\S]{0,1200}(mode|activeDomainView)|(mode|activeDomainView)[\s\S]{0,1200}MasterDataView/,
  );
});

test('accounting workspace exposes complete enterprise finance capabilities', () => {
  const source = read('apps/admin/app/modules/accounting.tsx');

  assert.match(
    source,
    /AccountingView\s*\(\s*\{\s*token\s*,\s*mode\s*\}/,
    'AccountingView harus menerima finance workspace mode',
  );

  assertContainsAll(source, [
    '/accounting-core/events?limit=20',
    '/accounting-core/tax-codes',
    '/accounting-core/accounts',
    '/finance-operations?limit=50',
    '/finance-operations/supplier-payables',
    '/finance-operations/supplier-refunds',
    '/finance-operations/customer-receivables',
    '/finance/fiscal-periods',
    '/finance/bank-statements',
    '/finance/reconciliations',
  ]);

  // The asynchronous report-job surface (create job / download) and the report-type
  // selector are NOT owned by this module. They previously existed here as an
  // unreachable second implementation (~55 lines) that was fetched on every refresh
  // and never rendered. Report jobs live in reporting-workspace; the type catalogue is
  // canonical in report-catalog.ts. Assert we did not reintroduce that dead surface.
  assert.ok(
    !/REPORT_TYPES\s*=\s*\[/.test(source),
    'accounting module must not redeclare a private report-type list; import the canonical catalogue',
  );
  assert.ok(
    !/setReportJobs|reportJobs/.test(source),
    'accounting module must not keep unreachable report-job state',
  );
  assert.match(
    read('apps/admin/app/modules/reporting-workspace.tsx'),
    /from '\.\.\/report-catalog'/,
    'the rendered report-job surface must use the canonical report catalogue',
  );
});

test('master-data workspace exposes catalog, UOM conversion, pricing and organization capabilities', () => {
  const source = read('apps/admin/app/modules/master-data.tsx');

  assert.match(
    source,
    /MasterDataView\s*\(\s*\{\s*token\s*,\s*mode\s*\}/,
    'MasterDataView harus menerima master-data workspace mode',
  );

  assertContainsAll(source, [
    '/master-data/categories',
    '/master-data/customers',
    '/master-data/branches',
    '/master-data/warehouses',
    '/master-data/warehouse-locations',
    '/master-data/references',
    '/products?limit=100',
    'Barcode & Konversi Unit',
    'quantityFactor',
    'unitCode',
    'segmentCode',
    'minQty',
  ]);
});
