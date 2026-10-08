import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../apps/storefront/app/page.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../apps/storefront/app/storefront-shell.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../apps/storefront/app/[view]/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/storefront/app/globals.css', import.meta.url), 'utf8');

test('UI-P4 exposes explicit storefront customer journeys', () => {
  for (const view of ['home', 'catalog', 'product', 'cart', 'account']) {
    assert.match(route, new RegExp(`['"]${view}['"]`));
  }
  for (const label of ['Beranda', 'Katalog', 'Keranjang', 'Akun & Pesanan']) {
    assert.match(shell, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('UI-P4 separates discovery, product detail, checkout and account surfaces', () => {
  assert.ok(page.includes("activeView === 'home'"));
  assert.ok(page.includes("activeView === 'catalog'"));
  assert.ok(page.includes("activeView === 'product'"));
  assert.ok(page.includes("activeView === 'cart'"));
  assert.ok(page.includes("activeView === 'account'"));
  assert.ok(page.includes('Urutkan'));
  assert.ok(page.includes('DETAIL PRODUK'));
  assert.ok(page.includes('RIWAYAT & TRACKING'));
});

test('UI-P4 preserves server-authoritative storefront commerce contracts', () => {
  assert.ok(page.includes("fetch(`${API}/orders`"));
  assert.ok(page.includes("fetch(`${API}/orders/${order.number}/payment-selection`"));
  assert.ok(page.includes("'x-order-access-token': order.accessToken"));
  assert.ok(page.includes("notify('Pesanan berhasil dibuat dan stok sudah direservasi. Harga/promo telah divalidasi server.'"));
  assert.ok(page.includes('Pembayaran elektronik tidak dianggap lunas sampai provider/backoffice mengonfirmasi.'));
});

test('UI-P4 preserves account ownership, verification, favorite, review and return endpoints', () => {
  for (const contract of [
    '/storefront/account/me',
    '/storefront/account/orders',
    '/storefront/account/favorites',
    '/storefront/account/returns',
    '/storefront/account/addresses',
    '/storefront/account/verification/request',
    '/storefront/account/verification/confirm',
  ]) assert.ok(page.includes(contract), `missing ${contract}`);
  assert.ok(page.includes("'x-customer-session'"));
});

test('UI-P4 provides responsive V4 storefront shell with distinct retail identity', () => {
  assert.match(shell, /data-visual-generation="p5-v4"/);
  assert.match(shell, /sticky top-0/);
  assert.match(shell, /className="desktopNav hidden[^"]*md:flex"/);
  assert.match(css, /\.mobileNav/);
  assert.match(css, /\.productDetail/);
  assert.match(css, /\.storefrontV4/);
  assert.doesNotMatch(css, /@apply[^;]*\bgroup\b|@apply[^;]*group-hover:/);
});
