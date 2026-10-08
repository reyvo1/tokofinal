#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const input = path.join(root, 'handoff/quality/browser-uat-latest.json');
const output = path.join(root, 'handoff/quality/github-r7-ui-probe-latest.json');
if (!fs.existsSync(input)) throw new Error(`Browser UAT evidence tidak ditemukan: ${input}`);

const browser = JSON.parse(fs.readFileSync(input, 'utf8'));
const current = sourceFingerprint(root);
const evidenceFingerprint = browser?.sourceIdentity?.value || browser?.runtimeSourceFingerprint || null;
if (browser.status !== 'PASS') throw new Error(`Browser UAT belum PASS: ${browser.status}`);
if (!evidenceFingerprint || evidenceFingerprint !== current.value) {
  throw new Error(`R7 browser evidence stale. current=${current.value} evidence=${evidenceFingerprint || '<missing>'}`);
}

const checksById = new Map((browser.checks || []).map((check) => [check.id, check]));
const requirePass = (id) => {
  const check = checksById.get(id);
  if (!check || check.status !== 'PASS') throw new Error(`R7 browser check belum PASS: ${id}`);
  return check;
};

const visualMap = JSON.parse(fs.readFileSync(path.join(root, 'config', 'p5-visual-surface-map.json'), 'utf8'));
const expectedWorkspaces = (visualMap.admin?.primaryWorkspaces || []).map((workspace) => workspace.label);
if (!expectedWorkspaces.length) throw new Error('R7 visual workspace authority kosong.');

const employeeResponsive = requirePass('EMPLOYEE_PORTAL_RESPONSIVE');
const responsive = [
  requirePass('ADMIN_RESPONSIVE_SHELL'),
  requirePass('STOREFRONT_NAVIGATION_RUNTIME'),
  requirePass('POS_ALL_WORKSPACES_RUNTIME'),
  employeeResponsive,
];
const employeeRoutes = checksById.get('EMPLOYEE_ALL_SELF_SERVICE_ROUTES');
if (employeeRoutes?.status === 'PASS') responsive.push(employeeRoutes);
for (const check of responsive) {
  if (!Array.isArray(check.matrix) || check.matrix.length !== 3 || !check.matrix.every((row) => [1440,1024,390].includes(row.width) && row.scrollWidth <= row.width + 3)) {
    throw new Error(`R7 responsive matrix invalid: ${check.id}`);
  }
}

const nav = requirePass('ADMIN_ALL_NAVIGATION_RUNTIME');
const analytics = requirePass('ADMIN_REFERENCE_DASHBOARD');
const runtimeWorkspaces = [...new Set(['Dashboard', ...(nav.workspaces || [])])];
for (const label of expectedWorkspaces) {
  if (!runtimeWorkspaces.includes(label)) throw new Error(`R7 Admin workspace tidak ditemukan di runtime: ${label}`);
}
const contextualWorkspaces = expectedWorkspaces.filter((label) => label !== 'Dashboard');
if (!Array.isArray(nav.domainViews) || nav.domainViews.length < contextualWorkspaces.length) {
  throw new Error(`R7 contextual navigation belum lengkap: ${nav.domainViews?.length ?? 0}/${contextualWorkspaces.length}`);
}
for (const label of contextualWorkspaces) {
  const row = nav.domainViews.find((item) => item?.workspace === label);
  if (!row) throw new Error(`R7 contextual workspace tidak ditemukan: ${label}`);
  if (!Array.isArray(row.domains) || row.domains.length < 1) throw new Error(`R7 workspace tanpa contextual destination: ${label}`);
}

const requiredPanels = ['sales-performance','top-revenue-drivers','product-performance','recent-activity','stock-watchlist','quick-actions'];
if (analytics.metricCount !== 6 || analytics.title !== 'Dashboard Overview' || !requiredPanels.every((panel) => analytics.panels?.includes(panel)) || !['line','donut'].every((kind) => analytics.charts?.includes(kind))) {
  throw new Error(`R7 reference dashboard invalid: ${JSON.stringify(analytics)}`);
}

const result = {
  generatedAt: new Date().toISOString(),
  status: 'PASS',
  sourceIdentity: current,
  checks: {
    primaryNavigation: runtimeWorkspaces.length === expectedWorkspaces.length && expectedWorkspaces.every((label) => runtimeWorkspaces.includes(label)),
    contextualNavigation: true,
    canonicalCharts: true,
    adminResponsive: true,
    posResponsive: true,
    storefrontResponsive: true,
    employeeResponsive: true,
    screenshots: Boolean(nav.screenshot && analytics.screenshot),
  },
  workspaceCount: runtimeWorkspaces.length,
  contextualWorkspaceCount: nav.domainViews.length,
  chartKinds: analytics.charts,
  productionTouched: false,
  note: 'R7 exact-source browser evidence proves one primary + one contextual Admin IA, the V4.6 reference dashboard structure, desktop/tablet/mobile no-overflow geometry, and screenshot artifacts while Human Stage-20 remains separate.',
};
if (!Object.values(result.checks).every(Boolean)) throw new Error(`R7 UI checks incomplete: ${JSON.stringify(result.checks)}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
