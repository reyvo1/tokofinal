// Acceptance #12: a branch is restored from a real backup file, then rejoins WITHOUT a second node.
//
// #12 was PARTIAL because "satu CENTRAL per tenant" was tested but "restore from backup, then rejoin"
// was not. `recordBackupMetadata` refused a non-SHA-256 checksum with the words "agar dapat diverifikasi
// saat restore" — and nothing in the repository could verify it. There was no restore path at all.
//
// What this proves, against a real pushed SQLite database and the REAL BranchContinuityService:
//
//   - a backup FILE is written and hashed for real, so the checksum under test is not a made-up string
//   - a matching checksum verifies, a mismatched one is refused, and BOTH are audited
//   - a node with no recorded backup cannot pass — "nothing to compare" is a refusal, not a success
//   - rejoin after restore keeps the SAME node id, so the sync cursors still mean something
//   - the cursor actually survives, read back from the database rather than asserted in prose
//
// The rejoin path deliberately does NOT require a verified checksum. A node that never recorded a
// backup still has to be able to come back; refusing it would strand the branch forever. That trade is
// asserted here rather than assumed.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't360-restore-'));
const DB = path.join(TMP, 'restore.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const now = () => new Date().toISOString();

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', prismaFml],
  { cwd: ROOT, env, stdio: 'pipe' });

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } });
const conn = () => new DatabaseSync(DB);

const opts = { platform: 'node', external: ['@prisma/client'] };
const { BranchContinuityService } = await load('apps/api/src/branch-continuity/branch-continuity.service.ts', opts);

// The real service takes a SecretProtectorService. The restore and rejoin paths under test never touch
// secrets, but the constructor is not optional, so a stub that THROWS is more honest than one that
// silently succeeds: if a future change starts using the protector here, the test fails loudly instead
// of passing against a fake.
const secrets = {
  protect: async () => { throw new Error('secret protector must not be reached by backup/restore'); },
  unprotect: async () => { throw new Error('secret protector must not be reached by backup/restore'); },
};
const service = new BranchContinuityService(prisma, secrets);

const OWNER = { sub: 'u-1', email: 'owner@acme.test', name: 'Owner', companyId: 'acme', branchId: 'br-1', roles: ['OWNER'], permissions: ['integration.manage'] };

function seed() {
  const c = conn();
  c.exec('DELETE FROM SyncCursor; DELETE FROM SyncNode; DELETE FROM AuditLog;'
    + ' DELETE FROM RolePermission; DELETE FROM Permission; DELETE FROM Role; DELETE FROM UserRole;'
    + ' DELETE FROM User; DELETE FROM Branch; DELETE FROM Company;');
  c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('acme', 'Acme', 'Asia/Makassar', 'IDR', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-1', 'acme', 'BR1', 'Cabang 1', 1, now(), now());
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-1', 'br-1', 'owner@acme.test', 'Owner', 'x', 1, now(), now());
  c.prepare('INSERT INTO Role (id, name) VALUES (?,?)').run('r-1', 'OWNER');
  c.prepare('INSERT INTO UserRole (userId, roleId) VALUES (?,?)').run('u-1', 'r-1');
  c.prepare('INSERT INTO Permission (id, code) VALUES (?,?)').run('p-1', 'integration.manage');
  c.prepare('INSERT INTO RolePermission (roleId, permissionId) VALUES (?,?)').run('r-1', 'p-1');
}

/** A real file on disk, hashed the way a restore operator would hash it. */
function writeBackup(name, contents) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, contents);
  const buf = fs.readFileSync(file);
  return { file, bytes: buf.length, checksum: crypto.createHash('sha256').update(buf).digest('hex') };
}

async function registerNode(code = 'BR-NODE-1') {
  return prisma.syncNode.create({
    data: { companyId: 'acme', code, name: 'Node Cabang 1', role: 'BRANCH', branchId: 'br-1', isActive: true },
  });
}

const auditActions = () => prisma.auditLog.findMany({
  where: { companyId: 'acme' }, orderBy: { createdAt: 'asc' },
  select: { action: true, entityId: true, payload: true },
});
const payloadOf = (row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);

test('the recorded checksum is compared against a REAL file, not a made-up string', async () => {
  seed();
  const node = await registerNode();
  const backup = writeBackup('branch-1.db', Buffer.from('SQLite format 3\0 pretend branch data ' + 'x'.repeat(4096)));
  assert.match(backup.checksum, /^[0-9a-f]{64}$/, 'the hash under test must be a genuine SHA-256');

  await service.recordBackupMetadata(OWNER, {
    nodeId: node.id, completedAt: now(), checksum: backup.checksum, sizeBytes: backup.bytes, kind: 'LOCAL',
  });

  // Read the file back and hash it again independently, the way the restoring node would.
  const reread = crypto.createHash('sha256').update(fs.readFileSync(backup.file)).digest('hex');
  assert.equal(reread, backup.checksum, 'a file must hash to the same value twice, or the test is meaningless');

  const verified = await service.verifyRestoreChecksum(OWNER, { nodeId: node.id, checksum: reread });
  assert.equal(verified.verified, true);
  assert.equal(verified.nodeId, node.id);
});

test('a corrupted backup is refused, and the refusal is audited with both checksums', async () => {
  seed();
  const node = await registerNode();
  const backup = writeBackup('branch-2.db', Buffer.from('the good bytes'));
  await service.recordBackupMetadata(OWNER, {
    nodeId: node.id, completedAt: now(), checksum: backup.checksum, sizeBytes: backup.bytes,
  });

  // A different file entirely — same node, wrong content.
  const corrupted = writeBackup('branch-2-corrupt.db', Buffer.from('the WRONG bytes'));

  await assert.rejects(
    () => service.verifyRestoreChecksum(OWNER, { nodeId: node.id, checksum: corrupted.checksum }),
    /tidak cocok/i,
    'a mismatched checksum must never pass',
  );

  const rows = await auditActions();
  const rejection = rows.find((r) => r.action === 'BRANCH_RESTORE_CHECKSUM_REJECTED');
  assert.ok(rejection, 'the refusal is the event worth having later, so it must be recorded');
  const payload = payloadOf(rejection);
  assert.equal(payload.reason, 'CHECKSUM_MISMATCH');
  assert.equal(payload.supplied, corrupted.checksum);
  assert.equal(payload.recordedChecksum, backup.checksum);
  assert.equal(payload.rejoinAllowed, false);
  assert.equal(rows.some((r) => r.action === 'BRANCH_RESTORE_CHECKSUM_VERIFIED'), false,
    'a refusal must not also leave a "verified" row');
});

test('a node with no recorded backup cannot pass — nothing to compare is a refusal', async () => {
  seed();
  const node = await registerNode();
  const anyBackup = writeBackup('branch-3.db', Buffer.from('content nobody recorded'));

  await assert.rejects(
    () => service.verifyRestoreChecksum(OWNER, { nodeId: node.id, checksum: anyBackup.checksum }),
    /belum punya metadata backup/i,
    'silently succeeding with no reference to compare against would let an unbacked node restore happily',
  );

  const rejection = (await auditActions()).find((r) => r.action === 'BRANCH_RESTORE_CHECKSUM_REJECTED');
  assert.equal(payloadOf(rejection).reason, 'NO_RECORDED_BACKUP');
});

test('a non-SHA-256 checksum is refused before anything is compared', async () => {
  seed();
  const node = await registerNode();
  await assert.rejects(
    () => service.verifyRestoreChecksum(OWNER, { nodeId: node.id, checksum: 'not-a-hash' }),
    /SHA-256/i,
  );
});

test('the newest recorded backup is the one compared', async () => {
  seed();
  const node = await registerNode();
  const older = writeBackup('older.db', Buffer.from('yesterday'));
  const newer = writeBackup('newer.db', Buffer.from('today'));
  await service.recordBackupMetadata(OWNER, {
    nodeId: node.id, completedAt: '2026-09-30T00:00:00.000Z', checksum: older.checksum, sizeBytes: older.bytes,
  });
  await service.recordBackupMetadata(OWNER, {
    nodeId: node.id, completedAt: '2026-10-01T00:00:00.000Z', checksum: newer.checksum, sizeBytes: newer.bytes,
  });

  // The backup an operator would actually restore is the latest one.
  const ok = await service.verifyRestoreChecksum(OWNER, { nodeId: node.id, checksum: newer.checksum });
  assert.equal(ok.verified, true);
  assert.equal(ok.recordedCompletedAt, '2026-10-01T00:00:00.000Z');
  await assert.rejects(
    () => service.verifyRestoreChecksum(OWNER, { nodeId: node.id, checksum: older.checksum }),
    /tidak cocok/i,
    'the stale backup must not be accepted just because some record matches it',
  );
});

test('restore then rejoin keeps the SAME node id, and the sync cursor survives', async () => {
  seed();
  const node = await registerNode();

  // The branch had synced against a peer before the disaster. The cursor is the whole point of
  // rejoining under the same code: losing it means replaying history the peer already has.
  await prisma.syncCursor.create({
    data: { companyId: 'acme', nodeId: node.id, peerNodeId: 'peer-1', cursor: 'evt-0042', lastEventId: 'evt-0042' },
  });

  const backup = writeBackup('branch-4.db', Buffer.from('restored branch state'));
  await service.recordBackupMetadata(OWNER, {
    nodeId: node.id, completedAt: now(), checksum: backup.checksum, sizeBytes: backup.bytes,
  });
  await service.verifyRestoreChecksum(OWNER, { nodeId: node.id, checksum: backup.checksum });

  // The disaster: the node is gone.
  await prisma.syncNode.update({ where: { id: node.id }, data: { isActive: false, lastHeartbeatAt: null } });

  // The replacement server rejoins with the same code. No second node is created.
  const rejoined = await service.rejoinBranch(OWNER, { code: node.code, name: 'Node Cabang 1', role: 'BRANCH', branchId: 'br-1' });
  assert.equal(rejoined.nodeId, node.id, 'rejoin must adopt the existing identity, not mint a new node');

  const nodes = await prisma.syncNode.findMany({ where: { companyId: 'acme' } });
  assert.equal(nodes.length, 1, 'restore/rejoin must work without a second node');

  const cursor = await prisma.syncCursor.findFirst({ where: { nodeId: node.id, peerNodeId: 'peer-1' } });
  assert.equal(cursor.cursor, 'evt-0042', 'the cursor must still mean something after rejoin');
  assert.equal(cursor.lastEventId, 'evt-0042');

  const after = await prisma.syncNode.findFirst({ where: { id: node.id } });
  assert.equal(after.isActive, true, 'a rejoined node must be active again');
  assert.ok(after.lastHeartbeatAt, 'rejoin is the moment the node proves it is alive');
});

test('rejoin still works for a node that never recorded a backup', async () => {
  seed();
  const node = await registerNode('BR-NODE-NEVER-BACKED-UP');
  await prisma.syncNode.update({ where: { id: node.id }, data: { isActive: false } });

  const rejoined = await service.rejoinBranch(OWNER, {
    code: 'BR-NODE-NEVER-BACKED-UP', name: 'Node Cabang 1', role: 'BRANCH', branchId: 'br-1',
  });
  assert.equal(rejoined.nodeId, node.id,
    'refusing rejoin without a verified checksum would strand this branch permanently');
});

test('a tenant cannot verify or rejoin another tenant\'s node', async () => {
  seed();
  const node = await registerNode();
  const intruder = { ...OWNER, companyId: 'other-co' };

  await assert.rejects(() => service.verifyRestoreChecksum(intruder, { nodeId: node.id, checksum: 'a'.repeat(64) }));
  await assert.rejects(() => service.rejoinBranch(intruder, { code: node.code, name: 'x', role: 'BRANCH' }));
  assert.equal((await prisma.syncNode.findMany({ where: { id: node.id } }))[0].isActive, true,
    'an intruder\'s rejoin attempt must not have touched the node');
});

test.after(async () => {
  await prisma.$disconnect();
});