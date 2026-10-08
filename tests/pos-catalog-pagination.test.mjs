// The POS catalog silently showed only the first 100 products.
//
// `page.tsx` called `/products?limit=100` exactly once and never read `pageInfo.nextCursor` — the
// type was declared at line 13 and used nowhere. A cashier could not sell product 101, and nothing
// errored: no exception, no failed request, no console message. The product simply was not on the
// screen. tsc, the audit chain and the whole test suite were green the entire time, because a
// declared-but-unused field is not a type error.
//
// So these tests assert the WALK and the SERVER SEARCH, and both are proved with a negative control
// below: restoring the single-page call must turn them red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const page = read('apps/pos/app/page.tsx');
const catalog = read('apps/pos/lib/catalog.ts');

test('the catalog module walks the cursor instead of taking a single page', () => {
  // The core of the fix. Without the loop, page 2+ is unreachable forever.
  assert.match(catalog, /for \(let page = 0; page < maxPages; page \+= 1\)/, 'the loader must loop over pages');
  assert.match(catalog, /query\.set\('cursor', cursor\)/, 'and pass the cursor forward on every page');
  assert.match(catalog, /if \(!hasMore \|\| !cursor\) break;/, 'and stop when the server says it is done');
  // A hasMore-without-cursor server must not spin forever; the guard above is what prevents it.
  assert.ok(!/while \(true\)/.test(catalog), 'no unbounded loop');
});

test('the POS screen calls the paging loader and can fetch more on demand', () => {
  assert.match(page, /loadCatalog<Product>\(asCatalogFetcher\(api\), activeToken\)/,
    'loadData must use the cursor-walking loader');
  // The old call must be gone — this is the exact line that hid 900 products.
  assert.doesNotMatch(page, /api<CursorPage<Product>>\('\/products\?limit=100'/,
    'the single-page /products?limit=100 call must not come back');
  assert.match(page, /loadCatalogPage<Product>\(asCatalogFetcher\(api\), token, catalogCursor\)/,
    'and there must be a way to fetch the next page on demand');
  // The control has to be reachable by an operator, not just present in source.
  assert.match(page, /Muat lagi katalog/, 'the operator needs a visible control to load more');
});

test('truncation is reported, never silently hidden', () => {
  // A partial catalog that looks complete is worse than an obvious error, because the cashier has
  // no way to know which products are missing.
  assert.match(page, /setCatalogHasMore\(catalog\.hasMore\)/);
  assert.match(page, /Katalog belum lengkap/,
    'the UI must say the catalog is partial instead of implying it is everything');
  assert.match(page, /loadMoreCatalog/);
});

test('search asks the server so it can find products this device never downloaded', () => {
  // A client-side filter can only search what the client holds — the same gap as the un-walked
  // cursor. An exact SKU on page 7 must still be findable while online.
  assert.match(catalog, /export async function searchCatalog<T>/);
  assert.match(catalog, /search: trimmed/);
  // A one-character term would return the whole catalog; the module refuses instead.
  assert.match(catalog, /trimmed\.length < 2/, 'very short terms must not hit the server');
  assert.match(page, /setServerMatches\(found\)/, 'and the answer must reach the grid');
  assert.match(page, /const pool = serverMatches \?\? products;/,
    'offline must fall back to the local catalog rather than showing nothing');
});

test('more pages merge without duplicating products', () => {
  // A product edited between page 1 and page 2 comes back twice; a duplicate React key is a
  // console warning the cashier never sees but which makes the grid render unreliably.
  assert.match(page, /new Set\(current\.map\(\(item\) => item\.id\)\)/);
  assert.match(page, /filter\(\(item\) => !seen\.has\(item\.id\)\)/);
});
