import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const browserUat = fs.readFileSync(path.join(repoRoot, 'scripts', 'browser-uat.mjs'), 'utf8');
const dashboard = fs.readFileSync(path.join(repoRoot, 'apps', 'admin', 'app', 'dashboard-overview.tsx'), 'utf8');

// KONTEKS DESAIN - baca sebelum mengubah apa pun di sini.
//
// Dua kali gate dashboard ini gagal di runner, dan dua-duanya karena lingkaran prasyarat
// yang tidak pernah tertutup: seed tidak pernah membuat Sale/SaleItem, dan UAT juga tidak
// pernah membuat penjualan. Di database bersih tidak ada data, jadi donut tidak muncul.
//
// Percobaan sebelumnya "memperbaikinya" dengan menjadikan gate dual-branch
// ("donut ATAU empty state") lewat helper evaluateProductMixContract. Itu rancangan yang
// SALAH: begitu environment punya penjualan, donut yang rusak akan tetap lolos karena
// empty state ikut tampil. Gate tidak lagi bisa membedakan "benar-benar tidak ada data"
// dari "render rusak" - persis kelas kegagalan berbahaya yang lolos diam-diam.
//
// Yang benar: gate tetap menuntut donut, dan prasyaratnya yang ditutup - UAT membuat
// penjualan nyata lewat API kasir sebelum dashboard diperiksa. Helper dual-branch sudah
// dihapus bersama desainnya. Pengunci keputusan ada di tests/dashboard-gate-strict.test.mjs.
//
// Berkas ini sekarang hanya menguji PERILAKU KOMPONEN: panel product-performance memang
// harus punya dua tampilan yang sah, karena kondisi "belum ada penjualan sama sekali"
// secara teknis mungkin terjadi di sistem nyata (installasi baru, sebelum transaksi pertama).

test('panel product-performance bercabang berdasarkan ada/tidaknya data penjualan', () => {
  assert.match(dashboard, /productMix\.length \?/, 'panel harus bercabang berdasarkan productMix');
  assert.match(dashboard, /<DashboardDonut items=\{productMix\} \/>/, 'cabang data ada -> donut');
});

test('panel menampilkan empty state yang informatif saat belum ada komposisi', () => {
  // Ini bukan pelonggaran gate. Ini tampilan yang benar untuk kondisi data kosong yang
  // bisa terjadi di sistem nyata, dan UAT membacanya lewat selector yang sama.
  assert.match(dashboard, /Belum ada data komposisi/);
});

test('komponen EmptyState merender kelas emptyState yang dipantau UAT', () => {
  // UAT membaca `.emptyState` di dalam panel. Panel memakai komponen <EmptyState/>, bukan
  // class CSS literal, jadi kelas itu diverifikasi di definisi komponennya. Kalau kelasnya
  // berubah, UAT harus ikut gagal dengan jelas, bukan diam-diam membaca undefined lalu
  // meloloskan apa pun.
  const adminPage = fs.readFileSync(path.join(repoRoot, 'apps', 'admin', 'app', 'page.tsx'), 'utf8');
  assert.match(adminPage, /className="emptyState/, 'EmptyState harus merender kelas emptyState');
});

test('UAT mengukur kedua sinyal panel: donut dan empty state', () => {
  assert.match(browserUat, /data-dashboard-panel="product-performance"/);
  assert.match(browserUat, /hasProductDonut/);
  assert.match(browserUat, /productEmpty/);
});

test('gate tetap menuntut line DAN donut secara mutlak', () => {
  assert.match(browserUat, /\['line','donut'\]\.every/,
    'donut wajib; jangan diubah jadi "donut ATAU empty state"');
  // Bagian yang tidak bergantung pada data tetap ketat.
  assert.match(browserUat, /dashboardContract\.metricCount !== 6/);
  assert.match(browserUat, /dashboardContract\.title !== 'Dashboard Overview'/);
  assert.match(browserUat, /requiredDashboardPanels\.every/);
});

test('prasyaratnya ditutup UAT, bukan diturunkan syaratnya', () => {
  assert.match(browserUat, /T360_UAT_PREPARE_SALES/);
  assert.match(browserUat, /id: 'SALES_CI_FIXTURE'/);
});

test('helper dual-branch sudah tidak dipakai lagi', () => {
  // Kalau helper ini muncul lagi di browser-uat, berarti desain yang salah dihidupkan
  // kembali tanpa disadari.
  assert.doesNotMatch(browserUat, /evaluateProductMixContract/,
    'helper dual-branch tidak boleh dipakai: donut rusak akan lolos');
  assert.doesNotMatch(browserUat, /admin-dashboard-contract\.mjs/);
});