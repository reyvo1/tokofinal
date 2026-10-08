import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnNpmSync } from './lib/process-runner.mjs';

const root = process.cwd();
const node = process.execPath;

function assertResult(result, toolName) {
  if (result.error) {
    console.error(`Gagal menjalankan ${toolName}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNode(args, label) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(node, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
  assertResult(result, 'Node.js');
}

function runNpm(args, label) {
  console.log(`\n==> ${label}`);
  const result = spawnNpmSync(args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  assertResult(result, 'npm');
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(`Node.js ${process.versions.node} tidak didukung. Gunakan Node.js 22 LTS atau minimal 20.9.`);
  process.exit(1);
}

const envPath = resolve(root, '.env');
if (!existsSync(envPath)) {
  copyFileSync(resolve(root, '.env.local.example'), envPath);
  console.log('File .env dibuat dari .env.local.example.');
} else if (!/DATABASE_PROFILE=sqlite/.test(readFileSync(envPath, 'utf8'))) {
  copyFileSync(envPath, resolve(root, '.env.backup'));
  copyFileSync(resolve(root, '.env.local.example'), envPath);
  console.log('Profil non-SQLite dipindahkan ke .env.backup; .env lokal SQLite diaktifkan.');
}
let envText = readFileSync(envPath, 'utf8');
if (/^SECRET_MASTER_KEY=\s*$/m.test(envText)) {
  const localKey = randomBytes(32).toString('hex');
  envText = envText.replace(/^SECRET_MASTER_KEY=\s*$/m, `SECRET_MASTER_KEY=${localKey}`);
  writeFileSync(envPath, envText);
  console.log('SECRET_MASTER_KEY lokal acak dibuat untuk secret integration/API development.');
}
mkdirSync(resolve(root, 'apps/api/prisma/data'), { recursive: true });

runNode(['scripts/install-dependencies.mjs'], 'Memasang dependency dengan diagnosis otomatis');
runNpm(['run', 'db:local:generate'], 'Membuat Prisma Client untuk SQLite');
runNpm(['run', 'db:local:push'], 'Membuat database lokal SQLite');
runNpm(['run', 'db:local:seed'], 'Mengisi data awal');
runNpm(['run', 'validate:repo'], 'Memvalidasi struktur repository');
runNpm(['run', 'test:db:smoke'], 'Menjalankan smoke test database');

console.log(`\nToko360 local selesai disiapkan tanpa Docker.\nJalankan aplikasi: npm run dev\nBuka:\n- Storefront http://localhost:3000\n- Admin      http://localhost:3001\n- POS        http://localhost:3002\n- Employee   http://localhost:3003\n- API        http://localhost:4000/api/v1\n- Swagger    http://localhost:4000/docs\n\nLogin admin: admin@toko360.local / Admin123!\nLogin karyawan: karyawan@toko360.local / Employee123!\n`);
