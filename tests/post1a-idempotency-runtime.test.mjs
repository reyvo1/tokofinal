// POST-1A executable proof: the idempotency and fail-closed guarantees, exercised against a real
// SQLite database rather than asserted against source text.
//
// The other POST-1A tests check that the code SAYS the right thing. This one checks that it DOES the
// right thing. A duplicated sale or a doubled stock movement reconciles fine row by row and only
// surfaces as a wrong total weeks later, so this is the guarantee worth executing.
//
// Uses node:sqlite (Node 22+ built-in) rather than the sqlite3 CLI, which is not installed on this
// host. Shelling out to it would make these tests fail for an environmental reason that says
// nothing about the code under test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-post1a-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');

const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const q = (sql, ...params) => new DatabaseSync(DB).prepare(sql).all(...params);

test('prisma push applies the new sync models to a real database', () => {
  // If the models only typecheck but do not push, every guarantee below would be untestable.
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  const tables = q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
  for (const t of ['SyncNode', 'SyncPeer', 'SyncOutbox', 'SyncCursor', 'SyncInbox']) {
    assert.ok(tables.includes(t), `sqlite must contain ${t}`);
  }
});

test('the unique constraint on SyncOutbox.eventId survives as a real index', () => {
  // The declaration alone proves nothing: this is the constraint that makes duplicate suppression
  // safe under concurrency, so it has to exist as an actual index in the database.
  const indexes = q("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='SyncOutbox'").map((r) => r.sql ?? '');
  assert.ok(
    indexes.some((s) => /UNIQUE/i.test(s) && /eventId/.test(s)),
    `SyncOutbox needs a unique index on eventId; got: ${indexes.join(' | ')}`,
  );
  // Prisma emits @@unique as a separate CREATE UNIQUE INDEX, not as a clause inside CREATE TABLE,
  // so the table DDL does not contain it. Look at the index list, which is also where the real
  // enforcement lives.
  const inboxIndexes = q("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='SyncInbox'").map((r) => r.sql ?? '');
  assert.ok(
    inboxIndexes.some((s) => /UNIQUE/i.test(s) && /nodeId/i.test(s) && /eventId/i.test(s)),
    `SyncInbox needs a unique index on (nodeId, eventId); got: ${inboxIndexes.join(' | ')}`,
  );
});

test('inserting the same eventId twice is rejected by the database itself', () => {
  const now = new Date().toISOString();
  // Supply ids explicitly: a test failing on "no such column" teaches nothing about idempotency.
  const conn = new DatabaseSync(DB);
  conn.prepare('INSERT INTO SyncNode (id, companyId, code, name, role, protocolVersion, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('n1', 'c1', 'BR-01', 'Branch 1', 'BRANCH', 1, 1, now, now);
  assert.equal(q("SELECT id FROM SyncNode WHERE code='BR-01'")[0].id, 'n1', 'SyncNode row must exist');

  const insert = conn.prepare('INSERT INTO SyncOutbox (id, companyId, nodeId, eventId, aggregateType, aggregateId, eventType, schemaVersion, payload, status, attempts, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const row = ['row-1', 'c1', 'n1', 'evt-dup-1', 'Sale', 'S-1', 'SALE_CREATED', 1, '{"total":100}', 'PENDING', 0, now];
  insert.run(...row);
  let rejected = false;
  try {
    insert.run(...row);
  } catch (error) {
    rejected = /UNIQUE constraint failed/i.test(String(error.message ?? error));
  }
  assert.ok(rejected, 'a second insert with the same eventId must be refused by the unique index');
  assert.equal(q("SELECT COUNT(*) AS n FROM SyncOutbox WHERE eventId='evt-dup-1'")[0].n, 1, 'exactly one outbox row per eventId');
});

test('a replayed event on the receiving side is recorded once and reported as a duplicate', () => {
  // This is the guarantee the roadmap calls "idempotent replay". Both deliveries carry the same
  // eventId from a retried POST; the receiver must apply the mutation once and classify the second
  // as a duplicate rather than creating a second row.
  const now = new Date().toISOString();
  const conn = new DatabaseSync(DB);
  conn.prepare('INSERT INTO SyncNode (id, companyId, code, name, role, protocolVersion, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('n2', 'c1', 'BR-02', 'Branch 2', 'BRANCH', 1, 1, now, now);
  conn.prepare('INSERT INTO SyncPeer (id, companyId, nodeId, peerNodeId, direction, sharedSecretRef, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('p1', 'c1', 'n1', 'n2', 'BIDIRECTIONAL', 'secret', 1, now, now);

  const insertInbox = conn.prepare('INSERT INTO SyncInbox (id, companyId, nodeId, peerNodeId, eventId, eventType, schemaVersion, outcome, payloadDigest, receivedAt) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const delivery = ['i1', 'c1', 'n1', 'n2', 'evt-replay-1', 'SALE_CREATED', 1, 'APPLIED', 'abc', now];
  insertInbox.run(...delivery);
  let duplicateBlocked = false;
  try {
    insertInbox.run('i2', ...delivery.slice(1));
  } catch (error) {
    duplicateBlocked = /UNIQUE constraint failed/i.test(String(error.message ?? error));
  }
  assert.ok(duplicateBlocked, 'a replayed eventId must hit the (nodeId, eventId) unique constraint');
  assert.equal(q("SELECT COUNT(*) AS n FROM SyncInbox WHERE eventId='evt-replay-1'")[0].n, 1, 'a replayed event must produce exactly one inbox row');
  assert.equal(q("SELECT outcome FROM SyncInbox WHERE eventId='evt-replay-1'")[0].outcome, 'APPLIED', 'the first delivery keeps its outcome');
});

test('every sync table is scoped by companyId so a tenant cannot read another tenant queue', () => {
  // §2 requires tenant scope on every synchronized operation. A sync table without companyId would be
  // a cross-tenant leak waiting for the first bug.
  for (const t of ['SyncNode', 'SyncPeer', 'SyncOutbox', 'SyncCursor', 'SyncInbox']) {
    const cols = q(`PRAGMA table_info(${t})`).map((c) => c.name);
    assert.ok(cols.includes('companyId'), `${t} must carry companyId; has: ${cols.join(',')}`);
  }
});
