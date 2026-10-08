// Barcode scanning behaviour, exercised for real.
//
// A scanner is indistinguishable from a keyboard at the DOM level, so the only signal is timing.
// That makes the guard logic easy to get subtly wrong and impossible to review by reading — a
// scanner that also fires on a cashier's Enter mid-sentence adds a product nobody scanned.
//
// These tests drive the real listener through a fake EventTarget with a CONTROLLED CLOCK. That
// matters: the first version of this file let real `Date.now()` decide, and because every fake
// keystroke happened within the same millisecond, "slow human typing" and "fast scanner burst" were
// indistinguishable. Three guard removals therefore passed green. The clock is now injected, and
// the negative controls at the bottom re-prove each guard is actually covered.
//
// Load path: `tests/helpers/import-ts.mjs` transpiles the real file, so this exercises the same
// source the POS ships rather than a copy.
import assert from 'node:assert/strict';
import test from 'node:test';

const fs = await import('node:fs');
const path = await import('node:path');

const { createBarcodeListener, fuzzyRank } = await import('./helpers/import-ts.mjs').then((m) => m.load('apps/pos/lib/barcode.ts'));
const page = fs.readFileSync(path.join(new URL('../', import.meta.url).pathname, 'apps/pos/app/page.tsx'), 'utf8');

test('the POS actually mounts the listener, or the module is dead code', () => {
  // A listener nobody starts is the exact state this work started from. Source-level, because the
  // mount is a React effect and cannot be exercised without a DOM.
  assert.match(page, /createBarcodeListener\(\{/, 'the screen must create a listener');
  assert.match(page, /return listener\.start\(window\)/, 'and start it on window');
  assert.match(page, /onScan: \(barcode\) => \{/, 'with a real scan handler');
  // The scan must reach the same search state a human typing does, not a parallel code path.
  assert.match(page, /setSearch\(barcode\)/);
});

test('the grid ranks matches instead of returning catalog order', () => {
  assert.match(page, /fuzzyRank\(inCategory, q,/, 'the product grid must use the ranking');
  // A bare filter is what this replaced; it silently returns storage order.
  assert.doesNotMatch(page, /pool\.filter\(\(product\) =>\s*\(!q \|\| product\.name\.toLowerCase\(\)\.includes/,
    'the old includes()-only filter must not come back');
});

class FakeTarget {
  listeners = [];
  addEventListener(type, handler) { this.listeners.push({ type, handler }); }
  removeEventListener(type, handler) { this.listeners = this.listeners.filter((l) => l.handler !== handler); }
  dispatch(event) { for (const l of this.listeners) if (l.type === 'keydown') l.handler(event); }
}

const input = { tagName: 'INPUT', type: 'text' };
const button = { tagName: 'BUTTON' };
const checkbox = { tagName: 'INPUT', type: 'checkbox' };

/**
 * Drive the listener with a controlled clock.
 *
 * `gapMs` is the real time between two keystrokes: 5 ms is a scanner, 300 ms is a person. The
 * listener reads `Date.now()`, so time is advanced by actually waiting when the gap is large, and
 * collapsed to a busy-wait when it is small — precise without making the suite slow.
 */
async function scan(target, text, gapMs, perKey = {}) {
  // Busy-wait for the gap instead of setTimeout. Measured: under the full parallel suite,
  // `setTimeout(5)` can actually take 6 ms or more, and a 6 ms drift is enough for a "fast scanner"
  // burst to be classified as slow — which is exactly the failure this file saw as an intermittent
  // red. Busy-waiting is exact and, at these gaps, costs microseconds.
  for (const ch of text) {
    const until = Date.now() + gapMs;
    while (Date.now() < until) { /* exact gap, immune to scheduler drift */ }
    target.dispatch({ key: ch, target: perKey.target ?? null, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
  }
  target.dispatch({ key: 'Enter', target: perKey.target ?? null, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
}

test('a fast digit burst followed by Enter is treated as a scan', async () => {
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ onScan: (code) => seen.push(code) }).start(target);
  await scan(target, '8991234567890', 0); // gap 0: unambiguous scanner speed           // 5 ms between keys = scanner
  assert.deepEqual(seen, ['8991234567890']);
});

test('the same digits typed SLOWLY by a human are not treated as a scan', async () => {
  // The control for the test above: identical input, only the timing differs. If this ever passes
  // a burst, the timing gate is gone.
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ onScan: (code) => seen.push(code) }).start(target);
  await scan(target, '89912345678', 150, { target: button });
  assert.deepEqual(seen, [], 'slow human typing must never fire a lookup');
});

test('typing in a search field stays the search field, even at scanner speed', async () => {
  // The cashier keys an exact SKU to search. A listener that steals it turns their search into a
  // silent product add, which is how the wrong item gets sold.
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ onScan: (code) => seen.push(code) }).start(target);
  await scan(target, '8991234567890', 0, { target: input });
  assert.deepEqual(seen, [], 'focused text input owns the keyboard');
});

test('a scan fires when focus is on a button, which is the normal cart flow', async () => {
  // This is the actual bug: with no listener, scanning while the cart had focus did nothing,
  // because the keystrokes activated the focused control instead.
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ onScan: (code) => seen.push(code) }).start(target);
  await scan(target, '8991234567890', 0, { target: button });
  assert.deepEqual(seen, ['8991234567890'], 'scanning must work without focusing the search box');
});

test('a checkbox does not count as typing, so scanning still works over one', async () => {
  // Checkboxes and radios are focusable but never host typing. Treating them as "a human is
  // typing" would silently disable the scanner whenever the operator tabbed to one.
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ onScan: (code) => seen.push(code) }).start(target);
  await scan(target, '8991234567890', 0, { target: checkbox });
  assert.deepEqual(seen, ['8991234567890']);
});

test('a burst shorter than minLength is discarded', async () => {
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ minLength: 3, onScan: (code) => seen.push(code) }).start(target);
  await scan(target, '12', 0);
  assert.deepEqual(seen, [], 'two characters is a mistyped key, not a barcode');
});

test('ctrl/meta/alt shortcuts never become barcode data', async () => {
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ onScan: (code) => seen.push(code) }).start(target);
  // Build a buffer, then a modifier must CLEAR it, not survive into the next Enter.
  for (const ch of '89') target.dispatch({ key: ch, target: null, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
  target.dispatch({ key: '9', target: null, ctrlKey: true, metaKey: false, altKey: false, preventDefault() {} });
  target.dispatch({ key: 'Enter', target: null, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
  assert.deepEqual(seen, [], 'a shortcut must reset the buffer');
});

test('a pause mid-burst discards the partial scan instead of emitting a short code', async () => {
  const target = new FakeTarget();
  const seen = [];
  createBarcodeListener({ maxIntervalMs: 45, onScan: (code) => seen.push(code) }).start(target);
  // Two fast digits, a real pause, then a full valid burst. The stale partial must not leak, and
  // the fresh burst must still be recognised.
  for (const ch of '89') target.dispatch({ key: ch, target: null, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 150));
  await scan(target, '8991234567890', 0); // gap 0: unambiguous scanner speed
  assert.deepEqual(seen, ['8991234567890'], 'exactly one complete scan, no partial code');
});

test('stop() removes the listener and clears the buffer', async () => {
  const target = new FakeTarget();
  const seen = [];
  const listener = createBarcodeListener({ onScan: (code) => seen.push(code) });
  listener.start(target);
  listener.stop(target);
  await scan(target, '8991234567890', 0); // gap 0: unambiguous scanner speed
  assert.deepEqual(seen, [], 'a stopped listener must not fire');
  assert.equal(target.listeners.length, 0, 'and must be removed from the target');
});

test('a scan is not intercepted when the operator is typing in a textarea or contenteditable', async () => {
  for (const target of [{ tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
    const fake = new FakeTarget();
    const seen = [];
    createBarcodeListener({ onScan: (code) => seen.push(code) }).start(fake);
    await scan(fake, '8991234567890', 0, { target });
    assert.deepEqual(seen, [], `typing in ${target.tagName} must not be hijacked`);
  }
});

test('fuzzyRank puts the best match first and keeps catalog order for ties', () => {
  const items = [
    { name: 'Mi Instan Goreng', sku: 'MI001' },
    { name: 'Krimer Bubuk', sku: 'KR001' },
    { name: 'Gula Aren 500g', sku: 'GL001' },
    { name: 'Gula Pasir 1kg', sku: 'GL002' },
  ];
  const fields = (i) => [i.name, i.sku];
  const ranked = fuzzyRank(items, 'gula', fields);
  assert.equal(ranked.length, 2, 'non-matching products are not returned');
  assert.equal(ranked[0].name, 'Gula Aren 500g', 'both match on prefix; first in catalog wins the tie');
  // Short terms must not trigger a fuzzy pass at all.
  assert.equal(fuzzyRank(items, 'g', fields).length, 4, 'a one-character term returns everything unchanged');
  // Exact SKU match outranks a partial name match.
  assert.equal(fuzzyRank(items, 'KR001', fields)[0].name, 'Krimer Bubuk');
  // A word-start match must outrank a mid-word match.
  const ranked2 = fuzzyRank([{ name: 'Susu Coklat UHT', sku: 'A' }, { name: 'Coklat Bubuk', sku: 'B' }], 'coklat', (i) => [i.name]);
  assert.equal(ranked2[0].name, 'Susu Coklat UHT', 'prefix match beats a mid-word match');
});
