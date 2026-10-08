import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const surfaces = ['admin','pos','storefront','employee-portal'];
const css = Object.fromEntries(surfaces.map((app) => [app, readFileSync(`apps/${app}/app/globals.css`, 'utf8')]));

test('F12 canonical visual foundation is Tailwind CSS v4 on all four surfaces with V4 controlled depth', () => {
  const pkg = JSON.parse(readFileSync('package.json','utf8'));
  assert.equal(pkg.devDependencies.tailwindcss, '4.3.3');
  assert.equal(pkg.devDependencies['@tailwindcss/postcss'], '4.3.3');
  assert.equal(pkg.devDependencies.postcss, '8.5.28');
  for (const app of surfaces) {
    assert.ok(existsSync(`apps/${app}/postcss.config.mjs`), `${app} postcss config`);
    assert.match(css[app], /^@import\s+["']tailwindcss["'];/m, `${app} Tailwind import`);
    assert.doesNotMatch(css[app], /@apply[^;]*\bgroup\b|@apply[^;]*group-hover:/, `${app} invalid Tailwind group apply forbidden`);
    assert.match(css[app], /body[^{}]*\{[^}]*overflow-x\s*:\s*hidden/s, `${app} page overflow must remain clipped`);
    if (app === 'admin') {
      assert.doesNotMatch(css[app], /\.adminV4(?:Main|Layout)?\s*\{[^}]*overflow-x\s*:\s*auto/s, 'admin primary horizontal scrolling forbidden');
      assert.match(css[app], /\.table\s*\{[^}]*overflow-x:\s*auto/s, 'admin data tables may scroll inside their own bounded surface');
    }
  }
});

test('F12 Admin uses compact responsive operator shell without forced-wide tables', () => {
  assert.match(css.admin, /\.adminV4/);
  assert.match(css.admin, /\.workspaceSurface/);
  assert.match(css.admin, /@media\s*\(max-width:/);
  assert.match(css.admin, /\.modalOverlay/);
  assert.doesNotMatch(css.admin, /min-width\s*:\s*(?:[7-9]\d\d|\d{4,})px/i);
});

test('F12 POS keeps touch-first checkout and collapses without horizontal page overflow', () => {
  assert.match(css.pos, /\.products/);
  assert.match(css.pos, /\.pay/);
  assert.match(css.pos, /\.posWorkspaceNav/);
  assert.match(css.pos, /@media\(max-width:/);
  assert.match(css.pos, /@media\(pointer:coarse\)/);
});

test('F12 Storefront and Employee Portal are responsive Tailwind surfaces', () => {
  assert.match(css.storefront, /\.mobileNav/);
  assert.match(css.storefront, /@media/);
  assert.match(css['employee-portal'], /\.employeeV4/);
  assert.match(css['employee-portal'], /\.employeeMobileNav/);
  assert.match(css['employee-portal'], /@media/);
});
