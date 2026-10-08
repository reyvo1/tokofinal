import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'apps/admin/app/globals.css'), 'utf8');
const tsx = fs.readFileSync(path.join(root, 'apps/admin/app/dashboard-overview.tsx'), 'utf8');

function declarationsFor(selector) {
  const pattern = new RegExp(`(^|[,}])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const match = pattern.exec(css);
  assert.ok(match, `selector ${selector} tidak ditemukan di globals.css`);
  return Object.fromEntries(
    match[2]
      .split(';')
      .map((part) => part.split(':').map((piece) => piece.trim()))
      .filter((pair) => pair.length === 2),
  );
}

// Defect terukur di runner 1440x900: `scrollWidth` 1448 > `innerWidth` 1440, pelaku
// `.dashboardLegendRow` selebar 215.28px di dalam kolom `.dashboardDonutLegend` 171.44px.
// Akarnya `min-width: auto` bawaan grid item: `.dashboardLegendRow` adalah anak langsung
// `.dashboardDonutLegend` yang `display: grid`, jadi ia DI LARANG menyusut di bawah lebar
// min-content-nya, dan karena `overflow-x` di sini `visible` luberannya ikut menambah
// `scrollWidth` dokumen.
//
// Cakupan test ini sengaja sempit: hanya rantai legenda yang benar-benar meluber. Menebak
// anak container grid "umum" dari teks CSS+TSX menghasilkan false positive pada
// `dashboardDonutVisual` dan `dashboardDonutLegend` yang justru tidak meluber.
test('grid item legenda donut wajib min-width:0 supaya tidak meluber', () => {
  const parent = declarationsFor('.dashboardDonutLegend');
  assert.equal(parent.display, 'grid', 'induk legenda harus grid — inilah yang memberi min-width:auto');

  const row = declarationsFor('.dashboardLegendRow');
  assert.equal(row.display, 'flex');
  assert.equal(row['min-width'], '0', 'grid item tanpa min-width:0 akan meluber keluar kolomnya');

  // Ellipsis hanya bekerja kalau judul juga boleh menyusut.
  const title = declarationsFor('.dashboardLegendTitle');
  assert.equal(title['min-width'], '0', 'judul legenda juga harus boleh menyusut');
  assert.equal(declarationsFor('.dashboardLegendTitle span:last-child')['text-overflow'], 'ellipsis');
});

// Nesting-nya ikut dikunci: kalau suatu saat `.dashboardLegendRow` dipindah keluar dari
// container grid, deklarasi `min-width:0` jadi tidak lagi relevan dan check di atas akan
// melewati alasan sebenarnya. Test ini memastikan hubungan induk-anaknya tidak berubah diam-diam.
test('.dashboardLegendRow tetap anak langsung .dashboardDonutLegend', () => {
  // `key={...}` muncul SEBELUM className, jadi pola tag harus menerima atribut apa pun.
  const parent = /<div className="dashboardDonutLegend">\s*\{[^<]*<div[^>]*className="dashboardLegendRow"/s;
  assert.match(tsx, parent, 'hierarki legenda berubah; audit ulang penyebab overflow dashboard');
});