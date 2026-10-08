// Bukti bahwa loop Telegram benar-benar di-mount, bukan hanya ter-compile.
//
// NEGATIVE CONTROL WAJIB: `TelegramPollingWorker.start` dibongkar menjadi no-op, lalu test ini
// HARUS merah. Kalau test ini hijau tanpa start(), ia menguji import, bukan wiring.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;

function buildWorker() {
  execFileSync('npm', ['run', 'build', '-w', '@toko360/worker'], { cwd: ROOT, stdio: 'pipe' });
  return path.join(ROOT, 'apps/worker/dist/telegram-runtime.js');
}

/** panggil mountTelegramPolling dengan deps palsu, lalu cek apakah start() dipanggil. */
async function mountWith(fakes, env) {
  const mod = await import(`${buildWorker()}?v=${Math.random()}`);
  return mod.mountTelegramPolling(fakes, env, () => {});
}

// The runtime module imports TelegramPollingWorker internally, so for the mount tests we drive the
// real class but never let it touch the network: token empty => no start; token set => start() called.
test('tanpa TELEGRAM_BOT_TOKEN, polling TIDAK dijalankan dan alasannya dilaporkan', async () => {
  const result = await mountWith({}, { NODE_ENV: 'production' });
  assert.equal(result.started, false, 'token kosong harus berarti loop tidak jalan');
  assert.match(result.reason, /TELEGRAM_BOT_TOKEN/,
    'alasannya harus menyebut variabel yang perlu diisi — diam-diam tidak jalan adalah bug yang pernah terjadi di sini');
});

test('dengan token, loop benar-benar start() dan baseUrl diawasi untuk production', async () => {
  const mod = await import(`${buildWorker()}?t=${Math.random()}`);
  const origFetch = globalThis.fetch;
  // pollOnce() tidak boleh keluar ke jaringan pada test ini; start() sendiri hanya menjadwalkan loop.
  globalThis.fetch = async () => { throw new Error('network disabled in test'); };
  let result = null;
  try {
    result = mod.mountTelegramPolling(
      { prisma: {}, MobileOpsService: class { }, TelegramCommandService: class { execute() { return { ok: true, reply: '' }; } } },
      { NODE_ENV: 'development', TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_POLL_INTERVAL_MS: '999999' },
      () => {},
    );
    assert.equal(result.started, true, 'token harus membuat loop start()');
    assert.equal(result.reason, 'ok');
    assert.equal(typeof result.stop, 'function', 'poller harus bisa dihentikan supaya shutdown dan test tidak menggantung');
  } finally {
    // WAJIB: interval poller akan menahan event loop tetap hidup setelah test selesai.
    result?.stop?.();
    globalThis.fetch = origFetch;
  }
});

test('production: baseUrl yang diarahkan keluar dari api.telegram.org DITOLAK (anti-token-bocor)', async () => {
  const mod = await import(`${buildWorker()}?p=${Math.random()}`);
  assert.throws(
    () => mod.mountTelegramPolling(
      { prisma: {}, MobileOpsService: class { }, TelegramCommandService: class { execute() { return { ok: true, reply: '' }; } } },
      { NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_API_BASE_URL: 'https://evil.example.com' },
      () => {},
    ),
    /hanya boleh diarahkan keluar dari production/,
    'worker yang bisa diarahkan ke host bebas adalah worker yang bisa membocorkan token bot',
  );
});

test('worker benar-benar memanggil mountTelegramPolling — ini yang hilang sebelumnya', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/worker/src/index.ts'), 'utf8');
  // SEBELUMNYA: `telegram-polling.ts` tidak punya satu pun importer di seluruh repo, jadi loop
  // tidak pernah jalan meski UI dan service-nya lengkap. Assertion ini mengunciPresence importer.
  assert.match(src, /mountTelegramPolling/,
    'worker harus memanggil mountTelegramPolling; tanpa itu Telegram tidak akan pernah membalas');
  assert.match(src, /startTelegram\(\)/,
    'loop harus dijalankan dari main(), bukan hanya didefinisikan');
  assert.match(src, /await startTelegram\(\)/,
    'startTelegram harus di-await dari main() supaya kegagalan tidak hilang diam-diam');
  // Dan kegagalannya harus TERLIHAT, bukan menelan worker.
  assert.match(src, /Telegram gagal dimuat; worker tetap berjalan/,
    'transport yang rusak tidak boleh menjatuhkan seluruh worker');
  assert.match(src, /\[worker\] Telegram nonaktif/,
    'loop yang tidak aktif harus dicetak, supaya tidak bisa diam-diam mati lagi');
});
