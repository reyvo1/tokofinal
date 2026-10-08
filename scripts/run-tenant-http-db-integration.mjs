import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const WORK_ITEM = 'T360-20260802-145524';
const STAGE = 19;
const CONFIRM = 'RUN_T360_STAGE19_NON_PRODUCTION';
const DEFAULT_PORT = 41919;

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
  const target = String(values.T360_STAGE19_TARGET || '').toUpperCase();
  if (!['TEST', 'STAGING'].includes(target)) throw new Error('T360_STAGE19_TARGET harus TEST atau STAGING.');
  if (values.T360_STAGE19_CONFIRM !== CONFIRM) throw new Error(`T360_STAGE19_CONFIRM harus ${CONFIRM}.`);
  const connection = parsePostgresUrl(values.T360_STAGE19_DATABASE_URL, 'T360_STAGE19_DATABASE_URL');
  if (connection.hostname !== values.T360_STAGE19_EXPECTED_HOST) throw new Error('Host target tidak cocok.');
  if (connection.database !== values.T360_STAGE19_EXPECTED_DATABASE) throw new Error('Database target tidak cocok.');
  const unsafe = /(^|[-_.])(prod|production|live)([-_.]|$)/i;
  if (unsafe.test(connection.hostname) || unsafe.test(connection.database)) throw new Error('Target mengandung penanda production/live.');
  if (!(target === 'TEST' ? /test/i : /stag/i).test(connection.database)) throw new Error(`Nama database harus memuat penanda ${target}.`);
  const apiPort = Number(values.T360_STAGE19_API_PORT || DEFAULT_PORT);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw new Error('T360_STAGE19_API_PORT tidak valid.');
  if ([3000,3001,3002,3003,4000].includes(apiPort)) throw new Error('Gunakan port integrasi khusus, bukan port aplikasi utama.');
  return { target, connection, apiPort, databaseUrl: values.T360_STAGE19_DATABASE_URL };
}

export function publicEvidence(evidence) {
  return {
    workItem: WORK_ITEM,
    stage: STAGE,
    generatedAt: evidence.generatedAt,
    sourceIdentity: evidence.sourceIdentity,
    buildArtifactId: evidence.buildArtifactId,
    targetMode: evidence.targetMode,
    target: evidence.target,
    fixtureRunId: evidence.fixtureRunId,
    apiPort: evidence.apiPort,
    tests: evidence.tests,
    summary: evidence.summary,
    auditDenials: evidence.auditDenials,
    cleanup: evidence.cleanup,
    gate: evidence.gate,
    note: 'Credential, password, token, raw database URL, dan response sensitif tidak disimpan.',
  };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env-file') result.envFile = argv[++i];
  }
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const itemsOf = (body) => Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];

async function request(baseUrl, pathname, { token, method = 'GET', body, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    return { status: response.status, body: payload };
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
  throw new Error('Timeout menunggu API staging integration aktif.');
}

function assertStatus(result, expected, label) {
  if (result.status !== expected) {
    const detail = typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null);
    throw new Error(`${label}: status ${result.status}, diharapkan ${expected}; response=${String(detail).slice(0, 1200)}.`);
  }
}
function assertContains(items, id, expected, label) {
  const found = items.some((item) => item?.id === id || item?.productId === id || item?.userId === id);
  if (found !== expected) throw new Error(`${label}: hasil ${found ? 'mengandung' : 'tidak mengandung'} ${id}.`);
}

async function main() {
  const root = process.cwd();
  const currentSourceIdentity = sourceFingerprint(root);
  const logDir = path.join(root, 'logs', 'stage19-tenant-integration');
  const officialEvidenceDir = path.join(root, 'work-items', 'generated', WORK_ITEM, 'evidence');
  const officialEvidencePath = path.join(officialEvidenceDir, `${WORK_ITEM}-stage19-http-db-integration.json`);
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(officialEvidenceDir, { recursive: true });
  const attemptMarker = {
    workItem: WORK_ITEM, stage: STAGE, generatedAt: new Date().toISOString(), sourceIdentity: currentSourceIdentity,
    productionTouched: false, cleanup: { passed: false }, gate: { passed: false }, status: 'FAIL',
    error: 'Stage-19 evidence invalidated at attempt start; a fresh PASS must replace it.'
  };
  fs.writeFileSync(path.join(logDir, 'latest.json'), `${JSON.stringify(attemptMarker, null, 2)}\n`);
  fs.writeFileSync(officialEvidencePath, `${JSON.stringify(attemptMarker, null, 2)}\n`);
  const args = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(root, args.envFile || 'stage19-integration.env');
  const values = { ...process.env, ...readEnvFile(envFile) };
  const config = validateNonProductionConfig(values);
  const stage18Evidence = path.join(root, 'work-items', 'generated', WORK_ITEM, 'evidence', `${WORK_ITEM}-stage18-postgres-staging.json`);
  if (!fs.existsSync(stage18Evidence)) throw new Error('Evidence Tahap 18 tidak ditemukan.');
  const previous = JSON.parse(fs.readFileSync(stage18Evidence, 'utf8'));
  if (!previous.gate?.passed || Number(previous.after?.productUnresolved) !== 0 || Number(previous.after?.supplierUnresolved) !== 0) {
    throw new Error('Gate Tahap 18 belum lulus atau ownership masih unresolved.');
  }
  if (!previous.sourceIdentity?.value) throw new Error('Evidence Tahap 18 belum source-bound; rerun Stage-18 pada source saat ini.');
  if (previous.sourceIdentity.value !== currentSourceIdentity.value) throw new Error('Evidence Tahap 18 berasal dari source fingerprint berbeda; rerun Stage-18 pada source saat ini.');
  const distMain = path.join(root, 'apps', 'api', 'dist', 'main.js');
  if (!fs.existsSync(distMain)) throw new Error('Build API belum tersedia. Jalankan build sebelum integration test.');
  const buildArtifact = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', currentSourceIdentity.value);

  process.env.DATABASE_URL = config.databaseUrl;
  const [{ PrismaClient }, { hash }] = await Promise.all([import('@prisma/client'), import('bcryptjs')]);
  const prisma = new PrismaClient();
  const runId = `s19-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(-14).toUpperCase();
  const password = `T360-${crypto.randomBytes(12).toString('base64url')}!`;
  const passwordHash = await hash(password, 6);
  const state = { companyIds: [], branchIds: [], warehouseIds: [], userIds: [], productIds: [], taxCodeIds: [], masterReferenceIds: [], accountingEventIds: [], payrollRunIds: [], payrollPeriodIds: [], financeIds: [], deviceIds: [], offlineIds: [], orderIds: [], paymentIds: [], outboxIds: [] };
  const tests = [];
  let child;
  let apiLog = '';
  let cleanupPassed = false;

  const record = async (name, fn) => {
    const started = Date.now();
    try { await fn(); tests.push({ name, status: 'PASSED', durationMs: Date.now() - started }); }
    catch (error) { tests.push({ name, status: 'FAILED', durationMs: Date.now() - started, error: error.message }); throw error; }
  };

  const cleanup = async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: { in: state.companyIds } }, { userId: { in: state.userIds } }] } });
    if (state.orderIds.length) {
      await prisma.eventOutbox.deleteMany({ where: { aggregateId: { in: state.orderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: state.orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: state.orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: state.orderIds } } });
    }
    if (state.deviceIds.length) await prisma.offlineTransaction.deleteMany({ where: { deviceId: { in: state.deviceIds } } });
    await prisma.device.deleteMany({ where: { id: { in: state.deviceIds } } });
    await prisma.operationalFinanceTransaction.deleteMany({ where: { id: { in: state.financeIds } } });
    await prisma.payrollRun.deleteMany({ where: { id: { in: state.payrollRunIds } } });
    await prisma.payrollPeriod.deleteMany({ where: { id: { in: state.payrollPeriodIds } } });
    await prisma.accountingEvent.deleteMany({ where: { id: { in: state.accountingEventIds } } });
    await prisma.taxCode.deleteMany({ where: { id: { in: state.taxCodeIds } } });
    await prisma.masterReference.deleteMany({ where: { id: { in: state.masterReferenceIds } } });
    await prisma.inventory.deleteMany({ where: { warehouseId: { in: state.warehouseIds } } });
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: state.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: state.userIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: state.warehouseIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: state.branchIds } } });
    await prisma.company.deleteMany({ where: { id: { in: state.companyIds } } });
    cleanupPassed = true;
  };

  try {
    await prisma.$connect();
    const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
    if (!role) throw new Error('Role SUPER_ADMIN tidak tersedia pada staging.');

    const companyA = await prisma.company.create({ data: { name: `Stage19 Company A ${suffix}`, slug: `s19-a-${suffix.toLowerCase()}` } });
    const companyB = await prisma.company.create({ data: { name: `Stage19 Company B ${suffix}`, slug: `s19-b-${suffix.toLowerCase()}` } });
    state.companyIds.push(companyA.id, companyB.id);
    const branchA = await prisma.branch.create({ data: { companyId: companyA.id, code: `S19A${suffix}`, name: `Stage19 Branch A ${suffix}` } });
    const branchB = await prisma.branch.create({ data: { companyId: companyB.id, code: `S19B${suffix}`, name: `Stage19 Branch B ${suffix}` } });
    state.branchIds.push(branchA.id, branchB.id);
    const warehouseA = await prisma.warehouse.create({ data: { branchId: branchA.id, code: `S19WA${suffix}`, name: 'Stage19 Warehouse A', isDefault: true } });
    const warehouseB = await prisma.warehouse.create({ data: { branchId: branchB.id, code: `S19WB${suffix}`, name: 'Stage19 Warehouse B', isDefault: true } });
    state.warehouseIds.push(warehouseA.id, warehouseB.id);

    const userA = await prisma.user.create({ data: { branchId: branchA.id, name: 'Stage19 Admin A', email: `s19-a-${suffix.toLowerCase()}@example.invalid`, passwordHash } });
    const userB = await prisma.user.create({ data: { branchId: branchB.id, name: 'Stage19 Admin B', email: `s19-b-${suffix.toLowerCase()}@example.invalid`, passwordHash } });
    const noBranch = await prisma.user.create({ data: { branchId: null, name: 'Stage19 No Branch', email: `s19-n-${suffix.toLowerCase()}@example.invalid`, passwordHash } });
    state.userIds.push(userA.id, userB.id, noBranch.id);
    await prisma.userRole.createMany({ data: state.userIds.map((userId) => ({ userId, roleId: role.id })) });

    const unitA = await prisma.masterReference.create({ data: { companyId: companyA.id, branchId: null, type: 'UNIT', code: `S19UNIT${suffix}`, name: 'Stage19 Base Unit', isActive: true } });
    const unitB = await prisma.masterReference.create({ data: { companyId: companyB.id, branchId: null, type: 'UNIT', code: `S19UNIT${suffix}`, name: 'Stage19 Base Unit', isActive: true } });
    state.masterReferenceIds.push(unitA.id, unitB.id);

    const productA = await prisma.product.create({ data: { companyId: companyA.id, sku: `S19-PA-${suffix}`, name: 'Stage19 Product A', unit: unitA.code, costPrice: 10, salePrice: 15 } });
    const productB = await prisma.product.create({ data: { companyId: companyB.id, sku: `S19-PB-${suffix}`, name: 'Stage19 Product B', unit: unitB.code, costPrice: 20, salePrice: 30 } });
    state.productIds.push(productA.id, productB.id);
    await prisma.inventory.createMany({ data: [
      { warehouseId: warehouseA.id, productId: productA.id, quantity: 20, available: 20 },
      { warehouseId: warehouseB.id, productId: productB.id, quantity: 25, available: 25 },
    ] });

    const taxA = await prisma.taxCode.create({ data: { companyId: companyA.id, code: `S19-TA-${suffix}`, name: 'Stage19 Tax A', scope: 'SALE', rate: 0.11, status: 'ACTIVE' } });
    const taxB = await prisma.taxCode.create({ data: { companyId: companyB.id, code: `S19-TB-${suffix}`, name: 'Stage19 Tax B', scope: 'SALE', rate: 0.11, status: 'ACTIVE' } });
    state.taxCodeIds.push(taxA.id, taxB.id);

    // Public order creation requires an active fulfillment reference. Keep the fixture tenant-local
    // so Stage-19 exercises the real storefront contract rather than bypassing fulfillment rules.
    const courierA = await prisma.masterReference.create({ data: { companyId: companyA.id, branchId: branchA.id, type: 'COURIER', code: `S19-LOCAL-${suffix}`, name: 'Stage19 Local Delivery', metadata: { fulfillmentType: 'DELIVERY', price: 0, requiresAddress: true } } });
    const courierB = await prisma.masterReference.create({ data: { companyId: companyB.id, branchId: branchB.id, type: 'COURIER', code: `S19-LOCAL-${suffix}`, name: 'Stage19 Local Delivery', metadata: { fulfillmentType: 'DELIVERY', price: 0, requiresAddress: true } } });
    state.masterReferenceIds.push(courierA.id, courierB.id);

    const eventA = await prisma.accountingEvent.create({ data: { companyId: companyA.id, branchId: branchA.id, eventType: 'STAGE19_A', sourceType: 'Stage19', sourceId: runId, idempotencyKey: `${runId}:event:a` } });
    const eventB = await prisma.accountingEvent.create({ data: { companyId: companyB.id, branchId: branchB.id, eventType: 'STAGE19_B', sourceType: 'Stage19', sourceId: runId, idempotencyKey: `${runId}:event:b` } });
    state.accountingEventIds.push(eventA.id, eventB.id);

    const periodA = await prisma.payrollPeriod.create({ data: { companyId: companyA.id, code: `S19-PA-${suffix}`, year: 2098, month: 1, startDate: new Date('2098-01-01'), endDate: new Date('2098-01-31') } });
    const periodB = await prisma.payrollPeriod.create({ data: { companyId: companyB.id, code: `S19-PB-${suffix}`, year: 2098, month: 2, startDate: new Date('2098-02-01'), endDate: new Date('2098-02-28') } });
    state.payrollPeriodIds.push(periodA.id, periodB.id);
    const payrollA = await prisma.payrollRun.create({ data: { companyId: companyA.id, branchId: branchA.id, payrollPeriodId: periodA.id, number: `S19-PAY-A-${suffix}`, createdById: userA.id } });
    const payrollB = await prisma.payrollRun.create({ data: { companyId: companyB.id, branchId: branchB.id, payrollPeriodId: periodB.id, number: `S19-PAY-B-${suffix}`, createdById: userB.id } });
    state.payrollRunIds.push(payrollA.id, payrollB.id);

    const financeA = await prisma.operationalFinanceTransaction.create({ data: { companyId: companyA.id, branchId: branchA.id, number: `S19-FIN-A-${suffix}`, type: 'OTHER', description: 'Stage19 A', debitAccountCode: '1101', creditAccountCode: '3101', idempotencyKey: `${runId}:finance:a`, createdById: userA.id } });
    const financeB = await prisma.operationalFinanceTransaction.create({ data: { companyId: companyB.id, branchId: branchB.id, number: `S19-FIN-B-${suffix}`, type: 'OTHER', description: 'Stage19 B', debitAccountCode: '1101', creditAccountCode: '3101', idempotencyKey: `${runId}:finance:b`, createdById: userB.id } });
    state.financeIds.push(financeA.id, financeB.id);

    const deviceA = await prisma.device.create({ data: { companyId: companyA.id, branchId: branchA.id, warehouseId: warehouseA.id, code: `S19-DEV-${suffix}`, name: 'Stage19 Device A', platform: 'TEST', isActive: true } });
    state.deviceIds.push(deviceA.id);

    const apiPort = config.apiPort;
    const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
    const apiLogFile = path.join(root, 'logs', 'stage19-tenant-integration', `${runId}-api.log`);
    fs.mkdirSync(path.dirname(apiLogFile), { recursive: true });
    child = spawn(process.execPath, [distMain], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: config.databaseUrl, API_PORT: String(apiPort), JWT_SECRET: crypto.randomBytes(32).toString('hex'), ORDER_ACCESS_SECRET: crypto.randomBytes(32).toString('hex'), NODE_ENV: 'test', CORS_ORIGINS: '', T360_SOURCE_FINGERPRINT: currentSourceIdentity.value, T360_BUILD_ARTIFACT_ID: buildArtifact.current.id },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child.stdout.on('data', (chunk) => { apiLog += chunk.toString(); });
    child.stderr.on('data', (chunk) => { apiLog += chunk.toString(); });
    await waitForHealth(baseUrl, child, Number(values.T360_STAGE19_API_START_TIMEOUT_MS || 60000));

    const login = async (email) => {
      const result = await request(baseUrl, '/auth/login', { method: 'POST', body: { email, password } });
      assertStatus(result, 201, `Login ${email}`);
      if (!result.body?.accessToken) throw new Error(`Login ${email} tidak mengembalikan token.`);
      return result.body.accessToken;
    };
    const tokenA = await login(userA.email);
    const tokenB = await login(userB.email);
    const tokenNoBranch = await login(noBranch.email);

    await record('health endpoint aktif pada API staging terisolasi dan exact artifact terverifikasi', async () => {
      const result = await request(baseUrl, '/health'); assertStatus(result, 200, 'Health');
      if (result.body?.release?.sourceFingerprint !== currentSourceIdentity.value) throw new Error('Stage19 runtime source fingerprint mismatch.');
      if (result.body?.release?.buildArtifactId !== buildArtifact.current.id) throw new Error('Stage19 runtime build artifact mismatch.');
    });
    await record('produk tenant A tidak membaca produk tenant B', async () => {
      const result = await request(baseUrl, '/products?limit=100', { token: tokenA }); assertStatus(result, 200, 'Product list');
      const items = itemsOf(result.body); assertContains(items, productA.id, true, 'Product A'); assertContains(items, productB.id, false, 'Product B');
      const denied = await request(baseUrl, `/products/${productB.id}`, { token: tokenA }); assertStatus(denied, 403, 'Cross-tenant product');
    });
    await record('stok dan warehouse tenant A tidak membaca tenant B', async () => {
      const result = await request(baseUrl, '/inventory?limit=100', { token: tokenA }); assertStatus(result, 200, 'Inventory list');
      const items = itemsOf(result.body); assertContains(items, productA.id, true, 'Inventory A'); assertContains(items, productB.id, false, 'Inventory B');
      const denied = await request(baseUrl, `/inventory?warehouseId=${warehouseB.id}`, { token: tokenA }); assertStatus(denied, 403, 'Cross-tenant warehouse');
    });
    await record('jurnal/accounting event dibatasi company dan branch token', async () => {
      const result = await request(baseUrl, '/accounting-core/events?limit=100', { token: tokenA }); assertStatus(result, 200, 'Accounting events');
      const items = itemsOf(result.body); assertContains(items, eventA.id, true, 'Event A'); assertContains(items, eventB.id, false, 'Event B');
      const denied = await request(baseUrl, `/accounting-core/events?companyId=${companyB.id}`, { token: tokenA }); assertStatus(denied, 403, 'Cross-tenant accounting override');
    });
    await record('tax code dibatasi company token', async () => {
      const result = await request(baseUrl, '/accounting-core/tax-codes', { token: tokenA }); assertStatus(result, 200, 'Tax codes');
      const items = itemsOf(result.body); assertContains(items, taxA.id, true, 'Tax A'); assertContains(items, taxB.id, false, 'Tax B');
      const denied = await request(baseUrl, `/accounting-core/tax-codes?companyId=${companyB.id}`, { token: tokenA }); assertStatus(denied, 403, 'Cross-tenant tax override');
    });
    await record('payroll run dibatasi company dan branch token', async () => {
      const result = await request(baseUrl, '/payroll/runs', { token: tokenA }); assertStatus(result, 200, 'Payroll runs');
      const items = itemsOf(result.body); assertContains(items, payrollA.id, true, 'Payroll A'); assertContains(items, payrollB.id, false, 'Payroll B');
      const denied = await request(baseUrl, `/payroll/runs?companyId=${companyB.id}`, { token: tokenA }); assertStatus(denied, 403, 'Cross-tenant payroll override');
    });
    await record('finance/payment operations dibatasi tenant token', async () => {
      const result = await request(baseUrl, '/finance-operations?limit=100', { token: tokenA }); assertStatus(result, 200, 'Finance list');
      const items = itemsOf(result.body); assertContains(items, financeA.id, true, 'Finance A'); assertContains(items, financeB.id, false, 'Finance B');
      const denied = await request(baseUrl, `/finance-operations?companyId=${companyB.id}&branchId=${branchB.id}`, { token: tokenA }); assertStatus(denied, 403, 'Cross-tenant finance override');
      const orderPayload = { branchCode: branchA.code, customerName: 'Stage19 Customer', address: 'Stage19 Address', items: [{ productId: productA.id, quantity: 1 }] };
      const orderKey = `stage19-order-${runId}`;
      const order = await request(baseUrl, '/orders', { method: 'POST', headers: { 'idempotency-key': orderKey }, body: orderPayload });
      assertStatus(order, 201, 'Create public order');
      const replay = await request(baseUrl, '/orders', { method: 'POST', headers: { 'idempotency-key': orderKey }, body: orderPayload });
      assertStatus(replay, 201, 'Replay public order');
      if (replay.body.id !== order.body.id || replay.body.number !== order.body.number) throw new Error('Replay order dengan operation key sama menghasilkan pesanan kedua.');
      state.orderIds.push(order.body.id); state.paymentIds.push(...(order.body.payments || []).map((item) => item.id));
      const wrongBranch = await request(baseUrl, `/orders/${order.body.number}`, { headers: { 'x-branch-code': branchB.code, 'x-order-access-token': order.body.accessToken } });
      assertStatus(wrongBranch, 404, 'Cross-tenant public order detail');
      const wrongPayment = await request(baseUrl, `/orders/${order.body.number}/mock-pay`, { method: 'POST', body: { paymentMethod: 'MOCK_QRIS' }, headers: { 'x-branch-code': branchB.code, 'x-order-access-token': order.body.accessToken } });
      assertStatus(wrongPayment, 404, 'Cross-tenant public payment');
    });
    await record('user list tidak membocorkan user branch lain', async () => {
      const result = await request(baseUrl, '/users', { token: tokenA }); assertStatus(result, 200, 'Users list');
      const items = itemsOf(result.body); assertContains(items, userA.id, true, 'User A'); assertContains(items, userB.id, false, 'User B');
    });
    await record('token tanpa branch assignment ditolak', async () => {
      const result = await request(baseUrl, '/inventory', { token: tokenNoBranch }); assertStatus(result, 403, 'No-branch token');
    });
    await record('offline sync mempertahankan tenant envelope dan retry idempoten', async () => {
      const item = { localId: `${runId}-local-1`, sequence: 1, transactionType: 'TEST', payload: { value: 1 } };
      const first = await request(baseUrl, `/devices/${deviceA.id}/offline-transactions`, { token: tokenA, method: 'POST', body: { transactions: [item] } }); assertStatus(first, 201, 'Offline first');
      const second = await request(baseUrl, `/devices/${deviceA.id}/offline-transactions`, { token: tokenA, method: 'POST', body: { transactions: [item] } }); assertStatus(second, 201, 'Offline retry');
      if (first.body.transactions?.[0]?.id !== second.body.transactions?.[0]?.id) throw new Error('Retry offline menghasilkan record berbeda.');
      const altered = await request(baseUrl, `/devices/${deviceA.id}/offline-transactions`, { token: tokenA, method: 'POST', body: { transactions: [{ ...item, payload: { value: 2 } }] } }); assertStatus(altered, 400, 'Offline altered replay');
      const foreign = await request(baseUrl, `/devices/${deviceA.id}/offline-transactions`, { token: tokenB, method: 'POST', body: { transactions: [item] } }); assertStatus(foreign, 403, 'Offline foreign device');
    });
    await record('denial lintas tenant tercatat pada audit database', async () => {
      const count = await prisma.auditLog.count({ where: { companyId: companyA.id, action: 'TENANT_ACCESS_DENIED' } });
      if (count < 6) throw new Error(`Audit denial terlalu sedikit: ${count}.`);
    });

    const denialCount = await prisma.auditLog.count({ where: { companyId: companyA.id, action: 'TENANT_ACCESS_DENIED' } });
    const evidence = {
      generatedAt: new Date().toISOString(), sourceIdentity: currentSourceIdentity, buildArtifactId: buildArtifact.current.id, targetMode: config.target,
      target: { hostHash: crypto.createHash('sha256').update(config.connection.hostname).digest('hex').slice(0, 16), databaseHash: crypto.createHash('sha256').update(config.connection.database).digest('hex').slice(0, 16) },
      fixtureRunId: runId, apiPort: config.apiPort, tests,
      summary: { total: tests.length, passed: tests.filter((item) => item.status === 'PASSED').length, failed: tests.filter((item) => item.status === 'FAILED').length },
      auditDenials: denialCount, cleanup: { passed: false }, gate: { passed: tests.every((item) => item.status === 'PASSED') && denialCount >= 6 },
    };
    fs.writeFileSync(apiLogFile, apiLog.replaceAll(config.databaseUrl, '[REDACTED_DATABASE_URL]'));
    await cleanup();
    evidence.cleanup.passed = cleanupPassed;
    evidence.gate.passed = evidence.gate.passed && cleanupPassed;
    const publicResult = publicEvidence(evidence);
    fs.writeFileSync(path.join(logDir, 'latest.json'), `${JSON.stringify(publicResult, null, 2)}\n`);
    fs.writeFileSync(officialEvidencePath, `${JSON.stringify(publicResult, null, 2)}\n`);
    fs.writeFileSync(path.join(logDir, 'latest.md'), `# Stage 19 — HTTP/DB Tenant Integration\n\n- Status: **${evidence.gate.passed ? 'PASSED' : 'FAILED'}**\n- Tests: ${evidence.summary.passed}/${evidence.summary.total}\n- Audit denials: ${denialCount}\n- Cleanup: ${cleanupPassed ? 'passed' : 'failed'}\n- Source fingerprint: ${evidence.sourceIdentity.value}\n- Build artifact: ${evidence.buildArtifactId}\n- Production: not touched\n`);
    if (!evidence.gate.passed) throw new Error('Gate integration Tahap 19 gagal.');
    console.log(`Stage 19 integration: PASSED (${evidence.summary.passed}/${evidence.summary.total}); cleanup passed.`);
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { console.error(`STAGE19_CLEANUP_ERROR: ${cleanupError.message}`); }
    fs.writeFileSync(path.join(logDir, 'latest-failure.txt'), `${error.stack || error.message}\n\nAPI LOG:\n${apiLog.slice(-20000)}\n`);
    throw error;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(`STAGE19_ERROR: ${error.message}`); process.exit(1); });
