import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../apps/admin/app/modules/operations.tsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/returns/returns.controller.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/api/src/returns/returns.service.ts', import.meta.url), 'utf8');

test('admin exposes purchase return creation from posted goods receipts and outbound inspection gate', () => {
  assert.match(admin, /\/goods-receipts\?limit=100/);
  assert.match(admin, /\/returns\/purchases\?limit=50/);
  assert.match(admin, /goodsReceiptItemId: item\.id/);
  assert.match(admin, /Buat retur supplier/);
  assert.match(admin, /Kontrol Operasional/);
  assert.match(controller, /@Post\('purchases'\)/);
  assert.match(service, /operationalStatus\)\) \{[\s\S]*Retur supplier hanya dapat dibuat dari penerimaan yang sudah diposting/);
  assert.match(service, /sourceType: 'PurchaseReturn'/);
});

test('purchase return posting remains server-authoritative for stock accounting tax and supplier refund', () => {
  assert.match(admin, /\/returns\/purchases\/\$\{row\.id\}\/confirm/);
  assert.match(service, /Pemeriksaan barang keluar retur belum lulus/);
  assert.match(service, /Stok retur produk \$\{item\.productId\} tidak mencukupi/);
  assert.match(service, /payableOffsetAmount: payableOffset/);
  assert.match(service, /supplierReceivableAmount: supplierReceivable/);
  assert.match(service, /supplierCreditNoteNumber/);
  assert.match(service, /eventType: 'PURCHASE_RETURN'/);
});
