import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnNpmSync } from './lib/process-runner.mjs';

const root = process.cwd();
const candidates = [
  resolve(root, 'apps/api/prisma/data/toko360.db'),
  resolve(root, 'apps/api/prisma/data/toko360.db-journal'),
];
for (const file of candidates) if (existsSync(file)) rmSync(file, { force: true });

for (const args of [
  ['run', 'db:local:generate'],
  ['run', 'db:local:push'],
  ['run', 'db:local:seed'],
  ['run', 'test:db:smoke'],
]) {
  const result = spawnNpmSync(args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error(`Gagal menjalankan npm: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Database lokal SQLite berhasil direset.');
