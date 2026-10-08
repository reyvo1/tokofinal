#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-p4-canonical-ownership-probe-latest.json');
const ownershipPath = path.join(root, 'config/canonical-domain-ownership.json');
const api = String(process.env.T360_API_URL || 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential P4 probe tidak tersedia.');

async function rawRequest(route, { method = 'GET', body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, text };
}

async function request(route, options = {}) {
  const response = await rawRequest(route, options);
  if (!response.status || response.status < 200 || response.status >= 300) {
    throw new Error(`${options.method || 'GET'} ${route} HTTP ${response.status}: ${response.text.slice(0, 1200)}`);
  }
  return response.data;
}

function normalizedSwaggerPaths(swagger) {
  const out = new Map();
  for (const [rawPath, entry] of Object.entries(swagger?.paths || {})) {
    let route = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    route = route.replace(/^\/api\/v1(?=\/|$)/, '') || '/';
    out.set(route, entry);
  }
  return out;
}

function hasMethod(paths, route, method) {
  return Boolean(paths.get(route)?.[method.toLowerCase()]);
}

const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
const requiredDomains = ['inventory', 'returns', 'accounting', 'payments', 'notifications', 'payroll', 'assets', 'marketplace', 'summaries'];
const ownershipIds = new Set((ownership.domains || []).map((entry) => entry.id));
if (!requiredDomains.every((id) => ownershipIds.has(id))) throw new Error('P4 ownership manifest tidak memuat seluruh domain wajib.');
if (!(ownership.legacyAliases || []).every((entry) => entry.status === 'REMOVED_AFTER_COMPATIBILITY_VERIFICATION')) {
  throw new Error('P4 legacy alias manifest belum berstatus removed after compatibility verification.');
}

const login = await request('/auth/login', { method: 'POST', body: { email, password } });
const token = login?.accessToken;
if (!token) throw new Error('Login P4 tidak menghasilkan access token.');

const swaggerBase = api.replace(/\/api\/v1$/, '');
const swaggerResponse = await fetch(new URL('/docs-json', swaggerBase));
if (!swaggerResponse.ok) throw new Error(`P4 Swagger JSON gagal HTTP ${swaggerResponse.status}`);
const swagger = await swaggerResponse.json();
const paths = normalizedSwaggerPaths(swagger);

const canonicalOperations = [
  ['GET', '/returns/sales'],
  ['POST', '/returns/sales'],
  ['POST', '/returns/sales/{id}/confirm'],
  ['GET', '/returns/purchases'],
  ['POST', '/returns/purchases'],
  ['POST', '/returns/purchases/{id}/confirm'],
  ['GET', '/returns/orders'],
  ['POST', '/returns/orders/{id}/inspection'],
  ['POST', '/returns/orders/{id}/reject'],
  ['POST', '/returns/orders/{id}/confirm'],
];
for (const [method, route] of canonicalOperations) {
  if (!hasMethod(paths, route, method)) throw new Error(`P4 canonical return operation hilang dari Swagger: ${method} ${route}`);
}

const forbiddenSwaggerPaths = ['/sale-returns', '/sale-returns/{id}/complete', '/purchase-returns', '/purchase-returns/{id}/complete'];
for (const route of forbiddenSwaggerPaths) {
  if (paths.has(route)) throw new Error(`P4 legacy return route masih muncul di Swagger: ${route}`);
}

const canonicalSales = await rawRequest('/returns/sales', { token });
const canonicalPurchases = await rawRequest('/returns/purchases', { token });
const canonicalOrders = await rawRequest('/returns/orders', { token });
for (const [name, response] of [['sales', canonicalSales], ['purchases', canonicalPurchases], ['orders', canonicalOrders]]) {
  if (response.status !== 200) throw new Error(`P4 canonical returns ${name} tidak live: HTTP ${response.status}`);
}

const legacyChecks = [];
for (const route of ['/sale-returns', '/purchase-returns']) {
  for (const method of ['GET', 'POST']) {
    const response = await rawRequest(route, { method, token, ...(method === 'POST' ? { body: {} } : {}) });
    const routerMiss = response.status === 404 && /Cannot\s+(GET|POST)/i.test(response.text);
    if (!routerMiss) throw new Error(`P4 legacy route ${method} ${route} belum benar-benar removed: HTTP ${response.status} ${response.text.slice(0, 500)}`);
    legacyChecks.push({ method, route, status: response.status, routerMiss });
  }
}

const checks = {
  ownershipManifestNineDomains: requiredDomains.every((id) => ownershipIds.has(id)),
  compatibilityAliasesDeclaredRemoved: true,
  canonicalReturnsSwagger: canonicalOperations.every(([method, route]) => hasMethod(paths, route, method)),
  legacyReturnsAbsentFromSwagger: forbiddenSwaggerPaths.every((route) => !paths.has(route)),
  canonicalSaleReturnsLive: canonicalSales.status === 200,
  canonicalPurchaseReturnsLive: canonicalPurchases.status === 200,
  canonicalOrderReturnsLive: canonicalOrders.status === 200,
  legacySaleReturnsRouterMissing: legacyChecks.filter((row) => row.route === '/sale-returns').every((row) => row.routerMiss),
  legacyPurchaseReturnsRouterMissing: legacyChecks.filter((row) => row.route === '/purchase-returns').every((row) => row.routerMiss),
};
for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`P4 runtime check gagal: ${name}`);

const result = {
  generatedAt: new Date().toISOString(),
  status: 'PASS',
  sourceIdentity: sourceFingerprint(root),
  checks,
  ownership: {
    version: ownership.version,
    phase: ownership.phase,
    domainCount: ownership.domains.length,
    domains: ownership.domains.map((entry) => ({ id: entry.id, canonicalOwner: entry.canonicalOwner, canonicalPublicMutationSurface: entry.canonicalPublicMutationSurface })),
  },
  returns: {
    canonicalOperationCount: canonicalOperations.length,
    removedLegacyOperations: legacyChecks,
  },
  productionTouched: false,
  note: 'P4 exact-runtime probe proves canonical returns ownership, removed legacy return aliases, and the nine-domain ownership manifest on the same non-production source.',
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
