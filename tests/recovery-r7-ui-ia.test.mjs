import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const navigation = read('apps/admin/app/navigation.ts');
const shell = read('apps/admin/app/app-shell.tsx');
const analytics = read('apps/admin/app/analytics.tsx');
const charts = read('apps/admin/app/charts.tsx');
const css = read('apps/admin/app/globals.css');
const browser = read('scripts/browser-uat.mjs');
const probe = read('scripts/ci-r7-ui-probe.mjs');
const full = read('.github/workflows/full-system-simulation.yml');
const uat = read('.github/workflows/toko360-full-uat.yml');
const pkg = JSON.parse(read('package.json'));
const matrix = JSON.parse(read('config/recovery-finding-matrix.json'));
const visualMap = JSON.parse(read('config/p5-visual-surface-map.json'));

test('R7 keeps one primary + one contextual Admin navigation layer for every configured workspace', () => {
  const labels = visualMap.admin.primaryWorkspaces.map((item) => item.label);
  assert.ok(labels.includes('Produksi'));
  for (const label of labels) assert.ok(navigation.includes(`label: '${label}'`), label);
  assert.match(shell, /className={`adminV4Sidebar/);
  assert.match(shell, /<nav className="adminPrimaryNavigation"/);
  assert.match(shell, /adminSidebarSubdomains/);
  assert.doesNotMatch(shell, /className="domainTabs/);
  assert.doesNotMatch(shell, /className="workspaceRail"|className="domainDeck"|className="domainContext"|className="statusbar"/);
  assert.doesNotMatch(navigation, /activeModules|enabledModuleCodes/);
  assert.match(navigation, /\['SUPER_ADMIN', 'OWNER', 'ADMIN'\]\.includes\(role\)/);
  assert.match(navigation, /return override\?\.hidden !== true && hasPermission\(identity, workspace\)/);
});

test('R7 replaces ad-hoc analytics palette with reusable canonical chart primitives', () => {
  assert.match(analytics, /LineSeriesChart/);
  assert.match(analytics, /ShareBars/);
  assert.match(analytics, /BarSeriesChart/);
  assert.match(charts, /data-chart-kind="line"/);
  assert.match(charts, /data-chart-kind="share-bars"/);
  assert.match(charts, /data-chart-kind="bars"/);
  assert.doesNotMatch(analytics, /linear-gradient|radial-gradient|CHANNEL_COLORS|#[0-9a-fA-F]{6}/);
  assert.match(css, /\.chartLine\s*\{/);
  assert.match(css, /\.shareTrack/);
  assert.match(css, /\.barChart/);
});

test('R7 browser UAT proves the V4.6 reference dashboard and responsive runtime geometry', () => {
  assert.match(browser, /ADMIN_REFERENCE_DASHBOARD/);
  assert.match(browser, /data-dashboard-metric/);
  assert.match(browser, /data-dashboard-panel/);
  assert.match(browser, /data-chart-kind/);
  assert.match(browser, /ADMIN_RESPONSIVE_SHELL/);
  assert.match(browser, /ADMIN_ALL_NAVIGATION_RUNTIME/);
  assert.match(browser, /querySelector\('\.navLabel'\)/);
  assert.match(browser, /data-admin-route/);
  assert.match(browser, /STOREFRONT_NAVIGATION_RUNTIME/);
  assert.match(browser, /POS_ALL_WORKSPACES_RUNTIME/);
  assert.match(browser, /EMPLOYEE_PORTAL_RESPONSIVE/);
  assert.match(browser, /EMPLOYEE_ALL_SELF_SERVICE_ROUTES/);
});

test('R7 exact-source probe requires every visual-authority workspace, contextual coverage, screenshots and three viewport widths', () => {
  for (const marker of ['expectedWorkspaces', 'runtimeWorkspaces', 'EMPLOYEE_PORTAL_RESPONSIVE', 'contextualNavigation', 'canonicalCharts', 'screenshots', '[1440,1024,390]']) assert.ok(probe.includes(marker), marker);
  assert.match(probe, /p5-visual-surface-map\.json/);
  assert.match(probe, /expectedWorkspaces\.filter\(\(label\) => label !== 'Dashboard'\)/);
  assert.match(probe, /nav\.domainViews\.find\(\(item\) => item\?\.workspace === label\)/);
  assert.match(probe, /evidenceFingerprint !== current\.value/);
  assert.equal(pkg.scripts['ci:r7:probe'], 'node scripts/ci-r7-ui-probe.mjs');
});

test('R7 probe is fail-closed in both PostgreSQL workflows and aggregate reporting', () => {
  for (const workflow of [full, uat]) {
    assert.match(workflow, /id: r7_ui/);
    assert.match(workflow, /npm run ci:r7:probe/);
  }
  assert.match(full, /T360_CI_STEP_R7_UI/);
  assert.match(uat, /STEP_R7_UI/);
});

test('R3/R4 prerequisites are closed while F45/F46 remain R7 verification findings', () => {
  const byId = Object.fromEntries(matrix.findings.map((item) => [item.id, item]));
  for (const id of ['F22','F37','F39','F42','F43']) assert.equal(byId[id].status, 'RUNTIME_CLOSED_R3', id);
  for (const id of ['F34','F35','F36','F38','F40','F41']) assert.equal(byId[id].status, 'RUNTIME_CLOSED_R4', id);
  assert.equal(byId.F45.status, 'SOURCE_IMPLEMENTED_R7_VERIFICATION_PENDING');
  assert.equal(byId.F46.status, 'SOURCE_IMPLEMENTED_RUNTIME_EVIDENCE_PENDING');
});
