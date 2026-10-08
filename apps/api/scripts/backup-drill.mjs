#!/usr/bin/env node
// Compatibility DR drill. Delegates to the canonical hardened backup/verify/restore tools.
// Safe to invoke from the repository root as documented in STATUS-FINAL.md.
import { spawnSync } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../../..');
const backupScript = join(root, 'scripts', 'backup-database.mjs');
const verifyScript = join(root, 'scripts', 'verify-backup.mjs');
const restoreScript = join(root, 'scripts', 'restore-backup.mjs');

function runNode(script, args, env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${script.split(/[\\/]/).pop()} gagal (exit ${result.status ?? 'spawn'}): ${detail || 'tanpa detail'}`);
  }
  return result.stdout.trim();
}

function parseJsonOutput(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} tidak menghasilkan JSON yang valid.`);
  }
}

const databaseUrl = process.env.DATABASE_URL || 'file:./data/toko360.db';
const profile = (process.env.DATABASE_PROFILE || (databaseUrl.startsWith('postgres') ? 'postgresql' : 'sqlite')).toLowerCase();
if (profile !== 'sqlite') {
  throw new Error('Compatibility backup-drill hanya untuk SQLite lokal. Untuk PostgreSQL gunakan npm run db:backup, db:backup:verify, lalu db:restore:rehearse ke target terisolasi.');
}

const backupDir = process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : join(root, 'backups');
const env = {
  ...process.env,
  DATABASE_PROFILE: 'sqlite',
  DATABASE_URL: databaseUrl,
  BACKUP_DIR: backupDir,
};

let scratchPath;
try {
  const backup = parseJsonOutput(runNode(backupScript, [], env), 'backup-database');
  const verified = parseJsonOutput(runNode(verifyScript, [backup.metadata], env), 'verify-backup');
  scratchPath = join(backupDir, `restore-drill-${process.pid}-${Date.now()}.db`);
  const restored = parseJsonOutput(runNode(restoreScript, [backup.metadata, '--target-url', `file:${scratchPath}`, '--target-env', 'test'], env), 'restore-backup');

  if (verified.sha256 !== restored.sha256) {
    throw new Error(`Hash restore tidak cocok dengan backup terverifikasi. backup=${verified.sha256} restore=${restored.sha256}`);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'sqlite-local-drill',
    backup: backup.artifact,
    metadata: backup.metadata,
    sha256: verified.sha256,
    restoreVerified: true,
    note: 'Backup memakai canonical quiescent-copy guard; tidak ada fallback raw-copy.',
  }, null, 2));
  console.log('\nBACKUP/RESTORE DRILL LULUS.');
} finally {
  if (scratchPath) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      await unlink(`${scratchPath}${suffix}`).catch(() => {});
    }
  }
}
