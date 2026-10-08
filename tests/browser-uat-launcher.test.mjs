import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync('scripts/browser-uat.mjs','utf8');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));

test('browser UAT launcher is fail-closed and uses real Chromium CDP', () => {
  assert.match(script, /remote-debugging-port/);
  assert.match(script, /new WebSocket/);
  assert.match(script, /T360_UAT_ADMIN_EMAIL/);
  assert.match(script, /T360_UAT_ADMIN_PASSWORD/);
  assert.doesNotMatch(script, /Admin123!/);
  assert.match(script, /process\.exitCode = 1/);
});

test('browser UAT verifies authenticated delivery lifecycle through canonical contextual ownership', () => {
  assert.match(script, /navigateAdminContext\(cdp, '\/operations-control\/delivery'/);
  assert.doesNotMatch(script, /data-admin-route=\"\/assets-fleet\"[\s\S]{0,500}Outbound \/ Delivery Lifecycle/);
  assert.match(script, /Outbound \/ Delivery Lifecycle/);
  assert.match(script, /TRIP WORKBENCH/);
  assert.match(script, /Delivery lifecycle gagal dimuat/);
});

test('browser UAT verifies payroll lifecycle read model in Admin', () => {
  assert.match(script, /navigateAdminContext\(cdp, '\/people\/payroll'/);
  assert.match(script, /PAYROLL LIFECYCLE/);
  assert.match(script, /Riwayat Payroll Runs/);
  assert.match(script, /ADMIN_PAYROLL_LIFECYCLE/);
  assert.match(script, /Gagal memuat HR\/Payroll/);
});

test('browser UAT verifies employee master through canonical people domain route', () => {
  assert.match(script, /navigateAdminContext\(cdp, '\/people\/employees'/);
  assert.doesNotMatch(script, /textContent\?\.trim\(\)===['\"]Employees['\"]/);
  assert.match(script, /EMPLOYEE MASTER/);
  assert.match(script, /Tambah karyawan/);
  assert.match(script, /Daftar Karyawan/);
});

test('browser UAT is exposed directly through npm', () => {
  assert.equal(pkg.scripts['uat:browser'], 'node scripts/browser-uat.mjs');
  assert.equal(fs.existsSync('run-browser-uat.cmd'), false);
});


test('browser UAT evidence is bound to the current source fingerprint', () => {
  assert.match(script, /sourceIdentity: sourceFingerprint\(root\)/);
});


test('browser UAT renders Storefront, POS, and Employee Portal in real browser', () => {
  assert.match(script, /STOREFRONT_BROWSER_RENDER/);
  assert.match(script, /TOKO360 OFFICIAL STORE/);
  assert.match(script, /POS_BROWSER_RENDER/);
  assert.match(script, /Masuk ke terminal kasir/);
  assert.match(script, /EMPLOYEE_PORTAL_BROWSER_RENDER/);
  assert.match(script, /Portal Karyawan/);
  assert.match(script, /Page\.navigate/);
});

test('browser UAT waits for Chromium termination before retrying profile cleanup', () => {
  assert.match(script, /async function stopBrowserProcess/);
  assert.match(script, /browser\.once\('exit'/);
  assert.match(script, /SIGKILL/);
  assert.match(script, /async function removeBrowserProfile/);
  assert.match(script, /ENOTEMPTY/);
  assert.match(script, /await removeBrowserProfile\(tempDir\)/);
});


test('browser UAT uses collision-safe Chromium DevTools port discovery', () => {
  assert.match(script, /remote-debugging-port=\$\{requestedDebugPort\}/);
  assert.match(script, /DevToolsActivePort/);
  assert.match(script, /waitForBrowserDevTools/);
  assert.doesNotMatch(script, /T360_BROWSER_DEBUG_PORT \|\| 49321/);
  assert.match(script, /Chromium berhenti sebelum DevTools siap/);
});
