// Backtick di dalam template literal menutup string itu sendiri.
//
// Di browser-uat.mjs hampir semua evaluateValue/evaluate menerima kode browser sebagai template
// literal. Menulis backtick di dalam komentar di string itu - bahkan hanya untuk menyebut
// `.table` - menutup literal lebih awal, dan sisa kode jadi error runtime di browser
// ("... is not a function") yang jauh dari penyebab sebenarnya. Sudah terjadi DUA KALI di repo
// ini: satu di parse() (backslash \d tertelan) dan satu di komentar .table. Keduanya muncul
// sebagai kegagalan yang sama sekali tidak menyesatkan.
//
// Test ini menangkap yang bisa ditangkap: file harus lolos syntax check, backtick harus genap,
// dan tidak boleh ada backtick di dalam komentar yang berada di dalam template literal.
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const uatUrl = new URL('../scripts/browser-uat.mjs', import.meta.url);
const uatPath = uatUrl.pathname;
const uat = await readFile(uatUrl, 'utf8');

test('browser-uat.mjs lolos syntax check Node', async () => {
  let stderr = '';
  try {
    await run(process.execPath, ['--check', uatPath]);
  } catch (error) {
    stderr = error.stderr || String(error);
  }
  assert.equal(stderr, '', `browser-uat.mjs gagal syntax check:\n${stderr}`);
});

test('jumlah backtick di file genap', () => {
  const ticks = uat.match(/`/g) || [];
  assert.equal(ticks.length % 2, 0, `jumlah backtick ganjil (${ticks.length}) - ada template literal tak tertutup`);
});

test('tidak ada backtick di dalam komentar yang berada di dalam blok evaluate*', () => {
  const openRe = /evaluate(?:Value)?\(cdp,\s*`/g;
  const offenders = [];
  let match;
  while ((match = openRe.exec(uat))) {
    const start = match.index + match[0].length;
    // Maju sampai backtick penutup; kumpulkan baris komentar yang mengandung backtick.
    for (let i = start; i < uat.length && uat[i] !== '`'; i += 1) {
      if (uat[i] !== '\n') continue;
      const lineEnd = uat.indexOf('\n', i + 1);
      const line = uat.slice(i + 1, lineEnd === -1 ? uat.length : lineEnd);
      if (/^\s*\/\//.test(line) && line.includes('`')) offenders.push(line.trim());
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `backtick di dalam komentar template literal akan menutup string:\n  ${offenders.join('\n  ')}`,
  );
});

test('regex di dalam template literal tidak pernah single-escaped', () => {
  // /\d+/ di dalam template literal ditelan jadi /d+/ yang tidak pernah match rgb(244, 247, 251).
  const badSingle = uat.match(/match\(\/\\d/g) || [];
  assert.deepEqual(badSingle, [], `ada ${badSingle.length} match(/\\d...) single-escaped di template literal`);
  assert.match(uat, /match\(\/\\\\d\+/, 'parse() harus double-escape agar regex benar-benar jalan');
});