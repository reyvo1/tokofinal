#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { businessDateKeyInTimeZone, companyTimeZoneFromBranchContext } from './lib/business-date-key.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-r5-assets-fleet-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential R5 probe tidak tersedia.');

async function request(route, { method = 'GET', body, token, expect } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expect !== undefined) {
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0, 800)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return data;
}

async function passedAssetInspection(token, assetId, stamp, suffix) {
  const inspection = await request('/operations-control/inspections', {
    method: 'POST', token,
    body: { sourceType: 'Asset', sourceId: assetId, type: 'ASSET_HANDOVER', metadata: { runtimeProbe: 'R5', suffix } },
  });
  const completed = await request(`/operations-control/inspections/${inspection.id}/complete`, {
    method: 'POST', token,
    body: { results: [{ code: `R5_HANDOVER_${suffix}`, label: `R5 handover ${suffix}`, result: 'PASS' }], notes: `R5 runtime ${stamp}` },
  });
  if (!['PASSED', 'APPROVED'].includes(completed.status)) throw new Error(`Inspeksi R5 ${suffix} tidak lulus: ${completed.status}`);
  return completed;
}

const login = await request('/auth/login', { method: 'POST', body: { email, password } });
const token = login.accessToken;
if (!token) throw new Error('Login R5 tidak menghasilkan access token.');
const stamp = Date.now();
const branchContext = await request('/auth/branch-context', { token });
const companyTimeZone = companyTimeZoneFromBranchContext(branchContext);
const today = businessDateKeyInTimeZone(new Date(), companyTimeZone);
const warehouses = await request('/inventory/warehouses', { token });
const warehouse = warehouses?.[0];
if (!warehouse?.id) throw new Error('Gudang bootstrap R5 runtime tidak tersedia.');

let employee = await request('/employee/me', { token, expect: 200 }).catch(async (error) => {
  if (!String(error?.message || '').includes('expected 200, got 404')) throw error;
  return request('/hr/employees', {
    method: 'POST', token,
    body: {
      userId: login.user.sub,
      employeeNumber: `R5-${String(stamp).slice(-8)}`,
      fullName: 'R5 Runtime Driver',
      email: login.user.email || email,
      employmentStatus: 'PERMANENT',
      hireDate: today,
      timezone: 'Asia/Makassar',
    },
  });
});
if (!employee?.id) throw new Error('Employee R5 runtime tidak tersedia.');

const category = await request('/assets/categories', {
  method: 'POST', token,
  body: {
    code: `R5V${String(stamp).slice(-7)}`,
    name: `R5 Vehicle Asset ${stamp}`,
    assetType: 'VEHICLE',
    usefulLifeMonths: 60,
  },
});
const asset = await request('/assets', {
  method: 'POST', token,
  body: {
    categoryId: category.id,
    warehouseId: warehouse.id,
    code: `R5A${String(stamp).slice(-8)}`,
    name: `R5 Runtime Asset ${stamp}`,
    acquisitionCost: 100000,
    residualValue: 0,
    usefulLifeMonths: 60,
    paymentMode: 'CASH',
  },
});
if (!asset?.id) throw new Error('Aset runtime R5 gagal dibuat.');

const plan = await request('/assets/maintenance-plans', {
  method: 'POST', token,
  body: {
    assetId: asset.id,
    code: `R5P${String(stamp).slice(-8)}`,
    name: `R5 Runtime Maintenance ${stamp}`,
    scheduleType: 'INTERVAL',
    intervalDays: 30,
    intervalOdometer: 5000,
    nextDueDate: today,
    nextDueOdometer: 5000,
    autoCreateWorkOrder: true,
  },
});
const plans = await request('/assets/maintenance-plans', { token });
const planVisible = Array.isArray(plans) && plans.some((row) => row.id === plan.id && row.assetId === asset.id && row.autoCreateWorkOrder === true);
if (!planVisible) throw new Error('AssetMaintenancePlan R5 tidak terlihat pada management lifecycle.');
await request(`/assets/maintenance-plans/${plan.id}/update`, { method: 'POST', token, body: { isActive: false } });
const updatedPlans = await request('/assets/maintenance-plans', { token });
const planTogglePersisted = updatedPlans.some((row) => row.id === plan.id && row.isActive === false);
if (!planTogglePersisted) throw new Error('AssetMaintenancePlan R5 tidak menyimpan lifecycle update.');

const vehicle = await request('/fleet/vehicles', {
  method: 'POST', token,
  body: {
    assetId: asset.id,
    code: `R5V${String(stamp).slice(-8)}`,
    plateNumber: `CI${String(stamp).slice(-6)}`,
    vehicleType: 'DELIVERY_VAN',
    currentOdometer: 100,
    fuelType: 'GASOLINE',
  },
});
const driverAssignment = await request('/fleet/driver-assignments', {
  method: 'POST', token,
  body: { vehicleId: vehicle.id, employeeId: employee.id, effectiveFrom: today, isPrimary: true, notes: 'R5 runtime primary driver' },
});
const assignments = await request('/fleet/driver-assignments', { token });
const assignmentVisible = Array.isArray(assignments) && assignments.some((row) => row.id === driverAssignment.id && row.vehicleId === vehicle.id && row.employeeId === employee.id && row.isPrimary === true);
if (!assignmentVisible) throw new Error('VehicleDriverAssignment R5 tidak terlihat pada lifecycle list.');
const assignmentEffectiveFrom = new Date(driverAssignment.effectiveFrom);
if (Number.isNaN(assignmentEffectiveFrom.getTime()) || assignmentEffectiveFrom > new Date()) {
  throw new Error(`VehicleDriverAssignment R5 business-date dipersist sebagai future instant: businessDate=${today}, timezone=${companyTimeZone}, effectiveFrom=${driverAssignment.effectiveFrom}.`);
}
const vehiclesWithDefault = await request('/fleet/vehicles', { token });
const projectedVehicle = vehiclesWithDefault.find((row) => row.id === vehicle.id);
const primaryDriverProjected = projectedVehicle?.defaultDriverEmployeeId === employee.id;
if (!primaryDriverProjected) {
  throw new Error(`Primary VehicleDriverAssignment R5 tidak diproyeksikan ke default driver aktif: businessDate=${today}, timezone=${companyTimeZone}, effectiveFrom=${driverAssignment.effectiveFrom}, defaultDriverEmployeeId=${projectedVehicle?.defaultDriverEmployeeId ?? 'null'}.`);
}
await request(`/fleet/driver-assignments/${driverAssignment.id}/end`, { method: 'POST', token, body: {} });
const assignmentsAfterEnd = await request('/fleet/driver-assignments', { token });
const assignmentEnded = assignmentsAfterEnd.some((row) => row.id === driverAssignment.id && Boolean(row.effectiveTo));
if (!assignmentEnded) throw new Error('VehicleDriverAssignment R5 tidak dapat diakhiri.');
const vehiclesAfterEnd = await request('/fleet/vehicles', { token });
const primaryDriverCleared = vehiclesAfterEnd.some((row) => row.id === vehicle.id && row.defaultDriverEmployeeId !== employee.id);
if (!primaryDriverCleared) throw new Error('VehicleDriverAssignment R5 yang diakhiri masih tertinggal sebagai default driver aktif.');

const assigned = await request(`/assets/${asset.id}/assign`, {
  method: 'POST', token,
  body: { employeeId: employee.id, warehouseId: warehouse.id, notes: 'R5 runtime assignment' },
});
if (!assigned?.id) throw new Error('Asset assign R5 tidak menghasilkan assignment.');
const transferInspection = await passedAssetInspection(token, asset.id, stamp, 'TRANSFER');
const transferred = await request(`/assets/${asset.id}/transfer`, {
  method: 'POST', token,
  body: { targetLocationName: `R5 Transfer Location ${stamp}`, inspectionId: transferInspection.id, notes: 'R5 runtime transfer' },
});
if (transferred.locationName !== `R5 Transfer Location ${stamp}`) throw new Error('Asset transfer R5 tidak memperbarui lokasi operator flow.');
const disposalInspection = await passedAssetInspection(token, asset.id, stamp, 'DISPOSAL');
const disposed = await request(`/assets/${asset.id}/dispose`, {
  method: 'POST', token,
  body: { mode: 'DISPOSAL', proceeds: 0, settlementMode: 'CASH', inspectionId: disposalInspection.id, reason: 'R5 runtime disposal' },
});
if (disposed.status !== 'DISPOSED') throw new Error(`Asset disposal R5 tidak selesai: ${disposed.status}`);

const checks = {
  maintenancePlanManagement: planVisible && planTogglePersisted,
  driverAssignmentLifecycle: assignmentVisible && assignmentEnded,
  primaryDriverProjection: primaryDriverProjected,
  primaryDriverClearOnEnd: primaryDriverCleared,
  assetAssignLifecycle: Boolean(assigned?.id),
  assetTransferRequiresPassedInspection: transferred.locationName === `R5 Transfer Location ${stamp}`,
  assetDisposeLifecycle: disposed.status === 'DISPOSED',
};
for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`R5 runtime check gagal: ${name}`);

const result = {
  generatedAt: new Date().toISOString(),
  status: 'PASS',
  sourceIdentity: sourceFingerprint(root),
  assetId: asset.id,
  maintenancePlanId: plan.id,
  vehicleId: vehicle.id,
  driverAssignmentId: driverAssignment.id,
  transferInspectionId: transferInspection.id,
  disposalInspectionId: disposalInspection.id,
  checks,
  productionTouched: false,
  note: 'R5 GitHub PostgreSQL runtime probe exercises AssetMaintenancePlan management, VehicleDriverAssignment lifecycle, and asset assign/transfer/dispose with explicit passed handover inspections against exact source fingerprint.',
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
