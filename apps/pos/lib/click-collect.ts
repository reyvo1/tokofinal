/**
 * Click & Collect from the POS: pay at one branch, collect at another.
 *
 * What already existed: `Order.fulfillmentType = 'PICKUP'` and `Order.pickupWarehouseId`, fully
 * implemented in the storefront and visible in the Admin order list. What did not exist is the
 * cashier's side — a customer standing at Branch A asking whether Branch B has the item, and paying
 * at A to collect at B. Without this the cashier can only say "try the website", which loses the sale
 * to a shop two doors down.
 *
 * The important constraint, and the reason this is not a thin wrapper: paying at A and collecting at
 * B means the STOCK MUST NOT MOVE at A. A POS sale posts an inventory movement and decrements the
 * warehouse it is sold from. Creating a POS sale for stock that is physically at B would make the
 * branch books wrong in both directions — A's inventory short a unit it still holds, and B's short
 * nothing while being unable to fulfil.
 *
 * So this deliberately routes through the ORDER pipeline (`POST /orders` with
 * `fulfillmentType: 'PICKUP'`), which reserves without selling, and never through `/sales`. The
 * reservation is what makes collection possible; the sale is not.
 */

export type CrossBranchStock = {
  branchId: string;
  branchCode: string;
  branchName: string;
  warehouseId: string | null;
  available: number;
  /** True for the branch the cashier is sitting in. */
  isCurrent: boolean;
};

export type PickupQuote = {
  orderNumber: string;
  pickupBranchCode: string;
  pickupWarehouseId: string | null;
  total: number;
  shippingCost: number;
  status: string;
  /** The token the collecting branch will scan. Never render it to the customer. */
  pickupCode: string;
};

export type ClickCollectApi = {
  /** Where is this product, across the estate? */
  stock: (token: string, productId: string) => Promise<CrossBranchStock[]>;
  /** Reserve at the pickup branch and produce a collection voucher. */
  reserve: (token: string, input: {
    pickupBranchCode: string;
    customerName: string;
    customerPhone?: string;
    items: Array<{ productId: string; quantity: number }>;
  }) => Promise<PickupQuote>;
};

export type BranchStockVerdict = {
  canCollect: boolean;
  /** Branches that actually have stock, best first, excluding the current one. */
  alternatives: CrossBranchStock[];
  reason: string;
};

/**
 * Decide where this basket can be collected.
 *
 * Refuses rather than falling back to the current branch: silently collecting at the branch the
 * customer is already standing in turns a click-and-collect promise into "no", after they have
 * already been told yes.
 */
export function planPickup(stock: CrossBranchStock[], requestedQuantity: number): BranchStockVerdict {
  if (requestedQuantity <= 0) {
    return { canCollect: false, alternatives: [], reason: 'Jumlah pesanan harus lebih dari nol.' };
  }
  const elsewhere = stock
    .filter((row) => !row.isCurrent && row.available >= requestedQuantity)
    .sort((a, b) => b.available - a.available || a.branchName.localeCompare(b.branchName, 'id-ID'));
  if (!elsewhere.length) {
    const anyElsewhere = stock.some((row) => !row.isCurrent && row.available > 0);
    return {
      canCollect: false,
      alternatives: [],
      reason: anyElsewhere
        ? 'Stok di cabang lain tidak cukup untuk jumlah ini.'
        : 'Tidak ada cabang lain yang punya stok barang ini.',
    };
  }
  return {
    canCollect: true,
    alternatives: elsewhere,
    reason: `Bisa diambil di ${elsewhere.length} cabang lain.`,
  };
}

/**
 * Render the collection voucher the customer carries to the pickup branch.
 *
 * Kept as a function rather than inline JSX so the exact wording is testable: the pickup code is the
 * only thing staff at Branch B can act on, so a truncated or empty code makes the whole trip wasted.
 */
export function pickupVoucherLines(quote: PickupQuote, paidAtBranchName: string): string[] {
  const total = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
    .format(Number(quote.total));
  return [
    'VOUCHER AMBIL DI CABANG LAIN',
    '--------------------------------',
    `No. pesanan : ${quote.orderNumber}`,
    `Kode ambil : ${quote.pickupCode}`,
    `Ambil di  : ${quote.pickupBranchCode}`,
    `Dibayar di : ${paidAtBranchName}`,
    `Total      : ${total}`,
    ...(Number(quote.shippingCost) > 0 ? [`Ongkir    : ${quote.shippingCost}`] : []),
    '--------------------------------',
    'Tunjukkan kode ini di kasir cabang pengambil.',
    'Barang tidak direserve di cabang pembayaran.',
  ];
}
