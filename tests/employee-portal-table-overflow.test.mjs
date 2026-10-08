import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(repoRoot, 'apps', 'employee-portal', 'app', 'globals.css'), 'utf8');
const ux = fs.readFileSync(path.join(repoRoot, 'apps', 'employee-portal', 'app', 'employee-portal-app.tsx'), 'utf8');

// AKAR MASALAH (dibuktikan dari log runner b712135): elemen .table terukur 642px pada
// viewport 390. Computed style yang dilaporkan runner menunjukkan display:"table".
// Tailwind v4 memindai `className="table"` dan MENGHASILKAN utility `.table{display:table}`.
// Karena rule hand-written kita tidak mendeklarasikan display, elemen memakai display:table
// milik Tailwind - dan overflow-x:auto TIDAK berlaku pada display:table, sehingga
// .table shrink-to-fit ke max-content .tr (min-width:640px) + 2px border = 642px.
//
// Karena itu width:100% yang sudah ada sejak 7f21039 sama sekali tidak menolong: aturan itu
// tidak pernah ditabrak, hanya tidak relevan. Perbaikannya menghapus tabrakan nama, bukan
// menambah properti.
const TAILWIND_DISPLAY_UTILITY = /(^|[^-a-zA-Z0-9_])table($|[^a-zA-Z0-9_-])/;

test('kelas komponen tabel Employee Portal tidak boleh memakai nama utilitas Tailwind', () => {
  // .table dan .tr adalah utility Tailwind yang sah (display:table dan utilitas warna).
  // Memakainya sebagai nama komponen berarti Tailwind bisa mengambil alih styling kapan saja.
  assert.doesNotMatch(ux, /className="table"/, 'className="table" ditabrak utility Tailwind display:table');
  assert.doesNotMatch(ux, /className="tr"/, 'className="tr" ditabrak utilitas warna Tailwind');
  assert.doesNotMatch(ux, /className="tr th"/, 'className="tr th" ditabrak utilitas Tailwind');
});

test('kelas tabel Employee Portal memakai nama berprefiks hr yang tidak bisa dihasilkan Tailwind', () => {
  assert.match(ux, /className="hrTable"/);
  assert.match(ux, /className="hrRow hrHead"/);
  assert.match(css, /\.hrTable\{/);
  assert.match(css, /\.hrRow\{/);
  assert.match(css, /\.hrHead\{/);
  // Tidak boleh tersisa selector lama yang sekarang tidak terpakai.
  assert.doesNotMatch(css, /(?:^|[,{ ])\.table(?:[.{:, ]|$)/m, 'selector .table lama harus hilang');
  assert.doesNotMatch(css, /(?:^|[,{ ])\.tr(?:[.{:, ]|$)/m, 'selector .tr lama harus hilang');
});

test('nama hrTable bukan utilitas Tailwind sehingga pasti block, bukan display:table', () => {
  // Guard eksplisit: kalau suatu saat nama ini ditabrak utility, tes ini yang menangkap.
  assert.ok(!TAILWIND_DISPLAY_UTILITY.test('hrTable'), 'hrTable tidak boleh cocok utilitas table');
  assert.ok(!TAILWIND_DISPLAY_UTILITY.test('hrRow'), 'hrRow tidak boleh cocok utilitas table');
});

test('container scroll tabel tetap terkunci dan dapat digeser', () => {
  // Properti ini tetap wajib: tanpa overflow-x:auto pada container block, kolom
  // Slip gaji (min-width 640px) jadi tidak terjangkau di layar sempit.
  assert.match(css, /\.hrTable\{[^}]*min-width:0/);
  assert.match(css, /\.hrTable\{[^}]*width:100%/);
  assert.match(css, /\.hrTable\{[^}]*max-width:100%/);
  assert.match(css, /\.hrTable\{[^}]*overflow-x:auto/);
});

test('baris tabel boleh lebih lebar dari container dan harus bisa digeser', () => {
  // min-width pada baris memang disengaja - justru alasan container harus menggulir.
  assert.match(css, /\.hrRow\{[^}]*min-width:640px/);
});

test('kartu induk tabel punya min-width:0 agar rantai kontrak tidak melebar', () => {
  assert.match(css, /\.card\{[^}]*min-width:0/);
});

test('hrTable tetap berada di dalam article.card', () => {
  // Mengunci struktur yang diuji: kalau hrTable pindah ke induk lain,properti width:100%
  // mungkin tidak lagi berlaku dan test ini perlu ditinjau ulang.
  assert.match(ux, /<article className="card">[\s\S]{0,2200}?<div className="hrTable">/);
});