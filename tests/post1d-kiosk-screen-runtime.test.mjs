// POST-1D executable proof: the kiosk screen, executed.
//
// The interesting contract in this file is timing, and a regex cannot prove it. A USB barcode scanner is
// a keyboard, so there is no "scan" event: the page receives the same keydowns a person produces and
// has to tell them apart by the gap between keys. The suite below drives the REAL app.js with synthetic
// keydowns at controlled intervals and asserts on the fetch calls that come out.
//
// This is the trap the repo's own harness comment warns about — "no regex can prove a 5 ms burst is
// treated differently from a 300 ms one" — so the DOM is stubbed and the file is actually run.
import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
const APP = new URL('../apps/pos/public/kiosk/app.js', import.meta.url).pathname;
const DIR = new URL('../apps/pos/public/kiosk/', import.meta.url).pathname;
const readKiosk = () => fs.readFileSync(APP, 'utf8');

/** A DOM small enough to run a single-file page, and no smaller: every id app.js touches must exist. */
function makeDom() {
  const store = new Map();
  const listeners = new Map();
  const el = (id) => ({
    id, textContent: '', className: '', value: '',
    style: { display: '' },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  });
  const nodes = new Map();
  for (const id of ['branch', 'status', 'idle', 'price-panel', 'p-name', 'p-meta', 'p-price', 'p-unit',
    'p-promo', 'p-availability', 'log', 'focus-ring', 'hint']) nodes.set(id, el(id));
  return {
    nodes,
    store,
    listeners,
    getElementById: (id) => nodes.get(id) ?? el(id),
    addEventListener: (type, fn) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    dispatch(type, event) { for (const fn of listeners.get(type) ?? []) fn(event); },
  };
}

/** Run app.js against a stubbed page and hand back the fetch log. */
async function boot({ search = '', origin = 'http://localhost:3002', storage = {}, fetchImpl } = {}) {
  const dom = makeDom();
  for (const [k, v] of Object.entries(storage)) dom.store.set(k, v);
  const calls = [];
  const timers = [];
  // A controllable clock. The scanner test used real `setTimeout` sleeps, so a 4 ms burst became a
  // >45 ms gap whenever the full suite ran in parallel on a loaded machine — the burst was then read as
  // a person, no lookup was made, and the test failed for a reason that has nothing to do with the code.
  // It passed when the file ran alone. The timing logic is still what is under test: app.js reads
  // Date.now(), and here that clock is advanced explicitly.
  const clock = { t: 1_000_000 };
  const globals = {
    document: dom,
    location: { search, origin, href: origin + '/' },
    localStorage: {
      getItem: (k) => (dom.store.has(k) ? dom.store.get(k) : null),
      setItem: (k, v) => dom.store.set(k, String(v)),
    },
    URLSearchParams,
    console,
    // Timers are captured rather than real, so a 20-second auto-reset can be tested in microseconds —
    // and, more to the point, so the reset is proven by firing it rather than by reading its source.
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Date: { now: () => clock.t },
    clearTimeout: () => {},
    fetch: (url, init) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return fetchImpl ? fetchImpl(url, init) : Promise.resolve({ ok: true, status: 200, json: async () => product() });
    },
  };
  // app.js is an IIFE with no exports and it runs on load, so it is evaluated against the stub globals
  // rather than imported. Importing it first — which is what `load()` does — executes it against a real
  // empty Node global scope and dies on "document is not defined" before the stub is ever wired up.
  const names = Object.keys(globals);
  const values = names.map((n) => globals[n]);
  // eslint-disable-next-line no-new-func
  new Function(...names, readKiosk())(...values);
  return { ...dom, calls, timers, clock };
}

const key = (k) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false });

const product = (over = {}) => ({
  name: 'Kopi Premium 250g', sku: 'SKU-001', barcode: '899000000001', unit: 'pcs',
  price: '13500', promotion: null, availability: null, ...over,
});

/** Type a barcode the way a scanner does (a few ms per key) or the way a person does (~120 ms). */
async function type(dom, text, { gapMs, enter = true }) {
  for (const ch of text) {
    dom.dispatch('keydown', key(ch));
    dom.clock.t += gapMs;
    await new Promise((r) => setImmediate(r));
  }
  if (enter) {
    dom.clock.t += gapMs;
    dom.dispatch('keydown', key('Enter'));
  }
  dom.clock.t += 60;
  await new Promise((r) => setImmediate(r));
}

test('a scanner burst is read as a code; a human typing the same digits is not', async () => {
  const dom = await boot();
  await type(dom, '899000000001', { gapMs: 4 });
  assert.equal(dom.calls.length, 1, 'a 4 ms burst is a scan');
  assert.match(dom.calls[0].url, /\/kiosk\/price\?code=899000000001/);
  // Same digits, human speed. This is the whole reason the timing check exists: without it, anyone
  // reaching over the screen would fire a lookup, and the wrong price would go up on the wall.
  const slow = await boot();
  await type(slow, '899000000001', { gapMs: 120 });
  assert.equal(slow.calls.length, 0, 'a 120 ms cadence is a person, not a scanner');
  // Not "Mencari ..." — the screen must not narrate a lookup it never made. Note the buffer is reset on
  // any gap over the threshold, so a slow typist leaves a ONE-character buffer at Enter and falls
  // through both branches; the assertion is on the absence of a lookup, not on a specific message.
  assert.doesNotMatch(slow.nodes.get('log').textContent, /Mencari/);
});

test('digits that arrive fast but Enter that does not are not a scan', async () => {
  // This is what the gap check between the last digit and Enter is actually for. The buffer is already
  // reset on any slow gap, so a uniformly slow typist is caught by that; what only the timing check
  // catches is a full code that arrives as a burst and is then submitted by a person a beat later.
  // Removing the check (`return true`) leaves every other assertion in this file green — which is how a
  // load-bearing control gets mistaken for a decorative one.
  const dom = await boot();
  for (const ch of '899000000001') { dom.dispatch('keydown', key(ch)); dom.clock.t += 3; }
  dom.clock.t += 200;                                       // a human pause before Enter
  dom.dispatch('keydown', key('Enter'));
  dom.clock.t += 60;
  await new Promise((r) => setImmediate(r));
  assert.equal(dom.calls.length, 0, 'a human pressing Enter after a burst is not a scan');
});

test('a short burst of digits is not treated as a code', async () => {
  const dom = await boot();
  await type(dom, '123', { gapMs: 2 });
  assert.equal(dom.calls.length, 0, 'a 3-character burst is noise, not a barcode');
});

test('a new scan resets the buffer instead of appending to the last one', async () => {
  const dom = await boot();
  await type(dom, '899000000001', { gapMs: 4 });
  // A pause mid-code, then a second code: without the reset the buffer would read as one long string.
  await new Promise((r) => setTimeout(r, 200));
  await type(dom, '899000000002', { gapMs: 4 });
  assert.equal(dom.calls.length, 2);
  assert.match(dom.calls[1].url, /code=899000000002$/, 'the second code must be read on its own');
});

test('a modifier keypress is a person, and discards the partial buffer', async () => {
  const dom = await boot();
  for (const ch of '899000000001') dom.dispatch('keydown', { key: ch, ctrlKey: false, altKey: false, metaKey: false });
  dom.dispatch('keydown', { key: 'Control', ctrlKey: true, altKey: false, metaKey: false });
  await type(dom, '', { gapMs: 4, enter: true });
  assert.equal(dom.calls.length, 0);
});

test('the screen shows the canonical price and nothing internal', async () => {
  const dom = await boot();
  await type(dom, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 30));
  assert.match(dom.nodes.get('p-price').textContent, /Rp\s?13\.500/);
  assert.equal(dom.nodes.get('p-name').textContent, 'Kopi Premium 250g');
  // The customer must see the barcode they are holding, so the scan visibly registered.
  assert.match(dom.nodes.get('p-meta').textContent, /899000000001/);
});

test('an outage after a price was already shown leaves nothing behind', async () => {
  // The ordering a real kiosk hits: it has been showing a price all afternoon, then the branch server
  // goes. The first version of the outage test loaded a fresh page, so the price had never been set and
  // "no price displayed" passed for the wrong reason. Hiding the panel also left the old value in the
  // DOM — invisible, but readable by an accessibility tree or a support screenshot.
  let online = true;
  const dom = await boot({ fetchImpl: () => (online
    ? Promise.resolve({ ok: true, status: 200, json: async () => product() })
    : Promise.reject(new Error('network down'))) });
  await type(dom, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(dom.nodes.get('p-price').textContent, 'Rp 13.500', 'a price is up first');
  online = false;
  await type(dom, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(dom.nodes.get('p-price').textContent, '', 'the old price must be cleared, not just hidden');
  assert.equal(dom.nodes.get('p-name').textContent, '', 'and so must the name');
  assert.match(dom.nodes.get('status').textContent, /TIDAK TERHUBUNG/);
});

test('an unreachable branch server shows no price at all', async () => {
  const dom = await boot({ fetchImpl: () => Promise.reject(new Error('network down')) });
  await type(dom, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 40));
  // The degraded state is the one this page must never get wrong. A stale price, a "0", or a blank
  // panel that looks like the previous answer would all be read by a customer as a real quote.
  assert.equal(dom.nodes.get('p-price').textContent, '', 'no price may be displayed when it cannot be verified');
  assert.match(dom.nodes.get('status').textContent, /TIDAK TERHUBUNG/);
  assert.equal(dom.nodes.get('status').className, 'down');
  assert.match(dom.nodes.get('log').textContent, /Tidak dapat menghubungi/);
});

test('an unknown product returns the screen to idle, not a blank price panel', async () => {
  const dom = await boot({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await type(dom, '000000000000', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(dom.nodes.get('price-panel').className, '', 'the price panel is not shown');
  assert.match(dom.nodes.get('log').textContent, /tidak ditemukan/);
});

test('a revoked device key says so instead of showing a price', async () => {
  const dom = await boot({
    storage: { 'toko360.kioskKey': 'tk360_dead_dead' },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });
  await type(dom, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(dom.nodes.get('p-price').textContent, '');
  assert.match(dom.nodes.get('status').textContent, /TIDAK DIIZINKAN/);
  // An operator is usually standing nearby; saying why is faster than a blank screen and a phone call.
  assert.match(dom.nodes.get('log').textContent, /Hubungi supervisor/);
});

test('a promotion is shown as a name, and availability keeps its unknown state', async () => {
  const dom = await boot({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => product({ promotion: { name: 'Promo Gula', code: 'GULA10' }, availability: { message: 'Stok habis' } }) }),
  });
  await type(dom, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 30));
  assert.match(dom.nodes.get('p-promo').textContent, /Promo Gula/);
  assert.equal(dom.nodes.get('p-availability').className, 'habis');
  // And a product that has not opted in stays visually empty, not a promise.
  const plain = await boot();
  await type(plain, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(plain.nodes.get('p-availability').textContent, '');
  assert.equal(plain.nodes.get('p-availability').className, 'unknown');
});

test('the screen resets itself so the next customer does not read the last price', async () => {
  const dom = await boot();
  await type(dom, '899000000001', { gapMs: 4 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(dom.nodes.get('price-panel').className, 'on', 'a price is on screen after a scan');
  // Fire the captured timer instead of reading its source. An earlier version asserted the regex
  // `resetTimer = setTimeout(... showIdle())`, which stayed green after the timer was made a no-op —
  // the code was there and the behaviour was gone.
  const reset = dom.timers.find((t) => t.ms >= 10000);
  assert.ok(reset, 'the reset timer must be armed, and within a sane window');
  assert.ok(reset.ms <= 60000, `auto-reset should be at most 60 s, got ${reset.ms}ms`);
  reset.fn();
  assert.equal(dom.nodes.get('price-panel').className, '', 'the price must be gone after the reset fires');
  assert.equal(dom.nodes.get('idle').style.display, 'block', 'and the screen must be back to idle');
});

test('the kiosk page issues one kind of request and never a write', async () => {
  const dom = await boot();
  await type(dom, '899000000001', { gapMs: 4 });
  for (const call of dom.calls) {
    assert.match(call.url, /\/kiosk\/price\?code=/, 'the only request this page may make is the price read');
  }
  const source = readKiosk();
  const code = stripComments(source);
  for (const forbidden of ["method: 'POST'", "method: 'PUT'", "method: 'DELETE'", "method: 'PATCH'", 'method: "POST"']) {
    assert.doesNotMatch(code, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the kiosk must not issue ${forbidden}`);
  }
  // No method field at all: the request is a GET by construction.
  assert.doesNotMatch(code, /method\s*:/, 'the kiosk request must carry no explicit method');
  // And no service worker: a customer-facing price must never be served from a cache.
  assert.ok(!fs.existsSync(DIR + 'sw.js'), 'the kiosk must have no service worker — a cached price is a wrong price');
  assert.doesNotMatch(code, /caches\.|CacheStorage|localStorage\.setItem\([^)]*price/i);
});

test('the device credential is sent in the header the API actually accepts', async () => {
  // `x-api-key`, not `Authorization: Bearer`. Sending a Bearer header authenticates as nothing and the
  // kiosk 401s on every scan — which is precisely what happened, and precisely what a suite that only
  // checked "is there a request" would have missed.
  const dom = await boot({ storage: { 'toko360.kioskKey': 'tk360_abc_xyz' } });
  await type(dom, '899000000001', { gapMs: 4 });
  assert.equal(dom.calls.length, 1);
  const headers = dom.calls[0].headers;
  assert.equal(headers['x-api-key'], 'tk360_abc_xyz', 'the device key must go in x-api-key');
  // Never BOTH: the guard reads Authorization first and tries to parse the device key as a JWT, so a
  // request carrying both headers is rejected before x-api-key is ever consulted.
  assert.ok(!('Authorization' in headers), 'a Bearer header does not authenticate an API key on this API, and sending both rejects the request outright');
});

test('the API address is resolved at runtime, never frozen at build time', async () => {
  const source = readKiosk();
  assert.doesNotMatch(source, /NEXT_PUBLIC_API_URL|import\.meta\.env/,
    'files under public/ are served verbatim; an env constant is frozen at build time');
  assert.match(source, /URLSearchParams\(location\.search\)\.get\('api'\)/);
  assert.match(source, /location\.origin \+ '\/api\/v1'/);
  // A device key may be installed from a URL, but never a user login: there is no password field here
  // and no session endpoint, so the device cannot be pointed at a person's account.
  assert.doesNotMatch(source, /password|\/auth\/login/);
});

test('the device key is captured at boot, not re-read per request', () => {
  // localStorage is scoped to the ORIGIN. buildHeaders() reading the key on every request means a
  // second kiosk tab on the same origin silently swaps which device the first screen authenticates
  // as — so a screen can keep serving after its own key is revoked. Found by the two-kiosk UAT, not
  // by any single-page test: one page is all these tests have, and one page cannot collide with itself.
  const app = readKiosk();
  const headers = app.slice(app.indexOf('function buildHeaders'));
  const headersBody = headers.slice(0, headers.indexOf('\n  }'));
  assert.ok(
    !/localStorage\.getItem\s*\(\s*KEY\s*\)/.test(headersBody),
    'buildHeaders() must use the key captured at boot, not re-read it from localStorage',
  );
  assert.match(app, /var deviceKey = null;/, 'the page must hold the device key in a variable');
  assert.match(app, /deviceKey = localStorage\.getItem\(KEY\)/, 'the key must be captured once at boot');
  assert.match(headersBody, /var key = deviceKey;/, 'buildHeaders() must read the captured key');
});
