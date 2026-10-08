import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import test from 'node:test';
import {
  indexCovers,
  parsePostgresUrl,
  summarizePlan,
  splitSqlStatements,
  selectStage20ApiPort,
  validateNonProductionConfig,
  validateUatResults,
} from '../scripts/run-stage20-release-readiness.mjs';

const baseConfig = {
  T360_STAGE20_TARGET: 'STAGING',
  T360_STAGE20_CONFIRM: 'RUN_T360_STAGE20_NON_PRODUCTION',
  T360_STAGE20_DATABASE_URL: 'postgresql://user:secret@localhost:5432/toko360_staging?sslmode=disable',
  T360_STAGE20_EXPECTED_HOST: 'localhost',
  T360_STAGE20_EXPECTED_DATABASE: 'toko360_staging',
  T360_STAGE20_API_PORT: '42020',
};

const scenarioIds = [
  'UAT-01-AUTH-ACCESS','UAT-02-PUBLIC-CATALOG','UAT-03-SALES-ORDER-PAYMENT','UAT-04-PURCHASE-RECEIPT',
  'UAT-05-INVENTORY-OPERATIONS','UAT-06-ACCOUNTING-FINANCE-REPORTS','UAT-07-HR-ATTENDANCE-PAYROLL',
  'UAT-08-OFFLINE-SYNC','UAT-09-AUDIT-DENIAL','UAT-10-RESTORE-ROLLBACK',
  'UAT-11-DELIVERY-LIFECYCLE','UAT-12-PAYROLL-ADJUSTMENT-RECOVERY',
];

test('Stage 20 config requires exact non-production identity', () => {
  const result = validateNonProductionConfig(baseConfig);
  assert.equal(result.target, 'STAGING');
  assert.equal(parsePostgresUrl(baseConfig.T360_STAGE20_DATABASE_URL).database, 'toko360_staging');
  assert.throws(() => validateNonProductionConfig({ ...baseConfig, T360_STAGE20_DATABASE_URL: 'postgresql://u:p@localhost:5432/toko360_production', T360_STAGE20_EXPECTED_DATABASE: 'toko360_production' }), /production/);
});

test('Stage 20 UAT requires all critical scenarios and explicit release-ready decision', () => {
  const pending = { environment: 'STAGING', scenarios: scenarioIds.map((id) => ({ id, status: 'PENDING' })) };
  assert.equal(validateUatResults(pending, { allowPending: true }).passed, false);
  assert.throws(() => validateUatResults(pending), /PENDING/);
  const passed = {
    environment: 'STAGING', approver: 'IVO', executedAt: new Date().toISOString(), releaseDecision: 'GO_FOR_RELEASE_READY', rollbackOwner: 'IVO', monitoringOwner: 'IVO',
    scenarios: scenarioIds.map((id) => ({ id, status: 'PASS', notes: 'verified' })),
  };
  assert.equal(validateUatResults(passed).passed, true);
  assert.throws(() => validateUatResults({ ...passed, scenarios: [...passed.scenarios, { id: 'UAT-EXTRA', status: 'PASS' }] }), /tepat 12/);
  assert.throws(() => validateUatResults({ ...passed, scenarios: [...passed.scenarios.slice(0, 11), passed.scenarios[0]] }), /duplikat/);
});

test('critical index coverage checks ordered columns', () => {
  const definition = 'CREATE INDEX "Product_companyId_isActive_name_id_idx" ON public."Product" USING btree ("companyId", "isActive", "name", "id")';
  assert.equal(indexCovers(definition, ['companyId', 'isActive', 'name', 'id']), true);
  assert.equal(indexCovers(definition, ['companyId', 'name', 'isActive']), false);
});

test('critical index coverage accepts PostgreSQL deparsed lowercase identifiers', () => {
  const product = 'CREATE INDEX "Product_companyId_isActive_name_id_idx" ON public."Product" USING btree ("companyId", "isActive", name, id)';
  const inventory = 'CREATE INDEX "Inventory_warehouseId_updatedAt_id_idx" ON public."Inventory" USING btree ("warehouseId", "updatedAt", id)';
  assert.equal(indexCovers(product, ['companyId', 'isActive', 'name', 'id']), true);
  const payroll = 'CREATE INDEX "PayrollRun_companyId_branchId_createdAt_idx" ON public."PayrollRun" USING btree ("companyId", "branchId", "createdAt")';
  assert.equal(indexCovers(inventory, ['warehouseId', 'updatedAt', 'id']), true);
  assert.equal(indexCovers(payroll, ['companyId', 'branchId', 'createdAt']), true);
});

test('query plan summary extracts execution time and indexes', () => {
  const summary = summarizePlan([{ Plan: { 'Node Type': 'Index Scan', 'Index Name': 'idx_a', 'Actual Rows': 5, Plans: [{ 'Node Type': 'Bitmap Index Scan', 'Index Name': 'idx_b' }] }, 'Planning Time': 1.2, 'Execution Time': 3.4 }]);
  assert.equal(summary.executionTimeMs, 3.4);
  assert.deepEqual(summary.indexNames.sort(), ['idx_a', 'idx_b']);
});


test('Stage 20 critical indexes are represented in every Prisma profile', () => {
  for (const file of ['apps/api/prisma/schema.prisma', 'apps/api/prisma/schema.sqlite.prisma', 'apps/api/prisma/schema.postgresql.prisma']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /@@index\(\[companyId, isActive, name, id\]\)/);
    assert.match(source, /model Warehouse \{[\s\S]*?@@index\(\[branchId\]\)[\s\S]*?\}/);
    assert.match(source, /model Inventory \{[\s\S]*?@@index\(\[warehouseId, updatedAt, id\]\)[\s\S]*?\}/);
    assert.match(source, /model AccountingEvent \{[\s\S]*?@@index\(\[companyId, branchId, createdAt, id\]\)[\s\S]*?\}/);
    assert.match(source, /model PayrollRun \{[\s\S]*?@@index\(\[companyId, branchId, createdAt\]\)[\s\S]*?\}/);
  }
});



test('SQL splitter ignores semicolons inside line comments', () => {
  const sql = `-- additive migration; production requires approval
CREATE INDEX IF NOT EXISTS "idx_a" ON "Product" ("companyId");
-- another; comment
CREATE INDEX IF NOT EXISTS "idx_b" ON "Warehouse" ("branchId");`;
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^CREATE INDEX IF NOT EXISTS "idx_a"/);
  assert.match(statements[1], /^CREATE INDEX IF NOT EXISTS "idx_b"/);
  assert.doesNotMatch(statements.join(' '), /production requires approval|another/);
});

test('Stage 20 PostgreSQL critical index migration is additive and idempotent', () => {
  const sql = fs.readFileSync('database/migrations/T360-20260802-145524-release-readiness-indexes/postgresql-expand.sql', 'utf8');
  assert.equal((sql.match(/CREATE INDEX IF NOT EXISTS/g) || []).length, 5);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|INDEX)|ALTER\s+COLUMN|DELETE\s+FROM|TRUNCATE/i);
  assert.match(sql, /"Product" \("companyId", "isActive", "name", "id"\)/);
  assert.match(sql, /"Warehouse" \("branchId"\)/);
  assert.match(sql, /"Inventory" \("warehouseId", "updatedAt", "id"\)/);
  assert.match(sql, /"AccountingEvent" \("companyId", "branchId", "createdAt", "id"\)/);
  assert.match(sql, /"PayrollRun" \("companyId", "branchId", "createdAt"\)/);
});

test('Stage 20 prepares critical indexes before the final API build', () => {
  const source = fs.readFileSync('scripts/prepare-stage20-postgres.mjs', 'utf8');
  const indexPosition = source.indexOf('apply-stage20-critical-indexes.mjs');
  const buildPosition = source.indexOf("run(['run', 'build', '-w', '@toko360/api']");
  assert.ok(indexPosition > 0);
  assert.ok(buildPosition > indexPosition);
});


test('Stage 20 explicitly requires delivery lifecycle and payroll adjustment recovery UAT', () => {
  const example = JSON.parse(fs.readFileSync('config/stage20-uat-results.json.example','utf8'));
  const ids = new Set(example.scenarios.map((item) => item.id));
  assert.ok(ids.has('UAT-11-DELIVERY-LIFECYCLE'));
  assert.ok(ids.has('UAT-12-PAYROLL-ADJUSTMENT-RECOVERY'));
  const source = fs.readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');
  assert.match(source, /sourceIdentity: sourceFingerprint\(root\)/);
});


test('Stage-20 requires current-source Stage-19 and build-gate evidence on the same target', () => {
  const source = fs.readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');
  assert.match(source, /stage19\.sourceIdentity\?\.value !== currentSourceIdentity\.value/);
  assert.match(source, /stage18\.target\?\.hostHash !== targetHostHash/);
  assert.match(source, /stage19\.target\?\.databaseHash !== targetDatabaseHash/);
  assert.match(source, /build-gate-latest\.json/);
  assert.match(source, /buildGate\.status !== 'PASS'/);
});

test('Stage-20 creates its evidence directory before fail-closed attempt invalidation', () => {
  const source = fs.readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');
  const logDir = source.indexOf("const logDir = path.join(root, 'logs', 'stage20-release-readiness')");
  const mkdir = source.indexOf('fs.mkdirSync(logDir, { recursive: true })');
  const invalidation = source.indexOf("fs.writeFileSync(path.join(logDir, 'latest.json')");
  assert.ok(logDir >= 0 && mkdir > logDir && invalidation > mkdir);
});


test('Stage-20 persists and emits sanitized API startup diagnostics before propagating health failure', () => {
  const source = fs.readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');
  assert.match(source, /function writeApiStartupLog\(/);
  assert.match(source, /STAGE20_API_STARTUP_LOG/);
  assert.match(source, /await waitForHealth[\s\S]*?catch \(error\)[\s\S]*?writeApiStartupLog/);
  assert.match(source, /replaceAll\(config\.databaseUrl, '\[REDACTED_DATABASE_URL\]'\)/);
});


test('Stage-20 port probe matches Nest wildcard bind semantics', () => {
  const source = fs.readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');
  assert.match(source, /function probeApiBindPort\(port\)/);
  assert.match(source, /server\.listen\(\{ port, exclusive: true \}/);
  assert.doesNotMatch(source, /server\.listen\(\{ host: '127\.0\.0\.1', port, exclusive: true \}/);
  assert.match(source, /selectStage20ApiPort/);
  assert.match(source, /error\?\.code !== 'EADDRINUSE'/);
  assert.match(source, /probeApiBindPort\(0\)/);
  assert.match(source, /API_PORT: String\(apiPortSelection\.actual\)/);
  assert.match(source, /apiPort: apiPortSelection/);
});

function listen(server, options) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('Stage-20 falls back when an IPv6 wildcard listener owns the preferred API port', async (t) => {
  const blocker = net.createServer();
  try {
    try {
      await listen(blocker, { host: '::', port: 0, ipv6Only: true, exclusive: true });
    } catch (error) {
      if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error?.code)) {
        t.skip(`IPv6 wildcard bind unavailable on this runner: ${error.code}`);
        return;
      }
      throw error;
    }

    const address = blocker.address();
    assert.equal(typeof address, 'object');
    const preferredPort = address.port;
    const selected = await selectStage20ApiPort(preferredPort);
    assert.equal(selected.requested, preferredPort);
    assert.equal(selected.fallback, true);
    assert.notEqual(selected.actual, preferredPort);

    const verifier = net.createServer();
    try {
      await listen(verifier, { port: selected.actual, exclusive: true });
    } finally {
      await close(verifier);
    }
  } finally {
    if (blocker.listening) await close(blocker);
  }
});
