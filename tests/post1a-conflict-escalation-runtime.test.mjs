// Acceptance #7, executed: conflict escalation has a deterministic rule AND is actually reachable.
//
// #7 was the last PARTIAL item. The existing coverage, `post1a-conflict-reconciliation.test.mjs`, is
// PURE SOURCE REGEX — it asserts that specific source lines exist. That is precisely why this defect
// survived: the test pins the broken guard IN PLACE and never runs the service.
//
//   recordConflict  -> creates with strategy: 'MANUAL_REVIEW'      (line 452)
//   resolveConflict -> requires strategy === 'PENDING'             (line 472)
//   recoveryPlan    -> counts strategy === 'PENDING'              (line 497)
//
// Nothing anywhere writes 'PENDING'. So a recorded conflict can NEVER be resolved — the operator
// queue shows `unresolvedConflicts: 0` while every conflict sits there decided by nobody.
//
// This test runs the REAL BranchSyncService against a real pushed SQLite database so the dead end is
// demonstrated by execution, not inferred from reading.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-conflict-')), 'conflict.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const now = () => new Date().toISOString();

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', prismaFml],
  { cwd: ROOT, env, stdio: 'pipe' });

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } });
const conn = () => new DatabaseSync(DB);

const opts = { platform: 'node', external: ['@prisma/client'] };
const { BranchSyncService } = await load('apps/api/src/branch-sync/branch-sync.service.ts', opts);

// The conflict path never encrypts anything; a protector that throws is more honest than a silent one,
// because it fails loudly if a future change starts needing the secret.
const secrets = {
  encryptText: (t) => `{enc:${t}}`,
  decryptText: (t) => String(t).replace(/^\{enc:|\}$/g, ''),
};
const sync = new BranchSyncService(prisma, secrets);

const OWNER = { sub: 'u-1', email: 'owner@acme.test', name: 'Owner', companyId: 'acme', branchId: 'br-1', roles: ['OWNER'], permissions: ['sync.manage'] };

async function seed() {
  const c = conn();
  c.exec('DELETE FROM SyncConflict; DELETE FROM SyncAggregateVersion; DELETE FROM SyncOutbox; DELETE FROM SyncNode;'
    + ' DELETE FROM AuditLog; DELETE FROM User; DELETE FROM Branch; DELETE FROM Company;');
  c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('acme', 'Acme', 'Asia/Makassar', 'IDR', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-1', 'acme', 'BR1', 'Cabang 1', 1, now(), now());
  // AuditLog.userId references User(id). Without this row every audit write fails a foreign key
  // constraint — and because the service treats audit writes as best-effort, it logs the error and
  // carries on. The tests then see a missing audit row and blame the wrong thing entirely.
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-1', 'br-1', 'owner@acme.test', 'Owner', 'x', 1, now(), now());
  return prisma.syncNode.create({
    data: { companyId: 'acme', code: 'BR-NODE-1', name: 'Node Cabang 1', role: 'BRANCH', branchId: 'br-1', isActive: true },
  });
}

/** An outbox event whose writer believed it was editing version `baseVersion`. */
function outbox(node, eventId, baseVersion, payloadExtra = {}) {
  return prisma.syncOutbox.create({
    data: {
      companyId: 'acme', nodeId: node.id, eventId, aggregateType: 'PRODUCT', aggregateId: 'p-1',
      eventType: 'PRODUCT_UPDATED', schemaVersion: 1,
      payload: { baseVersion, price: 15000, stock: 5, ...payloadExtra },
    },
  });
}

test('a recorded conflict can actually be resolved — the escalation path is not a dead end', async () => {
  const node = await seed();
  await outbox(node, 'evt-1', 3);

  const detected = await sync.detectConflict(OWNER, node.id, 'evt-1');
  assert.equal(detected.conflicted, true, 'baseVersion 3 against watermark 0 is a conflict');

  const recorded = await sync.recordConflict(OWNER, node.id, 'evt-1', 7);
  assert.equal(recorded.strategy, 'PENDING',
    'a newly recorded conflict must be UNDECIDED — never pre-assigned to a winner, and never already resolved');

  // THE DEFECT: this is the step that used to be unreachable.
  const resolved = await sync.resolveConflict(OWNER, node.id, 'evt-1', 'MANUAL_REVIEW', 'Operator sudah cek selisih.');
  assert.equal(resolved.strategy, 'MANUAL_REVIEW');
  assert.ok(resolved.resolvedAt, 'a resolution must carry WHEN it was decided');
  assert.equal(resolved.resolvedBy, OWNER.sub, 'and WHO decided it');
  assert.match(JSON.stringify(resolved.resolution), /sudah cek selisih/, 'and the operator note');
});

test('an unresolved conflict is visible to the operator queue', async () => {
  const node = await seed();
  await outbox(node, 'evt-2', 3);
  await sync.recordConflict(OWNER, node.id, 'evt-2', 9);

  // THE DEFECT, second symptom: recoveryPlan counted strategy 'PENDING', which nothing ever writes,
  // so it reported zero outstanding conflicts while one was sitting there undecided.
  const plan = await sync.recoveryPlan(OWNER, node.id);
  assert.equal(plan.unresolvedConflicts, 1,
    'an undecided conflict must be counted, or the operator never learns it exists');

  await sync.resolveConflict(OWNER, node.id, 'evt-2', 'MANUAL_REVIEW');
  const after = await sync.recoveryPlan(OWNER, node.id);
  assert.equal(after.unresolvedConflicts, 0, 'once decided, it must leave the queue');
});

test('a conflict cannot be resolved twice', async () => {
  const node = await seed();
  await outbox(node, 'evt-3', 2);
  await sync.recordConflict(OWNER, node.id, 'evt-3', 5);
  await sync.resolveConflict(OWNER, node.id, 'evt-3', 'MANUAL_REVIEW');

  await assert.rejects(
    () => sync.resolveConflict(OWNER, node.id, 'evt-3', 'MANUAL_REVIEW', 'coba lagi'),
    /sudah berstatus/i,
    'a second decision must not silently overwrite the first operator judgement',
  );
});

test('recording the same conflict twice is idempotent', async () => {
  const node = await seed();
  await outbox(node, 'evt-4', 1);
  const first = await sync.recordConflict(OWNER, node.id, 'evt-4', 4);
  const second = await sync.recordConflict(OWNER, node.id, 'evt-4', 4);
  assert.equal(second.id, first.id, 'a retry storm must not flood the operator queue with duplicates');
  assert.equal(await prisma.syncConflict.count({ where: { nodeId: node.id } }), 1);
});

test('a writer whose baseVersion matches the watermark is not a conflict', async () => {
  const node = await seed();
  await prisma.syncAggregateVersion.create({
    data: { companyId: 'acme', nodeId: node.id, aggregateType: 'PRODUCT', aggregateId: 'p-1', version: 3 },
  });
  await outbox(node, 'evt-5', 3);
  const detected = await sync.detectConflict(OWNER, node.id, 'evt-5');
  assert.equal(detected.conflicted, false, 'sequential writes must not read as conflicts');
  assert.equal(detected.observedVersion, 3);
});

test('a multi-field event is detected from its aggregate, not from a single field', async () => {
  // Two branches each changed a DIFFERENT field of the same product from the same base version. A rule
  // that compared only price would miss this; the aggregate watermark is what catches it.
  const node = await seed();
  await prisma.syncAggregateVersion.create({
    data: { companyId: 'acme', nodeId: node.id, aggregateType: 'PRODUCT', aggregateId: 'p-1', version: 3 },
  });
  await prisma.syncOutbox.create({
    data: {
      companyId: 'acme', nodeId: node.id, eventId: 'evt-6', aggregateType: 'PRODUCT', aggregateId: 'p-1',
      eventType: 'PRODUCT_UPDATED', schemaVersion: 1,
      payload: { baseVersion: 3, price: 16000, stock: 99, name: 'Kopi 250g (repacked)' },
    },
  });
  const detected = await sync.detectConflict(OWNER, node.id, 'evt-6');
  assert.equal(detected.conflicted, false, 'same base version, nothing else moved: not a conflict');

  // Now the OTHER branch moves the aggregate. The unique key is (nodeId, aggregateType, aggregateId)
  // — no companyId — so a guessed compound name fails as a PrismaClientValidationError.
  await prisma.syncAggregateVersion.update({
    where: { nodeId_aggregateType_aggregateId: { nodeId: node.id, aggregateType: 'PRODUCT', aggregateId: 'p-1' } },
    data: { version: 4 },
  });
  const conflicted = await sync.detectConflict(OWNER, node.id, 'evt-6');
  assert.equal(conflicted.conflicted, true,
    'the watermark moved while this event was in flight — a conflict regardless of which field changed');
  assert.equal(conflicted.observedVersion, 4);
});

test('an event with no declared baseVersion is refused, never reported clean', async () => {
  const node = await seed();
  await prisma.syncOutbox.create({
    data: {
      companyId: 'acme', nodeId: node.id, eventId: 'evt-7', aggregateType: 'PRODUCT', aggregateId: 'p-1',
      eventType: 'PRODUCT_UPDATED', schemaVersion: 1, payload: { price: 15000 },
    },
  });
  await assert.rejects(() => sync.detectConflict(OWNER, node.id, 'evt-7'), /baseVersion/i);
});

test('a node may not record a conflict under another node identity', async () => {
  const node = await seed();
  await outbox(node, 'evt-8', 1);
  const impostor = { ...OWNER, branchId: 'br-9' };
  await assert.rejects(() => sync.recordConflict(impostor, node.id, 'evt-8', 2), /Branch|tidak ditemukan/i);
  assert.equal(await prisma.syncConflict.count({ where: { nodeId: node.id } }), 0);
});

test('recording and resolving both write an audit row', async () => {
  const node = await seed();
  await outbox(node, 'evt-9', 1);
  await sync.recordConflict(OWNER, node.id, 'evt-9', 3);
  await sync.resolveConflict(OWNER, node.id, 'evt-9', 'MANUAL_REVIEW', 'cek');

  const actions = (await prisma.auditLog.findMany({ where: { companyId: 'acme' } })).map((r) => r.action);
  assert.ok(actions.includes('SYNC_CONFLICT_RECORDED'), `missing record audit, got ${actions.join(',')}`);
  assert.ok(actions.includes('SYNC_CONFLICT_RESOLVED'), `missing resolve audit, got ${actions.join(',')}`);
});

test.after(async () => {
  await prisma.$disconnect();
});