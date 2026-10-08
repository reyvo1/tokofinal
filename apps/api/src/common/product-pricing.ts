import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DbClient = Prisma.TransactionClient | PrismaService;

type ProductForPrice = {
  id: string;
  salePrice: Prisma.Decimal | number | string;
};

type ResolvePriceInput = {
  companyId: string;
  branchId: string;
  product: ProductForPrice;
  quantity: number;
  segmentCode?: string | null;
  unitCode?: string | null;
  unitFactor?: number;
  variantId?: string | null;
  variantSalePrice?: Prisma.Decimal | number | string | null;
  occurredAt?: Date;
};

/**
 * Resolves the authoritative selling price for a product.
 * Priority: branch+segment -> company+segment -> branch+RETAIL -> company+RETAIL,
 * then the largest minQty that is <= requested quantity. Falls back to Product.salePrice.
 */
export async function resolveProductUnitPrice(client: DbClient, input: ResolvePriceInput): Promise<Prisma.Decimal> {
  const at = input.occurredAt ?? new Date();
  const segment = (input.segmentCode?.trim() || 'RETAIL').toUpperCase();
  const unit = input.unitCode?.trim().toUpperCase() || null;
  const unitCandidates = unit ? [...new Set([unit, unit.toLowerCase(), input.unitCode?.trim()].filter((value): value is string => Boolean(value)))] : [];
  const rows = await client.productPrice.findMany({
    where: {
      productId: input.product.id,
      isActive: true,
      minQty: { lte: new Prisma.Decimal(input.quantity) },
      segmentCode: segment === 'RETAIL' ? 'RETAIL' : { in: [segment, 'RETAIL'] },
      AND: [
        ...(input.variantId ? [{ OR: [{ variantId: input.variantId }, { variantId: null }] }] : [{ variantId: null }]),
        { OR: [{ branchId: input.branchId }, { branchId: null }] },
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
        ...(unit ? [{ OR: [{ unitCode: { in: unitCandidates } }, { unitCode: null }] }] : []),
      ],
      product: { companyId: input.companyId },
    },
    select: { variantId: true, branchId: true, segmentCode: true, unitCode: true, minQty: true, price: true, createdAt: true },
    take: 100,
  });
  rows.sort((a, b) => {
    const variantScore = Number(Boolean(input.variantId && b.variantId === input.variantId)) - Number(Boolean(input.variantId && a.variantId === input.variantId));
    if (variantScore) return variantScore;
    const branchScore = Number(b.branchId === input.branchId) - Number(a.branchId === input.branchId);
    if (branchScore) return branchScore;
    const segmentScore = Number(b.segmentCode === segment) - Number(a.segmentCode === segment);
    if (segmentScore) return segmentScore;
    const unitScore = Number(Boolean(unit && b.unitCode?.toUpperCase() === unit)) - Number(Boolean(unit && a.unitCode?.toUpperCase() === unit));
    if (unitScore) return unitScore;
    const qtyScore = new Prisma.Decimal(b.minQty).cmp(new Prisma.Decimal(a.minQty));
    if (qtyScore) return qtyScore;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  if (rows[0]?.price) {
    const selected = new Prisma.Decimal(rows[0].price);
    const factor = Number(input.unitFactor ?? 1);
    if (!rows[0].unitCode && unit && Number.isSafeInteger(factor) && factor > 1) return selected.mul(factor);
    return selected;
  }
  return new Prisma.Decimal(input.variantSalePrice ?? input.product.salePrice);
}
