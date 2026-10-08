import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const assets = read('apps/api/src/assets/assets.service.ts');
const assetsController = read('apps/api/src/assets/assets.controller.ts');
const assetsDto = read('apps/api/src/assets/dto/assets.dto.ts');
const fleet = read('apps/api/src/fleet/fleet.service.ts');
const fleetController = read('apps/api/src/fleet/fleet.controller.ts');
const fleetDto = read('apps/api/src/fleet/dto/fleet.dto.ts');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const accountingUi = read('apps/admin/app/modules/accounting.tsx');
const assetsFleetUi = read('apps/admin/app/modules/assets-fleet.tsx');
const seed = read('apps/api/prisma/seed.ts');
const schema = read('apps/api/prisma/schema.prisma');
const sqliteSchema = read('apps/api/prisma/schema.sqlite.prisma');
const pgSchema = read('apps/api/prisma/schema.postgresql.prisma');
const pgMigration = read('database/migrations/T360-20260911-asset-fleet-reconciliation/postgresql-expand.sql');
const sqliteMigration = read('database/migrations/T360-20260911-asset-fleet-reconciliation/sqlite-expand.sql');

test('asset acquisition uses business date, supplier-safe AP, and correct cash/bank/credit settlement', () => {
  assert.match(assets, /const timeZone = await this\.companyTimeZone\(tx, scope\.companyId\);[\s\S]{0,200}const acquisitionDate = this\.parseBusinessDate\(dto\.acquisitionDate, timeZone\)/);
  assert.match(assets, /capitalizationDate: acquisitionDate/);
  assert.match(assets, /businessDate: acquisitionDate/);
  assert.match(assets, /paymentMode === 'CREDIT' && !dto\.supplierId/);
  assert.match(assets, /Akuisisi aset kredit wajib memiliki supplier/);
  assert.match(assets, /paymentMode === 'CASH' \? '1101' : paymentMode === 'BANK' \? '1102' : '2101'/);
  assert.match(assets, /ASSET_ACQUISITION_CREDIT/);
  assert.match(assets, /calculateTax\(tx, dto\.taxCodeId, dto\.acquisitionCost, scope\.companyId, acquisitionDate, \['ASSET', 'PURCHASE', 'OTHER'\]\)/);
});

test('depreciation is period-safe, explicit, and cannot silently double-post or assume unsupported methods', () => {
  assert.match(assets, /status: 'POSTED',[\s\S]*periodStart: \{ lte: end \},[\s\S]*periodEnd: \{ gte: start \}/);
  assert.match(assets, /Periode depresiasi bertumpang tindih/);
  assert.match(assets, /asset\.depreciationMethod !== 'STRAIGHT_LINE'/);
  assert.match(assets, /run dibatalkan agar tidak menghasilkan angka asumsi/);
  assert.match(assets, /const monthCount = this\.countCalendarMonths\(start, end, asset\.capitalizationDate\)/);
  assert.match(assets, /Akun depresiasi kategori .* belum lengkap/);
  assert.match(assets, /if \(processedCount === 0 \|\| total\.lessThanOrEqualTo\(0\)\)/);
});

test('maintenance completion is atomic, inspection-gated, business-dated, and idempotent after completion', () => {
  assert.match(assets, /return this\.prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(assets, /if \(work\.status === 'COMPLETED'\) return work/);
  assert.match(assets, /\['PASSED', 'APPROVED'\]\.includes\(inspection\.status\)/);
  assert.match(assets, /const timeZone = await this\.companyTimeZone\(tx, scope\.companyId\);[\s\S]{0,200}const completedAt = this\.parseBusinessDate\(dto\.completedAt, timeZone\)/);
  assert.match(assets, /businessDate: completedAt/);
  assert.match(assets, /dto\.odometer < vehicle\.currentOdometer/);
  assert.match(assets, /paymentMode === 'CREDIT' && !work\.vendorId/);
  assert.match(assets, /const timeZone = await this\.companyTimeZone\(tx, scope\.companyId\);[\s\S]{0,220}scheduledAt = dto\.scheduledAt \? this\.parseBusinessDate\(dto\.scheduledAt, timeZone\) : new Date\(\)/);
});

test('maintenance parts reconcile physical inventory, batch reservations, and accounting cost', () => {
  assert.match(assets, /product\.trackSerial && serialIds\.length !== part\.quantity/);
  assert.match(assets, /inventorySerial\.updateMany/);
  assert.match(assets, /status: 'CONSUMED'/);
  assert.match(assets, /product\.trackBatch && !part\.batchId/);
  assert.match(assets, /batch\.quantity - batch\.reserved < part\.quantity/);
  assert.match(assets, /quantity: \{ gte: batch\.reserved \+ part\.quantity \}/);
  assert.match(assets, /data: \{ quantity: \{ decrement: part\.quantity \}, available: \{ decrement: part\.quantity \} \}/);
  assert.match(assets, /referenceType: 'MaintenanceWorkOrder'/);
  assert.match(assets, /eventType: 'ASSET_MAINTENANCE_PARTS'/);
  assert.match(assets, /accountCodes: \{ debit: category\.maintenanceExpenseCode \?\? '5203', credit: '1301' \}/);
});

test('asset transfer is inspection-gated, operationally safe, and retry-safe without creating accounting noise', () => {
  assert.match(assets, /assertAssetOperationallyFree\(tx, asset\.id\)/);
  assert.match(assets, /assertInspection\(tx, user, scope, dto\.inspectionId, 'Asset', asset\.id\)/);
  assert.match(assets, /sourceType: 'AssetTransfer', sourceId: inspection\.id/);
  assert.match(assets, /const previousTransfer = await tx\.assetTransaction\.findFirst/);
  assert.match(assets, /if \(previousTransfer\) return tx\.asset\.findUniqueOrThrow/);
  assert.match(assets, /type: 'TRANSFER'/);
  const transferBlock = assets.slice(assets.indexOf('async transfer('), assets.indexOf('async dispose('));
  assert.doesNotMatch(transferBlock, /postOperationalEvent/);
});

test('asset sale/disposal reconciles book value and posts gain/loss/tax without orphan credit AR', () => {
  assert.match(assets, /ASSET_BOOK_VALUE_RECONCILIATION_REQUIRED/);
  assert.match(assets, /const previousDisposal = await tx\.accountingEvent\.findFirst/);
  assert.match(assets, /if \(previousDisposal\) return asset/);
  assert.match(assets, /eventType: 'ASSET_DISPOSAL'/);
  assert.match(assets, /gain: '4202'/);
  assert.match(assets, /loss: '6202'/);
  assert.match(assets, /outputTax: tax\.taxCode\?\.payableAccountCode \?\? '2201'/);
  assert.match(assets, /Settlement penjualan aset hanya CASH atau BANK/);
  const disposeDtoBlock = assetsDto.slice(assetsDto.indexOf('export class DisposeAssetDto'));
  assert.match(disposeDtoBlock, /enum: \['CASH','BANK'\]/);
  assert.doesNotMatch(disposeDtoBlock, /enum: \['CASH','BANK','CREDIT'\]/);
  assert.match(assets, /status: mode === 'SALE' \? 'SOLD' : 'DISPOSED'/);
});

test('vehicle master only links VEHICLE assets once and trip odometer cannot move backward', () => {
  assert.match(fleet, /asset\.assetType !== 'VEHICLE'/);
  assert.match(fleet, /Aset sudah terhubung ke kendaraan/);
  assert.match(fleet, /dto\.startOdometer !== undefined && dto\.startOdometer < vehicle\.currentOdometer/);
  assert.match(fleet, /plannedReturn[\s\S]*plannedDeparture/);
});

test('delivery stop COD is bounded and rolls up to trip summary', () => {
  assert.match(fleet, /codCollected\.greaterThan\(stop\.codExpected\)/);
  assert.match(fleet, /COD yang diterima melebihi COD yang diharapkan/);
  assert.match(fleet, /const codTotal = tripStops\.reduce/);
  assert.match(fleet, /codCollected: codTotal/);
  assert.match(fleet, /codVariance: codExpected\.sub\(codCollected\)/);
});

test('fuel entry is business-dated, traceable, retry-safe, supplier-aware, and odometer-safe', () => {
  assert.match(fleetDto, /transactionDate\?: string/);
  assert.match(fleetDto, /supplierId\?: string/);
  assert.match(fleet, /const timeZone = await this\.companyTimeZone\(tx, scope\.companyId\);[\s\S]{0,200}const transactionDate = this\.parseBusinessDate\(dto\.transactionDate, timeZone\)/);
  assert.match(fleet, /calculateTax\(tx, dto\.taxCodeId, base, scope\.companyId, transactionDate/);
  assert.match(fleet, /wajib memiliki receiptNumber atau evidenceReference/);
  assert.match(fleet, /Receipt\/evidence BBM sudah digunakan/);
  assert.match(fleet, /paymentMode === 'CREDIT' && !dto\.supplierId/);
  assert.match(fleet, /supplierId: dto\.supplierId/);
  assert.match(fleet, /dto\.odometer < vehicle\.currentOdometer/);
  assert.match(fleet, /idempotencyKey: `fuel:\$\{vehicle\.id\}:\$\{stableReference\}`/);
});

test('supplier AP settlement accepts all supported credit source documents and rechecks outstanding at post time', () => {
  assert.match(finance, /referenceType === 'GoodsReceipt'/);
  assert.match(finance, /referenceType === 'Asset'/);
  assert.match(finance, /referenceType === 'MaintenanceWorkOrder' \|\| referenceType === 'FuelTransaction'/);
  assert.match(finance, /ASSET_ACQUISITION_CREDIT/);
  assert.match(finance, /ASSET_MAINTENANCE_CREDIT/);
  assert.match(finance, /FLEET_FUEL_CREDIT/);
  assert.match(finance, /gross\.greaterThan\(payable\.available\)/);
  assert.match(finance, /row\.grossAmount\.greaterThan\(payable\.available\)/);
  assert.match(accountingUi, /'GoodsReceipt' \| 'Asset' \| 'MaintenanceWorkOrder' \| 'FuelTransaction'/);
});

test('asset/fleet read models expose real backend endpoints and admin consumes them', () => {
  assert.match(assetsController, /@Get\('summary'\)/);
  assert.match(assetsController, /@Get\('maintenances'\)/);
  assert.match(assetsController, /@Post\(':id\/transfer'\)/);
  assert.match(assetsController, /@Post\(':id\/dispose'\)/);
  assert.match(fleetController, /@Get\('summary'\)/);
  assert.match(fleetController, /@Get\('trips'\)/);
  assert.match(fleetController, /@Get\('fuel'\)/);
  assert.match(assetsFleetUi, /\/assets\/maintenances/);
  assert.match(assetsFleetUi, /\/assets\/summary/);
  assert.match(assetsFleetUi, /\/fleet\/trips/);
  assert.match(assetsFleetUi, /\/fleet\/summary/);
  assert.match(assetsFleetUi, /bookValue/);
});

test('canonical accounting config includes disposal gain/loss and maintenance-parts rules', () => {
  assert.match(seed, /\['4202','Keuntungan Pelepasan Aset',AccountType\.REVENUE\]/);
  assert.match(seed, /\['6202','Kerugian Pelepasan Aset',AccountType\.EXPENSE\]/);
  assert.match(seed, /code: 'ASSET-MAINTENANCE-PARTS', eventType: 'ASSET_MAINTENANCE_PARTS'/);
  assert.match(seed, /code: 'ASSET-DISPOSAL', eventType: 'ASSET_DISPOSAL'/);
  assert.match(seed, /accountCodeKey: 'gain'/);
  assert.match(seed, /accountCodeKey: 'loss'/);
});

test('fuel supplier trace is consistent across all Prisma schemas and expand migrations', () => {
  for (const source of [schema, sqliteSchema, pgSchema]) {
    const fuelModel = source.slice(source.indexOf('model FuelTransaction'), source.indexOf('model VehicleMeterReading'));
    assert.match(fuelModel, /supplierId\s+String\?/);
    assert.match(fuelModel, /@@index\(\[supplierId, transactionDate\]\)/);
  }
  assert.match(pgMigration, /ADD COLUMN IF NOT EXISTS "supplierId" TEXT/);
  assert.match(sqliteMigration, /ADD COLUMN "supplierId" TEXT/);
});
