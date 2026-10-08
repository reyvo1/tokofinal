// Audit escaping backslash di dalam template literal yang dikirim ke browser.
//
// Tiga kali berturut-turut bug yang sama muncul di scripts/browser-uat.mjs:
//   /\d+/        -> /d+/        (tidak pernah match; parse selalu null, check tidak menguji apa pun)
//   /^rgba?\(    -> /^rgba?(/   (SyntaxError Unterminated group)
//   /gradient\(  -> /gradient(/ (SyntaxError Unterminated group)
// Ketiganya punya satu sebab: di dalam template literal, satu backslash hilang sebelum string
// sampai ke browser. Semuanya muncul sebagai kegagalan yang tidak menyesatkan dan ketiganya
// mahal ditelusuri.
//
// Metode: ekstrak blok evaluate yang benar-benar dikirim ke browser, lalu jalankan sebagai
// JavaScript. Kalau ada backslash ganjil, blok itu gagal compile atau salah baca - persis seperti
// yang terjadi di browser. Ini menguji perilaku, bukan tebakan pola teks.
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const uat = await readFile(new URL('../scripts/browser-uat.mjs', import.meta.url), 'utf8');

/**
 * Ambil isi setiap template literal yang berisi program browser (IIFE atau blok DOM).
 * Backtick yang di-escape dilewati supaya tidak salah menghitung batas string.
 */
function extractBrowserEvaluateBlocks(source) {
  const blocks = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('`', i);
    if (open < 0) break;
    let j = open + 1;
    let escaped = false;
    while (j < source.length) {
      const ch = source[j];
      if (escaped) { escaped = false; j++; continue; }
      if (ch === '\\') { escaped = true; j++; continue; }
      if (ch === '`') break;
      j++;
    }
    if (j >= source.length) break;
    const body = source.slice(open + 1, j);
    // Ganti interpolasi ${...} dengan placeholder. Template literal di file ini menyisipkan
    // nilai Node (selector, routeJson, dan sebagainya) yang tidak ada di file - new Function()
    // tidak bisa menyelesaikannya, jadi harus diganti sebelum dikompilasi.
    const compilable = body.replace(/\$\{[^{}]*\}/g, 'null');
    if (/\(\(\)\s*=>|\{\s*const\s+(limit|root|parse)\b|document\./.test(compilable)) {
      blocks.push({ line: source.slice(0, open).split('\n').length, body: compilable });
    }
    i = j + 1;
  }
  return blocks;
}

const blocks = extractBrowserEvaluateBlocks(uat);

test('blok evaluate ditemukan (ekstraksi tidak boleh gagal diam-diam)', () => {
  assert.ok(blocks.length >= 3, `hanya ${blocks.length} blok evaluate ditemukan`);
  assert.ok(
    blocks.some((b) => /const parse = \(value\)/.test(b.body)),
    'blok parse tidak ditemukan - ekstraksi tidak menjangkau evaluate utama',
  );
});

test('setiap evaluate block yang dikirim ke browser bisa dikompilasi apa adanya', () => {
  // new Function() di sini mereplikasi apa yang evaluateValue lakukan: string dari template
  // literal di-parse sebagai JavaScript. Backslash ganjil membuat regexp rusak persis seperti
  // di browser, yang melempar SyntaxError dengan pesan "Uncaught" tanpa sumber.
  const failures = [];
  for (const { line, body } of blocks) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(body);
    } catch (error) {
      failures.push({ line, error: String(error.message).slice(0, 140) });
    }
  }
  assert.deepEqual(failures, [], 'Blok evaluate gagal compile:\n' + JSON.stringify(failures, null, 1));
});

test('evaluate utama benar-benar membaca warna (bukan selalu null)', () => {
  // Kalau ini tidak bisa dievaluasi, parse selalu null dan luminance selalu null, jadi check tema
  // praktis tidak pernah menguji apa pun - ia hanya gagal karena null, bukan karena warnanya salah.
  const main = blocks.find((b) => /const parse = \(value\)/.test(b.body));
  assert.ok(main, 'blok parse tidak ditemukan');
  // Blok penuh menyentuh document/window, yang tidak ada di Node. Yang diuji adalah parse,
  // jadi hanya helper itu yang diekstrak - persis helper yang dipakai untuk luminance.
  const from = main.body.indexOf('const parse = (value)');
  const to = main.body.indexOf('const luminance = (rgb)');
  assert.ok(from >= 0 && to > from, 'helper parse/luminance tidak ditemukan di dalam blok');
  const rawHelpers = main.body.slice(from, main.body.indexOf('\n', to));
  // Helper diambil dari file apa adanya, jadi masih memuat satu lapis escaping template literal.
  // Browser menerima string SETELAH satu lapis itu hilang: file \\d menjadi \d, yang baru jadi
  // regex yang benar. Test wajib mengulang langkah yang sama, kalau tidak ia melaporkan bug yang
  // tidak ada (blok mentah selalu mengembalikan null untuk rgb).
  const helpers = rawHelpers.replace(/\\\\/g, '\\');
  const parse = new Function(`${helpers}\nreturn parse;`)();
  assert.deepEqual(parse('rgb(244, 247, 251)'), [244, 247, 251], 'rgb solid harus terbaca');
  assert.equal(parse('rgba(0, 0, 0, 0)'), null, 'rgba alpha 0 berarti transparan, bukan hitam');
  assert.deepEqual(parse('#fafaf9'), [250, 250, 249], 'hex harus dibaca sebagai warna');
});

test('evaluateValue melaporkan SyntaxError lengkap beserta baris dan kolom', () => {
  // exceptionDetails.text untuk SyntaxError hanya berisi kata "Uncaught": tanpa nama exception
  // dan tanpa posisi. Baca description/className supaya bug di atas bisa dilacak dalam satu run.
  assert.match(uat, /exceptionDetails/);
  assert.match(uat, /ex\.description \|\| detail\.text/);
  assert.match(uat, /lineNumber/);
  assert.match(uat, /columnNumber/);
});

test('tidak ada karakter non-ASCII di source browser-uat.mjs', () => {
  const offenders = [];
  uat.split('\n').forEach((line, i) => {
    const bad = [...line].filter((ch) => ch.codePointAt(0) > 127);
    if (bad.length) offenders.push({ line: i + 1, chars: bad.join('') });
  });
  assert.deepEqual(offenders, [], 'Karakter non-ASCII: ' + JSON.stringify(offenders, null, 1));
});