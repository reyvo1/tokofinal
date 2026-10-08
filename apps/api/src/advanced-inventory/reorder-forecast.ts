import { businessDateKey } from '../common/business-time';

/**
 * Reorder forecast — the part of F10 that "PARTIAL by productization depth" was describing.
 *
 * `listReorderVisibility` compared stock against `Product.minStock`, a fixed number a human typed.
 * That answers "is this below the line?" but not the two questions an owner actually asks:
 *
 *   1. "How long until it runs out?" — needs a demand rate, which needs sales history.
 *   2. "How many should I order?" — needs demand until the next delivery can arrive, which needs a
 *      lead time measured from real purchase orders rather than assumed.
 *
 * Two rules govern everything here, and both exist because the alternative is a plausible number
 * that nobody can defend:
 *
 *   - NO DATA IS AN ANSWER, NOT ZERO. A product with no sales history has no measurable demand
 *     rate. Reporting `0/day` would say "this never sells", which is false — it says we have not
 *     watched long enough. `confidence` and `basis` carry that distinction to the UI so an owner
 *     sees "belum ada riwayat" instead of an authoritative-looking number.
 *   - `minStock` still wins when it is higher. Forecasts inform; they do not overrule the owner who
 *     set a buffer by hand. The recommended quantity is raised to cover `minStock` if the forecast
 *     would have ordered less, and `drivers` says so.
 */

/** Days of sales history to measure demand over. */
const DEMAND_WINDOW_DAYS = 30;
/**
 * Below this many measured sale days, a daily rate is not a rate — it is one transaction. Fall back
 * to `minStock` alone rather than ordering for a demand figure derived from a single sale.
 */
const MIN_SAMPLES_FOR_RATE = 5;
/** Lead time when no purchase-order history exists yet. Stated as an assumption, never as a fact. */
const ASSUMED_LEAD_TIME_DAYS = 7;

export type DemandSample = { date: Date; baseQuantity: number };

export type ForecastInput = {
  minStock: number;
  available: number;
  projectedAvailable: number;
  inboundInTransit: number;
  demand: DemandSample[];
  observedLeadTimeDays: number | null;
  timeZone: string;
  now?: Date;
  packSize?: number | null;
  maxStock?: number | null;
};

export type ForecastResult = {
  /** Measured base units sold per day, or null when history is too thin to state one. */
  dailyDemand: number | null;
  /** Days until projected stock hits zero at the measured rate; null when unmeasurable. */
  daysOfCover: number | null;
  leadTimeDays: number;
  leadTimeIsAssumed: boolean;
  /** Base units to order: demand over lead time + minStock buffer, minus what is already coming. */
  recommendedQuantity: number;
  /** Base units rounded up to whole purchase packs — this is what a PO should actually order. */
  orderQuantity: number;
  /** Purchase pack size in base units, or null when the product is bought in base units. */
  packSize: number | null;
  /** How many packs that is. Null when there is no pack size. */
  recommendedPacks: number | null;
  /** Sorted most-decisive first, so the UI can show why without parsing prose. */
  drivers: string[];
  confidence: 'MEASURED' | 'THIN_HISTORY' | 'MIN_STOCK_ONLY';
  basis: string;
};

/**
 * Returns the pack count, or null when the product is not bought in packs.
 *
 * This used to return the ROUNDED-UP UNIT quantity while being called `recommendedPacks`, so a UI
 * showing it as "38 pak" would have ordered 456 base units instead of 38 — a 12x over-buy from a
 * naming mistake nobody could see, because the number looked plausible. The two values are now
 * separate: `packs` is how many to order, and the caller multiplies for units.
 */
function packCount(quantity: number, packSize: number | null): number | null {
  if (!packSize || packSize < 1) return null;
  return Math.ceil(quantity / packSize);
}

export function computeReorderForecast(input: ForecastInput): ForecastResult {
  const now = input.now ?? new Date();
  const windowStart = new Date(now.getTime() - DEMAND_WINDOW_DAYS * 86_400_000);
  const samples = input.demand.filter((row) => row.date >= windowStart && row.date <= now);
  const measuredDays = new Set(samples.map((row) => businessDateKey(row.date, input.timeZone))).size;

  const drivers: string[] = [];
  const canMeasure = samples.length > 0 && measuredDays >= MIN_SAMPLES_FOR_RATE;
  const totalBase = samples.reduce((sum, row) => sum + Math.max(0, row.baseQuantity), 0);
  const dailyDemand = canMeasure ? Number((totalBase / measuredDays).toFixed(2)) : null;

  const leadTimeDays = input.observedLeadTimeDays && input.observedLeadTimeDays > 0
    ? Math.round(input.observedLeadTimeDays)
    : ASSUMED_LEAD_TIME_DAYS;
  const leadTimeIsAssumed = !(input.observedLeadTimeDays && input.observedLeadTimeDays > 0);

  let confidence: ForecastResult['confidence'] = 'MIN_STOCK_ONLY';
  let basis: string;
  if (canMeasure) {
    confidence = measuredDays >= MIN_SAMPLES_FOR_RATE * 2 ? 'MEASURED' : 'THIN_HISTORY';
    basis = `${totalBase} unit dasar terjual dalam ${measuredDays} hari terakhir`;
    drivers.push(`${dailyDemand} unit dasar/hari dari ${measuredDays} hari penjualan`);
  } else {
    basis = samples.length === 0
      ? `belum ada penjualan dalam ${DEMAND_WINDOW_DAYS} hari terakhir — laju permintaan tidak dapat diukur`
      : `hanya ${measuredDays} hari penjualan dalam ${DEMAND_WINDOW_DAYS} — terlalu sedikit untuk mengukur laju`;
  }

  // Stock actually reachable before the next delivery lands.
  const stockAtArrival = input.projectedAvailable;
  const daysOfCover = dailyDemand && dailyDemand > 0 && stockAtArrival > 0
    ? Math.floor(stockAtArrival / dailyDemand)
    : dailyDemand && dailyDemand > 0 && stockAtArrival <= 0
      ? 0
      : null;

  if (dailyDemand !== null && daysOfCover !== null) {
    drivers.push(daysOfCover <= leadTimeDays
      ? `stok habis dalam ${daysOfCover} hari, lead time ${leadTimeDays} hari — akan kekurang`
      : `stok cukup ${daysOfCover} hari, lead time ${leadTimeDays} hari`);
  }
  if (leadTimeIsAssumed) {
    drivers.push(`lead time ${ASSUMED_LEAD_TIME_DAYS} hari diasumsikan — belum ada riwayat purchase order`);
  }
  if (input.inboundInTransit > 0) {
    drivers.push(`${input.inboundInTransit} unit sedang dalam perjalanan`);
  }

  // Target is the GREATER of "demand until the next delivery lands" and "the buffer the owner set".
  // Adding them together double-counts the buffer: a fast-selling product would then be ordered for
  // demand + buffer even though the buffer is already covered inside the demand figure, which is how
  // 50 units of minStock turned into an order for 61.
  const demandDuringLeadTime = dailyDemand !== null ? dailyDemand * leadTimeDays : 0;
  let target = Math.ceil(Math.max(demandDuringLeadTime, input.minStock));
  let quantity = Math.max(0, target - stockAtArrival);

  if (dailyDemand === null) {
    // No measurable demand: the only defensible recommendation is the owner's own buffer.
    target = input.minStock;
    quantity = Math.max(0, input.minStock - stockAtArrival);
    drivers.push(`rekomendasi memakai minStock ${input.minStock} saja — laju permintaan tidak terukur`);
  } else if (input.minStock > demandDuringLeadTime && input.minStock > stockAtArrival) {
    // Buffer, bukan forecast, yang mendorong pesanan ini. Owner yang menyetel 50 harus melihat 50,
    // bukan angka tak ter dijelaskan yang kebetulan mendekati itu.
    drivers.push(`minStock ${input.minStock} lebih besar dari kebutuhan lead time - buffer pemilik yang dipakai`);
  }

  if (input.maxStock && quantity + stockAtArrival > input.maxStock) {
    quantity = Math.max(0, input.maxStock - stockAtArrival);
    drivers.push(`dipotong maxStock ${input.maxStock} agar gudang tidak overstock`);
  }

  const packSize = input.packSize ?? null;
  const packs = packCount(quantity, packSize);

  return {
    dailyDemand,
    daysOfCover,
    leadTimeDays,
    leadTimeIsAssumed,
    recommendedQuantity: quantity,
    // What to order: whole packs, so the PO is buyable. Falls back to base units when unbought in packs.
    orderQuantity: packs !== null && packSize !== null ? packs * packSize : quantity,
    packSize,
    recommendedPacks: packs,
    drivers,
    confidence,
    basis,
  };
}
