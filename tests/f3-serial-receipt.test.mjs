import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('apps/api/src/goods-receipts/goods-receipts.service.ts', 'utf8');
const dto = readFileSync('apps/api/src/goods-receipts/dto/create-goods-receipt.dto.ts', 'utf8');
const admin = readFileSync('apps/admin/app/page.tsx', 'utf8');
const sqlite = readFileSync('apps/api/prisma/schema.sqlite.prisma', 'utf8');
const postgres = readFileSync('apps/api/prisma/schema.postgresql.prisma', 'utf8');

test('F3 serial-tracked goods receipt requires exact accepted serial count', () => {
  assert.match(dto, /serialNumbers\?: string\[\]/);
  assert.match(service, /trackSerial && serialNumbers\.length !== accepted/);
  assert.match(service, /tidak memakai serial; serialNumbers tidak boleh dikirim/);
});

test('F3 serials are created atomically by canonical goods receipt confirmation', () => {
  assert.match(service, /existingSerials = await tx\.inventorySerial\.findMany/);
  assert.match(service, /await tx\.inventorySerial\.create/);
  assert.match(service, /referenceType: 'GoodsReceiptItem'/);
  assert.match(service, /status: 'AVAILABLE'/);
});

test('F3 goods receipt persists inbound serial manifest with sqlite-postgres parity', () => {
  assert.match(sqlite, /model GoodsReceiptItem[\s\S]*serialNumbers\s+Json\?/);
  assert.match(postgres, /model GoodsReceiptItem[\s\S]*serialNumbers\s+Json\?/);
});

test('F3 admin receiving exposes batch expiry and serial traceability fields', () => {
  assert.match(admin, /selectedPOItem\?\.product\.trackBatch/);
  assert.match(admin, /selectedPOItem\?\.product\.trackSerial/);
  assert.match(admin, /serialNumbers: receiptForm\.serialNumbers\.split/);
  assert.match(admin, /Jumlah serial harus sama dengan jumlah diterima dikurangi rusak/);
});
