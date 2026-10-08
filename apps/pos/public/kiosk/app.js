// POST-1D — the customer-facing price checker.
//
// This screen is read-only by construction: it has one request, it is a GET, and there is no code path
// here that could be pointed at a mutation. That is the reason it lives as a plain static page rather
// than as a POS route — a kiosk at the door should not be one config change away from a till.
//
// Three behaviours are the actual product, and each exists because of a specific way this goes wrong:
//
// 1. Scanner input. A USB/HID barcode scanner is a keyboard: it types the code and presses Enter. So
//    there is no "scan" event to listen for. A human typing a barcode on the same screen produces the
//    same keystrokes, so the listener discriminates on inter-key timing — a scanner bursts at a few
//    milliseconds, a person does not. A listener that accepted everything would leave the previous
//    customer's price on screen whenever someone reached over and touched the keyboard.
//
// 2. Never show an unverified price. If the branch server is unreachable, the screen says so and says
//    nothing else. Showing the last price, or a "0", would be the most expensive thing on this page:
//    a customer would be quoted a number the branch cannot honour.
//
// 3. Auto-reset. The next customer must not walk up to the previous customer's price. The screen
//    returns to idle on a timer, and the timer restarts on every scan.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'toko360.kioskKey';
  var RESET_MS = 20000;
  var BRANCH_HEADER = 'x-toko360-branch-id';
  // A scanner types a code in well under this per-key gap; a person does not. 45 ms sits between the
  // two: fast typists reach ~80 ms, and cheap scanners still beat it comfortably.
  var SCANNER_GAP_MS = 45;
  var MIN_CODE_LEN = 6;
  var MAX_CODE_LEN = 64;

  var apiBase = '';
  var branchId = null;
  // The device key is captured once, at boot, and never re-read. The first version called
  // localStorage.getItem() inside buildHeaders() on every request, which looks equivalent and is not:
  // localStorage is scoped to the ORIGIN, not to the page, so the moment a second kiosk tab is opened
  // on the same origin its boot writes its own key over the first one's, and the first screen silently
  // starts authenticating as the second device. The UAT for "two kiosks resolve the same price" caught
  // exactly this — revoking one device had no effect on either screen, because neither screen was using
  // the key the probe had issued it. A screen that can change which device it is, on its own, is a
  // screen that can keep serving after its own key is revoked.
  var deviceKey = null;
  var resetTimer = null;
  var reachable = false;

  // --- scanner listener -------------------------------------------------
  var buffer = '';
  var lastKeyAt = 0;

  // The code is passed in rather than read from `buffer`, because the Enter branch clears the buffer
  // before it gets here. The first version read `buffer.length` — so by the time it ran, the buffer was
  // already empty, the length check failed, and EVERY scan was rejected as "not a scanner". The kiosk
  // was completely dead while every source-level assertion stayed green: the timing logic is only
  // observable by running it, which is why this file is executed in the suite rather than read.
  function looksLikeScanner(code) {
    if (code.length < MIN_CODE_LEN) return false;
    var gap = Date.now() - lastKeyAt;
    return gap >= 0 && gap <= SCANNER_GAP_MS;
  }

  document.addEventListener('keydown', function (event) {
    // A kiosk has no fields, so every keystroke belongs to the scanner. Still: a modifier combination
    // is a person reaching for the machine, not a code.
    if (event.ctrlKey || event.altKey || event.metaKey) { buffer = ''; return; }
    if (event.key === 'Enter') {
      var code = buffer;
      buffer = '';
      if (looksLikeScanner(code)) lookup(code);
      else if (code.length >= MIN_CODE_LEN) log('Diabaikan: diketik manual, bukan pindai.');
      return;
    }
    if (event.key.length !== 1) return;
    var now = Date.now();
    // A long gap means a new scan started, so the previous partial code is dropped.
    if (now - lastKeyAt > SCANNER_GAP_MS) buffer = '';
    lastKeyAt = now;
    buffer += event.key;
  });

  // --- rendering --------------------------------------------------------
  function log(message) { $('log').textContent = message || ''; }

  function setStatus(state, text) {
    var el = $('status');
    el.className = state;
    el.textContent = text;
  }

  function setReachable(value) {
    reachable = value;
    $('focus-ring').className = value ? 'listening' : '';
  }

  function money(value) {
    var number = Number(value);
    if (!isFinite(number)) return String(value);
    return 'Rp ' + number.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  }

  function showIdle() {
    $('price-panel').className = '';
    $('idle').style.display = 'block';
    // Clear the fields, do not merely hide the panel. Hiding left the last verified price sitting in
    // the DOM: invisible to a customer, but still there for an accessibility tree, a support
    // screenshot of the page source, or any future change that shows the panel without re-populating
    // it. The unit suite missed this because it tested a page that had never shown a price before the
    // outage; the live test caught it, because a real kiosk has been showing one all afternoon.
    for (const id of ['p-name', 'p-meta', 'p-price', 'p-unit', 'p-promo', 'p-availability']) {
      $(id).textContent = '';
    }
  }

  function armReset() {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      showIdle();
      log('');
    }, RESET_MS);
  }

  function showProduct(result) {
    $('idle').style.display = 'none';
    $('price-panel').className = 'on';
    $('p-name').textContent = result.name;
    // Barcode is what the customer is holding, so echoing it proves the scan registered.
    $('p-meta').textContent = [result.barcode, result.sku && result.sku !== result.barcode ? result.sku : null]
      .filter(Boolean).join(' · ');
    $('p-price').textContent = money(result.price);
    $('p-unit').textContent = result.unit ? 'per ' + result.unit : '';
    $('p-promo').textContent = result.promotion ? 'PROMO: ' + result.promotion.name : '';
    // "Unknown" is a real state here and gets its own styling. A product that has not opted in is not
    // saying "in stock", and rendering that as a blank would read as a promise.
    var availability = $('p-availability');
    if (!result.availability) { availability.textContent = ''; availability.className = 'unknown'; }
    else if (/habis/i.test(result.availability.message)) { availability.textContent = result.availability.message; availability.className = 'habis'; }
    else { availability.textContent = result.availability.message; availability.className = 'tersedia'; }
    armReset();
  }

  // --- request ----------------------------------------------------------
  function lookup(code) {
    log('Mencari ' + code + '…');
    fetch(apiBase + '/kiosk/price?code=' + encodeURIComponent(code), {
      headers: buildHeaders(),
      cache: 'no-store',
    })
      .then(function (res) {
        if (res.status === 404) { showIdle(); log('Produk tidak ditemukan.'); return null; }
        if (res.status === 401 || res.status === 403) {
          // A key that is no longer valid is an operator problem, and saying so on the customer screen
          // is deliberate: an operator standing nearby is the fastest route to a revoked device.
          setStatus('down', 'PERANGKAT TIDAK DIIZINKAN');
          showIdle();
          log('Kunci perangkat ditolak. Hubungi supervisor.');
          return null;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (result) {
        if (!result) return;
        setReachable(true);
        setStatus('up', 'TERHUBUNG');
        showProduct(result);
        log('');
      })
      .catch(function () {
        // The branch server is gone. This is the degraded state, and it must be loud: the screen shows
        // no price at all rather than a stale one.
        setReachable(false);
        setStatus('down', 'SERVER CABANG TIDAK TERHUBUNG');
        showIdle();
        log('Tidak dapat menghubungi server cabang. Harga tidak ditampilkan.');
      });
  }

  function buildHeaders() {
    var headers = {};
    var key = deviceKey;
    // `x-api-key`, NOT `Authorization: Bearer`. The first version sent a Bearer header and the kiosk
    // returned 401 for every scan — a dead screen that every static assertion happily called correct.
    // The admin panel's own help text states the header; the page was written without reading it.
    if (key) headers['x-api-key'] = key;
    // Sent only when this device has one. A key pinned to a branch works without it, and sending a
    // different branch here would be refused — which is the point of pinning.
    if (branchId) headers[BRANCH_HEADER] = branchId;
    return headers;
  }

  // --- boot -------------------------------------------------------------
  function boot() {
    // Same reasoning as the stock-count PWA: files under public/ are served verbatim, so a build-time
    // constant would point every branch kiosk at the build machine's host. A kiosk on a branch LAN
    // must reach that branch.
    var fromQuery = new URLSearchParams(location.search).get('api');
    if (fromQuery) { try { localStorage.setItem('toko360.kioskApi', fromQuery); } catch (e) { /* ignore */ } }
    var storedApi = null;
    try { storedApi = localStorage.getItem('toko360.kioskApi'); } catch (e) { storedApi = null; }
    apiBase = (storedApi || (location.origin + '/api/v1')).replace(/\/$/, '');
    var queryBranch = new URLSearchParams(location.search).get('branch');
    try { branchId = queryBranch || localStorage.getItem('toko360.kioskBranch') || null; } catch (e) { branchId = null; }

    // A device key is kept in localStorage, unlike a user session. This is a bolted-down screen with no
    // keyboard and no operator present; making it re-authenticate after every power cut would strand
    // the device at the till. The blast radius is exactly the one scope the device was issued.
    try { deviceKey = localStorage.getItem(KEY); } catch (e) { deviceKey = null; }
    if (!deviceKey) {
      setStatus('down', 'BELUM DIKONFIGURASI');
      log('Buka dengan ?key=... untuk memasang kunci perangkat ini.');
    } else {
      setStatus('up', 'SIAP');
    }
    $('branch').textContent = branchId ? 'Cabang ' + branchId.slice(0, 8) : 'Cabang dari kunci';
    document.addEventListener('click', function () {
      // Clicking wakes the screen and re-arms the reset, so an idle kiosk is one tap from ready.
      armReset();
    });
    armReset();
  }

  var queryKey = new URLSearchParams(location.search).get('key');
  if (queryKey) { try { localStorage.setItem(KEY, queryKey); } catch (e) { /* ignore */ } }

  boot();
})();
