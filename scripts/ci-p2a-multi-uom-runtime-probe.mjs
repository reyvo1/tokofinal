#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient, Prisma } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-p2a-multi-uom-runtime-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential P2A runtime probe tidak tersedia.');

function assertNonProductionPostgresTarget() {
  const raw = String(process.env.DATABASE_URL || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL P2A runtime probe tidak valid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('P2A runtime probe wajib berjalan pada PostgreSQL non-production runtime.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const expectedHost = String(process.env.T360_CI_EXPECTED_HOST || process.env.T360_UAT_EXPECTED_HOST || '').trim();
  const expectedDatabase = String(process.env.T360_CI_EXPECTED_DATABASE || process.env.T360_UAT_EXPECTED_DATABASE || '').trim();
  if (!expectedHost || !expectedDatabase) throw new Error('Target lock host/database P2A runtime probe wajib tersedia.');
  if (url.hostname !== expectedHost || database !== expectedDatabase) {
    throw new Error(`P2A runtime target mismatch: actual=${url.hostname}/${database}, expected=${expectedHost}/${expectedDatabase}.`);
  }
  if (/\b(prod|production|live)\b/i.test(`${url.hostname}/${database}`)) throw new Error('P2A runtime probe menolak database production/live.');
  return { host: url.hostname, database };
}

const runtimeTarget = assertNonProductionPostgresTarget();
const prisma = new PrismaClient();
const stamp = Date.now();
const suffix = String(stamp).slice(-9);
const checks = {};

async function request(route, { method = 'GET', body, token, headers = {}, expect } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers: requestHeaders, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expect !== undefined) {
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0, 1200)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 1200)}`);
  return data;
}

function asDecimal(value) { return new Prisma.Decimal(value ?? 0); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=';

async function completeAndApproveInspection(inspectionId, sourceType, token, { barcodeValue } = {}) {
  let rows = await prisma.inspectionResultItem.findMany({ where: { inspectionId }, orderBy: { id: 'asc' } });
  assert(rows.length > 0, `${sourceType} inspection tidak memiliki result rows.`);

  if (sourceType === 'Shipment') {
    assert(barcodeValue, 'Shipment inspection membutuhkan barcode/SKU produk untuk evidence policy.');
    await request(`/operations-control/inspections/${inspectionId}/evidence`, {
      method: 'POST', token,
      body: { evidenceType: 'PHOTO', mimeType: 'image/png', dataBase64: ONE_PIXEL_PNG_BASE64, metadata: { runtimeProbe: 'P2A' } },
    });
    const scanTarget = rows.filter((row) => row.productId && (row.expectedQty ?? 0) > 0).reduce((sum, row) => sum + (row.expectedQty ?? 0), 0);
    assert(scanTarget > 0, 'Shipment inspection tidak memiliki target scan produk.');
    for (let scan = 0; scan < scanTarget; scan += 1) {
      await request(`/operations-control/inspections/${inspectionId}/evidence`, {
        method: 'POST', token,
        body: { evidenceType: 'BARCODE', value: barcodeValue, metadata: { runtimeProbe: 'P2A', scan: scan + 1 } },
      });
    }
    rows = await prisma.inspectionResultItem.findMany({ where: { inspectionId }, orderBy: { id: 'asc' } });
  }

  const results = rows.map((row) => {
    const expected = row.expectedQty ?? undefined;
    return {
      ...(row.templateItemId ? { templateItemId: row.templateItemId } : {}),
      code: row.code,
      label: row.label,
      result: 'PASS',
      ...(row.productId ? { productId: row.productId } : {}),
      ...(expected !== undefined ? { expectedQty: expected, acceptedQty: expected, rejectedQty: 0, damagedQty: 0, missingQty: 0, extraQty: 0 } : {}),
      ...(row.scannedQty !== null ? { scannedQty: row.scannedQty } : {}),
    };
  });
  const completed = await request(`/operations-control/inspections/${inspectionId}/complete`, {
    method: 'POST', token,
    body: { results, notes: `P2A runtime ${sourceType} inspection` },
  });
  assert(['PASSED','PARTIAL','REVIEW_REQUIRED'].includes(completed?.status), `${sourceType} inspection tidak selesai dalam status yang dapat disetujui: ${completed?.status}.`);
  const approved = await request(`/operations-control/inspections/${inspectionId}/approve`, {
    method: 'POST', token,
    body: { notes: `P2A runtime ${sourceType} approval` },
  });
  assert(approved?.status === 'APPROVED', `${sourceType} inspection tidak APPROVED melalui API.`);
  return approved;
}

async function assertBalancedJournal(accountingEventId, label) {
  const event = await prisma.accountingEvent.findUnique({ where: { id: accountingEventId } });
  assert(event?.status === 'POSTED', `${label} accounting event belum POSTED.`);
  assert(event.journalEntryId, `${label} accounting event tidak memiliki journal entry.`);
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: event.journalEntryId } });
  assert(lines.length >= 2, `${label} journal lines tidak lengkap.`);
  const debit = lines.reduce((sum, line) => sum.add(line.debit), new Prisma.Decimal(0));
  const credit = lines.reduce((sum, line) => sum.add(line.credit), new Prisma.Decimal(0));
  assert(debit.equals(credit), `${label} journal tidak seimbang: debit=${debit.toFixed(2)} credit=${credit.toFixed(2)}.`);
  return event;
}

try {
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.accessToken;
  assert(token, 'Login P2A runtime probe tidak menghasilkan token.');

  const [manifest, warehouses] = await Promise.all([
    request('/platform/manifest', { token }),
    request('/inventory/warehouses', { token }),
  ]);
  const companyId = manifest?.company?.id;
  const branchId = manifest?.branch?.id;
  const branchCode = manifest?.branch?.code;
  assert(companyId && branchId && branchCode, 'Manifest tidak memiliki company/branch aktif.');
  const warehouse = (warehouses || []).find((row) => row.isActive !== false);
  assert(warehouse?.id, 'Gudang aktif untuk fixture P2A runtime probe tidak tersedia.');

  const baseUnit = await prisma.masterReference.findFirst({
    where: { companyId, branchId: null, type: 'UNIT', isActive: true },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
    select: { code: true },
  });
  assert(baseUnit?.code, 'Master UNIT aktif tingkat perusahaan tidak tersedia untuk fixture P2A.');

  const fixtureQuantity = 8;
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `P2ASKU${suffix}`.toUpperCase(),
      name: `P2A Runtime Product ${suffix}`,
      unit: baseUnit.code,
      productType: 'PHYSICAL',
      trackBatch: false,
      trackExpiry: false,
      trackSerial: false,
      allowNegativeStock: false,
      costPrice: 1000,
      salePrice: 2000,
      minStock: 1,
      isActive: true,
      metadata: { runtimeProbe: 'P2A', sourceFingerprint: sourceFingerprint(root).value },
    },
  });
  const fixtureInventory = await prisma.inventory.create({
    data: {
      warehouseId: warehouse.id,
      productId: product.id,
      quantity: fixtureQuantity,
      reserved: 0,
      available: fixtureQuantity,
    },
  });
  assert(fixtureInventory.quantity === fixtureQuantity && fixtureInventory.available === fixtureQuantity, 'Fixture inventory P2A gagal dibuat secara deterministik.');
  const baseline = { quantity: fixtureInventory.quantity, available: fixtureInventory.available, reserved: fixtureInventory.reserved };
  checks.selfProvisionedFixture = true;

  const unitCode = `P2A${suffix}`.slice(0, 40).toUpperCase();
  await request('/master-data/references', { method: 'POST', token, body: { type: 'UNIT', code: unitCode, name: `P2A Pack ${suffix}` } });
  const unit = await request(`/master-data/products/${product.id}/units`, {
    method: 'POST', token,
    body: { unitCode, quantityFactor: 2, isDefaultSale: false, isDefaultPurchase: false, isActive: true },
  });
  assert(unit?.id && unit.quantityFactor === 2, 'ProductUnit factor 2 gagal dibuat.');

  const customerPassword = `P2a-${suffix}-Aa9!`;
  const customerEmail = `p2a-${suffix}@example.test`;
  const customer = await request('/storefront/account/register', {
    method: 'POST',
    body: { branchCode, name: `P2A Customer ${suffix}`, email: customerEmail, password: customerPassword, address: 'P2A Runtime Address' },
  });
  assert(customer?.sessionToken, 'Registrasi customer P2A tidak menghasilkan session token.');
  const customerHeaders = { 'x-customer-session': customer.sessionToken, 'x-branch-code': branchCode };

  const fulfillment = await request('/storefront/account/fulfillment-options', { headers: { 'x-branch-code': branchCode } });
  const method = (fulfillment?.methods || []).find((item) => item.fulfillmentType === 'PICKUP') || (fulfillment?.methods || []).find((item) => item.fulfillmentType === 'DELIVERY');
  assert(method?.code, 'Metode fulfillment aktif tidak tersedia.');

  const order = await request('/orders', {
    method: 'POST',
    headers: { 'x-customer-session': customer.sessionToken, 'idempotency-key': `p2a-order-${suffix}` },
    body: {
      branchCode,
      warehouseId: warehouse.id,
      customerName: `P2A Customer ${suffix}`,
      address: 'P2A Runtime Address',
      fulfillmentType: method.fulfillmentType,
      shippingMethodCode: method.code,
      items: [{ productId: product.id, productUnitId: unit.id, quantity: 2 }],
    },
  });
  const orderItem = order?.items?.[0];
  assert(order?.id && order?.number && order?.accessToken && orderItem?.id, 'Order P2A tidak lengkap.');
  assert(orderItem.productUnitId === unit.id, 'OrderItem tidak menyimpan productUnitId transaksi.');
  assert(orderItem.unitCode === unitCode && orderItem.quantityFactor === 2 && orderItem.unitQuantity === 2 && orderItem.quantity === 4, 'OrderItem snapshot UOM/base quantity tidak konsisten.');
  checks.orderSnapshot = true;

  const reserved = await prisma.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } });
  assert(reserved && reserved.quantity === baseline.quantity && reserved.reserved === baseline.reserved + 4 && reserved.available === baseline.available - 4, 'Reservasi order tidak memakai 4 base unit secara konsisten.');
  checks.baseUnitReservation = true;

  await request(`/orders/${encodeURIComponent(order.number)}/payment-selection`, {
    method: 'POST', body: { paymentMethod: 'COD' },
    headers: { 'x-branch-code': branchCode, 'x-order-access-token': order.accessToken },
  });
  const shipment = await prisma.shipment.findFirst({ where: { orderId: order.id } });
  assert(shipment?.outboundInspectionId, 'Shipment/outbound inspection P2A tidak terbentuk.');
  const packageSnapshot = shipment.packages?.items?.find?.((item) => item.productId === product.id);
  assert(packageSnapshot?.productUnitId === unit.id && packageSnapshot?.unitCode === unitCode && packageSnapshot?.unitQuantity === 2 && packageSnapshot?.quantityFactor === 2 && packageSnapshot?.baseQuantity === 4, 'Shipment tidak membawa snapshot UOM order secara utuh.');
  checks.shipmentSnapshot = true;

  await completeAndApproveInspection(shipment.outboundInspectionId, 'Shipment', token, { barcodeValue: product.sku || product.barcode });
  await request(`/orders/${order.id}/pack`, { method: 'POST', token });
  await request(`/orders/${order.id}/ship`, {
    method: 'POST', token,
    body: method.fulfillmentType === 'PICKUP' ? {} : { carrier: 'P2A_RUNTIME', service: method.code, trackingNumber: `P2A-${suffix}` },
  });
  const delivered = await request(`/orders/${order.id}/deliver`, { method: 'POST', token });
  assert(delivered?.status === 'COMPLETED', `Order P2A tidak COMPLETED setelah deliver: ${delivered?.status}.`);

  const fulfilledInventory = await prisma.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } });
  assert(fulfilledInventory && fulfilledInventory.quantity === baseline.quantity - 4 && fulfilledInventory.reserved === baseline.reserved && fulfilledInventory.available === baseline.available - 4, 'Fulfillment tidak mengurangi tepat 4 base unit.');
  const fulfillmentEvent = await prisma.accountingEvent.findFirst({ where: { sourceType: 'Order', sourceId: order.id, status: 'POSTED' }, orderBy: { createdAt: 'desc' } });
  assert(fulfillmentEvent?.id, 'Accounting fulfillment order tidak ditemukan.');
  await assertBalancedJournal(fulfillmentEvent.id, 'Order fulfillment');
  checks.fulfillmentBaseInventoryAndAccounting = true;

  const updatedUnit = await request(`/master-data/products/${product.id}/units/${unit.id}`, { method: 'PATCH', token, body: { isActive: false } });
  assert(updatedUnit?.isActive === false, 'ProductUnit P2A gagal dinonaktifkan setelah fulfillment.');
  checks.productUnitMutatedAfterTransaction = true;

  const originalNet = asDecimal(orderItem.netSubtotal);
  const originalTax = asDecimal(orderItem.taxAmount);
  const originalGross = asDecimal(orderItem.grossSubtotal);
  const returnedAmounts = { net: new Prisma.Decimal(0), tax: new Prisma.Decimal(0), gross: new Prisma.Decimal(0) };
  const returnIds = [];

  for (let sequence = 1; sequence <= 2; sequence += 1) {
    const createdReturn = await request('/storefront/account/returns', {
      method: 'POST', headers: customerHeaders,
      body: { orderId: order.id, reason: `P2A historical UOM return ${sequence}`, refundMethod: 'ORIGINAL', items: [{ orderItemId: orderItem.id, quantity: 1 }] },
    });
    const returnItem = createdReturn?.items?.[0];
    assert(createdReturn?.id && returnItem?.id, `Retur P2A ${sequence} tidak lengkap.`);
    assert(returnItem.productUnitId === unit.id && returnItem.unitCode === unitCode && returnItem.unitQuantity === 1 && returnItem.quantityFactor === 2 && returnItem.quantity === 2, `Retur P2A ${sequence} kehilangan snapshot historis UOM.`);
    returnIds.push(createdReturn.id);
    returnedAmounts.net = returnedAmounts.net.add(returnItem.netAmount);
    returnedAmounts.tax = returnedAmounts.tax.add(returnItem.taxAmount);
    returnedAmounts.gross = returnedAmounts.gross.add(returnItem.grossAmount);

    const inspecting = await request(`/returns/orders/${createdReturn.id}/inspection`, { method: 'POST', token });
    assert(inspecting?.inspectionId, `Retur P2A ${sequence} tidak menghasilkan inspection.`);
    await completeAndApproveInspection(inspecting.inspectionId, 'OrderReturn', token);
    const confirmed = await request(`/returns/orders/${createdReturn.id}/confirm`, { method: 'POST', token, body: { refundMethod: 'ORIGINAL', notes: `P2A runtime return ${sequence}` } });
    assert(confirmed?.status === 'COMPLETED', `Retur P2A ${sequence} tidak COMPLETED.`);
    assert(confirmed.accountingEventId, `Retur P2A ${sequence} tidak memiliki accounting event.`);
    await assertBalancedJournal(confirmed.accountingEventId, `Order return ${sequence}`);
  }

  assert(returnedAmounts.net.equals(originalNet), `Akumulasi net retur ${returnedAmounts.net.toFixed(2)} != original ${originalNet.toFixed(2)}.`);
  assert(returnedAmounts.tax.equals(originalTax), `Akumulasi tax retur ${returnedAmounts.tax.toFixed(2)} != original ${originalTax.toFixed(2)}.`);
  assert(returnedAmounts.gross.equals(originalGross), `Akumulasi gross retur ${returnedAmounts.gross.toFixed(2)} != original ${originalGross.toFixed(2)}.`);
  checks.partialReturnHistoricalRemainder = true;

  const finalInventory = await prisma.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } });
  assert(finalInventory && finalInventory.quantity === baseline.quantity && finalInventory.reserved === baseline.reserved && finalInventory.available === baseline.available, 'Dua retur mixed-UOM tidak mengembalikan inventory persis ke baseline base-unit.');
  const finalOrder = await prisma.order.findUnique({ where: { id: order.id }, include: { payments: true } });
  assert(finalOrder?.status === 'REFUNDED', `Order akhir bukan REFUNDED: ${finalOrder?.status}.`);
  checks.inventoryRoundTrip = true;
  checks.orderRefunded = true;

  const result = {
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    sourceIdentity: sourceFingerprint(root),
    productionTouched: false,
    runtimeTarget,
    orderId: order.id,
    productId: product.id,
    productUnitId: unit.id,
    returnIds,
    uom: { unitCode, unitQuantity: 2, quantityFactor: 2, baseQuantity: 4 },
    checks,
    note: 'P2A PostgreSQL runtime proof: 2 transaction units = 4 base units, fulfillment on base inventory, ProductUnit deactivated after fulfillment, two historical 1-unit returns preserve persisted UOM snapshots, exact amount remainder, balanced journals, and inventory round-trip.',
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`P2A mixed-UOM runtime probe PASS: order=${order.id}, returns=${returnIds.join(',')}.`);
} catch (error) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const result = { generatedAt: new Date().toISOString(), status: 'FAIL', sourceIdentity: sourceFingerprint(root), productionTouched: false, checks, error: error instanceof Error ? error.message : String(error) };
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  await prisma.$disconnect().catch(() => {});
}
