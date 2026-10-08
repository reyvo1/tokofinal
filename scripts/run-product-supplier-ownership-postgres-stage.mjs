import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const WORK_ITEM = 'T360-20260802-145524';
const STAGE = 18;
const CONFIRM = 'APPLY_T360_STAGE18_NON_PRODUCTION';
const RESTORE_CONFIRM = 'REPLACE_T360_STAGE18_RESTORE_DATABASE';

export function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashIdentifier = (value) => sha256(String(value)).slice(0, 16);
const boolValue = (value, fallback = false) => value == null || value === '' ? fallback : /^(1|true|yes)$/i.test(String(value));

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function parsePostgresUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} tidak valid.`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${label} wajib memakai protokol postgresql:// atau postgres://.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database || !url.username) {
    throw new Error(`${label} wajib memuat host, database, dan user.`);
  }
  return {
    hostname: url.hostname,
    port: url.port || '5432',
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslmode: url.searchParams.get('sslmode') || undefined,
  };
}

export function validateNonProductionConfig(values) {
  const target = String(values.T360_STAGE18_TARGET || '').toUpperCase();
  if (!['TEST', 'STAGING'].includes(target)) throw new Error('T360_STAGE18_TARGET harus TEST atau STAGING.');
  if (values.T360_STAGE18_CONFIRM !== CONFIRM) throw new Error(`T360_STAGE18_CONFIRM harus ${CONFIRM}.`);
  if (values.T360_STAGE18_RESTORE_CONFIRM !== RESTORE_CONFIRM) {
    throw new Error(`T360_STAGE18_RESTORE_CONFIRM harus ${RESTORE_CONFIRM}.`);
  }
  const primary = parsePostgresUrl(values.T360_STAGE18_DATABASE_URL, 'T360_STAGE18_DATABASE_URL');
  const restore = parsePostgresUrl(values.T360_STAGE18_RESTORE_DATABASE_URL, 'T360_STAGE18_RESTORE_DATABASE_URL');
  const expectedHost = values.T360_STAGE18_EXPECTED_HOST;
  const expectedDatabase = values.T360_STAGE18_EXPECTED_DATABASE;
  const expectedRestoreHost = values.T360_STAGE18_EXPECTED_RESTORE_HOST;
  const expectedRestoreDatabase = values.T360_STAGE18_EXPECTED_RESTORE_DATABASE;
  if (!expectedHost || primary.hostname !== expectedHost) throw new Error('Host target tidak cocok dengan T360_STAGE18_EXPECTED_HOST.');
  if (!expectedDatabase || primary.database !== expectedDatabase) throw new Error('Database target tidak cocok dengan T360_STAGE18_EXPECTED_DATABASE.');
  if (!expectedRestoreHost || restore.hostname !== expectedRestoreHost) throw new Error('Host restore tidak cocok dengan T360_STAGE18_EXPECTED_RESTORE_HOST.');
  if (!expectedRestoreDatabase || restore.database !== expectedRestoreDatabase) throw new Error('Database restore tidak cocok dengan T360_STAGE18_EXPECTED_RESTORE_DATABASE.');
  if (primary.hostname === restore.hostname && primary.port === restore.port && primary.database === restore.database) {
    throw new Error('Database restore wajib berbeda dari database target.');
  }
  const unsafe = /(^|[-_.])(prod|production|live)([-_.]|$)/i;
  if (unsafe.test(primary.hostname) || unsafe.test(primary.database) || unsafe.test(restore.hostname) || unsafe.test(restore.database)) {
    throw new Error('Nama host/database mengandung penanda production/live. Tahap 18 hanya TEST/STAGING.');
  }
  const targetMarker = target === 'TEST' ? /test/i : /stag/i;
  if (!targetMarker.test(primary.database)) throw new Error(`Nama database target harus memuat penanda ${target}.`);
  if (!/(stage18|restore)/i.test(restore.database)) throw new Error('Nama database restore wajib memuat stage18 atau restore.');
  return { target, primary, restore };
}

function pgEnv(connection) {
  const env = {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port,
    PGDATABASE: connection.database,
    PGUSER: connection.username,
    PGPASSWORD: connection.password,
  };
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  return env;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${command} gagal dijalankan: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${command} gagal (exit ${result.status}).\n${output}`);
  }
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

function psql(connection, sql, tools) {
  return runCommand(tools.psql, ['--no-password', '--set', 'ON_ERROR_STOP=1', '--no-align', '--tuples-only', '--quiet', '--command', sql], {
    env: pgEnv(connection),
  }).stdout.trim();
}

function psqlFile(connection, file, tools) {
  return runCommand(tools.psql, ['--no-password', '--set', 'ON_ERROR_STOP=1', '--quiet', '--file', file], {
    env: pgEnv(connection),
  });
}

function queryJson(connection, expression, tools) {
  const output = psql(connection, `SELECT (${expression})::text;`, tools);
  const line = output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).at(-1);
  if (!line) throw new Error('Query JSON tidak menghasilkan output.');
  return JSON.parse(line);
}

export function loadDecisions(file) {
  if (!fs.existsSync(file)) throw new Error(`File keputusan tidak ditemukan: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed.version !== 1) throw new Error('Versi file keputusan harus 1.');
  return {
    productAssignments: Array.isArray(parsed.productAssignments) ? parsed.productAssignments : [],
    supplierAssignments: Array.isArray(parsed.supplierAssignments) ? parsed.supplierAssignments : [],
  };
}

function decisionBlock(entity, item) {
  const isProduct = entity === 'Product';
  const idField = isProduct ? 'productId' : 'supplierId';
  const businessField = isProduct ? 'sku' : 'code';
  const id = item[idField];
  if (!id || !item.companyId) throw new Error(`Keputusan ${entity} wajib memuat ${idField} dan companyId.`);
  const optional = item.optionalIfMissing === true;
  const candidateCte = isProduct ? `
    WITH candidates("companyId") AS (
      SELECT b."companyId" FROM "Inventory" i JOIN "Warehouse" w ON w."id"=i."warehouseId" JOIN "Branch" b ON b."id"=w."branchId" WHERE i."productId"=v_id
      UNION SELECT b."companyId" FROM "PurchaseOrderItem" poi JOIN "PurchaseOrder" po ON po."id"=poi."purchaseOrderId" JOIN "Warehouse" w ON w."id"=po."warehouseId" JOIN "Branch" b ON b."id"=w."branchId" WHERE poi."productId"=v_id
      UNION SELECT b."companyId" FROM "GoodsReceiptItem" gri JOIN "GoodsReceipt" gr ON gr."id"=gri."goodsReceiptId" JOIN "Warehouse" w ON w."id"=gr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId" WHERE gri."productId"=v_id
      UNION SELECT b."companyId" FROM "SaleItem" si JOIN "Sale" s ON s."id"=si."saleId" JOIN "Branch" b ON b."id"=s."branchId" WHERE si."productId"=v_id
      UNION SELECT b."companyId" FROM "OrderItem" oi JOIN "Order" o ON o."id"=oi."orderId" JOIN "Branch" b ON b."id"=o."branchId" WHERE oi."productId"=v_id
    ) SELECT COUNT(DISTINCT "companyId") INTO v_candidates FROM candidates;` : `
    WITH candidates("companyId") AS (
      SELECT b."companyId" FROM "PurchaseOrder" po JOIN "Warehouse" w ON w."id"=po."warehouseId" JOIN "Branch" b ON b."id"=w."branchId" WHERE po."supplierId"=v_id
      UNION SELECT b."companyId" FROM "GoodsReceipt" gr JOIN "Warehouse" w ON w."id"=gr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId" WHERE gr."supplierId"=v_id
      UNION SELECT b."companyId" FROM "PurchaseReturn" pr JOIN "Warehouse" w ON w."id"=pr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId" WHERE pr."supplierId"=v_id
    ) SELECT COUNT(DISTINCT "companyId") INTO v_candidates FROM candidates;`;
  return `
DO $t360$
DECLARE
  v_id text := ${sqlLiteral(id)};
  v_company_id text := ${sqlLiteral(item.companyId)};
  v_record record;
  v_company record;
  v_company_count bigint;
  v_candidates bigint := 0;
BEGIN
  SELECT "id", "companyId", "name", "${businessField}" INTO v_record FROM "${entity}" WHERE "id" = v_id;
  IF NOT FOUND THEN
    ${optional ? 'RETURN;' : `RAISE EXCEPTION 'T360_STAGE18_DECISION ${entity} record not found: %', v_id;`}
  END IF;
  SELECT "id", "name", "slug" INTO v_company FROM "Company" WHERE "id" = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'T360_STAGE18_DECISION Company not found: %', v_company_id; END IF;
  IF v_record."${businessField}" IS DISTINCT FROM ${sqlLiteral(isProduct ? item.expectedSku : item.expectedCode)} THEN
    RAISE EXCEPTION 'T360_STAGE18_DECISION ${entity} business key mismatch: %', v_id;
  END IF;
  IF v_record."name" IS DISTINCT FROM ${sqlLiteral(item.expectedName)} THEN
    RAISE EXCEPTION 'T360_STAGE18_DECISION ${entity} name mismatch: %', v_id;
  END IF;
  IF v_company."slug" IS DISTINCT FROM ${sqlLiteral(item.expectedCompanySlug)} OR v_company."name" IS DISTINCT FROM ${sqlLiteral(item.expectedCompanyName)} THEN
    RAISE EXCEPTION 'T360_STAGE18_DECISION Company identity mismatch: %', v_company_id;
  END IF;
  SELECT COUNT(*) INTO v_company_count FROM "Company";
  IF ${item.requireOnlyCompany === true ? 'TRUE' : 'FALSE'} AND v_company_count <> 1 THEN
    RAISE EXCEPTION 'T360_STAGE18_DECISION expected one company, found %', v_company_count;
  END IF;
  ${candidateCte}
  IF ${item.requireNoTransactionCandidate === true ? 'TRUE' : 'FALSE'} AND v_candidates <> 0 THEN
    RAISE EXCEPTION 'T360_STAGE18_DECISION expected no transaction candidate, found %', v_candidates;
  END IF;
  IF v_record."companyId" IS NULL THEN
    UPDATE "${entity}" SET "companyId" = v_company_id WHERE "id" = v_id AND "companyId" IS NULL;
  ELSIF v_record."companyId" <> v_company_id THEN
    RAISE EXCEPTION 'T360_STAGE18_DECISION existing ownership mismatch: %', v_id;
  END IF;
END $t360$;
`;
}

export function buildTransactionalSql(decisions) {
  const decisionSql = [
    ...decisions.productAssignments.map((item) => decisionBlock('Product', item)),
    ...decisions.supplierAssignments.map((item) => decisionBlock('Supplier', item)),
  ].join('\n');
  return `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

DO $t360$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Product_companyId_fkey' AND conrelid='"Product"'::regclass) THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Supplier_companyId_fkey' AND conrelid='"Supplier"'::regclass) THEN
    ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $t360$;

CREATE INDEX IF NOT EXISTS "Product_companyId_isActive_name_id_idx" ON "Product"("companyId", "isActive", "name", "id");
CREATE INDEX IF NOT EXISTS "Product_companyId_sku_idx" ON "Product"("companyId", "sku");
CREATE INDEX IF NOT EXISTS "Supplier_companyId_name_id_idx" ON "Supplier"("companyId", "name", "id");
CREATE INDEX IF NOT EXISTS "Supplier_companyId_code_idx" ON "Supplier"("companyId", "code");

WITH product_candidates("productId", "companyId") AS (
  SELECT i."productId", b."companyId" FROM "Inventory" i JOIN "Warehouse" w ON w."id"=i."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
  UNION SELECT poi."productId", b."companyId" FROM "PurchaseOrderItem" poi JOIN "PurchaseOrder" po ON po."id"=poi."purchaseOrderId" JOIN "Warehouse" w ON w."id"=po."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
  UNION SELECT gri."productId", b."companyId" FROM "GoodsReceiptItem" gri JOIN "GoodsReceipt" gr ON gr."id"=gri."goodsReceiptId" JOIN "Warehouse" w ON w."id"=gr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
  UNION SELECT si."productId", b."companyId" FROM "SaleItem" si JOIN "Sale" s ON s."id"=si."saleId" JOIN "Branch" b ON b."id"=s."branchId"
  UNION SELECT oi."productId", b."companyId" FROM "OrderItem" oi JOIN "Order" o ON o."id"=oi."orderId" JOIN "Branch" b ON b."id"=o."branchId"
), resolved_products AS (
  SELECT "productId", MIN("companyId") AS "companyId" FROM product_candidates GROUP BY "productId" HAVING COUNT(DISTINCT "companyId")=1
)
UPDATE "Product" p SET "companyId"=r."companyId" FROM resolved_products r WHERE p."id"=r."productId" AND p."companyId" IS NULL;

WITH supplier_candidates("supplierId", "companyId") AS (
  SELECT po."supplierId", b."companyId" FROM "PurchaseOrder" po JOIN "Warehouse" w ON w."id"=po."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
  UNION SELECT gr."supplierId", b."companyId" FROM "GoodsReceipt" gr JOIN "Warehouse" w ON w."id"=gr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
  UNION SELECT pr."supplierId", b."companyId" FROM "PurchaseReturn" pr JOIN "Warehouse" w ON w."id"=pr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
), resolved_suppliers AS (
  SELECT "supplierId", MIN("companyId") AS "companyId" FROM supplier_candidates GROUP BY "supplierId" HAVING COUNT(DISTINCT "companyId")=1
)
UPDATE "Supplier" s SET "companyId"=r."companyId" FROM resolved_suppliers r WHERE s."id"=r."supplierId" AND s."companyId" IS NULL;

${decisionSql}

DO $t360$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM "Product" WHERE "companyId" IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'T360_STAGE18_GATE product_unresolved=%', v_count; END IF;
  SELECT COUNT(*) INTO v_count FROM "Supplier" WHERE "companyId" IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'T360_STAGE18_GATE supplier_unresolved=%', v_count; END IF;

  WITH product_candidates("productId", "companyId") AS (
    SELECT i."productId", b."companyId" FROM "Inventory" i JOIN "Warehouse" w ON w."id"=i."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
    UNION SELECT poi."productId", b."companyId" FROM "PurchaseOrderItem" poi JOIN "PurchaseOrder" po ON po."id"=poi."purchaseOrderId" JOIN "Warehouse" w ON w."id"=po."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
    UNION SELECT gri."productId", b."companyId" FROM "GoodsReceiptItem" gri JOIN "GoodsReceipt" gr ON gr."id"=gri."goodsReceiptId" JOIN "Warehouse" w ON w."id"=gr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
    UNION SELECT si."productId", b."companyId" FROM "SaleItem" si JOIN "Sale" s ON s."id"=si."saleId" JOIN "Branch" b ON b."id"=s."branchId"
    UNION SELECT oi."productId", b."companyId" FROM "OrderItem" oi JOIN "Order" o ON o."id"=oi."orderId" JOIN "Branch" b ON b."id"=o."branchId"
  ) SELECT COUNT(DISTINCT p."id") INTO v_count FROM "Product" p JOIN product_candidates pc ON pc."productId"=p."id" WHERE p."companyId"<>pc."companyId";
  IF v_count <> 0 THEN RAISE EXCEPTION 'T360_STAGE18_GATE product_mismatch=%', v_count; END IF;

  WITH supplier_candidates("supplierId", "companyId") AS (
    SELECT po."supplierId", b."companyId" FROM "PurchaseOrder" po JOIN "Warehouse" w ON w."id"=po."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
    UNION SELECT gr."supplierId", b."companyId" FROM "GoodsReceipt" gr JOIN "Warehouse" w ON w."id"=gr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
    UNION SELECT pr."supplierId", b."companyId" FROM "PurchaseReturn" pr JOIN "Warehouse" w ON w."id"=pr."warehouseId" JOIN "Branch" b ON b."id"=w."branchId"
  ) SELECT COUNT(DISTINCT s."id") INTO v_count FROM "Supplier" s JOIN supplier_candidates sc ON sc."supplierId"=s."id" WHERE s."companyId"<>sc."companyId";
  IF v_count <> 0 THEN RAISE EXCEPTION 'T360_STAGE18_GATE supplier_mismatch=%', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM "Product" p LEFT JOIN "Company" c ON c."id"=p."companyId" WHERE c."id" IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'T360_STAGE18_GATE product_orphan=%', v_count; END IF;
  SELECT COUNT(*) INTO v_count FROM "Supplier" s LEFT JOIN "Company" c ON c."id"=s."companyId" WHERE c."id" IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'T360_STAGE18_GATE supplier_orphan=%', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN (
    'Product_companyId_isActive_name_id_idx','Product_companyId_sku_idx','Supplier_companyId_name_id_idx','Supplier_companyId_code_idx'
  );
  IF v_count <> 4 THEN RAISE EXCEPTION 'T360_STAGE18_GATE ownership_index_count=%', v_count; END IF;
END $t360$;
COMMIT;
`;
}

const stateExpression = `json_build_object(
  'productTotal',(SELECT COUNT(*) FROM "Product"),
  'supplierTotal',(SELECT COUNT(*) FROM "Supplier"),
  'productCompanyColumn',true,
  'supplierCompanyColumn',true,
  'productUnresolved',(SELECT COUNT(*) FROM "Product" WHERE "companyId" IS NULL),
  'supplierUnresolved',(SELECT COUNT(*) FROM "Supplier" WHERE "companyId" IS NULL),
  'productOwnershipChecksum',COALESCE((SELECT SUM(hashtextextended("id"||':'||COALESCE("companyId",''),0)::numeric)::text FROM "Product"),'0'),
  'supplierOwnershipChecksum',COALESCE((SELECT SUM(hashtextextended("id"||':'||COALESCE("companyId",''),0)::numeric)::text FROM "Supplier"),'0'),
  'ownershipIndexCount',(SELECT COUNT(*) FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('Product_companyId_isActive_name_id_idx','Product_companyId_sku_idx','Supplier_companyId_name_id_idx','Supplier_companyId_code_idx'))
)`;

function queryOwnershipState(connection, tools) {
  const columns = queryJson(connection, `json_build_object(
    'productCompanyColumn',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Product' AND column_name='companyId'),
    'supplierCompanyColumn',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Supplier' AND column_name='companyId')
  )`, tools);
  if (columns.productCompanyColumn && columns.supplierCompanyColumn) return queryJson(connection, stateExpression, tools);
  return queryJson(connection, `json_build_object(
    'productTotal',(SELECT COUNT(*) FROM "Product"),
    'supplierTotal',(SELECT COUNT(*) FROM "Supplier"),
    'productCompanyColumn',${columns.productCompanyColumn ? 'true' : 'false'},
    'supplierCompanyColumn',${columns.supplierCompanyColumn ? 'true' : 'false'},
    'productUnresolved',(SELECT COUNT(*) FROM "Product"),
    'supplierUnresolved',(SELECT COUNT(*) FROM "Supplier"),
    'productOwnershipChecksum','COLUMN_ABSENT',
    'supplierOwnershipChecksum','COLUMN_ABSENT',
    'ownershipIndexCount',0
  )`, tools);
}

function writeEvidence(root, outputRoot, evidence) {
  fs.mkdirSync(outputRoot, { recursive: true });
  const timestampDir = path.join(outputRoot, evidence.runId);
  fs.mkdirSync(timestampDir, { recursive: true });
  fs.writeFileSync(path.join(timestampDir, 'stage18-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const md = [
    '# Stage 18 — PostgreSQL Product/Supplier Ownership Migration',
    '',
    `- Status: **${evidence.gate.passed ? 'PASSED' : 'FAILED'}**`,
    `- Target: ${evidence.targetMode}`,
    `- Generated: ${evidence.generatedAt}`,
    `- Target host hash: \`${evidence.target.hostHash}\``,
    `- Target database hash: \`${evidence.target.databaseHash}\``,
    `- Backup SHA-256: \`${evidence.backup.sha256}\``,
    `- Restore test: ${evidence.restoreTest.passed ? 'passed' : 'failed'}`,
    `- Product unresolved: ${evidence.after.productUnresolved}`,
    `- Supplier unresolved: ${evidence.after.supplierUnresolved}`,
    `- Idempotent second run: ${evidence.idempotent ? 'yes' : 'no'}`,
    `- Ownership indexes: ${evidence.after.ownershipIndexCount}/4`,
    '',
    'Credential dan raw database URL tidak disimpan pada evidence.',
  ].join('\n');
  fs.writeFileSync(path.join(timestampDir, 'stage18-evidence.md'), `${md}\n`);
  fs.copyFileSync(path.join(timestampDir, 'stage18-evidence.json'), path.join(outputRoot, 'latest.json'));
  fs.copyFileSync(path.join(timestampDir, 'stage18-evidence.md'), path.join(outputRoot, 'latest.md'));
  return timestampDir;
}

export async function main(argv = process.argv.slice(2)) {
  const root = process.cwd();
  const arg = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const currentSourceIdentity = sourceFingerprint(root);
  const outputRoot = path.resolve(root, arg('--output-dir', 'logs/stage18-product-supplier-postgres'));
  const officialEvidenceDir = path.join(root, 'work-items', 'generated', WORK_ITEM, 'evidence');
  const officialEvidencePath = path.join(officialEvidenceDir, `${WORK_ITEM}-stage18-postgres-staging.json`);
  const attemptMarker = {
    workItem: WORK_ITEM, stage: STAGE, generatedAt: new Date().toISOString(), sourceIdentity: currentSourceIdentity,
    productionTouched: false, gate: { passed: false, blockingReasons: ['Stage-18 attempt has not completed successfully.'] },
    status: 'FAIL', error: 'Stage-18 evidence invalidated at attempt start; a fresh PASS must replace it.'
  };
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(officialEvidenceDir, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'latest.json'), `${JSON.stringify(attemptMarker, null, 2)}\n`);
  fs.writeFileSync(officialEvidencePath, `${JSON.stringify(attemptMarker, null, 2)}\n`);
  const envFile = path.resolve(root, arg('--env-file', 'stage18-postgres.env'));
  const values = { ...readEnvFile(envFile), ...process.env };
  const config = validateNonProductionConfig(values);
  const decisionsFile = path.resolve(root, arg('--decisions-file', values.T360_STAGE18_DECISIONS_FILE || 'stage18-ownership-decisions.json'));
  const decisions = loadDecisions(decisionsFile);
  const tools = {
    psql: values.T360_STAGE18_PSQL || 'psql',
    pgDump: values.T360_STAGE18_PG_DUMP || 'pg_dump',
    pgRestore: values.T360_STAGE18_PG_RESTORE || 'pg_restore',
  };
  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const runDir = path.join(outputRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const backupFile = path.join(runDir, 'pre-stage18.dump');
  const transactionFile = path.join(runDir, 'stage18-transaction.sql');

  const primaryIdentity = queryJson(config.primary, `json_build_object('database',current_database(),'user',current_user,'serverVersion',current_setting('server_version'),'environment',COALESCE(current_setting('t360.environment',true),''))`, tools);
  if (primaryIdentity.database !== config.primary.database) throw new Error('Database aktual target tidak cocok.');
  if (/prod|production|live/i.test(String(primaryIdentity.environment || ''))) throw new Error('Server menandai environment production/live.');
  const restoreIdentity = queryJson(config.restore, `json_build_object('database',current_database(),'user',current_user,'serverVersion',current_setting('server_version'),'environment',COALESCE(current_setting('t360.environment',true),''))`, tools);
  if (restoreIdentity.database !== config.restore.database) throw new Error('Database aktual restore tidak cocok.');
  if (/prod|production|live/i.test(String(restoreIdentity.environment || ''))) throw new Error('Database restore menandai environment production/live.');

  const before = queryOwnershipState(config.primary, tools);
  runCommand(tools.pgDump, ['--format=custom', '--no-owner', '--no-privileges', '--file', backupFile], { env: pgEnv(config.primary) });
  runCommand(tools.pgRestore, ['--list', backupFile], { env: pgEnv(config.primary) });
  const backupHash = sha256(fs.readFileSync(backupFile));

  psql(config.restore, 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER;', tools);
  runCommand(tools.pgRestore, ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', config.restore.database, backupFile], { env: pgEnv(config.restore) });
  const restoredBefore = queryOwnershipState(config.restore, tools);
  const restorePassed = before.productTotal === restoredBefore.productTotal && before.supplierTotal === restoredBefore.supplierTotal;
  if (!restorePassed) throw new Error('Restore test gagal: jumlah Product/Supplier tidak sama.');

  fs.writeFileSync(transactionFile, buildTransactionalSql(decisions));
  psqlFile(config.primary, transactionFile, tools);
  const afterFirst = queryOwnershipState(config.primary, tools);
  psqlFile(config.primary, transactionFile, tools);
  const afterSecond = queryOwnershipState(config.primary, tools);
  const idempotent = JSON.stringify(afterFirst) === JSON.stringify(afterSecond);
  if (!idempotent) throw new Error('Eksekusi kedua mengubah state ownership; migration tidak idempoten.');
  if (Number(afterSecond.productUnresolved) !== 0 || Number(afterSecond.supplierUnresolved) !== 0 || Number(afterSecond.ownershipIndexCount) !== 4) {
    throw new Error('Gate ownership PostgreSQL belum lulus setelah transaksi.');
  }

  const queryPlans = {
    product: psql(config.primary, `EXPLAIN (FORMAT TEXT) SELECT "id" FROM "Product" WHERE "companyId"=(SELECT "id" FROM "Company" ORDER BY "id" LIMIT 1) AND "isActive"=true ORDER BY "name","id" LIMIT 50;`, tools).split(/\r?\n/).filter(Boolean),
    supplier: psql(config.primary, `EXPLAIN (FORMAT TEXT) SELECT "id" FROM "Supplier" WHERE "companyId"=(SELECT "id" FROM "Company" ORDER BY "id" LIMIT 1) ORDER BY "name","id" LIMIT 50;`, tools).split(/\r?\n/).filter(Boolean),
  };

  const evidence = {
    workItem: WORK_ITEM,
    stage: STAGE,
    runId,
    generatedAt: new Date().toISOString(),
    sourceIdentity: currentSourceIdentity,
    targetMode: config.target,
    target: { hostHash: hashIdentifier(config.primary.hostname), databaseHash: hashIdentifier(config.primary.database), serverVersion: primaryIdentity.serverVersion },
    restoreTarget: { hostHash: hashIdentifier(config.restore.hostname), databaseHash: hashIdentifier(config.restore.database), serverVersion: restoreIdentity.serverVersion },
    backup: { path: path.relative(root, backupFile).replaceAll('\\', '/'), sha256: backupHash, archiveListVerified: true },
    restoreTest: { passed: restorePassed, productTotal: restoredBefore.productTotal, supplierTotal: restoredBefore.supplierTotal },
    decisions: { fileHash: sha256(fs.readFileSync(decisionsFile)), productAssignments: decisions.productAssignments.length, supplierAssignments: decisions.supplierAssignments.length },
    before,
    after: afterSecond,
    idempotent,
    queryPlans,
    gate: { passed: true, blockingReasons: [] },
  };
  const evidenceDir = writeEvidence(root, outputRoot, evidence);
  fs.writeFileSync(officialEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Stage 18 PostgreSQL ${config.target}: PASSED`);
  console.log(`Product unresolved: ${afterSecond.productUnresolved}`);
  console.log(`Supplier unresolved: ${afterSecond.supplierUnresolved}`);
  console.log(`Restore test: PASSED`);
  console.log(`Evidence: ${path.relative(root, evidenceDir).replaceAll('\\', '/')}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`STAGE18_ERROR: ${String(error.message || error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')}`);
    process.exit(1);
  });
}
