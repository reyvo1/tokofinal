import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { lookup } from 'node:dns/promises';
import { spawnNpm, printableNpmCommand } from './lib/process-runner.mjs';
import { resolve } from 'node:path';

const root = process.cwd();
const logsDir = resolve(root, 'logs');
mkdirSync(logsDir, { recursive: true });

const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const logPath = resolve(logsDir, `setup-${stamp}.log`);
const log = createWriteStream(logPath, { flags: 'a' });

function write(message = '') {
  const text = String(message);
  process.stdout.write(`${text}\n`);
  log.write(`${text}\n`);
}

function redact(text) {
  return String(text)
    .replace(/(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, '$1***:***@')
    .replace(/(_authToken\s*=\s*)\S+/gi, '$1***');
}

function runNpm(args, options = {}) {
  return new Promise((resolvePromise) => {
    write(`\n> ${printableNpmCommand(args)}`);
    const child = spawnNpm(args, {
      cwd: root,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: false,
    });

    let combined = '';
    const consume = (chunk, stream) => {
      const text = redact(chunk.toString());
      combined += text;
      stream.write(text);
      log.write(text);
    };

    child.stdout.on('data', (chunk) => consume(chunk, process.stdout));
    child.stderr.on('data', (chunk) => consume(chunk, process.stderr));
    child.on('error', (error) => {
      const message = `Gagal menjalankan npm: ${error.message}`;
      write(message);
      resolvePromise({ status: 1, output: `${combined}\n${message}` });
    });
    child.on('close', (status) => resolvePromise({ status: status ?? 1, output: combined }));
  });
}

async function verifyRegistryReachable(registryText) {
  const registry = String(registryText).trim().split(/\r?\n/).filter(Boolean).at(-1);
  let hostname;
  try {
    hostname = new URL(registry).hostname;
  } catch {
    throw new Error(`Registry npm tidak valid: ${registry || '(kosong)'}`);
  }
  await Promise.race([
    lookup(hostname),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`DNS timeout untuk ${hostname}`)), 5000)),
  ]);
  return registry;
}

function classify(output) {
  const text = output.toLowerCase();
  if (/eai_again|enotfound|etimedout|econnreset|network|socket hang up/.test(text)) {
    return [
      'Koneksi ke npm registry gagal atau tidak stabil.',
      'Coba jaringan lain/hotspot, matikan VPN sementara, dan periksa proxy atau antivirus HTTPS inspection.',
      'Jalankan `npm run diagnose:install` untuk melihat registry dan konfigurasi proxy.',
    ];
  }
  if (/unable to verify the first certificate|self[- ]signed certificate|certificate/.test(text)) {
    return [
      'Sertifikat HTTPS ditolak.',
      'Periksa antivirus/proxy kantor yang memeriksa HTTPS. Jangan menonaktifkan strict-ssl secara permanen.',
    ];
  }
  if (/eresolve|unable to resolve dependency tree|peer dep/.test(text)) {
    return [
      'Terjadi konflik peer dependency.',
      'Installer akan mencoba ulang dengan --legacy-peer-deps.',
    ];
  }
  if (/eperm|eacces|permission denied|operation not permitted/.test(text)) {
    return [
      'Sistem operasi menolak akses ke folder atau file.',
      'Pastikan proyek berada di folder milik pengguna dan bukan dijalankan langsung dari ZIP atau direktori sistem.',
      'Tutup editor/terminal lain yang sedang memakai node_modules lalu jalankan kembali.',
    ];
  }
  if (/ebusy|resource busy or locked/.test(text)) {
    return [
      'Ada file yang sedang dikunci aplikasi lain.',
      'Tutup VS Code, terminal Node, dan pemindai antivirus sementara pada folder proyek lalu coba lagi.',
    ];
  }
  if (/enospc|no space left/.test(text)) {
    return ['Ruang penyimpanan tidak mencukupi. Kosongkan ruang disk lalu ulangi instalasi.'];
  }
  if (/unsupported engine|ebadengine/.test(text)) {
    return ['Versi Node.js tidak cocok. Gunakan Node.js 22 LTS atau minimal Node.js 20.9.'];
  }
  if (/integrity checksum failed|zlib|tar_bad_archive|eintegrity/.test(text)) {
    return [
      'Cache atau unduhan paket kemungkinan rusak.',
      'Jalankan npm cache verify, kemudian ulangi setup.',
    ];
  }
  return [
    'Penyebab belum dapat diklasifikasikan otomatis.',
    `Buka log lengkap: ${logPath}`,
  ];
}

const installBase = [
  'ci',
  '--no-audit',
  '--no-fund',
  '--prefer-online',
  '--fetch-retries=1',
  '--fetch-retry-mintimeout=1000',
  '--fetch-retry-maxtimeout=3000',
  '--fetch-timeout=15000',
  '--loglevel=notice',
];

write('Toko360 dependency installer');
write(`Node.js : ${process.version}`);
write(`Platform: ${platform()}`);
write(`Folder  : ${root}`);
write(`Log     : ${logPath}`);

if (!existsSync(resolve(root, 'package-lock.json'))) {
  write('\npackage-lock.json tidak ditemukan. Installer aman hanya menjalankan npm ci dari lockfile yang sudah direview.');
  log.end();
  process.exit(1);
}

const npmVersion = await runNpm( ['--version']);
if (npmVersion.status !== 0) {
  write('\nnpm tidak dapat dijalankan. Instal ulang Node.js 22 LTS dan pastikan npm ikut terpasang.');
  process.exit(1);
}

const registry = await runNpm(['config', 'get', 'registry']);
if (registry.status !== 0) {
  write('Registry npm tidak dapat dibaca; instalasi dibatalkan sebelum mengubah node_modules.');
  log.end();
  process.exit(1);
}

try {
  const registryUrl = await verifyRegistryReachable(registry.output);
  write(`Registry DNS OK: ${registryUrl}`);
} catch (error) {
  write(`\nRegistry/DNS tidak tersedia: ${error instanceof Error ? error.message : String(error)}`);
  write('Instalasi dibatalkan lebih awal. Perbaiki DNS/proxy/jaringan lalu jalankan kembali.');
  write(`Log lengkap tersimpan di: ${logPath}`);
  log.end();
  process.exit(1);
}

const ping = await runNpm(['ping', '--fetch-retries=0', '--fetch-timeout=10000', '--loglevel=error']);
if (ping.status !== 0) {
  write('\nRegistry dapat di-resolve tetapi tidak dapat dihubungi. Instalasi dibatalkan sebelum npm ci.');
  for (const line of classify(ping.output)) write(`- ${line}`);
  write(`- Log lengkap tersimpan di: ${logPath}`);
  log.end();
  process.exit(1);
}

write('\nMemverifikasi cache npm...');
await runNpm(['cache', 'verify']);

write('\nMencoba instalasi dependency deterministik dari package-lock.json...');
let result = await runNpm(installBase);

if (result.status !== 0 && /eresolve|unable to resolve dependency tree|peer dep/i.test(result.output)) {
  write('\nKonflik peer dependency terdeteksi. Mencoba npm ci dalam mode kompatibilitas lockfile...');
  result = await runNpm([...installBase, '--legacy-peer-deps']);
}

if (result.status !== 0) {
  write('\n============================================================');
  write('INSTALASI DEPENDENCY GAGAL');
  write('============================================================');
  for (const line of classify(result.output)) write(`- ${line}`);
  write(`- Log lengkap tersimpan di: ${logPath}`);
  write('- Kirimkan file log tersebut atau 30 baris terakhirnya untuk diagnosis tepat.');
  log.end();
  process.exit(1);
}

write('\nDependency berhasil dipasang.');
log.end();
