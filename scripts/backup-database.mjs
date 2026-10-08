import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { expectedPostgresTarget } from './lib/runtime-target-identity.mjs';

const root = process.cwd();
const profile = (process.env.DATABASE_PROFILE ?? (process.env.DATABASE_URL?.startsWith('postgres') ? 'postgresql' : 'sqlite')).toLowerCase();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL wajib tersedia.');
const backupDir = resolve(process.env.BACKUP_DIR ?? join(root, 'backups'));
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, shell: false });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exit ${code}`)));
  });
}

async function nonEmptyFile(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function assertSqliteQuiescent(dbPath) {
  const active = [];
  for (const suffix of ['-wal', '-journal']) {
    if (await nonEmptyFile(`${dbPath}${suffix}`)) active.push(suffix);
  }
  if (active.length) {
    throw new Error(`Backup SQLite dibatalkan: database belum quiescent (${active.join(', ')} aktif). Hentikan writer/checkpoint database lalu ulangi agar snapshot tidak kehilangan transaksi committed.`);
  }
}

let artifact;
let source = { profile };
if (profile === 'sqlite') {
  if (!url.startsWith('file:')) throw new Error('DATABASE_URL SQLite harus memakai file:.');
  const raw = url.slice(5).split('?')[0];
  const candidates = [isAbsolute(raw) ? raw : resolve(root, raw), resolve(root, 'apps/api/prisma', raw)];
  let dbPath;
  for (const candidate of candidates) {
    try { await stat(candidate); dbPath = candidate; break; } catch {}
  }
  if (!dbPath) throw new Error('File SQLite tidak ditemukan. Jalankan dari root repo atau set DATABASE_URL yang benar.');
  artifact = join(backupDir, `toko360-sqlite-${stamp}.db`);
  await mkdir(dirname(artifact), { recursive: true });
  await assertSqliteQuiescent(dbPath);
  const before = await stat(dbPath);
  await copyFile(dbPath, artifact);
  const after = await stat(dbPath);
  try {
    await assertSqliteQuiescent(dbPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Backup SQLite dibatalkan: file database berubah selama proses copy. Hentikan writer lalu ulangi.');
    }
  } catch (error) {
    await unlink(artifact).catch(() => {});
    throw error;
  }
  source = { profile, databaseFile: dbPath.replace(root, '<repo>'), consistency: 'quiescent-copy' };
} else if (profile === 'postgresql' || profile === 'postgres') {
  const parsed = new URL(url);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) throw new Error('DATABASE_URL PostgreSQL tidak valid.');
  artifact = join(backupDir, `toko360-postgresql-${stamp}.dump`);
  const env = { ...process.env, PGHOST: parsed.hostname, PGPORT: parsed.port || '5432', PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: parsed.pathname.replace(/^\//, '') };
  await run(process.env.PG_DUMP_BIN ?? 'pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', artifact], env);
  source = { profile: 'postgresql', target: expectedPostgresTarget(parsed.hostname, parsed.pathname.replace(/^\//, '')), consistency: 'pg_dump-custom' };
} else {
  throw new Error(`DATABASE_PROFILE tidak didukung: ${profile}`);
}

const bytes = await readFile(artifact);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const metadata = { version: 1, createdAt: new Date().toISOString(), artifact: basename(artifact), size: bytes.length, sha256, source };
const metadataPath = `${artifact}.json`;
await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ok: true, artifact, metadata: metadataPath, size: bytes.length, sha256 }, null, 2));
