import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const browserUat = read('scripts/browser-uat.mjs');
const wrapper = read('scripts/run-built-browser-uat.mjs');

test('kegagalan browser UAT menyimpan PENYEBAB, bukan hanya "exit 1"', () => {
  // Ditemukan UAT GitHub (run 36908364965): `built-browser-uat-latest.json` hanya berisi
  // "Browser UAT gagal (exit 1)." - stderr Chrome yang sebenarnya hilang. Log runner sudah
  // di-retire GitHub dalam hitungan hari, jadi kegagalan browser jadi mustahil ditelusuri
  // tanpa menjalankan ulang seluruh pipeline.
  //
  // Wrapper sekarang membaca `browser-uat-latest.json` milik child dan menyertakan error aslinya.
  // Ini menambah BUKTI pada gate. Gate tidak jadi lebih longgar: ia tetap exit non-zero.
  assert.match(wrapper, /browser-uat-latest\.json/,
    'wrapper harus membaca evidence child');
  assert.match(wrapper, /parsed\.error/,
    'wrapper harus mengambil pesan error dari evidence child');
  assert.match(wrapper, /Penyebab/,
    'pesan kegagalan harus menyebut penyebabnya');
  assert.doesNotMatch(wrapper, /reject\(new Error\(`Browser UAT gagal \(exit \$\{code \?\? 1\}\)\.`\)\)/,
    'pesan "exit 1" tanpa penyebab tidak boleh lagi menjadi satu-satunya output');
});

test('wrapper tetap gagal saat child exit non-zero (gate tidak dilonggarkan)', () => {
  // YangEnsure dari perbaikan di atas: memperbaiki pesan BUKAN memperbaiki verdict.
  const block = wrapper.slice(wrapper.indexOf("browserChild.once('exit'"));
  assert.match(block, /if \(code === 0\) return resolve\(\);/,
    'hanya exit 0 yang boleh resolve');
  assert.match(block, /reject\(new Error\(`Browser UAT gagal/,
    'exit non-zero tetap harus reject');
});

test('sanitasi D-Bus: runner GitHub mewarisi address yang tidak bisa di-parse', () => {
  // Runner GitHub menyetel DBUS_SESSION_BUS_ADDRESS ke nilai rusak; Chrome melaporkan
  // "Could not parse server address". Headless tidak butuh D-Bus, jadi address itu harus
  // ditimpa pada env child, bukan diwariskan.
  assert.match(browserUat, /DBUS_SESSION_BUS_ADDRESS: '\/dev\/null'/,
    'child browser harus mendapat D-Bus address yang valid');
  assert.match(browserUat, /'--disable-dbus'/,
    'D-Bus harus dimatikan eksplisit untuk headless');
});

test('pesan "tidak siap" membedakan Chrome menolak start dari timeout', () => {
  // Gejala yang menyesatkan: Chrome menolak start wegen D-Bus, tapi UAT melaporkan "tidak siap"
  // seolah timeout - membuat orang menambah timeout, yang tidak menolong.
  assert.match(browserUat, /refusedToStart/,
    'kode harus membedakan kegagalan start dari timeout');
  assert.match(browserUat, /bukan timeout/,
    'pesan harus menyatakan bahwa bukan timeout');
});
