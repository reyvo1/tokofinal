import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { backup, DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const migrationDir = path.join(root, 'database', 'migrations', 'T360-20260802-145524-product-supplier-ownership');
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const allowUnresolved = args.includes('--allow-unresolved');
const directDatabase = getArg('--database');
const decisionsFileArg = getArg('--decisions-file');
const outputRoot = path.resolve(root, getArg('--output-dir') ?? 'logs/stage17-product-supplier-ownership');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function resolveSqliteDatabase() {
  if (directDatabase) return path.resolve(root, directDatabase);
  const fileEnv = readEnvFile(path.join(root, '.env'));
  const profile = process.env.DATABASE_PROFILE || fileEnv.DATABASE_PROFILE || 'sqlite';
  if (profile !== 'sqlite') {
    throw new Error('Rehearsal hanya boleh memakai profil SQLite lokal/test. DATABASE_PROFILE harus sqlite.');
  }
  const defaultLocal = path.resolve(root, 'apps', 'api', 'prisma', 'data', 'toko360.db');
  const url = process.env.DATABASE_URL || fileEnv.DATABASE_URL || (fs.existsSync(defaultLocal) ? 'file:./data/toko360.db' : undefined);
  if (!url?.startsWith('file:')) {
    throw new Error('DATABASE_URL SQLite lokal tidak ditemukan. Gunakan file:... dan jangan memakai URL production.');
  }
  const raw = decodeURIComponent(url.slice('file:'.length));
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(root, 'apps', 'api', 'prisma', raw);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => String(row.name));
}

function tableIndexes(db, table) {
  return db.prepare(`PRAGMA index_list("${table}")`).all().map((row) => String(row.name));
}

function scalar(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  if (!row) return 0;
  return Number(Object.values(row)[0] ?? 0);
}

function queryRows(db, sql, params = []) {
  return db.prepare(sql).all(...params).map((row) => ({ ...row }));
}

function allTableCounts(db) {
  const tables = queryRows(db, `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => {
    const escaped = table.replaceAll('"', '""');
    return [table, scalar(db, `SELECT COUNT(*) FROM "${escaped}"`)];
  }));
}

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function loadDecisions() {
  if (!decisionsFileArg) {
    return { source: null, productAssignments: [], supplierAssignments: [] };
  }
  const file = path.resolve(root, decisionsFileArg);
  if (!fs.existsSync(file)) throw new Error(`File keputusan ownership tidak ditemukan: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed.version !== 1) throw new Error('Versi file keputusan ownership harus 1.');
  const productAssignments = Array.isArray(parsed.productAssignments) ? parsed.productAssignments : [];
  const supplierAssignments = Array.isArray(parsed.supplierAssignments) ? parsed.supplierAssignments : [];
  return {
    source: path.relative(root, file).replaceAll('\\', '/'),
    productAssignments,
    supplierAssignments,
  };
}

function companyRecord(db, companyId) {
  const columns = tableColumns(db, 'Company');
  const fields = ['id', 'name', 'slug', 'code'].filter((field) => columns.includes(field));
  return db.prepare(`SELECT ${fields.map((field) => `"${field}"`).join(', ')} FROM "Company" WHERE "id" = ?`).get(companyId);
}

function assertExpected(record, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    if (value === undefined || value === null) continue;
    if (!(field in record)) throw new Error(`${label}: kolom ${field} tidak tersedia untuk verifikasi keputusan.`);
    if (String(record[field] ?? '') !== String(value)) {
      throw new Error(`${label}: nilai ${field} tidak cocok. Diharapkan ${value}, ditemukan ${record[field] ?? 'null'}.`);
    }
  }
}

function candidateCount(db, entity, id) {
  if (entity === 'Product') {
    return scalar(db, `${productCandidatesCte}
      SELECT COUNT(DISTINCT "companyId") FROM product_candidates WHERE "productId" = ?`, [id]);
  }
  return scalar(db, `${supplierCandidatesCte}
    SELECT COUNT(DISTINCT "companyId") FROM supplier_candidates WHERE "supplierId" = ?`, [id]);
}

function applyManualDecisions(db, decisions) {
  const applied = [];
  const alreadyApplied = [];
  const assignments = [
    ...decisions.productAssignments.map((item) => ({ ...item, entity: 'Product' })),
    ...decisions.supplierAssignments.map((item) => ({ ...item, entity: 'Supplier' })),
  ];
  const companyCount = scalar(db, 'SELECT COUNT(*) FROM "Company"');
  for (const assignment of assignments) {
    const idField = assignment.entity === 'Product' ? 'productId' : 'supplierId';
    const entityId = assignment[idField];
    if (!entityId || !assignment.companyId) {
      throw new Error(`Keputusan ${assignment.entity} wajib memuat ${idField} dan companyId.`);
    }
    const table = assignment.entity;
    const columns = tableColumns(db, table);
    const selectFields = ['id', 'companyId', 'name', assignment.entity === 'Product' ? 'sku' : 'code']
      .filter((field, index, all) => columns.includes(field) && all.indexOf(field) === index);
    const record = db.prepare(
      `SELECT ${selectFields.map((field) => `"${field}"`).join(', ')} FROM "${table}" WHERE "id" = ?`,
    ).get(entityId);
    if (!record) throw new Error(`Keputusan ${assignment.entity}: record ${entityId} tidak ditemukan.`);

    const company = companyRecord(db, assignment.companyId);
    if (!company) throw new Error(`Keputusan ${assignment.entity}: company ${assignment.companyId} tidak ditemukan.`);

    assertExpected(record, {
      name: assignment.expectedName,
      sku: assignment.expectedSku,
      code: assignment.expectedCode,
    }, `${assignment.entity} ${entityId}`);
    assertExpected(company, {
      name: assignment.expectedCompanyName,
      slug: assignment.expectedCompanySlug,
      code: assignment.expectedCompanyCode,
    }, `Company ${assignment.companyId}`);

    if (assignment.requireOnlyCompany === true && companyCount !== 1) {
      throw new Error(`Keputusan ${assignment.entity}: requireOnlyCompany aktif tetapi database memiliki ${companyCount} company.`);
    }
    const candidates = candidateCount(db, assignment.entity, entityId);
    if (assignment.requireNoTransactionCandidate === true && candidates !== 0) {
      throw new Error(`Keputusan ${assignment.entity}: diharapkan tanpa kandidat transaksi, tetapi ditemukan ${candidates} kandidat company.`);
    }

    if (record.companyId && String(record.companyId) !== String(assignment.companyId)) {
      throw new Error(`Keputusan ${assignment.entity}: ownership existing ${record.companyId} berbeda dari keputusan ${assignment.companyId}.`);
    }
    const evidenceItem = {
      entity: assignment.entity,
      entityId,
      companyId: assignment.companyId,
      decision: assignment.decision ?? 'ADMIN_EXPLICIT',
      rationale: assignment.rationale ?? null,
      transactionCandidateCount: candidates,
    };
    if (record.companyId) {
      alreadyApplied.push(evidenceItem);
      continue;
    }
    db.prepare(`UPDATE "${table}" SET "companyId" = ? WHERE "id" = ? AND "companyId" IS NULL`)
      .run(assignment.companyId, entityId);
    applied.push(evidenceItem);
  }
  return {
    source: decisions.source,
    requested: assignments.length,
    applied,
    alreadyApplied,
  };
}

const productCandidatesCte = `
WITH product_candidates("productId", "companyId") AS (
  SELECT i."productId", b."companyId"
  FROM "Inventory" i
  JOIN "Warehouse" w ON w."id" = i."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT poi."productId", b."companyId"
  FROM "PurchaseOrderItem" poi
  JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
  JOIN "Warehouse" w ON w."id" = po."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT gri."productId", b."companyId"
  FROM "GoodsReceiptItem" gri
  JOIN "GoodsReceipt" gr ON gr."id" = gri."goodsReceiptId"
  JOIN "Warehouse" w ON w."id" = gr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT si."productId", b."companyId"
  FROM "SaleItem" si
  JOIN "Sale" s ON s."id" = si."saleId"
  JOIN "Branch" b ON b."id" = s."branchId"
  UNION
  SELECT oi."productId", b."companyId"
  FROM "OrderItem" oi
  JOIN "Order" o ON o."id" = oi."orderId"
  JOIN "Branch" b ON b."id" = o."branchId"
)
`;

const supplierCandidatesCte = `
WITH supplier_candidates("supplierId", "companyId") AS (
  SELECT po."supplierId", b."companyId"
  FROM "PurchaseOrder" po
  JOIN "Warehouse" w ON w."id" = po."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT gr."supplierId", b."companyId"
  FROM "GoodsReceipt" gr
  JOIN "Warehouse" w ON w."id" = gr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT pr."supplierId", b."companyId"
  FROM "PurchaseReturn" pr
  JOIN "Warehouse" w ON w."id" = pr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
)
`;

function collectEvidence(db) {
  const expectedIndexes = [
    'Product_companyId_isActive_name_id_idx',
    'Product_companyId_sku_idx',
    'Supplier_companyId_name_id_idx',
    'Supplier_companyId_code_idx',
  ];
  const actualIndexes = [...tableIndexes(db, 'Product'), ...tableIndexes(db, 'Supplier')];
  const missingIndexes = expectedIndexes.filter((name) => !actualIndexes.includes(name));
  const productCandidates = queryRows(db, `${productCandidatesCte}
    SELECT "productId", COUNT(DISTINCT "companyId") AS "candidateCount",
           MIN("companyId") AS "singleCompanyId"
    FROM product_candidates GROUP BY "productId" ORDER BY "productId"`);
  const supplierCandidates = queryRows(db, `${supplierCandidatesCte}
    SELECT "supplierId", COUNT(DISTINCT "companyId") AS "candidateCount",
           MIN("companyId") AS "singleCompanyId"
    FROM supplier_candidates GROUP BY "supplierId" ORDER BY "supplierId"`);
  const foreignKeyViolations = queryRows(db, 'PRAGMA foreign_key_check');
  const integrity = String(db.prepare('PRAGMA integrity_check').get().integrity_check ?? 'unknown');
  const productPlan = queryRows(db,
    'EXPLAIN QUERY PLAN SELECT "id" FROM "Product" WHERE "companyId" = ? AND "isActive" = 1 ORDER BY "name", "id" LIMIT 50',
    ['__stage17_company__'],
  ).map((row) => String(row.detail ?? ''));
  const supplierPlan = queryRows(db,
    'EXPLAIN QUERY PLAN SELECT "id" FROM "Supplier" WHERE "companyId" = ? ORDER BY "name", "id" LIMIT 50',
    ['__stage17_company__'],
  ).map((row) => String(row.detail ?? ''));

  return {
    products: {
      total: scalar(db, 'SELECT COUNT(*) FROM "Product"'),
      owned: scalar(db, 'SELECT COUNT(*) FROM "Product" WHERE "companyId" IS NOT NULL'),
      unresolved: scalar(db, 'SELECT COUNT(*) FROM "Product" WHERE "companyId" IS NULL'),
      multiCompanyCandidates: productCandidates.filter((row) => Number(row.candidateCount) > 1).length,
      noCandidate: scalar(db, `${productCandidatesCte}
        SELECT COUNT(*) FROM "Product" p
        WHERE p."companyId" IS NULL
          AND NOT EXISTS (SELECT 1 FROM product_candidates pc WHERE pc."productId" = p."id")`),
      ownershipMismatches: scalar(db, `${productCandidatesCte}
        SELECT COUNT(DISTINCT p."id")
        FROM "Product" p JOIN product_candidates pc ON pc."productId" = p."id"
        WHERE p."companyId" IS NOT NULL AND p."companyId" <> pc."companyId"`),
    },
    suppliers: {
      total: scalar(db, 'SELECT COUNT(*) FROM "Supplier"'),
      owned: scalar(db, 'SELECT COUNT(*) FROM "Supplier" WHERE "companyId" IS NOT NULL'),
      unresolved: scalar(db, 'SELECT COUNT(*) FROM "Supplier" WHERE "companyId" IS NULL'),
      multiCompanyCandidates: supplierCandidates.filter((row) => Number(row.candidateCount) > 1).length,
      noCandidate: scalar(db, `${supplierCandidatesCte}
        SELECT COUNT(*) FROM "Supplier" s
        WHERE s."companyId" IS NULL
          AND NOT EXISTS (SELECT 1 FROM supplier_candidates sc WHERE sc."supplierId" = s."id")`),
      ownershipMismatches: scalar(db, `${supplierCandidatesCte}
        SELECT COUNT(DISTINCT s."id")
        FROM "Supplier" s JOIN supplier_candidates sc ON sc."supplierId" = s."id"
        WHERE s."companyId" IS NOT NULL AND s."companyId" <> sc."companyId"`),
    },
    integrity,
    foreignKeyViolations,
    indexes: { expected: expectedIndexes, missing: missingIndexes },
    queryPlans: { product: productPlan, supplier: supplierPlan },
  };
}

function summaryMarkdown(evidence) {
  const status = evidence.gate.passed ? 'PASSED' : 'BLOCKED';
  return `# Stage 17 — Product/Supplier Ownership Migration Rehearsal\n\n` +
    `- Status: **${status}**\n` +
    `- Generated: ${evidence.generatedAt}\n` +
    `- Source database: ${evidence.sourceDatabase}\n` +
    `- Source SHA-256: \`${evidence.sourceSha256}\`\n` +
    `- Restore test: ${evidence.restoreTest.passed ? 'passed' : 'failed'}\n` +
    `- Product unresolved: ${evidence.after.products.unresolved}\n` +
    `- Supplier unresolved: ${evidence.after.suppliers.unresolved}\n` +
    `- Product ownership mismatch: ${evidence.after.products.ownershipMismatches}\n` +
    `- Supplier ownership mismatch: ${evidence.after.suppliers.ownershipMismatches}\n` +
    `- Missing indexes: ${evidence.after.indexes.missing.length}\n` +
    `- Foreign-key violations: ${evidence.after.foreignKeyViolations.length}\n` +
    `- Backfill + keputusan administratif idempotent: ${evidence.backfillIdempotent ? 'yes' : 'no'}\n` +
    `- Keputusan ownership eksplisit: ${evidence.manualDecisions.first.applied.length + evidence.manualDecisions.first.alreadyApplied.length}\n\n` +
    `Database sumber tidak diubah. Expand, backfill, dan keputusan administratif hanya dijalankan pada salinan rehearsal.\n`;
}

const sourceDbPath = resolveSqliteDatabase();
if (!fs.existsSync(sourceDbPath)) throw new Error(`Database SQLite lokal/test tidak ditemukan: ${sourceDbPath}`);
if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error('Stage 17 memerlukan Node.js 22 LTS karena menggunakan SQLite backup API bawaan untuk snapshot konsisten.');
}
for (const file of ['sqlite-expand.sql', 'sqlite-backfill.sql']) {
  if (!fs.existsSync(path.join(migrationDir, file))) throw new Error(`Migration file tidak ditemukan: ${file}`);
}

const runId = timestamp();
const runDir = path.join(outputRoot, runId);
fs.mkdirSync(runDir, { recursive: true });
const restorePointPath = path.join(runDir, 'restore-point.db');
const rehearsalPath = path.join(runDir, 'migration-rehearsal.db');
const restoreTestPath = path.join(runDir, 'restore-test.db');

const source = new DatabaseSync(sourceDbPath, { readOnly: true });
try {
  await backup(source, restorePointPath);
  await backup(source, rehearsalPath);
} finally {
  source.close();
}

const restorePoint = new DatabaseSync(restorePointPath, { readOnly: true });
try {
  await backup(restorePoint, restoreTestPath);
} finally {
  restorePoint.close();
}
const restored = new DatabaseSync(restoreTestPath, { readOnly: true });
const snapshot = new DatabaseSync(restorePointPath, { readOnly: true });
let restoreTest;
try {
  const originalCounts = allTableCounts(snapshot);
  const restoredCounts = allTableCounts(restored);
  const originalIntegrity = String(snapshot.prepare('PRAGMA integrity_check').get().integrity_check ?? 'unknown');
  const restoredIntegrity = String(restored.prepare('PRAGMA integrity_check').get().integrity_check ?? 'unknown');
  restoreTest = {
    passed: originalIntegrity === 'ok' && restoredIntegrity === 'ok' && sameObject(originalCounts, restoredCounts),
    originalIntegrity,
    restoredIntegrity,
    tableCountsMatch: sameObject(originalCounts, restoredCounts),
  };
} finally {
  restored.close();
  snapshot.close();
}

const decisions = loadDecisions();
const db = new DatabaseSync(rehearsalPath);
let before;
let afterFirst;
let afterSecond;
let manualFirst;
let manualSecond;
let expanded = false;
try {
  db.exec('PRAGMA foreign_keys = ON;');
  const productHasCompany = tableColumns(db, 'Product').includes('companyId');
  const supplierHasCompany = tableColumns(db, 'Supplier').includes('companyId');
  if (productHasCompany !== supplierHasCompany) {
    throw new Error('Schema source berada pada kondisi expand parsial: hanya salah satu Product/Supplier memiliki companyId.');
  }
  before = {
    productHasCompany,
    supplierHasCompany,
    products: scalar(db, 'SELECT COUNT(*) FROM "Product"'),
    suppliers: scalar(db, 'SELECT COUNT(*) FROM "Supplier"'),
  };
  if (!productHasCompany) {
    db.exec(fs.readFileSync(path.join(migrationDir, 'sqlite-expand.sql'), 'utf8'));
    expanded = true;
  } else {
    db.exec(`
      CREATE INDEX IF NOT EXISTS "Product_companyId_isActive_name_id_idx" ON "Product"("companyId", "isActive", "name", "id");
      CREATE INDEX IF NOT EXISTS "Product_companyId_sku_idx" ON "Product"("companyId", "sku");
      CREATE INDEX IF NOT EXISTS "Supplier_companyId_name_id_idx" ON "Supplier"("companyId", "name", "id");
      CREATE INDEX IF NOT EXISTS "Supplier_companyId_code_idx" ON "Supplier"("companyId", "code");
    `);
  }
  const backfillSql = fs.readFileSync(path.join(migrationDir, 'sqlite-backfill.sql'), 'utf8');
  db.exec(backfillSql);
  manualFirst = applyManualDecisions(db, decisions);
  afterFirst = collectEvidence(db);
  db.exec(backfillSql);
  manualSecond = applyManualDecisions(db, decisions);
  afterSecond = collectEvidence(db);
} finally {
  db.close();
}

const backfillIdempotent = JSON.stringify({ products: afterFirst.products, suppliers: afterFirst.suppliers }) ===
  JSON.stringify({ products: afterSecond.products, suppliers: afterSecond.suppliers }) &&
  manualSecond.applied.length === 0;
const blockingReasons = [];
if (!restoreTest.passed) blockingReasons.push('restore-test-failed');
if (afterSecond.integrity !== 'ok') blockingReasons.push('sqlite-integrity-failed');
if (afterSecond.foreignKeyViolations.length) blockingReasons.push('foreign-key-violations');
if (afterSecond.indexes.missing.length) blockingReasons.push('missing-required-index');
if (!backfillIdempotent) blockingReasons.push('backfill-not-idempotent');
if (afterSecond.products.ownershipMismatches || afterSecond.suppliers.ownershipMismatches) blockingReasons.push('ownership-mismatch');
if (!allowUnresolved && (afterSecond.products.unresolved || afterSecond.suppliers.unresolved)) blockingReasons.push('unresolved-ownership');

const evidence = {
  workItem: 'T360-20260802-145524',
  stage: 17,
  generatedAt: new Date().toISOString(),
  sourceDatabase: path.relative(root, sourceDbPath).replaceAll('\\', '/'),
  sourceSha256: sha256(sourceDbPath),
  databaseMutation: 'none; migration executed only on snapshot copy',
  runDirectory: path.relative(root, runDir).replaceAll('\\', '/'),
  expanded,
  before,
  afterFirst,
  after: afterSecond,
  restoreTest,
  backfillIdempotent,
  manualDecisions: { first: manualFirst, second: manualSecond },
  gate: { passed: blockingReasons.length === 0, allowUnresolved, blockingReasons },
};
fs.writeFileSync(path.join(runDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
fs.writeFileSync(path.join(runDir, 'evidence.md'), summaryMarkdown(evidence));
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, 'latest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, 'latest.md'), summaryMarkdown(evidence));

console.log(`Stage 17 rehearsal: ${evidence.gate.passed ? 'PASSED' : 'BLOCKED'}`);
console.log(`Product unresolved: ${afterSecond.products.unresolved}`);
console.log(`Supplier unresolved: ${afterSecond.suppliers.unresolved}`);
console.log(`Restore test: ${restoreTest.passed ? 'PASSED' : 'FAILED'}`);
console.log(`Evidence: ${path.relative(root, path.join(outputRoot, 'latest.md'))}`);
if (!evidence.gate.passed) {
  console.error(`Blocking reasons: ${blockingReasons.join(', ')}`);
  process.exit(2);
}
