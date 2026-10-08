import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const pos = read('apps/pos/app/page.tsx');
const adminOps = read('apps/admin/app/modules/operations.tsx');
const adminControl = read('apps/admin/app/modules/operations-control.tsx');
const returnsController = read('apps/api/src/returns/returns.controller.ts');
const returnsService = read('apps/api/src/returns/returns.service.ts');

test('POS can create a server-side sale return request from a real sale item', () => {
  assert.match(pos, /api<CursorPage<RecentSale>>\('\/sales\?limit=20'/);
  assert.match(pos, /api<SaleReturnRow\[]>\('\/returns\/sales'/);
  assert.match(pos, /saleItemId: item\.id/);
  assert.match(pos, /api<SaleReturnRow>\('\/returns\/sales'/);
  assert.match(pos, /warehouseId: sale\.warehouseId/);
  assert.match(pos, /refundMethod: returnRefundMethod/);
});

test('POS return request is online-only and requires explicit auditable reason and quantity', () => {
  assert.match(pos, /if \(!token \|\| returnBusy \|\| !apiOnline \|\| !returnSaleId\) return/);
  assert.match(pos, /Isi minimal satu kuantitas item yang akan diretur/);
  assert.match(pos, /Alasan retur wajib diisi agar proses dapat diaudit/);
  assert.match(pos, /Retur hanya tersedia saat server online/);
});

test('server creates inspection before sale return can be completed', () => {
  assert.match(returnsController, /@Post\('sales'\)/);
  assert.match(returnsService, /templateCode: 'RETURN-INBOUND-STANDARD'/);
  assert.match(returnsService, /data: \{ inspectionId: inspection\.id \}/);
  assert.match(returnsService, /Pemeriksaan retur belum lulus/);
});

test('admin operations control exposes SaleReturn inspection completion and approval', () => {
  assert.match(adminControl, /'SaleReturn','OrderReturn','PurchaseReturn'/);
  assert.match(adminControl, /Finalisasi pemeriksaan barang retur pelanggan sebelum refund/);
  assert.match(adminControl, /Dokumen sumber sekarang dapat dilanjutkan sesuai policy/);
});

test('admin return module posts the real refund and uses refundAmount from API', () => {
  assert.match(adminOps, /refundAmount: string \| number/);
  assert.match(adminOps, /rupiah\(r\.refundAmount \?\? 0\)/);
  assert.match(adminOps, /api\(`\/returns\/sales\/\$\{row\.id\}\/confirm`/);
  assert.match(adminOps, /Refund, stok, loyalitas, pajak, dan jurnal telah diposting server/);
});

test('sale return completion still posts inventory, accounting, tax, and loyalty correction atomically', () => {
  assert.match(returnsService, /inventoryMovement\.create\([\s\S]*type: 'SALE_RETURN'/);
  assert.match(returnsService, /eventType: 'SALE_RETURN'/);
  assert.match(returnsService, /taxLines,/);
  assert.match(returnsService, /type: 'REFUND'/);
  assert.match(returnsService, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
});
