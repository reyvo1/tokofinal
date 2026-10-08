import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probeSource = fs.readFileSync(path.join(root, 'scripts/ci-p5-visual-probe.mjs'), 'utf8');
const browserUatSource = fs.readFileSync(path.join(root, 'scripts/browser-uat.mjs'), 'utf8');

// Angka ini hasil pengukuran nyata di Chrome headless (bukan tebakan): scrollbar vertical
// memakan 15px, jadi pada viewport 1440 lebar konten yang tersedia adalah 1425 dan main
// yang benar setelah sidebar 246 adalah 1179px.
function correctRow(overrides = {}) {
  return {
    width: 1440,
    height: 900,
    availableWidth: 1425,
    sidebarVisible: true,
    layout: { left: 0, right: 1425, width: 1425 },
    sidebar: { left: 0, right: 246, width: 246 },
    main: { left: 246, right: 1425, width: 1179 },
    content: { left: 262, right: 1409, width: 1147 },
    ...overrides,
  };
}

function extractRule() {
  const start = probeSource.indexOf('for (const row of adminGeometry.matrix) {');
  const end = probeSource.indexOf('\nfor (const id of', start);
  assert.ok(start > 0 && end > start, 'blok validasi geometri tidak ditemukan di probe');
  const body = probeSource.slice(start, end);
  return new Function(`return (function validateGeometry(adminGeometry) {${body}\n})`)();
}

const validateGeometry = extractRule();

test('P5 geometry: lebar yang dibandingkan adalah availableWidth, bukan ukuran viewport', () => {
  // Aturan lama menghitung main >= width - sidebar - 8 = 1440 - 246 - 8 = 1186. Main yang
  // benar adalah 1179, jadi aturan lama GAGAL pada layout yang benar pun - check mustahil
  // hijau. Kalau suatu saat probe kembali memakai row.width, test ini harus gagal.
  const row = correctRow();
  assert.ok(row.main.width < row.width - row.sidebar.width - 8, 'prekondisi: aturan lama salah');
  assert.doesNotThrow(() => validateGeometry({ matrix: [row] }), 'layout benar harus lulus');
});

test('P5 geometry: layout desktop benar lulus untuk ketiga breakpoint', () => {
  const matrix = [
    correctRow(),
    correctRow({ width: 1024, height: 768, availableWidth: 1009, layout: { left: 0, right: 1009, width: 1009 }, sidebar: { left: 0, right: 246, width: 246 }, main: { left: 246, right: 1009, width: 763 }, content: { left: 262, right: 993, width: 731 } }),
    correctRow({ width: 390, height: 844, availableWidth: 375, sidebarVisible: false, layout: { left: 0, right: 375, width: 375 }, sidebar: { left: -286, right: 0, width: 286 }, main: { left: 0, right: 375, width: 375 }, content: { left: 16, right: 359, width: 343 } }),
  ];
  assert.doesNotThrow(() => validateGeometry({ matrix }));
});

test('P5 geometry: main yang menyusut, celah kolom, dan sidebar tersembunyi tetap gagal', () => {
  const shrink = [correctRow()];
  shrink[0].main.width -= 40;
  shrink[0].main.right -= 40;
  assert.throws(() => validateGeometry({ matrix: shrink }), /main workspace menyusut/);

  const gap = [correctRow()];
  gap[0].main.left += 30;
  assert.throws(() => validateGeometry({ matrix: gap }), /desktop shell geometry invalid/);

  const hidden = [correctRow({ sidebarVisible: false })];
  assert.throws(() => validateGeometry({ matrix: hidden }), /desktop shell geometry invalid/);
});

// Dua invariant ini TIDAK ADA di versi probe sebelumnya. Gate harus tetap menangkapnya,
// kalau tidak perbaikan scrollbar ini sama saja menukar satu bug bug dengan bug lain.
test('P5 geometry: main wajib menempel ke tepi kanan layout dan content tidak boleh menyusut', () => {
  const rightGap = [correctRow()];
  rightGap[0].main.right -= 60;
  assert.throws(() => validateGeometry({ matrix: rightGap }), /tidak menempel ke tepi kanan layout/);

  const narrowContent = [correctRow()];
  narrowContent[0].content.width = narrowContent[0].main.width - 200;
  assert.throws(() => validateGeometry({ matrix: narrowContent }), /content terlalu sempit/);

  assert.ok(!probeSource.includes('row.width - row.sidebar.width'), 'probe tidak boleh menghitung ekspektasi dari viewport yang diminta');
});

test('P5 geometry: mobile tetap wajib sidebar tersembunyi dan main selebar konten', () => {
  const mobile = {
    width: 390, height: 844, availableWidth: 375,
    layout: { left: 0, right: 375, width: 375 },
    sidebar: { left: -286, right: 0, width: 286 },
    main: { left: 0, right: 375, width: 375 },
    content: { left: 16, right: 359, width: 343 },
  };
  assert.throws(() => validateGeometry({ matrix: [{ ...mobile, sidebarVisible: true }] }), /mobile shell geometry invalid/);
  assert.throws(() => validateGeometry({ matrix: [{ ...mobile, main: { ...mobile.main, width: 345 } }] }), /mobile shell geometry invalid/);
  assert.doesNotThrow(() => validateGeometry({ matrix: [{ ...mobile, sidebarVisible: false }] }));
});

test('browsers-uat merekam availableWidth dan layout agar probe punya angka yang benar', () => {
  const returnLine = browserUatSource.match(/return \{ width, height, availableWidth[^\n]*\n/);
  assert.ok(returnLine, 'assertAdminShellGeometry harus mengembalikan availableWidth');
  assert.match(returnLine[0], /\blayout\b/, 'rect layout harus ikut direkam untuk memeriksa main menempel tepi kanan');
  assert.match(browserUatSource, /clientWidth: document\.documentElement\.clientWidth/);
});