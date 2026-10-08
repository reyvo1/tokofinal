import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { jsxOpeningTags } from '../scripts/jsx-opening-tags.mjs';

function loadSource(file, names) {
  let source = fs.readFileSync(new URL(`../apps/admin/app/${file}`, import.meta.url), 'utf8');
  // Execute the actual pure resolver/loader; only presentation icons are stubbed.
  source = stripTypeScriptTypes(source).replace(/import\s*\{([\s\S]*?)\}\s*from 'lucide-react';/g,
    (_, icons) => `const {${icons}} = new Proxy({}, { get: () => () => null });`)
    .replace(/export /g, '');
  return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, {});
}
const navigation = loadSource('navigation.ts', ['resolveAdminNavigation', 'ADMIN_WORKSPACES']);
const domain = loadSource('domain-workspaces.ts', ['resolveDomainViews', 'resolvedDomainViewFromPath']);
const bootstrap = loadSource('bootstrap-data.ts', ['canReadAdminFeed', 'settleAdminFeed']);
const actor = (role, permissions = []) => ({ roles: [role], permissions });
const visible = (identity, manifest = null) => Array.from(navigation.resolveAdminNavigation(manifest, identity).flatMap((g) => g.items), (i) => i.key);

test('cashier cannot inherit role-only Dashboard/Organization from a missing prefix rule', () => {
  const keys = visible(actor('CASHIER', ['sale.create', 'product.view']));
  assert.ok(keys.includes('commerce'));
  assert.ok(!keys.includes('dashboard'));
  assert.ok(!keys.includes('organization'));
  assert.deepEqual(visible(null), []);
});

test('every reports role can load dashboard without requiring procurement access', () => {
  for (const role of ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'AUDITOR', 'HR', 'PAYROLL']) {
    assert.ok(visible(actor(role, ['report.view'])).includes('dashboard'));
    assert.equal(bootstrap.canReadAdminFeed(actor(role), 'reports'), true);
  }
  assert.equal(bootstrap.canReadAdminFeed(actor('HR'), 'suppliers'), false);
  assert.equal(bootstrap.canReadAdminFeed(actor('CASHIER'), 'reports'), false);
  assert.equal(bootstrap.canReadAdminFeed(null, 'reports'), false);
});

test('a failed feed is visible as failed and cannot discard successful sibling data', async () => {
  const [manifest, stock, denied] = await Promise.all([
    bootstrap.settleAdminFeed(async () => ({ company: 'fixture' }), null),
    bootstrap.settleAdminFeed(async () => { throw new Error('service unavailable'); }, []),
    bootstrap.settleAdminFeed(async () => { assert.fail('unauthorized feed must not be requested'); }, [], false),
  ]);
  assert.equal(manifest.value.company, 'fixture');
  assert.equal(manifest.failed, false);
  assert.equal(stock.failed, true);
  assert.equal(denied.failed, false);
});

test('root destination and sidebar use the same first permission-visible contextual view', () => {
  const workspace = navigation.ADMIN_WORKSPACES.find((w) => w.key === 'people');
  const identity = actor('PAYROLL', ['payroll.view']);
  const views = domain.resolveDomainViews(workspace, null, identity);
  assert.equal(views[0].key, 'payroll');
  assert.equal(domain.resolvedDomainViewFromPath('/people', workspace, null, identity).key, 'payroll');
  assert.equal(domain.resolvedDomainViewFromPath('/people/employees', workspace, null, identity), null);
  assert.ok(domain.resolveDomainViews(workspace, null, actor('SUPER_ADMIN')).some((v) => v.key === 'employees'));
});

test('custom navigation labels do not change workspace identity and hidden roots stay hidden', () => {
  const manifest = { uiSchemas: [{ surface: 'admin', version: 1, schema: { navigation: [{ route: '/dashboard', label: 'Ringkasan saya' }, { route: '/organization', hidden: true }] } }] };
  const groups = navigation.resolveAdminNavigation(manifest, actor('ADMIN'));
  assert.equal(groups.flatMap((g) => g.items).find((i) => i.key === 'dashboard').label, 'Ringkasan saya');
  assert.ok(!visible(actor('ADMIN'), manifest).includes('organization'));
});

test('control inventory parses greater-than expressions and still detects missing handlers', () => {
  const source = '<button aria-label={count > 0 ? `Ada ${count}` : "Nihil"} onClick={() => navigate("/queue")}>Lihat</button><button type="button">Mati</button>';
  const tags = jsxOpeningTags(source, 'button');
  assert.equal(tags.length, 2);
  assert.match(tags[0].attrs, /onClick=/);
  assert.doesNotMatch(tags[1].attrs, /onClick=/);
});

test('branch reload guards stale responses and resets branch-bound drafts', () => {
  const page = fs.readFileSync(new URL('../apps/admin/app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /currentToken\.current !== activeToken \|\| sequence !== loadSequence\.current/);
  assert.match(page, /if \(loadedToken !== token\) return/);
  const change = page.slice(page.indexOf('async function switchBranch'), page.indexOf('const selectedPO'));
  for (const setter of ['setPurchaseRequestForm', 'setPoForm', 'setReceiptForm', 'setSupplierEdit', 'setReceiptReject']) assert.ok(change.includes(setter), `${setter} must reset when branch changes`);
  assert.match(page, /item\.key === activeWorkspace\.key/, 'custom labels must not redirect the user out of a permitted workspace');
});

test('dark-mode headings have semantic color and surface ownership', () => {
  const pos = fs.readFileSync(new URL('../apps/pos/app/globals.css', import.meta.url), 'utf8');
  const posShell = fs.readFileSync(new URL('../apps/pos/app/pos-shell.tsx', import.meta.url), 'utf8');
  const employee = fs.readFileSync(new URL('../apps/employee-portal/app/globals.css', import.meta.url), 'utf8');
  const employeeShell = fs.readFileSync(new URL('../apps/employee-portal/app/employee-portal-shell.tsx', import.meta.url), 'utf8');
  assert.match(posShell, /h1 className="posBrandTitle/);
  assert.match(pos, /\.posBrandTitle\{color:var\(--pos-text\)/);
  assert.match(employeeShell, /className="employeeWorkspaceHeading /);
  assert.match(employee, /\.employeeV4\[data-theme='dark'\] \.employeeWorkspaceHeading,[^{]+\{background:#0f1a2a/);
});
