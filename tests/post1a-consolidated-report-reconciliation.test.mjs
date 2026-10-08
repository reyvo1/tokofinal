// Acceptance #13: consolidated reporting reconciles exactly to branch canonical evidence.
//
// UNPROVEN sejak matrix §8 ditulis, karena TIDAK ADA satu pun run yang mencocokkan total laporan
// dengan jurnal cabang. Semua test yang menyentuh reports/multi-outlet di repo ini membaca SOURCE
// (regex), bukan menjalankan service — jadi defect di dalam service tidak akan membuat mereka merah.
//
// Yang ditulis di sini menjalankan service asli: `SalesService.create` (memposting SALE_CASH),
// `ReturnsService.createSaleReturn` + `confirmSaleReturn` (memposting SALE_RETURN), lalu
// `MultiOutletService.overview` dan `ReportsService.profitLoss` — semuanya terhadap SQLite nyata.
//
// Defect yang ditemukan cara ini (2026-10-01): `overview` menjumlahkan `Sale.total + Order.total`,
// sehingga retur yang SUDAH dikonfirmasi tidak pernah mengurangi apa pun, dan `Sale.total` adalah
// nilai GROSS yang mengandung pajak.
//
//  jurnal kanonik BR1 : kredit 45.000 - debit 15.000 = 30.000
//   multi-outlet BR1  : 45.000                          (retur hilang, pajak ikut terhitung)
//   total konsolidasi : 90.000 vs jurnal 75.000
//
// FIXTURE yang harus diketahui sebelum menulis ulang file ini:
//   - User → Company → Branch → Warehouse → Product/Inventory. Branch.companyId dan
//     Inventory.warehouseId adalah FK; melewatkan satu level gagal sebagai Prisma FK error.
//   - SalesService memakai `consumeAvailableLocationStock`, yang memanggil prepareLocationInventory
//     dan akan MEMBUAT WarehouseLocation default bila belum ada — jadi location tidak perlu di-seed.
//   - `createSaleReturn` membuat OperationalInspection dengan templateCode 'RETURN-INBOUND-STANDARD'.
//     Kalau template itu tidak ada, `templateId` null dan `results` kosong; `completeInspection`
//     dengan `results: []` tetap menghasilkan status PASSED, jadi confirm tidak ters blokir.
//   - `ReturnsService` butuh StorefrontCustomerService; jalur yang diuji tidak pernah memanggilnya,
//     jadi stub yang men-throw kalau dipanggil itu lebih jujur daripada stub yang diam.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't360-recon-'));
const DB = path.join(TMP, 'recon.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', prismaFml],
  { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${DB}` }, stdio: 'pipe' });

const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } });

const opts = { platform: 'node', external: ['@prisma/client'] };
const { AccountingCoreService } = await load('apps/api/src/accounting-core/accounting-core.service.ts', opts);
const { StockAlertService } = await load('apps/api/src/sales/stock-alert.service.ts', opts);
const { PromotionsService } = await load('apps/api/src/promotions/promotions.service.ts', opts);
const { SupervisorApprovalService } = await load('apps/api/src/supervisor-approval/supervisor-approval.service.ts', opts);
const { SalesService } = await load('apps/api/src/sales/sales.service.ts', opts);
const { OperationsControlService } = await load('apps/api/src/operations-control/operations-control.service.ts', opts);
const { ReportsService } = await load('apps/api/src/reports/reports.service.ts', opts);
const { MultiOutletService } = await load('apps/api/src/reports/multi-outlet.service.ts', opts);
const { ReturnsService } = await load('apps/api/src/returns/returns.service.ts', opts);

const accounting = new AccountingCoreService(prisma);
const sales = new SalesService(prisma, accounting, new StockAlertService(prisma), new PromotionsService(prisma), new SupervisorApprovalService(prisma));
const operations = new OperationsControlService(prisma);
const reports = new ReportsService(prisma);
const multiOutlet = new MultiOutletService(prisma);
const storefrontCustomers = { resolveBranchByCode: async () => { throw new Error('storefront resolution must not be reached by this path'); } };
const returns = new ReturnsService(prisma, accounting, operations, storefrontCustomers);

const COMPANY = 'acme';
const USER = 'u-1';
const BRANCHES = [['br-1', 'BR1'], ['br-2', 'BR2']];
const ACCOUNTS = [
  ['1101', 'Kas', 'ASSET'], ['1102', 'Bank', 'ASSET'], ['1301', 'Persediaan', 'ASSET'],
  ['2201', 'Pajak Keluaran', 'LIABILITY'], ['4101', 'Penjualan', 'REVENUE'],
  ['4102', 'Retur dan Potongan Penjualan', 'REVENUE'], ['4104', 'Pendapatan Jasa', 'REVENUE'],
  ['5101', 'Harga Pokok Penjualan', 'EXPENSE'],
];
const RULES = [
  { code: 'SALE-CASH', eventType: 'SALE_CASH', lines: [
    { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'settlement' },
    { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
    { accountCodeKey: 'serviceRevenue', side: 'CREDIT', amountKey: 'serviceRevenue', skipIfZero: true },
    { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
    { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
    { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
  ] },
  { code: 'SALE-RETURN', eventType: 'SALE_RETURN', lines: [
    { accountCodeKey: 'returns', side: 'DEBIT', amountKey: 'net' },
    { accountCodeKey: 'outputTax', side: 'DEBIT', amountKey: 'outputTax', skipIfZero: true },
    { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross' },
    { accountCodeKey: 'inventory', side: 'DEBIT', amountKey: 'inventory', skipIfZero: true },
    { accountCodeKey: 'cogs', side: 'CREDIT', amountKey: 'cogs', skipIfZero: true },
  ] },
];

async function seed() {
  await prisma.user.create({ data: { id: USER, name: 'Operator', email: 'op@test', passwordHash: 'x', isActive: true } });
  await prisma.company.create({ data: { id: COMPANY, name: 'Acme', slug: 'acme', timezone: 'Asia/Makassar', currency: 'IDR' } });
  await prisma.masterReference.create({
    data: { companyId: COMPANY, branchId: null, type: 'UNIT', code: 'PCS', name: 'Pieces', isActive: true },
  });
  await prisma.masterReference.create({
    data: {
      companyId: COMPANY, branchId: null, type: 'PAYMENT_METHOD', code: 'CASH', name: 'Tunai', isActive: true,
      metadata: {
        kind: 'CASH', settlementAccountCode: '1101', settlementBehavior: 'IMMEDIATE',
        requiresProvider: false, requiresReference: false, refundBehavior: 'CASH', refundAccountCode: '1101',
        allowOffline: true, allowCashChange: true, feeRatePercent: 0,
      },
    },
  });
  for (const [id, code] of BRANCHES) {
    await prisma.branch.create({ data: { id, companyId: COMPANY, code, name: `Cabang ${code}`, isActive: true } });
    for (const [accountCode, name, type] of ACCOUNTS) {
      await prisma.account.create({ data: { branchId: id, code: accountCode, name, type } });
    }
    await prisma.warehouse.create({ data: { id: `wh-${id}`, code: `W${id}`, name: `Gudang ${id}`, branchId: id, isActive: true, isDefault: true } });
    await prisma.product.create({ data: { id: `p-${id}`, companyId: COMPANY, sku: `SKU-${id}`, barcode: `BC-${id}`, name: `Produk ${id}`, costPrice: 10000, salePrice: 15000, unit: 'PCS' } });
    await prisma.inventory.create({ data: { warehouseId: `wh-${id}`, productId: `p-${id}`, quantity: 100, available: 100 } });
  }
  for (const rule of RULES) {
    await prisma.accountingPostingRule.create({
      data: { companyId: COMPANY, code: rule.code, version: 1, name: rule.code, eventType: rule.eventType, status: 'ACTIVE', journalLines: rule.lines },
    });
  }
}

const user = (branchId) => ({ sub: USER, companyId: COMPANY, branchId, roles: ['ADMIN'], permissions: [] });

// Canonical evidence, read straight from the journal rather than through any report.
async function journalRevenueByBranch() {
  const lines = await prisma.journalLine.findMany({
    where: { account: { type: 'REVENUE' } },
    include: { account: { select: { branchId: true } } },
  });
  const totals = new Map();
  for (const line of lines) {
    const branchId = line.account.branchId;
    totals.set(branchId, (totals.get(branchId) ?? 0) + Number(line.credit) - Number(line.debit));
  }
  return totals;
}

test('the fixture reaches a state where the journal actually contains a return', async () => {
  await seed();
  // BR1: 30.000 + 15.000, lalu 15.000 itu diretur penuh. BR2: 45.000.
  await sales.create({ warehouseId: 'wh-br-1', items: [{ productId: 'p-br-1', quantity: 2 }], paymentMethod: 'CASH' }, user('br-1'));
  const returned = await sales.create({ warehouseId: 'wh-br-1', items: [{ productId: 'p-br-1', quantity: 1 }], paymentMethod: 'CASH' }, user('br-1'));
  await sales.create({ warehouseId: 'wh-br-2', items: [{ productId: 'p-br-2', quantity: 3 }], paymentMethod: 'CASH' }, user('br-2'));

  const created = await returns.createSaleReturn(
    { saleId: returned.id, warehouseId: 'wh-br-1', refundMethod: 'CASH', items: [{ saleItemId: returned.items[0].id, quantity: 1 }] },
    user('br-1'),
  );
  await operations.completeInspection(created.inspectionId, { results: [] }, user('br-1'));
  const confirmed = await returns.confirmSaleReturn(created.id, {}, user('br-1'));
  assert.equal(confirmed.status, 'COMPLETED');

  const journal = await journalRevenueByBranch();
  assert.equal(journal.get('br-1'), 30000, 'BR1 canonical revenue is 45.000 credit minus 15.000 return debit');
  assert.equal(journal.get('br-2'), 45000);
});

test('consolidated multi-outlet revenue equals the branch journals, branch by branch', async () => {
  const overview = await multiOutlet.overview(user('br-1'));
  assert.equal(overview.source, 'POSTED_JOURNAL', 'the report must declare which authority it reads');
  const journal = await journalRevenueByBranch();
  for (const outlet of overview.ranked) {
    assert.equal(outlet.today.revenue, journal.get(outlet.branchId), `outlet ${outlet.code} must equal its own journal`);
  }
  const journalTotal = [...journal.values()].reduce((sum, value) => sum + value, 0);
  assert.equal(overview.totals.revenue, journalTotal);
  assert.equal(overview.totals.revenue, 75000);
});

test('consolidated gross profit equals consolidated revenue minus the COGS in the journals', async () => {
  const overview = await multiOutlet.overview(user('br-1'));
  const cogs = await prisma.journalLine.findMany({
    where: { account: { code: '5101' } },
    include: { account: { select: { branchId: true } } },
  });
  const cogsByBranch = new Map();
  for (const line of cogs) {
    const branchId = line.account.branchId;
    cogsByBranch.set(branchId, (cogsByBranch.get(branchId) ?? 0) + Number(line.debit) - Number(line.credit));
  }
  const journalRevenue = await journalRevenueByBranch();
  for (const outlet of overview.ranked) {
    const expected = (journalRevenue.get(outlet.branchId) ?? 0) - (cogsByBranch.get(outlet.branchId) ?? 0);
    assert.equal(outlet.today.grossProfit, expected, `outlet ${outlet.code} gross profit`);
  }
  const expectedTotal = [...journalRevenue.keys()]
    .reduce((sum, branchId) => sum + (journalRevenue.get(branchId) ?? 0) - (cogsByBranch.get(branchId) ?? 0), 0);
  assert.equal(overview.totals.grossProfit, expectedTotal);
});

test('a confirmed return reduces consolidated revenue by exactly the refunded amount', async () => {
  // The bug in one assertion. Before the fix the return was invisible here: 45.000, not 30.000.
  const before = await multiOutlet.overview(user('br-1'));
  const refund = Number((await prisma.saleReturn.findFirstOrThrow({ where: { saleId: (await prisma.sale.findFirstOrThrow({ where: { warehouseId: 'wh-br-1', total: 15000 } })).id } })).refundAmount);
  assert.equal(refund, 15000);
  const journal = await journalRevenueByBranch();
  assert.equal(before.totals.revenue, [...journal.values()].reduce((s, v) => s + v, 0));
  assert.ok(before.totals.revenue < 90000, 'consolidated revenue must not still be the un-returned 90.000');
});

test('the outlet that had a return reports less than its gross basket sum', async () => {
  // Scoped to the branch that actually had a CONFIRMED return. Comparing every outlet would be
  // wrong: a branch with no returns SHOULD equal its basket total, so a blanket notEqual asserts
  // something false. This test also had a second defect — an earlier version compared one branch's
  // gross basket against the company-wide total, so it passed under the buggy build for the wrong
  // reason (two different scopes can never be equal).
  const returnedBranchIds = new Set(
    (await prisma.saleReturn.findMany({ where: { status: 'COMPLETED' }, select: { warehouseId: true } }))
      .map((row) => row.warehouseId),
  );
  assert.ok(returnedBranchIds.size > 0, 'fixture must contain a completed return');
  const warehouses = await prisma.warehouse.findMany({ select: { id: true, branchId: true } });
  const branchesWithReturn = new Set(
    warehouses.filter((warehouse) => returnedBranchIds.has(warehouse.id)).map((warehouse) => warehouse.branchId),
  );

  const overview = await multiOutlet.overview(user('br-1'));
  const grossByBranch = await prisma.sale.groupBy({
    by: ['branchId'],
    where: { status: 'COMPLETED' },
    _sum: { total: true, tax: true },
  });
  const gross = new Map(grossByBranch.map((row) => [row.branchId, Number(row._sum.total ?? 0)]));
  // No tax code is configured in this fixture, so gross == net and the two differ only by the
  // return. Asserted explicitly so the fixture cannot silently start hiding a tax difference.
  assert.equal(grossByBranch.reduce((s, row) => s + Number(row._sum.tax ?? 0), 0), 0,
    'fixture has no active sales tax code');

  let checked = 0;
  for (const outlet of overview.ranked) {
    if (!branchesWithReturn.has(outlet.branchId)) continue;
    const basketTotal = gross.get(outlet.branchId);
    assert.ok(basketTotal !== undefined && basketTotal > 0, 'the returned branch must have a basket to compare against');
    assert.notEqual(outlet.today.revenue, basketTotal,
      `${outlet.code}: consolidated revenue must not be the un-returned Sale.total of ${basketTotal}`);
    checked += 1;
  }
  assert.equal(checked, 1, 'exactly one branch in this fixture has a completed return');
});

test('every branch P&L revenue line agrees with the consolidated per-outlet revenue', async () => {
  const overview = await multiOutlet.overview(user('br-1'));
  for (const [branchId] of BRANCHES) {
    const pl = await reports.profitLoss(user(branchId));
    const outlet = overview.ranked.find((row) => row.branchId === branchId);
    assert.ok(outlet, `outlet row for ${branchId}`);
    assert.equal(pl.revenue, outlet.today.revenue, `${branchId}: P&L revenue vs consolidated outlet revenue`);
  }
});

test('a branch with no journal activity reports zero rather than dropping out of the consolidation', async () => {
  await prisma.branch.create({ data: { id: 'br-3', companyId: COMPANY, code: 'BR3', name: 'Cabang BR3', isActive: true } });
  const overview = await multiOutlet.overview(user('br-1'));
  assert.equal(overview.totals.outletCount, 3, 'an inactive-branch-count change must not remove the row');
  const empty = overview.ranked.find((row) => row.branchId === 'br-3');
  assert.ok(empty, 'a branch with no sales still needs a row — otherwise its share silently redistributes');
  assert.equal(empty.today.revenue, 0);
  assert.equal(empty.sharePct, 0);
});