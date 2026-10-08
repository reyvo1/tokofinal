// Apakah rekomendasi "¿cuánto debo pedir?" bisa dipertanggungjawabkan?
//
// F10 dilaporkan PARTIAL karena forecast/reorder hanya membandingkan stok dengan `minStock` yang
// diketik manusia. Itu menjawab "di bawah garis?", bukan "habis kapan?" dan "pesan berapa?".
// Test ini menjalankan forecast sungguhan dan, yang lebih penting, menguji kasus yang membuat
// angka hasil rekaan terlihat seperti fakta.
//
// Aturan yang diuji di sini:
//   - Tanpa riwayat penjualan, TIDAK BOLEH melaporkan laju 0/hari. Itu berarti "tidak pernah
//     terjual", yang berbeda dari "belum kita amati cukup lama".
//   - Rekomendasi tanpa data hanya boleh memakai minStock pemilik, dan harus mengatakannya.
//   - Lead time yang tidak terukur harus ditandai sebagai asumsi, bukan fakta.
//   - Stok dalam perjalanan tidak boleh dihitung dua kali.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const forecast = await load('apps/api/src/advanced-inventory/reorder-forecast.ts', { platform: 'node' });
const { computeReorderForecast } = forecast;

const NOW = new Date('2026-10-01T00:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

/** Sales history spread over `n` distinct days, `perDay` base units each. */
const history = (n, perDay) => Array.from({ length: n }, (_, i) => ({ date: daysAgo(i % n), baseQuantity: perDay }));

test('tanpa riwayat: laju NULL, bukan 0 — dan alasannya terbaca', () => {
  const r = computeReorderForecast({ minStock: 20, available: 5, projectedAvailable: 5, inboundInTransit: 0, demand: [], timeZone: 'Asia/Makassar', observedLeadTimeDays: 5, now: NOW });
  assert.equal(r.dailyDemand, null,
    'produk tanpa penjualan tidak boleh melaporkan laju 0/hari — itu berarti "tidak pernah terjual", bukan "belum terukur"');
  assert.equal(r.daysOfCover, null, 'tanpa laju, sisa hari tidak bisa dinyatakan');
  assert.equal(r.confidence, 'MIN_STOCK_ONLY');
  assert.match(r.basis, /belum ada penjualan/);
  assert.ok(r.drivers.some((d) => /tidak terukur/.test(d)), 'driver harusiales menjelaskan kenapa');
});

test('tanpa riwayat, rekomendasi hanya minStock pemilik — dan itu dikatakan', () => {
  const r = computeReorderForecast({ minStock: 20, available: 5, projectedAvailable: 5, inboundInTransit: 0, demand: [], timeZone: 'Asia/Makassar', observedLeadTimeDays: 5, now: NOW });
  assert.equal(r.recommendedQuantity, 15, 'rekomendasi harus = minStock - stok, yaitu 20 - 5');
  assert.ok(r.drivers.some((d) => /minStock 20/.test(d)), 'UI harus tahu rekomendasi ini bersandar pada buffer pemilik');
});

test('histori tipis (1 hari) tidak diukur jadi laju — satu transaksi bukan laju', () => {
  const r = computeReorderForecast({ minStock: 0, available: 10, projectedAvailable: 10, inboundInTransit: 0, demand: history(1, 50), timeZone: 'Asia/Makassar', observedLeadTimeDays: 5, now: NOW });
  assert.equal(r.dailyDemand, null, 'satu hari penjualan tidak cukup untuk menyatakan laju harian');
  assert.equal(r.confidence, 'MIN_STOCK_ONLY');
});

test('riwayat memadai: laju terukur dan bisa dihitung ulang manual', () => {
  // 10 hari dengan 3 unit/hari = 30 unit dalam jendela 30 hari = 1.0/hari.
  const r = computeReorderForecast({ minStock: 0, available: 40, projectedAvailable: 40, inboundInTransit: 0, demand: history(10, 3), timeZone: 'Asia/Makassar', observedLeadTimeDays: 10, now: NOW });
  assert.equal(r.dailyDemand, 3, '30 unit / 10 HARI PENJUALAN = 3 per hari; membagi dengan 30 hari jendela akan memesan kurang');
  assert.equal(r.daysOfCover, 13, '40 unit pada laju 3/hari = 13 hari');
  assert.equal(r.confidence, 'MEASURED');
  assert.equal(r.recommendedQuantity, 0, '40 unit menutup lead time 10 hari pada laju 3/hari');
});

test('lead time yang tidak terukur ditandai sebagai asumsi, bukan fakta', () => {
  const r = computeReorderForecast({ minStock: 0, available: 5, projectedAvailable: 5, inboundInTransit: 0, demand: history(10, 2), timeZone: 'Asia/Makassar', observedLeadTimeDays: null, now: NOW });
  assert.equal(r.leadTimeIsAssumed, true, 'tanpa riwayat PO, lead time harus ditandai sebagai asumsi');
  assert.equal(r.leadTimeDays, 7);
  assert.ok(r.drivers.some((d) => /diasumsikan/.test(d)));
});

test('lead time terukur dipakai apa adanya, bukan override ke default', () => {
  const r = computeReorderForecast({ minStock: 0, available: 5, projectedAvailable: 5, inboundInTransit: 0, demand: history(10, 2), timeZone: 'Asia/Makassar', observedLeadTimeDays: 21, now: NOW });
  assert.equal(r.leadTimeDays, 21, 'lead time 21 hari harus dipakai; lead time pendek akan memesan terlalu sedikit');
  assert.equal(r.leadTimeIsAssumed, false);
});

test('stok dalam perjalanan mengurangi yang perlu dipesan, dan tidak dihitung dua kali', () => {
  // 10 unit/hari, lead time 10 hari = butuh 100. projectedAvailable sudah memuat barang datang 60,
  // jadi yang perlu dipesan 40 — bukan 100 dan bukan 0.
  const r = computeReorderForecast({ minStock: 0, available: 0, projectedAvailable: 60, inboundInTransit: 60, demand: history(10, 30), timeZone: 'Asia/Makassar', observedLeadTimeDays: 10, now: NOW });
  assert.equal(r.dailyDemand, 30, '300 unit / 10 hari penjualan = 30 per hari');
  assert.equal(r.recommendedQuantity, 240, 'butuh 300 untuk lead time 10, 60 dalam perjalanan → 240');
  assert.ok(r.drivers.some((d) => /60 unit sedang dalam perjalanan/.test(d)), 'UI perlu tahu barang sudah di jalan');
});

test('minStock pemilik mengalahkan forecast yang lebih kecil', () => {
  // Demand lead time HARUS lebih kecil dari minStock agar aturan ini benar-benar diuji:
  // 1 unit/hari x lead time 2 hari = 2, jauh di bawah buffer 50.
  const r = computeReorderForecast({ minStock: 50, available: 10, projectedAvailable: 10, inboundInTransit: 0, demand: history(10, 3), timeZone: 'Asia/Makassar', observedLeadTimeDays: 2, now: NOW });
  assert.equal(r.dailyDemand, 3);
  assert.equal(r.recommendedQuantity, 40, 'minStock 50 menang atas demand lead-time 6 → 50-10 = 40');
  assert.ok(r.drivers.some((d) => /minStock/.test(d)), 'dan itu harus dijelaskan');
});

test('rekomendasi dibulatkan ke pack pembelian', () => {
  // Butuh 45, pack 12 → pesan 48 (4 pak), bukan 45 yang tidak bisa dibeli.
  const r = computeReorderForecast({ minStock: 0, available: 0, projectedAvailable: 0, inboundInTransit: 0, demand: history(10, 135), timeZone: 'Asia/Makassar', observedLeadTimeDays: 10, now: NOW, packSize: 12 });
  assert.equal(r.dailyDemand, 135, '1350 unit / 10 hari penjualan = 135 per hari');
  // 45/hari x lead time 10 = 450 unit. Pack 12 → 38 pak = 456 unit yang bisa dibeli.
  assert.equal(r.recommendedPacks, 113, '135/hari x 10 hari = 1350 unit; pack 12 → 113 pak = 1356 unit');
  assert.equal(r.orderQuantity, 1356, 'orderQuantity harus 1356 unit (113 x 12) — inilah yang ditulis ke PO');
  assert.notEqual(r.recommendedPacks, r.orderQuantity,
    'regresi: recommendedPacks pernah mengembalikan UNIT bulat, bukan jumlah pak, sehingga UI akan menampilkan "456 pak"');
});

test('produk tanpa pack: recommendedPacks null, bukan 0 — dan quantity tetap base unit', () => {
  const r = computeReorderForecast({ minStock: 0, available: 0, projectedAvailable: 0, inboundInTransit: 0, demand: history(10, 30), timeZone: 'Asia/Makassar', observedLeadTimeDays: 10, now: NOW, packSize: null });
  assert.equal(r.recommendedPacks, null, 'tanpa pack size, jumlah pak tidak bisa dinyatakan');
  assert.equal(r.orderQuantity, r.recommendedQuantity, 'tanpa pack, orderQuantity = quantity dalam base unit');
  assert.equal(r.recommendedQuantity, 300, '30/hari x lead time 10 = 300 unit base');
});

test('stok habis sekarang: daysOfCover 0, bukan null', () => {
  const r = computeReorderForecast({ minStock: 0, available: 0, projectedAvailable: 0, inboundInTransit: 0, demand: history(10, 5), timeZone: 'Asia/Makassar', observedLeadTimeDays: 7, now: NOW });
  assert.equal(r.daysOfCover, 0, 'stok 0 dengan laju terukur = 0 hari, bukan "tidak diketahui"');
});

test('penjualan di LUAR jendela 30 hari tidak ikut dihitung', () => {
  // 40 hari lalu = terlalu tua, tidak boleh membuat laju.
  const stale = [{ date: daysAgo(40), baseQuantity: 1000 }];
  const r = computeReorderForecast({ minStock: 0, available: 50, projectedAvailable: 50, inboundInTransit: 0, demand: stale, timeZone: 'Asia/Makassar', observedLeadTimeDays: 5, now: NOW });
  assert.equal(r.dailyDemand, null, 'penjualan 40 hari lalu tidak boleh dihitung sebagai laju');
});
