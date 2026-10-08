import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(file)=>fs.readFileSync(file,'utf8');
const pkg=JSON.parse(read('package.json'));
const adminShell=read('apps/admin/app/app-shell.tsx');
const adminTheme=read('apps/admin/app/theme-contract.ts');
const posPage=read('apps/pos/app/page.tsx');
const posShell=read('apps/pos/app/pos-shell.tsx');
const posCss=read('apps/pos/app/globals.css');
const storefrontShell=read('apps/storefront/app/storefront-shell.tsx');
const employeeApp=read('apps/employee-portal/app/employee-portal-app.tsx');
const employeeShell=read('apps/employee-portal/app/employee-portal-shell.tsx');
const employeeCss=read('apps/employee-portal/app/globals.css');
const audit=read('scripts/audit-ui-domain-surface-depth.mjs');
const f1=JSON.parse(read('config/f1-backend-ui-audit.json'));

test('full UI root wave is a permanent P5 gate',()=>{
  assert.equal(pkg.scripts['audit:ui:domain-depth'],'node scripts/audit-ui-domain-surface-depth.mjs');
  assert.match(pkg.scripts['audit:p5:visual'],/audit-ui-domain-surface-depth\.mjs/);
});

test('Admin keeps reference-light default and functional persisted dark mode',()=>{
  assert.match(adminShell,/data-theme=\{theme\}/);
  assert.match(adminTheme,/toko360:ui-theme:v411:admin/);
  assert.match(adminShell,/useT360Theme\(\)/);
  assert.match(adminShell,/Aktifkan mode gelap/);
  assert.match(adminShell,/Aktifkan mode terang/);
});

test('POS is light-first, tenant-aware and exposes real digital receipt capability',()=>{
  // Light default preserved via .posV4 in the stylesheet; a Tailwind bg-* utility on the themed
  // root would outrank the [data-theme='dark'] rules and freeze the POS in light mode.
  const posShellRootTag = posShell.slice(posShell.indexOf('<main'), posShell.indexOf('>', posShell.indexOf('<main')));
  assert.doesNotMatch(posShellRootTag,/\bbg-slate-\d{2,3}\b/);assert.doesNotMatch(posShellRootTag,/\btext-slate-950\b/);assert.match(posShell,/posV4 min-h-screen min-w-0/);
  assert.match(posShell,/companyName/);
  assert.match(posShell,/branchName/);
  assert.match(posPage,/companyName=\{manifest\?\.company\?\.name/);
  assert.match(posPage,/branchName=\{manifest\?\.branch\?\.name/);
  assert.match(posPage,/\/receipts\/\$\{encodeURIComponent\(lastReceipt\.number\)\}/);
  assert.match(posCss,/\.receiptReady/);
  assert.doesNotMatch(posCss,/\.posV4\{[^}]*background\s*:\s*#0[0-9a-f]{5}/i);
});

test('Storefront and Employee expose tenant context while Employee mobile keeps all seven subdomains reachable',()=>{
  assert.match(storefrontShell,/companyName/);
  assert.match(storefrontShell,/onBranchChange/);
  assert.match(employeeApp,/api\('\/platform\/manifest'\)/);
  assert.match(employeeApp,/companyName=\{manifest\?\.company\?\.name/);
  assert.match(employeeShell,/NAV\.map\(/);
  assert.doesNotMatch(employeeShell,/NAV\.slice\(0,\s*4\)/);
  assert.match(employeeCss,/employeeMobileNav[^}]*grid-cols-4/);
});

test('deep audit rejects semantic-style gaps, no-op controls and unexpected hidden controllers',()=>{
  for(const marker of ['requiredSemantic','explicit no-op click handler','permanent disabled={true}','edge-sync.controller.ts','digital receipt backend capability']) assert.match(audit,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const hidden=f1.controllerExposure.filter((item)=>item.exposure!=='EXPOSED_OR_PARTIAL').map((item)=>item.controller);
  assert.deepEqual(hidden,['apps/api/src/extensions/edge-sync.controller.ts']);
  assert.deepEqual(f1.capabilities.filter((item)=>item.status==='PARTIAL').map((item)=>item.id),['F9']);
  assert.equal(f1.capabilities.find((item)=>item.id==='F10')?.status,'EXPOSED');
});
