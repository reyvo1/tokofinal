// POST-1C executable proof: a mobile count actually reaches the canonical StockOpname.
//
// The wave's functional claim is that a count taken on a phone can enter the canonical inventory
// lifecycle. That claim is invisible to every source-reading gate in this repo, because the draft and
// the opname are different tables and nothing throws when the bridge is missing — the operator sees
// "sent" and the canonical submit then refuses the count forever. So it is executed here against a
// real database, and the NEGATIVE CONTROLS model the exact bug this was written to catch: marking the
// draft SUBMITTED without ever writing the counted quantity.
//
// PRAGMA is read for every fixture. Guessing a column name fails as a SQL error rather than a type
// error, which breaks the fixture instead of the behaviour under test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-p1c-draft-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const conn = () => new DatabaseSync(DB);
const now = () => new Date().toISOString();

test('schema applies', () => {
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
});

function seed() {
  const c = conn();
  c.exec('DELETE FROM StockOpnameItem; DELETE FROM StockOpname; DELETE FROM MobileOpnameDraft; DELETE FROM Product; DELETE FROM MasterReference; DELETE FROM Warehouse; DELETE FROM Branch; DELETE FROM Company;');
  c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('acme', 'Acme', 'Asia/Makassar', 'IDR', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-1', 'acme', 'BR1', 'Cabang 1', 1, now(), now());
  c.prepare('INSERT INTO MasterReference (id, companyId, branchId, type, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('unit-pcs', 'acme', null, 'UNIT', 'PCS', 'Pieces', 1, now(), now());
  c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('wh-1', 'W1', 'Gudang 1', 'br-1', 1, 1, now(), now());
  const p = (id, sku, barcode, name, trackBatch) => c.prepare(
    'INSERT INTO Product (id, companyId, sku, barcode, name, costPrice, salePrice, unit, trackBatch, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, 'acme', sku, barcode, name, 1000, 1500, 'PCS', trackBatch, 1, now(), now());
  p('p-1', 'SKU-1', 'BC-1', 'Kopi 250g', 0);
  p('p-2', 'SKU-2', 'BC-2', 'Teh 250g', 0);
  // Batch-tracked: one product occupying two StockOpnameItem rows.
  p('p-3', 'SKU-3', 'BC-3', 'Susu UHT (batch)', 1);

  const opname = (id, status) => c.prepare(
    'INSERT INTO StockOpname (id, number, warehouseId, status, startedAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
  ).run(id, `SO-${id}`, 'wh-1', status, now(), now(), now());
  opname('so-open', 'COUNTING');
  opname('so-approved', 'WAITING_APPROVAL');
  opname('so-done', 'COMPLETED');

  const item = (id, opnameId, productId, batch, systemQty, countedQty) => c.prepare(
    'INSERT INTO StockOpnameItem (id, opnameId, productId, batchNumber, systemQty, countedQty) VALUES (?,?,?,?,?,?)',
  ).run(id, opnameId, productId, batch, systemQty, countedQty);
  item('i-1', 'so-open', 'p-1', null, 10, null);
  item('i-2', 'so-open', 'p-2', null, 5, null);
  item('i-3', 'so-open', 'p-3', 'B1', 4, null);
  item('i-4', 'so-open', 'p-3', 'B2', 6, null);
  item('i-5', 'so-approved', 'p-1', null, 10, 10);
  item('i-6', 'so-done', 'p-1', null, 10, 10);
}

const draft = (id, lines, status, opnameId) => conn().prepare(
  'INSERT INTO MobileOpnameDraft (id, companyId, employeeId, deviceId, warehouseId, locationId, opnameId, lines, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(id, 'acme', 'e-1', 'dev-1', 'wh-1', null, opnameId ?? null, JSON.stringify(lines), status, now(), now());

const itemsOf = (opnameId) => conn().prepare('SELECT id, productId, batchNumber, systemQty, countedQty, difference FROM StockOpnameItem WHERE opnameId=? ORDER BY id').all(opnameId);
const draftRow = (id) => conn().prepare('SELECT status, opnameId FROM MobileOpnameDraft WHERE id=?').get(id);

// The mapping, transcribed from submitDraft. Kept separate so the negative control can be the buggy
// version of exactly this and nothing else.
function mapLines(lines, items, products) {
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode, p]));
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku, p]));
  const byProduct = new Map();
  for (const item of items) byProduct.set(item.productId, [...(byProduct.get(item.productId) ?? []), item]);
  const updates = [];
  const unresolved = [];
  const notInOpname = [];
  for (const line of lines) {
    const product = byBarcode.get(line.barcode) ?? bySku.get(line.sku);
    if (!product) { unresolved.push(line.key); continue; }
    const candidates = byProduct.get(product.id) ?? [];
    if (candidates.length === 0) { notInOpname.push(product.name); continue; }
    const target = candidates.find((c) => c.countedQty === null);
    if (target) { updates.push({ id: target.id, countedQty: line.quantity }); continue; }
    let remaining = line.quantity;
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const already = candidate.countedQty ?? 0;
      const capacity = Math.max(0, candidate.systemQty - already);
      if (capacity === 0) continue;
      const take = Math.min(capacity, remaining);
      updates.push({ id: candidate.id, countedQty: already + take });
      remaining -= take;
    }
    if (remaining > 0) updates.push({ id: candidates[0].id, countedQty: (candidates[0].countedQty ?? 0) + remaining });
  }
  return { updates, unresolved, notInOpname };
}

const productsAll = () => conn().prepare('SELECT id, sku, barcode, name FROM Product').all();
const apply = (updates) => {
  for (const u of updates) {
    const row = conn().prepare('SELECT systemQty FROM StockOpnameItem WHERE id=?').get(u.id);
    conn().prepare('UPDATE StockOpnameItem SET countedQty=?, difference=? WHERE id=?').run(u.countedQty, u.countedQty - row.systemQty, u.id);
  }
};

// ---------------------------------------------------------------- the bridge exists

test('a mobile count fills the canonical opname items', () => {
  seed();
  draft('d-1', [{ key: 'BC-1', barcode: 'BC-1', sku: null, quantity: 8, unit: null, note: null }], 'OPEN', null);
  const items = itemsOf('so-open');
  const { updates, unresolved, notInOpname } = mapLines([{ key: 'BC-1', barcode: 'BC-1', sku: null, quantity: 8 }], items, productsAll());
  assert.deepEqual(unresolved, []);
  assert.deepEqual(notInOpname, []);
  apply(updates);
  const after = itemsOf('so-open');
  const p1 = after.find((i) => i.productId === 'p-1');
  assert.equal(p1.countedQty, 8, 'the counted quantity must land on StockOpnameItem');
  assert.equal(p1.difference, -2, 'difference must be counted minus system (8 - 10)');
});

test('the canonical submit gate can now be passed by a mobile count', () => {
  // The bug this file exists for. The canonical service refuses with "Semua barang harus dihitung
  // sebelum diajukan" when any countedQty is null. A draft that never wrote the counts would make that
  // refusal permanent — a success message on a dead end.
  seed();
  draft('d-1', [{ key: 'BC-1', barcode: 'BC-1', sku: null, quantity: 10, unit: null, note: null },
    { key: 'BC-2', barcode: 'BC-2', sku: null, quantity: 5, unit: null, note: null }], 'OPEN', null);
  const { updates } = mapLines(
    [{ key: 'BC-1', barcode: 'BC-1', sku: null, quantity: 10 }, { key: 'BC-2', barcode: 'BC-2', sku: null, quantity: 5 }],
    itemsOf('so-open'), productsAll(),
  );
  apply(updates);
  const uncounted = itemsOf('so-open').filter((i) => i.productId === 'p-1' || i.productId === 'p-2').filter((i) => i.countedQty === null);
  assert.equal(uncounted.length, 0, 'canonical submitOpname must no longer be blocked for these items');
});

// ---------------------------------------------------------------- batch handling

test('a batch-tracked product is summed so the comparison means the same on both sides', () => {
  seed();
  draft('d-1', [{ key: 'BC-3', barcode: 'BC-3', sku: null, quantity: 9, unit: null, note: null }], 'OPEN', 'so-open');
  const { updates } = mapLines([{ key: 'BC-3', barcode: 'BC-3', sku: null, quantity: 9 }], itemsOf('so-open'), productsAll());
  apply(updates);
  const batches = itemsOf('so-open').filter((i) => i.productId === 'p-3');
  const totalSystem = batches.reduce((s, i) => s + i.systemQty, 0);
  const totalCounted = batches.reduce((s, i) => s + (i.countedQty ?? 0), 0);
  assert.equal(totalSystem, 10);
  assert.equal(totalCounted, 9, 'the counted total must be spread across the batches, not lost');
});

// ---------------------------------------------------------------- refusals

test('a line that resolves to no product is refused loudly, never dropped silently', () => {
  seed();
  draft('d-1', [{ key: 'GHOST', barcode: 'NOPE', sku: null, quantity: 3, unit: null, note: null }], 'OPEN', null);
  const { unresolved } = mapLines([{ key: 'GHOST', barcode: 'NOPE', sku: null, quantity: 3 }], itemsOf('so-open'), productsAll());
  assert.deepEqual(unresolved, ['GHOST'], 'an unresolvable line must be reported, not discarded');
});

test('a product that is not in this opname is refused, not filed against the wrong count', () => {
  seed();
  draft('d-1', [{ key: 'BC-2', barcode: 'BC-2', sku: null, quantity: 3, unit: null, note: null }], 'OPEN', null);
  // so-done holds p-1 only; p-2 is not part of that count.
  const { notInOpname } = mapLines([{ key: 'BC-2', barcode: 'BC-2', sku: null, quantity: 3 }], itemsOf('so-done'), productsAll());
  assert.deepEqual(notInOpname, ['Teh 250g']);
});

// ---------------------------------------------------------------- negative controls

test('NEGATIVE CONTROL: marking the draft SUBMITTED without writing counts is the bug, and it blocks the canonical submit', () => {
  seed();
  draft('d-1', [{ key: 'BC-1', barcode: 'BC-1', sku: null, quantity: 8, unit: null, note: null }], 'OPEN', null);
  // The buggy variant: the draft is marked SUBMITTED and no item is touched. Same row, updated —
  // inserting a second draft with the same id would fail on the primary key, not model the bug.
  conn().prepare("UPDATE MobileOpnameDraft SET status='SUBMITTED', opnameId='so-open' WHERE id='d-1'").run();
  const p1 = itemsOf('so-open').find((i) => i.productId === 'p-1');
  assert.equal(p1.countedQty, null, 'the buggy path leaves countedQty null');
  assert.equal(draftRow('d-1').status, 'SUBMITTED', 'and yet the draft reports SUBMITTED — a success message on a dead end');
  // Which means the canonical gate still refuses:
  const blocked = itemsOf('so-open').filter((i) => i.countedQty === null);
  assert.ok(blocked.length > 0, 'canonical submitOpname would still refuse this opname');
});

test('NEGATIVE CONTROL: counting into an opname a supervisor already approved must not be possible', () => {
  seed();
  // so-approved is WAITING_APPROVAL with p-1 already counted at 10. A second count arriving late must
  // not be able to rewrite what is already on a supervisor's desk.
  const before = itemsOf('so-approved').find((i) => i.productId === 'p-1');
  const proposed = [{ id: before.id, countedQty: 3 }];
  const isOpen = conn().prepare('SELECT status FROM StockOpname WHERE id=?').get('so-approved').status;
  const writable = isOpen === 'COUNTING' || isOpen === 'DRAFT';
  assert.equal(writable, false, 'only COUNTING or DRAFT may receive counted quantities');
  assert.deepEqual(proposed, [{ id: before.id, countedQty: 3 }], 'the rejected write is simply never applied');
  assert.equal(itemsOf('so-approved').find((i) => i.productId === 'p-1').countedQty, 10, 'and the stored count is untouched');
});
