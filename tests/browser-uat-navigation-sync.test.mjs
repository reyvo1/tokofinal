import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const uat = fs.readFileSync(path.join(repoRoot, 'scripts', 'browser-uat.mjs'), 'utf8');

test('clickAllNavigation menunggu nav siap sebelum tiap klik', () => {
  // Setelah workspace diklik, aplikasi masuk state "Memuat ruang kerja" lalu merender ulang
  // label subdomain. Tanpa sinkronisasi, klik berikutnya dicoba saat nav kosong dan check
  // salah menuduh navigasi rusak (terbukti di runner: nowLabels=[] dengan bodyStart
  // "Memuat ruang kerja").
  assert.match(uat, /await waitExpression\(\n\s+cdp,\n\s+`!\(document\.body && \(document\.body\.innerText \|\| ''\)\.includes\('Memuat ruang kerja'\)\)/);
  // Syaratnya harus benar-benar menolakKeadaan loading, bukan sekadar menunggu apa pun.
  assert.match(uat, /some\(\(x\) => x\.getClientRects\(\)\.length\)`/);
});

test('sinkronisasi nav tidak melemahkan gate klik', () => {
  // Menunggu bukan berarti meloloskan: item tetap wajib diklik dan gagal tetap dilempar.
  // Kalau cek klik atau lempar error dihapus, sinkronisasi ini jadi tidak berarti.
  assert.match(uat, /const clicked = await evaluateValue\(cdp, `\(\(\) => \{ const nodes=\[\.\.\.document\.querySelectorAll/);
  assert.match(uat, /if \(!clicked\) \{/);
  assert.match(uat, /navigasi tidak dapat diklik: \$\{item\}/);
});

test('waitExpression punya timeout sehingga tidak bisa menggantung selamanya', () => {
  assert.match(uat, /async function waitExpression\(cdp, expression, label, timeoutMs = 30000\)/);
  assert.match(uat, /const deadline = Date\.now\(\) \+ timeoutMs;/);
  assert.match(uat, /while \(Date\.now\(\) < deadline\)/);
});
