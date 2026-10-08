// Fresh-state harness.
//
// Masalah yang diselesaikan script ini: verifikasi lokal selama ini tidak setara dengan CI.
// Database lokal sudah tercemar data dari probe, dan penyimpangan port dari CI (storefront
// di 3010 karena 3000 dipakai proses luar) membuat UAT lokal hijau sementara runner merah.
//
// Akar masalahnya bukan satu check, tapi tidak ada cara menjalankan UAT terhadap kondisi
// SEJENAK dengan runner. Script ini menutup celah itu: seed ULANG database dari nol,
// jalankan browser UAT, lalu laporkan hasilnya. Kalau hijau di sini, itu bukti jauh
// lebih kuat daripada hijau di DB yang sudah tercemar.
//
// PENTANGGA: harness ini tidak menyentuh gate. Ia hanya menyediakan cara menguji di
// kondisi bersih. Threshold, assertion, dan skip test tetap milik scripts/browser-uat.mjs.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const log = (...args) => console.log('[fresh]', ...args);

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false, ...opts });
}

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) throw new Error('.env tidak ditemukan');
  const parsed = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    parsed[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '');
  }
  return parsed;
}

const steps = [];
function step(name, fn) { steps.push({ name, fn }); }

// 1. Pastikan tidak ada server lama yang menyajikan bundle basi. Stale Next server pernah
//    menyajikan CSS lama (hash 1l41h911) dan membuat UAT mengukur halaman yang salah.
step('matikan server lama di port UAT', () => {
  const ports = [4000, 3001, 3002, 3003, 3010];
  for (const port of ports) {
    const out = spawnSync('bash', ['-c',
      `ss -ltnp 2>/dev/null | grep ':${port} ' | grep -oP 'pid=\\K[0-9]+' | sort -u`],
      { encoding: 'utf8' });
    for (const pid of (out.stdout || '').split('\n').filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGKILL'); log(`  kill ${pid} di port ${port}`); }
      catch { /* proses sudah mati */ }
    }
  }
});

// 2. Database BERSIH. Ini inti harness: tanpa ini, UAT lokal mengukur data sisa probe
//    sehingga check yang bergantung pada data (dashboard donut) hijau palsu.
step('seed ulang database dari nol', () => {
  const parsed = loadEnv();
  const env = {
    ...process.env, ...parsed,
    PATH: `${path.join(root, 'node_modules', '.bin')}:${process.env.PATH}`,
  };
  const dbPath = parsed.DATABASE_URL || '';
  // SQLite berbasis file: hapus berkasnya supaya seed benar-benar dari nol.
  //
  // PENTING: URL `file:` relatif diselesaikan Prisma terhadap DIREKTORI SCHEMA, bukan repo
  // root. Schema ada di apps/api/prisma/schema.prisma, jadi `file:./data/toko360.db`
  // berarti apps/api/prisma/data/toko360.db. Kalau path ini diselesaikan terhadap root,
  // berkas yang dihapus bukan DB yang benar - DB lama tetap utuh, seed menimpanya, dan
  // "fresh state" sebenarnya tetap tercemar. Itu yang membuat fixture penjualan gagal
  // dengan "Katalog produk kosong" padahal produknya ada.
  if (dbPath.startsWith('file:')) {
    const file = dbPath.replace(/^file:/, '').split('?')[0];
    const schemaDir = path.join(root, 'apps', 'api', 'prisma');
    const abs = path.isAbsolute(file) ? file : path.resolve(schemaDir, file);
    if (fs.existsSync(abs)) { fs.rmSync(abs); log(`  hapus DB lama: ${abs}`); }
    else log(`  DB lama tidak ada (sudah bersih): ${abs}`);
    var expectedDb = abs;
  }
  log(`  DATABASE_URL=${dbPath.replace(/\/\/[^@]*@/, '//***@')}`);
  const gen = run('npm', ['run', 'db:local:prepare'], { env });
  if (gen.status !== 0) throw new Error('db:local:prepare gagal');
  log('  db:local:prepare OK');
  // Fail-closed: setelah seed, berkas DB WAJIB ada di path yang kita hapus tadi. Kalau
  // tidak, berarti resolusi path di atas salah - dan seluruh langkah berikutnya akan
  // menguji kondisi yang tidak kita kira (persis bug yang membuat fixture penjualan
  // gagal "katalog kosong" padahal produknya ada).
  if (expectedDb && !fs.existsSync(expectedDb)) {
    throw new Error(`DB hasil seed tidak ditemukan di ${expectedDb}. Resolusi path 'file:' salah; UAT tidak lagi dijalankan pada kondisi yang diasumsikan.`);
  }
  if (expectedDb) log(`  DB siap: ${expectedDb}`);
});

// 3. Build semua app. quality:full menghapus .next, jadi build ulang WAJIB sebelum UAT -
//    tanpa ini server menyajikan bundle basi dan check mengukur halaman yang tidak dikirim.
step('build ulang keenam app', () => {
  for (const w of ['@toko360/api', '@toko360/worker', '@toko360/admin', '@toko360/pos', '@toko360/storefront', '@toko360/employee-portal']) {
    const r = run('npm', ['run', 'build', '-w', w]);
    if (r.status !== 0) throw new Error(`build gagal: ${w}`);
    log(`  build ${w} OK`);
  }
});

// 4. Nyalakan keenam server dari build yang JUSTRU dibangun di atas. Harness mematikan
//    proses lama supaya tidak ada bundle basi yang disajikan, jadi ia WAJIB menyalakan
//    penggantinya sendiri - kalau tidak, UAT gagal dengan "api tidak siap" yang tidak
//    ada kaitannya dengan kondisi database segar.
step('nyalakan keenam server dari build baru', async () => {
  const parsed = loadEnv();
  const env = {
    ...process.env, ...parsed,
    PATH: `${path.join(root, 'node_modules', '.bin')}:${process.env.PATH}`,
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://127.0.0.1:3010',
  };
  const logs = path.join(root, 'logs', 'fresh-state');
  fs.mkdirSync(logs, { recursive: true });

  const services = [
    { name: 'api', cwd: root, cmd: process.execPath, args: ['apps/api/dist/main.js'], port: 4000 },
    { name: 'admin', cwd: path.join(root, 'apps', 'admin'), cmd: path.join(root, 'node_modules', '.bin', 'next'), args: ['start', '-p', '3001'], port: 3001 },
    { name: 'pos', cwd: path.join(root, 'apps', 'pos'), cmd: path.join(root, 'node_modules', '.bin', 'next'), args: ['start', '-p', '3002'], port: 3002 },
    { name: 'employee-portal', cwd: path.join(root, 'apps', 'employee-portal'), cmd: path.join(root, 'node_modules', '.bin', 'next'), args: ['start', '-p', '3003'], port: 3003 },
    { name: 'storefront', cwd: path.join(root, 'apps', 'storefront'), cmd: path.join(root, 'node_modules', '.bin', 'next'), args: ['start', '-p', '3010'], port: 3010 },
  ];
  const started = [];
  for (const svc of services) {
    const out = fs.openSync(path.join(logs, `${svc.name}.log`), 'a');
    const child = spawn(svc.cmd, svc.args, { cwd: svc.cwd, env, detached: true, stdio: ['ignore', out, out] });
    child.unref();
    started.push(child.pid);
    log(`  start ${svc.name} (pid ${child.pid}, port ${svc.port})`);
  }
  fs.writeFileSync(path.join(logs, 'pids.txt'), started.join('\n'));

  // Tunggu setiap endpoint benar-benar hidup. Membangun tidak berarti sudah siap.
  const probes = [
    { url: 'http://127.0.0.1:4000/api/v1/health', label: 'api' },
    { url: 'http://127.0.0.1:3001/', label: 'admin' },
    { url: 'http://127.0.0.1:3002/', label: 'pos' },
    { url: 'http://127.0.0.1:3003/', label: 'employee-portal' },
    { url: 'http://127.0.0.1:3010/', label: 'storefront' },
  ];
  const deadline = Date.now() + 120000;
  // pending berisi LABEL, jadi yang diiterasi harus objek probe yang difilter - bukan
  // labelnya sendiri. Mengiterasi pending langsung membuat probe.url undefined, fetch
  // gagal, dan alasan errornya tersimpan di key undefined sehingga semua dilaporkan
  // "tidak diketahui" padahal server sebenarnya hidup.
  const pending = new Set(probes.map((p) => p.label));
  const probeErrors = new Map();
  while (pending.size && Date.now() < deadline) {
    for (const probe of probes.filter((p) => pending.has(p.label))) {
      try {
        const res = await fetch(probe.url, { signal: AbortSignal.timeout(5000) });
        // Halaman Next.js di / boleh 404 pada root; yang penting server menjawab.
        if (res.status < 500) { pending.delete(probe.label); log(`  ${probe.label} siap`); }
        else probeErrors.set(probe.label, `HTTP ${res.status}`);
      } catch (error) {
        // Simpan alasan sebenarnya. "tidak siap" tanpa penyebab hanya menebak.
        probeErrors.set(probe.label, `${error?.message || error}${error?.cause?.code ? ` (${error.cause.code})` : ''}`);
      }
    }
    if (pending.size) await new Promise((r) => setTimeout(r, 2000));
  }
  if (pending.size) {
    const detail = [...pending].map((l) => `${l}: ${probeErrors.get(l) || 'tidak diketahui'}`).join('; ');
    throw new Error(`server tidak siap -> ${detail} (lihat logs/fresh-state/)`);
  }
});

// 5. Jalankan UAT terhadap kondisi bersih.
step('jalankan browser UAT di kondisi segar', () => {
  const parsed = loadEnv();
  const env = {
    ...process.env, ...parsed,
    PATH: `${path.join(root, 'node_modules', '.bin')}:${process.env.PATH}`,
    T360_CHROMIUM: '/usr/bin/google-chrome',
    T360_UAT_ADMIN_EMAIL: parsed.SEED_ADMIN_EMAIL,
    T360_UAT_ADMIN_PASSWORD: parsed.SEED_ADMIN_PASSWORD,
    T360_UAT_HR_MUTATIONS: 'true',
    // Storefront lokal di 3010 karena port 3000 dipakai proses luar di mesin ini.
    T360_STOREFRONT_URL: 'http://127.0.0.1:3010',
  };
  const r = run('npm', ['run', 'uat:browser'], { env });
  if (r.status !== 0) {
    log('  UAT MERAH di kondisi segar - ini kegagalan NYATA, bukan artefak lokal');
    throw new Error('browser UAT gagal pada database segar');
  }
  log('  UAT hijau pada database segar');
});

// Top-level await tidak tersedia di dalam loop biasa, jadi seluruh orkestrasi dibungkus
// async IIFE. Ini juga membuat harness bisa dipakai dari test tanpa mati process.
await (async () => {
let failed = null;
for (const { name, fn } of steps) {
  log(`--- ${name} ---`);
  try { await fn(); } catch (error) {
    failed = { name, message: error instanceof Error ? error.message : String(error) };
    log(`GAGAL: ${failed.message}`);
    break;
  }
}

if (failed) {
  console.error(`\nHARNESS GAGAL di langkah: ${failed.name}`);
  process.exit(1);
}
console.log('\nHARNESS OK - UAT hijau pada kondisi setara CI');
})();
