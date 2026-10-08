import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const shells = {
  admin: read('apps/admin/app/app-shell.tsx'),
  pos: read('apps/pos/app/pos-shell.tsx'),
  storefront: read('apps/storefront/app/storefront-shell.tsx'),
  employee: read('apps/employee-portal/app/employee-portal-shell.tsx'),
};

const css = {
  admin: read('apps/admin/app/globals.css'),
  pos: read('apps/pos/app/globals.css'),
  storefront: read('apps/storefront/app/globals.css'),
  employee: read('apps/employee-portal/app/globals.css'),
};

const browser = read('scripts/browser-uat.mjs');

test('UI-P7 provides skip links and focusable main workspace targets across all operator surfaces', () => {
  assert.match(shells.admin, /className="skipLink" href="#admin-main"/);
  assert.match(shells.admin, /id="admin-main"[^>]*tabIndex=\{-1\}/);
  assert.match(shells.pos, /className="skipLink" href="#pos-workspace"/);
  assert.match(shells.pos, /id="pos-workspace"[^>]*tabIndex=\{-1\}/);
  assert.match(shells.storefront, /className="skipLink" href="#storefront-main"/);
  assert.match(shells.storefront, /id="storefront-main"[^>]*tabIndex=\{-1\}/);
  assert.match(shells.employee, /className="skipLink" href="#employee-main"/);
  assert.match(shells.employee, /id="employee-main"[^>]*tabIndex=\{-1\}/);
});

test('UI-P7 exposes active navigation state and operational status semantically', () => {
  assert.match(shells.admin, /role="status" aria-live="polite"/);
  assert.match(shells.pos, /role="status" aria-live="polite"/);
  assert.match(shells.pos, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(shells.storefront, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(shells.employee, /aria-current=\{item\.id === activeView \? 'page' : undefined\}/);
});

test('UI-P7 Tailwind CSS hardens keyboard focus, reduced motion, and touch targets in every app', () => {
  for (const [name, source] of Object.entries(css)) {
    assert.match(source, /@import \"tailwindcss\"/, `${name} tailwind import`);
    assert.match(source, /focus-visible:|:focus-visible/, `${name} focus visible`);
    assert.match(source, /prefers-reduced-motion:\s*reduce/, `${name} reduced motion`);
    assert.match(source, /pointer:\s*coarse/, `${name} coarse pointer`);
    assert.match(source, /min-height:\s*44px|min-h-11|min-h-\[44px\]/, `${name} touch target`);
  }
});

test('UI-P7 keeps real-browser contracts unchanged while polishing presentation', () => {
  for (const literal of [
    'TOKO360 OFFICIAL STORE',
    'Belanja langsung dari toko',
    'Masuk ke terminal kasir',
    'TOKO360 POS',
    'TOKO360 HR',
    'Portal Karyawan',
  ]) assert.match(browser, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(shells.pos, /TOKO360 POS/);
  assert.match(shells.pos, /Kasir · Terminal penjualan/);
  assert.match(shells.employee, /TOKO360 HR/);
  assert.match(shells.employee, /Portal Karyawan/);
});

test('UI-P7 mobile navigation stays inside the viewport and keeps touch targets without page-level horizontal scrolling', () => {
  for (const [name, source] of Object.entries(css)) {
    assert.match(source, /body[^{}]*\{[^}]*overflow-x:\s*hidden|body\s*\{[^}]*overflow-x\s*:\s*hidden/s, `${name} page must clamp horizontal overflow`);
  }
  assert.match(shells.admin, /className="adminPrimaryNavigation"/);
  assert.match(shells.admin, /adminSidebarSubdomains/);
  assert.match(css.pos, /\.posWorkspaceNav\s*\{?\s*@apply[^}]*\bgrid\b[^}]*\bgrid-cols-4\b/);
  assert.match(css.storefront, /\.mobileNav\{@apply[^}]*grid-cols-4/);
  assert.match(css.employee, /\.employeeMobileNav\{@apply[^}]*grid grid-cols-4/);
  assert.match(css.admin + css.pos + css.storefront + css.employee, /min-height:\s*44px|min-h-11|min-h-\[44px\]/);
});
