import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(file, 'utf8');
const mapping = JSON.parse(read('config/admin-contextual-workflow-map.json'));
const browser = read('scripts/browser-uat.mjs');
const shell = read('apps/admin/app/app-shell.tsx');
const routes = new Set(mapping.rows.map((row) => `/${row.workspace}/${row.view}`));
const criticalRoutes = ['/integrations/notifications','/operations-control/delivery','/people/payroll','/people/employees'];

test('Admin shell exposes one stable effective contextual state for UI and browser automation', () => {
  assert.match(shell, /const effectiveDomainView = activeDomainView \?\? domainViews\[0\] \?\? null/);
  assert.match(shell, /data-admin-workspace=\{activeWorkspace\.key\}/);
  assert.match(shell, /data-admin-view=\{effectiveDomainView\?\.key \?\? (?:''|"")\}/);
  assert.match(shell, /const selected = active && effectiveDomainView\?\.key === view\.key/);
  assert.match(shell, /aria-current=\{selected \? 'page' : undefined\}/);
});

test('critical Browser UAT journeys resolve through the canonical contextual map', () => {
  assert.equal(mapping.rows.length, mapping.expectedContextualViews);
  for (const route of criticalRoutes) {
    assert.ok(routes.has(route), `${route} must exist in canonical contextual map`);
    assert.ok(browser.includes(`navigateAdminContext(cdp, '${route}'`), `${route} must use canonical contextual navigator`);
  }
});

test('Browser UAT contextual navigation is independent of the previously active workspace', () => {
  assert.match(browser, /function canonicalAdminContext\(route\)/);
  assert.match(browser, /async function navigateAdminContext\(cdp, route, label/);
  assert.match(browser, /Page\.navigate/);
  assert.match(browser, /data-admin-workspace/);
  assert.match(browser, /data-admin-view/);
  assert.doesNotMatch(browser, /const clickNotificationsForR8/);
  assert.doesNotMatch(browser, /const clickFleet/);
  assert.doesNotMatch(browser, /const clickPeople/);
  assert.doesNotMatch(browser, /const clickPayroll/);
  assert.doesNotMatch(browser, /const clickEmployees/);
});

test('Delivery Lifecycle UAT follows its P1 canonical ownership instead of the old fleet workspace', () => {
  assert.ok(routes.has('/operations-control/delivery'));
  assert.match(browser, /navigateAdminContext\(cdp, '\/operations-control\/delivery'/);
  const staleFleetJourney = /data-admin-route=\?"\/assets-fleet\?"[\s\S]{0,500}Outbound \/ Delivery Lifecycle/;
  assert.doesNotMatch(browser, staleFleetJourney);
});


test('Browser UAT rejects Admin shell column displacement even when there is no horizontal overflow', () => {
  assert.match(browser, /async function assertAdminShellGeometry\(cdp, width, height\)/);
  assert.match(browser, /data-admin-layout=\"primary\"/);
  assert.match(browser, /Admin desktop main workspace salah kolom\/menyusut/);
  assert.match(browser, /ADMIN_SHELL_GEOMETRY/);
});
