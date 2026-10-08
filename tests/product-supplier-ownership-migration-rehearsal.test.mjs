import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const script = path.join(root, 'scripts', 'rehearse-product-supplier-ownership.mjs');

function createFixture(file, { conflict = false, supplierWithoutCandidate = false } = {}) {
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE "Company" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL);
      CREATE TABLE "Branch" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, FOREIGN KEY("companyId") REFERENCES "Company"("id"));
      CREATE TABLE "Warehouse" ("id" TEXT PRIMARY KEY, "branchId" TEXT NOT NULL, FOREIGN KEY("branchId") REFERENCES "Branch"("id"));
      CREATE TABLE "Product" ("id" TEXT PRIMARY KEY, "sku" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "isActive" INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE "Supplier" ("id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL);
      CREATE TABLE "Inventory" ("id" TEXT PRIMARY KEY, "warehouseId" TEXT NOT NULL, "productId" TEXT NOT NULL);
      CREATE TABLE "PurchaseOrder" ("id" TEXT PRIMARY KEY, "warehouseId" TEXT NOT NULL, "supplierId" TEXT NOT NULL);
      CREATE TABLE "PurchaseOrderItem" ("id" TEXT PRIMARY KEY, "purchaseOrderId" TEXT NOT NULL, "productId" TEXT NOT NULL);
      CREATE TABLE "GoodsReceipt" ("id" TEXT PRIMARY KEY, "warehouseId" TEXT NOT NULL, "supplierId" TEXT NOT NULL);
      CREATE TABLE "GoodsReceiptItem" ("id" TEXT PRIMARY KEY, "goodsReceiptId" TEXT NOT NULL, "productId" TEXT NOT NULL);
      CREATE TABLE "Sale" ("id" TEXT PRIMARY KEY, "branchId" TEXT NOT NULL);
      CREATE TABLE "SaleItem" ("id" TEXT PRIMARY KEY, "saleId" TEXT NOT NULL, "productId" TEXT NOT NULL);
      CREATE TABLE "Order" ("id" TEXT PRIMARY KEY, "branchId" TEXT NOT NULL);
      CREATE TABLE "OrderItem" ("id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL, "productId" TEXT NOT NULL);
      CREATE TABLE "PurchaseReturn" ("id" TEXT PRIMARY KEY, "warehouseId" TEXT NOT NULL, "supplierId" TEXT NOT NULL);
      INSERT INTO "Company" VALUES ('c1', 'Company 1');
      INSERT INTO "Branch" VALUES ('b1', 'c1');
      INSERT INTO "Warehouse" VALUES ('w1', 'b1');
      INSERT INTO "Product" VALUES ('p1', 'SKU-1', 'Product 1', 1);
      INSERT INTO "Supplier" VALUES ('s1', 'SUP-1', 'Supplier 1');
      INSERT INTO "Inventory" VALUES ('i1', 'w1', 'p1');
      INSERT INTO "PurchaseOrder" VALUES ('po1', 'w1', 's1');
      INSERT INTO "PurchaseOrderItem" VALUES ('poi1', 'po1', 'p1');
    `);
    if (supplierWithoutCandidate) {
      db.exec(`
        DELETE FROM "PurchaseOrderItem";
        DELETE FROM "PurchaseOrder";
      `);
    }
    if (conflict) {
      db.exec(`
        INSERT INTO "Company" VALUES ('c2', 'Company 2');
        INSERT INTO "Branch" VALUES ('b2', 'c2');
        INSERT INTO "Warehouse" VALUES ('w2', 'b2');
        INSERT INTO "Inventory" VALUES ('i2', 'w2', 'p1');
        DELETE FROM "PurchaseOrderItem";
        DELETE FROM "PurchaseOrder";
      `);
    }
  } finally {
    db.close();
  }
}

function runRehearsal(database, outputDir, extra = []) {
  return spawnSync(process.execPath, [script, '--database', database, '--output-dir', outputDir, ...extra], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

test('SQLite ownership rehearsal migrates only a snapshot and reaches zero unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't360-stage17-zero-'));
  const database = path.join(dir, 'source.db');
  const output = path.join(dir, 'evidence');
  createFixture(database);

  const result = runRehearsal(database, output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(fs.readFileSync(path.join(output, 'latest.json'), 'utf8'));
  assert.equal(evidence.gate.passed, true);
  assert.equal(evidence.after.products.unresolved, 0);
  assert.equal(evidence.after.suppliers.unresolved, 0);
  assert.equal(evidence.restoreTest.passed, true);
  assert.equal(evidence.backfillIdempotent, true);

  const source = new DatabaseSync(database, { readOnly: true });
  try {
    const productColumns = source.prepare('PRAGMA table_info("Product")').all().map((row) => row.name);
    const supplierColumns = source.prepare('PRAGMA table_info("Supplier")').all().map((row) => row.name);
    assert.equal(productColumns.includes('companyId'), false);
    assert.equal(supplierColumns.includes('companyId'), false);
  } finally {
    source.close();
  }
});

test('SQLite ownership rehearsal keeps multi-company and no-candidate records unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't360-stage17-conflict-'));
  const database = path.join(dir, 'source.db');
  const output = path.join(dir, 'evidence');
  createFixture(database, { conflict: true });

  const result = runRehearsal(database, output, ['--allow-unresolved']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(fs.readFileSync(path.join(output, 'latest.json'), 'utf8'));
  assert.equal(evidence.after.products.unresolved, 1);
  assert.equal(evidence.after.products.multiCompanyCandidates, 1);
  assert.equal(evidence.after.suppliers.unresolved, 1);
  assert.equal(evidence.after.suppliers.noCandidate, 1);
  assert.equal(evidence.after.products.ownershipMismatches, 0);
  assert.equal(evidence.after.suppliers.ownershipMismatches, 0);
});

test('SQLite ownership rehearsal applies an explicit validated supplier decision only on snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't360-stage17-decision-'));
  const database = path.join(dir, 'source.db');
  const output = path.join(dir, 'evidence');
  const decisions = path.join(dir, 'decisions.json');
  createFixture(database, { supplierWithoutCandidate: true });
  fs.writeFileSync(decisions, `${JSON.stringify({
    version: 1,
    productAssignments: [],
    supplierAssignments: [{
      supplierId: 's1',
      expectedCode: 'SUP-1',
      expectedName: 'Supplier 1',
      companyId: 'c1',
      expectedCompanyName: 'Company 1',
      requireOnlyCompany: true,
      requireNoTransactionCandidate: true,
      decision: 'ADMIN_EXPLICIT_SINGLE_AVAILABLE_COMPANY_NO_TRANSACTION_EVIDENCE',
      rationale: 'Fixture reconciliation decision.',
    }],
  }, null, 2)}\n`);

  const result = runRehearsal(database, output, ['--decisions-file', decisions]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(fs.readFileSync(path.join(output, 'latest.json'), 'utf8'));
  assert.equal(evidence.gate.passed, true);
  assert.equal(evidence.after.suppliers.unresolved, 0);
  assert.equal(evidence.manualDecisions.first.applied.length, 1);
  assert.equal(evidence.manualDecisions.second.applied.length, 0);
  assert.equal(evidence.manualDecisions.second.alreadyApplied.length, 1);
  assert.equal(evidence.backfillIdempotent, true);

  const source = new DatabaseSync(database, { readOnly: true });
  try {
    const supplierColumns = source.prepare('PRAGMA table_info("Supplier")').all().map((row) => row.name);
    assert.equal(supplierColumns.includes('companyId'), false);
  } finally {
    source.close();
  }
});
