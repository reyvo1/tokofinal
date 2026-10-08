import { clearLegacyOfflineKeys, readSnapshot, writeSnapshot, type StoreOutcome } from './offline-store';

export type OfflineTenderMethod = {
  code: string;
  name: string;
  kind: 'CASH' | 'SETTLEMENT';
  settlementAccountCode: string;
  settlementBehavior: 'IMMEDIATE' | 'CLEARING';
  requiresProvider: boolean;
  requiresReference: boolean;
  refundBehavior: 'ORIGINAL' | 'CASH' | 'SETTLEMENT' | 'RECEIVABLE' | 'DISABLED';
  refundAccountCode?: string;
  allowOffline: boolean;
  allowCashChange: boolean;
  feeAccountCode?: string;
  feeRatePercent: number;
};

export type OfflineTaxCode = {
  id: string;
  code: string;
  rate: string | number;
  inclusive: boolean;
  updatedAt?: string;
};

export type OfflineSalePayload = {
  warehouseId: string;
  paymentMethod?: string;
  discount?: number;
  customerId?: string;
  cashierShiftId?: string;
  redeemPoints?: number;
  idempotencyKey?: string;
  items: Array<{ productId: string; quantity: number; taxCodeId?: string }>;
};

export type OfflineQueueItem = {
  localId: string;
  sequence: number;
  capturedAt: string;
  configSyncedAt: string;
  expectedTotal: number;
  cashierSub: string;
  payload: OfflineSalePayload;
  status: 'PENDING' | 'CONFLICT' | 'FAILED';
  error?: string;
};

export type OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest> = {
  savedAt: string;
  products: Product[];
  warehouses: Warehouse[];
  customers: Customer[];
  shift: Shift | null;
  manifest: Manifest | null;
  taxCodes: OfflineTaxCode[];
  tenderMethods?: OfflineTenderMethod[];
  offlineMaxAgeMinutes?: number;
  clockOffsetMs?: number;
};

const DEVICE_KEY = 'toko360_pos_device_code';
const QUEUE_KEY = 'toko360_pos_offline_queue_v1';
const SEQUENCE_KEY = 'toko360_pos_offline_sequence_v1';
const SNAPSHOT_KEY = 'toko360_pos_offline_snapshot_v1';

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function getOrCreateDeviceCode(): string {
  try {
    const current = localStorage.getItem(DEVICE_KEY)?.trim();
    if (current) return current;
    const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const code = `pos-web-${random}`;
    localStorage.setItem(DEVICE_KEY, code);
    return code;
  } catch { return ''; }
}

export function loadOfflineQueue(): OfflineQueueItem[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(QUEUE_KEY); } catch { return []; }
  return parseJson<OfflineQueueItem[]>(raw, [])
    .filter((item) => item && typeof item.localId === 'string' && Number.isInteger(item.sequence) && item.sequence > 0
      && typeof item.capturedAt === 'string' && typeof item.configSyncedAt === 'string'
      && typeof item.cashierSub === 'string' && item.cashierSub.length > 0
      && Number.isFinite(Number(item.expectedTotal)) && !!item.payload)
    .sort((left, right) => left.sequence - right.sequence);
}

export function saveOfflineQueue(items: OfflineQueueItem[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify([...items].sort((left, right) => left.sequence - right.sequence)));
}

export function nextOfflineSequence(): number {
  const previous = Number(localStorage.getItem(SEQUENCE_KEY) ?? 0);
  const next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
  localStorage.setItem(SEQUENCE_KEY, String(next));
  return next;
}

export function loadOfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest>(): OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest> | null {
  try {
    return parseJson<OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest> | null>(localStorage.getItem(SNAPSHOT_KEY), null);
  } catch { return null; }
}

export function saveOfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest>(snapshot: OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest>): void {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/**
 * Read a snapshot, preferring IndexedDB and falling back to the legacy localStorage blob.
 *
 * The localStorage copy is the whole catalog in ONE key, so `JSON.stringify` can throw on a large
 * catalog (or the read can throw on a half-written value). Both are contained here rather than being
 * allowed to escape into loadData, where they would take the whole screen down.
 */
export async function readOfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest>(): Promise<OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest> | null> {
  try {
    const stored = await readSnapshot<OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest>>(SNAPSHOT_KEY);
    if (stored) return stored;
  } catch { /* fall through to the legacy path */ }
  try {
    return parseJson<OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest> | null>(localStorage.getItem(SNAPSHOT_KEY), null);
  } catch { return null; }
}

/**
 * Persist a snapshot to IndexedDB, then clear the legacy key.
 *
 * The order matters: IndexedDB first, and only drop localStorage once the write is confirmed. Doing
 * it the other way round loses a branch's offline catalog on a full disk — precisely when it is
 * needed. A failed IndexedDB write leaves the legacy copy in place as the working fallback.
 */
export async function persistOfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest>(snapshot: OfflineSnapshot<Product, Warehouse, Customer, Shift, Manifest>): Promise<StoreOutcome> {
  const outcome = await writeSnapshot(SNAPSHOT_KEY, snapshot, snapshot.savedAt);
  if (outcome.ok) {
    clearLegacyOfflineKeys([SNAPSHOT_KEY]);
    return outcome;
  }
  try {
    saveOfflineSnapshot(snapshot);
  } catch { /* the caller is told offline is unavailable via the outcome */ }
  return outcome;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateOfflineQuote(input: {
  items: Array<{ productId: string; quantity: number; unitPrice: number; salesTaxCodeId?: string | null }>;
  discount: number;
  taxCodes: OfflineTaxCode[];
}): { subtotal: number; discount: number; loyaltyDiscount: number; totalDiscount: number; net: number; tax: number; total: number; redeemPoints: number } {
  const subtotal = round2(input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  const discount = round2(Math.max(0, input.discount || 0));
  if (discount > subtotal) throw new Error('Diskon melebihi subtotal.');

  const taxMap = new Map(input.taxCodes.map((taxCode) => [taxCode.id, taxCode]));
  let allocatedDiscount = 0;
  let net = 0;
  let tax = 0;
  let total = 0;

  input.items.forEach((item, index) => {
    const line = round2(item.unitPrice * item.quantity);
    const share = index === input.items.length - 1
      ? round2(discount - allocatedDiscount)
      : subtotal === 0 ? 0 : round2(discount * line / subtotal);
    allocatedDiscount = round2(allocatedDiscount + share);
    const discountedBase = round2(line - share);
    const taxCode = item.salesTaxCodeId ? taxMap.get(item.salesTaxCodeId) : undefined;
    if (item.salesTaxCodeId && !taxCode) throw new Error('Aturan pajak produk belum tersimpan untuk mode offline. Sambungkan POS ke server terlebih dahulu.');

    if (!taxCode) {
      net = round2(net + discountedBase);
      total = round2(total + discountedBase);
      return;
    }

    const rate = Number(taxCode.rate);
    if (!Number.isFinite(rate) || rate < 0) throw new Error(`Tarif pajak ${taxCode.code} tidak valid pada cache offline.`);
    if (taxCode.inclusive && rate > 0) {
      const lineNet = round2(discountedBase / (1 + rate));
      const lineTax = round2(discountedBase - lineNet);
      net = round2(net + lineNet);
      tax = round2(tax + lineTax);
      total = round2(total + discountedBase);
    } else {
      const lineTax = round2(discountedBase * rate);
      net = round2(net + discountedBase);
      tax = round2(tax + lineTax);
      total = round2(total + discountedBase + lineTax);
    }
  });

  return { subtotal, discount, loyaltyDiscount: 0, totalDiscount: discount, net, tax, total, redeemPoints: 0 };
}

export function reservedOfflineQuantity(queue: OfflineQueueItem[], warehouseId: string, productId: string): number {
  return queue.reduce((sum, item) => {
    if (item.payload.warehouseId !== warehouseId) return sum;
    const line = item.payload.items.find((candidate) => candidate.productId === productId);
    return sum + (line?.quantity ?? 0);
  }, 0);
}
