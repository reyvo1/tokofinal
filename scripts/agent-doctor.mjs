import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const configPath = join(root, 'config', 'work-automation.json');
const isWindows = process.platform === 'win32';

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

if (!existsSync(configPath)) fail('config/work-automation.json tidak ditemukan.');
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (error) {
  fail(`Konfigurasi agent tidak valid: ${error.message}`);
}

const agent = config.agent ?? {};
console.log('============================================================');
console.log('Toko360 - Pemeriksaan Coding Agent');
console.log('============================================================');
console.log(`Automation config : ${config.version ?? '-'}`);
console.log(`Agent enabled     : ${agent.enabled === true ? 'YA' : 'TIDAK'}`);
console.log(`Command           : ${agent.command || '(kosong)'}`);
console.log(`Run saat prepare  : ${agent.autoRunOnPrepare !== false ? 'YA' : 'TIDAK'}`);
console.log(`Run saat resume   : ${agent.autoRunOnResume !== false ? 'YA' : 'TIDAK'}`);

if (agent.enabled !== true) {
  console.log('\nSTATUS: Framework agent sudah tersedia, tetapi coding agent belum diaktifkan.');
  console.log('Tidak ada source code yang akan dikerjakan otomatis sampai command agent dikonfigurasi.');
  process.exit(0);
}
if (!String(agent.command ?? '').trim()) fail('Agent enabled tetapi command masih kosong.');

const command = String(agent.command);
const lookup = isWindows
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `where "${command}"`], { encoding: 'utf8', windowsHide: true })
  : spawnSync('sh', ['-lc', `command -v "${command.replaceAll('"', '\\"')}"`], { encoding: 'utf8' });
if (lookup.status !== 0) fail(`Command agent tidak ditemukan: ${command}`);

const args = Array.isArray(agent.args) ? agent.args.map(String) : [];
if (!args.some((arg) => arg.includes('{promptFile}'))) {
  fail('Konfigurasi args harus memuat placeholder {promptFile}.');
}
console.log('\nSTATUS: Coding agent aktif dan command ditemukan.');
console.log('Pekerjaan baru dan pekerjaan aktif dapat menjalankan agent sesuai konfigurasi.');
