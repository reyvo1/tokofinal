import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const po = read('apps/api/src/purchase-orders/purchase-orders.service.ts');
const grDto = read('apps/api/src/goods-receipts/dto/create-goods-receipt.dto.ts');
const gr = read('apps/api/src/goods-receipts/goods-receipts.service.ts');
const operationsController = read('apps/api/src/operations-control/operations-control.controller.ts');
const operations = read('apps/api/src/operations-control/operations-control.service.ts');
const returnsDto = read('apps/api/src/returns/dto/returns.dto.ts');
const returns = read('apps/api/src/returns/returns.service.ts');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const financeController = read('apps/api/src/finance-operations/finance-operations.controller.ts');
const seed = read('apps/api/prisma/seed.ts');
const admin = read('apps/admin/app/page.tsx');
const accountingUi = read('apps/admin/app/modules/accounting.tsx');
const operationsUi = read('apps/admin/app/modules/operations-control.tsx');

test('purchase order money arithmetic uses Decimal and create is idempotent', () => {
  assert.match(po, /purchaseUnitCost = new Prisma\.Decimal\(item\.unitCost\)/);
  assert.match(po, /baseUnitCost = purchaseUnitCost\.div\(quantityFactor\)/);
  assert.match(po, /subtotal: purchaseUnitCost\.mul\(item\.orderedQty\)/);
  assert.doesNotMatch(po, /item\.orderedQty \* item\.unitCost/);
  assert.match(po, /beginIdempotent\([\s\S]*scope: scopeKey/);
  assert.doesNotMatch(po, /releaseIdempotent\(this\.prisma/);
  assert.match(admin, /idempotencyKey: poRequestKey\.current/);
});

test('goods receipt draft retries are idempotent and duplicate PO lines cannot over-receive', () => {
  assert.match(grDto, /idempotencyKey\?: string/);
  assert.match(gr, /idempotencyScope = dto\.idempotencyKey \? 'goods-receipt:create' : null/);
  assert.doesNotMatch(gr, /releaseIdempotent\(this\.prisma/);
  assert.match(gr, /const requestedByPoItem = new Map<string, number>\(\)/);
  assert.match(gr, /receivedForLine > remaining/);
  assert.match(admin, /idempotencyKey: receiptRequestKey\.current/);
});

test('goods receipt revalidates remaining PO quantity when posting and blocks unapproved mismatch', () => {
  assert.match(gr, /const acceptedByPoItem = new Map<string, number>\(\)/);
  assert.match(gr, /acceptedQty > remaining/);
  assert.match(gr, /policy\?\.blockOnMismatch \?\? true/);
  assert.match(gr, /inspection\.status === 'PARTIAL'/);
  assert.match(gr, /serializableTx\(this\.prisma/);
});

test('operations control exposes tenant-scoped inspection lists and validates Goods Receipt inspection quantities', () => {
  assert.match(operationsController, /@Permissions\('inspection\.view'\) @Get\('inspections'\)/);
  assert.match(operationsController, /@Get\('gate-passes'\)/);
  assert.match(operations, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId/);
  assert.match(operations, /inspection\.sourceType === 'GoodsReceipt'/);
  assert.match(operations, /actual\.received !== expected\.received \|\| actual\.accepted !== expected\.accepted \|\| actual\.damaged !== expected\.damaged/);
  assert.match(operationsUi, /completeInspection/);
  assert.match(operationsUi, /setChecklistResult/);
  assert.match(operationsUi, /approveInspection/);
  assert.match(operations, /async createInspectionInTransaction\(tx: Prisma\.TransactionClient/);
});

test('supplier return creation is atomic/idempotent and confirmation cannot exceed posted receipt quantity', () => {
  assert.match(returnsDto, /idempotencyKey\?: string/);
  assert.match(returns, /idempotencyScope = dto\.idempotencyKey \? 'purchase-return:create' : null/);
  assert.match(returns, /createInspectionInTransaction\(tx/);
  assert.match(returns, /completeIdempotent\(tx[\s\S]*resourceType: 'PurchaseReturn'/);
  assert.doesNotMatch(returns, /releaseIdempotent\(this\.prisma/);
  assert.match(returns, /Retur supplier hanya dapat dibuat dari penerimaan yang sudah diposting/);
  assert.match(returns, /const previousReturns = await tx\.purchaseReturn\.findMany/);
  assert.match(returns, /used \+ requestedQty > original\.acceptedQty/);
  assert.match(returns, /return serializableTx\(this\.prisma, async \(tx\) =>/);
  assert.match(returns, /id: \{ not: row\.id \}/);
  assert.match(returns, /type: 'SUPPLIER_PAYMENT'[\s\S]*status: \{ in: \['POSTED', 'PAID'\] \}/);
  assert.match(returns, /const payableOffset = row\.amount\.lessThan\(openPayable\) \? row\.amount : openPayable/);
  assert.match(returns, /const supplierReceivable = row\.amount\.sub\(payableOffset\)/);
  assert.match(returns, /supplierCreditNoteNumber/);
  assert.match(returns, /supplierReceivable: '1202'/);
  assert.match(returns, /batch\.quantity - batch\.reserved < item\.quantity/);
  assert.match(returns, /inventoryBatch\.update\([\s\S]*quantity: \{ decrement: item\.quantity \}/);
});

test('supplier payable supports receipt, asset, maintenance, and fuel credit sources while preventing overpayment', () => {
  assert.match(financeController, /@Get\('supplier-payables'\)/);
  assert.match(finance, /status: 'COMPLETED'/);
  assert.match(finance, /type: 'SUPPLIER_PAYMENT'/);
  assert.match(finance, /const rawOutstanding = gross\.sub\(returned\)\.sub\(paid\)/);
  assert.match(finance, /const rawAvailable = outstanding\.sub\(pending\)/);
  assert.match(finance, /referenceType === 'GoodsReceipt'/);
  assert.match(finance, /referenceType === 'Asset'/);
  assert.match(finance, /referenceType === 'MaintenanceWorkOrder' \|\| referenceType === 'FuelTransaction'/);
  assert.match(finance, /supplierPayableReferenceSnapshot/);
  assert.match(finance, /dto\.debitAccountCode !== '2101'/);
  assert.match(finance, /gross\.greaterThan\(payable\.available\)/);
  assert.match(finance, /row\.grossAmount\.greaterThan\(payable\.available\)/);
});

test('supplier payment posts a dedicated AP journal instead of a generic balance transfer', () => {
  assert.match(seed, /code: 'SUPPLIER-PAYMENT', eventType: 'SUPPLIER_PAYMENT'/);
  assert.match(seed, /accountCodeKey: 'payable', side: 'DEBIT', amountKey: 'gross'/);
  assert.match(seed, /accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross'/);
  assert.match(finance, /if \(type === 'SUPPLIER_PAYMENT'\) return 'SUPPLIER_PAYMENT'/);
  assert.match(finance, /isSupplierPayment[\s\S]*\{ payable: row\.debitAccountCode, settlement: row\.creditAccountCode \}/);
});

test('admin procurement and accounting UI report actual workflow state instead of fake automatic posting', () => {
  assert.doesNotMatch(admin, /Barang supplier berhasil diterima\. Stok dan jurnal otomatis diperbarui\./);
  assert.match(admin, /Draft penerimaan dibuat\. Selesaikan inspeksi lalu konfirmasi posting stok\/jurnal\./);
  assert.match(admin, /\/goods-receipts\/\$\{receipt\.id\}\/confirm/);
  assert.match(accountingUi, /'OPERATING_EXPENSE' \| 'OTHER_INCOME' \| 'TAX_PAYMENT' \| 'SUPPLIER_PAYMENT'/);
  assert.doesNotMatch(accountingUi, /value="INCOME"|value="EXPENSE"|value="OTHER">Lain-lain/);
  assert.match(accountingUi, /Transaksi keuangan tersimpan sebagai draft\. Posting diperlukan agar jurnal terbentuk\./);
  assert.match(accountingUi, /\/finance-operations\/supplier-payables/);
  assert.match(accountingUi, /\/finance-operations\/\$\{transaction\.id\}\/post/);
});
