// The offline catalog lived in ONE localStorage key, which is a hard ceiling of a few MB per
// origin. `saveOfflineSnapshot` had no try/catch, so a branch with a large catalog hit
// `QuotaExceededError` and the throw escaped into `loadData` — taking offline capability down
// entirely, with the operator reading an error that named neither storage nor quota.
//
// The measured row below is the shape POS actually stores per product: two units, two barcodes and
// two warehouses of inventory. It comes to 704 bytes, so the 5 MB origin budget holds about 7 400
// products. 10 000 SKUs is a single mid-size branch, not a warehouse outlier, and it does not fit.
// `realisticProductBytes` is computed, not asserted by hand, so the claim cannot drift.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const store = read('apps/pos/lib/offline-store.ts');
const offline = read('apps/pos/lib/offline.ts');
const page = read('apps/pos/app/page.tsx');

test('a measured product row exhausts localStorage at a normal branch size', () => {
  const product = {
    id: '3b07c783-d688-4429-9fef-79237024aa0a', sku: 'SKU-003', name: 'Gula Aren 500g', unit: 'pcs',
    barcode: '899000000003',
    units: [
      { id: 'u1', unitCode: 'PCS', quantityFactor: 1, isDefaultSale: true, variantId: null },
      { id: 'u2', unitCode: 'BOX', quantityFactor: 12, isDefaultSale: false, variantId: 'v1' },
    ],
    barcodes: [
      { code: '899000000003', productUnitId: 'u1', quantityFactor: 1 },
      { code: '899776100003', productUnitId: 'u2', quantityFactor: 12 },
    ],
    inventories: [
      { warehouseId: 'b81b5694-6f4a-4092-a23c-b578b0fbb505', available: 25 },
      { warehouseId: '66f6387b-d382-43eb-87f4-e91154f39024', available: 8 },
    ],
    salePrice: '28000', effectiveSalePrice: '27000', salesTaxCodeId: 'tax-11', categoryName: 'Sembako',
  };
  const bytes = Buffer.byteLength(JSON.stringify(product), 'utf8');
  const budget = 5 * 1024 * 1024;
  const productsThatFit = Math.floor(budget / bytes);
  // Pinned so a change to the stored shape shows up as a reviewable number instead of a shrug.
  assert.equal(bytes, 704, 'the measured product row size changed — recheck the quota claim');
  assert.equal(productsThatFit, 7447);
  // A single branch with 10 000 SKUs cannot fit the 5 MB origin budget.
  assert.ok(bytes * 10000 > budget, '10 000 products of this shape must not fit in localStorage');
});

test('the offline store uses IndexedDB with the stores the POS needs', () => {
  // Assert the real call, not just the identifier. An earlier version of this test only checked
  // for the string "indexedDB.open(", which a dead `null && indexedDB.open(` branch also satisfies
  // — it was green with the store disabled. The negative control below is what caught that.
  assert.match(store, /^\s*request = indexedDB\.open\(DB_NAME, DB_VERSION\);$/m,
    'the store must really open IndexedDB');
  assert.match(store, /const STORE_SNAPSHOT = 'snapshot'/);
  assert.match(store, /const STORE_CATALOG = 'catalog'/);
  assert.match(store, /const STORE_QUEUE = 'queue'/);
  // Indexes are what make offline barcode lookup possible at all — a full scan of 10 000 rows per
  // keystroke is not a lookup.
  assert.match(store, /createIndex\('barcode', 'barcode'/);
  assert.match(store, /createIndex\('sku', 'sku'/);
  // And nothing may quietly keep writing the old single-key blob from page.tsx.
  assert.doesNotMatch(page, /localStorage\.setItem\(SNAPSHOT_KEY/,
    'the catalog must not be written to the quota-limited blob');
});

test('a storage failure degrades to "offline unavailable" instead of throwing into the screen', () => {
  // This is the actual defect: the throw escaped into loadData and took the till down.
  assert.match(store, /request\.onerror = \(\) => resolve\(null\)/, 'a blocked database must resolve null, not reject');
  assert.match(store, /request\.onblocked = \(\) => resolve\(null\)/);
  assert.match(store, /ok: false, reason:/, 'failures must be reported as an outcome');
  assert.match(store, /catch \{\s*return null;\s*\}/, 'reads must never throw');
  // And the POS must actually look at the outcome.
  assert.match(page, /if \(!stored\.ok\)/, 'page.tsx must check the result');
  assert.match(page, /cache offline tidak tersimpan/, 'and tell the operator why offline is degraded');
});

test('the legacy localStorage snapshot is migrated, not abandoned', () => {
  // An upgrade that discards a branch's cached catalog strands every offline terminal until
  // someone happens to log in online again.
  assert.match(offline, /export async function readOfflineSnapshot/, 'reads must prefer IndexedDB');
  assert.match(offline, /localStorage\.getItem\(SNAPSHOT_KEY\)/, 'and still read the legacy blob');
  assert.match(offline, /export async function persistOfflineSnapshot/);
  // Order matters: drop the old key only after the new write is confirmed, or a full disk destroys
  // the only working copy.
  assert.match(offline, /if \(outcome\.ok\) \{\s*clearLegacyOfflineKeys\(\[SNAPSHOT_KEY\]\);/,
    'the legacy key may only be cleared after a confirmed write');
  assert.match(page, /await loadOfflineSnapshot</, 'and every read site must await the store');
});

test('the POS prefers the durable store over the blob', () => {
  // The single-key write is the thing being removed; it must not be the path loadData takes.
  assert.doesNotMatch(page, /localStorage\.setItem\(SNAPSHOT_KEY/, 'page.tsx must not write the catalog blob directly');
  assert.match(page, /persistOfflineSnapshot</);
});
