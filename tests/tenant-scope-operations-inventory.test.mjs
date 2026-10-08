import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('operations-control endpoints pass AuthUser through every tenant-sensitive operation', () => {
  const controller = read('apps/api/src/operations-control/operations-control.controller.ts');
  for (const method of ['listPolicies', 'upsertPolicy', 'createTemplate', 'createInspection', 'completeInspection', 'approveInspection', 'createGatePass', 'approveGatePass', 'recordGateMovement', 'confirmOperation']) {
    assert.match(controller, new RegExp(`${method}\\([^)]*user|${method}\\([^;]*user`, 's'));
  }
  assert.match(controller, /@CurrentUser\(\) user: AuthUser/g);
});

test('operation policy, inspection, gate pass, and confirmation force token tenant', () => {
  const service = read('apps/api/src/operations-control/operations-control.service.ts');
  assert.match(service, /requireTenantScope\(user: AuthUser\)/);
  assert.match(service, /companyId: scope\.companyId, branchId: scope\.branchId/);
  assert.match(service, /OR: \[\{ branchId: scope\.branchId \}, \{ branchId: null \}\]/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(service, /action: 'UPSERT_OPERATION_POLICY'/);
  assert.match(service, /action: 'CREATE_OPERATIONAL_INSPECTION'/);
  assert.match(service, /action: 'CREATE_GATE_PASS'/);
  assert.match(service, /action: 'CONFIRM_OPERATION'/);
});

test('operations-control validates source and foreign references inside tenant', () => {
  const service = read('apps/api/src/operations-control/operations-control.service.ts');
  for (const source of ['GoodsReceipt', 'PurchaseOrder', 'Sale', 'Order', 'SaleReturn', 'PurchaseReturn', 'Asset', 'MaintenanceWorkOrder', 'DeliveryTrip', 'StockTransfer', 'StockOpname', 'Shipment']) {
    assert.match(service, new RegExp(`case '${source}'`));
  }
  assert.match(service, /companyId: scope\.companyId, branchId: scope\.branchId/);
  assert.match(service, /inspection\.sourceType !== dto\.sourceType/);
  assert.match(service, /driverEmployeeId.*companyId: scope\.companyId.*branchId: scope\.branchId/s);
});

test('legacy operations tenant fields are compatibility-only', () => {
  const dto = read('apps/api/src/operations-control/dto/operations-control.dto.ts');
  assert.match(dto, /Kompatibilitas lama; company tetap berasal dari token\./);
  assert.match(dto, /Kompatibilitas lama; branch tetap berasal dari token\./);
  assert.doesNotMatch(dto, /@ApiProperty\(\) @IsString\(\) companyId!:/);
  assert.doesNotMatch(dto, /@ApiProperty\(\) @IsString\(\) branchId!:/);
});

test('advanced inventory list and lifecycle endpoints receive AuthUser', () => {
  const controller = read('apps/api/src/advanced-inventory/advanced-inventory.controller.ts');
  for (const method of ['listTransfers', 'createTransfer', 'approveTransfer', 'shipTransfer', 'receiveTransfer', 'listOpnames', 'createOpname', 'countOpname', 'submitOpname', 'completeOpname']) {
    assert.match(controller, new RegExp(`${method}\\([^;]*user`, 's'));
  }
});

test('stock transfer scopes source and destination responsibilities to token branch', () => {
  const service = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
  assert.match(service, /side: 'source' \| 'destination'/);
  assert.match(service, /side === 'source' \? 'branch' : 'company'/);
  assert.match(service, /side === 'destination' \? 'branch' : 'company'/);
  assert.match(service, /action: 'CREATE_STOCK_TRANSFER'/);
  assert.match(service, /action: 'APPROVE_STOCK_TRANSFER'/);
  assert.match(service, /action: 'SHIP_STOCK_TRANSFER'/);
  assert.match(service, /action: 'RECEIVE_STOCK_TRANSFER'/);
});

test('stock transfer accounting and outbox retain company and branch envelope', () => {
  const service = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
  assert.match(service, /companyId: scope\.companyId, branchId: source\.branchId, eventType: 'STOCK_TRANSFER_SHIPPED'/);
  assert.match(service, /companyId: scope\.companyId, branchId: destination\.branchId, eventType: 'STOCK_TRANSFER_RECEIVED'/);
  assert.match(service, /payload: \{ companyId: scope\.companyId, branchId: source\.branchId/);
  assert.match(service, /payload: \{ companyId: scope\.companyId, branchId: destination\.branchId/);
});

test('stock opname is warehouse tenant scoped and audited', () => {
  const service = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
  assert.match(service, /warehouse\(this\.prisma, user, scope, dto\.warehouseId, 'branch', true\)/);
  assert.match(service, /warehouseLocation\.findFirst\(\{ where: \{ id: dto\.locationId, warehouseId: warehouse\.id/);
  assert.match(service, /action: 'CREATE_STOCK_OPNAME'/);
  assert.match(service, /action: 'COUNT_STOCK_OPNAME'/);
  assert.match(service, /action: 'SUBMIT_STOCK_OPNAME'/);
  assert.match(service, /action: 'COMPLETE_STOCK_OPNAME'/);
  assert.match(service, /eventType: 'inventory\.opname\.completed'.*companyId: scope\.companyId, branchId: scope\.branchId/s);
});
