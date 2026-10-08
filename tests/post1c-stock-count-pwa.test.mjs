// POST-1C: the mobile stock-count PWA.
//
// Static files cannot be executed by `node --test` the way a Nest service can, so the functional proof
// is the browser UAT, and this file holds the invariants that a browser run would only catch by
// accident.
//
// Every assertion here has a negative control that turns it red. That is the point: a static test
// asserting only what is present is a test that cannot fail, and this wave has already produced three
// separate "green but broken" surfaces.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const DIR = path.join(ROOT, 'apps/pos/public/stock-count');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const appRaw = read('app.js');
// Strip comments before the structural assertions. They are not code, and a test that matches its own
// explanatory comment is not testing anything: the first version of the "resolved at runtime" check
// failed because the file explains WHY it avoids NEXT_PUBLIC_API_URL, in those exact words.
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const app = stripComments(appRaw);
const sw = stripComments(read('sw.js'));
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

test('the PWA is installable and self-contained', () => {
  for (const file of ['index.html', 'app.js', 'sw.js', 'manifest.webmanifest', 'icon.svg']) {
    assert.ok(fs.existsSync(path.join(DIR, file)), `${file} must exist — a manifest pointing at a missing icon is not installable`);
  }
  assert.equal(manifest.display, 'standalone', 'a count device is held, not browsed');
  assert.equal(manifest.start_url, './', 'start_url must be relative so it works on any branch host');
  assert.equal(manifest.scope, './', 'a relative scope keeps this worker off the POS root scope');
  assert.match(html, /rel="manifest"/);
  assert.match(app, /serviceWorker[\s\S]{0,200}register/);
  // The camera must not be the only way in. BarcodeDetector is Chromium-only for now, and a scanner
  // that silently does nothing on half the phones in a branch is a control that gets abandoned.
  assert.match(app, /'BarcodeDetector' in window/);
  assert.match(html, /id="code"/, 'a manual barcode field must exist alongside the camera');
  assert.match(html, /viewport-fit=cover/, 'a phone with a notch must not lose the submit button');
});

test('every element app.js reaches for exists under that exact id', () => {
  // Found by the browser UAT, not by reading: the markup said `id="card-review hide"`, so the element's
  // id was the literal string "card-review hide" and every `getElementById('card-review')` returned
  // null. The app threw "cannot read properties of null" on the first draft open, and no source-level
  // assertion had looked at ids at all.
  const wanted = [...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(wanted.length > 10, `expected many id lookups, found ${wanted.length}`);
  const declared = new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
  for (const id of new Set(wanted)) {
    assert.ok(declared.has(id), `app.js reads $('${id}') but index.html declares no element with that exact id`);
  }
  // And the converse direction: an id with a class glued onto it is the exact shape of that bug.
  for (const value of declared) {
    assert.doesNotMatch(value, /\s/, `id="${value}" contains whitespace — a class leaked into the id attribute`);
  }
});

test('the API is never served from, or queued into, the cache', () => {
  // A stock count is an authoritative business fact. A stale read is a confidently wrong answer; a
  // queued scan that lands later is a count nobody reviewed. Neither is better than an outage.
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)[\s\S]{0,40}return;/,
    'every /api/ request must return from the fetch handler untouched');
  assert.doesNotMatch(sw, /caches\.open\([\s\S]{0,200}pathname\.startsWith\('\/api\/'\)/,
    'nothing may write an API response into a cache');
  assert.doesNotMatch(sw, /BackgroundSync|sync\.register/,
    'there is no offline mutation queue here, by choice — do not add one silently');
  assert.doesNotMatch(sw, /url\.pathname[^\n]*api[^\n]*caches\.(match|put|add)/);
});

test('a shared counting device does not hand the next shift a live session', () => {
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*token/i,
    'the token must not go to localStorage');
  assert.match(app, /sessionStorage\.setItem\(TOKEN_KEY/);
  assert.match(app, /sessionStorage\.removeItem\(TOKEN_KEY/, 'and logout must clear it');
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*password/i);
  // A device id IS persisted, and that is required: the draft key is (device, warehouse, location), so
  // a per-load id would orphan every count it started instead of resuming it.
  assert.match(app, /localStorage\.setItem\(DEVICE_KEY/);
  assert.doesNotMatch(app, /sessionStorage\.setItem\(DEVICE_KEY/,
    'a device id in sessionStorage would never survive a refresh');
});

test('the client never sends a tenant, branch, company, employee or role', () => {
  // Every one of those is derived server-side from the token. A field here would be a request for
  // authority this surface has no business holding.
  // Both shapes count: an inline `body: { ... }` and a `var body = { ... }` built just above the call.
  // Matching only the first form found 2 of 4 and would have silently skipped the scan and submit
  // payloads — exactly the two that move a count.
  const payloads = app.match(/body: \{[^}]*\}|= \{[^}]*\};/g) ?? [];
  assert.ok(payloads.length >= 4, `expected several request payloads to inspect, found ${payloads.length}`);
  for (const payload of payloads) {
    for (const forbidden of ['companyId', 'branchId', 'employeeId', 'role', 'roles', 'permissions', 'userId']) {
      assert.ok(!new RegExp(forbidden).test(payload), `a client payload must not carry ${forbidden}: ${payload}`);
    }
  }
});

test('the API address is resolved at runtime, never frozen at build time', () => {
  // A build-time constant here would point every branch server at the build machine's host, and a
  // phone on a branch LAN must reach THAT branch's server.
  assert.doesNotMatch(app, /NEXT_PUBLIC_API_URL|import\.meta\.env/,
    'files under public/ are served verbatim; an env constant here is frozen at build time');
  assert.match(app, /URLSearchParams\(location\.search\)\.get\('api'\)/, 'a per-deploy override');
  assert.match(app, /localStorage\.getItem\(API_KEY\)/, 'and a per-device override');
  assert.match(app, /location\.origin \+ '\/api\/v1'/, 'defaulting to same-origin, the branch-server topology');
  assert.match(html, /id="api-url"/, 'and the operator must be able to see and change it');
});

test('the submit wording cannot overstate what happened', () => {
  // The whole design is that a count never posts inventory without supervisor approval. A reply
  // implying the stock moved would be the most damaging thing this surface could say.
  const submitStart = app.indexOf('function performSubmit');
  assert.ok(submitStart > 0, 'performSubmit must exist');
  assert.ok(app.indexOf('function submitDraft', submitStart) > submitStart, 'submitDraft confirmation step must exist');
  const submit = app.slice(submitStart, app.indexOf('function startCamera'));
  // Assert the invariant, not a phrasing: the reply must say approval is still outstanding and name
  // the flow that owns it. An earlier version demanded the literal words "persetujuan supervisor" and
  // failed on a correct message that says "persetujuan ... lewat alur StockOpname kanonik" — a test
  // strict enough to reject a true statement is a test that will be "fixed" by weakening the message.
  assert.match(submit, /persetujuan/i, 'the reply must say approval is still required');
  assert.match(submit, /kanonik/i, 'and name the canonical flow that owns it');
  assert.doesNotMatch(submit, /langsung diperbarui|sudah diperbarui/i);
  assert.doesNotMatch(html, /langsung diperbarui/i);
});

test('the client does not reimplement the server increment rule', () => {
  // addScan increments an existing line server-side. Mirroring that here is how a client starts
  // disagreeing with the server about a count — the one number that must never have two answers.
  const scanStart = app.indexOf('function addScan');
  assert.ok(scanStart > 0, 'addScan must exist');
  const scan = app.slice(scanStart, app.indexOf('function review'));
  assert.match(scan, /showDraft\(/, 're-read the draft rather than patching the local array');
  assert.doesNotMatch(scan, /lines\.(push|splice|filter|map)\(/, 'no local mutation of the counted lines');
  assert.doesNotMatch(app, /lines\[[^\]]+\]\.quantity\s*[+-]=/,
    'and no arithmetic on a counted quantity in the client');
});

test('a missing snapshot reads as unknown, never as zero', () => {
  // "No snapshot" and "counted and matched" are different statements. Rendering the first as the
  // second is how an unreviewed count gets signed off.
  assert.match(app, /sistem \?/, 'an absent snapshot must render as a question, not a number');
  assert.match(app, /belum ada snapshot/);
  assert.doesNotMatch(app, /difference \|\| 0/);
  assert.doesNotMatch(app, /systemQty \?\? 0/);
});
