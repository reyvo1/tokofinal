import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const controller = fs.readFileSync('apps/api/src/reports/daily-digest.controller.ts', 'utf8');
const service = fs.readFileSync('apps/api/src/reports/daily-digest.service.ts', 'utf8');
const admin = fs.readFileSync('apps/admin/app/modules/extensions.tsx', 'utf8');
const probe = fs.readFileSync('scripts/ci-notification-provider-probe.mjs', 'utf8');
const seed = fs.readFileSync('apps/api/prisma/seed.ts', 'utf8');
const fullUatWorkflow = fs.readFileSync('.github/workflows/toko360-full-uat.yml', 'utf8');
const fullSystemWorkflow = fs.readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');
const handoff = fs.readFileSync('handoff/CURRENT-WORK.md', 'utf8');
const state = fs.readFileSync('docs/PROJECT-STATE.md', 'utf8');

test('R3 is runtime-closed before R7 verification starts', () => {
  assert.match(handoff, /R1–R6 functional prerequisites are CLOSED/);
  assert.match(handoff, /R3 residual F37\/F39\/F42\/F43/);
  assert.match(state, /R3\/R4 closure and R7 verification/);
  assert.match(state, /R3 residual F37\/F39\/F42\/F43/);
});

test('R3 daily digest mutations are permissioned and manual send respects enabled flag', () => {
  assert.match(controller, /@Post\('reports\/daily-digest\/config'\)[\s\S]*@Permissions\('notification\.manage'\)/);
  assert.match(controller, /@Post\('reports\/daily-digest\/send'\)[\s\S]*@Permissions\('notification\.manage'\)/);
  assert.match(service, /if \(!config\.enabled\) throw new BadRequestException\('Owner daily digest sedang nonaktif/);
});

test('R3 owner digest stores verified Telegram binding IDs instead of raw recipients', () => {
  assert.match(service, /recipientBindingIds/);
  assert.match(service, /employeeChannelBinding\.findMany/);
  assert.match(service, /channel: 'TELEGRAM'/);
  assert.match(service, /verifiedAt: \{ not: null \}/);
  assert.match(service, /revokedAt: null/);
  assert.doesNotMatch(service, /for \(const recipient of config\.recipients\)/);
  assert.match(admin, /Penerima Telegram terverifikasi/);
  assert.match(admin, /recipientBindingIds/);
});

test('R3 low-stock digest compares branch inventory against product minStock without hard-coded lte 10 prefilter', () => {
  assert.match(service, /minStock: \{ gt: 0 \}/);
  assert.match(service, /inventories: \{ some:/);
  assert.match(service, /item\.available <= item\.product\.minStock/);
  assert.doesNotMatch(service, /available: \{ lte: 10 \}/);
});

test('R3 provider simulation verifies Telegram recipient before configuring and sending owner digest', () => {
  assert.match(probe, /employee\/me\/channels\/request-verification/);
  assert.match(probe, /employee\/me\/channels\/verify/);
  assert.match(probe, /recipientBindingIds:\[bindingRequest\.bindingId\]/);
  assert.match(probe, /verification \+ owner digest \+ manual wajib terkirim/);
  assert.match(probe, /verifiedRecipient:true/);
});
test('R3 provider simulation uses a real dedicated bootstrap employee fixture in both GitHub workflows', () => {
  assert.match(seed, /SEED_EMPLOYEE_EMAIL dan SEED_EMPLOYEE_PASSWORD harus diberikan berpasangan/);
  assert.match(seed, /bootstrapPassword\('SEED_EMPLOYEE_PASSWORD'\)/);
  assert.match(seed, /employeeNumber: 'CI-EMP-0001'/);
  assert.match(seed, /roleId: employeeRole\.id/);

  for (const [label, workflow] of [
    ['full automated UAT', fullUatWorkflow],
    ['full-system simulation', fullSystemWorkflow],
  ]) {
    assert.match(workflow, /SEED_EMPLOYEE_EMAIL: ci-employee@example\.invalid/, `${label} must seed dedicated employee email`);
    assert.match(workflow, /SEED_EMPLOYEE_PASSWORD: CI-Only-Employee-Password-2026!/, `${label} must seed dedicated employee password`);
  }

  assert.match(probe, /process\.env\.SEED_EMPLOYEE_EMAIL\|\|'ci-employee@example\.invalid'/);
  assert.match(probe, /process\.env\.SEED_EMPLOYEE_PASSWORD\|\|'CI-Only-Employee-Password-2026!'/);
  assert.match(probe, /const employeeLogin=await request\('\/auth\/login'/);
});



test('R3 cashier-target runtime fixture uses a real active CASHIER instead of the admin identity', () => {
  const residualProbe = fs.readFileSync('scripts/ci-r3-residual-probe.mjs', 'utf8');
  assert.match(residualProbe, /const users = await request\('\/users', \{ token \}\)/);
  assert.match(residualProbe, /assignment\?\.role\?\.name === 'CASHIER'/);
  assert.match(residualProbe, /request\('\/users', \{[\s\S]*method: 'POST'[\s\S]*roleNames: \['CASHIER'\]/);
  assert.match(residualProbe, /targets: \{ \[cashier\.id\]: targetValue \}/);
  assert.match(residualProbe, /row\.userId === cashier\.id/);
  assert.doesNotMatch(residualProbe, /targets: \{ \[identity\.sub\]: targetValue \}/);
});

test('R3 residual F37/F39/F42/F43 operator surfaces are wired to real APIs', () => {
  const residual = fs.readFileSync('apps/admin/app/modules/r3-operations.tsx', 'utf8');
  const page = fs.readFileSync('apps/admin/app/page.tsx', 'utf8');
  const extensionsController = fs.readFileSync('apps/api/src/extensions/extensions.controller.ts', 'utf8');
  const extensionsService = fs.readFileSync('apps/api/src/extensions/extensions.service.ts', 'utf8');

  assert.match(page, /R3OperationsView/);
  assert.match(residual, /\/payments\/provider-events\?limit=100/);
  assert.match(residual, /\/reports\/multi-outlet/);
  assert.match(residual, /\/sales\/cashier-targets/);
  assert.match(residual, /\/devices\/\$\{deviceId\}\/sync\/diagnostics\?limit=100/);
  assert.match(residual, /\/devices\/\$\{selectedDeviceId\}\/sync\/ack/);
  assert.match(residual, /offline-transactions\/\$\{transaction\.id\}\/requeue/);
  assert.match(residual, /\/marketplace-orders\/import/);
  assert.match(residual, /request<MarketplaceOrder\[\]>\(token, '\/marketplace-orders'\)/);

  assert.match(extensionsController, /@Get\('devices\/:id\/sync\/diagnostics'\)/);
  assert.match(extensionsController, /@Permissions\('integration\.view'\)/);
  assert.match(extensionsService, /async deviceSyncDiagnostics/);
  assert.match(extensionsService, /syncReceipt\.findMany/);
  assert.match(extensionsService, /offlineTransaction\.findMany/);
  assert.match(extensionsService, /companyId: scope\.companyId, branchId: scope\.branchId/);
});
