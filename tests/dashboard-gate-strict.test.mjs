import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const uat = fs.readFileSync(path.join(repoRoot, 'scripts', 'browser-uat.mjs'), 'utf8');
const r7 = fs.readFileSync(path.join(repoRoot, 'scripts', 'ci-r7-ui-probe.mjs'), 'utf8');
const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'full-system-simulation.yml'), 'utf8');
const uatWf = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'toko360-full-uat.yml'), 'utf8');

// Konteks: gate dashboard sempat gagal berulang di runner. Penyebabnya adalah karena
// lingkarannya tidak tertutup - seed tidak pernah membuat Sale/SaleItem dan UAT juga
// tidak pernah membuat penjualan, sehingga di DB bersih tidak ada data dan syarat
// ['line','donut'] mustahil dipenuhi.
//
// Bahaya yang nyata: "memperbaiki" itu dengan melonggarkan syarat jadi
// "donut ATAU empty state". Itu RUPAK - begitu ada penjualan sungguhan, donut yang rusak
// akan lolos karena empty state tetap tampil. Gate tidak lagi bisa membedakan
// "benar-benar tidak ada data" dari "render rusak".
//
// Solusi yang benar: TUTUP lingkarannya (UAT membuat penjualan nyata lewat API kasir),
// bukan MEBUKANYA (menurunkan syarat). Tes-tes di bawah menjaga agar tidak ada jalan
// untuk melakukan yang kedua tanpa ketahuan.

test('gate dashboard tetap menuntut donut, tidak boleh jadi "donut ATAU empty state"', () => {
  assert.match(uat, /\['line','donut'\]\.every\(\(kind\)=>dashboardContract\.charts\.includes\(kind\)\)/,
    'browser UAT harus tetap mewajibkan chart line DAN donut');
  assert.doesNotMatch(uat, /evaluateProductMixContract\(dashboardContract\)/,
    'dual-branch donut-atau-empty-state tidak boleh dipakai: donut rusak akan lolos');
});

test('R7 juga tetap menuntut donut, bukan data-aware', () => {
  assert.match(r7, /\['line','donut'\]\.every\(\(kind\)\s*=>\s*analytics\.charts\??\.includes\(kind\)\)/,
    'R7 probe harus tetap mewajibkan line DAN donut');
  assert.doesNotMatch(r7, /evaluateProductMixContract/,
    'R7 tidak boleh memakai cabang data-aware');
});

test('UAT menyiapkan penjualan nyata lewat API sebelum memeriksa dashboard', () => {
  // Inilah bagian yang memperbaiki akar masalah: menutup lingkarannya.
  assert.match(uat, /T360_UAT_PREPARE_SALES/);
  assert.match(uat, /id: 'SALES_CI_FIXTURE'/);
  // Lewat API kasir (SalesService), bukan prisma.sale.create telanjang - supaya jurnal
  // akuntansi dan movement stok tetap konsisten.
  assert.match(uat, /const createdRes = await http\(`\$\{apiUrl\}\/sales`, \{\s*\n\s*method: 'POST', headers: \{ \.\.\.authHeaders, 'content-type': 'application\/json' \}/);
});

test('fixture penjualan idempoten supaya UAT berulang tidak menumpuk transaksi', () => {
  assert.match(uat, /action: 'EXISTING'/);
  assert.match(uat, /action: 'CREATED'/);
  // Penjualan dicek dulu sebelum dibuat, jadi UAT berulang tidak menumpuk transaksi.
  assert.match(uat, /const listRes = await http\(`\$\{apiUrl\}\/sales\?limit=1`/);
});

test('fixture penjualan gagal keras, bukan diam-diam dilewati', () => {
  // Kalau fixture gagal, donut tidak akan muncul dan gate berikutnya akan gagal dengan
  // pesan yang menyesatkan. Jadi fixture harus gagal sekarang dengan pesan yang jelas.
  assert.match(uat, /if \(!createdRes\.ok\) \{/);
  assert.match(uat, /Fixture penjualan CI gagal \(HTTP \$\{createdRes\.status\}\)/);
  assert.match(uat, /Katalog produk CI kosong; fixture penjualan tidak bisa dibuat/);
});

test('body API dibaca lewat .json(), bukan res.body', () => {
  // Bug nyata: http() mengembalikan Response mentah. Response punya .ok/.status tapi TIDAK
  // punya .body - `res.body?.items` selalu undefined sehingga katalog selalu terbaca kosong
  // dan fixture gagal dengan pesan yang menyesatkan ("Katalog produk CI kosong").
  // Hanya kode yang diperiksa: komentar penjelasan boleh menyebut `.body`.
  const uatCode = uat.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  // Hanya Response dari helper http() yang relevan; `document.body?.innerText` di dalam
  // evaluate browser context adalah DOM, bukan response API, jadi tidak ikut disaring.
  assert.doesNotMatch(uatCode, /(?:res|list|catalog|created|warehouses)\.body\?\./,
    'Response dari http() tidak punya .body - body harus lewat .json()');
  assert.match(uat, /const catalogBody = await catalogRes\.json\(\)/);
  assert.match(uat, /const listBody = await listRes\.json\(\)/);
});

test('kedua workflow runner menyalakan fixture penjualan', () => {
  for (const [name, content] of [['full-system-simulation', ci], ['toko360-full-uat', uatWf]]) {
    assert.match(content, /T360_UAT_PREPARE_SALES: 'true'/,
      `${name} harus menyalakan fixture penjualan, kalau tidak donut mustahil muncul`);
  }
});

// Bug nyata di runner 2026-10-02 (run 37032723106 / 37032723158): fixture penjualan
// sudah menutup SETENUH lingkaran penjualan, tapi lingkaran itu sendiri belum punya
// prasyarat stok. Di runner dengan SEED_MODE=bootstrap, seed tidak pernah membuat
// produk/supplier/stok (`fixtureSeed = demoSeed || uatSeed` -> false), jadi satu-satunya
// produk adalah fixture storefront yang dibuat TANPA stok. POST /sales lalu dijawab 400
// "Stok ... tidak mencukupi" dan seluruh gate hilir (p5VisualRebuild, r7Ui, r8Release,
// artifactTransport) ikut merah ONLY karena cascade.
//
// Laptop tetap hijau karena demo seed membuat produk beserta stok - persis kelas defect
// "hijau di folder kerja, merah di checkout bersih". Test di bawah mengunci bahwa stok
// fixture datang dari JALUR PRODUKSI penerimaan barang, bukan dari Menembak Inventory.
test('stok fixture penjualan lewat penerimaan barang produksi, bukan Menembak stok', () => {
  assert.match(uat, /async function ensureStockThroughReceiving\(/,
    'UAT harus punya jalur penerimaan barang untuk menyediakan stok fixture');
  assert.match(uat, /const receiving = await ensureStockThroughReceiving\(apiUrl, authHeaders, \{ product, warehouse, quantity: quantity \+ 1 \}\)/,
    'fixture harus menerima stok lewat jalur produksi dan menyisakan satu unit untuk journey tender POS');
  assert.match(uat, /id: 'SALES_CI_STOCK_RECEIVING'.*reservedForPosTenderUat: 1/);
  // Rantai produksi lengkap: supplier -> PO -> GRN -> inspeksi -> confirm.
  assert.match(uat, /await post\('\/suppliers', \{/, 'supplier wajib dibuat lewat API');
  assert.match(uat, /await post\('\/purchase-orders', \{/, 'PO wajib dibuat lewat API');
  assert.match(uat, /await post\('\/goods-receipts', \{/, 'GRN wajib dibuat lewat API');
  assert.match(uat, /await post\(`\/operations-control\/inspections\/\$\{inspectionId\}\/evidence`/,
    'policy PURCHASE_RECEIPT mewajibkan evidence foto + barcode sebelum inspeksi selesai');
  assert.match(uat, /await post\(`\/operations-control\/inspections\/\$\{inspectionId\}\/complete`/);
  assert.match(uat, /await post\(`\/operations-control\/inspections\/\$\{inspectionId\}\/approve`/);
  assert.match(uat, /await post\(`\/goods-receipts\/\$\{receipt\.id\}\/confirm`/,
    'hanya ConfirmGoodsReceipt yang menaruh Inventory, movement, dan jurnal akuntansi');
});

test('fixture penjualan tidak boleh melemahkan validasi stok', () => {
  // Jalan pintas yang akan membuat gate hijau: set allowNegativeStock, tulis Inventory
  // langsung, atau mengabaikan 400 dari /sales. Semua itu RUPAK - donut muncul padahal
  // stok dan neraca tidak sinkron.
  assert.doesNotMatch(uat, /allowNegativeStock/,
    'UAT tidak boleh menyalakan stok negatif untuk membuat penjualan lolos');
  assert.doesNotMatch(uat, /prisma\.inventory\.(upsert|create|update)/,
    'stok fixture tidak boleh ditulis langsung ke Prisma; jalur produksi wajib dipakai');
  assert.doesNotMatch(uat, /quantity: 0\b.*ignore/, 'tidak boleh ada jalur bypass stok');
});

test('penerimaan fixture gagal keras saat stok tetap tidak tersedia setelah confirm', () => {
  // Kalau confirm 201 tapi stok tetap tidak terlihat, akuntansi dan stok tidak sinkron.
  // Itu harus menggagalkan UAT dengan pesan jelas, bukan diteruskan ke POST /sales.
  assert.match(uat, /if \(available < quantity\) \{/);
  assert.match(uat, /tapi stok \$\{product\.name\} hanya \$\{available\}\/\$\{quantity\} di gudang/);
});

test('pesan kegagalan dashboard menyebut status fixture penjualan', () => {
  // Kalau gate gagal, harus jelas apakah penyebabnya data penjualan yang tidak terbentuk.
  assert.match(uat, /salesFixture: evidence\.checks\.find\(\(check\)=>check\.id==='SALES_CI_FIXTURE'\)/);
});

test('seed tidak boleh membuat penjualan palsu di produksi', () => {
  const seed = fs.readFileSync(path.join(repoRoot, 'apps', 'api', 'prisma', 'seed.ts'), 'utf8');
  // Mode uat hanya untuk lingkungan uji; produksi/staging memakai bootstrap.
  assert.match(seed, /if \(uatSeed && protectedEnvironment\)/,
    'SEED_MODE=uat harus ditolak pada produksi/staging');
  assert.match(seed, /SEED_MODE=uat tidak boleh dipakai pada NODE_ENV/);
});