#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { businessDateKeyInTimeZone, companyTimeZoneFromBranchContext } from './lib/business-date-key.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-p3-productization-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential P3 probe tidak tersedia.');
const prisma = new PrismaClient();

async function request(route, { method = 'GET', body, token, expectedStatus } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expectedStatus !== undefined) {
    if (response.status !== expectedStatus) throw new Error(`${method} ${route} HTTP ${response.status}, expected ${expectedStatus}: ${text.slice(0, 1200)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 1200)}`);
  return data;
}

function jwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) throw new Error('JWT P3 tidak valid.');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function assertCapabilityTruth(manifest) {
  const entries = Object.entries(manifest?.features || {});
  if (!entries.length) throw new Error('P3 manifest tidak memiliki feature catalog.');
  const allowedClasses = new Set(['OPERATIONAL', 'LIMITED', 'FOUNDATION', 'ADAPTER_REQUIRED']);
  const invalid = [];
  for (const [key, feature] of entries) {
    const config = feature?.config || {};
    if (!allowedClasses.has(config.maturityClass)
      || !String(config.operatorVisibility || '').trim()
      || !String(config.ownership || '').trim()
      || !String(config.helpText || '').trim()
      || !String(config.maturity || '').trim()) invalid.push(key);
  }
  if (invalid.length) throw new Error(`P3 maturity truth tidak lengkap untuk: ${invalid.join(', ')}`);
  const adapter = entries.find(([, feature]) => feature?.config?.maturityClass === 'ADAPTER_REQUIRED');
  const foundation = entries.find(([, feature]) => feature?.config?.maturityClass === 'FOUNDATION');
  if (!adapter || !foundation) throw new Error('P3 membutuhkan contoh capability ADAPTER_REQUIRED dan FOUNDATION pada runtime catalog.');
  if (adapter[1].config.operatorVisibility === 'OPERATOR_VISIBLE' || foundation[1].config.operatorVisibility === 'OPERATOR_VISIBLE') {
    throw new Error('P3 capability non-operational masquerade sebagai operator-visible operational.');
  }
  return { featureCount: entries.length, adapterKey: adapter[0], foundationKey: foundation[0] };
}

let insightId = null;
let apiKeyId = null;
try {
  const primaryLogin = await request('/auth/login', { method: 'POST', body: { email, password } });
  const primaryToken = primaryLogin.accessToken;
  if (!primaryToken) throw new Error('Login primary P3 tidak menghasilkan access token.');
  const primaryPayload = jwtPayload(primaryToken);
  if (!primaryPayload.companyId || !primaryPayload.branchId || !primaryPayload.sid) throw new Error('JWT primary P3 tidak memiliki tenant/session scope lengkap.');

  const secondaryLogin = await request('/auth/login', { method: 'POST', body: { email, password } });
  const secondaryToken = secondaryLogin.accessToken;
  if (!secondaryToken) throw new Error('Login secondary P3 tidak menghasilkan access token.');
  const secondaryPayload = jwtPayload(secondaryToken);
  if (!secondaryPayload.sid || secondaryPayload.sid === primaryPayload.sid) throw new Error('P3 secondary login tidak menghasilkan sesi terpisah.');

  const sessions = await request('/auth/sessions', { token: primaryToken });
  const secondarySession = sessions.find((row) => row.id === secondaryPayload.sid && row.current === false && !row.revokedAt);
  if (!secondarySession) throw new Error('P3 active-session inventory tidak menemukan secondary session.');
  const revokeSession = await request(`/auth/sessions/${secondaryPayload.sid}/revoke`, { method: 'POST', token: primaryToken });
  if (revokeSession.revoked !== 1) throw new Error(`P3 individual session revoke gagal: ${JSON.stringify(revokeSession)}`);
  await request('/auth/sessions', { token: secondaryToken, expectedStatus: 401 });

  const createdKey = await request('/api-keys', { method: 'POST', token: primaryToken, body: { name: `P3 runtime ${Date.now()}`, scopes: ['report.view'] } });
  apiKeyId = createdKey.id;
  if (!createdKey.apiKey?.startsWith('tk360_') || !createdKey.keyPrefix) throw new Error('P3 API key create tidak mengembalikan one-time secret.');
  const oldPrefix = createdKey.keyPrefix;
  const rotatedKey = await request(`/api-keys/${createdKey.id}/rotate`, { method: 'POST', token: primaryToken });
  if (!rotatedKey.apiKey?.startsWith('tk360_') || !rotatedKey.keyPrefix || rotatedKey.keyPrefix === oldPrefix) throw new Error('P3 API key rotation tidak mengganti secret/prefix.');
  const revokedKey = await request(`/api-keys/${createdKey.id}/revoke`, { method: 'PATCH', token: primaryToken });
  if (revokedKey.isActive !== false) throw new Error('P3 API key revoke tidak menonaktifkan key.');

  const stamp = Date.now();
  const branchContext = await request('/auth/branch-context', { token: primaryToken });
  const companyTimeZone = companyTimeZoneFromBranchContext(branchContext);
  const businessDate = businessDateKeyInTimeZone(new Date(), companyTimeZone);
  const materialized = await request('/analytics/daily-summaries/materialize', { method: 'POST', token: primaryToken, body: { businessDate } });
  const summaries = await request(`/analytics/daily-summaries?from=${businessDate}&to=${businessDate}`, { token: primaryToken });
  if (!Number.isInteger(materialized.salesChannels) || !Number.isInteger(materialized.financeAccounts) || !Array.isArray(summaries.sales) || !Array.isArray(summaries.finance)) {
    throw new Error('P3 explicit Admin-owned daily summary materialization/read contract tidak valid.');
  }

  const policy = await request('/retention/policies', { method: 'POST', token: primaryToken, body: { entityType: 'OPERATOR_INSIGHT', hotDays: 1, warmDays: 1, archiveAfter: true, isActive: true } });
  insightId = (await prisma.operatorInsight.create({ data: {
    companyId: primaryPayload.companyId,
    branchId: primaryPayload.branchId,
    fingerprint: `p3-archive-${stamp}`,
    category: 'P3_RUNTIME', severity: 'INFO', title: 'P3 archive fixture', summary: 'P3 retention/archive exact-runtime fixture',
    explanation: { runtimeProbe: 'P3' }, sourceLinks: [],
    firstObservedAt: new Date(Date.now() - 10 * 86400000), lastObservedAt: new Date(Date.now() - 10 * 86400000), createdAt: new Date(Date.now() - 10 * 86400000),
  } })).id;
  await request('/retention/archive-runs', { method: 'POST', token: primaryToken, expectedStatus: 400, body: { policyId: policy.id, rangeEnd: new Date(Date.now() - 2 * 86400000).toISOString(), confirmation: 'WRONG' } });
  const archive = await request('/retention/archive-runs', { method: 'POST', token: primaryToken, body: { policyId: policy.id, rangeEnd: new Date(Date.now() - 2 * 86400000).toISOString(), confirmation: 'ARCHIVE' } });
  if (archive.status !== 'COMPLETED' || archive.rowsProcessed < 1 || !String(archive.archiveUri || '').startsWith('local://') || !/^[a-f0-9]{64}$/.test(archive.checksum || '')) {
    throw new Error(`P3 archive execution/status/checksum/URI contract gagal: ${JSON.stringify(archive)}`);
  }
  const archiveRelativePath = String(archive.archiveUri).replace(/^local:\/\//, '');
  const archiveCandidates = [path.resolve(root, archiveRelativePath), path.resolve(root, 'apps/api', archiveRelativePath)];
  const archiveFile = archiveCandidates.find((candidate) => fs.existsSync(candidate));
  if (!archiveFile || !fs.readFileSync(archiveFile, 'utf8').includes(insightId)) throw new Error('P3 archive artifact tidak memuat exact tenant fixture.');
  const history = await request('/retention/archive-runs', { token: primaryToken });
  if (!history.some((row) => row.id === archive.id && row.status === 'COMPLETED' && row.checksum === archive.checksum && row.archiveUri === archive.archiveUri)) {
    throw new Error('P3 archive run history tidak memuat status/checksum/artifact URI final.');
  }

  const manifest = await request('/platform/manifest', { token: primaryToken });
  const maturity = assertCapabilityTruth(manifest);
  const auditRows = await prisma.auditLog.findMany({
    where: { companyId: primaryPayload.companyId, userId: primaryPayload.sub, action: { in: ['REVOKE_AUTH_SESSION', 'CREATE_API_KEY', 'ROTATE_API_KEY', 'REVOKE_API_KEY', 'RUN_DATA_ARCHIVE', 'MATERIALIZE_DAILY_SUMMARIES'] } },
    select: { action: true },
  });
  const auditActions = new Set(auditRows.map((row) => row.action));
  const requiredAudit = ['REVOKE_AUTH_SESSION', 'CREATE_API_KEY', 'ROTATE_API_KEY', 'REVOKE_API_KEY', 'RUN_DATA_ARCHIVE', 'MATERIALIZE_DAILY_SUMMARIES'];
  if (!requiredAudit.every((action) => auditActions.has(action))) throw new Error(`P3 audit feedback tidak lengkap: ${requiredAudit.filter((action) => !auditActions.has(action)).join(', ')}`);

  const checks = {
    activeSessionInventory: Boolean(secondarySession),
    individualSessionRevoke: revokeSession.revoked === 1,
    revokedSessionDenied: true,
    apiKeyCreateOneTimeSecret: createdKey.apiKey.startsWith('tk360_'),
    apiKeyRotation: rotatedKey.keyPrefix !== oldPrefix,
    apiKeyRevocation: revokedKey.isActive === false,
    dailySummaryExplicitAdminOwnership: true,
    retentionPolicyLifecycle: policy.isActive === true && policy.archiveAfter === true,
    archiveExplicitSafetyConfirmation: true,
    archiveStatusChecksumArtifactHistory: true,
    capabilityMaturityTruth: maturity.featureCount > 0,
    capabilityNonOperationalTruth: Boolean(maturity.adapterKey && maturity.foundationKey),
    auditFeedback: true,
  };
  for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`P3 runtime check gagal: ${name}`);
  const result = {
    generatedAt: new Date().toISOString(), status: 'PASS', sourceIdentity: sourceFingerprint(root), checks, productionTouched: false,
    session: { revokedSessionId: secondaryPayload.sid }, apiKey: { id: createdKey.id, rotated: true, revoked: true },
    retention: { policyId: policy.id, archiveRunId: archive.id, rowsProcessed: archive.rowsProcessed, checksum: archive.checksum, archiveUri: archive.archiveUri },
    dailySummary: { ownership: 'ADMIN_EXPLICIT', businessDate, salesChannels: materialized.salesChannels, financeAccounts: materialized.financeAccounts },
    capabilityTruth: maturity,
    note: 'P3 exact-runtime probe proves operator-owned retention/archive, API-key/session security lifecycle, explicit Admin daily-summary ownership, audit feedback, and feature maturity truth on the same non-production source.',
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (apiKeyId) await prisma.apiKey.updateMany({ where: { id: apiKeyId }, data: { isActive: false } }).catch(() => undefined);
  await prisma.$disconnect();
}
