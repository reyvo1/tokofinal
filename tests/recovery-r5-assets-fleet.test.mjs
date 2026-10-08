import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const master = read('docs/TOKO360-MASTER-RECOVERY-WORKFLOW.md');
const findings = JSON.parse(read('config/recovery-finding-matrix.json'));
const assetSchema = read('apps/api/prisma/schema.prisma');
const assetPgSchema = read('apps/api/prisma/schema.postgresql.prisma');
const assetDto = read('apps/api/src/assets/dto/assets.dto.ts');
const assetController = read('apps/api/src/assets/assets.controller.ts');
const assetService = read('apps/api/src/assets/assets.service.ts');
const fleetDto = read('apps/api/src/fleet/dto/fleet.dto.ts');
const fleetController = read('apps/api/src/fleet/fleet.controller.ts');
const fleetService = read('apps/api/src/fleet/fleet.service.ts');
const adminUi = read('apps/admin/app/modules/assets-fleet.tsx');
const worker = read('apps/worker/src/index.ts');
const runtimeProbe = read('scripts/ci-r5-assets-fleet-probe.mjs');
const fullSystem = read('.github/workflows/full-system-simulation.yml');
const fullUat = read('.github/workflows/toko360-full-uat.yml');
const summary = read('scripts/ci-write-full-system-summary.mjs');
const report = read('scripts/github-uat-report.mjs');
const packageJson = read('package.json');

function finding(id) {
  const rows = Array.isArray(findings) ? findings : findings.findings;
  return rows.find((row) => row.id === id);
}

test('R5 scope remains exactly the master recovery scope and HIGH findings require runtime evidence', () => {
  assert.match(master, /R5 — Assets, Fleet, Maintenance, and Operational Lifecycle[\s\S]*Depends on:\*\* R1/);
  assert.match(master, /Asset maintenance plans\./);
  assert.match(master, /Vehicle-driver assignment\./);
  assert.match(master, /Asset assign\/transfer\/dispose and maintenance lifecycle\./);
  for (const id of ['F31', 'F32', 'F33']) {
    assert.equal(finding(id)?.primaryWave, 'R5');
    assert.equal(finding(id)?.severity, 'HIGH');
    assert.equal(finding(id)?.runtimeEvidenceRequired, true);
  }
});

test('R5 F31 exposes tenant-scoped AssetMaintenancePlan management without schema drift', () => {
  for (const schema of [assetSchema, assetPgSchema]) {
    assert.match(schema, /model AssetMaintenancePlan[\s\S]*companyId\s+String[\s\S]*assetId\s+String[\s\S]*autoCreateWorkOrder\s+Boolean/);
  }
  assert.match(assetDto, /export class CreateAssetMaintenancePlanDto/);
  assert.match(assetDto, /export class UpdateAssetMaintenancePlanDto/);
  assert.match(assetController, /@Get\('maintenance-plans'\)/);
  assert.match(assetController, /@Permissions\('asset\.maintenance'\) @Post\('maintenance-plans'\)/);
  assert.match(assetController, /@Post\('maintenance-plans\/:id\/update'\)/);
  assert.match(assetService, /async listMaintenancePlans/);
  assert.match(assetService, /where: \{ companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(assetService, /CREATE_ASSET_MAINTENANCE_PLAN/);
  assert.match(assetService, /UPDATE_ASSET_MAINTENANCE_PLAN/);
  assert.match(worker, /assetMaintenancePlan\.findMany/);
  assert.match(worker, /asset\.maintenance\.due/);
  assert.match(worker, /CREATE_MAINTENANCE_WORK_ORDER/);
});

test('R5 F32 implements VehicleDriverAssignment lifecycle and primary-driver projection', () => {
  for (const schema of [assetSchema, assetPgSchema]) assert.match(schema, /model VehicleDriverAssignment[\s\S]*effectiveFrom DateTime[\s\S]*effectiveTo DateTime\?[\s\S]*isPrimary\s+Boolean/);
  assert.match(fleetDto, /export class CreateVehicleDriverAssignmentDto/);
  assert.match(fleetDto, /export class EndVehicleDriverAssignmentDto/);
  assert.match(fleetController, /@Get\('driver-assignments'\)/);
  assert.match(fleetController, /@Permissions\('fleet\.manage'\) @Post\('driver-assignments'\)/);
  assert.match(fleetController, /@Post\('driver-assignments\/:id\/end'\)/);
  assert.match(fleetService, /async createDriverAssignment/);
  assert.match(fleetService, /primaryOverlap/);
  assert.match(fleetService, /defaultDriverEmployeeId: employee\.id/);
  assert.match(fleetService, /async endDriverAssignment/);
  assert.match(fleetService, /defaultDriverEmployeeId: null/);
  assert.match(fleetService, /CREATE_VEHICLE_DRIVER_ASSIGNMENT/);
  assert.match(fleetService, /END_VEHICLE_DRIVER_ASSIGNMENT/);
});


test('R5 business-date input is interpreted in company timezone before active projection/accounting', () => {
  for (const source of [fleetService, assetService]) {
    assert.match(source, /parseBusinessDateBoundary/);
    assert.match(source, /company\.findUnique\(\{ where: \{ id: companyId \}, select: \{ timezone: true \} \}\)/);
    assert.doesNotMatch(source, /private parseBusinessDate[\s\S]{0,400}?new Date\(value\)/);
  }
  assert.match(fleetService, /effectiveFrom = this\.parseBusinessDate\(dto\.effectiveFrom, timeZone\)/);
  assert.match(fleetService, /effectiveTo = dto\.effectiveTo \? this\.parseBusinessDate\(dto\.effectiveTo, timeZone, true\) : undefined/);
  assert.match(fleetService, /effectiveTo = this\.parseBusinessDate\(dto\.effectiveTo, timeZone, true\)/);
  assert.match(fleetService, /transactionDate = this\.parseBusinessDate\(dto\.transactionDate, timeZone\)/);
  assert.match(assetService, /acquisitionDate = this\.parseBusinessDate\(dto\.acquisitionDate, timeZone\)/);
  assert.match(assetService, /start = this\.parseBusinessDate\(dto\.periodStart, timeZone\)/);
  assert.match(assetService, /end = this\.parseBusinessDate\(dto\.periodEnd, timeZone, true\)/);
  assert.match(runtimeProbe, /assignmentEffectiveFrom > new Date\(\)/);
  assert.match(runtimeProbe, /primaryDriverClearOnEnd/);
});


test('R5 F33 exposes assign transfer dispose in Admin while preserving passed-inspection gate', () => {
  assert.match(adminUi, /\/assets\/\$\{assetAssignForm\.assetId\}\/assign/);
  assert.match(adminUi, /\/assets\/\$\{assetTransferForm\.assetId\}\/transfer/);
  assert.match(adminUi, /\/assets\/\$\{assetDisposeForm\.assetId\}\/dispose/);
  assert.match(adminUi, /ASSET HANDOVER/);
  assert.match(adminUi, /sourceType: 'Asset'.*type: 'ASSET_HANDOVER'/s);
  assert.match(adminUi, /Hasil kondisi/);
  assert.match(adminUi, /\['PASSED','APPROVED'\]\.includes\(row\.status\)/);
  assert.doesNotMatch(adminUi, /makeAssetInspection/);
  assert.match(assetService, /Inspeksi serah-terima aset belum lulus/);
  assert.match(assetService, /Inspeksi pelepasan aset belum lulus/);
});

test('R5 Admin exposes maintenance plan and driver assignment operator controls', () => {
  assert.match(adminUi, /\/assets\/maintenance-plans/);
  assert.match(adminUi, /Buat maintenance plan/);
  assert.match(adminUi, /\/fleet\/driver-assignments/);
  assert.match(adminUi, /Buat assignment/);
  assert.match(adminUi, /Akhiri/);
});

test('R5 exact-source PostgreSQL runtime probe is required by both GitHub workflows and aggregate evidence', () => {
  assert.match(packageJson, /"ci:r5:probe": "node scripts\/ci-r5-assets-fleet-probe\.mjs"/);
  for (const workflow of [fullSystem, fullUat]) {
    assert.match(workflow, /id: r5_assets_fleet/);
    assert.match(workflow, /npm run ci:r5:probe/);
  }
  assert.match(fullUat, /check "R5 assets\/fleet runtime probe" "\$STEP_R5_ASSETS_FLEET"/);
  assert.match(report, /R5 assets\/fleet runtime probe/);
  assert.match(summary, /github-r5-assets-fleet-probe-latest\.json/);
  assert.match(summary, /r5AssetsFleet/);
  for (const token of ['maintenancePlanManagement','driverAssignmentLifecycle','primaryDriverProjection','primaryDriverClearOnEnd','assetAssignLifecycle','assetTransferRequiresPassedInspection','assetDisposeLifecycle']) assert.match(runtimeProbe, new RegExp(token));
  assert.match(runtimeProbe, /sourceIdentity: sourceFingerprint\(root\)/);
});
