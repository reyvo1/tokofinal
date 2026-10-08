import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const controller = read('apps/api/src/extensions/extensions.controller.ts');
const service = read('apps/api/src/extensions/extensions.service.ts');
const dto = read('apps/api/src/extensions/dto/extensions.dto.ts');
const moduleSource = read('apps/api/src/extensions/extensions.module.ts');
const syncBlock = service.slice(service.indexOf('  async devices('), service.indexOf('  async forecasts('));

const methodReceivesUser = (method) => new RegExp(`${method}\\([^;]*@CurrentUser\\(\\) user: AuthUser`, 's');

test('remaining extension endpoints receive authenticated tenant context', () => {
  for (const method of [
    'batches', 'createBatch', 'serials', 'createSerial',
    'loyaltyPrograms', 'createLoyaltyProgram', 'loyaltyTransaction', 'devices', 'registerDevice',
    'submitOfflineTransactions', 'forecasts', 'runForecast', 'shipments', 'createShipment',
    'marketplaces', 'importMarketplaceOrder', 'notifications', 'queueNotification',
  ]) assert.match(controller, methodReceivesUser(method));
});

test('extension service requires tenant context and records denied access', () => {
  assert.match(service, /private requireTenantScope\(user: AuthUser\): TenantScope/);
  assert.match(service, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(service, /authenticatedCompanyId: scope\.companyId/);
  assert.match(service, /authenticatedBranchId: scope\.branchId/);
});

test('inventory batches and serials are constrained to token warehouses', () => {
  assert.match(service, /tenantWarehouseIds\(client: DbClient, scope: TenantScope\)/);
  assert.match(service, /where: \{ branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \} \}/);
  assert.match(service, /where: \{ warehouseId: \{ in: warehouseIds \}/g);
  assert.match(service, /assertInventoryProduct\(tx, user, scope, dto\.warehouseId, dto\.productId\)/g);
  assert.match(service, /'PRE_REGISTER_INVENTORY_BATCH'/);
  assert.match(service, /'CREATE_INVENTORY_SERIAL'/);
});

test('P4 removes legacy return aliases from extensions and keeps returns ownership canonical', () => {
  assert.match(moduleSource, /imports: \[PlatformModule\]/);
  assert.doesNotMatch(moduleSource, /ReturnsModule/);
  assert.doesNotMatch(controller, /sale-returns|purchase-returns/);
  assert.doesNotMatch(service, /ReturnsService|saleReturns\(|createSaleReturn\(|completeSaleReturn\(|purchaseReturns\(|createPurchaseReturn\(|completePurchaseReturn\(/);
  assert.doesNotMatch(dto, /class CreateSaleReturnDto|class CreatePurchaseReturnDto|class ReturnItemDto/);
});

test('loyalty program and transactions remain inside token company', () => {
  assert.match(service, /loyaltyProgram\.findMany\(\{ where: \{ companyId: scope\.companyId \}/);
  assert.match(service, /companyId: scope\.companyId,[\s\S]*name: dto\.name/);
  assert.match(service, /loyaltyProgram\.findFirst\(\{ where: \{ id: dto\.programId, companyId: scope\.companyId, isActive: true \} \}/);
  assert.match(service, /'CREATE_LOYALTY_PROGRAM'/);
  assert.match(service, /'CREATE_LOYALTY_TRANSACTION'/);
});

test('device registration and offline sync preserve tenant envelope and idempotency', () => {
  assert.match(service, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId, isActive: true \}/);
  assert.match(service, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId,[\s\S]*code: dto\.code/);
  assert.match(syncBlock, /OR: \[\{ localId: item\.localId \}, \{ sequence: item\.sequence \}\]/);
  assert.match(syncBlock, /Replay transaksi offline memakai localId\/sequence dengan payload berbeda/);
  assert.match(syncBlock, /const tenantPayload = this\.tenantPayload\(item\.payload, scope\)/);
  assert.match(syncBlock, /this\.stableJson\(existing\.payload\) !== this\.stableJson\(tenantPayload\)/);
  assert.match(syncBlock, /payload: tenantPayload/);
  assert.match(syncBlock, /Payload offline memakai company berbeda dari credential device/);
  assert.match(syncBlock, /Payload offline memakai branch berbeda dari credential device/);
  assert.match(service, /edgeSubmitOfflineTransactions/);
  assert.match(service, /'SUBMIT_OFFLINE_TRANSACTIONS'/);
});

test('forecast list and calculation only use token branch warehouse inventory', () => {
  assert.match(service, /forecastRun\.findMany\(\{[\s\S]*companyId: scope\.companyId[\s\S]*warehouseId: \{ in: warehouseIds \}/);
  assert.match(service, /const warehouse = await this\.assertWarehouse\(this\.prisma, user, scope, dto\.warehouseId\)/);
  assert.match(service, /sale: \{ warehouseId: warehouse\.id, branchId: scope\.branchId, status: 'COMPLETED'/);
  assert.match(service, /inventory\.findMany\(\{[\s\S]*warehouseId: warehouse\.id, product: \{ isActive: true \}/);
  assert.doesNotMatch(service.slice(service.indexOf('  async runForecast('), service.indexOf('  async shipments(')), /product\.findMany/);
  assert.match(service, /'RUN_INVENTORY_FORECAST'/);
});

test('shipment creation validates warehouse order sale and integration tenant references', () => {
  assert.match(service, /shipment\.findMany\(\{[\s\S]*warehouseId: \{ in: warehouseIds \}/);
  assert.match(service, /order\.findFirst\(\{ where: \{ id: dto\.orderId, branchId: scope\.branchId, warehouseId: warehouse\.id \} \}/);
  assert.match(service, /sale\.findFirst\(\{ where: \{ id: dto\.saleId, branchId: scope\.branchId, warehouseId: warehouse\.id \} \}/);
  assert.match(service, /assertIntegration\(this\.prisma, user, scope, dto\.integrationId\)/);
  assert.match(service, /metadata: \{ companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(service, /'CREATE_SHIPMENT'/);
});

test('marketplace orders are scoped through trusted integration connections', () => {
  assert.match(service, /integrationConnection\.findMany\(\{[\s\S]*companyId: scope\.companyId[\s\S]*OR: \[\{ branchId: null \}, \{ branchId: scope\.branchId \}\]/);
  assert.match(service, /marketplaceOrder\.findMany\(\{[\s\S]*integrationId: \{ in: integrations\.map/);
  assert.match(service, /const integration = await this\.assertIntegration\(this\.prisma, user, scope, dto\.integrationId\)/);
  assert.match(service, /orderData: this\.tenantPayload\(dto\.orderData, scope\)/);
  assert.match(service, /'IMPORT_MARKETPLACE_ORDER'/);
  assert.match(service, /'UPDATE_MARKETPLACE_ORDER'/);
});

test('notifications use token company and branch envelope', () => {
  assert.match(service, /notification\.findMany\(\{[\s\S]*where: \{ companyId: scope\.companyId \}/);
  assert.match(service, /const data = row\.data as Record<string, unknown> \| null/);
  assert.match(service, /const branchAllowed = !data\?\.branchId \|\| data\.branchId === scope\.branchId/);
  assert.match(service, /return branchAllowed && channelAllowed && statusAllowed/);
  assert.match(service, /assertRequestedScope\(this\.prisma, user, scope, dto\.companyId, dto\.branchId, 'Notification'\)/);
  assert.match(service, /companyId: scope\.companyId,[\s\S]*data: this\.tenantPayload\(renderData, scope\)/);
  assert.match(service, /'QUEUE_NOTIFICATION'/);
});

test('legacy extension tenant fields are compatibility-only', () => {
  for (const className of ['CreateLoyaltyProgramDto', 'RegisterDeviceDto', 'RunForecastDto', 'QueueNotificationDto']) {
    const start = dto.indexOf(`export class ${className}`);
    assert.notEqual(start, -1);
    const next = dto.indexOf('export class ', start + 1);
    const block = dto.slice(start, next === -1 ? undefined : next);
    assert.match(block, /companyId\?: string/);
    assert.doesNotMatch(block, /companyId!:\s*string/);
  }
  assert.match(dto, /export class RegisterDeviceDto[\s\S]*branchId\?: string/);
  assert.match(dto, /export class RunForecastDto[\s\S]*branchId\?: string/);
  assert.match(dto, /export class QueueNotificationDto[\s\S]*branchId\?: string/);
  assert.doesNotMatch(service, /companyId:\s*dto\.companyId/);
  assert.doesNotMatch(service, /branchId:\s*dto\.branchId/);
});
