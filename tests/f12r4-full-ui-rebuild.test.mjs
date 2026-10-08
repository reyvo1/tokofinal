import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const navigation = read('apps/admin/app/navigation.ts');
const domains = read('apps/admin/app/domain-workspaces.ts');
const shell = read('apps/admin/app/app-shell.tsx');
const page = read('apps/admin/app/page.tsx');
const pkg = JSON.parse(read('package.json'));
const fullSystem = read('.github/workflows/full-system-simulation.yml');
const manualUat = read('.github/workflows/toko360-full-uat.yml');
const styles = [
  read('apps/admin/app/globals.css'),
  read('apps/pos/app/globals.css'),
  read('apps/storefront/app/globals.css'),
  read('apps/employee-portal/app/globals.css'),
];

test('F12R4 Admin exposes the complete operator information architecture explicitly', () => {
  const required = [
    ['dashboard', '/dashboard', 'Dashboard'],
    ['commerce', '/commerce', 'Penjualan & Order'],
    ['procurement', '/procurement', 'Pembelian'],
    ['inventory-control', '/inventory-control', 'Persediaan'],
    ['operations-control', '/operations-control', 'Kontrol Operasional'],
    ['master-data', '/master-data', 'Produk & Master Data'],
    ['finance', '/finance', 'Keuangan'],
    ['reports', '/reports', 'Laporan & Analitik'],
    ['people', '/people', 'HRIS & Payroll'],
    ['assets-fleet', '/assets-fleet', 'Aset & Armada'],
    ['intelligence', '/intelligence', 'Forecast & Otomasi'],
    ['integrations', '/integrations', 'Integrasi & Notifikasi'],
    ['organization', '/organization', 'Tenant & Organisasi'],
    ['settings', '/settings', 'Pengaturan & Akses'],
  ];
  for (const [key, route, label] of required) {
    assert.match(navigation, new RegExp(`key:\\s*['\"]${key}['\"]`));
    assert.match(navigation, new RegExp(`route:\\s*['\"]${route.replaceAll('/', '\\/')}['\"]`));
    assert.ok(navigation.includes(`label: '${label}'`) || navigation.includes(`label: \"${label}\"`), label);
  }
});

test('F12R4 high-value capabilities have discoverable contextual destinations', () => {
  for (const marker of [
    "key: 'providers'", 'Telegram & WhatsApp',
    "key: 'notifications'", "key: 'connections'",
    "key: 'ai'", "key: 'forecast'", "key: 'automation'", "key: 'schedules'",
    "workspaceKey: 'organization'", "workspaceKey: 'settings'",
    "key: 'features'", "key: 'users'", "key: 'security'", "key: 'api-keys'",
  ]) assert.ok(domains.includes(marker), marker);
});

test('F12R4 Admin shell renders only one primary and one contextual navigation layer', () => {
  assert.match(shell, /className=\{`adminV4Sidebar/);
  assert.match(shell, /<nav className="adminPrimaryNavigation"/);
  assert.match(shell, /adminSidebarSubdomains/);
  assert.doesNotMatch(shell, /className="domainTabs/);
  assert.doesNotMatch(shell, /className="workspaceRail"/);
  assert.doesNotMatch(shell, /className="domainDeck"/);
  assert.doesNotMatch(shell, /className="domainContext"/);
  assert.doesNotMatch(shell, /className="statusbar"/);
});

test('F12R4 settings and organization are real routed operator workspaces', () => {
  assert.match(page, /activeWorkspace\.key === 'organization'/);
  assert.match(page, /<OrganizationAdminView token=\{token\}/);
  assert.match(page, /<MasterDataView token=\{token\} mode=\{activeDomainView\.key\}/);
  assert.match(page, /activeWorkspace\.key === 'settings'/);
  assert.match(page, /activeDomainView\.key === 'features'/);
  assert.match(page, /activeDomainView\?\.key === 'users'/);
  assert.match(page, /activeDomainView\?\.key === 'security'/);
  assert.match(page, /activeDomainView\?\.key === 'api-keys'/);
});

test('F12R4 Tailwind v4 is exact and V4 presentation remains overflow-safe with valid utilities', () => {
  assert.equal(pkg.devDependencies.tailwindcss, '4.3.3');
  assert.equal(pkg.devDependencies['@tailwindcss/postcss'], '4.3.3');
  assert.equal(pkg.devDependencies.postcss, '8.5.28');
  for (const css of styles) {
    assert.match(css, /@import "tailwindcss"/);
    assert.doesNotMatch(css, /@apply[^;]*\bgroup\b|@apply[^;]*group-hover:/);
    assert.match(css, /body[^{}]*\{[^}]*overflow-x\s*:\s*hidden/s);
  }
});

test('F12R4 closed Admin sidebar is removed from mobile layout and mobile-open state is explicit', () => {
  const adminCss = styles[0];
  assert.match(adminCss, /\.adminV4Sidebar\s*\{[\s\S]*?transform:\s*translateX\(-100%\)/);
  assert.match(adminCss, /\.adminV4Sidebar\.mobileOpen\s*\{[^}]*transform:\s*translateX\(0\)/);
  assert.match(adminCss, /@media \(width >= 1024px\)[\s\S]*?\.adminV4Sidebar\s*\{[^}]*transform:\s*none/);
  assert.match(shell, /mobileOpen \? 'mobileOpen' : ''/);
});

test('F12R4 preserves the deep fail-closed GitHub UAT chain', () => {
  for (const workflow of [fullSystem, manualUat]) {
    for (const command of ['audit:full:repo', 'ci:ui:audit', 'ci:api:sweep', 'ci:provider:probe']) {
      assert.ok(workflow.includes(command), command);
    }
    assert.match(workflow, /uat:browser:built/);
  }
});
