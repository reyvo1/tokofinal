import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const assetsController = readFileSync('apps/api/src/assets/assets.controller.ts', 'utf8');
const assetsService = readFileSync('apps/api/src/assets/assets.service.ts', 'utf8');
const assetsDto = readFileSync('apps/api/src/assets/dto/assets.dto.ts', 'utf8');
const fleetController = readFileSync('apps/api/src/fleet/fleet.controller.ts', 'utf8');
const fleetService = readFileSync('apps/api/src/fleet/fleet.service.ts', 'utf8');
const fleetDto = readFileSync('apps/api/src/fleet/dto/fleet.dto.ts', 'utf8');
const returnsController = readFileSync('apps/api/src/returns/returns.controller.ts', 'utf8');
const returnsService = readFileSync('apps/api/src/returns/returns.service.ts', 'utf8');

test('asset endpoints pass AuthUser through every read and mutation', () => {
  assert.match(assetsController, /this\.assets\.list\(user, companyId, branchId\)/);
  assert.match(assetsController, /this\.assets\.categories\(user, companyId\)/);
  assert.match(assetsController, /this\.assets\.createCategory\(dto, user\)/);
  assert.match(assetsController, /this\.assets\.acquire\(dto, user\)/);
  assert.match(assetsController, /this\.assets\.assign\(id, dto, user\)/);
  assert.match(assetsController, /this\.assets\.createMaintenance\(dto, user\)/);
  assert.match(assetsController, /this\.assets\.completeMaintenance\(id, dto, user\)/);
  assert.match(assetsController, /this\.assets\.runDepreciation\(dto, user\)/);
  assert.match(assetsController, /this\.assets\.summary\(user\)/);
  assert.match(assetsController, /this\.assets\.listMaintenances\(user, companyId, branchId\)/);
  assert.match(assetsController, /this\.assets\.transfer\(id, dto, user\)/);
  assert.match(assetsController, /this\.assets\.dispose\(id, dto, user\)/);
});

test('asset tenant fields are compatibility-only and writes use token scope', () => {
  assert.match(assetsDto, /companyId\?: string/);
  assert.match(assetsDto, /branchId\?: string/);
  assert.doesNotMatch(assetsDto, /companyId!:\s*string/);
  assert.match(assetsService, /assertRequestedScope\(this\.prisma, user, scope, dto\.companyId, dto\.branchId/);
  assert.doesNotMatch(assetsService, /companyId:\s*dto\.companyId/);
  assert.doesNotMatch(assetsService, /branchId:\s*dto\.branchId/);
  assert.match(assetsService, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId \}/);
});

test('asset foreign references, accounting, and lifecycle audit retain tenant context', () => {
  assert.match(assetsService, /branch: \{ companyId: scope\.companyId \}/);
  assert.match(assetsService, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId, isActive: true \}/);
  assert.match(assetsService, /calculateTax\(tx, dto\.taxCodeId, dto\.acquisitionCost, scope\.companyId, acquisitionDate, \['ASSET', 'PURCHASE', 'OTHER'\]\)/);
  assert.match(assetsService, /businessDate: acquisitionDate/);
  assert.match(assetsService, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId,[\s\S]*eventType/);
  assert.match(assetsService, /action: 'ASSET_ACQUIRED'/);
  assert.match(assetsService, /action: 'ASSIGN_ASSET'/);
  assert.match(assetsService, /action: 'COMPLETE_MAINTENANCE_WORK_ORDER'/);
  assert.match(assetsService, /action: 'RUN_ASSET_DEPRECIATION'/);
});

test('fleet endpoints pass AuthUser through every read and mutation', () => {
  assert.match(fleetController, /this\.fleet\.listVehicles\(user, companyId, branchId\)/);
  assert.match(fleetController, /this\.fleet\.createVehicle\(dto, user\)/);
  assert.match(fleetController, /this\.fleet\.createTrip\(dto, user\)/);
  assert.match(fleetController, /this\.fleet\.confirmLoading\(id, dto, user\)/);
  assert.match(fleetController, /this\.fleet\.dispatch\(id, dto, user\)/);
  assert.match(fleetController, /this\.fleet\.completeStop\(id, dto, user\)/);
  assert.match(fleetController, /this\.fleet\.closeTrip\(id, dto, user\)/);
  assert.match(fleetController, /this\.fleet\.recordFuel\(dto, user\)/);
  assert.match(fleetController, /this\.fleet\.summary\(user\)/);
  assert.match(fleetController, /this\.fleet\.listTrips\(user, companyId, branchId\)/);
  assert.match(fleetController, /this\.fleet\.listFuel\(user, companyId, branchId\)/);
});

test('fleet tenant fields cannot become tenant authority', () => {
  assert.match(fleetDto, /companyId\?: string/);
  assert.match(fleetDto, /branchId\?: string/);
  assert.doesNotMatch(fleetDto, /companyId!:\s*string/);
  assert.doesNotMatch(fleetDto, /branchId!:\s*string/);
  assert.doesNotMatch(fleetService, /companyId:\s*dto\.companyId/);
  assert.doesNotMatch(fleetService, /branchId:\s*dto\.branchId/);
  assert.match(fleetService, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId \}/);
});

test('trip creation validates tenant-owned vehicle, employee, warehouse, and fulfillment references', () => {
  assert.match(fleetService, /scopedVehicle\(tx, user, scope, dto\.vehicleId\)/);
  assert.match(fleetService, /assertEmployee\(tx, user, scope, dto\.driverEmployeeId\)/);
  assert.match(fleetService, /assertWarehouse\(tx, user, scope, dto\.originWarehouseId\)/);
  assert.match(fleetService, /assertShipment\(tx, user, scope, stop\.shipmentId\)/);
  assert.match(fleetService, /assertOrder\(tx, user, scope, stop\.orderId\)/);
  assert.match(fleetService, /assertSale\(tx, user, scope, stop\.saleId\)/);
  assert.match(fleetService, /InventoryBatch/);
  assert.match(fleetService, /InventorySerial/);
});

test('fleet loading, dispatch, stop, close, and fuel operations remain branch scoped and audited', () => {
  assert.match(fleetService, /scopedTrip\(tx, user, scope, tripId\)/);
  assert.match(fleetService, /assertGatePass\(tx, user, scope, dto\.gatePassId, trip\.id\)/);
  assert.match(fleetService, /action: 'DELIVERY_LOADING_CONFIRMED'/);
  assert.match(fleetService, /action: 'DISPATCH_DELIVERY_TRIP'/);
  assert.match(fleetService, /action: 'COMPLETE_DELIVERY_STOP'/);
  assert.match(fleetService, /action: 'CLOSE_DELIVERY_TRIP'/);
  assert.match(fleetService, /action: 'RECORD_FLEET_FUEL'/);
  assert.match(fleetService, /calculateTax\(tx, dto\.taxCodeId, base, scope\.companyId, transactionDate, \['EXPENSE', 'PURCHASE', 'OTHER'\]\)/);
});

test('return list endpoints derive warehouse set from token company and branch', () => {
  assert.match(returnsController, /this\.service\.listSaleReturns\(user\)/);
  assert.match(returnsController, /this\.service\.listPurchaseReturns\(user\)/);
  assert.match(returnsService, /tenantWarehouseIds\(this\.prisma, scope\)/);
  assert.match(returnsService, /where: \{ warehouseId: \{ in: warehouseIds \} \}/);
  assert.match(returnsService, /take: 500/);
});

test('sale and purchase return creation validate source records inside token tenant', () => {
  assert.match(returnsService, /branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \}/);
  assert.match(returnsService, /assertWarehouse\(this\.prisma, user, scope, dto\.warehouseId\)/);
  assert.match(returnsService, /goodsReceipt\.findFirst\(\{[\s\S]*warehouse: \{ branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \} \}/);
  assert.match(returnsService, /supplier: \{ companyId: scope\.companyId \}/);
  assert.match(returnsService, /items: \{ every: \{ product: \{ companyId: scope\.companyId \} \} \}/);
  assert.match(returnsService, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId,[\s\S]*sourceType: 'SaleReturn'/);
  assert.match(returnsService, /sourceType: 'PurchaseReturn'/);
});

test('return confirmation validates inspection, confirmation, gate pass, tax, warehouse, and outbox envelope', () => {
  assert.match(returnsService, /scopedSaleReturn\(tx, user, scope, id\)/);
  assert.match(returnsService, /scopedPurchaseReturn\(tx, user, scope, id\)/);
  assert.match(returnsService, /assertInspection\(tx, user, scope, inspectionId, 'SaleReturn', row\.id\)/);
  assert.match(returnsService, /assertConfirmation\(tx, user, scope, confirmationId, 'PurchaseReturn', row\.id\)/);
  assert.match(returnsService, /sourceType: 'PurchaseReturn',[\s\S]*sourceId: row\.id/);
  assert.match(returnsService, /assertReturnTaxCodes\(tx, user, scope/);
  assert.match(returnsService, /payload: \{[\s\S]*companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId/);
  assert.match(returnsService, /companyId: scope\.companyId,[\s\S]*action: 'CONFIRM_SALE_RETURN'/);
  assert.match(returnsService, /action: 'CONFIRM_PURCHASE_RETURN'/);
});

test('assets, fleet, and returns reject missing or cross-tenant context with structured audit', () => {
  for (const source of [assetsService, fleetService, returnsService]) {
    assert.match(source, /code: 'TENANT_CONTEXT_REQUIRED'/);
    assert.match(source, /action: 'TENANT_ACCESS_DENIED'/);
    assert.match(source, /code: 'TENANT_ACCESS_DENIED'/);
    assert.match(source, /companyId: scope\.companyId,[\s\S]*userId: user\.sub/);
  }
});
