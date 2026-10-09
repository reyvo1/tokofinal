import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
const environment = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
const protectedEnvironment = environment === 'production' || environment === 'staging';
const signingSecret = process.env.WEBHOOK_SIGNING_SECRET?.trim();
let stopping = false;

function parseSecretKey(raw?: string): Buffer | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  try { const decoded = Buffer.from(value, 'base64'); return decoded.length === 32 ? decoded : undefined; } catch { return undefined; }
}

const secretMasterKey = parseSecretKey(process.env.SECRET_MASTER_KEY ?? process.env.ENCRYPTION_KEY);
if (protectedEnvironment && !secretMasterKey) throw new Error('SECRET_MASTER_KEY/ENCRYPTION_KEY staging/production wajib tersedia untuk worker.');

function decryptSecretText(payload: string): string {
  if (!payload.startsWith('enc:v1:')) return payload;
  if (!secretMasterKey) throw new Error('SECRET_MASTER_KEY/ENCRYPTION_KEY diperlukan untuk membuka webhook headers.');
  const [prefix, version, , ivEncoded, tagEncoded, cipherEncoded] = payload.split(':');
  if (prefix !== 'enc' || version !== 'v1' || !ivEncoded || !tagEncoded || !cipherEncoded) throw new Error('Format secret terenkripsi tidak valid.');
  const decipher = createDecipheriv('aes-256-gcm', secretMasterKey, Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherEncoded, 'base64url')), decipher.final()]).toString('utf8');
}

function webhookHeaders(value: Prisma.JsonValue | null): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, Prisma.JsonValue>;
  if (typeof record.__toko360Encrypted === 'string') {
    const decoded = JSON.parse(decryptSecretText(record.__toko360Encrypted));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Webhook headers terenkripsi bukan object.');
    return Object.fromEntries(Object.entries(decoded).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

const RESERVED_WEBHOOK_HEADERS = new Set([
  'content-type',
  'user-agent',
  'x-toko360-event',
  'x-toko360-delivery',
  'idempotency-key',
  'x-toko360-signature',
]);

function assertNoReservedWebhookHeaders(headers: Record<string, string>): void {
  const blocked = Object.keys(headers).filter((key) => RESERVED_WEBHOOK_HEADERS.has(key.toLowerCase()));
  if (blocked.length) {
    throw new Error(`Webhook custom headers tidak boleh menimpa header reserved: ${blocked.join(', ')}`);
  }
}


function privateIp(address: string): boolean {
  if (!isIP(address)) return false;
  if (address === '::1' || address === '0.0.0.0') return true;
  if (address.startsWith('127.') || address.startsWith('10.') || address.startsWith('192.168.') || address.startsWith('169.254.')) return true;
  const match = address.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}

async function assertSafeWebhookTarget(rawUrl: string): Promise<void> {
  const allowPrivate = process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true';
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && !allowPrivate) throw new Error('Webhook production wajib HTTPS.');
  if (allowPrivate) return;
  if (url.hostname === 'localhost') throw new Error('Webhook localhost ditolak.');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) throw new Error('Webhook target private/local network ditolak.');
}

function eventEnabled(events: Prisma.JsonValue, eventType: string): boolean {
  return Array.isArray(events) && events.some((event) => event === '*' || event === eventType);
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function pathValue(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function scalarEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' || typeof right === 'number') {
    const a = Number(left); const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }
  return left === right;
}

function conditionValueMatches(actual: unknown, expected: Prisma.JsonValue, payload: Record<string, Prisma.JsonValue>): boolean {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return scalarEqual(actual, expected);
  const operators = expected as Record<string, Prisma.JsonValue>;
  for (const [operator, operand] of Object.entries(operators)) {
    const right = operator.endsWith('Field') && typeof operand === 'string' ? pathValue(payload, operand) : operand;
    if (operator === 'eq' && !scalarEqual(actual, right)) return false;
    if (operator === 'ne' && scalarEqual(actual, right)) return false;
    if (operator === 'in' && (!Array.isArray(right) || !right.some((item) => scalarEqual(actual, item)))) return false;
    if (['gt','gte','lt','lte','gtField','gteField','ltField','lteField'].includes(operator)) {
      const leftNumber = Number(actual); const rightNumber = Number(right);
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
      if ((operator === 'gt' || operator === 'gtField') && !(leftNumber > rightNumber)) return false;
      if ((operator === 'gte' || operator === 'gteField') && !(leftNumber >= rightNumber)) return false;
      if ((operator === 'lt' || operator === 'ltField') && !(leftNumber < rightNumber)) return false;
      if ((operator === 'lte' || operator === 'lteField') && !(leftNumber <= rightNumber)) return false;
    }
  }
  return true;
}

function ruleMatches(payload: Record<string, Prisma.JsonValue>, conditions: Prisma.JsonValue | null): boolean {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return true;
  return Object.entries(conditions as Record<string, Prisma.JsonValue>)
    .every(([path, expected]) => conditionValueMatches(pathValue(payload, path), expected, payload));
}

function automationActionType(action: Record<string, Prisma.JsonValue>): string {
  const type = typeof action.type === 'string' ? action.type : '';
  if (type === 'notification.enqueue') return 'ENQUEUE_NOTIFICATION';
  if (type === 'approval.create') return 'CREATE_APPROVAL_REQUEST';
  if (type === 'reorder_suggestion.create') return 'CREATE_REORDER_SUGGESTION';
  if (type === 'outbox.emit') return 'EMIT_OUTBOX_EVENT';
  if (type === 'report.enqueue') return 'CREATE_REPORT_JOB';
  if (type === 'automation.enqueue' && typeof action.actionType === 'string' && action.actionType.trim()) return action.actionType.trim();
  return `UNSUPPORTED_RULE_ACTION:${type || 'UNKNOWN'}`;
}

async function materializeBusinessRules(event: { id: string; companyId: string | null; eventType: string; aggregateType: string; aggregateId: string; payload: Prisma.JsonValue }): Promise<void> {
  if (!event.companyId) return;
  const payload = jsonObject(event.payload);
  const branchId = typeof payload.branchId === 'string' ? payload.branchId : null;
  const rules = await prisma.businessRule.findMany({
    where: { companyId: event.companyId, trigger: event.eventType, isActive: true },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });
  for (const rule of rules) {
    if (!ruleMatches(payload, rule.conditions)) continue;
    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    for (const [index, rawAction] of actions.entries()) {
      if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) continue;
      const action = rawAction as Record<string, Prisma.JsonValue>;
      const idempotencyKey = `rule:${rule.id}:event:${event.id}:action:${index}`;
      const actionPayload: Prisma.InputJsonObject = {
        ...action,
        eventId: event.id,
        eventType: event.eventType,
        sourceType: event.aggregateType,
        sourceId: event.aggregateId,
        eventPayload: payload,
      };
      await prisma.automationJob.upsert({
        where: { companyId_idempotencyKey: { companyId: event.companyId, idempotencyKey } },
        update: {},
        create: {
          companyId: event.companyId, branchId, eventType: event.eventType,
          sourceType: event.aggregateType, sourceId: event.aggregateId, ruleCode: rule.code,
          actionType: automationActionType(action), priority: rule.priority,
          payload: actionPayload, idempotencyKey,
        },
      });
    }
  }
}

async function emitAutomationSourceEvents(): Promise<void> {
  const lowStock = await prisma.inventory.findMany({
    where: { product: { isActive: true } },
    include: { product: true, warehouse: { include: { branch: true } } },
    orderBy: { updatedAt: 'asc' }, take: 500,
  });
  for (const row of lowStock) {
    if (!row.product.companyId || row.product.companyId !== row.warehouse.branch.companyId || row.product.minStock <= 0 || row.available > row.product.minStock) continue;
    const latest = await prisma.eventOutbox.findFirst({
      where: { companyId: row.product.companyId, eventType: 'inventory.balance.changed', aggregateType: 'Inventory', aggregateId: row.id },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    if (latest && latest.createdAt >= row.updatedAt) continue;
    await prisma.eventOutbox.create({ data: {
      companyId: row.product.companyId, eventType: 'inventory.balance.changed', aggregateType: 'Inventory', aggregateId: row.id,
      payload: {
        companyId: row.product.companyId, branchId: row.warehouse.branchId, warehouseId: row.warehouseId,
        productId: row.productId, available: row.available, reserved: row.reserved,
        product: { sku: row.product.sku, name: row.product.name, minStock: row.product.minStock },
        observedAt: new Date().toISOString(),
      },
    } });
  }

  const now = new Date();
  const plans = await prisma.assetMaintenancePlan.findMany({
    where: { companyId: { not: '' }, isActive: true, autoCreateWorkOrder: true, OR: [{ nextDueDate: { lte: now } }, { nextDueOdometer: { not: null } }] },
    orderBy: { updatedAt: 'asc' }, take: 200,
  });
  if (!plans.length) return;
  const assetIds = [...new Set(plans.map((plan) => plan.assetId))];
  const [assets, vehicles] = await Promise.all([
    prisma.asset.findMany({ where: { id: { in: assetIds } } }),
    prisma.vehicle.findMany({ where: { assetId: { in: assetIds } } }),
  ]);
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const vehicleMap = new Map(vehicles.filter((vehicle) => vehicle.assetId).map((vehicle) => [vehicle.assetId!, vehicle]));
  for (const plan of plans) {
    const asset = assetMap.get(plan.assetId); if (!asset || asset.companyId !== plan.companyId) continue;
    const vehicle = vehicleMap.get(plan.assetId);
    const dueByDate = Boolean(plan.nextDueDate && plan.nextDueDate <= now);
    const dueByOdometer = Boolean(plan.nextDueOdometer !== null && vehicle && vehicle.currentOdometer >= plan.nextDueOdometer);
    if (!dueByDate && !dueByOdometer) continue;
    const latest = await prisma.eventOutbox.findFirst({
      where: { companyId: plan.companyId, eventType: 'asset.maintenance.due', aggregateType: 'AssetMaintenancePlan', aggregateId: plan.id },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    if (latest && latest.createdAt >= plan.updatedAt) continue;
    await prisma.eventOutbox.create({ data: {
      companyId: plan.companyId, eventType: 'asset.maintenance.due', aggregateType: 'AssetMaintenancePlan', aggregateId: plan.id,
      payload: {
        companyId: plan.companyId, branchId: asset.branchId, assetId: asset.id, assetType: asset.assetType,
        planId: plan.id, planCode: plan.code, vehicleId: vehicle?.id ?? null,
        currentOdometer: vehicle?.currentOdometer ?? null, nextDueDate: plan.nextDueDate?.toISOString() ?? null,
        nextDueOdometer: plan.nextDueOdometer, dueByDate, dueByOdometer, observedAt: now.toISOString(),
      },
    } });
  }
}

function digiflazzBaseUrl(): string {
  const fallback = 'https://api.digiflazz.com/v1';
  const override = process.env.T360_CI_DIGIFLAZZ_API_BASE_URL?.trim();
  if (!override) return fallback;
  if (process.env.CI !== 'true' || !process.env.T360_UAT_ENVIRONMENT) throw new Error('T360_CI_DIGIFLAZZ_API_BASE_URL hanya boleh dipakai pada CI UAT non-production.');
  const url = new URL(override);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Digiflazz CI base URL wajib localhost.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Digiflazz CI base URL protocol tidak didukung.');
  return override.replace(/\/$/, '');
}

function md5(value: string): string { return createHash('md5').update(value).digest('hex'); }

function digiflazzCredentials(encryptedSecrets?: string | null): { username: string; apiKey: string } {
  if (!encryptedSecrets) throw new Error('Credential Digiflazz belum dikonfigurasi pada IntegrationConnection.');
  const decrypted = decryptSecretText(encryptedSecrets).trim();
  let parsed: unknown;
  try { parsed = JSON.parse(decrypted); } catch { throw new Error('Secret Digiflazz harus JSON {username,apiKey}.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Secret Digiflazz harus object JSON.');
  const record = parsed as Record<string, unknown>;
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : '';
  if (!username || !apiKey) throw new Error('Secret Digiflazz membutuhkan username dan apiKey.');
  return { username, apiKey };
}

function digiflazzSalePrice(cost: number, config: Prisma.JsonValue | null): number {
  const settings = jsonObject(config);
  const markupPercent = Math.max(0, Number(settings.markupPercent ?? 0) || 0);
  const markupAmount = Math.max(0, Number(settings.markupAmount ?? 0) || 0);
  return Math.ceil(cost * (1 + markupPercent / 100) + markupAmount);
}

async function digiflazzPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${digiflazzBaseUrl()}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Toko360-Worker/0.5.3' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Digiflazz HTTP ${response.status}: response bukan JSON.`); }
  if (!response.ok) throw new Error(`Digiflazz HTTP ${response.status}: ${text.slice(0, 500)}`);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Response Digiflazz bukan object.');
  return parsed as Record<string, unknown>;
}

async function syncDigiflazzCatalog(integrationId: string): Promise<void> {
  const integration = await prisma.integrationConnection.findFirst({ where: { id: integrationId, type: 'PPOB', provider: 'DIGIFLAZZ', status: 'CONNECTED' } });
  if (!integration) throw new Error('IntegrationConnection DIGIFLAZZ CONNECTED tidak ditemukan.');
  const { username, apiKey } = digiflazzCredentials(integration.encryptedSecrets);
  const response = await digiflazzPost('/price-list', { cmd: 'prepaid', username, sign: md5(`${username}${apiKey}pricelist`) });
  const data = response.data;
  if (!Array.isArray(data)) throw new Error('Price list Digiflazz tidak mengembalikan data array.');
  await prisma.$transaction(async (tx) => {
    const previousRows = await tx.digitalServiceProduct.findMany({ where: { integrationId: integration.id }, select: { providerSku: true, name: true, category: true, type: true, metadata: true } });
    const previousBySku = new Map(previousRows.map((product) => [product.providerSku, product]));
    await tx.digitalServiceProduct.updateMany({ where: { integrationId: integration.id }, data: { active: false } });
    for (const item of data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const providerSku = typeof row.buyer_sku_code === 'string' ? row.buyer_sku_code.trim() : '';
      const name = typeof row.product_name === 'string' ? row.product_name.trim() : '';
      const category = typeof row.category === 'string' ? row.category.trim() : 'LAINNYA';
      const cost = Number(row.price);
      if (!providerSku || !name || !Number.isFinite(cost) || cost < 0) continue;
      const buyerProductStatus = row.buyer_product_status !== false;
      const sellerProductStatus = row.seller_product_status !== false;
      const active = buyerProductStatus && sellerProductStatus;
      const previous = previousBySku.get(providerSku);
      const previousMetadata = previous?.metadata && typeof previous.metadata === 'object' && !Array.isArray(previous.metadata)
        ? previous.metadata as Record<string, unknown> : {};
      const safeProviderData = Object.fromEntries(Object.entries(row).filter(([key]) =>
        !['taxTreatment','taxVerificationReason','taxVerifiedById','taxVerifiedAt'].includes(key)));
      // Classification belongs to Finance, never the untrusted vendor catalog. Preserve it only
      // for the exact same semantic product after sync; product reclassification clears it.
      const sameProduct = previous && previous.name === name && previous.category === category
        && (previous.type ?? null) === (typeof row.type === 'string' ? row.type : null);
      const verifiedMetadata = sameProduct && previousMetadata.taxTreatment === 'NO_TAX_VERIFIED'
        ? { taxTreatment: 'NO_TAX_VERIFIED', taxVerificationReason: previousMetadata.taxVerificationReason,
            taxVerifiedById: previousMetadata.taxVerifiedById, taxVerifiedAt: previousMetadata.taxVerifiedAt } : {};
      const mergedMetadata = { ...safeProviderData, ...verifiedMetadata } as Prisma.InputJsonObject;
      await tx.digitalServiceProduct.upsert({
        where: { integrationId_providerSku: { integrationId: integration.id, providerSku } },
        create: {
          companyId: integration.companyId, integrationId: integration.id, providerSku, name, category,
          brand: typeof row.brand === 'string' ? row.brand : null, type: typeof row.type === 'string' ? row.type : null,
          sellerName: typeof row.seller_name === 'string' ? row.seller_name : null, costPrice: new Prisma.Decimal(cost),
          salePrice: new Prisma.Decimal(digiflazzSalePrice(cost, integration.config)), buyerProductStatus, sellerProductStatus,
          unlimitedStock: row.unlimited_stock === true, stock: Number.isInteger(Number(row.stock)) ? Number(row.stock) : null, active,
          metadata: mergedMetadata, syncedAt: new Date(),
        },
        update: {
          name, category, brand: typeof row.brand === 'string' ? row.brand : null, type: typeof row.type === 'string' ? row.type : null,
          sellerName: typeof row.seller_name === 'string' ? row.seller_name : null, costPrice: new Prisma.Decimal(cost),
          salePrice: new Prisma.Decimal(digiflazzSalePrice(cost, integration.config)), buyerProductStatus, sellerProductStatus,
          unlimitedStock: row.unlimited_stock === true, stock: Number.isInteger(Number(row.stock)) ? Number(row.stock) : null, active,
          metadata: mergedMetadata, syncedAt: new Date(),
        },
      });
    }
    await tx.integrationConnection.update({ where: { id: integration.id }, data: { lastHealthCheckAt: new Date(), lastError: null } });
  });
}

function mappedDigiflazzStatus(value: unknown): 'SUCCESS'|'PENDING'|'FAILED' {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (status === 'sukses' || status === 'success') return 'SUCCESS';
  if (status === 'gagal' || status === 'failed') return 'FAILED';
  // Unknown provider values are NOT a failure proof. Never unlock cash refund
  // unless Digiflazz sent an explicit terminal failure status.
  return 'PENDING';
}

async function processDigiflazzTransaction(transactionId: string): Promise<void> {
  const transaction = await prisma.digitalServiceTransaction.findUnique({ where: { id: transactionId }, include: { integration: true } });
  if (!transaction) throw new Error('DigitalServiceTransaction tidak ditemukan.');
  if (!['QUEUED','PROCESSING','PENDING'].includes(transaction.status)) return;
  // A legacy queued event must never reach Digiflazz: it has no customer cash
  // receipt. The posted Accounting Core event, not a requestData flag, is authority.
  if (!transaction.paymentAccountingEventId || !transaction.capturedAt) throw new Error('PPOB_UNPAID: provider dispatch blocked before network call.');
  const prepaid = await prisma.accountingEvent.findFirst({ where: {
    id: transaction.paymentAccountingEventId, companyId: transaction.companyId,
    branchId: transaction.branchId, sourceType: 'DigitalServiceTransaction',
    sourceId: transaction.id, eventType: 'DIGITAL_SERVICE_PREPAYMENT', status: 'POSTED',
  } });
  if (!prepaid || !new Prisma.Decimal(prepaid.grossAmount).equals(transaction.sellingPrice)) {
    throw new Error('PPOB_PAYMENT_LEDGER_MISMATCH: provider dispatch blocked before network call.');
  }

  if (transaction.integration.type !== 'PPOB' || transaction.integration.provider !== 'DIGIFLAZZ' || transaction.integration.status !== 'CONNECTED') throw new Error('IntegrationConnection transaksi bukan DIGIFLAZZ CONNECTED.');
  const { username, apiKey } = digiflazzCredentials(transaction.integration.encryptedSecrets);
  await prisma.digitalServiceTransaction.update({ where: { id: transaction.id }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
  const body: Record<string, unknown> = {
    username, buyer_sku_code: transaction.providerSku, customer_no: transaction.customerNo, ref_id: transaction.number,
    sign: md5(`${username}${apiKey}${transaction.number}`),
  };
  const config = jsonObject(transaction.integration.config);
  if (config.testing === true) body.testing = true;
  if (transaction.maxPrice) body.max_price = Number(transaction.maxPrice);
  const response = await digiflazzPost('/transaction', body);
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Response transaksi Digiflazz tidak memiliki data object.');
  const row = data as Record<string, unknown>;
  const status = mappedDigiflazzStatus(row.status);
  const price = Number(row.price);
  await prisma.digitalServiceTransaction.update({
    where: { id: transaction.id }, data: {
      status, providerRef: typeof row.ref_id === 'string' ? row.ref_id : transaction.number,
      providerRc: typeof row.rc === 'string' ? row.rc : null, message: typeof row.message === 'string' ? row.message : null,
      serialNumber: typeof row.sn === 'string' ? row.sn : null, costAmount: Number.isFinite(price) ? new Prisma.Decimal(price) : undefined,
      responseData: row as Prisma.InputJsonObject, completedAt: status === 'SUCCESS' || status === 'FAILED' ? new Date() : null,
    },
  });
}

async function handleDigitalServiceOutbox(event: { eventType: string; aggregateId: string; payload: Prisma.JsonValue }): Promise<void> {
  if (event.eventType === 'digital-service.catalog.sync') { await syncDigiflazzCatalog(event.aggregateId); return; }
  if (event.eventType === 'digital-service.transaction.requested' || event.eventType === 'digital-service.transaction.recheck') { await processDigiflazzTransaction(event.aggregateId); }
}

async function dispatchOutbox(): Promise<void> {
  const now = new Date();
  const leaseUntil = new Date(Date.now() + 10 * 60_000);
  const events = await prisma.eventOutbox.findMany({
    where: { availableAt: { lte: now }, OR: [{ status: 'PENDING' }, { status: 'PROCESSING' }] },
    take: 25,
    orderBy: { createdAt: 'asc' },
  });

  for (const event of events) {
    const claimed = await prisma.eventOutbox.updateMany({
      where: { id: event.id, availableAt: { lte: new Date() }, OR: [{ status: 'PENDING' }, { status: 'PROCESSING' }] },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, availableAt: leaseUntil },
    });
    if (!claimed.count) continue;

    try {
      await handleDigitalServiceOutbox(event);
      await materializeBusinessRules(event);
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: { isActive: true, ...(event.companyId ? { companyId: event.companyId } : {}) },
      });
      const matching = endpoints.filter((endpoint) => eventEnabled(endpoint.events, event.eventType));
      for (const endpoint of matching) {
        const exists = await prisma.webhookDelivery.findFirst({ where: { endpointId: endpoint.id, eventId: event.id } });
        if (!exists) {
          await prisma.webhookDelivery.create({
            data: {
              endpointId: endpoint.id,
              eventId: event.id,
              eventType: event.eventType,
              payload: event.payload === null ? Prisma.JsonNull : event.payload as Prisma.InputJsonValue,
              status: 'PENDING',
            },
          });
        }
      }
      await prisma.eventOutbox.update({ where: { id: event.id }, data: { status: 'DISPATCHED', publishedAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = event.attempts + 1;
      await prisma.eventOutbox.update({
        where: { id: event.id },
        data: { status: attempts >= 10 ? 'FAILED' : 'PENDING', lastError: message, availableAt: new Date(Date.now() + 30000) },
      });
    }
  }
}


async function sendWebhookDeliveries(): Promise<void> {
  const now = new Date();
  const leaseUntil = new Date(Date.now() + 10 * 60_000);
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      OR: [
        { status: { in: ['PENDING', 'RETRY'] }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
        { status: 'PROCESSING', nextRetryAt: { lte: now } },
      ],
    },
    take: 25,
    orderBy: { createdAt: 'asc' },
  });

  for (const delivery of deliveries) {
    const claimed = await prisma.webhookDelivery.updateMany({
      where: {
        id: delivery.id,
        OR: [
          { status: { in: ['PENDING', 'RETRY'] }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] },
          { status: 'PROCESSING', nextRetryAt: { lte: new Date() } },
        ],
      },
      data: { status: 'PROCESSING', nextRetryAt: leaseUntil },
    });
    if (!claimed.count) continue;

    try {
      const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: delivery.endpointId } });
      if (!endpoint?.isActive) {
        await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'CANCELLED', nextRetryAt: null } });
        continue;
      }
      await assertSafeWebhookTarget(endpoint.url);
      if (protectedEnvironment && (!signingSecret || signingSecret.length < 32 || /change[_-]?me|ganti-dengan/i.test(signingSecret))) {
        throw new Error('WEBHOOK_SIGNING_SECRET staging/production wajib unik, bukan placeholder, dan minimal 32 karakter sebelum delivery dikirim.');
      }
      const body = JSON.stringify(delivery.payload);
      const signature = signingSecret ? createHmac('sha256', signingSecret).update(body).digest('hex') : undefined;
      const configuredHeaders = webhookHeaders(endpoint.headers);
      assertNoReservedWebhookHeaders(configuredHeaders);
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Toko360-Webhook/0.5',
          'x-toko360-event': delivery.eventType,
          'x-toko360-delivery': delivery.id,
          'idempotency-key': delivery.id,
          ...(signature ? { 'x-toko360-signature': `sha256=${signature}` } : {}),
          ...configuredHeaders,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      const responseBody = (await response.text()).slice(0, 4000);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseBody}`);
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', attempts: { increment: 1 }, responseCode: response.status, responseBody, deliveredAt: new Date(), nextRetryAt: null },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: attempts >= 10 ? 'FAILED' : 'RETRY', attempts: { increment: 1 },
          responseBody: message.slice(0, 4000), nextRetryAt: attempts >= 10 ? null : new Date(Date.now() + Math.min(3600000, 5000 * 2 ** attempts)),
        },
      });
    }
  }
}



const EXTERNAL_NOTIFICATION_CHANNELS = ['TELEGRAM', 'WHATSAPP', 'EMAIL', 'SMS', 'PUSH'] as const;
const RESERVED_NOTIFICATION_HEADERS = new Set(['content-type', 'user-agent', 'idempotency-key', 'x-toko360-notification']);

function notificationDataObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function stringRecord(value: Prisma.JsonValue | undefined): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function notificationSecretHeaders(encryptedSecrets?: string | null): Record<string, string> {
  if (!encryptedSecrets) return {};
  const decrypted = decryptSecretText(encryptedSecrets).trim();
  if (!decrypted) return {};
  try {
    const parsed = JSON.parse(decrypted) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const headers = record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
        ? Object.fromEntries(Object.entries(record.headers as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {};
      if (typeof record.token === 'string' && record.token.trim()) {
        const header = typeof record.tokenHeader === 'string' && record.tokenHeader.trim() ? record.tokenHeader.trim() : 'authorization';
        const prefix = typeof record.tokenPrefix === 'string' ? record.tokenPrefix : 'Bearer ';
        headers[header] = `${prefix}${record.token}`;
      }
      return headers;
    }
  } catch {
    // Plain secret is treated as a bearer token for simple providers.
  }
  return { authorization: `Bearer ${decrypted}` };
}

function notificationSecretToken(encryptedSecrets?: string | null): string | null {
  if (!encryptedSecrets) return null;
  const decrypted = decryptSecretText(encryptedSecrets).trim();
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const token = (parsed as Record<string, unknown>).token;
      return typeof token === 'string' && token.trim() ? token.trim() : null;
    }
  } catch {
    return decrypted;
  }
  return null;
}

function telegramApiBaseUrl(): string {
  const fallback = 'https://api.telegram.org';
  const override = process.env.T360_CI_TELEGRAM_API_BASE_URL?.trim();
  if (!override) return fallback;
  if (process.env.CI !== 'true' || !process.env.T360_UAT_ENVIRONMENT) {
    throw new Error('T360_CI_TELEGRAM_API_BASE_URL hanya boleh dipakai pada CI UAT non-production.');
  }
  const url = new URL(override);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('T360_CI_TELEGRAM_API_BASE_URL wajib localhost pada CI UAT.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Telegram CI base URL protocol tidak didukung.');
  return override.replace(/\/$/, '');
}

async function sendTelegramNotification(
  notification: { id: string; recipient: string; body: string },
  integration: { provider: string; config: Prisma.JsonValue | null; encryptedSecrets: string | null },
): Promise<{ response: Response; provider: string }> {
  const token = notificationSecretToken(integration.encryptedSecrets);
  if (!token) throw new Error('Secret token Telegram belum dikonfigurasi pada IntegrationConnection.');
  const config = jsonObject(integration.config);
  const parseMode = typeof config.parseMode === 'string' && ['HTML','MarkdownV2'].includes(config.parseMode) ? config.parseMode : undefined;
  const response = await fetch(`${telegramApiBaseUrl()}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': notification.id },
    body: JSON.stringify({
      chat_id: notification.recipient,
      text: notification.body,
      disable_web_page_preview: true,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  return { response, provider: integration.provider };
}

function assertNotificationHeaders(headers: Record<string, string>): void {
  const blocked = Object.keys(headers).filter((key) => RESERVED_NOTIFICATION_HEADERS.has(key.toLowerCase()));
  if (blocked.length) throw new Error(`Notification integration tidak boleh menimpa header reserved: ${blocked.join(', ')}`);
}

function notificationIntegrationMatches(config: Record<string, Prisma.JsonValue>, channel: string): boolean {
  if (typeof config.channel === 'string' && config.channel.toUpperCase() === channel) return true;
  if (Array.isArray(config.channels) && config.channels.some((value) => typeof value === 'string' && value.toUpperCase() === channel)) return true;
  return false;
}

async function findNotificationIntegration(notification: { companyId: string; channel: string; data: Prisma.JsonValue | null }) {
  const data = notificationDataObject(notification.data);
  const branchId = typeof data.branchId === 'string' ? data.branchId : undefined;
  const candidates = await prisma.integrationConnection.findMany({
    where: {
      companyId: notification.companyId,
      type: 'NOTIFICATION',
      status: 'CONNECTED',
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : { branchId: null }),
    },
    orderBy: [{ branchId: 'desc' }, { createdAt: 'asc' }],
    take: 20,
  });
  return candidates.find((candidate) => notificationIntegrationMatches(jsonObject(candidate.config), notification.channel)) ?? null;
}

async function sendGenericNotification(
  notification: { id: string; recipient: string; channel: string; subject: string | null; body: string; data: Prisma.JsonValue | null },
  integration: { provider: string; config: Prisma.JsonValue | null; encryptedSecrets: string | null },
): Promise<{ response: Response; provider: string }> {
  const config = jsonObject(integration.config);
  const url = typeof config.url === 'string' ? config.url.trim() : '';
  if (!url) throw new Error(`Integration notification ${integration.provider} belum memiliki config.url.`);
  const method = typeof config.method === 'string' ? config.method.toUpperCase() : 'POST';
  if (method !== 'POST') throw new Error('Notification generic adapter saat ini hanya menerima HTTP POST.');
  await assertSafeWebhookTarget(url);
  const configuredHeaders = stringRecord(config.headers);
  const secretHeaders = notificationSecretHeaders(integration.encryptedSecrets);
  assertNotificationHeaders(configuredHeaders);
  assertNotificationHeaders(secretHeaders);
  const recipientField = typeof config.recipientField === 'string' && config.recipientField.trim() ? config.recipientField.trim() : 'to';
  const subjectField = typeof config.subjectField === 'string' && config.subjectField.trim() ? config.subjectField.trim() : 'subject';
  const bodyField = typeof config.bodyField === 'string' && config.bodyField.trim() ? config.bodyField.trim() : 'body';
  const payload: Record<string, unknown> = {
    [recipientField]: notification.recipient,
    [bodyField]: notification.body,
    channel: notification.channel,
    data: notification.data,
  };
  if (notification.subject) payload[subjectField] = notification.subject;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Toko360-Notification/0.5',
      'idempotency-key': notification.id,
      'x-toko360-notification': notification.id,
      ...configuredHeaders,
      ...secretHeaders,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  return { response, provider: integration.provider };
}

async function processExternalNotifications(): Promise<void> {
  const notifications = await prisma.notification.findMany({
    where: { status: 'QUEUED', scheduledAt: { lte: new Date() }, channel: { in: [...EXTERNAL_NOTIFICATION_CHANNELS] } },
    take: 25,
    orderBy: { scheduledAt: 'asc' },
  });
  for (const notification of notifications) {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000);
    const claimed = await prisma.notification.updateMany({ where: { id: notification.id, status: 'QUEUED', scheduledAt: { lte: new Date() } }, data: { scheduledAt: leaseUntil } });
    if (!claimed.count) continue;
    let integrationId: string | null = null;
    try {
      const integration = await findNotificationIntegration(notification);
      integrationId = integration?.id ?? null;
      let response: Response;
      let provider: string;
      if (integration && notification.channel === 'TELEGRAM' && (integration.provider.toUpperCase() === 'TELEGRAM' || jsonObject(integration.config).adapter === 'TELEGRAM_BOT')) {
        ({ response, provider } = await sendTelegramNotification(notification, integration));
      } else if (integration) {
        ({ response, provider } = await sendGenericNotification(notification, integration));
      } else if (notification.channel === 'TELEGRAM') {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) throw new Error('Integration NOTIFICATION TELEGRAM atau TELEGRAM_BOT_TOKEN belum dikonfigurasi.');
        response = await fetch(`${telegramApiBaseUrl()}/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: notification.recipient, text: notification.body, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(15000),
        });
        provider = 'telegram-env';
      } else if (notification.channel === 'WHATSAPP') {
        const providerUrl = process.env.WHATSAPP_PROVIDER_URL;
        const providerToken = process.env.WHATSAPP_PROVIDER_TOKEN;
        if (!providerUrl || !providerToken) throw new Error('Integration NOTIFICATION WHATSAPP atau WHATSAPP_PROVIDER_URL/TOKEN belum dikonfigurasi.');
        await assertSafeWebhookTarget(providerUrl);
        response = await fetch(providerUrl, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${providerToken}`, 'idempotency-key': notification.id },
          body: JSON.stringify({ to: notification.recipient, type: 'text', text: notification.body, data: notification.data }),
          signal: AbortSignal.timeout(15000),
        });
        provider = 'whatsapp-env';
      } else {
        throw new Error(`Integration NOTIFICATION CONNECTED untuk channel ${notification.channel} belum dikonfigurasi.`);
      }
      const responseBody = (await response.text()).slice(0, 4000);
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}: ${responseBody}`);
      await prisma.notification.update({ where: { id: notification.id }, data: {
        status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), externalRef: responseBody.slice(0, 250), provider, lastError: null,
      } });
      if (integrationId) await prisma.integrationConnection.update({ where: { id: integrationId }, data: { lastHealthCheckAt: new Date(), lastError: null } });
      await prisma.employeeNotificationDelivery.updateMany({ where: { notificationId: notification.id }, data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), externalReference: responseBody.slice(0, 250), lastError: null } });
    } catch (error) {
      const attempts = notification.attempts + 1; const message = error instanceof Error ? error.message : String(error);
      await prisma.notification.update({ where: { id: notification.id }, data: { status: attempts >= 8 ? 'FAILED' : 'QUEUED', attempts, lastError: message, scheduledAt: attempts >= 8 ? notification.scheduledAt : new Date(Date.now() + Math.min(3600000, 5000 * 2 ** attempts)) } });
      if (integrationId) await prisma.integrationConnection.update({ where: { id: integrationId }, data: { status: 'DEGRADED', lastHealthCheckAt: new Date(), lastError: message.slice(0, 1000) } });
      await prisma.employeeNotificationDelivery.updateMany({ where: { notificationId: notification.id }, data: { status: attempts >= 8 ? 'FAILED' : 'QUEUED', attempts, lastError: message } });
    }
  }
}

async function processConsoleNotifications(): Promise<void> {
  const notifications = await prisma.notification.findMany({
    where: { status: 'QUEUED', scheduledAt: { lte: new Date() }, OR: [{ provider: 'console' }, { channel: 'IN_APP' }] },
    take: 50,
    orderBy: { scheduledAt: 'asc' },
  });
  for (const notification of notifications) {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000);
    const claimed = await prisma.notification.updateMany({ where: { id: notification.id, status: 'QUEUED', scheduledAt: { lte: new Date() } }, data: { scheduledAt: leaseUntil } });
    if (!claimed.count) continue;
    console.log(`[notification:${notification.channel}] ${notification.recipient}: ${notification.subject ?? ''} ${notification.body}`);
    await prisma.notification.update({ where: { id: notification.id }, data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date() } });
  }
}


async function processApprovalExpiries(): Promise<void> {
  const now = new Date();
  const requests = await prisma.approvalRequest.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    take: 50,
    orderBy: { expiresAt: 'asc' },
  });
  for (const request of requests) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.approvalRequest.findUnique({ where: { id: request.id } });
        if (!current || current.status !== 'PENDING' || !current.expiresAt || current.expiresAt > new Date()) return;
        const policy = current.policyId ? await tx.approvalPolicy.findUnique({ where: { id: current.policyId } }) : null;
        const steps = policy && Array.isArray(policy.steps) ? policy.steps : [];
        const rawStep = steps[Math.max(0, current.currentStep - 1)];
        const step = rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep) ? rawStep as Record<string, Prisma.JsonValue> : {};
        const escalationRoles = Array.isArray(step.escalationRoles) ? step.escalationRoles.filter((value): value is string => typeof value === 'string') : [];
        if (!current.escalatedAt && escalationRoles.length) {
          const extension = Math.max(1, Math.min(Number(step.escalationMinutes ?? step.expiresInMinutes ?? 60) || 60, 30 * 24 * 60));
          const existing = current.context && typeof current.context === 'object' && !Array.isArray(current.context) ? current.context as Prisma.JsonObject : {};
          await tx.approvalRequest.update({ where: { id: current.id }, data: {
            escalatedAt: new Date(),
            expiresAt: new Date(Date.now() + extension * 60_000),
            context: { ...existing, escalationRoles } as Prisma.InputJsonObject,
          } });
          await tx.notification.create({ data: {
            companyId: current.companyId, channel: 'IN_APP', recipient: escalationRoles.join(','),
            subject: 'Approval membutuhkan eskalasi',
            body: `${current.entityType} ${current.entityId} melewati batas waktu approval langkah ${current.currentStep}.`,
            data: { approvalRequestId: current.id, branchId: current.branchId, escalationRoles } as Prisma.InputJsonObject,
          } });
          return;
        }
        const claimed = await tx.approvalRequest.updateMany({ where: { id: current.id, status: 'PENDING', currentStep: current.currentStep }, data: { status: 'EXPIRED', decidedAt: new Date() } });
        if (claimed.count) {
          await tx.auditLog.create({ data: {
            companyId: current.companyId, action: 'EXPIRE_APPROVAL_REQUEST', entityType: 'ApprovalRequest', entityId: current.id,
            payload: { branchId: current.branchId, step: current.currentStep } as Prisma.InputJsonObject,
          } });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      console.error(`[approval-expiry] ${request.id}:`, error instanceof Error ? error.message : error);
    }
  }
}

async function processAutomationJobs(): Promise<void> {
  const staleLock = new Date(Date.now() - 10 * 60 * 1000);
  const jobs = await prisma.automationJob.findMany({
    where: { OR: [
      { status: { in: ['PENDING','RETRYING'] }, scheduledAt: { lte: new Date() } },
      { status: 'PROCESSING', lockedAt: { lt: staleLock } },
    ] },
    take: 25,
    orderBy: [{ priority: 'asc' }, { scheduledAt: 'asc' }],
  });
  for (const job of jobs) {
    const claimed = await prisma.automationJob.updateMany({
      where: { id: job.id, OR: [
        { status: { in: ['PENDING','RETRYING'] }, scheduledAt: { lte: new Date() } },
        { status: 'PROCESSING', lockedAt: { lt: staleLock } },
      ] },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lockedAt: new Date(), lockedBy: `worker-${process.pid}` },
    });
    if (!claimed.count) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.automationJob.findUnique({ where: { id: job.id } });
        if (!current || current.status !== 'PROCESSING') return;
        const payload = jsonObject(current.payload);
        const eventPayload = jsonObject(payload.eventPayload);
        if (current.actionType === 'EMIT_OUTBOX_EVENT') {
          const eventType = typeof payload.eventType === 'string' ? payload.eventType : current.eventType;
          await tx.eventOutbox.create({ data: {
            companyId: current.companyId, eventType, aggregateType: current.sourceType, aggregateId: current.sourceId,
            payload: (payload.data ?? eventPayload ?? payload) as Prisma.InputJsonValue,
          } });
        } else if (current.actionType === 'ENQUEUE_NOTIFICATION') {
          const channel = typeof payload.channel === 'string' ? payload.channel : 'IN_APP';
          const recipient = typeof payload.recipient === 'string' ? payload.recipient : 'ADMIN';
          const templateCode = typeof payload.templateCode === 'string' ? payload.templateCode : typeof payload.template === 'string' ? payload.template : undefined;
          const body = typeof payload.body === 'string'
            ? payload.body
            : `${current.eventType}: ${typeof eventPayload.productId === 'string' ? eventPayload.productId : current.sourceType} ${current.sourceId}`;
          await tx.notification.create({ data: {
            companyId: current.companyId, channel, recipient, templateCode,
            subject: typeof payload.subject === 'string' ? payload.subject : current.eventType,
            body, data: payload as Prisma.InputJsonValue,
          } });
        } else if (current.actionType === 'CREATE_APPROVAL_REQUEST') {
          const policyCode = typeof payload.policyCode === 'string' ? payload.policyCode : undefined;
          const policy = policyCode ? await tx.approvalPolicy.findFirst({ where: { companyId: current.companyId, code: policyCode, isActive: true } }) : null;
          if (policyCode && !policy) throw new Error(`Approval policy ${policyCode} tidak ditemukan/aktif.`);
          const existing = await tx.approvalRequest.findFirst({ where: {
            companyId: current.companyId, branchId: current.branchId, entityType: current.sourceType, entityId: current.sourceId,
            ...(policy ? { policyId: policy.id } : {}), status: 'PENDING',
          } });
          if (!existing) {
            const approvalContext: Prisma.InputJsonObject = { ...payload, ...(current.branchId ? { branchId: current.branchId } : {}) };
            await tx.approvalRequest.create({ data: {
              policyId: policy?.id, companyId: current.companyId, branchId: current.branchId,
              entityType: current.sourceType, entityId: current.sourceId,
              requesterId: typeof payload.requesterId === 'string' ? payload.requesterId : undefined,
              amount: typeof payload.amount === 'number' ? new Prisma.Decimal(payload.amount) : undefined,
              context: approvalContext,
            } });
          }
        } else if (current.actionType === 'CREATE_REPORT_JOB') {
          const reportType = typeof payload.reportType === 'string' ? payload.reportType.trim() : '';
          const format = typeof payload.format === 'string' ? payload.format.toUpperCase() : 'CSV';
          if (!reportType) throw new Error('CREATE_REPORT_JOB membutuhkan reportType.');
          if (!['CSV','XLSX','PDF'].includes(format)) throw new Error(`Format CREATE_REPORT_JOB tidak didukung: ${format}`);
          await tx.reportJob.create({ data: {
            companyId: current.companyId, branchId: current.branchId, reportType, format,
            filters: payload.filters && typeof payload.filters === 'object' && !Array.isArray(payload.filters) ? payload.filters as Prisma.InputJsonValue : undefined,
            requestedById: typeof payload.requestedById === 'string' ? payload.requestedById : undefined,
          } });
        } else if (current.actionType === 'CREATE_MAINTENANCE_WORK_ORDER') {
          if (current.sourceType !== 'AssetMaintenancePlan') throw new Error('CREATE_MAINTENANCE_WORK_ORDER hanya menerima source AssetMaintenancePlan.');
          const plan = await tx.assetMaintenancePlan.findFirst({ where: { id: current.sourceId, companyId: current.companyId, isActive: true } });
          if (!plan) throw new Error('Maintenance plan automation tidak ditemukan/aktif.');
          const asset = await tx.asset.findFirst({ where: { id: plan.assetId, companyId: current.companyId } });
          if (!asset) throw new Error('Aset maintenance automation tidak ditemukan.');
          const vehicle = await tx.vehicle.findFirst({ where: { companyId: current.companyId, assetId: asset.id } });
          const active = await tx.maintenanceWorkOrder.findFirst({ where: {
            companyId: current.companyId, assetId: asset.id, status: { in: ['PLANNED','OPEN','IN_PROGRESS','WAITING_PART'] },
          } });
          if (!active) {
            await tx.maintenanceWorkOrder.create({ data: {
              companyId: current.companyId, branchId: asset.branchId,
              number: `AUTO-MWO-${current.id.slice(0, 8).toUpperCase()}`,
              assetId: asset.id, vehicleId: vehicle?.id,
              maintenanceType: plan.name, priority: typeof payload.priority === 'string' ? payload.priority : 'NORMAL',
              scheduledAt: plan.nextDueDate ?? new Date(),
              notes: `Otomatis dari maintenance plan ${plan.code} (${plan.id}).`,
            } });
            const next: { nextDueDate?: Date; nextDueOdometer?: number } = {};
            if (plan.intervalDays && plan.intervalDays > 0) {
              const base = plan.nextDueDate && plan.nextDueDate > new Date() ? plan.nextDueDate : new Date();
              next.nextDueDate = new Date(base.getTime() + plan.intervalDays * 86_400_000);
            }
            if (plan.intervalOdometer && plan.intervalOdometer > 0 && vehicle) next.nextDueOdometer = vehicle.currentOdometer + plan.intervalOdometer;
            if (Object.keys(next).length) await tx.assetMaintenancePlan.update({ where: { id: plan.id }, data: next });
          }
        } else if (current.actionType === 'CREATE_REORDER_SUGGESTION') {
          if (current.sourceType !== 'Inventory') throw new Error('CREATE_REORDER_SUGGESTION hanya menerima source Inventory.');
          const inventory = await tx.inventory.findUnique({ where: { id: current.sourceId }, include: { product: true, warehouse: { include: { branch: true } } } });
          if (!inventory || inventory.warehouse.branch.companyId !== current.companyId || inventory.product.companyId !== current.companyId) throw new Error('Inventory automation berada di tenant yang tidak sesuai.');
          if (inventory.available <= inventory.product.minStock) {
            const multiplier = typeof payload.targetMultiplier === 'number' && Number.isFinite(payload.targetMultiplier)
              ? Math.max(1, Math.min(payload.targetMultiplier, 10)) : 2;
            const targetStock = Math.max(inventory.product.minStock, Math.ceil(inventory.product.minStock * multiplier));
            const suggestedQty = Math.max(1, targetStock - inventory.available);
            const forecast = await tx.forecastRun.create({ data: {
              companyId: current.companyId, warehouseId: inventory.warehouseId, model: 'RULE_LOW_STOCK', horizonDays: 1,
              parameters: { automationJobId: current.id, ruleCode: current.ruleCode, targetMultiplier: multiplier },
              status: 'COMPLETED', startedAt: new Date(), completedAt: new Date(),
            } });
            await tx.reorderSuggestion.create({ data: {
              forecastRunId: forecast.id, warehouseId: inventory.warehouseId, productId: inventory.productId,
              currentStock: inventory.quantity, reservedStock: inventory.reserved, averageDailySales: new Prisma.Decimal(0),
              leadTimeDays: 0, safetyStock: inventory.product.minStock, suggestedQty,
              reason: { source: 'LOW_STOCK_RULE', available: inventory.available, minStock: inventory.product.minStock, targetStock, automationJobId: current.id },
            } });
          }
        } else {
          throw new Error(`Automation action belum didukung worker: ${current.actionType}`);
        }
        await tx.auditLog.create({ data: {
          companyId: current.companyId, action: 'EXECUTE_AUTOMATION_JOB', entityType: 'AutomationJob', entityId: current.id,
          payload: { branchId: current.branchId, actionType: current.actionType, ruleCode: current.ruleCode, sourceType: current.sourceType, sourceId: current.sourceId },
        } });
        await tx.automationJob.update({ where: { id: current.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const current = await prisma.automationJob.findUnique({ where: { id: job.id }, select: { attempts: true, maxAttempts: true } });
      if (!current) continue;
      const message = error instanceof Error ? error.message : String(error);
      await prisma.automationJob.update({ where: { id: job.id }, data: {
        status: current.attempts >= current.maxAttempts ? 'FAILED' : 'RETRYING', lastError: message,
        scheduledAt: new Date(Date.now() + Math.min(3600000, 5000 * 2 ** current.attempts)), lockedAt: null, lockedBy: null,
      } });
    }
  }
}

async function processLoyaltyExpiries(): Promise<void> {
  const now = new Date();
  const candidates = await prisma.loyaltyTransaction.findMany({
    where: { points: { gt: 0 }, expiresAt: { lte: now } },
    select: { accountId: true },
    distinct: ['accountId'],
    take: 100,
  });
  for (const candidate of candidates) {
    try {
      await prisma.$transaction(async (tx) => {
        const account = await tx.loyaltyAccount.findUnique({ where: { id: candidate.accountId } });
        if (!account || account.points <= 0) return;
        const program = await tx.loyaltyProgram.findUnique({ where: { id: account.programId }, select: { companyId: true } });
        if (!program) return;
        const ledger = await tx.loyaltyTransaction.findMany({
          where: { accountId: account.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, points: true, expiresAt: true, createdAt: true },
        });
        const buckets: Array<{ id: string; remaining: number; expiresAt: Date | null }> = [];
        for (const row of ledger) {
          if (row.points > 0) {
            buckets.push({ id: row.id, remaining: row.points, expiresAt: row.expiresAt });
            continue;
          }
          let debit = Math.abs(row.points);
          for (const bucket of buckets) {
            if (debit <= 0) break;
            if (bucket.remaining <= 0) continue;
            const used = Math.min(bucket.remaining, debit);
            bucket.remaining -= used;
            debit -= used;
          }
        }
        const due = buckets.filter((bucket) => bucket.remaining > 0 && bucket.expiresAt && bucket.expiresAt <= now);
        const calculated = due.reduce((sum, bucket) => sum + bucket.remaining, 0);
        const expiring = Math.min(calculated, account.points);
        if (expiring <= 0) return;
        const nextBalance = account.points - expiring;
        await tx.loyaltyAccount.update({ where: { id: account.id }, data: { points: nextBalance } });
        const expiry = await tx.loyaltyTransaction.create({ data: {
          accountId: account.id, type: 'EXPIRE', points: -expiring, balanceAfter: nextBalance,
          referenceType: 'LoyaltyExpiry', referenceId: due.map((bucket) => bucket.id).sort().join(',').slice(0, 1000),
          notes: `Poin kedaluwarsa otomatis: ${expiring}`,
        } });
        await tx.auditLog.create({ data: {
          companyId: program.companyId, action: 'EXPIRE_LOYALTY_POINTS', entityType: 'LoyaltyAccount', entityId: account.id,
          payload: { loyaltyTransactionId: expiry.id, points: expiring, balanceAfter: nextBalance, sourceEarnTransactionIds: due.map((bucket) => bucket.id) },
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      console.error(`[loyalty-expiry] ${candidate.accountId}:`, error instanceof Error ? error.message : error);
    }
  }
}

async function expirePendingStorefrontOrders(): Promise<void> {
  const expired = await prisma.order.findMany({
    where: { status: 'PENDING_PAYMENT', expiresAt: { lte: new Date() } },
    select: { id: true },
    take: 50,
    orderBy: { expiresAt: 'asc' },
  });
  for (const candidate of expired) {
    try {
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: candidate.id },
          include: { items: { include: { product: true } }, warehouse: { include: { branch: true } }, payments: true },
        });
        if (!order || order.status !== 'PENDING_PAYMENT' || !order.expiresAt || order.expiresAt > new Date()) return;
        const claimed = await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING_PAYMENT', expiresAt: { lte: new Date() } },
          data: { status: 'CANCELLED' },
        });
        if (!claimed.count) return;
        const locationReservations = await tx.inventoryReservation.findMany({ where: { sourceType: 'Order', sourceId: order.id, status: 'ACTIVE' } });
        const explicitLocationTotals = new Map<string, number>();
        for (const reservation of locationReservations) {
          const locationReleased = await tx.inventoryLocationBalance.updateMany({
            where: { locationId: reservation.locationId, productId: reservation.productId, reserved: { gte: reservation.quantity } },
            data: { reserved: { decrement: reservation.quantity }, available: { increment: reservation.quantity } },
          });
          if (locationReleased.count !== 1) throw new Error(`Reservasi lokasi order ${order.number} tidak konsisten.`);
          await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'RELEASED' } });
          explicitLocationTotals.set(reservation.productId, (explicitLocationTotals.get(reservation.productId) ?? 0) + reservation.quantity);
        }
        const releaseQuantities = new Map<string, { quantity: number; sku: string }>();
        for (const item of order.items) {
          const current = releaseQuantities.get(item.productId);
          releaseQuantities.set(item.productId, { quantity: (current?.quantity ?? 0) + item.quantity, sku: item.product.sku });
        }
        for (const [productId, value] of releaseQuantities) {
          const explicitTotal = explicitLocationTotals.get(productId) ?? 0;
          if (explicitTotal !== 0 && explicitTotal !== value.quantity) throw new Error(`Reservasi lokasi eksplisit order ${order.number} tidak lengkap (${explicitTotal}/${value.quantity}).`);
          if (explicitTotal === 0) {
            let remaining = value.quantity;
            const balances = await tx.inventoryLocationBalance.findMany({ where: { warehouseId: order.warehouseId, productId, reserved: { gt: 0 } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] });
            for (const balance of balances) {
              if (remaining <= 0) break;
              const tracked = await tx.inventoryReservation.aggregate({ where: { locationId: balance.locationId, productId, status: 'ACTIVE' }, _sum: { quantity: true } });
              const legacyReserved = Math.max(0, balance.reserved - (tracked._sum.quantity ?? 0));
              if (!legacyReserved) continue;
              const take = Math.min(legacyReserved, remaining);
              const legacyReleased = await tx.inventoryLocationBalance.updateMany({
                where: { id: balance.id, reserved: { gte: take + (tracked._sum.quantity ?? 0) } },
                data: { reserved: { decrement: take }, available: { increment: take } },
              });
              if (legacyReleased.count !== 1) throw new Error(`Reservasi lokasi legacy order ${order.number} berubah saat expiry.`);
              remaining -= take;
            }
            if (remaining > 0) {
              const locationRows = await tx.inventoryLocationBalance.count({ where: { warehouseId: order.warehouseId, productId } });
              if (locationRows > 0) throw new Error(`Reservasi lokasi legacy order ${order.number} tidak lengkap (${value.quantity - remaining}/${value.quantity}).`);
            }
          }
          const released = await tx.inventory.updateMany({
            where: { warehouseId: order.warehouseId, productId, reserved: { gte: value.quantity } },
            data: { reserved: { decrement: value.quantity }, available: { increment: value.quantity } },
          });
          if (released.count !== 1) throw new Error(`Reservasi stok order ${order.number} untuk ${value.sku} tidak konsisten.`);
        }
        await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        await tx.promoRedemption.deleteMany({ where: { referenceType: 'Order', referenceId: order.id, companyId: order.warehouse.branch.companyId, branchId: order.branchId } });
        await tx.eventOutbox.create({ data: {
          companyId: order.warehouse.branch.companyId,
          eventType: 'commerce.order.expired', aggregateType: 'Order', aggregateId: order.id,
          payload: { companyId: order.warehouse.branch.companyId, branchId: order.branchId, orderId: order.id, releasedReservation: true },
        } });
        await tx.auditLog.create({ data: {
          companyId: order.warehouse.branch.companyId, action: 'EXPIRE_STOREFRONT_ORDER', entityType: 'Order', entityId: order.id,
          payload: { branchId: order.branchId, releasedReservation: true },
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      console.error(`[order-expiry] ${candidate.id}:`, error instanceof Error ? error.message : error);
    }
  }
}

async function tick(): Promise<void> {
  await expirePendingStorefrontOrders();
  await processLoyaltyExpiries();
  await processApprovalExpiries();
  await emitAutomationSourceEvents();
  await dispatchOutbox();
  await sendWebhookDeliveries();
  await processConsoleNotifications();
  await processExternalNotifications();
  await processAutomationJobs();
  await processReportSchedules();
  await processReportJobs();
}


type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

function reportScheduleZonedParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

function reportScheduleLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = new Date(localEpoch);
  for (let i = 0; i < 3; i += 1) {
    const actual = reportScheduleZonedParts(guess, timeZone);
    const actualEpoch = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const delta = actualEpoch - localEpoch;
    if (delta === 0) return guess;
    guess = new Date(guess.getTime() - delta);
  }
  return guess;
}

function nextReportScheduleRun(after: Date, schedule: { frequency: string; localTime: string; dayOfWeek: number | null; dayOfMonth: number | null; timezone: string }): Date {
  new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone }).format(after);
  const frequency = schedule.frequency as ReportFrequency;
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency)) throw new Error(`Frequency report schedule tidak didukung: ${schedule.frequency}`);
  const [hour, minute] = schedule.localTime.split(':').map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('localTime report schedule tidak valid.');
  const current = reportScheduleZonedParts(after, schedule.timezone);
  let localDate = new Date(Date.UTC(current.year, current.month - 1, current.day, hour, minute, 0, 0));
  if (frequency === 'WEEKLY') {
    if (schedule.dayOfWeek === null || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) throw new Error('dayOfWeek report schedule tidak valid.');
    const currentDow = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
    localDate.setUTCDate(localDate.getUTCDate() + ((schedule.dayOfWeek - currentDow + 7) % 7));
  } else if (frequency === 'MONTHLY') {
    if (schedule.dayOfMonth === null || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 28) throw new Error('dayOfMonth report schedule tidak valid.');
    localDate = new Date(Date.UTC(current.year, current.month - 1, schedule.dayOfMonth, hour, minute, 0, 0));
  }
  let candidate = reportScheduleLocalToUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), hour, minute, schedule.timezone);
  if (candidate <= after) {
    if (frequency === 'DAILY') localDate.setUTCDate(localDate.getUTCDate() + 1);
    else if (frequency === 'WEEKLY') localDate.setUTCDate(localDate.getUTCDate() + 7);
    else localDate = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, schedule.dayOfMonth!, hour, minute, 0, 0));
    candidate = reportScheduleLocalToUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), hour, minute, schedule.timezone);
  }
  return candidate;
}

async function processReportSchedules(): Promise<void> {
  const now = new Date();
  const schedules = await prisma.reportSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: 20,
  });
  for (const schedule of schedules) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.reportSchedule.findUnique({ where: { id: schedule.id } });
        if (!current || !current.isActive || current.nextRunAt > new Date()) return;
        const scheduledFor = current.nextRunAt;
        const nextRunAt = nextReportScheduleRun(new Date(scheduledFor.getTime() + 1000), current);
        const claimed = await tx.reportSchedule.updateMany({
          where: { id: current.id, isActive: true, nextRunAt: scheduledFor },
          data: { nextRunAt, lastRunAt: scheduledFor, lastError: null },
        });
        if (!claimed.count) return;
        const job = await tx.reportJob.create({ data: {
          companyId: current.companyId, branchId: current.branchId, requestedById: current.requestedById,
          scheduleId: current.id, scheduledFor, reportType: current.reportType, format: current.format, filters: current.filters ?? undefined,
        } });
        await tx.reportSchedule.update({ where: { id: current.id }, data: { lastJobId: job.id } });
        await tx.auditLog.create({ data: {
          companyId: current.companyId, userId: current.requestedById, action: 'MATERIALIZE_REPORT_SCHEDULE', entityType: 'ReportSchedule', entityId: current.id,
          payload: { branchId: current.branchId, reportJobId: job.id, scheduledFor: scheduledFor.toISOString(), nextRunAt: nextRunAt.toISOString() },
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastError: message, nextRunAt: new Date(Date.now() + 60 * 60 * 1000) } });
    }
  }
}

// T360-20260829 value pack 2 — eksekusi export CSV asinkron (ReportJob).
function resolveExportDir(): string {
  const configured = process.env.REPORT_EXPORT_DIR?.trim();
  if (configured) {
    const dir = resolve(configured);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const candidates = [
    join(process.cwd(), 'logs', 'report-exports'),
    resolve(process.env.INIT_CWD || process.cwd(), 'logs', 'report-exports'),
    resolve(process.cwd(), '..', '..', 'logs', 'report-exports'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  const fallback = candidates[1];
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');
}

function jobFilters(filters: Prisma.JsonValue): Record<string, unknown> {
  return filters && typeof filters === 'object' && !Array.isArray(filters) ? filters as Record<string, unknown> : {};
}

function reportBoundary(value: unknown, fallback: Date, endOfDay = false): Date {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = dateOnly ? new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`) : new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error('Filter tanggal report tidak valid.');
  return parsed;
}

function reportRange(filters: Record<string, unknown>): { from: Date; to: Date } {
  const now = new Date();
  const days = Math.min(Math.max(Number(filters.days ?? 90) || 90, 1), 3650);
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - days);
  defaultFrom.setHours(0, 0, 0, 0);
  const from = reportBoundary(filters.from, defaultFrom, false);
  const to = reportBoundary(filters.to ?? filters.asOf, now, true);
  if (from > to) throw new Error('Filter tanggal awal report melebihi tanggal akhir.');
  return { from, to };
}

function normalBalance(type: string, debit: Prisma.Decimal, credit: Prisma.Decimal): Prisma.Decimal {
  return ['ASSET', 'EXPENSE'].includes(type) ? debit.sub(credit) : credit.sub(debit);
}

async function buildReportCsv(job: { reportType: string; companyId: string; branchId: string | null; filters: Prisma.JsonValue }): Promise<string> {
  const filters = jobFilters(job.filters);
  const days = Math.min(Math.max(Number(filters.days ?? 90) || 90, 1), 365);
  const start = new Date();
  start.setDate(start.getDate() - days);
  if (job.reportType === 'SALES') {
    const sales = await prisma.sale.findMany({
      where: {
        branchId: job.branchId ?? undefined,
        branch: { companyId: job.companyId },
        status: 'COMPLETED',
        createdAt: { gte: start },
      },
      select: { number: true, createdAt: true, channel: true, subtotal: true, discount: true, tax: true, total: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    return toCsv(
      ['number', 'createdAt', 'channel', 'subtotal', 'discount', 'tax', 'total'],
      sales.map((sale) => [sale.number, sale.createdAt.toISOString(), sale.channel, Number(sale.subtotal), Number(sale.discount), Number(sale.tax), Number(sale.total)]),
    );
  }
  if (job.reportType === 'PRODUCTS') {
    const products = await prisma.product.findMany({
      where: { companyId: job.companyId, isActive: true },
      select: { sku: true, name: true, unit: true, costPrice: true, salePrice: true, minStock: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
    return toCsv(
      ['sku', 'name', 'unit', 'costPrice', 'salePrice', 'minStock'],
      products.map((product) => [product.sku, product.name, product.unit, Number(product.costPrice), Number(product.salePrice), product.minStock]),
    );
  }

  if (!job.branchId) throw new Error(`Report ${job.reportType} memerlukan branch.`);
  const { from, to } = reportRange(filters);

  if (['PROFIT_LOSS', 'TRIAL_BALANCE', 'BALANCE_SHEET'].includes(job.reportType)) {
    const balanceFrom = job.reportType === 'BALANCE_SHEET' ? undefined : from;
    const grouped = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: { date: { ...(balanceFrom ? { gte: balanceFrom } : {}), lte: to } },
        account: { branchId: job.branchId, branch: { companyId: job.companyId } },
      },
      _sum: { debit: true, credit: true },
    });
    const ids = grouped.map((row) => row.accountId);
    const accounts = ids.length ? await prisma.account.findMany({
      where: { id: { in: ids }, branchId: job.branchId, branch: { companyId: job.companyId } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    }) : [];
    const groupedById = new Map(grouped.map((row) => [row.accountId, row]));
    const rows = accounts.map((account) => {
      const group = groupedById.get(account.id);
      const debit = new Prisma.Decimal(group?._sum.debit ?? 0);
      const credit = new Prisma.Decimal(group?._sum.credit ?? 0);
      return { ...account, debit, credit, balance: normalBalance(account.type, debit, credit) };
    });
    if (job.reportType === 'PROFIT_LOSS') {
      return toCsv(
        ['from', 'to', 'accountCode', 'accountName', 'type', 'amount'],
        rows.filter((row) => ['REVENUE', 'EXPENSE'].includes(row.type))
          .map((row) => [from.toISOString(), to.toISOString(), row.code, row.name, row.type, Number(row.balance)]),
      );
    }
    if (job.reportType === 'TRIAL_BALANCE') {
      return toCsv(
        ['from', 'to', 'accountCode', 'accountName', 'type', 'debit', 'credit', 'normalBalance'],
        rows.map((row) => [from.toISOString(), to.toISOString(), row.code, row.name, row.type, Number(row.debit), Number(row.credit), Number(row.balance)]),
      );
    }
    const revenue = rows.filter((row) => row.type === 'REVENUE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const expenses = rows.filter((row) => row.type === 'EXPENSE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const currentEarnings = revenue.sub(expenses);
    const balanceRows = rows.filter((row) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(row.type))
      .map((row) => [to.toISOString(), row.code, row.name, row.type, Number(row.balance)]);
    balanceRows.push([to.toISOString(), 'CURRENT_EARNINGS', 'Laba/Rugi Berjalan', 'EQUITY', Number(currentEarnings)]);
    return toCsv(['asOf', 'accountCode', 'accountName', 'type', 'amount'], balanceRows);
  }

  if (job.reportType === 'INVENTORY_VALUATION') {
    const warehouseIds = await prisma.warehouse.findMany({
      where: { branchId: job.branchId, branch: { companyId: job.companyId } },
      select: { id: true, code: true },
    });
    const warehouseById = new Map(warehouseIds.map((row) => [row.id, row.code]));
    const rows = await prisma.inventory.findMany({
      where: { warehouseId: { in: warehouseIds.map((row) => row.id) } },
      include: { product: { select: { sku: true, name: true, unit: true, costPrice: true } } },
      orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }],
      take: 10000,
    });
    return toCsv(
      ['asOf','warehouse','sku','product','unit','quantity','reserved','available','unitCost','inventoryValue'],
      rows.map((row) => [to.toISOString(), warehouseById.get(row.warehouseId) ?? '', row.product.sku, row.product.name, row.product.unit, row.quantity, row.reserved, row.available, Number(row.product.costPrice), Number(new Prisma.Decimal(row.product.costPrice).mul(row.quantity))]),
    );
  }

  if (job.reportType === 'PERIOD_COMPARISON') {
    const durationMs = to.getTime() - from.getTime() + 1;
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - durationMs + 1);
    async function summary(rangeFrom: Date, rangeTo: Date) {
      const grouped = await prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { journalEntry: { date: { gte: rangeFrom, lte: rangeTo } }, account: { branchId: job.branchId!, branch: { companyId: job.companyId } } },
        _sum: { debit: true, credit: true },
      });
      const ids = grouped.map((row) => row.accountId);
      const accounts = ids.length ? await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, type: true } }) : [];
      const byId = new Map(accounts.map((row) => [row.id, row]));
      let revenue = new Prisma.Decimal(0); let expenses = new Prisma.Decimal(0);
      for (const row of grouped) {
        const account = byId.get(row.accountId); if (!account) continue;
        const balance = normalBalance(account.type, new Prisma.Decimal(row._sum.debit ?? 0), new Prisma.Decimal(row._sum.credit ?? 0));
        if (account.type === 'REVENUE') revenue = revenue.add(balance);
        if (account.type === 'EXPENSE') expenses = expenses.add(balance);
      }
      return { revenue, expenses, netProfit: revenue.sub(expenses) };
    }
    const [current, previous] = await Promise.all([summary(from, to), summary(previousFrom, previousTo)]);
    return toCsv(['period','from','to','revenue','expenses','netProfit'], [
      ['CURRENT', from.toISOString(), to.toISOString(), Number(current.revenue), Number(current.expenses), Number(current.netProfit)],
      ['PREVIOUS', previousFrom.toISOString(), previousTo.toISOString(), Number(previous.revenue), Number(previous.expenses), Number(previous.netProfit)],
    ]);
  }

  if (job.reportType === 'BRANCH_COMPARISON') {
    const branchIds = Array.isArray(filters.branchIds) ? filters.branchIds.filter((value): value is string => typeof value === 'string') : [job.branchId];
    const branches = await prisma.branch.findMany({ where: { companyId: job.companyId, id: { in: branchIds } }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
    const output: Array<Array<string | number>> = [];
    for (const branch of branches) {
      const grouped = await prisma.journalLine.groupBy({ by: ['accountId'], where: { journalEntry: { date: { gte: from, lte: to } }, account: { branchId: branch.id, branch: { companyId: job.companyId } } }, _sum: { debit: true, credit: true } });
      const ids = grouped.map((row) => row.accountId);
      const accounts = ids.length ? await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, type: true } }) : [];
      const byId = new Map(accounts.map((row) => [row.id, row]));
      let revenue = new Prisma.Decimal(0); let expenses = new Prisma.Decimal(0);
      for (const row of grouped) { const account = byId.get(row.accountId); if (!account) continue; const balance = normalBalance(account.type, new Prisma.Decimal(row._sum.debit ?? 0), new Prisma.Decimal(row._sum.credit ?? 0)); if (account.type === 'REVENUE') revenue = revenue.add(balance); if (account.type === 'EXPENSE') expenses = expenses.add(balance); }
      output.push([branch.code, branch.name, Number(revenue), Number(expenses), Number(revenue.sub(expenses))]);
    }
    return toCsv(['branchCode','branchName','revenue','expenses','netProfit'], output);
  }

  if (job.reportType === 'COST_CENTER') {
    const rows = await prisma.accountingEventLine.findMany({
      where: { event: { companyId: job.companyId, branchId: job.branchId, status: 'POSTED', businessDate: { gte: from, lte: to } } },
      select: { netAmount: true, dimensions: true },
      take: 10000,
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      const dimensions = row.dimensions && typeof row.dimensions === 'object' && !Array.isArray(row.dimensions) ? row.dimensions as Record<string, unknown> : {};
      const costCenterId = typeof dimensions.costCenterId === 'string' && dimensions.costCenterId ? dimensions.costCenterId : 'UNASSIGNED';
      totals.set(costCenterId, (totals.get(costCenterId) ?? new Prisma.Decimal(0)).add(row.netAmount));
    }
    return toCsv(['costCenterId','amount'], [...totals.entries()].map(([costCenterId, amount]) => [costCenterId, Number(amount)]));
  }

  if (job.reportType === 'GENERAL_LEDGER') {
    const accountCode = typeof filters.accountCode === 'string' && filters.accountCode.trim() ? filters.accountCode.trim() : undefined;
    const lines = await prisma.journalLine.findMany({
      where: {
        journalEntry: { date: { gte: from, lte: to } },
        account: { branchId: job.branchId, branch: { companyId: job.companyId }, ...(accountCode ? { code: accountCode } : {}) },
      },
      include: {
        account: { select: { code: true, name: true, type: true } },
        journalEntry: { select: { number: true, date: true, referenceType: true, referenceId: true, description: true } },
      },
      orderBy: { id: 'asc' },
      take: 5000,
    });
    return toCsv(
      ['date', 'journalNumber', 'accountCode', 'accountName', 'accountType', 'referenceType', 'referenceId', 'description', 'debit', 'credit'],
      lines.map((line) => [line.journalEntry.date.toISOString(), line.journalEntry.number, line.account.code, line.account.name, line.account.type, line.journalEntry.referenceType, line.journalEntry.referenceId, line.journalEntry.description, Number(line.debit), Number(line.credit)]),
    );
  }

  if (job.reportType === 'CASHIER') {
    const sales = await prisma.sale.findMany({
      where: { branchId: job.branchId, branch: { companyId: job.companyId }, status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      select: { number: true, createdAt: true, total: true, discount: true, tax: true, cashierShift: { select: { id: true, user: { select: { name: true, email: true } } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000,
    });
    return toCsv(['date','saleNumber','cashier','cashierEmail','shiftId','discount','tax','total'], sales.map((row) => [row.createdAt.toISOString(), row.number, row.cashierShift?.user.name ?? 'NO_SHIFT', row.cashierShift?.user.email ?? '', row.cashierShift?.id ?? '', Number(row.discount), Number(row.tax), Number(row.total)]));
  }

  if (job.reportType === 'CHANNELS') {
    const sales = await prisma.sale.findMany({
      where: { branchId: job.branchId, branch: { companyId: job.companyId }, status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      select: { number: true, createdAt: true, channel: true, subtotal: true, discount: true, tax: true, total: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000,
    });
    return toCsv(['date','number','channel','subtotal','discount','tax','total'], sales.map((row) => [row.createdAt.toISOString(), row.number, row.channel, Number(row.subtotal), Number(row.discount), Number(row.tax), Number(row.total)]));
  }

  if (job.reportType === 'CUSTOMERS') {
    const customers = await prisma.customer.findMany({
      where: { companyId: job.companyId },
      select: { id: true, name: true, phone: true, email: true, customerType: true, points: true, createdAt: true, _count: { select: { sales: true, orders: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 5000,
    });
    return toCsv(['customerId','name','phone','email','type','points','saleCount','orderCount','createdAt'], customers.map((row) => [row.id, row.name, row.phone, row.email, row.customerType, row.points, row._count.sales, row._count.orders, row.createdAt.toISOString()]));
  }

  if (job.reportType === 'DISCOUNTS') {
    const sales = await prisma.sale.findMany({
      where: { branchId: job.branchId, branch: { companyId: job.companyId }, status: 'COMPLETED', createdAt: { gte: from, lte: to }, discount: { gt: 0 } },
      select: { number: true, createdAt: true, channel: true, subtotal: true, discount: true, total: true, customer: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000,
    });
    return toCsv(['date','number','channel','customer','subtotal','discount','total'], sales.map((row) => [row.createdAt.toISOString(), row.number, row.channel, row.customer?.name ?? '', Number(row.subtotal), Number(row.discount), Number(row.total)]));
  }

  if (job.reportType === 'RETURNS') {
    const branchWarehouses = await prisma.warehouse.findMany({
      where: { branchId: job.branchId, branch: { companyId: job.companyId } },
      select: { id: true },
    });
    const branchWarehouseIds = branchWarehouses.map((row) => row.id);
    const [saleReturns, purchaseReturns] = await Promise.all([
      prisma.saleReturn.findMany({ where: { warehouseId: { in: branchWarehouseIds }, createdAt: { gte: from, lte: to } }, select: { number: true, status: true, refundMethod: true, refundAmount: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000 }),
      prisma.purchaseReturn.findMany({ where: { warehouseId: { in: branchWarehouseIds }, createdAt: { gte: from, lte: to } }, select: { number: true, status: true, amount: true, payableOffsetAmount: true, supplierReceivableAmount: true, supplierCreditNoteNumber: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000 }),
    ]);
    const rows: Array<Array<unknown>> = [];
    for (const row of saleReturns) rows.push(['SALE_RETURN', row.createdAt.toISOString(), row.number, row.status, Number(row.refundAmount), row.refundMethod ?? '', '', '', '']);
    for (const row of purchaseReturns) rows.push(['PURCHASE_RETURN', row.createdAt.toISOString(), row.number, row.status, Number(row.amount), '', Number(row.payableOffsetAmount), Number(row.supplierReceivableAmount), row.supplierCreditNoteNumber ?? '']);
    rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    return toCsv(['type','date','number','status','amount','refundMethod','payableOffset','supplierReceivable','creditNote'], rows);
  }

  if (job.reportType === 'INVENTORY' || job.reportType === 'INVENTORY_MOVEMENTS' || job.reportType === 'BATCH_EXPIRY' || job.reportType === 'STOCK_OPNAME') {
    const warehouses = await prisma.warehouse.findMany({ where: { branchId: job.branchId, branch: { companyId: job.companyId } }, select: { id: true, code: true, name: true } });
    const warehouseIds = warehouses.map((row) => row.id);
    const warehouseById = new Map(warehouses.map((row) => [row.id, row]));
    if (job.reportType === 'INVENTORY') {
      const rows = await prisma.inventory.findMany({ where: { warehouseId: { in: warehouseIds } }, include: { product: { select: { sku: true, name: true, unit: true, costPrice: true } } }, orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }], take: 5000 });
      return toCsv(['warehouseCode','warehouseName','sku','product','unit','quantity','reserved','available','costPrice','inventoryValue'], rows.map((row) => [warehouseById.get(row.warehouseId)?.code ?? '', warehouseById.get(row.warehouseId)?.name ?? '', row.product.sku, row.product.name, row.product.unit, row.quantity, row.reserved, row.available, Number(row.product.costPrice), Number(row.product.costPrice) * row.quantity]));
    }
    if (job.reportType === 'INVENTORY_MOVEMENTS') {
      const rows = await prisma.inventoryMovement.findMany({ where: { warehouseId: { in: warehouseIds }, createdAt: { gte: from, lte: to } }, include: { product: { select: { sku: true, name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000 });
      return toCsv(['date','warehouse','sku','product','type','quantity','balanceAfter','referenceType','referenceId','notes'], rows.map((row) => [row.createdAt.toISOString(), warehouseById.get(row.warehouseId)?.code ?? '', row.product.sku, row.product.name, row.type, row.quantity, row.balanceAfter, row.referenceType, row.referenceId, row.notes ?? '']));
    }
    if (job.reportType === 'BATCH_EXPIRY') {
      const rows = await prisma.inventoryBatch.findMany({ where: { warehouseId: { in: warehouseIds } }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }], take: 5000 });
      const productIds = [...new Set(rows.map((row) => row.productId))];
      const products = productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds }, companyId: job.companyId }, select: { id: true, sku: true, name: true } }) : [];
      const productsById = new Map(products.map((row) => [row.id, row]));
      return toCsv(['warehouse','sku','product','batchNumber','producedAt','expiryDate','quantity','reserved','available'], rows.map((row) => [warehouseById.get(row.warehouseId)?.code ?? '', productsById.get(row.productId)?.sku ?? row.productId, productsById.get(row.productId)?.name ?? '', row.batchNumber, row.producedAt?.toISOString() ?? '', row.expiryDate?.toISOString() ?? '', row.quantity, row.reserved, row.quantity - row.reserved]));
    }
    const rows = await prisma.stockOpname.findMany({ where: { warehouseId: { in: warehouseIds }, createdAt: { gte: from, lte: to } }, include: { items: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 2000 });
    return toCsv(['number','warehouse','status','createdAt','completedAt','itemCount','differenceQty'], rows.map((row) => [row.number, warehouseById.get(row.warehouseId)?.code ?? '', row.status, row.createdAt.toISOString(), row.completedAt?.toISOString() ?? '', row.items.length, row.items.reduce((sum, item) => sum + Number(item.difference ?? 0), 0)]));
  }

  if (job.reportType === 'PURCHASES') {
    const rows = await prisma.purchaseOrder.findMany({
      where: { warehouse: { branchId: job.branchId, branch: { companyId: job.companyId } }, orderDate: { gte: from, lte: to } },
      include: { supplier: { select: { code: true, name: true } }, warehouse: { select: { code: true } }, _count: { select: { items: true, goodsReceipts: true } } },
      orderBy: [{ orderDate: 'asc' }, { id: 'asc' }], take: 5000,
    });
    return toCsv(['date','number','supplierCode','supplier','warehouse','status','subtotal','discount','tax','total','itemCount','receiptCount'], rows.map((row) => [row.orderDate.toISOString(), row.number, row.supplier.code, row.supplier.name, row.warehouse.code, row.status, Number(row.subtotal), Number(row.discount), Number(row.tax), Number(row.total), row._count.items, row._count.goodsReceipts]));
  }

  if (job.reportType === 'SUPPLIERS') {
    const rows = await prisma.supplier.findMany({ where: { companyId: job.companyId }, select: { code: true, name: true, phone: true, email: true, paymentTermDays: true, taxIdNumber: true, createdAt: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 5000 });
    return toCsv(['code','name','phone','email','paymentTermDays','taxIdNumber','createdAt'], rows.map((row) => [row.code, row.name, row.phone ?? '', row.email ?? '', row.paymentTermDays, row.taxIdNumber ?? '', row.createdAt.toISOString()]));
  }

  if (job.reportType === 'CASH_FLOW') {
    const lines = await prisma.journalLine.findMany({
      where: { journalEntry: { date: { gte: from, lte: to } }, account: { branchId: job.branchId, branch: { companyId: job.companyId }, code: { in: ['1101','1102','1103'] } } },
      include: { account: { select: { code: true, name: true } }, journalEntry: { select: { number: true, date: true, description: true, referenceType: true, referenceId: true } } },
      orderBy: { id: 'asc' }, take: 5000,
    });
    return toCsv(['date','journalNumber','accountCode','accountName','description','referenceType','referenceId','cashIn','cashOut','net'], lines.map((row) => { const debit = Number(row.debit); const credit = Number(row.credit); return [row.journalEntry.date.toISOString(), row.journalEntry.number, row.account.code, row.account.name, row.journalEntry.description, row.journalEntry.referenceType, row.journalEntry.referenceId, debit, credit, debit - credit]; }));
  }

  if (job.reportType === 'MARGIN') {
    const rows = await prisma.sale.findMany({ where: { branchId: job.branchId, branch: { companyId: job.companyId }, status: 'COMPLETED', createdAt: { gte: from, lte: to } }, select: { number: true, createdAt: true, channel: true, total: true, costTotal: true, discount: true, tax: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000 });
    return toCsv(['date','number','channel','total','tax','discount','cost','grossMargin','marginPercent'], rows.map((row) => { const total = Number(row.total); const tax = Number(row.tax); const cost = Number(row.costTotal); const revenueNetTax = total - tax; const margin = revenueNetTax - cost; return [row.createdAt.toISOString(), row.number, row.channel, total, tax, Number(row.discount), cost, margin, revenueNetTax ? (margin / revenueNetTax) * 100 : 0]; }));
  }

  if (job.reportType === 'RECEIVABLES' || job.reportType === 'PAYABLES') {
    const codes = job.reportType === 'RECEIVABLES' ? ['1201','1203'] : ['2101','2102','2103','2104'];
    const lines = await prisma.journalLine.findMany({
      where: { account: { branchId: job.branchId, branch: { companyId: job.companyId }, code: { in: codes } }, journalEntry: { date: { lte: to } } },
      include: { account: { select: { code: true, name: true, type: true } }, journalEntry: { select: { number: true, date: true, referenceType: true, referenceId: true, description: true } } },
      orderBy: [{ accountId: 'asc' }, { id: 'asc' }], take: 5000,
    });
    const runningByAccount = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    return toCsv(['asOf','date','journalNumber','accountCode','accountName','referenceType','referenceId','description','debit','credit','runningBalance'], lines.map((row) => {
      const current = runningByAccount.get(row.accountId) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      const next = { debit: current.debit.add(row.debit), credit: current.credit.add(row.credit) };
      runningByAccount.set(row.accountId, next);
      const running = normalBalance(row.account.type, next.debit, next.credit);
      return [to.toISOString(), row.journalEntry.date.toISOString(), row.journalEntry.number, row.account.code, row.account.name, row.journalEntry.referenceType, row.journalEntry.referenceId, row.journalEntry.description, Number(row.debit), Number(row.credit), Number(running)];
    }));
  }

  if (job.reportType === 'DELIVERY_COD') {
    const rows = await prisma.deliveryTrip.findMany({
      where: { companyId: job.companyId, branchId: job.branchId, createdAt: { gte: from, lte: to } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000,
    });
    return toCsv(['createdAt','tripNumber','status','vehicleId','driverEmployeeId','codExpected','codCollected','codVariance','actualDepartureAt','actualReturnAt','startOdometer','endOdometer'], rows.map((row) => [row.createdAt.toISOString(), row.number, row.status, row.vehicleId, row.driverEmployeeId, Number(row.codExpected), Number(row.codCollected), Number(row.codExpected)-Number(row.codCollected), row.actualDepartureAt?.toISOString()??'', row.actualReturnAt?.toISOString()??'', row.startOdometer??'', row.endOdometer??'']));
  }

  if (job.reportType === 'PAYROLL') {
    const rows = await prisma.payrollRun.findMany({
      where: { companyId: job.companyId, branchId: job.branchId, createdAt: { gte: from, lte: to } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000,
    });
    return toCsv(['createdAt','number','runType','adjustmentOfRunId','adjustmentSequence','adjustmentReason','adjustmentPostingDate','status','employeeCount','grossTotal','deductionTotal','taxTotal','employerContributionTotal','netTotal','calculatedAt','approvedAt','postedJournalEntryId'], rows.map((row) => [row.createdAt.toISOString(), row.number, row.adjustmentOfRunId ? 'ADJUSTMENT' : 'REGULAR', row.adjustmentOfRunId??'', row.adjustmentSequence, row.adjustmentReason??'', row.adjustmentPostingDate?.toISOString()??'', row.status, row.employeeCount, Number(row.grossTotal), Number(row.deductionTotal), Number(row.taxTotal), Number(row.employerContributionTotal), Number(row.netTotal), row.calculatedAt?.toISOString()??'', row.approvedAt?.toISOString()??'', row.postedJournalEntryId??'']));
  }

  if (job.reportType === 'AUDIT_LOG') {
    const rows = await prisma.auditLog.findMany({ where: { companyId: job.companyId, createdAt: { gte: from, lte: to } }, include: { user: { select: { name: true, email: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000 });
    return toCsv(['date','user','email','action','entityType','entityId','ipAddress','payload'], rows.map((row) => [row.createdAt.toISOString(), row.user?.name ?? 'SYSTEM', row.user?.email ?? '', row.action, row.entityType, row.entityId ?? '', row.ipAddress ?? '', row.payload == null ? '' : JSON.stringify(row.payload)]));
  }

  if (job.reportType === 'TAX_SUMMARY') {
    const transactions = await prisma.taxTransaction.findMany({
      where: { companyId: job.companyId, branchId: job.branchId, status: 'POSTED', transactionDate: { gte: from, lte: to } },
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
    const ids = [...new Set(transactions.map((row) => row.taxCodeId))];
    const taxCodes = ids.length ? await prisma.taxCode.findMany({ where: { companyId: job.companyId, id: { in: ids } }, select: { id: true, code: true, name: true, recoverable: true } }) : [];
    const codeMap = new Map(taxCodes.map((row) => [row.id, row]));
    return toCsv(
      ['date', 'period', 'taxCode', 'taxName', 'direction', 'recoverable', 'sourceType', 'sourceId', 'documentNumber', 'taxableBase', 'taxAmount'],
      transactions.map((row) => {
        const code = codeMap.get(row.taxCodeId);
        return [row.transactionDate.toISOString(), row.taxPeriod, code?.code ?? row.taxCodeId, code?.name ?? '', row.direction, code?.recoverable ?? false, row.sourceType, row.sourceId, row.documentNumber, Number(row.taxableBase), Number(row.taxAmount)];
      }),
    );
  }
  throw new Error(`Jenis laporan belum didukung worker: ${job.reportType}`);
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { cell += '"'; index += 1; continue; }
      if (char === '"') { quoted = false; continue; }
      cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function excelColumn(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
}

let crcTable: Uint32Array | undefined;
function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, file.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(file.data.length, 20); central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function renderXlsx(csv: string): Buffer {
  const rows = parseCsvRows(csv);
  const rowXml = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${excelColumn(columnIndex)}${rowIndex + 1}`;
    const numeric = rowIndex > 0 && value.trim() !== '' && Number.isFinite(Number(value));
    return numeric ? `<c r="${ref}"><v>${Number(value)}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`) },
  ];
  return zipStored(files);
}

function pdfEscape(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function renderPdf(csv: string, title: string): Buffer {
  const rows = parseCsvRows(csv);
  const lines = [title, `Generated: ${new Date().toISOString()}`, '', ...rows.map((row) => row.join(' | '))];
  const pageLines: string[][] = [];
  for (let index = 0; index < lines.length; index += 55) pageLines.push(lines.slice(index, index + 55));
  if (!pageLines.length) pageLines.push(['(empty report)']);
  const pageIds = pageLines.map((_lines, index) => 4 + index * 2);
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  pageLines.forEach((page, index) => {
    const pageId = pageIds[index]; const contentId = pageId + 1;
    const commands = ['BT', '/F1 6.5 Tf', '24 580 Td', '8 TL', ...page.map((line, lineIndex) => `${lineIndex ? 'T* ' : ''}(${pdfEscape(line.slice(0, 150))}) Tj`), 'ET'].join('\n');
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${Buffer.byteLength(commands, 'utf8')} >>\nstream\n${commands}\nendstream`);
  });
  const maxId = Math.max(...objects.keys());
  let pdf = '%PDF-1.4\n%Toko360\n';
  const offsets = new Array<number>(maxId + 1).fill(0);
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${id} 0 obj\n${objects.get(id) ?? '<<>>'}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function renderReportOutput(csv: string, format: string, reportType: string): { extension: string; data: string | Buffer } {
  const normalized = format.toUpperCase();
  if (normalized === 'CSV') return { extension: 'csv', data: csv };
  if (normalized === 'XLSX') return { extension: 'xlsx', data: renderXlsx(csv) };
  if (normalized === 'PDF') return { extension: 'pdf', data: renderPdf(csv, `Toko360 ${reportType}`) };
  throw new Error(`Format report tidak didukung worker: ${format}`);
}

async function processReportJobs(): Promise<void> {
  const jobs = await prisma.reportJob.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  for (const job of jobs) {
    // klaim atomik: hanya satu worker yang memproses job yang sama.
    const claimed = await prisma.reportJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (!claimed.count) continue;
    try {
      const csv = await buildReportCsv(job);
      const output = renderReportOutput(csv, job.format, job.reportType);
      const dir = resolveExportDir();
      await mkdir(dir, { recursive: true });
      const filename = `${job.id}.${output.extension}`;
      if (typeof output.data === 'string') await writeFile(join(dir, filename), output.data, 'utf8');
      else await writeFile(join(dir, filename), output.data);
      await prisma.$transaction(async (tx) => {
        await tx.reportJob.update({
          where: { id: job.id },
          data: { status: 'DONE', progress: 100, outputUrl: filename, finishedAt: new Date(), errorMessage: null },
        });
        if (job.scheduleId) await tx.reportSchedule.updateMany({ where: { id: job.scheduleId }, data: { lastJobId: job.id, lastError: null } });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.$transaction(async (tx) => {
        await tx.reportJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorMessage: message, finishedAt: new Date() } });
        if (job.scheduleId) await tx.reportSchedule.updateMany({ where: { id: job.scheduleId }, data: { lastJobId: job.id, lastError: message } });
      });
    }
  }
}

/**
 * Telegram transport. The loop lives in the worker because the transport is not the API's business
 * (see the note on `MobileOpsModule`), so the worker starts it. Built lazily and defensively: if the
 * mobile-ops surface cannot be loaded the worker still runs its normal tick loop, and says so. A
 * worker that refuses to boot because an optional transport is broken would turn a partial outage
 * into a total one.
 */
let stopTelegram: (() => void) | null = null;

async function startTelegram(): Promise<void> {
  try {
    // Import dari BUILD ARTIFACT API, bukan source. Worker punya tsconfig sendiri dan tidak boleh
    // mengompilasi source app lain; `apps/api/dist` adalah output yang sama persis dengan yang
    // dijalankan API, jadi tidak ada permukaan keamanan atau perilaku yang berbeda dari produksi.
    //
    // Specifier harus RUNTIME (dihitung dari __dirname), bukan literal._build gate menjalankan
    // `lint`/`tsc` SEBELUM build apa pun, di checkout bersih tanpa `dist/`. Dengan literal,
    // TypeScript mencoba me-resolve `apps/api/dist/...` saat typecheck dan gagal dengan TS2307 -
    // padahal saat runtime file itu memang ada, karena `npm run build` sudah membangun api lebih
    // dulu. Specifier yang dihitung membuat typecheck tidak ikut.rules runtime tidak berubah.
    const apiDist = (relative: string): string =>
      pathToFileURL(resolve(__dirname, '..', '..', 'api', 'dist', relative)).href;
    const [{ mountTelegramPolling }, { MobileOpsService }, { TelegramCommandService }] = await Promise.all([
      import('./telegram-runtime.js'),
      import(apiDist('mobile-ops/mobile-ops.service.js')),
      import(apiDist('mobile-ops/telegram-command.service.js')),
    ]);
    const result = mountTelegramPolling({ prisma, MobileOpsService, TelegramCommandService } as never, process.env, console.log);
    stopTelegram = result.stop ?? null;
    if (!result.started) console.log(`[worker] Telegram nonaktif: ${result.reason}`);
  } catch (error) {
    console.error('[worker] Telegram gagal dimuat; worker tetap berjalan:', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  console.log(`Toko360 worker started; interval=${intervalMs}ms`);
  await startTelegram();
  while (!stopping) {
    try { await tick(); }
    catch (error) { console.error('Worker tick failed:', error); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  // Poller dihentikan di sini, bukan cuma flag: tanpa stop() interval-nya tetap menahan event loop
  // dan SIGTERM tidak pernah benar-benar selesai.
  process.on(signal, () => { stopping = true; stopTelegram?.(); stopTelegram = null; });
}

main().finally(async () => prisma.$disconnect());
