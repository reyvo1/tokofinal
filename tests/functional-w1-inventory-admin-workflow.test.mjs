import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../apps/admin/app/modules/operations.tsx', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../apps/api/src/advanced-inventory/advanced-inventory.controller.ts', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../apps/api/src/advanced-inventory/advanced-inventory.service.ts', import.meta.url), 'utf8');

test('Admin can execute stock transfer lifecycle without Postman', () => {
  assert.ok(ui.includes('/advanced-inventory/stock-transfers'));
  assert.match(ui, /transferAction\(t, 'approve'\)/);
  assert.match(ui, /transferAction\(t, 'ship'\)/);
  assert.match(ui, /transferAction\(t, 'receive'\)/);
  assert.match(controller, /Patch\('stock-transfers\/:id\/approve'\)/);
  assert.match(controller, /Patch\('stock-transfers\/:id\/ship'\)/);
  assert.match(controller, /Patch\('stock-transfers\/:id\/receive'\)/);
  assert.match(service, /type: 'TRANSFER_OUT'/);
  assert.match(service, /type: 'TRANSFER_IN'/);
});

test('Admin can execute physical stock opname lifecycle and server posts movements/accounting', () => {
  assert.ok(ui.includes('/advanced-inventory/stock-opnames'));
  assert.match(ui, /saveCounts\(selectedOpname\)/);
  assert.match(ui, /opnameAction\(o, 'submit'\)/);
  assert.match(ui, /opnameAction\(o, 'complete'\)/);
  assert.match(ui, /Simpan hitung fisik/);
  assert.match(ui, /Approve & posting/);
  assert.match(service, /type: difference > 0 \? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'/);
  assert.match(service, /eventType: 'STOCK_OPNAME_ADJUSTMENT'/);
});

test('inventory operator UI uses authoritative warehouse and product master data', () => {
  assert.ok(ui.includes('/master-data/warehouses'));
  assert.ok(ui.includes('/products?limit=200'));
  assert.doesNotMatch(ui, /prompt\(|window\.prompt/);
});
