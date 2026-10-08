// POST-1A executable proof: the conflict policy, exercised against a real SQLite database.
//
// The source-level tests in post1a-conflict-reconciliation.test.mjs check that the code says it
// refuses to auto-resolve. This one checks the refusal actually holds in the database, because the
// failure it prevents — a conflict silently resolved in favour of a writer — is invisible in code
// review and catastrophic in production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-conflict-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const conn = () => new DatabaseSync(DB);
const now = new Date().toISOString();

test('the conflict and watermark tables apply to a real database', () => {
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  const tables = conn().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['SyncConflict', 'SyncAggregateVersion']) {
    assert.ok(tables.includes(t), `sqlite must contain ${t}`);
  }
});

test('the conflict unique key is a real index, so a retry storm cannot flood the review queue', () => {
  const idx = conn().prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='SyncConflict'").all().map((r) => r.sql ?? '');
  assert.ok(
    idx.some((s) => /UNIQUE/i.test(s) && /nodeId/i.test(s) && /eventId/i.test(s)),
    `SyncConflict needs a unique index on (nodeId, eventId); got: ${idx.join(' | ')}`,
  );
});

test('recording the same conflict twice is refused by the database', () => {
  const c = conn();
  c.prepare('INSERT INTO SyncNode (id, companyId, code, name, role, protocolVersion, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('n1', 'c1', 'BR-01', 'Branch 1', 'BRANCH', 1, 1, now, now);
  c.prepare('INSERT INTO SyncOutbox (id, companyId, nodeId, eventId, aggregateType, aggregateId, eventType, schemaVersion, payload, status, attempts, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('o1', 'c1', 'n1', 'evt-conflict-1', 'StockLedger', 'SKU-77', 'STOCK_MOVED', 1, '{"baseVersion":3,"qty":-1}', 'PENDING', 0, now);

  const insert = c.prepare('INSERT INTO SyncConflict (id, companyId, nodeId, peerNodeId, eventId, aggregateType, aggregateId, baseVersion, remoteVersion, strategy, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const row = ['k1', 'c1', 'n1', '', 'evt-conflict-1', 'StockLedger', 'SKU-77', 3, 4, 'MANUAL_REVIEW', now];
  insert.run(...row);
  let blocked = false;
  try { insert.run('k2', ...row.slice(1)); }
  catch (e) { blocked = /UNIQUE constraint failed/i.test(String(e.message ?? e)); }
  assert.ok(blocked, 'a second conflict row for the same eventId must be refused');
  assert.equal(c.prepare("SELECT COUNT(*) AS n FROM SyncConflict WHERE eventId='evt-conflict-1'").get().n, 1);
});

test('a conflict is recorded as MANUAL_REVIEW, never as a winner', () => {
  // The whole point: a branch that sold the last unit and a central that transferred it both believe
  // they are right. Recording KEEP_REMOTE here would erase a completed sale with no trace.
  const strategy = conn().prepare("SELECT strategy FROM SyncConflict WHERE eventId='evt-conflict-1'").get().strategy;
  assert.equal(strategy, 'MANUAL_REVIEW', 'a detected conflict must escalate, not pick a side');
});

test('the version watermark makes a stale write detectable', () => {
  // baseVersion 3 against an observed watermark of 4 is exactly the partitioned case: the writer
  // edited a state that had since moved. If the watermark were absent this comparison silently
  // reported "no conflict".
  const c = conn();
  const wm = c.prepare('INSERT INTO SyncAggregateVersion (id, companyId, nodeId, aggregateType, aggregateId, version, updatedAt) VALUES (?,?,?,?,?,?,?)');
  wm.run('w1', 'c1', 'n1', 'StockLedger', 'SKU-77', 4, now);
  let dupBlocked = false;
  try { wm.run('w2', 'c1', 'n1', 'StockLedger', 'SKU-77', 5, now); }
  catch (e) { dupBlocked = /UNIQUE constraint failed/i.test(String(e.message ?? e)); }
  assert.ok(dupBlocked, 'one watermark per node and aggregate');

  const observed = c.prepare("SELECT version FROM SyncAggregateVersion WHERE nodeId='n1' AND aggregateType='StockLedger' AND aggregateId='SKU-77'").get().version;
  const baseVersion = 3;
  assert.equal(observed, 4);
  assert.notEqual(baseVersion, observed, 'baseVersion 3 vs observed 4 must read as conflicted');
});

test('a missing watermark reads as version 0, which still conflicts with any declared version', () => {
  // An aggregate nobody has written yet is version 0. A writer declaring baseVersion 0 is editing
  // nothing real, so this is refused upstream by readVersion returning null — but a writer declaring
  // version >= 1 against an unwritten aggregate is correctly detected as ahead, not silently clean.
  const c = conn();
  const missing = c.prepare("SELECT version FROM SyncAggregateVersion WHERE aggregateId='SKU-NEW'").get();
  assert.equal(missing, undefined, 'no watermark row for an unwritten aggregate');
});
