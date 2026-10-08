// Navigasi Admin dua tingkat: workspace root + subdomain. Check UAT harus mengenali KEDUA
// bentuk "aktif".
//
// Bug yang ditemukan: check workspace sweep hanya menunggu
//   .navItem[data-admin-route="/commerce"][aria-current="page"]
// padahal app-shell.tsx memberi root button
//   aria-current={active && !activeDomainView ? 'page' : undefined}
// Untuk setiap workspace yang MEMILIKI subdomain - /commerce di antaranya
// (domain-workspaces.ts:35) - activeDomainView selalu terisi setelah klik, jadi
// aria-current="page" pada root tidak pernah muncul. Check itu menunggu selector yang secara
// desain mustahil terjadi, lalu timeout dengan pesan "workspace aktif tidak ditemukan" yang
// terlihat seperti produk rusak, padahal produknya benar.
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const uat = await readFile(new URL('../scripts/browser-uat.mjs', import.meta.url), 'utf8');
const shell = await readFile(new URL('../apps/admin/app/app-shell.tsx', import.meta.url), 'utf8');
const nav = await readFile(new URL('../apps/admin/app/navigation.ts', import.meta.url), 'utf8');
const domains = await readFile(new URL('../apps/admin/app/domain-workspaces.ts', import.meta.url), 'utf8');

test('shell memang hanya memberi aria-current pada root saat TIDAK ada activeDomainView', () => {
  // Kalau aturan ini berubah, check UAT yang lama mungkin jadi tidak salah lagi.
  assert.match(shell, /aria-current=\{active && !activeDomainView \? 'page' : undefined\}/);
});

test('workspace bersubdomain ada di domain-workspaces (bukti check lama mustahil terpenuhi)', () => {
  // Kalau tidak ada workspace bersubdomain, regresi ini tidak akan terpicu.
  assert.match(domains, /workspaceKey: 'commerce'/);
});

test('check workspace sweep mengenali root isActive + subdomain aktif, bukan hanya aria-current root', () => {
  // Bentuk 1: root tanpa subdomain.
  assert.match(uat, /root\.getAttribute\('aria-current'\) === 'page'/);
  // Bentuk 2: root bersubdomain - root isActive DAN ada subdomain yang aria-current.
  assert.match(uat, /root\.classList\.contains\('isActive'\)/);
  assert.match(uat, /\.adminSidebarSubdomains button\[aria-current="page"\]/);
  // Root wajib benar-benar isActive supaya tidak lolos hanya karena subdomain lain aktif.
  assert.match(uat, /if \(!root\.classList\.contains\('isActive'\)\) return false;/);
});

test('selector lama yang mustahil terpenuhi sudah tidak ada', () => {
  assert.ok(
    !/navItem\[data-admin-route=[^`]*\]\[aria-current="page"\]/.test(uat),
    'masih ada selector root yang hanya menunggu aria-current="page" - gagal untuk workspace bersubdomain',
  );
});

test('subdomain button di shell memang memakai aria-current (pola yang diandalkan check)', () => {
  assert.match(shell, /aria-current=\{selected \? 'page' : undefined\}/);
});

test('label workspace commerce memang ada di navigation (konteks regresi)', () => {
  assert.match(nav, /label: 'Penjualan & Order'/);
});