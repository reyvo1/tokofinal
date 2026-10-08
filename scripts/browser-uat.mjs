import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBrowserDevTools(tempDir, browser, stderrText, requestedPort, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const activePortFile = path.join(tempDir, 'DevToolsActivePort');
  let last = '';
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) {
      throw new Error(`Chromium berhenti sebelum DevTools siap (exit ${browser.exitCode}). ${stderrText().slice(-1200)}`);
    }
    let port = requestedPort;
    if (!port && fs.existsSync(activePortFile)) {
      const [line] = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/);
      const parsed = Number(line);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) port = parsed;
    }
    if (port) {
      try {
        const response = await http(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) return port;
        last = `HTTP ${response.status}`;
      } catch (error) { last = error instanceof Error ? error.message : String(error); }
    }
    await sleep(250);
  }
  // Pesan sebelumnya hanya melaporkan "tidak siap", sehingga ALEH karena timeout (runner lambat)
  // dan ALEH karena Chrome menolak start (mis. D-Bus rusak) menjadi tidak bisa dibedakan.
  // Bedakan keduanya supaya kegagalan berikutnya bisa diperbaiki tanpa menebak.
  const stderr = stderrText();
  const refusedToStart = /Could not parse server address|Failed to connect to the bus|No usable sandbox|DevToolsActivePort.*permission/i.test(stderr);
  const reason = refusedToStart
    ? 'Chrome menolak start (bukan timeout) - lihat stderr Chrome di bawah'
    : `timeout ${timeoutMs}ms tanpa DevToolsActivePort`;
  throw new Error(`Chrome DevTools tidak siap: ${reason}${last ? ` (${last})` : ''}. ${stderr.slice(-1200)}`);
}
const root = process.cwd();
const output = path.resolve(root, process.env.T360_BROWSER_UAT_OUTPUT || 'handoff/quality/browser-uat-latest.json');
const adminUrl = process.env.T360_ADMIN_URL || 'http://localhost:3001';
const apiUrl = process.env.T360_API_URL || 'http://localhost:4000/api/v1';
const storefrontUrl = process.env.T360_STOREFRONT_URL || 'http://localhost:3000';
const posUrl = process.env.T360_POS_URL || 'http://localhost:3002';
const employeeUrl = process.env.T360_EMPLOYEE_URL || 'http://localhost:3003';
const surfaces = [
  ['storefront', storefrontUrl],
  ['admin', adminUrl],
  ['pos', posUrl],
  ['employeePortal', employeeUrl],
];

const adminContextualWorkflowMap = JSON.parse(fs.readFileSync(path.join(root, 'config', 'admin-contextual-workflow-map.json'), 'utf8'));
const p5VisualSurfaceMap = JSON.parse(fs.readFileSync(path.join(root, 'config', 'p5-visual-surface-map.json'), 'utf8'));
const adminContextualRoutes = new Map();
for (const row of adminContextualWorkflowMap.rows ?? []) {
  const route = `/${row.workspace}/${row.view}`;
  if (adminContextualRoutes.has(route)) throw new Error(`Duplicate canonical Admin contextual route: ${route}`);
  adminContextualRoutes.set(route, row);
}

function canonicalAdminContext(route) {
  return adminContextualRoutes.get(route) ?? null;
}

function browserExecutable() {
  const candidates = [process.env.T360_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=';

// Menerima stok lewat JALUR PRODUKSI yang sama dengan purchaser, bukan menulis baris
// Inventory telanjang.
//
// Ini menutup lingkaran prasyarat yang BELUM lengkap. Fixture penjualan lama membuat
// Sale lewat /sales, tapi tidak pernah menyediakan stok: di runner dengan
// SEED_MODE=bootstrap, seed tidak membuat produk/supplier/stok sama sekali
// (`fixtureSeed = demoSeed || uatSeed` -> false). Satu-satunya produk adalah fixture
// storefront, yang dibuat tanpa stok. Jadi POST /sales dijawab 400 "Stok ... tidak
// mencukupi" - bukan karena program salah, tapi karena lingkarannya tidak ditutup.
//
// Di laptop demo seed membuat produk BERSERTA stok, jadi fixture ini hijau di sini dan
// merah di runner. Itu kelas defect yang hanya terlihat di checkout/DB bersih.
//
// POST /sales hanya menolak, jadi satu-satunya cara sah adalah penerimaan: supplier
// -> PO -> GRN -> inspeksi (foto + scan barcode) -> approve -> confirm. ConfirmGoodsReceipt
// yang menaruh Inventory, InventoryLocationBalance, InventoryMovement, dan jurnal
// akuntansi. Kalau stok ditembakkan langsung ke DB, donut dashboard bisa muncul tapi
// neraca tidak akan pernah balance - itu persis gate yang harus gagal.
async function ensureStockThroughReceiving(apiUrl, authHeaders, { product, warehouse, quantity }) {
  const stamp = `${Date.now()}-${process.pid}`;
  const post = async (route, body, label) => {
    const res = await http(`${apiUrl}${route}`, {
      method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${label} gagal (HTTP ${res.status}): ${JSON.stringify(parsed).slice(0, 300)}`);
    return parsed;
  };

  // Supplier: bootstrap seed tidak pernah membuatnya, jadi fixture yang harus membuat.
  // Kode di-suffix stamp supaya UAT berulang tidak bentrok pada unique constraint.
  const supplier = await post('/suppliers', {
    code: `CI-UAT-SUP-${stamp}`, name: `CI UAT Supplier ${stamp}`, paymentTermDays: 0,
  }, 'Fixture supplier CI gagal');

  // PO disetujui otomatis oleh PurchaseOrdersService (status APPROVED), jadi penerimaan
  // bisa langsung menyusul tanpa turnaround persetujuan - persis alur emergency receive di produksi.
  const order = await post('/purchase-orders', {
    supplierId: supplier.id, warehouseId: warehouse.id,
    idempotencyKey: `CI-UAT-PO-${stamp}`,
    items: [{ productId: product.id, orderedQty: quantity, unitCost: Number(product.costPrice ?? 1000) }],
  }, 'Fixture PO CI gagal');
  const orderItem = (order?.items || []).find((item) => item.productId === product.id);
  if (!orderItem?.id) throw new Error(`Fixture PO CI tidak mengembalikan item untuk produk ${product.id}.`);

  // GRN membuat OperationalInspection (sourceType GoodsReceipt) + result rows otomatis.
  const receipt = await post('/goods-receipts', {
    purchaseOrderId: order.id, idempotencyKey: `CI-UAT-GRN-${stamp}`,
    items: [{ purchaseOrderItemId: orderItem.id, quantityReceived: quantity }],
  }, 'Fixture GRN CI gagal');
  const inspectionId = receipt?.inspectionId;
  if (!inspectionId) throw new Error('Fixture GRN CI tidak membuat inspeksi; policy PURCHASE_RECEIPT mewajibkannya.');

  // Policy PURCHASE-RECEIPT-DEFAULT: requirePhoto + requireBarcodeScan, keduanya
  // `verifiedByServer`. Scan harus mencocokkan product.barcode atau product.sku pada
  // receipt, dan scannedQty harus mencapai expectedQty per baris produk.
  const scanValue = product.barcode || product.sku;
  if (!scanValue) throw new Error(`Produk ${product.id} tidak punya barcode maupun SKU untuk scan evidence.`);
  await post(`/operations-control/inspections/${inspectionId}/evidence`, {
    evidenceType: 'PHOTO', mimeType: 'image/png', dataBase64: ONE_PIXEL_PNG_BASE64,
    metadata: { uat: 'SALES_CI_FIXTURE' },
  }, 'Evidence foto inspeksi CI gagal');
  for (let scan = 0; scan < quantity; scan += 1) {
    await post(`/operations-control/inspections/${inspectionId}/evidence`, {
      evidenceType: 'BARCODE', value: scanValue, metadata: { uat: 'SALES_CI_FIXTURE', scan: scan + 1 },
    }, 'Evidence barcode inspeksi CI gagal');
  }

  // Checklist template wajib (semua item RECEIVING-STANDARD required) harus diputuskan
  // PASS/FAIL; baris produk harus cocok dengan kuantitas GRN. CompleteInspection
  // menolak jika angkanya tidak sama persis dengan dokumen penerimaan.
  const inspectionRes = await http(`${apiUrl}/operations-control/inspections?limit=100`, { headers: authHeaders });
  const inspectionBody = await inspectionRes.json().catch(() => null);
  if (!inspectionRes.ok) throw new Error(`Daftar inspeksi CI gagal (HTTP ${inspectionRes.status}).`);
  const inspection = (Array.isArray(inspectionBody?.items) ? inspectionBody.items : []).find((item) => item.id === inspectionId);
  if (!inspection) throw new Error(`Inspeksi ${inspectionId} tidak terlihat di daftar inspeksi CI.`);
  const results = (inspection.results || []).map((row) => ({
    ...(row.templateItemId ? { templateItemId: row.templateItemId } : {}),
    code: row.code, label: row.label, result: 'PASS',
    ...(row.productId ? { productId: row.productId } : {}),
    ...(row.expectedQty !== null && row.expectedQty !== undefined
      ? { expectedQty: row.expectedQty, acceptedQty: row.expectedQty, rejectedQty: 0, damagedQty: 0, missingQty: 0, extraQty: 0 }
      : {}),
    ...(row.scannedQty !== null && row.scannedQty !== undefined ? { scannedQty: row.scannedQty } : {}),
  }));
  const completed = await post(`/operations-control/inspections/${inspectionId}/complete`, {
    results, notes: 'CI UAT receiving inspection',
  }, 'Penyelesaian inspeksi CI gagal');
  if (!['PASSED', 'APPROVED', 'PARTIAL'].includes(completed?.status)) {
    throw new Error(`Inspeksi CI berstatus ${completed?.status} sehingga penerimaan tidak bisa dikonfirmasi.`);
  }
  await post(`/operations-control/inspections/${inspectionId}/approve`, { notes: 'CI UAT receiving approval' }, 'Persetujuan inspeksi CI gagal');
  await post(`/goods-receipts/${receipt.id}/confirm`, { inspectionId, notes: 'CI UAT receiving confirm' }, 'Konfirmasi GRN CI gagal');

  // Fail-closed: sympatikan stok benar-benar tersedia sebelum penjualan. Kalau confirm
  // succeeds tapi stok tetap tidak terlihat, akuntansi dan stok tidak sinkron dan itu
  // harus menggagalkan UAT, bukan diteruskan ke POST /sales untuk menghasilkan 400.
  const inventoryRes = await http(`${apiUrl}/inventory?warehouseId=${warehouse.id}&limit=100`, { headers: authHeaders });
  const inventoryBody = await inventoryRes.json().catch(() => null);
  if (!inventoryRes.ok) throw new Error(`Stok gudang CI gagal dibaca (HTTP ${inventoryRes.status}).`);
  const stock = (Array.isArray(inventoryBody?.items) ? inventoryBody.items : []).find((row) => row.productId === product.id);
  const available = Number(stock?.available ?? 0);
  if (available < quantity) {
    throw new Error(`Penerimaan CI dianggap sukses tetapi stok ${product.name} hanya ${available}/${quantity} di gudang.`);
  }
  return { action: 'RECEIVED', supplierId: supplier.id, purchaseOrderId: order.id, goodsReceiptId: receipt.id, inspectionId, available };
}

async function http(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

async function stopBrowserProcess(browser) {
  if (!browser || browser.exitCode !== null) return;
  browser.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => browser.once('exit', resolve)),
    sleep(3000),
  ]);
  if (browser.exitCode === null) {
    browser.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      sleep(2000),
    ]);
  }
}

async function removeBrowserProfile(tempDir) {
  if (!tempDir) return;
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); return; }
    catch (error) {
      lastError = error;
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('Browser profile cleanup gagal.');
}

async function waitHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await http(url);
      last = `HTTP ${response.status}`;
      if (response.ok) return response.status;
    } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await sleep(500);
  }
  throw new Error(`${url} tidak siap (${last || 'timeout'}).`);
}

class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout membuka Chrome DevTools Protocol.')), 10000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome DevTools Protocol gagal terhubung.')); }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method) {
        for (const handler of this.listeners.get(message.method) || []) {
          try { handler(message.params || {}); } catch {}
        }
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id); this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP error')); else resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => this.listeners.get(method)?.delete(handler);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitExpression(cdp, expression, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result?.result?.value) return;
      last = result?.exceptionDetails?.text || '';
    } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await sleep(300);
  }
  throw new Error(`${label} tidak ditemukan${last ? `: ${last}` : ''}.`);
}

async function navigateAndAssert(cdp, url, expression, label, timeoutMs = 45000) {
  await cdp.call('Page.navigate', { url });
  await waitExpression(cdp, `document.readyState === 'complete' && (${expression})`, label, timeoutMs);
}

async function navigateAdminContext(cdp, route, label, timeoutMs = 45000) {
  const context = canonicalAdminContext(route);
  if (!context) throw new Error(`${label}: route contextual tidak terdaftar di config/admin-contextual-workflow-map.json: ${route}`);
  const url = `${adminUrl.replace(/\/+$/, '')}${route}`;
  await cdp.call('Page.navigate', { url });
  const routeJson = JSON.stringify(route);
  const workspaceJson = JSON.stringify(context.workspace);
  const viewJson = JSON.stringify(context.view);
  const activeTabSelectorJson = JSON.stringify(`.adminSidebarSubdomains [data-admin-route="${route}"][aria-current="page"]`);
  await waitExpression(cdp, `document.readyState === 'complete' && location.pathname === ${routeJson} && document.querySelector('#admin-main')?.getAttribute('data-admin-workspace') === ${workspaceJson} && document.querySelector('#admin-main')?.getAttribute('data-admin-view') === ${viewJson} && Boolean(document.querySelector(${activeTabSelectorJson}))`, label, timeoutMs);
}

async function evaluateValue(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result?.exceptionDetails) {
    // exceptionDetails.text untuk SyntaxError hanya berisi kata "Uncaught" - namaexception-nya
    // ada di exception.className/description. Tanpa ini, satu backslash atau satu kurung yang
    // salah di dalam template literal muncul sebagai "Uncaught" tanpa baris dan tanpa sumber,
    // dan biayanya beberapa run penuh untuk ditelusuri. Term Throw di sini menyebut exception
    // yang sebenarnya beserta baris dan kolomnya.
    const detail = result.exceptionDetails;
    const ex = detail.exception || {};
    const why = ex.description || detail.text || 'Browser evaluation gagal.';
    const where = Number.isInteger(detail.lineNumber)
      ? ` (line ${detail.lineNumber + 1}${Number.isInteger(detail.columnNumber) ? ':' + (detail.columnNumber + 1) : ''})`
      : '';
    const cls = ex.className ? ` [${ex.className}]` : '';
    throw new Error(`${why}${cls}${where}`);
  }
  return result?.result?.value;
}

// Kumpulkan rantai ancestor untuk elemen yang meluber. Dipanggil PADA SAAT error sudah terjadi,
// jadi tujuannya menjelaskan penyebab - bukan memverifikasi layout. Wajib tidak melempar:
// diagnostik yang menutupi bukti adalah regresi, bukan bantuan.
async function describeOverflowChains(cdp) {
  try {
    return await evaluateValue(cdp, `(() => {
      const limit = Number(innerWidth) + 3;
      const offenders = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > limit;
      }).slice(0, 6);
      return offenders.map((el) => {
        const chain = [];
        let n = el;
        let depth = 0;
        while (n && n.nodeType === 1 && depth < 9) {
          const r = n.getBoundingClientRect();
          let cs = null;
          try { cs = getComputedStyle(n); } catch (e) { cs = null; }
          chain.push([
            n.tagName + (n.className ? '.' + String(n.className).trim().split(/\s+/).join('.') : ''),
            'L' + Math.round(r.left),
            'R' + Math.round(r.right),
            'W' + Math.round(r.width),
            cs ? ('minW:' + cs.minWidth) : 'minW:?',
            cs ? cs.display : '?',
            cs ? ('ovx:' + cs.overflowX) : 'ovx:?',
            cs ? ('sw:' + n.scrollWidth + '/cw:' + n.clientWidth) : 'sw:?',
          ].join(' '));
          if (n.tagName === 'HTML') break;
          n = n.parentElement;
          depth += 1;
        }
        return chain;
      });
    })()`);
  } catch {
    return ['<chain collection failed>'];
  }
}

// Emulasi viewport harus deterministik di runner.
// Memakai mobile:true membuat Chrome menerapkan emulasi viewport-meta sehingga innerWidth
// mengikuti meta tag aplikasi, bukan ukuran yang kita minta. Terbukti di runner: viewport 390x844
// diukur sebagai innerWidth=679, sehingga scrollWidth=679 yang dilaporkan sebagai overflow padahal
// tidak ada elemen yang melewati viewport. Layout responsif ditentukan oleh CSS media query yang
// bergantung pada LEBAR, bukan pada flag mobile, jadi mobile:false tetap menguji layout mobile
// dengan benar - dan membuat hasilnya sama di lokal maupun runner.
async function applyViewportEmulation(cdp, width, height) {
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  await cdp.call('Emulation.setVisibleSize', { width, height });
  await sleep(250);
  const actual = await evaluateValue(cdp, '({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })');
  if (!actual || actual.innerWidth !== width) {
    throw new Error(`Emulasi viewport tidak diterapkan: diminta ${width}x${height}, terukur ${actual?.innerWidth}x${actual?.innerHeight}`);
  }
  return actual;
}

async function assertViewportIntegrity(cdp, label, width, height) {
  await applyViewportEmulation(cdp, width, height);
  // Drawer off-canvas yang TERTAKIK (`transform: translateX(-100%)`) berada di kiri layar secara
  // SENGAJA saat tertutup - itu pola navigasi mobile yang benar, bukan konten terpotong.
  // Check lama menandainya sebagai overflow, sehingga UAT gagal pada layout yang justru benar.
  //
  // Memverifikasi "tidak overflow" SAJA tidak cukup untuk drawer: yang harus terbukti adalah
  // isinya bisa DICAPAI. Jadi drawer dibuka lewat tombol "Buka menu" yang sebenarnya, lalu
  // diperiksa lagi - dan setelah itu dikembalikan ke tertutup. Void drawer yang tidak bisa
  // dibuka akan terdeteksi di situ, bukan lolos karena dikecualikan.
  const openOffCanvasDrawer = async () => evaluateValue(cdp, `(() => {
    const toggle = document.querySelector('button[aria-label="Buka menu"]');
    if (!toggle) return { found: false };
    toggle.click();
    return { found: true };
  })()`);
  const closeOffCanvasDrawer = async () => evaluateValue(cdp, `(() => {
    const closer = document.querySelector('button[aria-label="Tutup menu"]')
      || document.querySelector('.adminSidebarBackdrop');
    if (closer) closer.click();
    return { closed: Boolean(closer) };
  })()`);

  const measure = () => evaluateValue(cdp, `(() => {
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0);
    // Drawer yang TERTAKAK (tidak punya kelas .mobileOpen) berada di luar layar secara
    // SENGAJA - itu pola navigasi mobile yang benar. Elemen di dalam subtree-nya saat tertutup
    // tidak boleh dilaporkan sebagai overflow; yang dilaporkan adalah state TERBUKA, di situ
    // drawer wajib benar-benar berada di dalam viewport. Header drawer sendiri tetap diperiksa
    // lewat selector yang tidak masuk subtree aside.
    const parkedDrawer = document.querySelector('.adminV4Sidebar:not(.mobileOpen)');
    const drawerOpen = Boolean(document.querySelector('.adminV4Sidebar.mobileOpen'));
    const drawerParked = Boolean(parkedDrawer) && !drawerOpen;
    // Elemen di dalam container yang SENGAJA bisa di-scroll (overflow-x/y auto|scroll) boleh lebih
    // lebar dari viewport - itu justru makna overflow-x auto. Kelas .table di Admin punya
    // overflow-x: auto dan kelas .tr punya min-width: 660px, jadi setiap baris tabel PASTI lebih
    // lebar dari area konten di 1440. Menandainya sebagai overflow dokumen sama salahnya dengan
    // menandai drawer tertutup sebagai konten terpotong.
    // Kontainer scrollable sendiri yang tetap diperiksa (lihat clippedScrollables) - supaya
    // tabel yang benar-benar tidak bisa digeser tidak lolos hanya karena anak-anaknya dikecualikan.
    const isScrollable = (el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY);
    };
    // Ancestor yang memotong (clip) kotak anak. Termasuk overflow hidden|clip yang SENGAJA
    // dipakai untuk dekorasi: di Employee Portal, lingkaran blur dekoratif memakai kelas
    // absolute -right-16 di dalam panel overflow-hidden, sehingga elemennya menjangkau
    // R1471 pada viewport 1440 padahal benar-benar ter-clip dan scrollWidth dokumen tetap 1440.
    // Kontainer scrollable (auto|scroll) juga salah satu bentuk clipping dan tetap dipakai,
    // hanya bedanya kontennya masih bisa digeser user.
    const clipsChildren = (el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll|hidden|clip)/.test(cs.overflowX) || /(auto|scroll|hidden|clip)/.test(cs.overflowY);
    };
    const all = [...document.querySelectorAll('body *')];
    const scrollables = all.filter(isScrollable);
    const scrollableAncestors = (el) => el !== document.body && Boolean(el.closest('*')) && scrollables.some((c) => c !== el && c.contains(el));
    const clippingAncestors = (el) => {
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (clipsChildren(parent)) return true;
      }
      return false;
    };
    // Kontainer yang isinya meluber tapi TIDAK bisa digeser = konten hilang permanen.
    const clippedScrollables = scrollables
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return el.scrollWidth > el.clientWidth + 1 && r.right > innerWidth + 3;
      })
      .slice(0, 6)
      .map((el) => ({ tag: el.tagName, className: String(el.className || '').slice(0,120), rect: el.getBoundingClientRect().toJSON() }));
    const overflow = [...document.querySelectorAll('body *')].filter((el) => {
      const style = getComputedStyle(el);
      if (style.position === 'fixed' && el.classList.contains('modalOverlay')) return false;
      // Saat drawer tertutup, isi sidebar memang di luar layar - itu konsekuensi translateX(-100%).
      // Memverifikasi bahwa drawer bisa dibuka dan isinya terjangkau dilakukan terpisah, dengan
      // mengklik tombol "Buka menu" sungguhan.
      if (drawerParked && el.closest('.adminV4Sidebar')) return false;
      // Kalau elemen ini berada di dalam (atau adalah) container yang bisa di-scroll, kelebihannya
      // itu ditangani container itu, bukan overflow dokumen. scrollable dihitung sekali di atas
      // supaya filter ini tidak O(n^2) pada halaman dengan ribuan elemen.
      //
      // PENTING: body overflow-x hidden membuat scrollWidth dokumen SELALU sama dengan
      // clientWidth, jadi scrollWidth tidak bisa membedakan "ter-clip" dari "bocor". Bukti di
      // halaman Accounting: scrollWidth=1425 (=clientWidth) sementara .tr menjangkau R1519.
      // Artinya .tr sudah ter-clip .table dan itu konten yang bisa di-scroll - bukan kebocoran.
      // Satu-satunya sumber kebenaran adalah clipping ancestor, jadi itu yang dipakai di sini.
      if (scrollableAncestors(el) || clippingAncestors(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.right > innerWidth + 3 || r.left < -3);
    }).slice(0, 12).map((el) => ({ tag: el.tagName, className: String(el.className || '').slice(0,120), text: String(el.textContent || '').trim().slice(0,100), rect: el.getBoundingClientRect().toJSON() }));
    // Diagnosa mentah: elemen yang menjangkau luar viewport TANPA filter apa pun, plus alasan
    // setiap elemen tidak muncul di daftar overflow. Tanpa ini, kegagalan di runner hanya
    // melaporkan scrollWidth besar dengan elements kosong sehingga akar masalahnya tidak diketahui.
    const rawOffenders = [...document.querySelectorAll('body *')].map((el) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const beyond = r.right > innerWidth + 3 || r.left < -3;
      const parked = drawerParked && Boolean(el.closest('.adminV4Sidebar'));
      const inScrollable = scrollableAncestors(el);
      const inClipping = clippingAncestors(el);
      const visible = r.width > 0 && r.height > 0;
      const excludedBecause = !beyond ? 'tidak melewati viewport'
        : !visible ? 'ukuran nol'
        : parked ? 'drawer admin diparkir'
        : (inScrollable || inClipping) ? 'ter-clip ancestor'
        : null;
      return { el, beyond, excludedBecause };
    });
    const rawOverflowList = rawOffenders
      .filter((entry) => entry.beyond)
      .sort((a, b) => (b.el.getBoundingClientRect().right - b.el.getBoundingClientRect().left) - (a.el.getBoundingClientRect().right - a.el.getBoundingClientRect().left))
      .slice(0, 10)
      .map((entry) => {
        const r = entry.el.getBoundingClientRect();
        const cs = getComputedStyle(entry.el);
        // Computed style WAJIB ikut dilaporkan. Geometri saja tidak bisa membedakan
        // "CSS tidak ter-apply" dari "CSS ter-apply tapi track grid melebar": pada runner
        // .table terukur 642px (= 640 min-width .tr + 2px border) sementara reproduksi
        // lokal dengan CSS yang sama terukur 348px. Tanpa nilai computed, keduanya hanya
        // tebakan. Parent pertama juga dilaporkan sebagai pembanding.
        const parent = entry.el.parentElement;
        const pcs = parent ? getComputedStyle(parent) : null;
        return {
          tag: entry.el.tagName,
          className: String(entry.el.className || '').slice(0, 110),
          position: cs.position,
          display: cs.display,
          excludedBecause: entry.excludedBecause,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          cssWidth: cs.width,
          cssMaxWidth: cs.maxWidth,
          cssMinWidth: cs.minWidth,
          cssOverflowX: cs.overflowX,
          parentTag: parent ? parent.tagName : null,
          parentClass: parent ? String(parent.className || '').slice(0, 90) : null,
          parentWidth: parent ? Math.round(parent.getBoundingClientRect().width) : null,
          parentDisplay: pcs ? pcs.display : null,
          parentCssWidth: pcs ? pcs.width : null,
          parentCssMinWidth: pcs ? pcs.minWidth : null,
        };
      });
    return { innerWidth, scrollWidth, overflow, clippedScrollables, rawOverflow: rawOverflowList, drawerOpen: Boolean(document.querySelector('.adminV4Sidebar.mobileOpen')) };
  })()`);

  const closed = await measure();
  // clippedScrollables WAJIB ikut digagalkan. Kalau hanya `overflow` yang diperiksa, maka
  // pengecualian anak container scrollable menjadi jalan keluar tanpa pengawas: tabel yang
  // isinya meluber tapi tidak bisa digeser akan lolos. Dua-duanya wajib kosong.
  // innerWidth WAJIB ikut diverifikasi, bukan hanya scrollWidth. Kalau device metrics override
  // tidak diterapkan dan halaman tetap pada lebar sebelumnya, maka scrollWidth == innerWidth
  // yang lebih besar dari viewport yang diminta; membandingkannya terhadap lebar yang DIMINTA
  // akan melaporkan overflow padahal tidak ada yang bocor. Kegagalan runner 390x844 ->
  // scrollWidth=679 dengan elements kosong dan rawOverflow kosong persis bentuknya.
  // Dua-duanya tetap wajib terpenuhi: emulasi harus benar-benar berlaku, dan tidak boleh bocor.
  const viewportMismatch = closed && closed.innerWidth !== width;
  if (!closed || viewportMismatch || closed.scrollWidth > width + 3 || closed.overflow.length || closed.clippedScrollables.length) {
    // Kumpulkan rantai ancestor di panggilan CDP TERPISAH, bukan di dalam evaluate yang sama.
    // Kalau diukur inline, satu error runtime di sana menutupi pesan overflow yang
    // justru informatif (terbukti: attempt inline menghasilkan "Uncaught" kosong).
    // Fungsi ini tidak boleh melempar - diagnostik tidak boleh mengganti bukti.
    const chains = await describeOverflowChains(cdp);
    throw new Error(`${label} overflow pada ${width}x${height} (drawer tertutup): innerWidth=${closed?.innerWidth} diminta=${width}; scrollWidth=${closed?.scrollWidth}; elements=${JSON.stringify(closed?.overflow || [])}; clippedScrollables=${JSON.stringify(closed?.clippedScrollables || [])}; rawOverflow=${JSON.stringify(closed?.rawOverflow || [])}; chains=${JSON.stringify(chains)}`);
  }

  // Kalau ada drawer off-canvas di halaman ini, buka lewat tombolnya dan pastikan isinya
  // benar-benar terjangkau - inilah yang tidak pernah dibuktikan check lama.
  const opened = await openOffCanvasDrawer();
  if (opened?.found) {
    await sleep(320);
    const metrics = await measure();
    if (!metrics || metrics.scrollWidth > width + 3 || metrics.overflow.length || metrics.clippedScrollables.length) {
      await closeOffCanvasDrawer();
      throw new Error(`${label} overflow pada ${width}x${height} (drawer TERBUKA): scrollWidth=${metrics?.scrollWidth}; elements=${JSON.stringify(metrics?.overflow || [])}; clippedScrollables=${JSON.stringify(metrics?.clippedScrollables || [])}`);
    }
    await closeOffCanvasDrawer();
    await sleep(220);
    return { label, width, height, scrollWidth: metrics.scrollWidth, drawerVerified: true };
  }
  return { label, width, height, scrollWidth: closed.scrollWidth, drawerVerified: false };
}

async function assertResponsiveMatrix(cdp, label) {
  const checks = [];
  for (const [width,height] of [[1440,900],[1024,768],[390,844]]) checks.push(await assertViewportIntegrity(cdp,label,width,height));
  await applyViewportEmulation(cdp, 1440, 900);
  return checks;
}


async function assertP5V4VisualIdentity(cdp, product, options = {}) {
  const metrics = await evaluateValue(cdp, `(() => {
    const root = document.querySelector('[data-visual-product="${product}"]');
    if (!(root instanceof HTMLElement)) return null;
    const parse = (value) => {
      // Escape ganda WAJIB. Kode ini berada di dalam template literal, jadi satu backslash
      // ditelan JavaScript sebelum string sampai ke evaluateValue: /\d+/ di dalam
      // template literal berakhir jadi /d+/ di regex, yang tidak pernah match "rgb(244,...)".
      // Akibatnya parse selalu null, luminance selalu null, dan check tema ini praktis tidak
      // pernah menguji apa pun - ia hanya gagal karena null, bukan karena warnanya salah.
      // Dibuktikan di Node: expression.includes('\\\\d') === false tanpa double-escape.
      const text = String(value || '').trim();
      // Hex harus ditangani terpisah. Regex angka applied ke "#fafaf9" menghasilkan
      // [0, 0, 4] - nol dari huruf dan "4" yang bukan komponen warna - sehingga setiap gradient
      // hex terbaca gelap. Terbukti: storefront light #fafaf9 terbaca luminance 145 (butuh >=190).
      const hexMatch = text.match(/^#([0-9a-fA-F]{3,8})$/);
      if (hexMatch) {
        let h = hexMatch[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
        if (h.length !== 6 && h.length !== 8) return null;
        const to = (i) => parseInt(h.slice(i, i + 2), 16);
        if (h.length === 8 && to(6) === 0) return null;
        return [to(0), to(2), to(4)];
      }
      // Alpha HARUS diambil sebelum slice(0,3): memotong lebih dulu membuat nums.length selalu
      // <= 3 sehingga alpha selalu undefined dan rgba(0,0,0,0) lolos sebagai [0,0,0] - yaitu
      // "hitam", bukan transparan.
      const all = text.match(/\\d+(?:\\.\\d+)?/g)?.map(Number) || [];
      if (all.length < 3) return null;
      // Alpha 0 berarti WARNA BELUM DIWARNAI (transparan), bukan hitam. Tanpa ini check
      // menyimpulkan "legacy dark skin" pada elemen yang justru tidak berwarna - persis yang
      // terjadi di storefront: root report rgba(0, 0, 0, 0).
      // Tanpa regex, hanya startsWith. Regex untuk pencocokan rgba membutuhkan tiga lapis
      // escaping backslash di dalam template literal, dan satu lapis yang salah menghasilkan
      // SyntaxError Unterminated group - sudah terjadi dua kali di file ini dan biayanya
      // beberapa run UAT penuh untuk ditelusuri.
            const isRgba = text.startsWith('rgb');
      if (isRgba && all.length > 3 && all[3] === 0) return null;
      return all.slice(0, 3);
    };
    // Semua color-stop dalam gradient. "radial-gradient(circle at 90% 0%, rgba(...), transparent
    // 26%), linear-gradient(180deg, #fafaf9 0%, #f5f5f4 100%)" - angka 90/0/0 adalah posisi,
    // sebagai warna, jadi hanya rgb()/rgba() dan #hex yang dibaca.
    const gradientStops = (value) => {
      const text = String(value || '');
      if (!text.includes('gradient(')) return [];
      const stops = [];
      for (const m of text.matchAll(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/g)) {
        const parsed = parse(m[0]);
        if (parsed) stops.push(parsed);
      }
      return stops;
    };
    const luminance = (rgb) => rgb ? (0.2126*rgb[0] + 0.7152*rgb[1] + 0.0722*rgb[2]) : null;
    const rootStyle = getComputedStyle(root);
    const sidebar = document.querySelector('aside[aria-label="Navigasi Admin"]');
    const sidebarStyle = sidebar instanceof HTMLElement ? getComputedStyle(sidebar) : null;
    const rootRgb = parse(rootStyle.backgroundColor);
    const sidebarRgb = sidebarStyle ? parse(sidebarStyle.backgroundColor) : null;
    return {
      generation: root.getAttribute('data-visual-generation'),
      version: root.getAttribute('data-visual-version'),
      rootBackground: rootStyle.backgroundColor,
      rootBackgroundImage: rootStyle.backgroundImage,
      // Warna yang benar-benar TERLIHAT: kalau backgroundColor transparan tapi backgroundImage
      // berisi gradient, warnanya ada di gradient. Storefront memakai
      // linear-gradient(180deg,#fafaf9,#f5f5f4) untuk light dan #0b1220/#0a0f1a untuk dark, jadi
      // hanya membaca backgroundColor selalu menghasilkan transparan dan check menyimpulkan
      // "legacy dark skin" pada root yang justru terang.
      // Untuk gradient, warna ada di setiap color-stop. Ambil SEMUA stop dan nilai yang paling
      // terang untuk mode light: composite visual sebuah gradient ditentukan oleh lightest stop
      // yang terlihat, dan storefront light memakai #fafaf9 -> #f5f5f4 (keduanya terang).
      // Mengambil tiga angka PERTAMA tidak benar: "radial-gradient(circle at 90% 0%,...)"
      // menghasilkan 90, 0, 0 yang bukan warna sama sekali.
      rootLuminance: rootRgb
        ? luminance(rootRgb)
        : Math.max(...gradientStops(rootStyle.backgroundImage).map(luminance).filter((v) => v !== null), 0),
      rootStopLuminances: gradientStops(rootStyle.backgroundImage).map(luminance),
      sidebarBackground: sidebarStyle?.backgroundColor || null,
      sidebarLuminance: luminance(sidebarRgb),
      rootClass: String(root.className || ''),
    };
  })()`);
  if (!metrics || metrics.generation !== 'p5-v4' || metrics.version !== 'p5-v4') {
    throw new Error(`P5 V4 visual identity marker invalid untuk ${product}: ${JSON.stringify(metrics)}`);
  }
  if (options.lightRoot !== false && (metrics.rootLuminance === null || metrics.rootLuminance < 190)) {
    throw new Error(`P5 V4 ${product} root harus terang, bukan legacy dark skin: ${JSON.stringify(metrics)}`);
  }
  if (options.lightAdminSidebar === true && (metrics.sidebarLuminance === null || metrics.sidebarLuminance < 190)) {
    throw new Error(`P5 V4 Admin sidebar default harus terang sesuai reference dashboard: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function assertAdminThemeContract(cdp) {
  const light = await evaluateValue(cdp, `(() => {
    const root=document.querySelector('[data-visual-product="admin"]');
    const sidebar=document.querySelector('aside[aria-label="Navigasi Admin"]');
    const parse=(value)=>{const nums=String(value||'').match(/\\d+(?:\\.\\d+)?/g)?.slice(0,3).map(Number)||[];return nums.length===3?nums:null;};
    const lum=(rgb)=>rgb?(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2]):null;
    return { theme:root?.getAttribute('data-theme')||null, root:lum(parse(root instanceof HTMLElement?getComputedStyle(root).backgroundColor:'')), sidebar:lum(parse(sidebar instanceof HTMLElement?getComputedStyle(sidebar).backgroundColor:'')) };
  })()`);
  if (!light || light.theme !== 'light' || Number(light.root) < 190 || Number(light.sidebar) < 190) throw new Error(`Admin light theme contract gagal: ${JSON.stringify(light)}`);
  const clickedDark = await evaluateValue(cdp, `(() => { const button=[...document.querySelectorAll('button')].find((node)=>node.getAttribute('aria-label')==='Aktifkan mode gelap'); if(!(button instanceof HTMLElement))return false; button.click(); return true; })()`);
  if (!clickedDark) throw new Error('Admin dark-mode toggle tidak ditemukan.');
  await waitExpression(cdp, `document.querySelector('[data-visual-product="admin"]')?.getAttribute('data-theme') === 'dark'`, 'Admin dark theme');
  const dark = await evaluateValue(cdp, `(() => {
    const root=document.querySelector('[data-visual-product="admin"]');
    const sidebar=document.querySelector('aside[aria-label="Navigasi Admin"]');
    const parse=(value)=>{const nums=String(value||'').match(/\\d+(?:\\.\\d+)?/g)?.slice(0,3).map(Number)||[];return nums.length===3?nums:null;};
    const lum=(rgb)=>rgb?(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2]):null;
    return { theme:root?.getAttribute('data-theme')||null, root:lum(parse(root instanceof HTMLElement?getComputedStyle(root).backgroundColor:'')), sidebar:lum(parse(sidebar instanceof HTMLElement?getComputedStyle(sidebar).backgroundColor:'')) };
  })()`);
  if (!dark || dark.theme !== 'dark' || Number(dark.root) > 80 || Number(dark.sidebar) > 80) throw new Error(`Admin dark theme contract gagal: ${JSON.stringify(dark)}`);
  const clickedLight = await evaluateValue(cdp, `(() => { const button=[...document.querySelectorAll('button')].find((node)=>node.getAttribute('aria-label')==='Aktifkan mode terang'); if(!(button instanceof HTMLElement))return false; button.click(); return true; })()`);
  if (!clickedLight) throw new Error('Admin light-mode restore toggle tidak ditemukan.');
  await waitExpression(cdp, `document.querySelector('[data-visual-product="admin"]')?.getAttribute('data-theme') === 'light'`, 'Admin light theme restore');
  return { light, dark, restored: 'light' };
}

async function assertAdminShellGeometry(cdp, width, height) {
  await applyViewportEmulation(cdp, width, height);
  const geometry = await evaluateValue(cdp, `(() => {
    const rect = (el) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
    };
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || r.width <= 0 || r.height <= 0) return false;
      // "Ada dan punya ukuran" BUKAN berarti terlihat. Drawer off-canvas yang tertutup berada di
      // left:-286 - punya display block dan ukuran 286x844, tapi sama sekali tidak terlihat.
      // Tanpa pemeriksaan ini, sidebar mobile terbaca "visible" dan check memutuskan layout mobile
      // salah, padahal main/content-nya benar-benar selebar viewport.
      // Toleransi 1px untuk pembulatan pecahan pada device pixel ratio.
      return r.right > 1 && r.left < innerWidth - 1;
    };
    const shell = document.querySelector('.adminV4');
    const layout = document.querySelector('[data-admin-layout="primary"]');
    const sidebar = document.querySelector('aside[aria-label="Navigasi Admin"]');
    const main = document.querySelector('.adminV4Main');
    const content = document.querySelector('#admin-main');
    return {
      innerWidth,
      // innerWidth memasukkan scrollbar; clientWidth adalah lebar yang benar-benar tersedia
      // untuk konten. Di viewport 1440 dengan scrollbar 15px: innerWidth=1440, clientWidth=1425.
      clientWidth: document.documentElement.clientWidth,
      shell: rect(shell),
      layout: rect(layout),
      sidebar: rect(sidebar),
      sidebarVisible: visible(sidebar),
      main: rect(main),
      content: rect(content),
    };
  })()`);
  if (!geometry?.shell || !geometry?.layout || !geometry?.main || !geometry?.content || !geometry?.sidebar) {
    throw new Error(`Admin shell geometry pada ${width}x${height} tidak lengkap: ${JSON.stringify(geometry)}`);
  }
  const tolerance = 4;
  const { layout, sidebar, main, content } = geometry;
  // Lebar yang dibandingkan adalah `clientWidth`, bukan ukuran viewport yang diminta. Scrollbar
  // vertical memakan 15px dari viewport 1440, jadi area konten yang benar-benar tersedia adalah
  // 1425 - dan layout yang selebar 1425 itu BENAR. Check lama membandingkan terhadap 1440, jadi
  // check itu mustahil pernah lulus di halaman yang benar pun. Diukur di Chrome:
  //   100vh = 100dvh = 100svh = 100% = 900px (scrollbar TIDAK memengaruhi tinggi)
  //   clientWidth = 1425, innerWidth = 1440 (scrollbar memengaruhi LEBAR)
  const availableWidth = geometry.clientWidth ?? width;
  if (layout.left < -tolerance || Math.abs(layout.width - availableWidth) > tolerance || layout.right < availableWidth - tolerance) {
    throw new Error(`Admin root layout tidak mengisi viewport ${width}x${height}: ${JSON.stringify(geometry)}`);
  }
  if (width >= 1024) {
    if (!geometry.sidebarVisible || Math.abs(sidebar.left - layout.left) > tolerance || sidebar.width < 240 || sidebar.width > 320) {
      throw new Error(`Admin desktop sidebar tidak berada di kolom kiri ${width}x${height}: ${JSON.stringify(geometry)}`);
    }
    // Sama seperti check di atas: `width` adalah ukuran viewport yang DIMINTA, sedangkan area
    // konten yang benar-benar tersedia adalah `availableWidth` (sudah dipotong scrollbar).
    // Menghitung ekspektasi dari `width` membuat main yang benar (1425 - 246 = 1179) selalu
    // terlihat "menyusut" karena dibandingkan terhadap 1440 - 246 = 1194.
    if (Math.abs(main.left - sidebar.right) > tolerance || Math.abs(main.right - layout.right) > tolerance || main.width < availableWidth - sidebar.width - tolerance * 2) {
      throw new Error(`Admin desktop main workspace salah kolom/menyusut ${width}x${height}: ${JSON.stringify(geometry)}`);
    }
    if (content.width < main.width - 96) {
      throw new Error(`Admin content terlalu sempit terhadap main workspace ${width}x${height}: ${JSON.stringify(geometry)}`);
    }
  } else {
    if (geometry.sidebarVisible || Math.abs(main.left - layout.left) > tolerance || Math.abs(main.width - layout.width) > tolerance) {
      throw new Error(`Admin mobile main workspace tidak mengambil lebar penuh ${width}x${height}: ${JSON.stringify(geometry)}`);
    }
    // Sama seperti check desktop di atas: pakai availableWidth, bukan ukuran viewport yang
    // diminta. Di mobile scrollbar tetap memakan lebar, jadi konten selebar 375 pada viewport 390
    // itu benar dan check lama akan salah menandainya "terlalu sempit".
    if (content.width < availableWidth - 40) {
      throw new Error(`Admin mobile content terlalu sempit ${width}x${height}: ${JSON.stringify(geometry)}`);
    }
  }
  // `availableWidth` dan `layout` ikut direkam karena inilah yang dipakai check di atas.
  // Tanpa keduanya, pemeriksa downstream hanya punya `width` (viewport yang DIMINTA) dan
  // akan menghitung ekspektasi lebar main dari angka yang sudah dipotong scrollbar -
  // persis bug lama yang membuat check mustahil pernah lulus - serta tidak punya dasar
  // untuk memastikan main benar-benar mengisi sisa lebar. Width yang diminta tetap
  // direkam sebagai `width` supaya matriks 1440/1024/390 tidak berubah.
  return { width, height, availableWidth, sidebarVisible: geometry.sidebarVisible, layout, sidebar, main, content };
}

async function assertAdminShellMatrix(cdp) {
  const checks = [];
  for (const [width,height] of [[1440,900],[1024,768],[390,844]]) checks.push(await assertAdminShellGeometry(cdp,width,height));
  await applyViewportEmulation(cdp, 1440, 900);
  return checks;
}


async function captureSuccessScreenshot(cdp, name) {
  const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (!shot?.data) throw new Error(`Screenshot sukses tidak terbentuk: ${name}`);
  const screenshotPath = path.resolve(root, 'logs', 'browser-uat', `${name}.png`);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
  return path.relative(root, screenshotPath).replaceAll('\\', '/');
}


function screenshotSlug(value) {
  return String(value || 'view').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'view';
}

async function clickAllNavigation(cdp, selector, label) {
  const labels = await evaluateValue(cdp, `([...document.querySelectorAll(${JSON.stringify(selector)})]).filter(x => x.getClientRects().length).map(x => (x.textContent || '').trim()).filter(Boolean)`);
  const visited = [];
  for (const item of [...new Set(labels || [])]) {
    // Tunggu nav siap SEBELUM klik. Setelah workspace diklik, aplikasi masuk state
    // "Memuat ruang kerja" lalu merender ulang label subdomain untuk workspace itu. Tanpa
    // sinkronisasi, klik berikutnya dicoba saat nav masih kosong dan check gagal menuduh
    // navigasi rusak padahal aplikasinya hanya belum selesai memuat.
    // Ini tidak melemahkan gate: item tetap WAJIB diklik, dan kalau tidak pernah muncul
    // waitExpression kehabisan waktu lalu check tetap gagal.
    await waitExpression(
      cdp,
      `!(document.body && (document.body.innerText || '').includes('Memuat ruang kerja')) && [...document.querySelectorAll(${JSON.stringify(selector)})].some((x) => x.getClientRects().length)`,
      `${label}: nav siap sebelum klik ${item}`,
    );
    const clicked = await evaluateValue(cdp, `(() => { const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})]; const el=nodes.find(x => (x.textContent || '').trim() === ${JSON.stringify(item)}); if(!el)return false; el.click(); return true; })()`);
    if (!clicked) {
      // Bukti, bukan--. Dua probe yang keduanya klik 14 workspace + 61 subdomain dengan selector
      // dan urutan yang sama persis SELALU berhasil - termasuk yang diklik "Approval Control".
      // Jadi kegagalan ini kondisi runtime di dalam UAT penuh, dan tanpa bukti apa yang berubah
      // antara snapshot dan klik, setiap perbaikan berikutnya hanya tebakan.
      const state = await evaluateValue(cdp, `(() => ({
        path: location.pathname,
        selectorPresent: Boolean(document.querySelector(${JSON.stringify(selector)})),
        nowLabels: [...document.querySelectorAll(${JSON.stringify(selector)})].map(x => (x.textContent || '').trim()),
        rects: [...document.querySelectorAll(${JSON.stringify(selector)})].map(x => x.getClientRects().length),
        drawerOpen: Boolean(document.querySelector('button[aria-label="Tutup menu"]') || document.querySelector('.adminSidebarBackdrop')),
        bodyStart: (document.body && document.body.innerText || '').slice(0, 160),
        recovered: (document.body && document.body.innerText || '').includes('Coba lagi'),
      }))()`).catch(() => null);
      throw new Error(`${label}: navigasi tidak dapat diklik: ${item} | bukti=${JSON.stringify(state)}`);
    }
    await sleep(500);
    await waitExpression(cdp, `document.readyState === 'complete' && document.body && document.body.innerText.length > 20`, `${label}: ${item}`);
    await assertViewportIntegrity(cdp, `${label}: ${item}`, 1440, 900);
    visited.push(item);
  }
  return visited;
}

async function browserPageDiagnostic(cdp, healthUrl) {
  const result = await cdp.call('Runtime.evaluate', {
    expression: `(async () => {
      const snapshot = { origin: location.origin, href: location.href, text: (document.body?.innerText || '').slice(0, 4000) };
      try {
        const response = await fetch(${JSON.stringify('__HEALTH_URL__')}, { cache: 'no-store' });
        snapshot.health = { ok: response.ok, status: response.status, text: (await response.text()).slice(0, 1000) };
      } catch (error) { snapshot.health = { ok: false, error: String(error) }; }
      return snapshot;
    })()`.replace('__HEALTH_URL__', healthUrl.replaceAll('\\', '\\').replaceAll('"', '\"')),
    returnByValue: true, awaitPromise: true,
  });
  return result?.result?.value || null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const evidence = { environment: process.env.T360_UAT_ENVIRONMENT || 'LOCAL_UAT', startedAt, finishedAt: null, status: 'FAIL', sourceIdentity: sourceFingerprint(root), checks: [], error: null };
  let browser;
  let cdp;
  let tempDir;
  try {
    await waitHttp(`${apiUrl}/health`);
    const healthResponse = await http(`${apiUrl}/health`);
    const healthBody = await healthResponse.json().catch(() => ({}));
    if (!healthResponse.ok || healthBody?.status !== 'ok') throw new Error(`API health invalid (HTTP ${healthResponse.status}).`);
    const expectedRuntimeFingerprint = String(process.env.T360_EXPECTED_SOURCE_FINGERPRINT || '').trim();
    const expectedBuildArtifactId = String(process.env.T360_EXPECTED_BUILD_ARTIFACT_ID || '').trim();
    if (expectedRuntimeFingerprint && healthBody?.release?.sourceFingerprint !== expectedRuntimeFingerprint) {
      throw new Error(`Runtime source fingerprint tidak cocok. expected=${expectedRuntimeFingerprint} actual=${healthBody?.release?.sourceFingerprint || '<missing>'}`);
    }
    if (expectedBuildArtifactId && healthBody?.release?.buildArtifactId !== expectedBuildArtifactId) {
      throw new Error(`Runtime build artifact tidak cocok. expected=${expectedBuildArtifactId} actual=${healthBody?.release?.buildArtifactId || '<missing>'}`);
    }
    evidence.runtimeSourceFingerprint = healthBody?.release?.sourceFingerprint || null;
    evidence.runtimeBuildArtifactId = healthBody?.release?.buildArtifactId || null;
    evidence.checks.push({ id: 'API_HEALTH', status: 'PASS', runtimeSourceFingerprint: evidence.runtimeSourceFingerprint, runtimeBuildArtifactId: evidence.runtimeBuildArtifactId });
    for (const [name, url] of surfaces) {
      const status = await waitHttp(url);
      evidence.checks.push({ id: `SURFACE_${name.toUpperCase()}`, status: 'PASS', httpStatus: status, url });
    }

    const email = String(process.env.T360_UAT_ADMIN_EMAIL || '').trim();
    const password = String(process.env.T360_UAT_ADMIN_PASSWORD || '');
    if (!email || !password) throw new Error('T360_UAT_ADMIN_EMAIL dan T360_UAT_ADMIN_PASSWORD wajib diisi; runner tidak memakai kredensial demo tersembunyi.');
    const login = await http(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const loginBody = await login.json().catch(() => ({}));
    if (!login.ok || !loginBody?.accessToken) throw new Error(`Login UAT gagal (HTTP ${login.status}).`);
    if (loginBody?.code === 'TWO_FACTOR_REQUIRED') throw new Error('Akun UAT membutuhkan 2FA; gunakan akun staging UAT khusus atau jalankan login manual tervalidasi.');
    evidence.checks.push({ id: 'ADMIN_API_LOGIN', status: 'PASS' });

    const staffAuthHeaders = { authorization: `Bearer ${loginBody.accessToken}` };
    const unitResponse = await http(`${apiUrl}/master-data/references?type=UNIT`, { headers: staffAuthHeaders });
    const unitRows = await unitResponse.json().catch(() => null);
    if (!unitResponse.ok) throw new Error(`Master UNIT UAT gagal dibaca (HTTP ${unitResponse.status}).`);
    const activeUnit = (Array.isArray(unitRows) ? unitRows : []).find((item) => item?.type === 'UNIT' && item?.isActive !== false && !item?.branchId && String(item?.code || '').trim());
    if (!activeUnit?.code) throw new Error('Browser UAT membutuhkan minimal satu master UNIT aktif tingkat perusahaan.');
    const uatUnitCode = String(activeUnit.code).trim().toUpperCase();
    evidence.checks.push({ id: 'DYNAMIC_UNIT_MASTER_RUNTIME', status: 'PASS', unitCode: uatUnitCode });

    const tenderResponse = await http(`${apiUrl}/master-data/references?type=PAYMENT_METHOD`, { headers: staffAuthHeaders });
    const tenderRows = await tenderResponse.json().catch(() => null);
    if (!tenderResponse.ok) throw new Error(`Master PAYMENT_METHOD UAT gagal dibaca (HTTP ${tenderResponse.status}).`);
    const activeTenderRows = (Array.isArray(tenderRows) ? tenderRows : []).filter((item) => item?.type === 'PAYMENT_METHOD' && item?.isActive !== false && (!item?.branchId || item.branchId === loginBody.user?.branchId) && String(item?.code || '').trim());
    if (!activeTenderRows.length) throw new Error('Browser UAT membutuhkan minimal satu master PAYMENT_METHOD aktif.');
    const uatTenderCodes = activeTenderRows.map((item) => String(item.code).trim().toUpperCase());
    const fixtureTender = activeTenderRows.find((item) => String(item?.code || '').trim().toUpperCase() === 'CASH') ?? activeTenderRows.find((item) => {
      const metadata = item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata : {};
      return metadata.requiresProvider !== true && metadata.requiresReference !== true;
    }) ?? activeTenderRows[0];
    const fixtureTenderCode = String(fixtureTender.code).trim().toUpperCase();
    const fixtureTenderMetadata = fixtureTender?.metadata && typeof fixtureTender.metadata === 'object' && !Array.isArray(fixtureTender.metadata) ? fixtureTender.metadata : {};
    if (fixtureTenderMetadata.requiresProvider === true || fixtureTenderMetadata.requiresReference === true) {
      throw new Error('Browser UAT tidak menemukan PAYMENT_METHOD aktif tanpa provider/reference wajib untuk fixture penjualan deterministik.');
    }
    evidence.checks.push({ id: 'P6A_TENDER_MASTER_RUNTIME', status: 'PASS', tenderCodes: uatTenderCodes, fixtureTenderCode });

    const memoKey = `browser-uat-memo:${Date.now()}:${process.pid}`;
    const memoTitle = `Browser UAT memo ${process.pid}`;
    const createMemoResponse = await http(`${apiUrl}/staff-memos`, {
      method: 'POST',
      headers: { ...staffAuthHeaders, 'content-type': 'application/json', 'idempotency-key': memoKey },
      body: JSON.stringify({ title: memoTitle, body: 'Exact-runtime memo persistence evidence.' }),
    });
    const createdMemo = await createMemoResponse.json().catch(() => null);
    if (!createMemoResponse.ok || !createdMemo?.id) throw new Error(`Staff Memo UAT gagal dibuat (HTTP ${createMemoResponse.status}).`);
    const retryMemoResponse = await http(`${apiUrl}/staff-memos`, {
      method: 'POST',
      headers: { ...staffAuthHeaders, 'content-type': 'application/json', 'idempotency-key': memoKey },
      body: JSON.stringify({ title: memoTitle, body: 'Exact-runtime memo persistence evidence.' }),
    });
    const retriedMemo = await retryMemoResponse.json().catch(() => null);
    if (!retryMemoResponse.ok || retriedMemo?.id !== createdMemo.id) throw new Error('Staff Memo idempotency retry tidak mengembalikan memo yang sama.');
    const memoListResponse = await http(`${apiUrl}/staff-memos?limit=50`, { headers: staffAuthHeaders });
    const memoList = await memoListResponse.json().catch(() => null);
    if (!memoListResponse.ok || !memoList?.items?.some((item) => item?.id === createdMemo.id)) throw new Error('Staff Memo yang dibuat tidak terbaca kembali pada scope pengguna/cabang yang sama.');
    const pinMemoResponse = await http(`${apiUrl}/staff-memos/${createdMemo.id}`, { method: 'PATCH', headers: { ...staffAuthHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ isPinned: true }) });
    const pinnedMemo = await pinMemoResponse.json().catch(() => null);
    if (!pinMemoResponse.ok || pinnedMemo?.isPinned !== true) throw new Error('Staff Memo pin lifecycle gagal.');
    const archiveMemoResponse = await http(`${apiUrl}/staff-memos/${createdMemo.id}`, { method: 'PATCH', headers: { ...staffAuthHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    const archivedMemo = await archiveMemoResponse.json().catch(() => null);
    if (!archiveMemoResponse.ok || !archivedMemo?.archivedAt) throw new Error('Staff Memo archive lifecycle gagal.');
    evidence.checks.push({ id: 'STAFF_MEMO_RUNTIME', status: 'PASS', memoId: createdMemo.id, idempotentRetry: true, pinLifecycle: true, archiveLifecycle: true });

    if (String(process.env.T360_UAT_PREPARE_P5_STOREFRONT_FIXTURE || '').toLowerCase() === 'true') {
      const fixtureHost = new URL(apiUrl).hostname;
      const fixtureEnvironment = String(process.env.T360_UAT_ENVIRONMENT || '').trim();
      if (!['localhost', '127.0.0.1', '::1'].includes(fixtureHost)) throw new Error(`P5 Storefront fixture menolak target non-loopback: ${fixtureHost}`);
      if (!/(GITHUB|LOCAL_UAT|STAGING|CI)/i.test(fixtureEnvironment)) throw new Error(`P5 Storefront fixture menolak environment yang tidak eksplisit non-production: ${fixtureEnvironment || '<empty>'}`);
      const authHeaders = { authorization: `Bearer ${loginBody.accessToken}` };
      const branchCode = String(process.env.T360_UAT_STOREFRONT_BRANCH_CODE || process.env.SEED_BRANCH_CODE || process.env.NEXT_PUBLIC_BRANCH_CODE || 'PUSAT').trim() || 'PUSAT';
      const catalogUrl = `${apiUrl}/products?branchCode=${encodeURIComponent(branchCode)}&limit=1`;
      const catalogResponse = await http(catalogUrl);
      const catalogBody = await catalogResponse.json().catch(() => ({}));
      if (!catalogResponse.ok) throw new Error(`P5 Storefront fixture gagal membaca katalog publik (HTTP ${catalogResponse.status}).`);
      let fixtureAction = 'EXISTING';
      let fixtureProductId = catalogBody?.items?.[0]?.id || null;
      if (!fixtureProductId) {
        const uniqueSuffix = `${Date.now()}-${process.pid}`;
        const createResponse = await http(`${apiUrl}/products`, {
          method: 'POST',
          headers: { ...authHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            sku: `P5-UAT-${uniqueSuffix}`,
            name: 'P5 Browser UAT Product',
            description: 'Fixture non-production untuk membuktikan visual detail produk P5.',
            unit: uatUnitCode,
            productType: 'PHYSICAL',
            costPrice: 10000,
            salePrice: 15000,
            minStock: 0,
            isActive: true,
          }),
        });
        const created = await createResponse.json().catch(() => ({}));
        if (!createResponse.ok || !created?.id) throw new Error(`P5 Storefront fixture gagal membuat produk (HTTP ${createResponse.status}).`);
        fixtureAction = 'CREATED';
        fixtureProductId = created.id;
        const deadline = Date.now() + 15000;
        let visible = false;
        while (Date.now() < deadline) {
          const verifyResponse = await http(catalogUrl);
          const verifyBody = await verifyResponse.json().catch(() => ({}));
          visible = verifyResponse.ok && Array.isArray(verifyBody?.items) && verifyBody.items.some((item) => item?.id === fixtureProductId);
          if (visible) break;
          await sleep(300);
        }
        if (!visible) throw new Error('P5 Storefront fixture berhasil dibuat tetapi tidak muncul pada katalog publik branch yang sama.');
      }
      evidence.checks.push({ id: 'P5_STOREFRONT_PRODUCT_FIXTURE', status: 'PASS', action: fixtureAction, branchCode, productId: fixtureProductId, productionTouched: false });
    }

    // Prasyarat untuk gate dashboard: harus ada penjualan produk, kalau tidak donut
    // product-mix tidak akan pernah muncul.
    //
    // DAHULU gate ini gagal terus di runner bukan karena program salah, tapi karena
    // lingkarannya tidak pernah tertutup: seed tidak pernah membuat Sale/SaleItem dan UAT
    // juga tidak pernah membuat penjualan. Di database bersih sama sekali tidak ada
    // penjualan, dan syarat ['line','donut'] mustahil dipenuhi.
    //
    // Dua jalan keluar, dan hanya satu yang benar:
    // - melonggarkan syarat jadi "donut ATAU empty state" -> itu RUPAK. Begitu ada
    //   penjualan sungguhan, donut yang rusak akan lolos karena empty state tetap tampil.
    // - menutup lingkarannya: UAT membuat penjualan nyata lewat API yang sama dengan
    //   yang dipakai kasir. Jurnal akuntansi dan movement stok tetap benar karena
    //   SalesService yang memakainya, bukan prisma.sale.create telanjang.
    //
    // Idempoten: sale dicari dulu, jadi UAT berulang tidak menumpuk transaksi.
    //
    // Bentuk respons diverifikasi terhadap API yang sedang berjalan, bukan asumsi:
    //   GET /sales                 -> { items: [...] }  (bukan `data`)
    //   GET /products              -> { items: [...] }  (bukan `data`)
    //   GET /inventory/warehouses  -> [ { id, branchId, ... } ]  (array langsung)
    // Product TIDAK punya field warehouseId, jadi gudang diambil dari endpoint gudang -
    // sebelumnya fallback ke env yang tidak pernah diisi, dan itu penyebab "katalog kosong".
    if (String(process.env.T360_UAT_PREPARE_SALES || '').toLowerCase() === 'true') {
      const authHeaders = { authorization: `Bearer ${loginBody.accessToken}` };
      // http() mengembalikan Response mentah, BUKAN objek JSON. Response punya .ok/.status
      // tapi tidak punya .body - memakai `res.body?.items` selalu undefined sehingga
      // katalog selalu terbaca kosong. Body harus diambil lewat .json().
      const listRes = await http(`${apiUrl}/sales?limit=1`, { headers: authHeaders });
      if (!listRes.ok) throw new Error(`Daftar penjualan CI gagal (HTTP ${listRes.status}).`);
      const listBody = await listRes.json().catch(() => null);
      const existingSales = Array.isArray(listBody?.items) ? listBody.items : [];
      if (existingSales.length > 0) {
        evidence.checks.push({ id: 'SALES_CI_FIXTURE', status: 'PASS', action: 'EXISTING' });
      } else {
        const catalogRes = await http(`${apiUrl}/products?limit=1`, { headers: authHeaders });
        if (!catalogRes.ok) throw new Error(`Katalog produk CI gagal (HTTP ${catalogRes.status}).`);
        const catalogBody = await catalogRes.json().catch(() => null);
        const catalogItems = Array.isArray(catalogBody?.items) ? catalogBody.items : [];
        const product = catalogItems[0];
        if (!product?.id) throw new Error('Katalog produk CI kosong; fixture penjualan tidak bisa dibuat.');
        const warehousesRes = await http(`${apiUrl}/inventory/warehouses`, { headers: authHeaders });
        if (!warehousesRes.ok) throw new Error(`Daftar gudang CI gagal (HTTP ${warehousesRes.status}).`);
        const warehouses = await warehousesRes.json().catch(() => null);
        const warehouse = (Array.isArray(warehouses) ? warehouses : [])[0];
        if (!warehouse?.id) throw new Error('Tidak ada gudang untuk fixture penjualan CI.');
        const price = Number(product.salePrice ?? 0);
        const quantity = 2;
        if (!(price > 0)) throw new Error(`Harga jual produk CI tidak valid: ${product.salePrice}`);
        // Prasyarat kedua dari lingkaran itu: stok. Fixture penjualan lama langsung
        // ke POST /sales dan gagal 400 "Stok ... tidak mencukupi" di runner, karena
        // SEED_MODE=bootstrap tidak pernah membuat produk/supplier/stok. Stok datang lewat
        // penerimaan barang produksi, bukan ditulis ke DB.
        // Sisakan satu unit nyata setelah fixture sale dibuat. Browser UAT P6A harus
        // membentuk keranjang POS sungguhan sebelum memeriksa selector tender; memeriksa
        // selector pada keranjang kosong adalah false-negative karena UI memang hanya
        // merender metode pembayaran saat tenderTarget > 0. Stok ekstra tetap masuk lewat
        // receiving produksi dan TIDAK ditembak langsung ke tabel inventory.
        const receiving = await ensureStockThroughReceiving(apiUrl, authHeaders, { product, warehouse, quantity: quantity + 1 });
        evidence.checks.push({ id: 'SALES_CI_STOCK_RECEIVING', status: 'PASS', ...receiving, reservedForPosTenderUat: 1, productionTouched: false });
        const createdRes = await http(`${apiUrl}/sales`, {
          method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            warehouseId: warehouse.id,
            items: [{ productId: product.id, quantity }],
            payments: [{ method: fixtureTenderCode, amount: price * quantity }],
            // Field yang benar adalah idempotencyKey, bukan `note` - `note` tidak ada di
            // CreateSaleDto dan ditolak 400 ("property note should not exist").
            // idempotencyKey juga memberi jaminan retry aman: kalau POST terputus di tengah,
            // UAT berikutnya tidak akan menggandakan transaksi.
            idempotencyKey: `CI-UAT-SALES-${process.env.GITHUB_RUN_ID ?? 'LOCAL'}`,
          }),
        });
        if (!createdRes.ok) {
          const errBody = await createdRes.text().catch(() => '');
          throw new Error(`Fixture penjualan CI gagal (HTTP ${createdRes.status}): ${String(errBody).slice(0, 200)}`);
        }
        const createdBody = await createdRes.json().catch(() => null);
        evidence.checks.push({ id: 'SALES_CI_FIXTURE', status: 'PASS', action: 'CREATED', saleId: createdBody?.id ?? null });
      }
    }

    if (String(process.env.T360_UAT_PREPARE_EMPLOYEE_SELF || '').toLowerCase() === 'true') {
      if (!loginBody.user?.sub) throw new Error('Login UAT tidak membawa user.sub untuk fixture Employee Portal CI.');
      const authHeaders = { authorization: `Bearer ${loginBody.accessToken}` };
      const existing = await http(`${apiUrl}/employee/me`, { headers: authHeaders });
      if (existing.status === 404) {
        const created = await http(`${apiUrl}/hr/employees`, {
          method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            userId: loginBody.user?.sub, employeeNumber: 'CI-UAT-ADMIN', fullName: loginBody.user?.name || 'CI UAT Employee',
            email: loginBody.user?.email || email, employmentStatus: 'PERMANENT', hireDate: new Date().toISOString().slice(0, 10), timezone: 'Asia/Makassar',
          }),
        });
        if (!created.ok) throw new Error(`Persiapan employee self-service CI gagal (HTTP ${created.status}).`);
        evidence.checks.push({ id: 'EMPLOYEE_SELF_CI_FIXTURE', status: 'PASS', action: 'CREATED' });
      } else if (existing.ok) {
        evidence.checks.push({ id: 'EMPLOYEE_SELF_CI_FIXTURE', status: 'PASS', action: 'EXISTING' });
      } else {
        throw new Error(`Validasi employee self-service CI gagal (HTTP ${existing.status}).`);
      }
    }

    const executable = browserExecutable();
    if (!executable) throw new Error('Chromium/Chrome tidak ditemukan. Set T360_CHROMIUM ke executable browser UAT.');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't360-browser-uat-'));
    const requestedDebugPortRaw = String(process.env.T360_BROWSER_DEBUG_PORT || '').trim();
    const requestedDebugPort = requestedDebugPortRaw ? Number(requestedDebugPortRaw) : 0;
    if (requestedDebugPortRaw && (!Number.isInteger(requestedDebugPort) || requestedDebugPort < 1024 || requestedDebugPort > 65535)) {
      throw new Error('T360_BROWSER_DEBUG_PORT tidak valid.');
    }
    // Runner GitHub menyetel DBUS_SESSION_BUS_ADDRESS ke nilai yang tidak bisa di-parse, dan
    // Chrome MEMBEKUK saat start karena itu:
    //   ERROR:dbus/bus.cc:405 Failed to connect to the bus: Could not parse server address:
    //   Unknown address type (examples of valid types are "tcp" and on UNIX "unix")
    // Gejalanya downstream menyesatkan: proses tetap hidup, tapi `DevToolsActivePort` tidak pernah
    // ditulis, jadi UAT melaporkan "Chrome DevTools tidak siap" - seolah-olah timeout, padahal
    // Chrome menolak start. Menambah timeout tidak akan menolong; `--disable-features` +
    // sanitasi env-lah yang memperbaiki.
    browser = spawn(executable, [
      '--headless=new', `--remote-debugging-port=${requestedDebugPort}`, `--user-data-dir=${tempDir}`,
      '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--no-sandbox',
      // Jangan sampai siklus D-Bus yang rusak menghentikan Chrome; headless tidak membutuhkannya.
      '--disable-features=DBusMenu,MediaRouter,OptimizationHints',
      '--disable-dbus',
      'about:blank',
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      // `DBUS_SESSION_BUS_ADDRESS` yang rusak di-inherit ke Chrome. D-Bus tidak diperlukan untuk
      // headless, jadi address yang tidak bisa di-parse ini harus dihapus, bukan diteruskan.
      env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: '/dev/null' },
    });
    let browserErr = ''; browser.stderr?.on('data', (chunk) => { browserErr = (browserErr + String(chunk)).slice(-8000); });
    const debugPort = await waitForBrowserDevTools(tempDir, browser, () => browserErr, requestedDebugPort);
    const targetResponse = await http(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(adminUrl)}`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`Tidak dapat membuat browser target (HTTP ${targetResponse.status}). ${browserErr.slice(-500)}`);
    const target = await targetResponse.json();
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.open();
    const runtimeExceptions = [];
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      const detail = exceptionDetails || {};
      runtimeExceptions.push({
        text: detail.exception?.description || detail.text || 'Unhandled browser exception',
        url: detail.url || null,
        lineNumber: Number.isInteger(detail.lineNumber) ? detail.lineNumber : null,
        columnNumber: Number.isInteger(detail.columnNumber) ? detail.columnNumber : null,
      });
    });
    await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
    await waitExpression(cdp, `document.readyState === 'complete' && document.body && document.body.innerText.includes('Masuk ke pusat operasional')`, 'Halaman login Admin');
    evidence.checks.push({ id: 'ADMIN_LOGIN_SCREEN', status: 'PASS' });

    const access = JSON.stringify(loginBody.accessToken); const refresh = JSON.stringify(loginBody.refreshToken || '');
    await cdp.call('Runtime.evaluate', { expression: `localStorage.setItem('toko360_token', ${access}); localStorage.setItem('toko360_refresh', ${refresh}); localStorage.setItem('toko360:ui-theme:admin', 'light'); location.reload(); true`, returnByValue: true });
    await waitExpression(cdp, `Boolean(document.querySelector('aside[aria-label=\"Navigasi Admin\"] .navItem'))`, 'Navigasi Admin setelah login', 45000);
    await waitExpression(cdp, `Boolean(document.querySelector('[data-staff-memo-surface=\"admin\"]'))`, 'Admin staff memo surface', 45000);
    evidence.checks.push({ id: 'ADMIN_AUTHENTICATED_SHELL', status: 'PASS' });
    evidence.checks.push({ id: 'STAFF_MEMO_ADMIN_SURFACE', status: 'PASS' });
    evidence.checks.push({ id: 'ADMIN_RESPONSIVE_SHELL', status: 'PASS', matrix: await assertResponsiveMatrix(cdp, 'Admin authenticated shell') });
    evidence.checks.push({ id: 'ADMIN_SHELL_GEOMETRY', status: 'PASS', matrix: await assertAdminShellMatrix(cdp) });
    evidence.checks.push({ id: 'P5_V4_ADMIN_VISUAL_IDENTITY', status: 'PASS', metrics: await assertP5V4VisualIdentity(cdp, 'admin', { lightRoot: true, lightAdminSidebar: true }) });
    evidence.checks.push({ id: 'ADMIN_THEME_LIGHT_DARK', status: 'PASS', themes: await assertAdminThemeContract(cdp) });

    const dashboardContract = await evaluateValue(cdp, `(() => {
      const metrics=[...document.querySelectorAll('[data-dashboard-metric]')].filter((el)=>el.getClientRects().length);
      const panels=[...document.querySelectorAll('[data-dashboard-panel]')].filter((el)=>el.getClientRects().length).map((el)=>el.getAttribute('data-dashboard-panel')).filter(Boolean);
      const charts=[...document.querySelectorAll('[data-chart-kind]')].filter((el)=>el.getClientRects().length).map((el)=>el.getAttribute('data-chart-kind')).filter(Boolean);
      const title=(document.querySelector('.adminPageTitleLine h1')?.textContent||'').trim();
      const productPanel=document.querySelector('[data-dashboard-panel="product-performance"]');
      const productEmptyNode=productPanel ? productPanel.querySelector('.emptyState') : null;
      const productEmpty=productEmptyNode ? (productEmptyNode.querySelector('h4')?.textContent||'').trim() : '';
      const hasProductDonut=productPanel ? Boolean(productPanel.querySelector('[data-chart-kind="donut"]')) : false;
      return { metricCount:metrics.length, panels, charts, title, productEmpty, hasProductDonut };
    })()`);
    const requiredDashboardPanels=['sales-performance','top-revenue-drivers','product-performance','recent-activity','stock-watchlist','quick-actions'];
    // Gate DIJAGA KETAT: line DAN donut wajib. Sebelumnya ini dual-branch
    // ("donut ATAU empty state") karena seed tidak pernah membuat penjualan - itu cara yang
    // RUPAK, karena donut yang rusak akan lolos begitu data penjualan benar-benar ada.
    // Sekarang prasyaratnya ditutup: UAT membuat penjualan nyata lewat API kasir sebelum
    // pemeriksaan ini, jadi donut WAJIB ada dan keadaannya selalu terisi.
    //
    // Sama seperti R7: yang tetap wajib selain itu adalah 6 panel, 6 metrik, dan judul.
    if (!dashboardContract || dashboardContract.metricCount !== 6 || dashboardContract.title !== 'Dashboard Overview' || !requiredDashboardPanels.every((panel)=>dashboardContract.panels.includes(panel)) || !['line','donut'].every((kind)=>dashboardContract.charts.includes(kind))) {
      throw new Error(`Admin reference dashboard contract gagal: ${JSON.stringify({ ...dashboardContract, salesFixture: evidence.checks.find((check)=>check.id==='SALES_CI_FIXTURE') ?? null })}`);
    }
    evidence.checks.push({ id: 'ADMIN_REFERENCE_DASHBOARD', status: 'PASS', ...dashboardContract, screenshot: await captureSuccessScreenshot(cdp, 'admin-dashboard-reference-v46') });

    const adminWorkspaceEntries = await evaluateValue(cdp, `([...document.querySelectorAll('.navItem')])
      .filter((node) => node.getClientRects().length)
      .map((node) => ({
        route: node.getAttribute('data-admin-route'),
        label: (node.querySelector('.navLabel')?.textContent || '').trim(),
      }))
      .filter((entry) => entry.route && entry.label)`);
    const adminWorkspaces = adminWorkspaceEntries.map((entry) => entry.label);
    const adminDomainViews = [];
    const p5AdminPrimaryScreenshots = [];
    for (const entry of adminWorkspaceEntries) {
      const clicked = await evaluateValue(cdp, `(() => { const el=document.querySelector('.navItem[data-admin-route=${JSON.stringify(entry.route)}]'); if(!(el instanceof HTMLElement) || el.offsetParent===null)return false; el.click(); return true; })()`);
      if (!clicked) throw new Error(`Admin workspace hilang saat domain sweep: ${entry.label}`);
      await sleep(350);
      // Navigasi Admin punya DUA tingkat, dan keduanya harus dihitung sebagai "aktif":
//   1. Workspace tanpa subdomain -> tombol root diberi aria-current="page".
//      (app-shell.tsx: aria-current={active && !activeDomainView ? 'page' : undefined})
//   2. Workspace DENGAN subdomain -> setelah klik, activeDomainView selalu terisi, jadi
//      aria-current="page" pada tombol root TIDAK PERNAH muncul. Root ditandai dengan class
//      isActive, dan badge subdomain yang aktif memakai aria-current="page".
// Check lama hanya menunggu (1), jadi untuk setiap workspace bersubdomain - termasuk
// /commerce (domain-workspaces.ts:35) - ia menunggu selector yang secara desain mustahil
// terjadi, lalu timeout dengan pesan yang terlihat seperti produk rusak.
// Di sini keduanya dikenali, DAN root wajib benar-benar isActive supaya tidak lolos hanya
// karena ada subdomain lain yang kebetulan aktif.
const rootSel = `.navItem[data-admin-route=${JSON.stringify(entry.route)}]`;
await waitExpression(cdp, `(() => {
  const root = document.querySelector(${JSON.stringify(rootSel)});
  if (!root) return false;
  if (root.getAttribute('aria-current') === 'page') return true;
  if (!root.classList.contains('isActive')) return false;
  return Boolean(root.closest('.adminNavCluster')?.querySelector('.adminSidebarSubdomains button[aria-current="page"]'));
})()`, `Admin workspace aktif: ${entry.label}`);
      await assertViewportIntegrity(cdp, `Admin workspace: ${entry.label}`, 1440, 900);
      const domains = await clickAllNavigation(cdp, '.adminSidebarSubdomains button', `Admin subdomain ${entry.label}`);
      adminDomainViews.push({ workspace: entry.label, domains });
      p5AdminPrimaryScreenshots.push({
        route: entry.route,
        label: entry.label,
        screenshot: await captureSuccessScreenshot(cdp, `p5-admin-primary-${screenshotSlug(entry.label)}`),
      });
    }
    evidence.checks.push({ id: 'ADMIN_ALL_NAVIGATION_RUNTIME', status: 'PASS', workspaces: adminWorkspaces, domainViews: adminDomainViews, screenshot: await captureSuccessScreenshot(cdp, 'admin-navigation-success') });

    const p5AdminContextualScreenshots = [];
    for (const route of p5VisualSurfaceMap.admin?.representativeContextualRoutes || []) {
      await navigateAdminContext(cdp, route, `P5 visual contextual ${route}`);
      await assertViewportIntegrity(cdp, `P5 visual contextual ${route}`, 1440, 900);
      p5AdminContextualScreenshots.push({
        route,
        screenshot: await captureSuccessScreenshot(cdp, `p5-admin-context-${screenshotSlug(route)}`),
      });
    }

    await navigateAdminContext(cdp, '/integrations/notifications', 'R8 contextual route /integrations/notifications active');
    await waitExpression(cdp, `document.body && document.body.innerText.includes('Owner Daily Digest') && [...document.querySelectorAll('button')].some(x=>x.textContent?.trim()==='Simpan daily digest')`, 'R8 owner daily digest operator surface', 45000);
    const digestBefore = await evaluateValue(cdp, `(() => { const panel=[...document.querySelectorAll('.panel')].find(x=>x.textContent?.includes('Owner Daily Digest')); if(!panel)return null; const enabled=panel.querySelector('input[type="checkbox"]'); const hour=[...panel.querySelectorAll('input[type="number"]')][0]; return { enabled:!!enabled?.checked, hour:Number(hour?.value ?? 21) }; })()`);
    if (!digestBefore || !Number.isInteger(digestBefore.hour)) throw new Error('R8 daily digest state tidak dapat dibaca dari UI.');
    const digestMutatedHour = (digestBefore.hour + 1) % 24;
    const mutateDigest = `(() => { const panel=[...document.querySelectorAll('.panel')].find(x=>x.textContent?.includes('Owner Daily Digest')); const input=panel?.querySelector('input[type="number"]'); const button=[...(panel?.querySelectorAll('button')||[])].find(x=>x.textContent?.trim()==='Simpan daily digest'); if(!input||!button)return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; setter?.call(input,${digestMutatedHour}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); button.click(); return true; })()`;
    await waitExpression(cdp, mutateDigest, 'R8 mutate daily digest hour');
    await waitExpression(cdp, `document.body && document.body.innerText.includes('Konfigurasi owner daily digest tersimpan.')`, 'R8 daily digest mutation persisted', 45000);
    const restoreDigest = `(() => { const panel=[...document.querySelectorAll('.panel')].find(x=>x.textContent?.includes('Owner Daily Digest')); const input=panel?.querySelector('input[type="number"]'); const button=[...(panel?.querySelectorAll('button')||[])].find(x=>x.textContent?.trim()==='Simpan daily digest'); if(!input||!button)return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; setter?.call(input,${digestBefore.hour}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); button.click(); return true; })()`;
    await waitExpression(cdp, restoreDigest, 'R8 restore daily digest hour');
    await waitExpression(cdp, `document.body && document.body.innerText.includes('Konfigurasi owner daily digest tersimpan.')`, 'R8 daily digest restore persisted', 45000);
    evidence.checks.push({ id: 'R8_DAILY_DIGEST_CONFIG_MUTATION', status: 'PASS', before: digestBefore, mutatedHour: digestMutatedHour, restoredHour: digestBefore.hour, assertions: ['mutate through Admin UI', 'restore original hour through Admin UI'] });

    await navigateAdminContext(cdp, '/operations-control/delivery', 'Delivery Lifecycle contextual route');
    await waitExpression(cdp, `document.body && document.body.innerText.includes('Outbound / Delivery Lifecycle') && document.body.innerText.includes('TRIP WORKBENCH')`, 'Delivery Lifecycle Admin', 45000);
    const pageText = await cdp.call('Runtime.evaluate', { expression: `document.body.innerText`, returnByValue: true });
    const bodyText = String(pageText?.result?.value || '');
    if (bodyText.includes('Delivery lifecycle gagal dimuat')) throw new Error('Delivery Lifecycle dirender tetapi read model gagal dimuat dari API.');
    evidence.checks.push({ id: 'ADMIN_DELIVERY_LIFECYCLE', status: 'PASS', assertions: ['Outbound / Delivery Lifecycle', 'TRIP WORKBENCH', 'read model tanpa error'] });

    await navigateAdminContext(cdp, '/people/payroll', 'Payroll Lifecycle contextual route');
    await waitExpression(cdp, `document.body && document.body.innerText.includes('PAYROLL LIFECYCLE') && document.body.innerText.includes('Riwayat Payroll Runs') && document.body.innerText.includes('PPh / BPJS / Potongan')`, 'Payroll Lifecycle Admin', 45000);
    const payrollPageText = await cdp.call('Runtime.evaluate', { expression: `document.body.innerText`, returnByValue: true });
    const payrollBodyText = String(payrollPageText?.result?.value || '');
    if (payrollBodyText.includes('Gagal memuat HR/Payroll') || payrollBodyText.includes('Gagal memuat detail payroll')) throw new Error('Payroll Lifecycle dirender tetapi read model gagal dimuat dari API.');
    evidence.checks.push({ id: 'ADMIN_PAYROLL_LIFECYCLE', status: 'PASS', assertions: ['PAYROLL LIFECYCLE', 'Riwayat Payroll Runs', 'PPh / BPJS / Potongan', 'read model tanpa error'] });

    await navigateAdminContext(cdp, '/people/employees', 'Employee Master contextual route');
    await waitExpression(cdp, `document.body && document.body.innerText.includes('EMPLOYEE MASTER') && document.body.innerText.includes('Tambah karyawan') && document.body.innerText.includes('Daftar Karyawan')`, 'Employee Master Admin', 45000);
    evidence.checks.push({ id: 'ADMIN_EMPLOYEE_MASTER', status: 'PASS', assertions: ['EMPLOYEE MASTER', 'Tambah karyawan', 'Daftar Karyawan'] });

    if (String(process.env.T360_UAT_HR_MUTATIONS || '').toLowerCase() === 'true') {
      const employeeNumber = `UAT-${Date.now()}`;
      const fullName = `Browser UAT ${employeeNumber}`;
      const fillEmployee = `(() => {
        const set=(labelText,value)=>{ const label=[...document.querySelectorAll('label')].find(x=>x.textContent?.includes(labelText)); const input=label?.querySelector('input'); if(!input)return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; setter?.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); return true; };
        const ok=set('NIP / Employee Number', ${JSON.stringify(employeeNumber)}) && set('Nama lengkap', ${JSON.stringify(fullName)});
        const button=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Tambah karyawan'); if(!ok||!button)return false; button.click(); return true;
      })()`;
      await waitExpression(cdp, fillEmployee, 'Isi dan submit employee master');
      await waitExpression(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(employeeNumber)}) && document.body.innerText.includes('Karyawan berhasil dibuat.')`, 'Employee create operator action', 45000);

      const editEmployee = `(() => { const row=[...document.querySelectorAll('.tr')].find(x=>x.textContent?.includes(${JSON.stringify(employeeNumber)})); const button=[...(row?.querySelectorAll('button')||[])].find(x=>x.textContent?.trim()==='Edit'); if(!button)return false; button.click(); return true; })()`;
      await waitExpression(cdp, editEmployee, 'Edit employee operator action');
      await waitExpression(cdp, `document.body && document.body.innerText.includes('Edit karyawan') && [...document.querySelectorAll('button')].some(x=>x.textContent?.trim()==='Simpan perubahan')`, 'Employee edit form');
      const updatedName = `${fullName} Updated`;
      const saveEmployee = `(() => { const label=[...document.querySelectorAll('label')].find(x=>x.textContent?.includes('Nama lengkap')); const input=label?.querySelector('input'); const button=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Simpan perubahan'); if(!input||!button)return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; setter?.call(input,${JSON.stringify(updatedName)}); input.dispatchEvent(new Event('input',{bubbles:true})); button.click(); return true; })()`;
      await waitExpression(cdp, saveEmployee, 'Simpan edit employee');
      await waitExpression(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(updatedName)}) && document.body.innerText.includes('Data karyawan berhasil diperbarui.')`, 'Employee edit persisted', 45000);

      const deactivateEmployee = `(() => { const row=[...document.querySelectorAll('.tr')].find(x=>x.textContent?.includes(${JSON.stringify(employeeNumber)})); const button=[...(row?.querySelectorAll('button')||[])].find(x=>x.textContent?.trim()==='Nonaktifkan'); if(!button)return false; button.click(); return true; })()`;
      await waitExpression(cdp, deactivateEmployee, 'Deactivate employee operator action');
      await waitExpression(cdp, `(() => { const row=[...document.querySelectorAll('.tr')].find(x=>x.textContent?.includes(${JSON.stringify(employeeNumber)})); return !!row && row.textContent.includes('NONAKTIF') && [...row.querySelectorAll('button')].some(x=>x.textContent?.trim()==='Aktifkan'); })()`, 'Employee inactive state', 45000);

      const activateEmployee = `(() => { const row=[...document.querySelectorAll('.tr')].find(x=>x.textContent?.includes(${JSON.stringify(employeeNumber)})); const button=[...(row?.querySelectorAll('button')||[])].find(x=>x.textContent?.trim()==='Aktifkan'); if(!button)return false; button.click(); return true; })()`;
      await waitExpression(cdp, activateEmployee, 'Reactivate employee operator action');
      await waitExpression(cdp, `(() => { const row=[...document.querySelectorAll('.tr')].find(x=>x.textContent?.includes(${JSON.stringify(employeeNumber)})); return !!row && [...row.querySelectorAll('button')].some(x=>x.textContent?.trim()==='Nonaktifkan'); })()`, 'Employee active state restored', 45000);
      evidence.checks.push({ id: 'ADMIN_EMPLOYEE_MASTER_MUTATIONS', status: 'PASS', employeeNumber, assertions: ['create', 'edit', 'deactivate', 'reactivate'] });
    }

    const r8MutationChecks = ['R8_DAILY_DIGEST_CONFIG_MUTATION', 'ADMIN_EMPLOYEE_MASTER_MUTATIONS'].map((id) => evidence.checks.find((check) => check.id === id));
    if (r8MutationChecks.some((check) => !check || check.status !== 'PASS')) throw new Error(`R8 safe mutation evidence tidak lengkap: ${JSON.stringify(r8MutationChecks)}`);
    evidence.checks.push({ id: 'R8_SAFE_MUTATION_JOURNEYS', status: 'PASS', journeys: r8MutationChecks.map((check) => check.id), domains: ['owner-reporting', 'hr-employee-master'], productionTouched: false });

    await navigateAndAssert(cdp, storefrontUrl, `document.body && document.body.innerText.includes('TOKO360 OFFICIAL STORE') && document.body.innerText.includes('Belanja langsung dari toko')`, 'Storefront browser render');
    evidence.checks.push({ id: 'STOREFRONT_BROWSER_RENDER', status: 'PASS', url: storefrontUrl });
    const storefrontViews = await clickAllNavigation(cdp, '.desktopNav button', 'Storefront navigation');
    evidence.checks.push({ id: 'STOREFRONT_NAVIGATION_RUNTIME', status: 'PASS', views: storefrontViews, matrix: await assertResponsiveMatrix(cdp, 'Storefront'), screenshot: await captureSuccessScreenshot(cdp, 'storefront-navigation-success') });
    evidence.checks.push({ id: 'P5_V4_STOREFRONT_VISUAL_IDENTITY', status: 'PASS', metrics: await assertP5V4VisualIdentity(cdp, 'storefront', { lightRoot: true }) });

    const p5StorefrontScreenshots = [];
    for (const view of ['home','catalog','cart','account']) {
      const clicked = await evaluateValue(cdp, `(() => { const root=document.querySelector('[data-visual-product="storefront"]'); if(!root)return false; const target=[...document.querySelectorAll('.desktopNav button')].find((node) => { const text=(node.textContent||'').toLowerCase(); return (${JSON.stringify(view)}==='home'&&text.includes('beranda'))||(${JSON.stringify(view)}==='catalog'&&text.includes('katalog'))||(${JSON.stringify(view)}==='cart'&&text.includes('keranjang'))||(${JSON.stringify(view)}==='account'&&text.includes('akun')); }); if(!target)return false; target.click(); return true; })()`);
      if (!clicked) throw new Error(`P5 Storefront view tidak dapat dibuka: ${view}`);
      await waitExpression(cdp, `document.querySelector('[data-visual-product="storefront"]')?.getAttribute('data-visual-view') === ${JSON.stringify(view)}`, `P5 Storefront visual ${view}`);
      await assertViewportIntegrity(cdp, `P5 Storefront ${view}`, 1440, 900);
      p5StorefrontScreenshots.push({ view, screenshot: await captureSuccessScreenshot(cdp, `p5-storefront-${view}`) });
    }
    await waitExpression(cdp, `document.querySelector('[data-visual-product="storefront"]')?.getAttribute('data-visual-view') === 'account'`, 'P5 Storefront account before product visual');
    const openedCatalogForProduct = await evaluateValue(cdp, `(() => { const target=[...document.querySelectorAll('.desktopNav button')].find((node)=>(node.textContent||'').includes('Katalog')); if(!target)return false; target.click(); return true; })()`);
    if (!openedCatalogForProduct) throw new Error('P5 Storefront tidak dapat kembali ke katalog untuk visual detail produk.');
    await waitExpression(cdp, `document.querySelector('[data-visual-product="storefront"]')?.getAttribute('data-visual-view') === 'catalog'`, 'P5 Storefront catalog for product detail');
    // RACE yang nyata, bukan tebakan: data-visual-view berubah ke 'catalog' begitu state
    // berubah, SEBELUM produk selesai di-fetch ke /api/v1/products?branchCode=... (client-side).
    // Menunggu view saja karena itu katalog kosong sesaat, dan check berikutnya gagal dengan
    // "detail produk tidak dapat dibuka" - padahal produknya ada dan bisa diklik.
    // Terbukti sebagai flakiness: stage ini LOLOS di br-uat32 dan GAGAL di br-uat33 tanpa
    // perubahan kode produk apa pun.
    // Menunggu kartu produk nyata BUKAN melemahkan gate: tombol "Lihat detail" tetap wajib
    // diklik, dan data-visual-view === 'product' tetap ditegakkan setelahnya.
    await waitExpression(cdp, `[...document.querySelectorAll('.productCard button')].some((node)=>/Lihat detail|Lihat produk/.test(node.textContent||''))`, 'P5 Storefront product cards loaded for detail');
    const openedProduct = await evaluateValue(cdp, `(() => { const target=[...document.querySelectorAll('.productCard button')].find((node)=>/Lihat detail|Lihat produk/.test(node.textContent||'')); if(!target)return false; target.click(); return true; })()`);
    if (!openedProduct) throw new Error('P5 Storefront detail produk tidak dapat dibuka dari katalog runtime.');
    await waitExpression(cdp, `document.querySelector('[data-visual-product="storefront"]')?.getAttribute('data-visual-view') === 'product'`, 'P5 Storefront product detail visual');
    await assertViewportIntegrity(cdp, 'P5 Storefront product', 1440, 900);
    p5StorefrontScreenshots.push({ view: 'product', screenshot: await captureSuccessScreenshot(cdp, 'p5-storefront-product') });

    await navigateAndAssert(cdp, posUrl, `document.body && document.body.innerText.includes('KASIR TOKO360') && document.body.innerText.includes('Masuk ke terminal kasir')`, 'POS browser render');
    evidence.checks.push({ id: 'POS_BROWSER_RENDER', status: 'PASS', url: posUrl });
    await cdp.call('Runtime.evaluate', { expression: `localStorage.setItem('toko360_pos_token', ${access}); location.reload(); true`, returnByValue: true });
    await waitExpression(cdp, `document.body && document.body.innerText.includes('TOKO360 POS') && document.body.innerText.includes('Kasir') && document.body.innerText.includes('Gudang/toko')`, 'POS authenticated cashier shell', 45000);
    try {
      await waitExpression(cdp, `document.body && document.body.innerText.includes('Server online') && !document.body.innerText.includes('Gagal memuat data.')`, 'POS online data/offline-config bootstrap', 45000);
    } catch (error) {
      evidence.posDiagnostic = await browserPageDiagnostic(cdp, `${apiUrl}/health`).catch((diagnosticError) => ({ diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }));
      throw error;
    }
    await waitExpression(cdp, `Boolean(document.querySelector('[data-staff-memo-surface=\"pos\"]'))`, 'POS staff memo surface', 45000);
    evidence.checks.push({ id: 'POS_AUTHENTICATED_RUNTIME', status: 'PASS', assertions: ['cashier shell', 'warehouse selector', 'server online', 'offline config/data bootstrap'] });

    // PAYMENT_METHOD selector sengaja tidak dirender saat keranjang kosong karena tidak ada
    // tender yang harus dibayar. Jadi UAT harus membentuk prasyarat bisnis yang nyata, bukan
    // menuntut kontrol pembayaran muncul pada total 0. Klik produk berstok lewat UI POS agar
    // jalur React/cart yang sama dengan kasir benar-benar dieksekusi. Assertion tender di bawah
    // tetap exact terhadap seluruh master runtime; tidak ada fallback/skip bila kode hilang.
    const p6aPosCartFixture = await evaluateValue(cdp, `(() => {
      const target=[...document.querySelectorAll('button.productMain')].find((node)=>!node.disabled && node.getClientRects().length>0);
      if (!target) return { clicked:false, enabledProducts:0 };
      target.click();
      return { clicked:true, label:(target.textContent||'').trim().slice(0,120) };
    })()`);
    if (!p6aPosCartFixture?.clicked) {
      throw new Error('P6A POS UAT tidak menemukan produk berstok untuk membentuk keranjang tender nyata. Fixture stok harus melalui receiving produksi.');
    }
    await waitExpression(cdp, `(() => {
      const paymentLabel=[...document.querySelectorAll('label')].find((node)=>(node.textContent||'').includes('Metode pembayaran'));
      const select=paymentLabel?.querySelector('select');
      return Boolean(document.querySelector('.items .item') && select && select.options.length > 0);
    })()`, 'P6A POS cart + tender controls', 45000);
    evidence.checks.push({ id: 'P6A_POS_CART_TENDER_PREREQUISITE', status: 'PASS', product: p6aPosCartFixture.label, stockPath: 'production-receiving' });

    const p6aPosTenderRuntime = await evaluateValue(cdp, `(() => {
      const paymentLabel=[...document.querySelectorAll('label')].find((node)=>(node.textContent||'').includes('Metode pembayaran'));
      const select=paymentLabel?.querySelector('select');
      return {
        options: select ? [...select.options].map((option)=>String(option.value||'').trim().toUpperCase()).filter(Boolean) : [],
        hasSplit: (document.body?.innerText||'').includes('SPLIT PAYMENT'),
        hasOnAccount: (document.body?.innerText||'').includes('Piutang pelanggan'),
      };
    })()`);
    const expectedTenderCodes = uatTenderCodes;
    const missingTenderCodes = expectedTenderCodes.filter((code) => !p6aPosTenderRuntime?.options?.includes(code));
    if (missingTenderCodes.length || !p6aPosTenderRuntime?.hasSplit || !p6aPosTenderRuntime?.hasOnAccount) {
      throw new Error(`P6A POS runtime tidak memuat kontrak tender dinamis/split/piutang. missing=${missingTenderCodes.join(',') || '<none>'}`);
    }
    evidence.checks.push({ id: 'P6A_POS_TENDER_RUNTIME', status: 'PASS', tenderCodes: p6aPosTenderRuntime.options, splitPayment: true, onAccount: true });
    const p6aCartCleared = await evaluateValue(cdp, `(() => {
      const button=[...document.querySelectorAll('button')].find((node)=>(node.textContent||'').includes('Kosongkan'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!p6aCartCleared) throw new Error('P6A POS UAT gagal membersihkan keranjang setelah verifikasi tender.');
    await waitExpression(cdp, `!document.querySelector('.items .item')`, 'P6A POS cart cleanup');
    evidence.checks.push({ id: 'STAFF_MEMO_POS_SURFACE', status: 'PASS' });
    const posWorkspaces = await clickAllNavigation(cdp, '.posWorkspaceNav button', 'POS workspace');
    evidence.checks.push({ id: 'POS_ALL_WORKSPACES_RUNTIME', status: 'PASS', workspaces: posWorkspaces, matrix: await assertResponsiveMatrix(cdp, 'POS'), screenshot: await captureSuccessScreenshot(cdp, 'pos-workspaces-success') });
    evidence.checks.push({ id: 'P5_V4_POS_VISUAL_IDENTITY', status: 'PASS', metrics: await assertP5V4VisualIdentity(cdp, 'pos', { lightRoot: true }) });

    const p5PosScreenshots = [];
    for (const view of p5VisualSurfaceMap.pos?.views || []) {
      const clicked = await evaluateValue(cdp, `(() => { const target=[...document.querySelectorAll('.posWorkspaceNav button')].find((node) => { const text=(node.textContent||'').toLowerCase(); return (${JSON.stringify(view)}==='sale'&&text.includes('penjualan'))||(${JSON.stringify(view)}==='shift'&&text.includes('shift'))||(${JSON.stringify(view)}==='returns'&&text.includes('retur'))||(${JSON.stringify(view)}==='sync'&&text.includes('sinkronisasi')); }); if(!target)return false; target.click(); return true; })()`);
      if (!clicked) throw new Error(`P5 POS workspace tidak dapat dibuka: ${view}`);
      await waitExpression(cdp, `document.querySelector('[data-visual-product="pos"]')?.getAttribute('data-visual-view') === ${JSON.stringify(view)}`, `P5 POS visual ${view}`);
      await assertViewportIntegrity(cdp, `P5 POS ${view}`, 1440, 900);
      p5PosScreenshots.push({ view, screenshot: await captureSuccessScreenshot(cdp, `p5-pos-${view}`) });
    }

    await navigateAndAssert(cdp, employeeUrl, `document.body && document.body.innerText.includes('TOKO360 HR') && document.body.innerText.includes('Portal Karyawan')`, 'Employee Portal browser render');
    evidence.checks.push({ id: 'EMPLOYEE_PORTAL_BROWSER_RENDER', status: 'PASS', url: employeeUrl });
    evidence.checks.push({ id: 'EMPLOYEE_PORTAL_RESPONSIVE', status: 'PASS', matrix: await assertResponsiveMatrix(cdp, 'Employee Portal public shell'), screenshot: await captureSuccessScreenshot(cdp, 'employee-portal-responsive-success') });
    if (String(process.env.T360_UAT_PREPARE_EMPLOYEE_SELF || '').toLowerCase() === 'true') {
      await cdp.call('Runtime.evaluate', { expression: `localStorage.setItem('employeeToken', ${access}); location.reload(); true`, returnByValue: true });
      await waitExpression(cdp, `document.body && document.body.innerText.includes('TOKO360 HR') && document.body.innerText.includes('Halo,') && document.body.innerText.includes('CI-UAT-ADMIN') && document.body.innerText.includes('REKAMAN 31 HARI') && document.body.innerText.includes('Slip Gaji')`, 'Employee Portal authenticated self-service', 45000);
      const employeeText = await cdp.call('Runtime.evaluate', { expression: `document.body.innerText`, returnByValue: true });
      if (String(employeeText?.result?.value || '').includes('Profil belum tersedia')) throw new Error('Employee Portal authenticated shell dirender tetapi self-service read model gagal.');
      await waitExpression(cdp, `Boolean(document.querySelector('[data-staff-memo-surface=\"employee\"]'))`, 'Employee staff memo surface', 45000);
      evidence.checks.push({ id: 'EMPLOYEE_PORTAL_AUTHENTICATED_RUNTIME', status: 'PASS', assertions: ['employee profile', 'attendance history', 'payslip self-service'] });
      evidence.checks.push({ id: 'STAFF_MEMO_EMPLOYEE_SURFACE', status: 'PASS' });
      const employeeRoutes = await evaluateValue(cdp, `([...document.querySelectorAll('.employeeNav a')]).map(a => a.getAttribute('href')).filter(Boolean)`);
      const visitedEmployeeRoutes = [];
      const p5EmployeeScreenshots = [];
      for (const href of [...new Set(employeeRoutes || [])]) {
        await navigateAndAssert(cdp, new URL(href, employeeUrl).href, `document.body && document.body.innerText.includes('TOKO360 HR')`, `Employee Portal ${href}`);
        await assertViewportIntegrity(cdp, `Employee Portal ${href}`, 1440, 900);
        visitedEmployeeRoutes.push(href);
        const view = href === '/' ? 'home' : href.replace(/^\//,'');
        p5EmployeeScreenshots.push({ view, route: href, screenshot: await captureSuccessScreenshot(cdp, `p5-employee-${screenshotSlug(view)}`) });
      }
      evidence.checks.push({ id: 'EMPLOYEE_ALL_SELF_SERVICE_ROUTES', status: 'PASS', routes: visitedEmployeeRoutes, matrix: await assertResponsiveMatrix(cdp, 'Employee Portal'), screenshot: await captureSuccessScreenshot(cdp, 'employee-routes-success') });
      evidence.checks.push({ id: 'P5_V4_EMPLOYEE_VISUAL_IDENTITY', status: 'PASS', metrics: await assertP5V4VisualIdentity(cdp, 'employee-portal', { lightRoot: true }) });

      const p5ScreenshotMatrix = {
        id: 'P5_VISUAL_SCREENSHOT_MATRIX',
        status: 'PASS',
        baseline: p5VisualSurfaceMap.baseline,
        admin: { primary: p5AdminPrimaryScreenshots, contextual: p5AdminContextualScreenshots },
        pos: p5PosScreenshots,
        storefront: p5StorefrontScreenshots,
        employeePortal: p5EmployeeScreenshots,
        counts: {
          adminPrimary: p5AdminPrimaryScreenshots.length,
          adminContextual: p5AdminContextualScreenshots.length,
          pos: p5PosScreenshots.length,
          storefront: p5StorefrontScreenshots.length,
          employeePortal: p5EmployeeScreenshots.length,
        },
        humanAcceptance: 'PENDING',
      };
      evidence.checks.push(p5ScreenshotMatrix);
    }

    // A page that renders while throwing an uncaught JS exception is not a browser-UAT PASS.
    await sleep(500);
    if (runtimeExceptions.length) {
      evidence.browserRuntimeExceptions = runtimeExceptions.slice(0, 20);
      throw new Error(`Browser mencatat ${runtimeExceptions.length} unhandled JavaScript exception.`);
    }
    evidence.checks.push({ id: 'BROWSER_RUNTIME_EXCEPTIONS', status: 'PASS', count: 0 });
    evidence.status = 'PASS';
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    if (cdp) {
      try {
        const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        if (screenshot?.data) {
          const screenshotPath = path.resolve(root, 'logs', 'browser-uat', 'failure.png');
          fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
          fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
          evidence.failureScreenshot = path.relative(root, screenshotPath).replaceAll('\\', '/');
        }
      } catch { /* screenshot is best-effort; original UAT failure remains authoritative */ }
    }
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    cdp?.close();
    await stopBrowserProcess(browser);
    await removeBrowserProfile(tempDir);
  }
}

main().then(() => { console.log(`Browser UAT PASS - evidence: ${output}`); }).catch((error) => { console.error(`Browser UAT FAIL - ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
