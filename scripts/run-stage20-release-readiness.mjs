import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const WORK_ITEM = 'T360-20260802-145524';
const STAGE = 20;
const CONFIRM = 'RUN_T360_STAGE20_NON_PRODUCTION';
const DEFAULT_PORT = 42020;
const REQUIRED_UAT_IDS = [
  'UAT-01-AUTH-ACCESS',
  'UAT-02-PUBLIC-CATALOG',
  'UAT-03-SALES-ORDER-PAYMENT',
  'UAT-04-PURCHASE-RECEIPT',
  'UAT-05-INVENTORY-OPERATIONS',
  'UAT-06-ACCOUNTING-FINANCE-REPORTS',
  'UAT-07-HR-ATTENDANCE-PAYROLL',
  'UAT-08-OFFLINE-SYNC',
  'UAT-09-AUDIT-DENIAL',
  'UAT-10-RESTORE-ROLLBACK',
  'UAT-11-DELIVERY-LIFECYCLE',
  'UAT-12-PAYROLL-ADJUSTMENT-RECOVERY',
];

export function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

export function parsePostgresUrl(raw, label = 'DATABASE_URL') {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} tidak valid.`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${label} wajib PostgreSQL.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database || !url.username) throw new Error(`${label} wajib memuat host, database, dan user.`);
  return { hostname: url.hostname, port: url.port || '5432', database, username: decodeURIComponent(url.username) };
}

export function validateNonProductionConfig(values) {
  const target = String(values.T360_STAGE20_TARGET || '').toUpperCase();
  if (!['TEST', 'STAGING'].includes(target)) throw new Error('T360_STAGE20_TARGET harus TEST atau STAGING.');
  if (values.T360_STAGE20_CONFIRM !== CONFIRM) throw new Error(`T360_STAGE20_CONFIRM harus ${CONFIRM}.`);
  const connection = parsePostgresUrl(values.T360_STAGE20_DATABASE_URL, 'T360_STAGE20_DATABASE_URL');
  if (connection.hostname !== values.T360_STAGE20_EXPECTED_HOST) throw new Error('Host target tidak cocok.');
  if (connection.database !== values.T360_STAGE20_EXPECTED_DATABASE) throw new Error('Database target tidak cocok.');
  const unsafe = /(^|[-_.])(prod|production|live)([-_.]|$)/i;
  if (unsafe.test(connection.hostname) || unsafe.test(connection.database)) throw new Error('Target mengandung penanda production/live.');
  if (!(target === 'TEST' ? /test/i : /stag/i).test(connection.database)) throw new Error(`Nama database harus memuat penanda ${target}.`);
  const apiPort = Number(values.T360_STAGE20_API_PORT || DEFAULT_PORT);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw new Error('T360_STAGE20_API_PORT tidak valid.');
  if ([3000, 3001, 3002, 3003, 4000, 41919].includes(apiPort)) throw new Error('Gunakan port observasi khusus, bukan port aplikasi utama/integration.');
  const samples = Number(values.T360_STAGE20_OBSERVATION_SAMPLES || 30);
  if (!Number.isInteger(samples) || samples < 10 || samples > 300) throw new Error('T360_STAGE20_OBSERVATION_SAMPLES harus 10-300.');
  const intervalMs = Number(values.T360_STAGE20_OBSERVATION_INTERVAL_MS || 1000);
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 10000) throw new Error('T360_STAGE20_OBSERVATION_INTERVAL_MS harus 100-10000.');
  const p95BudgetMs = Number(values.T360_STAGE20_HEALTH_P95_BUDGET_MS || 1000);
  const longQueryThresholdMs = Number(values.T360_STAGE20_LONG_QUERY_THRESHOLD_MS || 15000);
  const maxActiveConnections = Number(values.T360_STAGE20_MAX_ACTIVE_CONNECTIONS || 50);
  for (const [name, value] of Object.entries({ p95BudgetMs, longQueryThresholdMs, maxActiveConnections })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} tidak valid.`);
  }
  return { target, connection, apiPort, samples, intervalMs, p95BudgetMs, longQueryThresholdMs, maxActiveConnections, databaseUrl: values.T360_STAGE20_DATABASE_URL };
}

export function validateUatResults(input, { allowPending = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('File UAT wajib JSON object.');
  if (String(input.environment || '').toUpperCase() !== 'STAGING') throw new Error('UAT environment wajib STAGING.');
  if (!Array.isArray(input.scenarios)) throw new Error('UAT scenarios wajib array.');
  if (input.scenarios.length !== REQUIRED_UAT_IDS.length) throw new Error(`UAT wajib tepat ${REQUIRED_UAT_IDS.length} skenario kritis.`);
  const ids = new Set(input.scenarios.map((item) => item?.id));
  if (ids.size !== input.scenarios.length) throw new Error('UAT tidak boleh memuat ID skenario duplikat.');
  for (const id of REQUIRED_UAT_IDS) if (!ids.has(id)) throw new Error(`Skenario UAT wajib tidak ditemukan: ${id}`);
  const unexpected = [...ids].filter((id) => !REQUIRED_UAT_IDS.includes(id));
  if (unexpected.length) throw new Error(`Skenario UAT tidak dikenal: ${unexpected.join(', ')}.`);
  const invalid = input.scenarios.filter((item) => !['PASS', 'FAIL', 'PENDING'].includes(String(item.status || '').toUpperCase()));
  if (invalid.length) throw new Error(`Status UAT invalid: ${invalid.map((item) => item.id).join(', ')}.`);
  const failed = input.scenarios.filter((item) => String(item.status).toUpperCase() === 'FAIL');
  const pending = input.scenarios.filter((item) => String(item.status).toUpperCase() === 'PENDING');
  if (failed.length) throw new Error(`UAT gagal: ${failed.map((item) => item.id).join(', ')}.`);
  if (!allowPending && pending.length) throw new Error(`UAT masih PENDING: ${pending.map((item) => item.id).join(', ')}.`);
  if (!pending.length) {
    if (typeof input.approver !== 'string' || input.approver.trim().length < 2) throw new Error('UAT approver wajib diisi.');
    const executedAt = Date.parse(input.executedAt);
    if (!Number.isFinite(executedAt)) throw new Error('UAT executedAt wajib ISO date yang valid.');
    if (executedAt > Date.now() + 86400000) throw new Error('UAT executedAt tidak boleh jauh di masa depan.');
    if (input.releaseDecision !== 'GO_FOR_RELEASE_READY') throw new Error('releaseDecision wajib GO_FOR_RELEASE_READY.');
    if (typeof input.rollbackOwner !== 'string' || input.rollbackOwner.trim().length < 2) throw new Error('rollbackOwner wajib diisi.');
    if (typeof input.monitoringOwner !== 'string' || input.monitoringOwner.trim().length < 2) throw new Error('monitoringOwner wajib diisi.');
  }
  return { passed: failed.length === 0 && pending.length === 0, pending: pending.map((item) => item.id), total: input.scenarios.length, approver: input.approver || null };
}

export function splitSqlStatements(sql) {
  const withoutLineComments = String(sql || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function indexCovers(indexDef, columns) {
  const text = String(indexDef || '');
  const match = text.match(/\bUSING\s+[A-Za-z0-9_]+\s*\(([^)]*)\)/i);
  if (!match) return false;
  const actualColumns = match[1].split(',').map((entry) => {
    const value = entry.trim();
    const quoted = value.match(/^"((?:[^"]|"")+)"/);
    if (quoted) return quoted[1].replaceAll('""', '"');
    const unquoted = value.match(/^([A-Za-z_][A-Za-z0-9_$]*)/);
    return unquoted?.[1] || '';
  });
  return columns.every((column, index) => actualColumns[index] === column);
}

export function summarizePlan(planPayload) {
  const envelope = Array.isArray(planPayload) ? planPayload[0] : planPayload;
  const root = envelope?.Plan || envelope?.plan || null;
  const nodeTypes = new Set();
  const indexNames = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node['Node Type']) nodeTypes.add(node['Node Type']);
    if (node['Index Name']) indexNames.add(node['Index Name']);
    for (const child of node.Plans || []) walk(child);
  };
  walk(root);
  return {
    planningTimeMs: Number(envelope?.['Planning Time'] || 0),
    executionTimeMs: Number(envelope?.['Execution Time'] || 0),
    actualRows: Number(root?.['Actual Rows'] || 0),
    nodeTypes: [...nodeTypes],
    indexNames: [...indexNames],
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env-file') result.envFile = argv[++i];
    if (argv[i] === '--uat-file') result.uatFile = argv[++i];
  }
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function probeApiBindPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    // apps/api/src/main.ts calls app.listen(port) without an explicit host,
    // so Stage-20 must probe the same wildcard bind semantics. Probing only
    // 127.0.0.1 can report a false free port while an IPv6 wildcard listener
    // already owns :::port, which then makes Nest fail with EADDRINUSE.
    server.listen({ port, exclusive: true }, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      server.close((error) => error ? reject(error) : resolve(actual));
    });
  });
}

export async function selectStage20ApiPort(preferredPort) {
  try {
    return { requested: preferredPort, actual: await probeApiBindPort(preferredPort), fallback: false };
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    const actual = await probeApiBindPort(0);
    return { requested: preferredPort, actual, fallback: true };
  }
}
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sanitize = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));

function writeApiStartupLog(logDir, apiLog, secrets = []) {
  let output = String(apiLog || '');
  for (const secret of secrets) {
    if (secret) output = output.replaceAll(String(secret), '[REDACTED]');
  }
  const file = path.join(logDir, 'api.log');
  fs.writeFileSync(file, output);
  return file;
}

async function request(baseUrl, pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, durationMs: performance.now() - started };
  } finally { clearTimeout(timeout); }
}

async function waitForHealth(baseUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API berhenti sebelum health check lulus (exit ${child.exitCode}).`);
    try {
      const result = await request(baseUrl, '/health');
      if (result.status === 200 && result.body?.status === 'ok') return;
    } catch {}
    await sleep(500);
  }
  throw new Error('Timeout menunggu API staging aktif.');
}

async function main() {
  const root = process.cwd();
  const logDir = path.join(root, 'logs', 'stage20-release-readiness');
  fs.mkdirSync(logDir, { recursive: true });
  const currentSourceIdentity = sourceFingerprint(root);
  fs.writeFileSync(path.join(logDir, 'latest.json'), `${JSON.stringify({
    workItem: WORK_ITEM, stage: STAGE, generatedAt: new Date().toISOString(), sourceIdentity: currentSourceIdentity,
    productionTouched: false, gate: { automatedPassed: false, uatPassed: false, passed: false }, status: 'FAIL',
    error: 'Stage-20 evidence invalidated at attempt start; a fresh observation must replace it.'
  }, null, 2)}\n`);
  const args = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(root, args.envFile || 'stage20-release-readiness.env');
  const uatFile = path.resolve(root, args.uatFile || 'stage20-uat-results.json');
  const values = { ...process.env, ...readEnvFile(envFile) };
  const config = validateNonProductionConfig(values);
  const uatInput = JSON.parse(fs.readFileSync(uatFile, 'utf8'));
  const uat = validateUatResults(uatInput, { allowPending: true });

  const packet = path.join(root, 'work-items', 'generated', WORK_ITEM);
  const stage18File = path.join(packet, 'evidence', `${WORK_ITEM}-stage18-postgres-staging.json`);
  const stage19File = path.join(packet, 'evidence', `${WORK_ITEM}-stage19-http-db-integration.json`);
  if (!fs.existsSync(stage18File) || !fs.existsSync(stage19File)) throw new Error('Evidence Tahap 18/19 tidak lengkap.');
  const stage18 = JSON.parse(fs.readFileSync(stage18File, 'utf8'));
  const stage19 = JSON.parse(fs.readFileSync(stage19File, 'utf8'));
  if (!stage18.gate?.passed || Number(stage18.after?.productUnresolved) !== 0 || Number(stage18.after?.supplierUnresolved) !== 0) throw new Error('Evidence Tahap 18 belum lulus.');
  if (!stage19.gate?.passed || !stage19.cleanup?.passed || Number(stage19.summary?.failed) !== 0) throw new Error('Evidence Tahap 19 belum lulus lengkap.');

  const targetHostHash = crypto.createHash('sha256').update(config.connection.hostname).digest('hex').slice(0, 16);
  const targetDatabaseHash = crypto.createHash('sha256').update(config.connection.database).digest('hex').slice(0, 16);
  if (stage18.target?.hostHash !== targetHostHash || stage18.target?.databaseHash !== targetDatabaseHash) throw new Error('Evidence Tahap 18 berasal dari target database berbeda.');
  if (stage19.target?.hostHash !== targetHostHash || stage19.target?.databaseHash !== targetDatabaseHash) throw new Error('Evidence Tahap 19 berasal dari target database berbeda.');
  if (stage19.sourceIdentity?.value !== currentSourceIdentity.value) throw new Error('Evidence Tahap 19 berasal dari source fingerprint berbeda; rerun Stage-19 pada source saat ini.');
  if (!stage19.buildArtifactId) throw new Error('Evidence Tahap 19 belum membuktikan exact build artifact.');
  const buildGateFile = path.join(root, 'handoff', 'quality', 'build-gate-latest.json');
  if (!fs.existsSync(buildGateFile)) throw new Error('Build gate evidence belum tersedia.');
  const buildGate = JSON.parse(fs.readFileSync(buildGateFile, 'utf8'));
  if (buildGate.status !== 'PASS' || buildGate.sourceIdentityAfter?.value !== currentSourceIdentity.value) throw new Error('Build gate belum PASS untuk source fingerprint saat ini.');
  const buildArtifact = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', currentSourceIdentity.value);
  if (buildGate.buildArtifactId !== buildArtifact.current.id) throw new Error('Build gate dan build artifact manifest memiliki artifact ID berbeda.');
  if (stage19.buildArtifactId !== buildArtifact.current.id) throw new Error('Evidence Tahap 19 berasal dari build artifact berbeda; rerun Stage-19 tanpa rebuild pada artifact saat ini.');
  const payrollMigrationFile = path.join(root, 'logs', 'payroll-adjustment-postgres-stage', 'latest.json');
  if (!fs.existsSync(payrollMigrationFile)) throw new Error('Evidence payroll-adjustment PostgreSQL staging migration belum tersedia.');
  const payrollMigration = JSON.parse(fs.readFileSync(payrollMigrationFile, 'utf8'));
  if (!payrollMigration.gate?.passed || payrollMigration.status !== 'PASS') throw new Error('Payroll-adjustment PostgreSQL staging migration belum PASS.');
  if (payrollMigration.sourceIdentity?.value !== currentSourceIdentity.value) throw new Error('Payroll-adjustment migration evidence berasal dari source fingerprint berbeda.');
  if (payrollMigration.target?.hostHash !== targetHostHash || payrollMigration.target?.databaseHash !== targetDatabaseHash) throw new Error('Payroll-adjustment migration evidence berasal dari target database berbeda.');
  if (payrollMigration.preserveBuildArtifact !== true || payrollMigration.buildArtifactId !== buildArtifact.current.id) {
    throw new Error('Payroll-adjustment migration belum membuktikan exact build artifact yang sama; rerun migration dengan --preserve-artifact.');
  }

  const distMain = path.join(root, 'apps', 'api', 'dist', 'main.js');
  if (!fs.existsSync(distMain)) throw new Error('Build API belum tersedia.');
  process.env.DATABASE_URL = config.databaseUrl;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const apiPortSelection = await selectStage20ApiPort(config.apiPort);
  const baseUrl = `http://127.0.0.1:${apiPortSelection.actual}/api/v1`;
  let child;
  let apiLog = '';
  const generatedAt = new Date().toISOString();

  try {
    await prisma.$connect();
    const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, slug: true } });
    if (!company) throw new Error('Staging tidak memiliki company untuk query-plan review.');
    const branch = await prisma.branch.findFirst({ where: { companyId: company.id, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, code: true } });
    if (!branch) throw new Error('Staging tidak memiliki branch aktif untuk query-plan review.');
    const warehouse = await prisma.warehouse.findFirst({ where: { branchId: branch.id, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!warehouse) throw new Error('Staging tidak memiliki warehouse aktif untuk query-plan review.');

    const recoveryMapping = await prisma.payrollAccountingMapping.findFirst({ where: {
      companyId: company.id, isActive: true, componentCode: '__PAYROLL_RECEIVABLE__',
      OR: [{ branchId: branch.id }, { branchId: null }],
    }, orderBy: { branchId: 'desc' } });
    const recoveryAccount = recoveryMapping?.debitAccountId ? await prisma.account.findFirst({ where: { id: recoveryMapping.debitAccountId, branchId: branch.id, isActive: true } }) : null;
    const recoveryRule = await prisma.accountingPostingRule.findFirst({ where: { companyId: company.id, eventType: 'PAYROLL_EMPLOYEE_RECOVERY', status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    const payrollRecoveryConfiguration = {
      mappingReady: Boolean(recoveryMapping?.debitAccountId),
      accountReady: Boolean(recoveryAccount),
      postingRuleReady: Boolean(recoveryRule),
    };

    child = spawn(process.execPath, [distMain], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: config.databaseUrl, API_PORT: String(apiPortSelection.actual), JWT_SECRET: crypto.randomBytes(32).toString('hex'), ORDER_ACCESS_SECRET: crypto.randomBytes(32).toString('hex'), SECRET_MASTER_KEY: crypto.randomBytes(32).toString('hex'), NODE_ENV: 'staging', CORS_ORIGINS: 'http://127.0.0.1:3000', T360_SOURCE_FINGERPRINT: currentSourceIdentity.value, T360_BUILD_ARTIFACT_ID: buildArtifact.current.id },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { apiLog += chunk.toString(); });
    child.stderr.on('data', (chunk) => { apiLog += chunk.toString(); });
    try {
      await waitForHealth(baseUrl, child, Number(values.T360_STAGE20_API_START_TIMEOUT_MS || 60000));
    } catch (error) {
      const apiLogFile = writeApiStartupLog(logDir, apiLog, [
        config.databaseUrl,
        process.env.JWT_SECRET,
        process.env.ORDER_ACCESS_SECRET,
        process.env.SECRET_MASTER_KEY,
      ]);
      const tail = apiLog.trim().split(/\r?\n/).slice(-40).join('\n')
        .replaceAll(config.databaseUrl, '[REDACTED_DATABASE_URL]');
      if (tail) console.error(`STAGE20_API_STARTUP_LOG (${apiLogFile}):\n${tail}`);
      throw error;
    }

    const healthSamples = [];
    let healthErrors = 0;
    for (let i = 0; i < config.samples; i += 1) {
      try {
        const sample = await request(baseUrl, '/health');
        if (sample.status !== 200 || sample.body?.status !== 'ok' || sample.body?.release?.sourceFingerprint !== currentSourceIdentity.value || sample.body?.release?.buildArtifactId !== buildArtifact.current.id) healthErrors += 1;
        else healthSamples.push(sample.durationMs);
      } catch { healthErrors += 1; }
      if (i + 1 < config.samples) await sleep(config.intervalMs);
    }
    const health = {
      samplesRequested: config.samples,
      samplesPassed: healthSamples.length,
      errors: healthErrors,
      p50Ms: Number(percentile(healthSamples, 0.50).toFixed(2)),
      p95Ms: Number(percentile(healthSamples, 0.95).toFixed(2)),
      maxMs: Number(Math.max(0, ...healthSamples).toFixed(2)),
      budgetP95Ms: config.p95BudgetMs,
    };

    const databaseStats = await prisma.$queryRawUnsafe(`
      SELECT current_database() AS database_name,
             pg_database_size(current_database()) AS database_size_bytes,
             numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
             temp_files, temp_bytes, deadlocks
      FROM pg_stat_database WHERE datname = current_database()`);
    const activity = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS connections,
             COUNT(*) FILTER (WHERE state = 'active')::int AS active_connections,
             COUNT(*) FILTER (WHERE state <> 'idle' AND query_start IS NOT NULL AND clock_timestamp() - query_start > (${Number(config.longQueryThresholdMs)} * interval '1 millisecond'))::int AS long_running
      FROM pg_stat_activity WHERE datname = current_database()`);
    const ownership = {
      productUnresolved: await prisma.product.count({ where: { companyId: null } }),
      supplierUnresolved: await prisma.supplier.count({ where: { companyId: null } }),
    };
    const queueGroups = {
      eventOutbox: await prisma.eventOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      webhookDelivery: await prisma.webhookDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
      notification: await prisma.notification.groupBy({ by: ['status'], _count: { _all: true } }),
      reportJob: await prisma.reportJob.groupBy({ by: ['status'], _count: { _all: true } }),
      automationJob: await prisma.automationJob.groupBy({ by: ['status'], _count: { _all: true } }),
      offlineTransaction: await prisma.offlineTransaction.groupBy({ by: ['status'], _count: { _all: true } }),
    };
    const recentDenials = await prisma.auditLog.count({ where: { action: 'TENANT_ACCESS_DENIED', createdAt: { gte: new Date(Date.now() - 86400000) } } });

    const planDefinitions = [
      { key: 'product_list', table: 'Product', budgetMs: 300, sql: `SELECT "id","sku","name" FROM "Product" WHERE "companyId"=${sqlLiteral(company.id)} AND "isActive"=true ORDER BY "name" ASC,"id" ASC LIMIT 50` },
      { key: 'inventory_list', table: 'Inventory', budgetMs: 500, sql: `SELECT "id","productId","available" FROM "Inventory" WHERE "warehouseId"=${sqlLiteral(warehouse.id)} ORDER BY "updatedAt" DESC,"id" DESC LIMIT 50` },
      { key: 'accounting_event_list', table: 'AccountingEvent', budgetMs: 500, sql: `SELECT "id","eventType","status" FROM "AccountingEvent" WHERE "companyId"=${sqlLiteral(company.id)} AND "branchId"=${sqlLiteral(branch.id)} ORDER BY "createdAt" DESC,"id" DESC LIMIT 50` },
      { key: 'payroll_run_list', table: 'PayrollRun', budgetMs: 1000, sql: `SELECT "id","number","status" FROM "PayrollRun" WHERE "companyId"=${sqlLiteral(company.id)} AND "branchId"=${sqlLiteral(branch.id)} ORDER BY "createdAt" DESC LIMIT 100` },
      { key: 'finance_transaction_list', table: 'OperationalFinanceTransaction', budgetMs: 500, sql: `SELECT "id","number","status" FROM "OperationalFinanceTransaction" WHERE "companyId"=${sqlLiteral(company.id)} AND "branchId"=${sqlLiteral(branch.id)} ORDER BY "transactionDate" DESC,"id" DESC LIMIT 50` },
    ];
    const queryPlans = [];
    for (const definition of planDefinitions) {
      const raw = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${definition.sql}`);
      const payload = raw?.[0]?.['QUERY PLAN'] ?? raw?.[0]?.['query plan'] ?? raw?.[0]?.query_plan;
      const summary = summarizePlan(payload);
      queryPlans.push({ key: definition.key, table: definition.table, budgetMs: definition.budgetMs, ...summary, passed: summary.executionTimeMs <= definition.budgetMs });
    }

    const indexRows = await prisma.$queryRawUnsafe(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Product','Inventory','Warehouse','AccountingEvent','PayrollRun','OperationalFinanceTransaction') ORDER BY tablename,indexname`);
    const requirements = [
      { key: 'product_list', table: 'Product', columns: ['companyId', 'isActive', 'name', 'id'] },
      { key: 'warehouse_branch_lookup', table: 'Warehouse', columns: ['branchId'] },
      { key: 'inventory_list', table: 'Inventory', columns: ['warehouseId', 'updatedAt', 'id'] },
      { key: 'accounting_event_list', table: 'AccountingEvent', columns: ['companyId', 'branchId', 'createdAt', 'id'] },
      { key: 'payroll_run_list', table: 'PayrollRun', columns: ['companyId', 'branchId', 'createdAt'] },
      { key: 'finance_transaction_list', table: 'OperationalFinanceTransaction', columns: ['companyId', 'branchId', 'transactionDate'] },
    ];
    const indexCoverage = requirements.map((requirement) => {
      const candidates = indexRows.filter((row) => row.tablename === requirement.table && indexCovers(row.indexdef, requirement.columns));
      return { ...requirement, passed: candidates.length > 0, indexes: candidates.map((row) => row.indexname) };
    });

    const activityRow = activity[0] || {};
    const automatedChecks = [
      { id: 'HEALTH_ERRORS_ZERO', passed: health.errors === 0, actual: health.errors, expected: 0 },
      { id: 'HEALTH_P95_BUDGET', passed: health.p95Ms <= config.p95BudgetMs, actual: health.p95Ms, expectedMax: config.p95BudgetMs },
      { id: 'OWNERSHIP_ZERO_UNRESOLVED', passed: ownership.productUnresolved === 0 && ownership.supplierUnresolved === 0, actual: ownership },
      { id: 'NO_LONG_RUNNING_QUERY', passed: Number(activityRow.long_running || 0) === 0, actual: Number(activityRow.long_running || 0), expected: 0 },
      { id: 'ACTIVE_CONNECTION_BUDGET', passed: Number(activityRow.active_connections || 0) <= config.maxActiveConnections, actual: Number(activityRow.active_connections || 0), expectedMax: config.maxActiveConnections },
      { id: 'QUERY_PLAN_BUDGETS', passed: queryPlans.every((item) => item.passed), failed: queryPlans.filter((item) => !item.passed).map((item) => item.key) },
      { id: 'CRITICAL_INDEX_COVERAGE', passed: indexCoverage.every((item) => item.passed), failed: indexCoverage.filter((item) => !item.passed).map((item) => item.key) },
      { id: 'PAYROLL_RECOVERY_CONFIGURATION', passed: Object.values(payrollRecoveryConfiguration).every(Boolean), actual: payrollRecoveryConfiguration },
    ];
    const automatedPassed = automatedChecks.every((item) => item.passed);
    const gatePassed = automatedPassed && uat.passed;
    const evidence = sanitize({
      workItem: WORK_ITEM,
      stage: STAGE,
      generatedAt,
      sourceIdentity: sourceFingerprint(root),
      buildArtifactId: buildArtifact.current.id,
      targetMode: config.target,
      target: {
        hostHash: crypto.createHash('sha256').update(config.connection.hostname).digest('hex').slice(0, 16),
        databaseHash: crypto.createHash('sha256').update(config.connection.database).digest('hex').slice(0, 16),
      },
      productionTouched: false,
      previousEvidence: { stage18: true, stage19CurrentSource: true, buildGateCurrentSource: true, buildArtifactCurrent: true, payrollAdjustmentPostgresMigration: true },
      uat: { ...uat, releaseDecision: uatInput.releaseDecision || null, executedAt: uatInput.executedAt || null, rollbackOwner: uatInput.rollbackOwner || null, monitoringOwner: uatInput.monitoringOwner || null, scenarios: uatInput.scenarios.map(({ id, status, notes }) => ({ id, status, notes: notes || '' })) },
      observation: { apiPort: apiPortSelection, health, databaseStats: databaseStats[0] || null, activity: activityRow, ownership, payrollRecoveryConfiguration, recentTenantDenials24h: recentDenials, queues: queueGroups },
      queryPlanReview: { plans: queryPlans, indexCoverage },
      automatedChecks,
      gate: { automatedPassed, uatPassed: uat.passed, passed: gatePassed },
      note: 'Credential, password, raw database URL, token, dan query text sensitif tidak disimpan.',
    });
    fs.writeFileSync(path.join(logDir, 'latest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    fs.writeFileSync(path.join(logDir, 'query-plans.json'), `${JSON.stringify(evidence.queryPlanReview, null, 2)}\n`);
    fs.writeFileSync(path.join(logDir, 'observability.json'), `${JSON.stringify(evidence.observation, null, 2)}\n`);
    const failedAutomated = automatedChecks.filter((item) => !item.passed);
    fs.writeFileSync(path.join(logDir, 'latest.md'), [
      '# Stage 20 — Staging Release Readiness', '',
      `- Automated gate: **${automatedPassed ? 'PASSED' : 'BLOCKED'}**`,
      `- UAT: **${uat.passed ? 'PASSED' : 'PENDING'}**`,
      `- Final gate: **${gatePassed ? 'PASSED' : 'BLOCKED'}**`,
      `- Health p95: ${health.p95Ms} ms (budget ${config.p95BudgetMs} ms)`,
      `- Product unresolved: ${ownership.productUnresolved}`,
      `- Supplier unresolved: ${ownership.supplierUnresolved}`,
      `- Long-running query: ${Number(activityRow.long_running || 0)}`,
      `- Missing critical indexes: ${indexCoverage.filter((item) => !item.passed).map((item) => item.key).join(', ') || 'none'}`,
      `- Query plan over budget: ${queryPlans.filter((item) => !item.passed).map((item) => item.key).join(', ') || 'none'}`,
      `- Failed automated checks: ${failedAutomated.map((item) => item.id).join(', ') || 'none'}`,
      `- UAT pending: ${uat.pending.join(', ') || 'none'}`,
      '- Production: not touched', '',
    ].join('\n'));
    writeApiStartupLog(logDir, apiLog, [
      config.databaseUrl,
      process.env.JWT_SECRET,
      process.env.ORDER_ACCESS_SECRET,
      process.env.SECRET_MASTER_KEY,
    ]);

    if (!automatedPassed) throw new Error(`Gate otomatis Tahap 20 diblokir: ${failedAutomated.map((item) => item.id).join(', ')}.`);
    if (!uat.passed) {
      console.error(`STAGE20_UAT_PENDING: ${uat.pending.join(', ')}`);
      process.exitCode = 2;
      return;
    }
    console.log(`Stage 20 release readiness: PASSED; health p95 ${health.p95Ms} ms; UAT ${uat.total}/${uat.total}.`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await prisma.$disconnect().catch(() => {});
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(`STAGE20_ERROR: ${error.message}`); process.exit(1); });
