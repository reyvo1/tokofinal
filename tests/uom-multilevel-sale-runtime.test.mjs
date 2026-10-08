// Apakah ini aplikasi POS sungguhan? Pertanyaan paling mendasar, dan tidak ada test yang menjawabnya.
//
// Fenomena yang dimaksud: rokok itu satu produk dengan BANYAK jenis (dji samso, kretek, menthol 12,
// dll), dan dijual dengan satuan BERJENJANG — per bungkus, per slop, per karton — bukan cuma per pcs.
// Kalau POS hanya bisa "produk x 2 pcs @ 15.000", maka yang terpasang bukan POS untukrokok.
// Yang diuji di sini dijalankan sungguhan terhadap SQLite nyata:
//
//   1. Master data bisa menyimpan satu produk dengan >=2 variant (jenis) yangmasing-masing punya harga sendiri.
//   2. satuan berjenjang tersimpan sebagai ProductUnit dengan factor integer, DAN bisa ditulis lewat
//      service ASLI (`MasterDataService.createUnit`) — bukan kolom yang tidak pernah diisi.
//   3. `SalesService.create` benar-benar menjual per slop: harga, pajak, dan HPP mengikuti factor,
//      stok berkurang 48 BATANG untuk 2 slop (bungkus isi 12 batang, slop isi 2 bungkus).
//   4. Baris sale menyimpan SNAPSHOT unitCode/factor/baseQuantity, jadi laporan lama tidak berubah
//      ketika master data nanti diedit.
//
// Tiga jebakan yang sudah pernah ditemukan di repo ini dan sengaja dihindari:
//
//   - **Snapshot bukan bonus.** Kalau SaleItem hanya menyimpan quantity, maka "per slop" benar-benar
//     terjadi tapi tidak bisa dibuktikan; ia hanya bisa dibuktikan dari DB.
//   - **Stok dibaca dari Inventory, bukan dari response API.** Response bisa Seen success tanpa satu
//     pun baris yang ditulis.
//   - **Harga unit harus dihitung dari harga per base unit terkecil, bukan hardcode.** Kalau test mengetik
//     angka 36.000 secara harfiah, ia menguji test-nya sendiri. Harga harus datang dari
//     `salePrice` BATANG x factor, dan itu yang di-assert.
//
// Kalau test ini hijau sementara POS tidak punya pemilih satuan di layarnya, itu bukti surface
// UI belum di-mount — kelas yang sama seperti "panel ada tapi tidak ada yang me-mount-nya".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't360-uom-'));
const DB = path.join(TMP, 'uom.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', prismaFml],
  { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${DB}` }, stdio: 'pipe' });

const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } });
const opts = { platform: 'node', external: ['@prisma/client'] };

const { SalesService } = await load('apps/api/src/sales/sales.service.ts', opts);
const { AccountingCoreService } = await load('apps/api/src/accounting-core/accounting-core.service.ts', opts);
const { StockAlertService } = await load('apps/api/src/sales/stock-alert.service.ts', opts);
const { PromotionsService } = await load('apps/api/src/promotions/promotions.service.ts', opts);
const { SupervisorApprovalService } = await load('apps/api/src/supervisor-approval/supervisor-approval.service.ts', opts);
const { MasterDataService } = await load('apps/api/src/master-data/master-data.service.ts',
  { platform: 'node', external: ['@prisma/client', '@nestjs/microservices', '@nestjs/websockets', '@nestjs/websockets/socket-module'] });

const sales = new SalesService(prisma, new AccountingCoreService(prisma), new StockAlertService(prisma),
  new PromotionsService(prisma), new SupervisorApprovalService(prisma));
const masterData = new MasterDataService(prisma);

const COMPANY = 'acme';
const USER = 'u-1';
const BRANCH = 'br-1';
const PRODUCT = 'p-rokok';

const ACCOUNTS = [
  ['1101', 'Kas', 'ASSET'], ['1301', 'Persediaan', 'ASSET'], ['2201', 'Pajak Keluaran', 'LIABILITY'],
  ['4101', 'Penjualan', 'REVENUE'], ['5101', 'Harga Pokok Penjualan', 'EXPENSE'],
];
const RULES = [{
  code: 'SALE-CASH', eventType: 'SALE_CASH', lines: [
    { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'settlement' },
    { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
    { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
    { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
    { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
  ],
}];

const user = { sub: USER, companyId: COMPANY, branchId: BRANCH, roles: ['ADMIN'], permissions: [] };

// Base stock harus unit fisik terkecil. Untuk contoh rokok ini:
// BATANG = base unit; BUNGKUS/SLOP/KARTON adalah unit jual dinamis yang factor-nya
// selalu langsung terhadap BATANG, bukan berantai terhadap kemasan sebelumnya.
const SALE_PRICE_PER_BATANG = 1250;
const BUNGKUS_ISI_BATANG = 12;
const SLOP_ISI_BUNGKUS = 2;
const KARTON_ISI_SLOP = 5;
const SLOP_FACTOR = BUNGKUS_ISI_BATANG * SLOP_ISI_BUNGKUS;
const KARTON_FACTOR = SLOP_FACTOR * KARTON_ISI_SLOP;

async function ensureUnitMaster(code, name = code) {
  const existing = await prisma.masterReference.findUnique({
    where: { companyId_type_code: { companyId: COMPANY, type: 'UNIT', code } },
  });
  if (!existing) return masterData.createReference({ type: 'UNIT', code, name }, user);
  if (!existing.isActive) return masterData.updateReference(existing.id, { isActive: true }, user);
  return existing;
}

// Idempoten: dipanggil lebih dari satu test. Dulu `create` telanjang, jadi test kedua gagal
// dengan "Unique constraint failed on (email)" — itu cacat test, bukan cacat aplikasi.
async function seed() {
  await prisma.company.upsert({ where: { id: COMPANY }, update: {}, create: { id: COMPANY, name: 'Acme', slug: 'acme', timezone: 'Asia/Makassar', currency: 'IDR' } });
  await prisma.user.upsert({ where: { email: 'k@test' }, update: {}, create: { id: USER, name: 'Kasir', email: 'k@test', passwordHash: 'x', isActive: true } });
  await prisma.branch.upsert({ where: { id: BRANCH }, update: {}, create: { id: BRANCH, companyId: COMPANY, code: 'BR1', name: 'Cabang 1', isActive: true } });
  for (const [code, name, type] of ACCOUNTS) {
    await prisma.account.upsert({ where: { branchId_code: { branchId: BRANCH, code } }, update: { name, type }, create: { branchId: BRANCH, code, name, type } });
  }
  await prisma.warehouse.upsert({ where: { id: 'wh-1' }, update: {}, create: { id: 'wh-1', code: 'W1', name: 'Gudang', branchId: BRANCH, isActive: true, isDefault: true } });
  for (const [code, name] of [['BATANG', 'Batang'], ['BUNGKUS', 'Bungkus'], ['SLOP', 'Slop'], ['KARTON', 'Karton'], ['PECAAN', 'Pecahan']]) {
    await ensureUnitMaster(code, name);
  }
  await prisma.masterReference.upsert({
    where: { companyId_type_code: { companyId: COMPANY, type: 'PAYMENT_METHOD', code: 'CASH' } },
    update: {
      name: 'Tunai', isActive: true,
      metadata: {
        kind: 'CASH', settlementAccountCode: '1101', settlementBehavior: 'IMMEDIATE',
        requiresProvider: false, requiresReference: false, refundBehavior: 'CASH', refundAccountCode: '1101',
        allowOffline: true, allowCashChange: true, feeRatePercent: 0,
      },
    },
    create: {
      companyId: COMPANY, branchId: null, type: 'PAYMENT_METHOD', code: 'CASH', name: 'Tunai', isActive: true,
      metadata: {
        kind: 'CASH', settlementAccountCode: '1101', settlementBehavior: 'IMMEDIATE',
        requiresProvider: false, requiresReference: false, refundBehavior: 'CASH', refundAccountCode: '1101',
        allowOffline: true, allowCashChange: true, feeRatePercent: 0,
      },
    },
  });
  await prisma.product.upsert({
    where: { id: PRODUCT },
    update: { unit: 'BATANG', costPrice: 1000, salePrice: SALE_PRICE_PER_BATANG },
    create: { id: PRODUCT, companyId: COMPANY, sku: 'ROKOK-DJI', name: 'Rokok Kretek 12', unit: 'BATANG', costPrice: 1000, salePrice: SALE_PRICE_PER_BATANG },
  });
  // Stok selalu dalam base unit terkecil: 1200 BATANG.
  const stock = await prisma.inventory.findFirst({ where: { warehouseId: 'wh-1', productId: PRODUCT } });
  if (stock) await prisma.inventory.update({ where: { id: stock.id }, data: { quantity: 1200, available: 1200 } });
  else await prisma.inventory.create({ data: { warehouseId: 'wh-1', productId: PRODUCT, quantity: 1200, available: 1200 } });
  for (const rule of RULES) {
    await prisma.accountingPostingRule.upsert({ where: { companyId_code_version: { companyId: COMPANY, code: rule.code, version: 1 } }, update: {}, create: { companyId: COMPANY, code: rule.code, version: 1, name: rule.code, eventType: rule.eventType, status: 'ACTIVE', journalLines: rule.lines } });
  }
}

/**
 * `ProductUnit` punya `@@unique([productId, scopeKey, unitCode])`, jadi scopeKey WAJIB ikut diisi.
 * `MasterDataService.createUnit` menetapkannya `variant?.id ?? 'BASE'` — kalau test tidak
 * menghormati itu, dua satuan bernama sama bentrok dan test gagal karena alasan fixture.
 */
async function addUnit(unitCode, quantityFactor, variantId = null, isDefaultSale = false) {
  return prisma.productUnit.create({
    data: {
      productId: PRODUCT, unitCode, quantityFactor, variantId,
      scopeKey: variantId ?? 'BASE',
      isDefaultSale, isDefaultPurchase: false, isActive: true,
    },
  });
}

test('a product carries several variants, each with its own price', async () => {
  await seed();
  for (const [code, name, price] of [['DJI-12', 'Dji Samso 12', 1250], ['KREK-MENTHOL', 'Kretek Menthol', 1450]]) {
    await prisma.productVariant.create({ data: { productId: PRODUCT, code, name, salePrice: price } });
  }
  const variants = await prisma.productVariant.findMany({ where: { productId: PRODUCT, isActive: true }, orderBy: { code: 'asc' } });
  assert.equal(variants.length, 2, 'satu produk harus bisa punya lebih dari satu jenis');
  const menthol = variants.find((v) => v.code === 'KREK-MENTHOL');
  assert.equal(Number(menthol.salePrice), 1450, 'setiap jenis punya harga sendiri, bukan harga produk');

  // Second variant harus bisa punya satuan sendiri dengan factor terhadap BATANG — satuan
  // terikat variant lewat `variantId`, jadi dua jenis satu produk memang boleh punya kemasan berbeda.
  await addUnit('SLOP', SLOP_FACTOR, menthol.id);
  const mentholSlop = await prisma.productUnit.findFirst({ where: { productId: PRODUCT, variantId: menthol.id, unitCode: 'SLOP' } });
  assert.ok(mentholSlop, 'satuan boleh terikat ke variant tertentu');
});

test('unit conversion is writable through the real service, not only by direct DB insert', async () => {
  // addUnit() di atas memakai prisma langsung. Kalau service-nya tidak bisa menulis, maka master
  // data ini hanya bisa diisi lewat SQL — dan operator tidak pernah bisa membuat satuan dari layar.
  // `@nestjs/microservices` dan `@nestjs/websockets` tidak terpasang di repo ini; Nest meng-import-nya
  // lewat @nestjs/core. Wajib external, kalau tidak esbuild gagal "Could not resolve" dan test
  // gagal karena lingkungan, bukan karena service.
  const carton = await masterData.createUnit(
    PRODUCT,
    { unitCode: 'KARTON', quantityFactor: KARTON_FACTOR, isDefaultSale: false, isDefaultPurchase: true },
    user,
  );
  assert.equal(carton.unitCode, 'KARTON');
  assert.equal(carton.quantityFactor, KARTON_FACTOR, '1 karton = 5 slop = 10 bungkus = 120 batang');

  // Dan service harus MENOLAK factor yang tidak masuk akal, bukan diam-diam menerimanya:
  // bought 2.5 pack tidak bisa jadi stok integer.
  await assert.rejects(
    () => masterData.createUnit(PRODUCT, { unitCode: 'PECAAN', quantityFactor: 0 }, user),
    (error) => {
      assert.match(String(error.message), /factor|quantityFactor|minimal|lebih besar/i,
        `penolakan harus menjelaskan aturannya, bukan hanya error: ${error.message}`);
      return true;
    },
  );
  const created = await prisma.productUnit.findFirst({ where: { productId: PRODUCT, unitCode: 'PECAAN' } });
  assert.equal(created, null, 'satuan tidak valid tidak boleh tersimpan');
});

test('the till really sells per slop: price, tax and stock all follow the factor', async () => {
  const slop = await addUnit('SLOP', SLOP_FACTOR, null, true);

  // 2 slop = 48 BATANG. Harga harus 2 x 24 x 1.250 = 60.000 — diturunkan dari
  // harga base BATANG dan factor unit, bukan diketik di sini.
  const expectedGross = 2 * (SLOP_FACTOR * SALE_PRICE_PER_BATANG);
  const created = await sales.create({
    warehouseId: 'wh-1',
    items: [{ productId: PRODUCT, quantity: 2, productUnitId: slop.id }],
    paymentMethod: 'CASH',
  }, user);

  assert.equal(Number(created.total), expectedGross,
    `2 slop harus dihargai 2 x ${SLOP_FACTOR} x ${SALE_PRICE_PER_BATANG}, bukan harga per unit statis`);

  // Bukti ke-DB: snapshot satuan harus tersimpan, karena inilah yang membuat "per slop" bisa dibuktikan.
  //
  // CATATAN bentuk: `SaleItem` tidak punya kolom `baseQuantity`. Field itu hidup di response QUOTE
  // (`resolveSellingUnitLine`), sementara tabel menyimpan `quantity` = baseQuantity, plus
  // `unitQuantity` + `quantityFactor` sebagai jejak satuan jualnya. Jadi yang di-assert di sini
  // adalah representation PERSISTEN — dan stok dibaca dari Inventory, bukan dari response.
  const item = created.items[0];
  assert.equal(item.unitCode, 'SLOP');
  assert.equal(item.quantityFactor, SLOP_FACTOR);
  assert.equal(item.unitQuantity, 2, '2 SLOP');
  assert.equal(item.quantity, 2 * SLOP_FACTOR,
    'kolom quantity menyimpan base unit terkecil (48 BATANG), karena seluruh stok dan HPP dihitung dalam base unit');

  const stock = await prisma.inventory.findFirst({ where: { warehouseId: 'wh-1', productId: PRODUCT } });
  assert.equal(stock.available, 1200 - 2 * SLOP_FACTOR,
    `stok harus berkurang ${2 * SLOP_FACTOR} BATANG, bukan 2 — kalau berkurang 2, "per slop" hanya kosmetik`);
});

test('the journal carries the package revenue, and the amount equals what the till charged', async () => {
  const revenue = await prisma.journalLine.aggregate({
    where: { account: { code: '4101' } },
    _sum: { credit: true, debit: true },
  });
  const cogs = await prisma.journalLine.aggregate({
    where: { account: { code: '5101' } },
    _sum: { debit: true, credit: true },
  });
  const expected = 2 * SLOP_FACTOR * SALE_PRICE_PER_BATANG;
  assert.equal(Number(revenue._sum.credit) - Number(revenue._sum.debit), expected,
    'revenue di jurnal harus sama dengan yang ditagih kasir — kalau tidak, laporan_vs kas akan menyimpang diam-diam');
  assert.ok(Number(cogs._sum.debit) > 0, 'HPP harus ikut ter-posting, kalau tidak laba kotor selalu 100%');
});

test('a sale line keeps a SNAPSHOT, so editing master data later cannot rewrite history', async () => {
  // Kalau SaleItem hanya menyimpan quantity, maka mengubah satuan masterdata setelah penjualan akan
  // mengubah ARTINATA transaksi lama — dan laporan pajak tahun lalu ikut berubah. Inilah alasan
  // snapshot ada di baris transaksi.
  const sale = await prisma.sale.findFirst({ orderBy: { createdAt: 'desc' } });
  const item = await prisma.saleItem.findFirst({ where: { saleId: sale.id } });
  await prisma.productUnit.updateMany({ where: { productId: PRODUCT, unitCode: 'SLOP' }, data: { quantityFactor: 99 } });
  const after = await prisma.saleItem.findFirst({ where: { saleId: sale.id } });
  assert.equal(after.quantityFactor, SLOP_FACTOR, 'faktor yang tersimpan harus tetap yang dipakai saat transaksi');
  assert.equal(after.quantity, 2 * SLOP_FACTOR, 'dan base quantity yang terposting tetap yang saat itu');
});

test('the POS client actually offers a unit selector — the server support alone is not a POS', async () => {
  // Server sudah bisa menjual per slop. Kalau layar kasir tidak pernah mengirim `productUnitId`, maka
  // kasir tidak punya jalan ke fitur itu dan dukungan di server sia-sia. Ini kelas "panel ada tapi
  // tidak ada yang me-mount-nya", yang di repo ini lolos beberapa gate.
  //
  // Bentuk assertion mengikuti file ASLI: repo ini merender satuan sebagai TOMBOL (`unitActions`),
  // bukan `<select><option>`. Versi pertama assertion saya mencari `<option>` dan merah — bukan
  // karena produk salah, tapi karena saya mengarang bentuk markup yang tidak pernah ada.
  const pos = fs.readFileSync(path.join(ROOT, 'apps/pos/app/page.tsx'), 'utf8');
  assert.match(pos, /className="unitActions"/,
    'POS harus punya permukaan pemilihan satuan; tanpa itu kasir tidak pernah melihat satuan');
  assert.match(pos, /unitCode:unit\.unitCode,quantityFactor:unit\.quantityFactor,productUnitId:unit\.id/,
    'tombol satuan harus mengirim productUnitId + factor, bukan hanya kode teks');
  assert.match(pos, /\{unit\.unitCode\} × \{unit\.quantityFactor\}/,
    'dan kasir harus MELIHAT unit + factor dinamis (contoh "SLOP × 24"), kalau tidak dia tidak tahu sedang menjual apa');
  assert.match(pos, /productUnitId: item\.productUnitId/,
    'pilihan itu harus dikirim ke server saat checkout');
  // Barcode per satuan adalah jalan kedua (scan slop langsung jadi slop).
  assert.match(pos, /barcodeCode/);
  // `apiOnline &&` menjaga agar satuan tidak ditampilkan saat server mati: harga satuan tanpa
  // konversi authoritative adalah tebakan, dan kasir lebih baik ditawari base unit saja.
  // Bentuk assertion ikut berubah karena daftar satuan sekarang per-VARIAN (`variantUnits`),
  // bukan `product.units` mentah — yang dikunci adalah MAKSUDNYA, yaitu satuan disembunyikan
  // saat server mati.
  assert.match(pos, /apiOnline && units\.length > 0/);
  assert.match(pos, /function variantUnits\(/,
    'satuan yang ditampilkan harus milik varian yang sedang dipilih');
});

test('BATAS yang ditutup: kasir memilih JENIS dari layar, dan SEMUA satuan terlihat', () => {
  // Test ini sebelumnya mengunci dua BATAS ("slice(0,4)" dan "tidak ada pemilih jenis") supaya
  // sesi berikutnya tidak melaporkannya sebagai fitur. Owned oleh proprietor untuk ditutup pada
  // 2026-10-01, jadi assertion-nya sekarang mengunci PERILAKU BARU — dan `doesNotMatch` supaya batas
  // lama tidak bisa diam-diam kembali.
  const pos = fs.readFileSync(path.join(ROOT, 'apps/pos/app/page.tsx'), 'utf8');
  const selector = pos.slice(pos.indexOf('className="unitActions"'), pos.indexOf('className="unitActions"') + 800);

  // (1) BATAS EMPAT sudah tidak ada. Produk dengan 5+ satuan harus menampilkan semuanya — memotong
  //     diam-diam berarti kasir tidak pernah tahu slop/karton ada.
  assert.doesNotMatch(selector, /\.slice\(0,\s*4\)/,
    'batas 4 satuan harus tetap tertutup: produk berkemasan banyak harus menampilkan semua satuan');
  assert.match(selector, /\{units\.map\(/,
    'satuan yang dirender harus berasal dari daftar hasil filter varian, tanpa pemotongan');

  // (2) Ada pemilih JENIS, dan choosing it benar-benar mengirim variantId ke keranjang.
  assert.match(pos, /<select[^>]*aria-label=\{`Jenis /,
    'kasir harus bisa memilih jenis dari layar, bukan hanya lewat scan barcode');
  assert.match(pos, /setVariantChoice\(/,
    'pemilih jenis harus menyimpan pilihan, kalau tidak tombolnya tidak mengubah apa pun');
  // INI yang paling penting dan yang test lama sendiri minta: memilih jenis harus sampai ke
  // `add()` sebagai variantId. Tanpa itu, `<select>` hanya hiasan.
  assert.match(pos, /onClick=\{\(\) => add\(product, 1, variant \? \{ variantId: variant\.id \}/,
    'klik produk harus mengirim variantId yang sedang dipilih ke keranjang');
  assert.match(pos, /variantId:\(unit\.variantId \?\? variant\?\.id\) \?\? undefined/,
    'tombol satuan juga harus membawa variantId, supaya satuan milik jenis lain tidak terkirim');
  // Dan varian harus dibaca dari data yang benar-benar dikirim server, bukan ditebak dari satuan.
  assert.match(pos, /variants\?: ProductVariant\[\]/,
    'tipe produk harus mendeklarasikan variants; kalau tidak, array dari server dibuang diam-diam');
  assert.match(pos, /function activeVariants\([\s\S]{0,160}variant\.isActive/,
    'hanya varian AKTIF yang boleh ditawarkan ke kasir');
  // Harga di layar harus mengikuti harga varian, kalau tidak kasir melihat angka yang salah.
  assert.match(pos, /function variantPrice\([\s\S]{0,320}variant\.salePrice/,
    'harga tampilan harus memakai salePrice varian saat varian punya harga sendiri');
});
test('BUG yang ditemukan UAT 2026-10-01: harga di layar tidak membedakan jenis', async () => {
  // Dua jenis satu produk = productId yang SAMA. Quote server dan keranjang kasir dulu
  // dicocokkan hanya lewat productId + barcodeCode, jadi `find()` selalu mengembalikan baris
  // PERTAMA untuk kedua jenis. Akibatnya kasir memilih "Kretek Menthol" (17.500), lalu memilih
  // "Dji Samso" (15.000), dan layar tetap menampilkan 17.500 untuk keduanya — kasir menjual
  // dengan angka yang salah. Ini ditemukan lewat UAT browser, bukan lewat membaca kode.
  await seed();
  const samso = await prisma.productVariant.create({ data: { productId: PRODUCT, code: 'DJI', name: 'Dji Samso', salePrice: 15000, isDefault: true } });
  const menthol = await prisma.productVariant.create({ data: { productId: PRODUCT, code: 'MEN', name: 'Kretek Menthol', salePrice: 17500 } });

  const pos = fs.readFileSync(path.join(ROOT, 'apps/pos/app/page.tsx'), 'utf8');

  // (a) Quote server WAJIB mengirim variantId. Tanpa itu layar tidak punya apa pun untuk
  //     mencocokkan dua jenis dari produk yang sama.
  const sales = fs.readFileSync(path.join(ROOT, 'apps/api/src/sales/sales.service.ts'), 'utf8');
  const quoteItems = sales.slice(sales.indexOf('items: raw.map((item) => ({'), sales.indexOf('items: raw.map((item) => ({') + 900);
  assert.match(quoteItems, /variantId: item\.conversion\.variantId/,
    'quote harus mengirim variantId per baris, kalau tidak dua jenis tidak bisa dibedakan di layar');
  assert.match(quoteItems, /sellingUnitPrice/,
    'dan harga jual per satuan harus ikut di baris yang sama, karena itulah yang ditampilkan');

  // (b) Pencocokan di POS WAJIB memakai variantId. Ini baris yang membuat harga jenis pertama
  //     bocor ke semua jenis lain.
  const match = pos.slice(pos.indexOf('const serverLine'), pos.indexOf('const serverLine') + 300);
  assert.match(match, /\(line\.variantId \?\? undefined\) === item\.variantId/,
    'pencocokan baris quote harus membedakan jenis; kalau hanya productId, harga jenis pertama dipakai untuk semua jenis');

  // (c) Harga fallback juga harus membedakan jenis. Subtotal dan kalkulasi offline memakai
  //     `productPrice(item.product)` yang mengabaikan jenis — kalau tidak, kasir menjumlahkan
  //     angka yang salah saat server belum menjawab.
  assert.doesNotMatch(pos, /productPrice\(item\.product\)/,
    'tidak boleh ada harga baris/subtotal/offline yang mengabaikan jenis yang dipilih');
  assert.match(pos, /function cartItemUnitPrice\(item: CartItem\)/,
    'satu helper harus menentukan harga per item keranjang, dipakai seragam di subtotal, offline, dan baris');
  const uses = ['cartItemUnitPrice(item) * item.quantity * item.quantityFactor', 'unitPrice: cartItemUnitPrice(item)', 'cartItemUnitPrice(item) * item.quantityFactor'];
  for (const use of uses) assert.ok(pos.includes(use), `helper harga harus dipakai di: ${use}`);
  assert.match(pos, /function cartItemUnitPrice\(item: CartItem\) \{ return variantPrice\(item\.product, shownVariant\(item\.product, item\.variantId\)\); \}/,
    'helper harus benar-benar membaca jenis yang dipilih, bukan memakai harga produk apa adanya');

  // (d) Nama jenis harus tampil di baris keranjang. Tanpa ini dua jenis produk yang sama tampil
  //     sebagai teks identik dan kasir tidak bisa memverifikasi apa yang dia jual.
  assert.match(pos, /className="variantTag"/, 'baris keranjang harus menyebut jenis yang dipilih');

  // Dan bukti japanauhnya: keranjang harus memisahkan dua jenis menjadi DUA baris.
  const keyFn = pos.slice(pos.indexOf('function cartLineKey'), pos.indexOf('function cartLineKey') + 220);
  assert.match(keyFn, /item\.variantId/,
    'kunci baris keranjang harus memuat variantId, supaya dua jenis tidakcollapse jadi satu baris');
  assert.equal(samso.isDefault, true, 'fixture: jenis default adalah yang pertama diurutkan server');
  assert.notEqual(menthol.id, samso.id, 'fixture: dua jenis harus benar-benar berbeda');
});
