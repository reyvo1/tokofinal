import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const cashier = read('apps/pos/app/page.tsx');
const digital = read('apps/pos/app/ppob-workspace.tsx');
const storefront = read('apps/storefront/app/page.tsx');
const posShell = read('apps/pos/app/pos-shell.tsx');
const digitalApi = read('apps/api/src/digital-services/digital-services.controller.ts');
const productApi = read('apps/api/src/products/products.controller.ts');
const storefrontShell = read('apps/storefront/app/storefront-shell.tsx');

test('PPOB is discoverable from the existing POS sale workspace without deleting its four mandatory P5 views', () => {
  assert.match(cashier, /PPOB \/ Produk digital/);
  assert.match(cashier, /<PpobOperatorWorkspace token=/);
  assert.match(cashier, /\{!ppobOpen && <>/);
  for (const name of ['Penjualan', 'Shift & Kas', 'Retur', 'Sinkronisasi']) assert.ok(posShell.includes(name));
});

test('PPOB reads only real scoped catalog and transactions from existing authenticated controller routes', () => {
  for (const route of ["@Get('products')", "@Get('transactions')", "@Post('transactions/:id/recheck')"]) assert.ok(digitalApi.includes(route));
  assert.match(digital, /posAuthFetch/);
  assert.match(digital, /\/digital-services\/products\?/);
  assert.match(digital, /\/digital-services\/transactions\?/);
  assert.match(digital, /\/digital-services\/transactions\/\$\{encodeURIComponent\(transaction\.id\)\}\/recheck/);
  assert.match(digital, /\['PENDING', 'PROCESSING'\]/);
});

test('PPOB cashier purchase captures confirmed physical cash into canonical prepayment before provider outbox', () => {
  const service = read('apps/api/src/digital-services/digital-services.service.ts');
  const worker = read('apps/worker/src/index.ts');
  assert.match(digital, /data-ppob-mode="paid-cash-only"/);
  assert.match(digital, /if \(!active \|\| !online \|\| !shiftOpen \|\| !chosenProduct/);
  assert.match(digital, /purchase\.confirmed/);
  assert.match(digital, /paymentMethod: 'CASH'/);
  assert.match(digital, /pendingPurchaseRef\.current/);
  assert.match(cashier, /shiftOpen=\{shift\?\.status === 'OPEN'\}/);
  const capture = service.slice(service.indexOf('async createTransaction('), service.indexOf('async settle('));
  assert.ok(capture.indexOf('postOperationalEvent(tx') < capture.indexOf("eventType: 'digital-service.transaction.requested'"));
  assert.match(capture, /paymentAccountingEventId: paymentEvent\.id, capturedAt: new Date\(\)/);
  assert.match(worker, /if \(!transaction\.paymentAccountingEventId \|\| !transaction\.capturedAt\) throw/);
  assert.match(worker, /eventType: 'DIGITAL_SERVICE_PREPAYMENT', status: 'POSTED'/);
  assert.doesNotMatch(capture, /fetch\s*\(/);
});

test('PPOB pagination and search use provider cursors, with stale-query defense', () => {
  assert.match(digital, /params\.set\('search', query\.trim\(\)\)/);
  assert.match(digital, /params\.set\('cursor', cursor\)/);
  assert.match(digital, /currentSearchRef\.current\.trim\(\) !== requestQuery/);
  assert.match(digital, /setCatalogCursor\(page\.pageInfo\?\.nextCursor/);
});

test('Storefront uses real public backend search and cursor paging rather than assuming 100 products is whole catalog', () => {
  assert.match(productApi, /@Query\('search'\) search/);
  assert.match(productApi, /@Query\('cursor'\) cursor/);
  assert.match(storefront, /search=\$\{encodeURIComponent\(query\)\}/);
  assert.match(storefront, /params\.set\('search', query\)/);
  assert.match(storefront, /new URLSearchParams\(\{ branchCode: activeBranch, limit: '100', cursor \}\)/);
  assert.match(storefront, /setCatalogCursor\(page\.pageInfo\?\.nextCursor/);
  assert.match(storefront, /Muat produk berikutnya/);
  assert.match(storefront, /setSelectedCatalogProduct\(product\)/);
  assert.match(storefront, /selectedCatalogProduct\?\.id === selectedProductId/);
});

test('Storefront failures remain visible while optional APIs cannot hide a successful catalog', () => {
  assert.match(storefront, /Promise\.allSettled\(/);
  assert.match(storefront, /catalogResult\.status === 'fulfilled'/);
  assert.match(storefront, /fulfillmentResult\.status === 'fulfilled'/);
  assert.match(storefront, /failures\.join\(' \| '\), 'error'/);
  assert.match(storefront, /branchRef\.current !== activeBranch \|\| queryRef\.current\.trim\(\) !== query/);
});

test('Multi-branch Storefront selector is reachable on mobile instead of hidden below sm', () => {
  assert.match(storefrontShell, /className="relative flex max-w-\[124px\] min-w-0 items-center sm:max-w-none"/);
  assert.match(storefrontShell, /aria-label="Pilih cabang storefront"/);
  assert.doesNotMatch(storefrontShell, /relative hidden items-center sm:flex/);
});
