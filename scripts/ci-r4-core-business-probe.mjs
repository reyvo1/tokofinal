#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { businessDateKeyInTimeZone, companyTimeZoneFromBranchContext } from './lib/business-date-key.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-r4-core-business-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential R4 probe tidak tersedia.');

async function request(route, { method = 'GET', body, token, expect } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expect !== undefined) {
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0, 800)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return data;
}

const login = await request('/auth/login', { method: 'POST', body: { email, password } });
const token = login.accessToken;
if (!token) throw new Error('Login R4 tidak menghasilkan access token.');
const stamp = Date.now();
const branchContext = await request('/auth/branch-context', { token });
const companyTimeZone = companyTimeZoneFromBranchContext(branchContext);
const today = businessDateKeyInTimeZone(new Date(), companyTimeZone);

const [productsPage, warehouses, manifest] = await Promise.all([
  request('/products?limit=100', { token }),
  request('/inventory/warehouses', { token }),
  request('/platform/manifest', { token }),
]);
let product = (productsPage?.items || []).find((item) => !item.trackBatch && !item.trackSerial) || productsPage?.items?.[0];
const warehouse = warehouses?.[0];
if (!warehouse?.id) throw new Error('Gudang bootstrap R4 runtime tidak tersedia.');
const unitRefs = await request('/master-data/references?type=UNIT', { token });
const baseUnitCode = (Array.isArray(unitRefs) ? unitRefs : []).find((row) => row?.isActive !== false && !row?.branchId && String(row?.code || '').trim())?.code;
if (!baseUnitCode) throw new Error('Master UNIT aktif tingkat perusahaan tidak tersedia untuk fixture R4.');
if (!product?.id) {
  product = await request('/products', {
    method: 'POST',
    token,
    body: {
      sku: `R4SKU${String(stamp).slice(-8)}`,
      name: `R4 Runtime Product ${stamp}`,
      unit: baseUnitCode,
      productType: 'PHYSICAL',
      trackBatch: false,
      trackExpiry: false,
      trackSerial: false,
      allowNegativeStock: false,
      costPrice: 1000,
      salePrice: 1500,
      minStock: 1,
      isActive: true,
    },
  });
}
if (!product?.id) throw new Error('Fixture product R4 runtime gagal dibuat.');

const supplier = await request('/suppliers', {
  method: 'POST', token,
  body: { code: `R4${String(stamp).slice(-8)}`, name: `R4 Supplier ${stamp}`, phone: '0800000000', paymentTermDays: 14 },
});
await request(`/suppliers/${supplier.id}`, { method: 'PATCH', token, body: { isActive: false, name: `${supplier.name} inactive` } });
const suppliersWithInactive = await request('/suppliers?limit=100&includeInactive=true', { token });
const inactiveSupplierVisible = suppliersWithInactive.items?.some((item) => item.id === supplier.id && item.isActive === false);
if (!inactiveSupplierVisible) throw new Error('Supplier R4 tidak terlihat sebagai INACTIVE pada lifecycle list.');

await request('/purchase-orders', {
  method: 'POST', token, expect: 403,
  body: { supplierId: supplier.id, warehouseId: warehouse.id, idempotencyKey: `r4-po-inactive-${stamp}`, items: [{ productId: product.id, orderedQty: 1, unitCost: Number(product.costPrice || 1000) }] },
});
await request(`/suppliers/${supplier.id}`, { method: 'PATCH', token, body: { isActive: true } });

const po = await request('/purchase-orders', {
  method: 'POST', token,
  body: { supplierId: supplier.id, warehouseId: warehouse.id, idempotencyKey: `r4-po-${stamp}`, notes: 'R4 runtime goods-receipt reject evidence', items: [{ productId: product.id, orderedQty: 2, unitCost: Number(product.costPrice || 1000) }] },
});
const poItem = po.items?.[0];
if (!poItem?.id) throw new Error('PurchaseOrder R4 runtime tidak menghasilkan item.');

const movementsBefore = await request(`/inventory/movements?productId=${encodeURIComponent(product.id)}&warehouseId=${encodeURIComponent(warehouse.id)}&limit=100`, { token });
const beforeIds = new Set((movementsBefore.items || []).map((item) => item.id));
const receiptItem = { purchaseOrderItemId: poItem.id, quantityReceived: 1, quantityDamaged: 0 };
if (product.trackBatch) receiptItem.batchNumber = `R4-BATCH-${stamp}`;
if (product.trackSerial) receiptItem.serialNumbers = [`R4-SERIAL-${stamp}`];
const receipt = await request('/goods-receipts', { method: 'POST', token, body: { purchaseOrderId: po.id, idempotencyKey: `r4-gr-${stamp}`, notes: 'Reject before posting', items: [receiptItem] } });
const rejectedReceipt = await request(`/goods-receipts/${receipt.id}/reject`, { method: 'POST', token, body: { reason: 'R4 runtime reject evidence' } });
if (rejectedReceipt.operationalStatus !== 'REJECTED') throw new Error(`GoodsReceipt R4 tidak REJECTED: ${rejectedReceipt.operationalStatus}`);
const movementsAfterReject = await request(`/inventory/movements?productId=${encodeURIComponent(product.id)}&warehouseId=${encodeURIComponent(warehouse.id)}&limit=100`, { token });
const rejectCreatedMovement = (movementsAfterReject.items || []).some((item) => !beforeIds.has(item.id) && item.referenceId === receipt.id);
if (rejectCreatedMovement) throw new Error('GoodsReceipt REJECTED membuat InventoryMovement; seharusnya pre-posting fail-close.');

const closeControl = await request('/accounting-core/close-controls', { method: 'POST', token, body: { module: 'ACCOUNTING', periodStart: today, periodEnd: today } });
await request(`/accounting-core/close-controls/${closeControl.id}/close`, { method: 'POST', token });
const accounts = await request('/accounting-core/accounts', { token });
const expense = accounts.find((item) => item.isActive && item.type === 'EXPENSE');
const settlement = accounts.find((item) => item.isActive && ['ASSET', 'LIABILITY'].includes(item.type));
if (!expense?.code || !settlement?.code) throw new Error('Akun runtime untuk R4 accounting close probe tidak tersedia.');
const eventBody = {
  eventType: 'OPERATING_EXPENSE', sourceType: 'R4Probe', sourceId: `r4-${stamp}`,
  idempotencyKey: `r4-closed-${stamp}`, businessDate: today,
  amounts: { net: 1000, gross: 1000, inputTax: 0 }, accountCodes: { expense: expense.code, settlement: settlement.code },
};
const closedError = await request('/accounting-core/events/post', { method: 'POST', token, expect: 400, body: eventBody });
const closedMessage = Array.isArray(closedError?.message) ? closedError.message.join(' ') : String(closedError?.message || closedError || '');
if (!/Accounting close control/i.test(closedMessage)) throw new Error(`Posting tidak diblok oleh AccountingCloseControl: ${closedMessage}`);
await request(`/accounting-core/close-controls/${closeControl.id}/reopen`, { method: 'POST', token, body: { reopenReason: 'R4 runtime reopen evidence' } });
const posted = await request('/accounting-core/events/post', { method: 'POST', token, body: { ...eventBody, idempotencyKey: `r4-open-${stamp}` } });
if (!posted?.id) throw new Error('Posting R4 setelah reopen tidak berhasil.');
const ledger = await request(`/reports/general-ledger?from=${today}&to=${today}&limit=200`, { token });
const generalLedgerVisible = (ledger?.entries || []).some((entry) => entry.referenceId === `r4-${stamp}` || entry.id === posted.journalEntryId);
if (!generalLedgerVisible) throw new Error('General Ledger R4 tidak menampilkan jurnal setelah reopen/posting.');

const branchCode = manifest?.branch?.code;
if (!branchCode) throw new Error('Manifest R4 tidak memiliki branch code aktif.');
const storefrontBranches = await request(`/platform/storefront-branches?branchCode=${encodeURIComponent(branchCode)}`);
const storefrontBranchVisible = Array.isArray(storefrontBranches) && storefrontBranches.some((branch) => branch.code === branchCode);
if (!storefrontBranchVisible) throw new Error('Storefront branch discovery tidak mengembalikan branch aktif.');

const promo = await request('/promotions', {
  method: 'POST', token,
  body: { name: `R4 BOGO ${stamp}`, code: `R4B${String(stamp).slice(-8)}`, type: 'BOGO', value: 0, channel: 'STOREFRONT', productIds: [product.id], buyQuantity: 2, getQuantity: 1, usageLimit: 5, perCustomerLimit: 1, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() },
});
await request(`/promotions/${promo.id}`, { method: 'PATCH', token, body: { isActive: false } });
const promos = await request('/promotions?limit=100', { token });
const promotionLifecycle = promos.some((item) => item.id === promo.id && item.type === 'BOGO' && item.isActive === false);
if (!promotionLifecycle) throw new Error('Advanced promotion R4 lifecycle tidak persist.');

const checks = {
  supplierLifecycle: inactiveSupplierVisible,
  inactiveSupplierRejectedForProcurement: true,
  goodsReceiptRejectPrePosting: rejectedReceipt.operationalStatus === 'REJECTED' && !rejectCreatedMovement,
  inventoryMovementLedgerReadable: Array.isArray(movementsAfterReject.items),
  accountingCloseBlocksPosting: /Accounting close control/i.test(closedMessage),
  accountingReopenAllowsPosting: Boolean(posted?.id),
  generalLedgerVisible,
  storefrontBranchRuntime: storefrontBranchVisible,
  advancedPromotionLifecycle: promotionLifecycle,
};
for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`R4 runtime check gagal: ${name}`);

const result = {
  generatedAt: new Date().toISOString(), status: 'PASS', sourceIdentity: sourceFingerprint(root),
  supplierId: supplier.id, goodsReceiptId: receipt.id, closeControlId: closeControl.id, promotionId: promo.id, checks,
  note: 'R4 runtime probe exercises supplier activation lifecycle/inactive procurement rejection, pre-posting goods-receipt rejection with no new inventory movement, canonical movement ledger read, AccountingCloseControl block/reopen, General Ledger visibility, public runtime branch discovery, and advanced BOGO promotion lifecycle on live PostgreSQL runtime.',
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`R4 core-business probe PASS: supplier=${supplier.id}, receipt=${receipt.id}, closeControl=${closeControl.id}, promo=${promo.id}.`);
