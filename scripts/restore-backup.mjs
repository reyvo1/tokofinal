#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, shell: false });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exit ${code}`)));
  });
}

function sqlitePath(databaseUrl) {
  if (!databaseUrl?.startsWith('file:')) return undefined;
  const raw = databaseUrl.slice(5).split('?')[0];
  return isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
}

async function canonicalFilePath(path) {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertFreshSqliteTarget(targetPath) {
  const existing = [];
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (await pathExists(`${targetPath}${suffix}`)) existing.push(suffix || '<main>');
  }
  if (existing.length) {
    throw new Error(`Target restore SQLite harus fresh dan belum memiliki file/state lama (${existing.join(', ')} ditemukan). Hapus target scratch lama atau gunakan path baru.`);
  }
}

function normalizePostgresHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (['localhost', '127.0.0.1', '[::1]', '::1', '0:0:0:0:0:0:0:1'].includes(host)) return '<loopback>';
  return host;
}

function postgresIdentity(databaseUrl) {
  if (!databaseUrl || !/^postgres(?:ql)?:/i.test(databaseUrl)) return undefined;
  const parsed = new URL(databaseUrl);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) throw new Error('DATABASE_URL PostgreSQL tidak valid.');
  return {
    host: normalizePostgresHost(parsed.hostname),
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

async function assertTargetIsIsolated(targetDatabaseUrl, activeDatabaseUrl) {
  if (!activeDatabaseUrl) return;
  if (targetDatabaseUrl === activeDatabaseUrl) {
    throw new Error('Target restore tidak boleh sama dengan DATABASE_URL aktif. Gunakan database/file staging terisolasi.');
  }

  const targetSqlite = sqlitePath(targetDatabaseUrl);
  const activeSqlite = sqlitePath(activeDatabaseUrl);
  if (targetSqlite && activeSqlite) {
    const [targetCanonical, activeCanonical] = await Promise.all([canonicalFilePath(targetSqlite), canonicalFilePath(activeSqlite)]);
    const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(targetCanonical) === normalize(activeCanonical)) {
      throw new Error('Target restore tidak boleh menunjuk file SQLite aktif yang sama, termasuk melalui path relatif/symlink yang ekuivalen.');
    }
    return;
  }

  const targetPostgres = postgresIdentity(targetDatabaseUrl);
  const activePostgres = postgresIdentity(activeDatabaseUrl);
  if (targetPostgres && activePostgres
    && targetPostgres.host === activePostgres.host
    && targetPostgres.port === activePostgres.port
    && targetPostgres.database === activePostgres.database) {
    throw new Error('Target restore tidak boleh menunjuk database PostgreSQL aktif yang sama, termasuk URL ekuivalen dengan user/query/alias loopback berbeda.');
  }
}

const metadataPath = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : undefined;
const targetUrl = argument('target-url') ?? process.env.RESTORE_TARGET_DATABASE_URL;
const targetEnv = (argument('target-env') ?? process.env.RESTORE_TARGET_ENV ?? '').toLowerCase();
if (!metadataPath || !targetUrl) throw new Error('Gunakan: node scripts/restore-backup.mjs <backup.json> --target-url <url> --target-env staging|test|development');
if (!['development','test','staging'].includes(targetEnv)) throw new Error('Restore otomatis hanya diizinkan untuk target development/test/staging. Production ditolak.');
await assertTargetIsIsolated(targetUrl, process.env.DATABASE_URL);

const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
if (!metadata?.artifact || !metadata?.sha256 || !metadata?.source?.profile) throw new Error('Metadata backup tidak valid.');
const artifactPath = isAbsolute(metadata.artifact) ? metadata.artifact : resolve(dirname(metadataPath), metadata.artifact);
const bytes = await readFile(artifactPath);
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== metadata.sha256 || Number(metadata.size) !== bytes.length) throw new Error('Checksum/size backup tidak valid; restore dibatalkan.');

const profile = String(metadata.source.profile).toLowerCase();
if (profile === 'sqlite') {
  if (!targetUrl.startsWith('file:')) throw new Error('Target SQLite wajib memakai file:.');
  const raw = targetUrl.slice(5).split('?')[0];
  const targetPath = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  if (resolve(targetPath) === resolve(artifactPath)) throw new Error('Target SQLite tidak boleh sama dengan file backup.');
  await assertFreshSqliteTarget(targetPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(artifactPath, targetPath);
  const restored = await readFile(targetPath);
  const restoredHash = createHash('sha256').update(restored).digest('hex');
  if (restoredHash !== metadata.sha256) throw new Error('Checksum hasil restore SQLite tidak cocok.');
  console.log(JSON.stringify({ ok: true, profile: 'sqlite', targetEnv, target: targetPath, sha256: restoredHash }, null, 2));
} else if (profile === 'postgresql' || profile === 'postgres') {
  const parsed = new URL(targetUrl);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) throw new Error('Target PostgreSQL tidak valid.');
  const env = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: parsed.pathname.replace(/^\//, ''),
  };
  await run(process.env.PG_RESTORE_BIN ?? 'pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname', env.PGDATABASE, artifactPath], env);
  console.log(JSON.stringify({ ok: true, profile: 'postgresql', targetEnv, target: { host: env.PGHOST, port: env.PGPORT, database: env.PGDATABASE, user: env.PGUSER }, sourceSha256: actual }, null, 2));
} else {
  throw new Error(`Profil backup tidak didukung: ${profile}`);
}
