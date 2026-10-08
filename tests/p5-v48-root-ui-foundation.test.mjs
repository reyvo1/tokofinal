import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');
const adminShell=read('apps/admin/app/app-shell.tsx');
const adminCss=read('apps/admin/app/globals.css');
const posShell=read('apps/pos/app/pos-shell.tsx');
const posCss=read('apps/pos/app/globals.css');
const storeShell=read('apps/storefront/app/storefront-shell.tsx');
const storeCss=read('apps/storefront/app/globals.css');
const employeeShell=read('apps/employee-portal/app/employee-portal-shell.tsx');
const employeeCss=read('apps/employee-portal/app/globals.css');
const context=JSON.parse(read('config/admin-contextual-workflow-map.json'));

test('P5 V4.11 supersedes the V4.8 root UI foundation contract across all four runtime products',()=>{
  for(const source of [adminShell,posShell,storeShell,employeeShell]) assert.match(source,/data-ui-foundation="p5-v4\.11"/);
});

test('P5 V4.8 repairs raw form primitives instead of relying on every screen to hand-style labels and buttons',()=>{
  assert.match(adminCss,/\.workspaceSurface label:not\(\.checkRow\)/);
  assert.match(adminCss,/\.workspaceSurface button:not\(\[class\]\)/);
  assert.match(adminCss,/\.grid2[^}]*align-items:\s*start/);

  assert.match(storeCss,/\.storefrontViewBody label/);
  assert.match(storeCss,/\.storefrontViewBody button:not\(\[class\]\)/);
  assert.match(storeCss,/\.checkoutGrid[^}]*align-items:start/);

  assert.match(employeeCss,/\.employeeViewBody label/);
  assert.match(employeeCss,/\.employeeViewBody button:not\(\[class\]\)/);
  assert.match(employeeCss,/\.login>form\{[^}]*width:min\(100%,460px\)/s);

  assert.match(posCss,/\.posV4\{[^}]*linear-gradient\(180deg,#f8fafc/i);
  assert.match(posCss,/\.posWorkspaceBody label/);
  assert.match(posCss,/\.posWorkspaceBody button:not\(\[class\]\)/);
  assert.match(posCss,/\.layout\{align-items:start\}/);
});

test('P5 V4.11 Admin exposes every permission-visible domain and subdomain through one searchable hierarchical navigation',()=>{
  assert.match(adminShell,/data-ui-foundation="p5-v4\.11"/);
  assert.match(adminShell,/className="adminPrimaryNavigation"/);
  assert.match(adminShell,/adminSidebarSubdomains/);
  assert.match(adminShell,/resolveDomainViews\(item, manifest, identity\)/);
  assert.match(adminShell,/view\.label, view\.title, view\.description/);
  assert.match(adminShell,/data-admin-route=\{domainRoute\(item, view\)\}/);
  assert.doesNotMatch(adminShell,/adminModuleDirectory|moduleOpen|className="domainTabs/);
  assert.equal(context.rows.length,context.expectedContextualViews);
  assert.equal(context.expectedContextualViews,70);
  for (const route of [
    ['master-data','bulk-labels'],
    ['manufacturing','recipes'],
    ['manufacturing','orders'],
    ['integrations','ppob'],
    ['settings','setup'],
  ]) assert.ok(context.rows.some((row)=>row.workspace===route[0]&&row.view===route[1]), `missing contextual route ${route.join('/')}`);
});

test('P5 V4.11 Admin replaces override accretion with one tokenized layout authority',()=>{
  assert.equal((adminCss.match(/!important/g)||[]).length,0);
  for(const token of ['--admin-bg','--admin-surface','--admin-text','--admin-border','--admin-primary']) assert.match(adminCss,new RegExp(token));
  for(const primitive of ['panel','formGrid','responsiveFormGrid','table','receipt','modalCard','dashboardMetricGrid']) assert.match(adminCss,new RegExp(`\.${primitive}`));
  assert.match(adminCss,/\.adminV4\[data-theme='dark'\]/);
  assert.doesNotMatch(adminCss,/\.domainTabs\{flex-wrap/);
});
