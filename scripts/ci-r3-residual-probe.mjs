#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-r3-residual-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential R3 residual probe tidak tersedia.');
const prisma = new PrismaClient();

async function request(route, { method = 'GET', body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 1200)}`);
  return data;
}

function tokenIdentity(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  if (!payload.sub || !payload.companyId || !payload.branchId) throw new Error('JWT R3 residual tidak memiliki sub/companyId/branchId.');
  return { sub: payload.sub, companyId: payload.companyId, branchId: payload.branchId };
}

try {
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.accessToken;
  if (!token) throw new Error('Login R3 residual tidak menghasilkan access token.');
  const identity = tokenIdentity(token);
  const stamp = Date.now();

  const paymentFixture = await prisma.paymentProviderEvent.create({ data: {
    companyId: identity.companyId,
    branchId: identity.branchId,
    integrationId: `r3-payment-${stamp}`,
    provider: 'R3_PROBE',
    eventId: `evt-${stamp}`,
    eventType: 'payment.updated',
    externalRef: `R3-${stamp}`,
    amount: 12345,
    requestHash: createHash('sha256').update(`r3-payment-${stamp}`).digest('hex'),
    status: 'FAILED',
    payload: { probe: 'R3_RESIDUAL' },
    error: 'synthetic diagnostic fixture',
    processedAt: new Date(),
  } });
  const paymentEvents = await request('/payments/provider-events?provider=R3_PROBE&limit=20', { token });
  const paymentVisible = paymentEvents.some((row) => row.id === paymentFixture.id && row.status === 'FAILED' && row.error);

  const digestConfig = await request('/reports/daily-digest/config', { token });
  const multiOutlet = await request('/reports/multi-outlet', { token });

  // CashierTargetService intentionally rejects users who are not active CASHIERs in the
  // authenticated branch. Bootstrap CI deliberately creates only the admin/employee identities,
  // so using identity.sub here couples this probe to invalid seed residue and makes a clean
  // PostgreSQL run fail for the correct business reason. Build a real operator fixture through
  // the same Users API an administrator uses, and reuse an existing active cashier when one is
  // already present so retries stay idempotent.
  const users = await request('/users', { token });
  let cashier = Array.isArray(users)
    ? users.find((candidate) => candidate?.isActive === true
      && Array.isArray(candidate?.roles)
      && candidate.roles.some((assignment) => assignment?.role?.name === 'CASHIER'))
    : null;
  let cashierFixtureAction = 'EXISTING';
  if (!cashier) {
    cashier = await request('/users', {
      method: 'POST',
      token,
      body: {
        name: 'R3 CI Cashier',
        email: `r3-cashier-${identity.branchId}@example.invalid`,
        password: 'R3-CI-Cashier-Password-2026!',
        roleNames: ['CASHIER'],
      },
    });
    cashierFixtureAction = 'CREATED';
  }
  if (!cashier?.id || cashier?.isActive === false) throw new Error('Fixture kasir aktif R3 tidak tersedia.');

  const targetValue = 250000 + (stamp % 10000);
  await request('/sales/cashier-targets', { method: 'POST', token, body: { targets: { [cashier.id]: targetValue } } });
  const cashierTargets = await request('/sales/cashier-targets', { token });
  const cashierTargetVisible = cashierTargets.rows?.some((row) => row.userId === cashier.id && Number(row.target) === targetValue);

  const device = await request('/devices', { method: 'POST', token, body: {
    code: `R3-${stamp}`,
    name: `R3 Edge Probe ${stamp}`,
    platform: 'POS_WEB',
    appVersion: 'r3-probe',
  } });
  const checkpoint = new Date();
  const receipt = await prisma.syncReceipt.create({ data: {
    deviceId: device.id,
    companyId: identity.companyId,
    branchId: identity.branchId,
    since: new Date(checkpoint.getTime() - 60000),
    checkpoint,
    eventCount: 1,
    eventIds: [`r3-event-${stamp}`],
    requestHash: createHash('sha256').update(`r3-receipt-${stamp}`).digest('hex'),
    status: 'ISSUED',
  } });
  const offline = await prisma.offlineTransaction.create({ data: {
    deviceId: device.id,
    localId: `local-${stamp}`,
    sequence: Number(String(stamp).slice(-8)),
    transactionType: 'SALE',
    payload: { companyId: identity.companyId, branchId: identity.branchId, probe: true },
    status: 'FAILED',
    errorMessage: 'synthetic retry fixture',
    attempts: 2,
  } });
  const diagnostics = await request(`/devices/${device.id}/sync/diagnostics?limit=20`, { token });
  const receiptVisible = diagnostics.receipts?.some((row) => row.id === receipt.id && row.status === 'ISSUED');
  const offlineVisible = diagnostics.offlineTransactions?.some((row) => row.id === offline.id && row.status === 'FAILED');
  await request(`/devices/${device.id}/sync/ack`, { method: 'POST', token, body: { receiptId: receipt.id, checkpoint: checkpoint.toISOString() } });
  await request(`/devices/${device.id}/offline-transactions/${offline.id}/requeue`, { method: 'POST', token, body: {} });
  const [acked, requeued] = await Promise.all([
    prisma.syncReceipt.findUnique({ where: { id: receipt.id } }),
    prisma.offlineTransaction.findUnique({ where: { id: offline.id } }),
  ]);

  const integration = await prisma.integrationConnection.create({ data: {
    companyId: identity.companyId,
    branchId: identity.branchId,
    type: 'MARKETPLACE',
    provider: 'R3_PROBE',
    name: `R3 Marketplace ${stamp}`,
    status: 'CONNECTED',
  } });
  const marketplace = await request('/marketplace-orders/import', { method: 'POST', token, body: {
    integrationId: integration.id,
    externalOrderId: `R3-ORDER-${stamp}`,
    marketplace: 'R3_PROBE',
    shopId: 'CI',
    status: 'PAID',
    orderData: { probe: true, source: 'R3_RESIDUAL' },
  } });
  const marketplaceOrders = await request('/marketplace-orders', { token });
  const marketplaceVisible = marketplaceOrders.some((row) => row.id === marketplace.id && row.externalOrderId === `R3-ORDER-${stamp}`);

  const checks = {
    paymentProviderDiagnostics: Boolean(paymentVisible),
    dailyDigestDiscoverable: digestConfig && typeof digestConfig.enabled === 'boolean',
    multiOutletDiscoverable: Boolean(multiOutlet?.totals && Array.isArray(multiOutlet?.ranked)),
    cashierTargetLifecycle: Boolean(cashierTargetVisible),
    edgeDiagnosticsRead: Boolean(receiptVisible && offlineVisible),
    edgeReceiptAcknowledge: acked?.status === 'ACKNOWLEDGED' && Boolean(acked.acknowledgedAt),
    edgeDeadLetterRequeue: requeued?.status === 'PENDING' && requeued?.errorMessage === null,
    marketplaceOrderOperatorRuntime: Boolean(marketplaceVisible),
  };
  for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`R3 residual runtime check gagal: ${name}`);

  const result = {
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    sourceIdentity: sourceFingerprint(root),
    checks,
    productionTouched: false,
    deviceId: device.id,
    marketplaceOrderId: marketplace.id,
    paymentProviderEventId: paymentFixture.id,
    cashierUserId: cashier.id,
    cashierFixtureAction,
    note: 'R3 residual exact-runtime probe proves F37 payment diagnostics, F39 report discoverability/target lifecycle with a real active branch cashier, F42 edge diagnostics + ack/requeue, and F43 MarketplaceOrder operator runtime on PostgreSQL.',
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}
