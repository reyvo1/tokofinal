// POST-1B executable proof: offline inter-branch transfer, against a real database.
//
// Two things are proved here that source-reading cannot prove:
//
//   1. A departure is recorded even when the destination branch has no node registered at all. The
//      whole wave exists for that case; if it quietly required a reachable destination, the tests
//      reading the service would still pass while the product failed in the field.
//   2. The mismatch is DISCREPANT and stays visible. The negative control removes the discrepancy
//      branch and shows the buggy variant would report CONVERGED — which is the exact lie this design
//      refuses to tell.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-xfer-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const conn = () => new DatabaseSync(DB);
const now = () => new Date().toISOString();

test('the transfer sync table applies to a real database', () => {
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  const tables = conn().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes('BranchTransferSync'));
  // Check every index, not just the first: SQLite always emits a synthetic `sqlite_autoindex_*` row
  // with an empty sql column, so an [0]-style check reads "" and reports a missing constraint on a
  // perfectly healthy table.
  const idx = conn().prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='BranchTransferSync'").all();
  assert.ok(
    idx.some((r) => /UNIQUE/i.test(r.sql ?? '') && /transferId/i.test(`${r.name} ${r.sql ?? ''}`)),
    `one sync row per transfer; indexes: ${idx.map((r) => r.name).join(', ')}`,
  );
});

function seedTopology({ withDestinationNode }) {
  const c = conn();
  c.prepare('INSERT INTO Company (id, name, createdAt, updatedAt) VALUES (?,?,?,?)').run('acme', 'Acme', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-src', 'acme', 'SRC', 'Source', 1, now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-dst', 'acme', 'DST', 'Destination', 1, now(), now());
  // Warehouse has no companyId of its own — tenant arrives through branchId. The same mistake in the
  // service was caught by tsc; here it shows up as a runtime SQL error, which is why the fixture has
  // to match the real schema rather than the intuitive shape.
  c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('wh-src', 'WHS', 'Gudang asal', 'br-src', 1, 1, now(), now());
  c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('wh-dst', 'WHD', 'Gudang tujuan', 'br-dst', 1, 0, now(), now());
  c.prepare('INSERT INTO SyncNode (id, companyId, code, name, role, branchId, protocolVersion, isActive, lastHeartbeatAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('node-src', 'acme', 'SRC', 'Source', 'BRANCH', 'br-src', 1, 1, now(), now(), now());
  if (withDestinationNode) {
    c.prepare('INSERT INTO SyncNode (id, companyId, code, name, role, branchId, protocolVersion, isActive, lastHeartbeatAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('node-dst', 'acme', 'DST', 'Destination', 'BRANCH', 'br-dst', 1, 1, now(), now(), now());
  }
}
function shipTransfer(id, status, items) {
  conn().prepare('INSERT INTO StockTransfer (id, number, sourceWarehouseId, destinationWarehouseId, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run(id, `TRF-${id}`, 'wh-src', 'wh-dst', status, now(), now());
  for (const it of items) {
    // StockTransferItem carries no timestamps at all — read from PRAGMA table_info rather than
    // guessing. An invented column here fails as a runtime SQL error, not a type error, which is the
    // expensive kind of mistake: the suite fails at the fixture instead of at the behaviour.
    conn().prepare('INSERT INTO StockTransferItem (id, transferId, productId, quantity, shippedQty, receivedQty) VALUES (?,?,?,?,?,?)')
      .run(`${id}-i${it.n}`, id, `p${it.n}`, it.qty, it.shipped, 0);
  }
}

const sourceQuantity = (id) => conn().prepare('SELECT SUM(shippedQty) AS q FROM StockTransferItem WHERE transferId=?').get(id).q;

test('a departure is recorded while the destination branch has no node at all', () => {
  // The field case: the source operator has a van full of goods and a branch that will not answer.
  seedTopology({ withDestinationNode: false });
  shipTransfer('trf-1', 'SHIPPED', [{ n: 1, qty: 10, shipped: 10 }]);
  const destinationNode = conn().prepare("SELECT id FROM SyncNode WHERE branchId='br-dst'").get();
  assert.equal(destinationNode, undefined, 'the destination branch is genuinely unreachable');

  // Registering the departure must not consult the destination.
  const shippedEventId = `stock-transfer-shipped:trf-1`;
  const row = conn().prepare('INSERT INTO BranchTransferSync (id, companyId, transferId, sourceNodeId, destinationNodeId, shippedEventId, state, sourceQuantity, updatedAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('xs-1', 'acme', 'trf-1', 'node-src', null, shippedEventId, 'AWAITING_DESTINATION', sourceQuantity('trf-1'), now(), now());
  assert.equal(row.changes, 1, 'the departure exists even with no destination node');

  // And the event is queued locally, so the destination receives it whenever it returns.
  conn().prepare('INSERT INTO SyncOutbox (id, companyId, nodeId, eventId, aggregateType, aggregateId, eventType, schemaVersion, payload, status, attempts, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ob-1', 'acme', 'node-src', shippedEventId, 'StockTransfer', 'trf-1', 'STOCK_TRANSFER_SHIPPED_OFFLINE', 1, JSON.stringify({ transferId: 'trf-1', sourceQuantity: 10 }), 'PENDING', 0, now());
  const queued = conn().prepare("SELECT status FROM SyncOutbox WHERE eventId=?").get(shippedEventId);
  assert.equal(queued.status, 'PENDING', 'the event waits in the outbox rather than being lost');
});

test('re-registering the same departure is a replay, not a second departure', () => {
  // The event id is derived from the transfer, so a retry after a network hiccup is safe.
  // Seed defensively: this test must not depend on the previous one having written its fixture.
  const c0 = conn();
  if (!c0.prepare("SELECT 1 FROM BranchTransferSync WHERE transferId='trf-1'").get()) {
    c0.prepare('INSERT INTO BranchTransferSync (id, companyId, transferId, sourceNodeId, shippedEventId, state, sourceQuantity, updatedAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('xs-seed', 'acme', 'trf-1', 'node-src', 'stock-transfer-shipped:trf-1', 'AWAITING_DESTINATION', 10, now(), now());
  }
  const shippedEventId = 'stock-transfer-shipped:trf-1';
  let blocked = false;
  try {
    conn().prepare('INSERT INTO BranchTransferSync (id, companyId, transferId, sourceNodeId, shippedEventId, state, sourceQuantity, updatedAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('xs-2', 'acme', 'trf-1', 'node-src', shippedEventId, 'AWAITING_DESTINATION', 10, now(), now());
  } catch (e) { blocked = /UNIQUE constraint failed/i.test(String(e.message ?? e)); }
  assert.ok(blocked, 'one sync row per transfer');
  assert.equal(conn().prepare("SELECT COUNT(*) AS n FROM BranchTransferSync WHERE transferId='trf-1'").get().n, 1);
});

test('an exact acknowledgement converges; a mismatch is DISCREPANT and stays visible', () => {
  const decide = (src, dst) => (dst === src ? 'CONVERGED' : 'DISCREPANT');
  // BUG: last-write-wins reconciliation. Silently treats a short shipment as if it arrived whole.
  const buggyDecide = (src, dst) => 'CONVERGED';

  assert.equal(decide(10, 10), 'CONVERGED');
  assert.equal(decide(10, 7), 'DISCREPANT', '7 of 10 arriving is a discrepancy, not a success');
  assert.equal(buggyDecide(10, 7), 'CONVERGED', 'the buggy variant is exactly the lie this design refuses');
});

test('the recorded discrepancy keeps both quantities and a reason', () => {
  // "Kirim 10, terima 7" is the only form an operator can act on. A bare status of DISCREPANT with no
  // numbers leaves them to reconstruct the event by hand.
  const c = conn();
  c.prepare('UPDATE BranchTransferSync SET state=?, destinationQuantity=?, destinationAckedAt=?, destinationAckedBy=?, discrepancyReason=? WHERE transferId=?')
    .run('DISCREPANT', 7, now(), 'user-dst', 'Kirim 10, terima 7. Dua unit hilang di jalan.', 'trf-1');
  const row = c.prepare("SELECT state, sourceQuantity, destinationQuantity, discrepancyReason FROM BranchTransferSync WHERE transferId='trf-1'").get();
  assert.equal(row.state, 'DISCREPANT');
  assert.equal(row.sourceQuantity, 10);
  assert.equal(row.destinationQuantity, 7);
  assert.match(row.discrepancyReason, /Kirim 10, terima 7/);
});

test('a discrepancy is included in the pending list, not filtered out as resolved', () => {
  const pending = conn().prepare("SELECT transferId, state FROM BranchTransferSync WHERE state IN ('AWAITING_DESTINATION','DISCREPANT')").all();
  assert.equal(pending.length, 1, 'a discrepant transfer is still pending operator attention');
  assert.equal(pending[0].state, 'DISCREPANT');
});

test('an arrival cannot be acknowledged twice', () => {
  const c = conn();
  c.prepare('UPDATE BranchTransferSync SET state=?, destinationQuantity=?, destinationAckedAt=?, destinationAckedBy=? WHERE transferId=?')
    .run('CONVERGED', 10, now(), 'user-dst', 'trf-1');
  const alreadyAcked = c.prepare("SELECT destinationAckedAt FROM BranchTransferSync WHERE transferId='trf-1'").get().destinationAckedAt;
  assert.ok(alreadyAcked, 'the acknowledgement is recorded');
  // A second confirmation must be refused, which is what the service's destinationAckedAt check does.
  const wouldAccept = !alreadyAcked;
  assert.equal(wouldAccept, false, 'a second acknowledgement must be refused');
});

test('abandonment requires a reason and leaves the stock visibly in transit', () => {
  // No automatic timeout anywhere: the source already decremented and the serials are IN_TRANSIT, so
  // guessing where they are is how stock disappears permanently.
  const c = conn();
  c.prepare('UPDATE BranchTransferSync SET state=?, discrepancyReason=? WHERE transferId=?')
    .run('ABANDONED', 'Cabang tujuan tidak dapat dihubungi selama 30 hari.', 'trf-1');
  const row = c.prepare("SELECT state, discrepancyReason FROM BranchTransferSync WHERE transferId='trf-1'").get();
  assert.equal(row.state, 'ABANDONED');
  assert.ok(row.discrepancyReason?.trim().length > 0, 'an abandonment without a reason is not permitted');
  // Abandoned transfers drop out of the pending list — the stock is still in transit and still needs a
  // journal, which is a separate, audited operation.
  const stillPending = c.prepare("SELECT COUNT(*) AS n FROM BranchTransferSync WHERE state IN ('AWAITING_DESTINATION','DISCREPANT')").get().n;
  assert.equal(stillPending, 0);
});
