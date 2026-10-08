import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const operationsDto = read('apps/api/src/operations-control/dto/operations-control.dto.ts');
const operationsController = read('apps/api/src/operations-control/operations-control.controller.ts');
const operations = read('apps/api/src/operations-control/operations-control.service.ts');
const operationsUi = read('apps/admin/app/modules/operations-control.tsx');
const goodsReceipts = read('apps/api/src/goods-receipts/goods-receipts.service.ts');
const ordersController = read('apps/api/src/orders/orders.controller.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const orderDto = read('apps/api/src/orders/dto/create-order.dto.ts');
const storefront = read('apps/storefront/app/page.tsx');
const adminExtensions = read('apps/admin/app/modules/extensions.tsx');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const financeController = read('apps/api/src/finance-operations/finance-operations.controller.ts');
const accountingUi = read('apps/admin/app/modules/accounting.tsx');
const returns = read('apps/api/src/returns/returns.service.ts');
const returnsDto = read('apps/api/src/returns/dto/returns.dto.ts');
const reports = read('apps/api/src/reports/reports.service.ts');
const worker = read('apps/worker/src/index.ts');
const seed = read('apps/api/prisma/seed.ts');
const sqliteSchema = read('apps/api/prisma/schema.sqlite.prisma');
const pgSchema = read('apps/api/prisma/schema.postgresql.prisma');
const sqliteMigration = read('database/migrations/T360-20260911-commerce-refund-integrity/sqlite-expand.sql');
const pgMigration = read('database/migrations/T360-20260911-commerce-refund-integrity/postgresql-expand.sql');
const sales = read('apps/api/src/sales/sales.service.ts');

test('inspection evidence is uploaded and verified by the server rather than trusting client storage keys', () => {
  assert.match(operationsController, /@Post\('inspections\/:id\/evidence'\)/);
  assert.match(operationsDto, /dataBase64\?: string/);
  assert.match(operationsDto, /value\?: string/);
  assert.match(operations, /createHash\('sha256'\)/);
  assert.match(operations, /Ukuran evidence maksimum 8 MiB/);
  assert.match(operations, /Isi evidence tidak sesuai dengan MIME type yang dikirim/);
  assert.match(operations, /verifiedByServer: true/);
  assert.match(operations, /legacyUnverified: true/);
  assert.match(operations, /meta\?\.verifiedByServer === true/);
  assert.match(operationsUi, /fileToBase64/);
  assert.match(operationsUi, /uploadPhoto/);
  assert.match(operationsUi, /uploadBarcode/);
});

test('barcode and serial scanning is source-bound, quantity-bound, and concurrency-safe', () => {
  assert.match(operations, /Barcode\/SKU tidak termasuk dalam Goods Receipt ini/);
  assert.match(operations, /Barcode\/SKU\/serial tidak termasuk dalam shipment ini/);
  assert.match(operations, /status: 'RESERVED', referenceType: 'Shipment', referenceId: inspection\.sourceId/);
  assert.match(operations, /where: \{ id: result\.id, scannedQty: currentScanned \}/);
  assert.match(operations, /scanClaim\.count !== 1/);
  assert.match(operations, /currentScanned \+ 1 >= expectedQty \? \{ result: 'PASS' \}/);
  assert.match(operations, /Scan barcode belum lengkap/);
});

test('new inbound and outbound inspections materialize required checklists and cannot finalize undecided required items', () => {
  assert.match(goodsReceipts, /include: \{ items: \{ orderBy: \{ sequence: 'asc' \} \} \}/);
  assert.match(goodsReceipts, /templateItemId: item\.id, code: item\.code, label: item\.label, result: 'OBSERVATION'/);
  assert.match(orders, /template\?\.items\.map\(\(item\) => \(\{ templateItemId: item\.id/);
  assert.match(operations, /Checklist wajib .* tidak boleh dihilangkan/);
  assert.match(operations, /harus diputuskan PASS atau FAIL/);
  assert.match(operations, /warningFailures > 0 \? 'REVIEW_REQUIRED'/);
  assert.match(operations, /blockingFailureCount: blockingFailures/);
  assert.match(operationsUi, /Checklist inspeksi/);
  assert.match(operationsUi, /setChecklistResult/);
});

test('supplier returns split AP offset and supplier-refund receivable instead of creating negative payable', () => {
  assert.match(returnsDto, /supplierCreditNoteNumber\?: string/);
  assert.match(returns, /const payableOffset = row\.amount\.lessThan\(openPayable\) \? row\.amount : openPayable/);
  assert.match(returns, /const supplierReceivable = row\.amount\.sub\(payableOffset\)/);
  assert.match(returns, /Nomor credit note supplier wajib dicatat/);
  assert.match(returns, /supplierReceivable: '1202'/);
  assert.match(sqliteSchema, /supplierReceivableAmount\s+Decimal/);
  assert.match(pgSchema, /supplierReceivableAmount\s+Decimal/);
  assert.match(sqliteMigration, /supplierReceivableAmount/);
  assert.match(pgMigration, /ADD VALUE IF NOT EXISTS 'SUPPLIER_REFUND'/);
});

test('supplier refund settlement is a dedicated receivable workflow with over-collection guards', () => {
  assert.match(financeController, /@Get\('supplier-refunds'\)/);
  assert.match(finance, /type: 'SUPPLIER_REFUND'/);
  assert.match(finance, /referenceType: 'PurchaseReturn'/);
  assert.match(finance, /dto\.creditAccountCode !== '1202'/);
  assert.match(finance, /gross\.greaterThan\(receivable\.available\)/);
  assert.match(finance, /row\.grossAmount\.greaterThan\(receivable\.available\)/);
  assert.match(finance, /supplierReceivable: row\.creditAccountCode/);
  assert.match(seed, /code: 'SUPPLIER-REFUND', eventType: 'SUPPLIER_REFUND'/);
  assert.match(accountingUi, /Terima refund supplier/);
  // Niat: refund supplier dikredit ke akun piutang refund supplier (1202), dan server menolak
  // kode lain. UI karena itu TIDAK menawarkannya bebas - dropdown yang lebih luas hanya
  // menawarkan error.
  assert.match(accountingUi, /SUPPLIER_REFUND_RECEIVABLE = '1202'/,
    'UI harus memakai akun yang sama dengan yang server izinkan, bukan dropdown aset bebas');
  assert.match(accountingUi, /supplierRefundAccount: SUPPLIER_REFUND_RECEIVABLE/);
});

test('public storefront payment selection never treats real electronic method selection as payment proof', () => {
  assert.match(ordersController, /@Post\(':number\/payment-selection'\)/);
  assert.match(ordersController, /@Post\(':number\/mock-pay'\)/);
  assert.match(storefront, /\/payment-selection/);
  assert.match(orderDto, /paymentMethod/);
  assert.match(orders, /\['QRIS','TRANSFER','CARD'\]\.includes\(method\)/);
  assert.match(orders, /status: 'PENDING', paidAt: null/);
  assert.match(orders, /MOCK_QRIS dinonaktifkan pada production/);
  assert.match(orders, /Referensi pembayaran provider wajib diisi/);
  assert.match(orders, /ONLINE_ORDER_PREPAYMENT/);
  assert.match(orders, /customerAdvance: '2105'/);
});

test('sales and public order idempotency do not delete a concurrent PROCESSING receipt', () => {
  assert.match(orders, /beginIdempotent\(tx/);
  assert.match(orders, /completeIdempotent\(tx/);
  assert.doesNotMatch(orders, /releaseIdempotent/);
  assert.match(sales, /beginIdempotent\(tx/);
  assert.match(sales, /completeIdempotent\(tx/);
  assert.doesNotMatch(sales, /releaseIdempotent/);
});

test('storefront stock stays reserved until approved packing and shipment performs the physical/accounting issue', () => {
  assert.match(orders, /reserveLocationStock\(tx, \{ warehouseId: warehouse\.id, productId, quantity, sourceType: 'Order', sourceId: order\.id \}\)/);
  assert.match(orders, /reserved: \{ increment: quantity \}, available: \{ decrement: quantity \}/);
  assert.match(orders, /inspection\.status !== 'APPROVED' \|\| inspection\.mismatchCount !== 0 \|\| inspection\.blockingFailureCount !== 0/);
  assert.match(orders, /status: 'READY'/);
  assert.match(orders, /consumeLocationReservations\(tx, \{ sourceType: 'Order', sourceId: order\.id, warehouseId: order\.warehouseId, productId, quantity: value\.quantity \}\)/);
  assert.match(orders, /quantity: \{ decrement: value\.quantity \}, reserved: \{ decrement: value\.quantity \}/);
  assert.match(orders, /type: 'ONLINE_ORDER'/);
  assert.match(orders, /order-fulfilled:/);
  assert.match(orders, /sourceType: 'Order', sourceId: order\.id/);
  assert.match(orders, /documentType: 'SALES_TAX_DOCUMENT'/);
});

test('COD and invoice shipments create receivables and later customer receipts settle them exactly once', () => {
  assert.match(orders, /payment\.method === 'COD' \? '1203' : '1201'/);
  assert.match(orders, /ONLINE_ORDER_CREDIT_FULFILLED/);
  assert.match(financeController, /@Get\('customer-receivables'\)/);
  assert.match(finance, /type: 'CUSTOMER_RECEIPT'/);
  assert.match(finance, /receivableAccountCode = payment\.method === 'COD' \? '1203' : '1201'/);
  assert.match(finance, /gross\.greaterThan\(receivable\.available\)/);
  assert.match(finance, /receivedAfter\.greaterThanOrEqualTo\(customerReceivable\.gross\)/);
  assert.match(seed, /\['1103','Kas Kurir \/ COD',AccountType\.ASSET\], \['1203','Piutang COD',AccountType\.ASSET\]/);
  assert.match(seed, /code: 'CUSTOMER-RECEIPT', eventType: 'CUSTOMER_RECEIPT'/);
});

test('cancellation and expiry atomically release reserved stock instead of leaking reservations', () => {
  assert.match(orders, /async cancel\(/);
  assert.match(orders, /releaseLocationReservations\(tx, \{ sourceType: 'Order', sourceId: order\.id, warehouseId: order\.warehouseId, productId, quantity: value\.quantity \}\)/);
  assert.match(orders, /reserved: \{ decrement: value\.quantity \}, available: \{ increment: value\.quantity \}/);
  assert.match(worker, /inventoryReservation\.findMany\(\{ where: \{ sourceType: 'Order', sourceId: order\.id, status: 'ACTIVE' \} \}\)/);
  assert.match(orders, /payment\.status === 'PAID'/);
  assert.match(orders, /Refund harus diproses sebelum pembatalan/);
  assert.match(worker, /async function expirePendingStorefrontOrders/);
  assert.match(worker, /status: 'PENDING_PAYMENT', expiresAt: \{ lte: new Date\(\) \}/);
  assert.match(worker, /releasedReservation: true/);
  assert.match(worker, /commerce\.order\.expired/);
});

test('cash-flow reporting uses posted cash/bank journal movement and excludes internal balance transfers', () => {
  assert.match(reports, /journalLine\.findMany/);
  assert.match(reports, /code: \{ in: \['1101', '1102', '1103'\] \}/);
  assert.match(reports, /description\.startsWith\('BALANCE_TRANSFER '\)/);
  assert.match(reports, /bucket\.cashIn \+= Number\(line\.debit\)/);
  assert.match(reports, /bucket\.cashOut \+= Number\(line\.credit\)/);
  assert.match(reports, /netCashFlow: amount\.cashIn - amount\.cashOut/);
});

test('admin surfaces the real fulfillment gates instead of skipping inspection and provider confirmation', () => {
  assert.match(adminExtensions, /Konfirmasi bayar/);
  assert.match(adminExtensions, /Otorisasi termin/);
  assert.match(adminExtensions, /Packing hanya lolos setelah inspeksi outbound/);
  assert.doesNotMatch(adminExtensions, /window\.prompt/);
  assert.match(adminExtensions, /carrier/);
  assert.match(adminExtensions, /trackingNumber/);
  assert.match(storefront, /Pembayaran elektronik tidak dianggap lunas sampai provider\/backoffice mengonfirmasi/);
  assert.match(storefront, /Stok fisik baru keluar ketika shipment dikirim/);
});
