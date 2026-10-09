import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const path = 'database/migrations/T360-20261009-ppob-paid-fulfillment/';

// Rehearse additive SQL on disposable SQLite schema with the real table name and source columns.
test('SQLite paid-PPOB expand SQL retains historical records, indexes new receipts, and never forces a false paid state', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE "DigitalServiceTransaction" (
      "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "branchId" TEXT NOT NULL,
      "status" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "sellingPrice" DECIMAL NOT NULL
    )`);
    db.prepare('INSERT INTO "DigitalServiceTransaction" (id,companyId,branchId,status,idempotencyKey,sellingPrice) VALUES (?,?,?,?,?,?)')
      .run('legacy-1', 'tenant-a', 'branch-a', 'QUEUED', 'legacy-key', 12000);
    db.exec(read(`${path}sqlite-expand.sql`));
    const row = db.prepare('SELECT * FROM "DigitalServiceTransaction" WHERE id=?').get('legacy-1');
    assert.equal(row.status, 'QUEUED');
    assert.equal(row.paymentAccountingEventId, null);
    assert.equal(row.cashierShiftId, null);
    assert.equal(row.settlementAccountingEventId, null);
    assert.equal(row.refundAccountingEventId, null);
    assert.equal(row.capturedAt, null);
    const columns = db.prepare('PRAGMA table_info("DigitalServiceTransaction")').all().map((entry) => entry.name);
    for (const col of ['capturedAt','settledAt','refundedAt','cashierShiftId','paymentAccountingEventId','settlementAccountingEventId','refundAccountingEventId','refundCashierShiftId']) assert.ok(columns.includes(col), col);
    const indexes = db.prepare('PRAGMA index_list("DigitalServiceTransaction")').all().map((entry) => entry.name);
    assert.ok(indexes.some((name) => name.includes('cashierShiftId_capturedAt')));
    assert.ok(indexes.some((name) => name.includes('refundCashierShiftId_refundedAt')));
    db.prepare(`INSERT INTO "DigitalServiceTransaction" (id,companyId,branchId,status,idempotencyKey,sellingPrice,
      paymentAccountingEventId,capturedAt,cashierShiftId) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('paid-1','tenant-a','branch-a','QUEUED','paid-key',12000,'event-a','2026-10-09','shift-a');
    assert.equal(db.prepare('SELECT cashierShiftId FROM "DigitalServiceTransaction" WHERE paymentAccountingEventId=?').get('event-a').cashierShiftId,'shift-a');
  } finally {
    db.close();
  }
});

test('PostgreSQL paid-PPOB migration is nullable/additive and mirrors the SQLite receipt lifecycle', () => {
  const pg = read(`${path}postgresql-expand.sql`);
  const sqlite = read(`${path}sqlite-expand.sql`);
  const re = /ADD COLUMN "([A-Za-z]+)"/g;
  const extract = (sql) => [...sql.matchAll(re)].map((match) => match[1]).sort();
  assert.deepEqual(extract(pg),extract(sqlite));
  assert.equal(extract(pg).length,8);
  assert.doesNotMatch(pg, /\b(?:DROP|DELETE|TRUNCATE|NOT NULL)\b/i);
  assert.match(pg,/TIMESTAMP\(3\)/);
  assert.match(pg,/CREATE INDEX IF NOT EXISTS/);
});
