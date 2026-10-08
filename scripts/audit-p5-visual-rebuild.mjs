#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const visualMapPath = path.join(root, 'config/p5-visual-surface-map.json');

function fail(message) {
  console.error(`P5 visual audit FAIL: ${message}`);
  process.exit(1);
}
function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) fail(`file tidak ada: ${file}`);
  return fs.readFileSync(full, 'utf8');
}
function readJson(file) {
  try { return JSON.parse(read(file)); }
  catch (error) { fail(`JSON invalid ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}

const map = readJson('config/p5-visual-surface-map.json');
const v4Path = path.join(root, 'config/p5-v4-total-ui-rebuild.json');
const v4 = fs.existsSync(v4Path) ? readJson('config/p5-v4-total-ui-rebuild.json') : null;
const v4Active = v4?.phase === 'P5-V4';
const controlledGradientsAllowed = v4Active && v4?.decision?.controlledDecorativeGradientsAllowed === true;
if (map.phase !== 'P5') fail(`visual map phase harus P5, actual=${map.phase}`);
if (map.baseline?.commit !== 'd305ade2050765de86c7f5ef1c54eb7426c5e25b') fail('baseline P4 commit tidak cocok.');
if (map.pos?.views?.length !== 4) fail('POS visual view harus 4.');
if (map.storefront?.views?.length !== 5) fail('Storefront visual view harus 5.');
if (map.employeePortal?.views?.length !== 7) fail('Employee Portal visual view harus 7.');

const sources = {
  adminShell: read('apps/admin/app/app-shell.tsx'),
  adminCss: read('apps/admin/app/globals.css'),
  adminDashboard: read('apps/admin/app/dashboard-overview.tsx'),
  posShell: read('apps/pos/app/pos-shell.tsx'),
  posCss: read('apps/pos/app/globals.css'),
  storeShell: read('apps/storefront/app/storefront-shell.tsx'),
  storeCss: read('apps/storefront/app/globals.css'),
  employeeShell: read('apps/employee-portal/app/employee-portal-shell.tsx'),
  employeeCss: read('apps/employee-portal/app/globals.css'),
  navigation: read('apps/admin/app/navigation.ts'),
  domains: read('apps/admin/app/domain-workspaces.ts'),
  browser: read('scripts/browser-uat.mjs'),
  adminTheme: read('apps/admin/app/theme-contract.ts'),
};

for (const [name, source] of Object.entries({
  admin: sources.adminShell,
  pos: sources.posShell,
  storefront: sources.storeShell,
  employeePortal: sources.employeeShell,
})) {
  if (!source.includes('data-visual-product=')) fail(`${name} belum memiliki page-level visual identity.`);
}

if (v4Active) {
  const contracts = [
    ['Admin', sources.adminShell, ['data-visual-generation="p5-v4"', 'data-visual-role="page-header"', 'className="adminPrimaryNavigation"', 'adminSidebarSubdomains', 'workspaceSurface']],
    ['POS', sources.posShell, ['data-visual-generation="p5-v4"', 'posWorkspaceSurface', 'posWorkspaceNav']],
    ['Storefront', sources.storeShell, ['data-visual-generation="p5-v4"', 'storefrontMain', 'storefrontViewBody']],
    ['Employee', sources.employeeShell, ['data-visual-generation="p5-v4"', 'employeeMobileNav', 'employeeViewBody']],
  ];
  for (const [label, source, markers] of contracts) for (const marker of markers) if (!source.includes(marker)) fail(`${label} P5 V4 primitive hilang: ${marker}`);
  for (const marker of ['data-theme={theme}','Aktifkan mode gelap','className="adminPageHeader"','Cari domain atau subdomain']) {
    if (!sources.adminShell.includes(marker)) fail(`Admin reference/light-dark primitive hilang: ${marker}`);
  }
  if (!sources.adminTheme.includes('toko360:ui-theme:v411:admin')) fail('Admin product-scoped theme persistence contract hilang.');
  if ((sources.adminDashboard.match(/<MetricCard/g) || []).length !== 6) fail('Admin dashboard reference harus memiliki 6 KPI card.');
  for (const marker of ['sales-performance','top-revenue-drivers','product-performance','recent-activity','stock-watchlist','quick-actions','data-chart-kind="donut"']) {
    if (!sources.adminDashboard.includes(marker)) fail(`Admin dashboard reference primitive hilang: ${marker}`);
  }
} else {
  for (const marker of ['pageTitleRow','pageWorkspaceBadge','pageContextStrip']) {
    if (!sources.adminShell.includes(marker) || !sources.adminCss.includes(marker)) fail(`Admin P5 primitive hilang: ${marker}`);
  }
  for (const marker of ['posWorkspaceHeader','posWorkspaceStatus','posWorkspaceBody']) {
    if (!sources.posShell.includes(marker) || !sources.posCss.includes(marker)) fail(`POS P5 primitive hilang: ${marker}`);
  }
  for (const marker of ['storefrontViewHeader','storefrontBranchContext','storefrontViewBody']) {
    if (!sources.storeShell.includes(marker) || !sources.storeCss.includes(marker)) fail(`Storefront P5 primitive hilang: ${marker}`);
  }
  for (const marker of ['employeeContextPill','employeeViewBody']) {
    if (!sources.employeeShell.includes(marker) || !sources.employeeCss.includes(marker)) fail(`Employee P5 primitive hilang: ${marker}`);
  }
}

const navigationWorkspaces = [...sources.navigation.matchAll(/\{ key: '([^']+)', route: '([^']+)', label: '([^']+)'/g)]
  .map((match) => ({ key: match[1], route: match[2], label: match[3] }));
if (!navigationWorkspaces.length) fail('Admin navigation workspace tidak dapat diparse.');
if (map.admin?.primaryWorkspaces?.length !== navigationWorkspaces.length) {
  fail(`Admin visual primary coverage drift: map=${map.admin?.primaryWorkspaces?.length ?? 0} navigation=${navigationWorkspaces.length}`);
}
const mapRoutes = map.admin.primaryWorkspaces.map((workspace) => workspace.route);
const navigationRoutes = navigationWorkspaces.map((workspace) => workspace.route);
if (JSON.stringify(mapRoutes) !== JSON.stringify(navigationRoutes)) {
  fail(`Admin visual primary route order drift: map=${mapRoutes.join(',')} navigation=${navigationRoutes.join(',')}`);
}
const expectedContextualRepresentatives = Math.max(0, navigationWorkspaces.length - 1);
if (map.admin?.representativeContextualRoutes?.length !== expectedContextualRepresentatives) {
  fail(`Admin contextual representative coverage drift: map=${map.admin?.representativeContextualRoutes?.length ?? 0} expected=${expectedContextualRepresentatives}`);
}
for (const workspace of navigationWorkspaces.filter((workspace) => workspace.route !== '/dashboard')) {
  if (!map.admin.representativeContextualRoutes.some((route) => route.startsWith(`${workspace.route}/`))) {
    fail(`Admin workspace belum punya representative contextual screenshot: ${workspace.route}`);
  }
}
for (const route of map.admin.representativeContextualRoutes) {
  const [workspaceRoute, view] = route.split('/').filter(Boolean);
  if (!workspaceRoute || !view) fail(`Admin contextual route invalid: ${route}`);
  if (!sources.domains.includes(`key: '${view}'`)) fail(`Admin contextual visual view tidak ditemukan: ${route}`);
}

const cssBundle = [sources.adminCss, sources.posCss, sources.storeCss, sources.employeeCss].join('\n');
for (const required of ['@media', 'prefers-reduced-motion', 'pointer:coarse']) {
  if (!cssBundle.includes(required)) fail(`responsive/accessibility CSS contract hilang: ${required}`);
}
if (!controlledGradientsAllowed && /linear-gradient|radial-gradient|conic-gradient/i.test(cssBundle)) fail('P5 melarang decorative gradient pada canonical surfaces.');

for (const token of [
  'P5_VISUAL_SCREENSHOT_MATRIX',
  'p5-admin-primary-',
  'p5-admin-context-',
  'p5-storefront-',
  'p5-pos-',
  'p5-employee-',
  'humanAcceptance',
]) {
  if (!sources.browser.includes(token)) fail(`Browser UAT belum membawa P5 evidence: ${token}`);
}

console.log(
  `P5 visual audit PASS — Admin ${map.admin.primaryWorkspaces.length} primary/${map.admin.representativeContextualRoutes.length} contextual, POS ${map.pos.views.length}, Storefront ${map.storefront.views.length}, Employee ${map.employeePortal.views.length}.`,
);
