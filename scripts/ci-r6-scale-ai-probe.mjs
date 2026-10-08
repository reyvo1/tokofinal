#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { businessDateKeyInTimeZone, companyTimeZoneFromBranchContext } from './lib/business-date-key.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-r6-scale-ai-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential R6 probe tidak tersedia.');
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

function tokenScope(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  if (!payload.companyId || !payload.branchId) throw new Error('JWT R6 tidak memiliki companyId/branchId.');
  return { companyId: payload.companyId, branchId: payload.branchId };
}

try {
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.accessToken;
  if (!token) throw new Error('Login R6 tidak menghasilkan access token.');
  const scope = tokenScope(token);
  const stamp = Date.now();
  const now = new Date();
  const branchContext = await request('/auth/branch-context', { token });
  const companyTimeZone = companyTimeZoneFromBranchContext(branchContext);
  const businessDate = businessDateKeyInTimeZone(now, companyTimeZone);
  const warehouses = await request('/inventory/warehouses', { token });
  const warehouse = warehouses?.[0];
  if (!warehouse?.id) throw new Error('Gudang R6 runtime tidak tersedia.');
  const accounts = await request('/accounting-core/accounts', { token });
  const account = accounts?.find((row) => row.isActive);
  if (!account?.id) throw new Error('Account R6 runtime tidak tersedia.');

  await prisma.sale.create({ data: {
    number: `R6-SALE-${stamp}`, branchId: scope.branchId, warehouseId: warehouse.id, channel: 'POS', status: 'COMPLETED',
    subtotal: 120000, discount: 10000, tax: 11000, total: 121000, costTotal: 70000, createdAt: now,
  } });
  await prisma.journalEntry.create({ data: {
    number: `R6-JRN-${stamp}`, date: now, referenceType: 'R6Probe', referenceId: `r6-${stamp}`, description: 'R6 summary materialization fixture',
    lines: { create: [{ accountId: account.id, debit: 50000, credit: 0 }] },
  } });
  const materialized = await request('/analytics/daily-summaries/materialize', { method: 'POST', token, body: { businessDate } });
  const summaries = await request(`/analytics/daily-summaries?from=${businessDate}&to=${businessDate}`, { token });
  const saleSummary = summaries.sales?.find((row) => row.channel === 'POS' && Number(row.transactionCount) >= 1);
  const financeSummary = summaries.finance?.find((row) => row.accountId === account.id && Number(row.debit) >= 50000);
  if (!saleSummary || !financeSummary || materialized.salesChannels < 1 || materialized.financeAccounts < 1) {
    throw new Error(`R6 daily summary materialization tidak menghasilkan aggregate runtime yang diharapkan. businessDate=${businessDate} timezone=${companyTimeZone} sourceSales=${materialized.sourceSales} sourceJournalLines=${materialized.sourceJournalLines} salesChannels=${materialized.salesChannels} financeAccounts=${materialized.financeAccounts}`);
  }

  const assistant = await request('/operator-assistant/query', { method: 'POST', token, body: { question: 'Ringkas kondisi operasional yang tersedia.', intent: 'AUTO' } });
  const aiTruth = assistant.capabilityType === 'DETERMINISTIC_RULE_BASED' && assistant.aiProvider === null && /tidak memakai model AI\/LLM eksternal/i.test(assistant.guardrail || '');
  if (!aiTruth) throw new Error(`R6 capability truth assistant tidak eksplisit: ${JSON.stringify(assistant)}`);

  const policy = await request('/retention/policies', { method: 'POST', token, body: { entityType: 'AUDIT_LOG', hotDays: 1, warmDays: 1, archiveAfter: true, isActive: true } });
  const oldAudit = await prisma.auditLog.create({ data: { companyId: scope.companyId, userId: login.user?.sub || null, action: 'R6_ARCHIVE_FIXTURE', entityType: 'R6Probe', entityId: String(stamp), payload: { runtimeProbe: 'R6' }, createdAt: new Date(Date.now() - 10 * 86400000) } });
  const archive = await request('/retention/archive-runs', { method: 'POST', token, body: { policyId: policy.id, rangeEnd: new Date(Date.now() - 2 * 86400000).toISOString(), confirmation: 'ARCHIVE' } });
  if (archive.status !== 'COMPLETED' || archive.rowsProcessed < 1 || !String(archive.archiveUri || '').startsWith('local://') || !/^[a-f0-9]{64}$/.test(archive.checksum || '')) throw new Error(`R6 archive lifecycle gagal: ${JSON.stringify(archive)}`);
  const archiveRelativePath = String(archive.archiveUri).replace(/^local:\/\//, '');
  const archiveCandidates = [
    path.resolve(root, archiveRelativePath),
    path.resolve(root, 'apps/api', archiveRelativePath),
  ];
  const archivedFile = archiveCandidates.find((candidate) => fs.existsSync(candidate));
  if (!archivedFile || !fs.readFileSync(archivedFile, 'utf8').includes(oldAudit.id)) {
    throw new Error(`R6 archive artifact tidak memuat fixture tenant yang diarsipkan. candidates=${archiveCandidates.join(',')}`);
  }

  const integration = await prisma.integrationConnection.create({ data: { companyId: scope.companyId, branchId: scope.branchId, type: 'MARKETPLACE', provider: 'R6_PROBE', name: `R6 ${stamp}`, status: 'CONNECTED' } });
  const imported = await request('/marketplace-orders/import', { method: 'POST', token, body: { integrationId: integration.id, externalOrderId: `EXT-${stamp}`, marketplace: 'R6_PROBE', shopId: 'CI', status: 'PAID', orderData: { probe: true } } });
  const adapterMappings = await request(`/integrations/${integration.id}/mappings`, { token });
  const adapterMapping = adapterMappings.find((row) => row.entityType === 'MarketplaceOrder' && row.internalId === imported.id && row.externalId === `EXT-${stamp}`);
  if (!adapterMapping) throw new Error('R6 marketplace adapter tidak mematerialisasi ExternalMapping.');
  const manualMapping = await request(`/integrations/${integration.id}/mappings`, { method: 'POST', token, body: { entityType: 'Product', internalId: `internal-${stamp}`, externalId: `external-${stamp}`, metadata: { runtimeProbe: 'R6' } } });
  await request(`/integrations/${integration.id}/mappings/${manualMapping.id}`, { method: 'DELETE', token });
  const mappingsAfterDelete = await request(`/integrations/${integration.id}/mappings`, { token });
  if (mappingsAfterDelete.some((row) => row.id === manualMapping.id)) throw new Error('R6 ExternalMapping delete lifecycle tidak persist.');

  const closeControls = await request('/accounting-core/close-controls', { token });
  if (!Array.isArray(closeControls) || closeControls.length < 1) throw new Error('R6 tidak menemukan AccountingCloseControl yang sebelumnya dibuktikan R4 runtime probe.');

  const checks = {
    deterministicCapabilityTruth: aiTruth,
    dailySalesSummaryMaterialized: Boolean(saleSummary),
    dailyFinanceSummaryMaterialized: Boolean(financeSummary),
    retentionPolicyRuntime: policy.isActive === true && policy.archiveAfter === true,
    archiveArtifactRuntime: archive.status === 'COMPLETED' && archive.rowsProcessed >= 1,
    externalMappingAdapterRuntime: Boolean(adapterMapping),
    externalMappingLifecycle: !mappingsAfterDelete.some((row) => row.id === manualMapping.id),
    accountingCloseControlCanonical: closeControls.length >= 1,
  };
  for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`R6 runtime check gagal: ${name}`);
  const result = { generatedAt: new Date().toISOString(), status: 'PASS', sourceIdentity: sourceFingerprint(root), checks, productionTouched: false, archiveRunId: archive.id, integrationId: integration.id, note: 'R6 exact-runtime probe proves deterministic capability truth, daily summary materialization, retention/archive artifact lifecycle, ExternalMapping adapter/lifecycle use, and continued canonical AccountingCloseControl on live PostgreSQL.' };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}
