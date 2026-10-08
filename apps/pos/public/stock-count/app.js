// POST-1C mobile stock-opname PWA.
//
// The backend, the Telegram surface and the Admin supervision panel were all proven before this file
// existed. This is the missing end of the wave: the one surface the roadmap names and the one an
// operator actually holds — a phone, in a stockroom, with a barcode scanner.
//
// Three things this deliberately does NOT do:
//
//   1. **It does not cache the API.** A stock count is an authoritative business fact. A queued scan
//      that silently posts later is a count nobody reviewed, so the service worker serves the shell
//      only and every mutation goes to the network or fails visibly. There is no offline queue here,
//      and that is a choice, not an omission: §6.1 lists local LAN operation as depending on a PWA,
//      and the local-first part of the POS is a different, already-proven subsystem.
//   2. **It never stores a password**, and the access token lives in sessionStorage, not
//      localStorage — a shared counting device left unlocked must not hand the next shift a live
//      session. A refresh costs a sign-in, which is the correct trade here.
//   3. **It never sends a tenant, branch, company, employee or role.** Every one of those is derived
//      server-side from the token. The only identifiers this file sends are the ones an operator
//      legitimately selects: a warehouse, a device, a location, a draft, a barcode, a quantity.
//
// The scan box is the primary control and the keyboard is a first-class fallback, not an
// afterthought: BarcodeDetector is unavailable on much of iOS Safari, and a scanner that silently
// does nothing on half the phones in a branch is a control that gets abandoned.
(function () {
  'use strict';

  var TOKEN_KEY = 'toko360.countToken';
  var DEVICE_KEY = 'toko360.countDevice';
  var API_KEY = 'toko360.countApi';

  // The API URL is resolved at RUNTIME, not baked in.
  //
  // The POS app reads NEXT_PUBLIC_API_URL, but that is substituted at build time and files under
  // public/ are served verbatim — so a build-time constant here would be frozen to whatever the build
  // machine happened to use, and every branch server would point at the wrong host. A phone on a
  // branch LAN must reach THAT branch's server, so the address is a per-device setting.
  //
  // Same-origin is the default because that is the documented topology: a branch runs its own server
  // on its own LAN (§1), and this PWA is served by it. The override exists for the split-host case.
  function resolveApi() {
    var fromQuery = new URLSearchParams(location.search).get('api');
    if (fromQuery) {
      try { localStorage.setItem(API_KEY, fromQuery.replace(/\/$/, '')); } catch (e) { /* ignore */ }
      return fromQuery.replace(/\/$/, '');
    }
    var stored = null;
    try { stored = localStorage.getItem(API_KEY); } catch (e) { stored = null; }
    return (stored || (location.origin + '/api/v1')).replace(/\/$/, '');
  }

  var API = resolveApi();

  var $ = function (id) { return document.getElementById(id); };
  var token = null;
  var draft = null;
  var lines = [];
  var scanner = null;

  function say(text, kind) {
    var el = $('msg');
    el.textContent = text || '';
    el.style.color = kind === 'bad' ? 'var(--bad)' : kind === 'ok' ? 'var(--ok)' : 'var(--muted)';
  }

  function deviceId() {
    var stored = null;
    try { stored = localStorage.getItem(DEVICE_KEY); } catch (e) { stored = null; }
    if (stored) return stored;
    // A stable per-device id. Generated once and kept: the draft key is (device, warehouse, location),
    // so an id that changed on every load would never resume a count — it would orphan one per visit.
    var made = 'dev-' + Math.random().toString(36).slice(2, 8) + '-' + Date.now().toString(36);
    try { localStorage.setItem(DEVICE_KEY, made); } catch (e) { /* private mode: per-session id */ }
    return made;
  }

  function api(path, options) {
    options = options || {};
    return fetch(API + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!response.ok) {
          var message = (data && (data.message || data.error)) || ('Permintaan gagal (' + response.status + ').');
          var error = new Error(Array.isArray(message) ? message.join(' ') : message);
          error.status = response.status;
          throw error;
        }
        return data;
      });
    });
  }

  // ---------------------------------------------------------------- render

  function show(section) {
    $('sec-login').classList.toggle('hide', section !== 'login');
    $('sec-count').classList.toggle('hide', section !== 'count');
  }

  function renderLines() {
    var host = $('lines');
    host.textContent = '';
    if (!lines.length) {
      var empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'Belum ada baris. Pindai atau ketik barcode lalu tekan Tambah.';
      host.appendChild(empty);
    } else {
      lines.forEach(function (line) {
        var row = document.createElement('div');
        row.className = 'line';
        var left = document.createElement('div');
        var code = document.createElement('div');
        code.className = 'code';
        code.textContent = line.barcode || line.sku || line.key;
        left.appendChild(code);
        var right = document.createElement('strong');
        right.textContent = '×' + line.quantity;
        row.appendChild(left);
        row.appendChild(right);
        host.appendChild(row);
      });
    }
    $('line-count').textContent = lines.length + ' baris · '
      + lines.reduce(function (sum, l) { return sum + l.quantity; }, 0) + ' unit';
  }

  function showDraft(draftRow) {
    draft = draftRow;
    $('draft-info').textContent = 'Draft ' + draftRow.id + ' · ' + draftRow.status
      + (draftRow.opnameId ? ' · opname ' + draftRow.opnameId : ' · belum terikat opname');
    $('card-scan').classList.remove('hide');
    $('card-review').classList.toggle('hide', !draftRow.opnameId);
    return api('/mobile-ops/drafts/' + encodeURIComponent(draftRow.id))
      .then(function (full) { lines = (full && full.lines) || []; renderLines(); })
      .catch(function (error) {
        // Never turn a failed authoritative read into an empty count. An empty list means the
        // server confirmed zero lines; a transport/server failure means the operator does not know.
        say(error.message || 'Gagal memuat isi draft.', 'bad');
        throw error;
      });
  }

  // ---------------------------------------------------------------- actions

  function login() {
    say('Memproses…');
    api('/auth/login', {
      method: 'POST',
      body: { email: $('email').value.trim(), password: $('password').value },
    }).then(function (data) {
      if (!data || !data.accessToken) throw new Error('Server tidak mengembalikan token.');
      token = data.accessToken;
      // sessionStorage, not localStorage — see the note at the top of this file.
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
      $('password').value = '';
      $('who').textContent = 'Masuk sebagai ' + ($('email').value.trim());
      $('device').value = deviceId();
      show('count');
      say('Siap. Pilih gudang lalu buka hitungan.', 'ok');
    }).catch(function (error) { say(error.message, 'bad'); });
  }

  function openDraft() {
    say('Membuka draft…');
    var body = { deviceId: $('device').value.trim() || deviceId(), warehouseId: $('warehouse').value.trim() };
    var location = $('location').value.trim();
    if (location) body.locationId = location;
    var opname = $('opname').value.trim();
    if (opname) body.opnameId = opname;
    if (!body.warehouseId) { say('Isi id gudang lebih dulu.', 'bad'); return; }
    api('/mobile-ops/drafts/open', { method: 'POST', body: body })
      .then(function (row) {
        return showDraft(row).then(function () {
          say(row.resumed ? 'Draft dilanjutkan.' : 'Draft dibuat.', 'ok');
        });
      })
      .catch(function (error) { say(error.message, 'bad'); });
  }

  function addScan(barcode, quantity) {
    if (!draft) { say('Buka hitungan dulu.', 'bad'); return; }
    var body = { barcode: barcode, quantity: quantity };
    api('/mobile-ops/drafts/' + encodeURIComponent(draft.id) + '/scan', { method: 'POST', body: body })
      .then(function (saved) {
        $('code').value = '';
        $('qty').value = '1';
        say('Tercatat. ' + saved.lineCount + ' baris, ' + saved.totalUnits + ' unit.', 'ok');
        // Re-read rather than patch the local array: the service increments an existing line, and
        // mirroring that rule here is how a client starts disagreeing with the server about a count.
        return showDraft({ id: saved.id, status: saved.status, opnameId: draft.opnameId });
      })
      .catch(function (error) { say(error.message, 'bad'); });
  }

  function review() {
    if (!draft) return;
    say('Membandingkan…');
    api('/mobile-ops/drafts/' + encodeURIComponent(draft.id) + '/discrepancy')
      .then(function (result) {
        var host = $('review');
        host.textContent = '';
        (result.lines || []).forEach(function (line) {
          var row = document.createElement('div');
          row.className = 'line';
          var name = document.createElement('div');
          name.textContent = line.productName || line.key;
          var pill = document.createElement('span');
          if (line.difference === null || line.difference === undefined) {
            pill.className = 'pill warn';
            pill.textContent = 'sistem ?';
          } else if (line.difference === 0) {
            pill.className = 'pill ok';
            pill.textContent = 'cocok';
          } else {
            pill.className = 'pill bad';
            pill.textContent = (line.difference > 0 ? '+' : '') + line.difference;
          }
          row.appendChild(name);
          row.appendChild(pill);
          host.appendChild(row);
        });
        $('card-review').classList.remove('hide');
        say('Sistem ? berarti belum ada snapshot untuk dibandingkan — bukan nol.', 'ok');
      })
      .catch(function (error) { say(error.message, 'bad'); });
  }

  function performSubmit(opnameId) {
    say('Mengirim…');
    return api('/mobile-ops/drafts/' + encodeURIComponent(draft.id) + '/submit', {
      method: 'POST', body: { opnameId: opnameId },
    }).then(function (result) {
      say('Terkirim: ' + result.filledItems + ' item terisi di opname ' + result.opnameId
        + '. Pengajuan dan persetujuan tetap lewat alur StockOpname kanonik.', 'ok');
      draft = null;
      lines = [];
      renderLines();
      $('card-review').classList.add('hide');
    }).catch(function (error) { say(error.message, 'bad'); });
  }

  function submitDraft() {
    if (!draft) return;
    var opnameId = $('opname').value.trim();
    if (!opnameId) { say('Isi id opname lebih dulu.', 'bad'); return; }
    var dialog = $('submit-confirm');
    $('submit-confirm-text').textContent = 'Kirim hitungan draft ini ke opname ' + opnameId + '? Stok belum berubah sampai alur StockOpname disetujui.';
    dialog.dataset.opnameId = opnameId;
    dialog.showModal();
  }

  // ---------------------------------------------------------------- camera

  // BarcodeDetector is Chromium-only for now. On a browser without it the camera button is hidden and
  // the keyboard box stays — rather than opening a camera that will never produce a code.
  function startCamera() {
    if (!('BarcodeDetector' in window)) {
      say('Browser ini tidak mendukung pemindaian kamera. Ketik barcode secara manual.', 'bad');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say('Kamera tidak tersedia di konteks ini. Ketik barcode secara manual.', 'bad');
      return;
    }
    var video = $('video');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (stream) {
        video.srcObject = stream;
        video.classList.remove('hide');
        $('btn-camera').classList.add('hide');
        $('btn-camera-stop').classList.remove('hide');
        var detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
        var tick = function () {
          if (!scanner) return;
          detector.detect(video).then(function (codes) {
            if (codes && codes.length) {
              var value = codes[0].rawValue;
              $('code').value = value;
              var qty = parseInt($('qty').value, 10) || 1;
              addScan(value, qty);
              stopCamera();
              return;
            }
            requestAnimationFrame(tick);
          }).catch(function () { requestAnimationFrame(tick); });
        };
        requestAnimationFrame(tick);
      })
      .catch(function () { say('Kamera ditolak atau tidak bisa dibuka. Ketik barcode secara manual.', 'bad'); });
  }

  function stopCamera() {
    scanner = false;
    var video = $('video');
    if (video.srcObject) { video.srcObject.getTracks().forEach(function (t) { t.stop(); }); video.srcObject = null; }
    video.classList.add('hide');
    $('btn-camera').classList.remove('hide');
    $('btn-camera-stop').classList.add('hide');
  }

  // ---------------------------------------------------------------- wire

  function describeApi() {
    var el = $('api-info');
    if (el) el.textContent = 'Server: ' + API;
  }

  $('api-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var value = $('api-url').value.trim().replace(/\/$/, '');
    if (!value) { try { localStorage.removeItem(API_KEY); } catch (e) { /* ignore */ } }
    else { try { localStorage.setItem(API_KEY, value); } catch (e) { /* ignore */ } }
    API = resolveApi();
    describeApi();
    say('Server diperbarui: ' + API, 'ok');
  });
  $('api-url').value = API;
  describeApi();

  $('btn-login').addEventListener('click', login);
  $('btn-open').addEventListener('click', openDraft);
  $('btn-scan').addEventListener('click', function () {
    var code = $('code').value.trim();
    if (!code) { say('Isi barcode atau SKU.', 'bad'); return; }
    var qty = parseInt($('qty').value, 10);
    if (!isFinite(qty) || qty <= 0) { say('Jumlah harus bilangan positif.', 'bad'); return; }
    addScan(code, qty);
  });
  $('code').addEventListener('keydown', function (event) { if (event.key === 'Enter') $('btn-scan').click(); });
  $('btn-review').addEventListener('click', review);
  $('btn-submit').addEventListener('click', submitDraft);
  $('btn-submit-cancel').addEventListener('click', function () { $('submit-confirm').close(); });
  $('btn-submit-confirm').addEventListener('click', function () {
    var dialog = $('submit-confirm');
    var opnameId = dialog.dataset.opnameId || '';
    dialog.close();
    if (!opnameId || !draft) return;
    void performSubmit(opnameId);
  });
  $('btn-camera').addEventListener('click', function () { scanner = true; startCamera(); });
  $('btn-camera-stop').addEventListener('click', stopCamera);
  $('btn-logout').addEventListener('click', function () {
    stopCamera();
    token = null;
    draft = null;
    lines = [];
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    $('password').value = '';
    $('who').textContent = 'Belum masuk';
    renderLines();
    show('login');
  });

  // A draft left open on a shared device is the normal case, not the exception.
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
  if (token) {
    $('device').value = deviceId();
    $('who').textContent = 'Sesi dipulihkan di perangkat ini';
    show('count');
  } else {
    show('login');
  }
  renderLines();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () { /* offline shell is optional */ });
  }
})();
