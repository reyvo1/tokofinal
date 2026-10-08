// Apakah `GET /advanced-inventory/reorder-visibility` benar-benar mengembalikan forecast?
//
// Unit test `reorder-forecast-runtime.test.mjs` membuktikan FUNGSI forecast-nya benar. Test ini
// membuktikan hal yang berbeda dan mudah luput: bahwa service benar-benar memanggil fungsi itu
// dengan data nyata, dan meneruskan hasilnya ke response.
//
// Kalau wiring-nya putus, fungsi forecast tetap hijau di test-nya sendiri sementara operator tetap
// melihat tabel minStock yang lama. Itu kelas bug yang tidak terlihat dari test unit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

test('service listReorderVisibility benar-benar memanggil computeReorderForecast', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/advanced-inventory/advanced-inventory.service.ts'), 'utf8');
  // Keberadaan fungsi saja tidak cukup — harus dipanggil di dalam listReorderVisibility.
  const start = src.indexOf('async listReorderVisibility');
  assert.notEqual(start, -1, 'listReorderVisibility harus ada');
  const end = src.indexOf('async createTransfer', start);
  const body = src.slice(start, end === -1 ? undefined : end);

  assert.match(body, /computeReorderForecast\(/,
    'method harus memanggil computeReorderForecast; kalau tidak, forecast ada tapi tidak pernah dipakai');
  assert.match(body, /forecast \}/,
    'hasilnya harus ikut keluar di response — frontend tidak bisa menebak angka yang tidak dikirim');
  // Dan datanya harus berasal dari sumber nyata, bukan konstanta.
  assert.match(body, /saleItem\.findMany/,
    'demand harus diukur dari SaleItem, bukan dari angka tetap');
  assert.match(body, /purchaseOrder\.findMany/,
    'lead time harus diukur dari PurchaseOrder, bukan diasumsikan diam-diam');
  assert.doesNotMatch(body, /dailyDemand: \d/,
    'tidak boleh ada laju permintaan yang diketik langsung di service');
});

test('endpoint reorder-visibility tetap ada dan tetap permission-gated', () => {
  const ctrl = fs.readFileSync(path.join(ROOT, 'apps/api/src/advanced-inventory/advanced-inventory.controller.ts'), 'utf8');
  assert.match(ctrl, /@Get\('reorder-visibility'\)/,
    'endpoint reorder-visibility harus tetap ada; UI Admin memakainya');
  // Rekomendasi purchase adalah keputusan unsett, jadi role gate tidak boleh longgar.
  const gate = ctrl.slice(ctrl.indexOf("@Get('reorder-visibility')") - 200, ctrl.indexOf("@Get('reorder-visibility')"));
  assert.match(gate, /@Roles\(/,
    'endpoint harus tetap dibatasi role — reorder memengaruhi uang, bukan hanya tampilan');
});

test('UI Admin menampilkan forecast, dan "belum terukur" TIDAK ditampilkan sebagai 0', () => {
  const ops = fs.readFileSync(path.join(ROOT, 'apps/admin/app/modules/operations.tsx'), 'utf8');
  assert.match(ops, /forecast:\{/, 'tipe ReorderVisibility harus mendeklarasikan forecast');
  assert.match(ops, /belum terukur/,
    'laju yang tidak terukur harus ditulis "belum terukur", bukan 0 — 0 berarti "tidak pernah terjual"');
  assert.match(ops, /daysOfCover === null/, 'sisa hari yang tidak bisa dihitung harus ditampilkan sebagai "—"');
  assert.match(ops, /leadTimeIsAssumed/, 'lead time yang diasumsikan harus ditandai di layar');
  assert.match(ops, /orderQuantity/, 'UI harus menuliskan jumlah yang benar-benar dipesan, dalam satuan pack');
  assert.match(ops, /drivers\.join/, 'alasan per baris harus bisa dibaca, bukan hanya angkanya');
  // Urutan: angka sebelum penjelasan. Kalau drivers dihapus, angka tetap ada - bukan sebaliknya.
  assert.match(ops, /orderQuantity[\s\S]{0,1200}drivers\.join/);
});

test('rekomendasi memakai MAKSIMUM antara demand dan minStock, bukan penjumlahan', () => {
  // Regresi nyata yang ditemukan test: `demand + minStock` membuat buffer pemilik terhitung dua
  // kali, dan minStock 50 berubah menjadi pesanan 61. Menambahkannya membuat rekomendasi melebihi
  // kedua alasan yang seharusnya menghasilkannya.
  const fc = fs.readFileSync(path.join(ROOT, 'apps/api/src/advanced-inventory/reorder-forecast.ts'), 'utf8');
  assert.match(fc, /Math\.max\(demandDuringLeadTime, input\.minStock\)/,
    'target harus maksimum dari demand dan minStock; penjumlahan menghitung buffer dua kali');
  assert.doesNotMatch(fc, /demandDuringLeadTime \+ input\.minStock/,
    'regresi: penjumlahan demand+minStock menghasilkan over-order');
});
