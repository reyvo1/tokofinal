import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const backupScript = await readFile('scripts/backup-database.mjs','utf8');
const verifyScript = await readFile('scripts/verify-backup.mjs','utf8');

test('database backup tooling avoids shell execution and keeps PostgreSQL password out of arguments', () => {
  assert.match(backupScript, /shell: false/);
  assert.match(backupScript, /PGPASSWORD:/);
  assert.match(backupScript, /--format=custom/);
  assert.doesNotMatch(backupScript, /exec\(/);
  assert.match(verifyScript, /Checksum backup tidak cocok/);
});

test('SQLite backup produces portable checksum metadata and verifier accepts it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-backup-'));
  const db = join(dir, 'source.db');
  await writeFile(db, Buffer.from('SQLite format 3\0test-backup-fixture'));
  const env = { ...process.env, DATABASE_PROFILE: 'sqlite', DATABASE_URL: `file:${db}`, BACKUP_DIR: join(dir,'backups') };
  const backup = spawnSync(process.execPath, ['scripts/backup-database.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(backup.status, 0, backup.stderr);
  const result = JSON.parse(backup.stdout);
  const meta = JSON.parse(await readFile(result.metadata,'utf8'));
  assert.equal(meta.artifact.includes('/'), false, 'artifact metadata should be portable basename');
  const verify = spawnSync(process.execPath, ['scripts/verify-backup.mjs', result.metadata], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).ok, true);
});

test('SQLite restore rehearsal verifies checksum and refuses production targets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-restore-'));
  const db = join(dir, 'source.db');
  const target = join(dir, 'restored.db');
  await writeFile(db, Buffer.from('SQLite format 3\0restore-certification-fixture'));
  const env = { ...process.env, DATABASE_PROFILE: 'sqlite', DATABASE_URL: `file:${db}`, BACKUP_DIR: join(dir,'backups') };
  const backup = spawnSync(process.execPath, ['scripts/backup-database.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(backup.status, 0, backup.stderr);
  const result = JSON.parse(backup.stdout);
  const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', result.metadata, '--target-url', `file:${target}`, '--target-env', 'staging'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(restore.status, 0, restore.stderr);
  assert.equal(JSON.parse(restore.stdout).ok, true);
  assert.deepEqual(await readFile(target), await readFile(db));

  const refused = spawnSync(process.execPath, ['scripts/restore-backup.mjs', result.metadata, '--target-url', `file:${join(dir,'prod.db')}`, '--target-env', 'production'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Production ditolak/);
});


test('SQLite restore refuses an equivalent relative path to the active database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-restore-active-'));
  const db = join(dir, 'active.db');
  await writeFile(db, Buffer.from('SQLite format 3\0active-before-backup'));
  const env = { ...process.env, DATABASE_PROFILE: 'sqlite', DATABASE_URL: `file:${db}`, BACKUP_DIR: join(dir,'backups') };
  const backup = spawnSync(process.execPath, ['scripts/backup-database.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(backup.status, 0, backup.stderr);
  const result = JSON.parse(backup.stdout);
  await writeFile(db, Buffer.from('SQLite format 3\0active-after-backup'));
  const equivalentTarget = `file:${relative(process.cwd(), db)}`;
  const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', result.metadata, '--target-url', equivalentTarget, '--target-env', 'staging'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(restore.status, 0, 'equivalent active SQLite path must be refused');
  assert.match(restore.stderr, /file SQLite aktif yang sama/);
  assert.match((await readFile(db)).toString(), /active-after-backup/, 'active DB must remain untouched');
});

test('PostgreSQL restore refuses an equivalent URL for the active database before pg_restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-restore-pg-active-'));
  const artifact = join(dir, 'fixture.dump');
  const bytes = Buffer.from('postgres-backup-fixture');
  await writeFile(artifact, bytes);
  const { createHash } = await import('node:crypto');
  const metadata = join(dir, 'fixture.dump.json');
  await writeFile(metadata, JSON.stringify({
    version: 1,
    artifact: 'fixture.dump',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: { profile: 'postgresql' },
  }));
  const env = { ...process.env, DATABASE_URL: 'postgresql://active:secret@EXAMPLE.com:5432/toko360?schema=public' };
  const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', metadata, '--target-url', 'postgresql://other:secret@example.com/toko360?application_name=restore', '--target-env', 'staging'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(restore.status, 0, 'equivalent active PostgreSQL URL must be refused');
  assert.match(restore.stderr, /database PostgreSQL aktif yang sama/);
  assert.doesNotMatch(restore.stderr, /pg_restore/, 'guard must fail before pg_restore is launched');
});


test('SQLite backup refuses a non-empty WAL instead of producing a stale checksum-valid snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-backup-wal-'));
  const db = join(dir, 'active.db');
  const backupDir = join(dir, 'backups');
  await writeFile(db, Buffer.from('SQLite format 3\0main-file-before-wal'));
  await writeFile(`${db}-wal`, Buffer.from('committed-pages-not-checkpointed'));
  const env = { ...process.env, DATABASE_PROFILE: 'sqlite', DATABASE_URL: `file:${db}`, BACKUP_DIR: backupDir };
  const backup = spawnSync(process.execPath, ['scripts/backup-database.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(backup.status, 0, 'non-empty WAL must fail closed');
  assert.match(backup.stderr, /database belum quiescent/);
  assert.match(backup.stderr, /-wal/);
});

test('legacy API backup drill delegates to canonical hardened DR tools and is cwd-independent', async () => {
  const drill = await readFile('apps/api/scripts/backup-drill.mjs', 'utf8');
  assert.match(drill, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(drill, /scripts['"], ['"]backup-database\.mjs/);
  assert.match(drill, /scripts['"], ['"]verify-backup\.mjs/);
  assert.match(drill, /scripts['"], ['"]restore-backup\.mjs/);
  assert.doesNotMatch(drill, /execSync\(/);
  assert.doesNotMatch(drill, /copyFileSync\(/);

  const dir = await mkdtemp(join(tmpdir(), 't360-legacy-drill-'));
  const db = join(dir, 'source.db');
  const backupDir = join(dir, 'backups');
  await writeFile(db, Buffer.from('SQLite format 3\0legacy-safe-drill'));
  const env = { ...process.env, DATABASE_PROFILE: 'sqlite', DATABASE_URL: `file:${db}`, BACKUP_DIR: backupDir };
  const result = spawnSync(process.execPath, ['apps/api/scripts/backup-drill.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BACKUP\/RESTORE DRILL LULUS/);
  const payload = JSON.parse(result.stdout.slice(0, result.stdout.indexOf('\n\nBACKUP/RESTORE')));
  assert.equal(payload.ok, true);
  assert.equal(payload.restoreVerified, true);
});

test('legacy API backup drill fails closed on active WAL and never reports a false PASS', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-legacy-drill-wal-'));
  const db = join(dir, 'source.db');
  await writeFile(db, Buffer.from('SQLite format 3\0legacy-wal-drill'));
  await writeFile(`${db}-wal`, Buffer.from('committed-pages-not-checkpointed'));
  const env = { ...process.env, DATABASE_PROFILE: 'sqlite', DATABASE_URL: `file:${db}`, BACKUP_DIR: join(dir, 'backups') };
  const result = spawnSync(process.execPath, ['apps/api/scripts/backup-drill.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /database belum quiescent/);
  assert.doesNotMatch(result.stdout, /BACKUP\/RESTORE DRILL LULUS/);
});

test('retention cleanup resolves repo root from script location and rejects unsafe retention windows', async () => {
  const retention = await readFile('apps/api/scripts/retention-cleanup.mjs', 'utf8');
  assert.match(retention, /fileURLToPath\(import\.meta\.url\)/);
  assert.doesNotMatch(retention, /path\.resolve\(process\.cwd\(\), ['"]\.\.\/\.\.['"]\)/);
  assert.match(retention, /Number\.isInteger\(value\)/);
  assert.match(retention, /value < 1 \|\| value > 3650/);
  assert.match(retention, /retentionDays\.\$\{name\} harus integer 1-3650 hari/);
});

test('SQLite restore refuses an existing target or stale sidecar before mutation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-restore-fresh-target-'));
  const db = join(dir, 'source.db');
  const target = join(dir, 'target.db');
  await writeFile(db, Buffer.from('SQLite format 3\0fresh-source'));
  await writeFile(target, Buffer.from('SQLite format 3\0existing-target'));
  await writeFile(`${target}-wal`, Buffer.from('stale-target-wal-pages'));
  const env = { ...process.env, DATABASE_PROFILE: 'sqlite', DATABASE_URL: `file:${db}`, BACKUP_DIR: join(dir, 'backups') };
  const backup = spawnSync(process.execPath, ['scripts/backup-database.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(backup.status, 0, backup.stderr);
  const result = JSON.parse(backup.stdout);
  const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', result.metadata, '--target-url', `file:${target}`, '--target-env', 'test'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(restore.status, 0);
  assert.match(restore.stderr, /harus fresh/);
  assert.match((await readFile(target)).toString(), /existing-target/);
  assert.equal((await readFile(`${target}-wal`)).toString(), 'stale-target-wal-pages');
});

test('PostgreSQL restore treats loopback aliases as the same active database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't360-restore-pg-loopback-'));
  const artifact = join(dir, 'fixture.dump');
  const bytes = Buffer.from('postgres-loopback-backup-fixture');
  await writeFile(artifact, bytes);
  const { createHash } = await import('node:crypto');
  const metadata = join(dir, 'fixture.dump.json');
  await writeFile(metadata, JSON.stringify({
    version: 1,
    artifact: 'fixture.dump',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: { profile: 'postgresql' },
  }));
  const fakeRestore = join(dir, process.platform === 'win32' ? 'fake-pg-restore.cmd' : 'fake-pg-restore.sh');
  const marker = join(dir, 'marker.txt');
  if (process.platform === 'win32') {
    await writeFile(fakeRestore, `@echo invoked>"${marker}"\r\n@exit /b 0\r\n`);
  } else {
    await writeFile(fakeRestore, `#!/bin/sh\necho invoked > "${marker}"\nexit 0\n`);
    const { chmod } = await import('node:fs/promises');
    await chmod(fakeRestore, 0o755);
  }
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://active:secret@localhost:5432/toko360',
    PG_RESTORE_BIN: fakeRestore,
  };
  const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', metadata, '--target-url', 'postgresql://other:secret@127.0.0.1:5432/toko360', '--target-env', 'staging'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(restore.status, 0);
  assert.match(restore.stderr, /database PostgreSQL aktif yang sama/);
  const { stat } = await import('node:fs/promises');
  await assert.rejects(stat(marker), /ENOENT/, 'pg_restore must not be invoked for loopback-equivalent active target');
});
