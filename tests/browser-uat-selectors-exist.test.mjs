// Setiap selector yang dipakai scripts/browser-uat.mjs harus benar-benar ADA di source app.
//
// Bug yang ditemukan: check dashboard memakai `.dashboardPageTitleLine h1`, sedangkan class yang
// sebenarnya dirender adalah `adminPageTitleLine`. Selector itu tidak pernah ada, jadi check
// judul dashboard TIDAK PERNAH menguji judul - dan ia "gagal" dengan pesan `title: ""` yang
// terlihat seperti defect produk, padahal produknya benar.
//
// Efek samping yang lebih besar: check yang selector-nya salah bisa lolos hijau lama karena
// membandingkan nilai kosong, atau gagal dengan penyebab yang salah. Audit ini
// menutup kelas bug itu di level source, di luar browser.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repo = new URL('../', import.meta.url).pathname;
const uat = await readFile(path.join(repo, 'scripts/browser-uat.mjs'), 'utf8');

async function collect(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collect(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(await readFile(p, 'utf8'));
  }
  return out;
}

const chunks = [];
for (const r of ['apps/admin/app', 'apps/pos/app', 'apps/storefront/app', 'apps/employee-portal/app']) {
  chunks.push(...(await collect(path.join(repo, r))));
}
const source = chunks.join('\n');

function keywords(sel) {
  const out = [];
  for (const m of sel.matchAll(/\.([A-Za-z_][\w-]*)/g)) out.push(m[1]);
  for (const m of sel.matchAll(/\[([a-zA-Z-]+)/g)) out.push(m[1]);
  for (const m of sel.matchAll(/#([A-Za-z_][\w-]*)/g)) out.push(m[1]);
  return [...new Set(out)];
}

test('source app yang dibaca audit benar-benar ada (guard terhadap test hening kosong)', () => {
  assert.ok(chunks.length > 40, `hanya ${chunks.length} file source terbaca - audit akan lulus hening`);
  assert.ok(source.includes('adminV4Layout'), 'source admin harus memuat shell yang dikenal');
});

test('setiap selector di browser-uat.mjs punya padanan di source app', () => {
  const selectors = new Set();
  for (const m of uat.matchAll(/querySelector(?:All)?\((?:'([^']+)'|"([^"]+)")\)/g)) {
    const s = m[1] ?? m[2];
    if (s) selectors.add(s);
  }
  assert.ok(selectors.size > 20, `hanya ${selectors.size} selector terbaca - guard tidak bermakna`);

  const orphans = [];
  for (const sel of selectors) {
    const kws = keywords(sel);
    if (!kws.length) continue;
    // Semua kata kunci harus ada; kalau satu pun hilang, selector itu merujuk markup tak ada.
    const absent = kws.filter((k) => !source.includes(k));
    if (absent.length) orphans.push(`${sel} (tidak ada: ${absent.join(', ')})`);
  }
  assert.deepEqual(orphans, [], `selector browser-uat.mjs merujuk markup yang tidak ada:\n  ${orphans.join('\n  ')}`);
});

test('selector judul dashboard memakai class yang benar-benar dirender', () => {
  // Regresi langsung untuk bug yang ditemukan: dashboardPageTitleLine vs adminPageTitleLine.
  assert.match(uat, /\.adminPageTitleLine h1/);
  assert.ok(!uat.includes('dashboardPageTitleLine'), 'selector judul masih memakai class yang tidak pernah ada');
  // Dan class itu harus benar-benar ada di shell.
  assert.ok(source.includes('adminPageTitleLine'), 'app-shell harus merender adminPageTitleLine');
});