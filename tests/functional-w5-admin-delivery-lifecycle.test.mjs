import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fleet = read('apps/api/src/fleet/fleet.service.ts');
const ops = read('apps/api/src/operations-control/operations-control.service.ts');
const admin = read('apps/admin/app/modules/delivery-lifecycle.tsx');
const shell = read('apps/admin/app/modules/assets-fleet.tsx');

test('delivery stop is a tenant-scoped operational inspection source for real POD', () => {
  assert.match(ops, /case 'DeliveryStop'/);
  assert.match(ops, /deliveryStop\.findUnique\(\{ where: \{ id: sourceId \}/);
  assert.match(ops, /deliveryTrip\.findFirst\(\{ where: \{ id: row\.tripId, companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(fleet, /assertInspection\(tx, user, scope, dto\.proofInspectionId, 'DeliveryStop', stop\.id\)/);
});

test('pre-trip and post-trip inspections are bound to the same tenant-scoped trip', () => {
  assert.match(fleet, /assertInspection\(tx, user, scope, dto\.preTripInspectionId, 'DeliveryTrip', trip\.id\)/);
  assert.match(fleet, /assertInspection\(tx, user, scope, dto\.postTripInspectionId, 'DeliveryTrip', trip\.id\)/);
});

test('trip read model exposes operator state instead of a thin trip row', () => {
  for (const token of ['deliveryStop.findMany','deliveryManifestItem.findMany','vehicle.findMany','employee.findMany','operationalInspection.findMany','gatePass.findMany','shipment.findMany','product.findMany']) assert.match(fleet, new RegExp(token.replace('.', '\\.')));
  for (const field of ['vehicle:', 'driver:', 'originWarehouse:', 'loadingInspection:', 'preTripInspection:', 'postTripInspection:', 'gatePass:', 'stops:', 'manifestItems:']) assert.match(fleet, new RegExp(field));
});

test('failed or partial cargo is reconciled as returned when the vehicle closes the trip', () => {
  assert.match(fleet, /status: \{ in: \['FAILED','PARTIAL','RETURNED'\] \}/);
  assert.match(fleet, /data: \{ status: 'RETURNED' \}/);
  assert.match(fleet, /const returnedQty = Math\.max\(0, item\.loadedQty - item\.deliveredQty\)/);
  assert.match(fleet, /status: returnedQty > 0 \? 'RETURNED' : item\.status/);
});

test('admin asset fleet mounts the delivery lifecycle operator workbench', () => {
  assert.match(shell, /import DeliveryLifecycle from '\.\/delivery-lifecycle'/);
  assert.match(shell, /<DeliveryLifecycle token=\{token\}\/>/);
});

test('admin can create trip with vehicle driver warehouse shipment stops and manifest', () => {
  for (const endpoint of ['/fleet/vehicles','/hr/employees?limit=100','/master-data/warehouses','/shipments?limit=100','/products?limit=200']) assert.match(admin, new RegExp(endpoint.replaceAll('/','\\/').replace('?','\\?')));
  assert.match(admin, /stops:stops\.map/);
  assert.match(admin, /manifestItems:manifest\.map/);
  assert.match(admin, /Buat delivery trip/);
});

test('admin loading dispatch and gate pass actions use actual backend lifecycle endpoints', () => {
  assert.match(admin, /\/fleet\/trips\/\$\{selectedTrip\.id\}\/loading/);
  assert.match(admin, /\/operations-control\/gate-passes/);
  assert.match(admin, /gate-passes\/\$\{gate\.id\}\/approve/);
  assert.match(admin, /\/fleet\/trips\/\$\{selectedTrip\.id\}\/dispatch/);
  assert.match(admin, /VEHICLE-PRETRIP/);
});

test('admin stop workflow covers POD COD failed-return and post-trip close', () => {
  assert.match(admin, /makeInspection\('DeliveryStop',stop\.id,'DELIVERY_PROOF','DELIVERY-PROOF'\)/);
  assert.match(admin, /codCollected/);
  assert.match(admin, /<option>FAILED<\/option>/);
  assert.match(admin, /<option>RETURNED<\/option>/);
  assert.match(admin, /VEHICLE_POSTTRIP/);
  assert.match(admin, /\/fleet\/trips\/\$\{selectedTrip\.id\}\/close/);
});
