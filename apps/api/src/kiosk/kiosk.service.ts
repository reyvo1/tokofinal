import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { resolveProductUnitPrice } from '../common/product-pricing';
import { PrismaService } from '../prisma/prisma.service';

/**
 * POST-1D — the LAN barcode price checker.
 *
 * This is a *reader*, and that is the whole design. It owns no price, no discount and no stock rule:
 * the selling price comes from `resolveProductUnitPrice`, the same function the cart and the till use,
 * so a price on the screen is the price the customer will be charged. A second price path here would
 * be the single most expensive thing this file could contain — it would look right, pass review, and
 * quietly disagree with the till.
 *
 * The surface is deliberately narrow in three directions:
 *   - device only: a human session is refused, because "device-scoped" is the control that keeps a
 *     stolen kiosk from becoming a general read token;
 *   - read only: there is no write path in this module to reach, so there is nothing to escalate into;
 *   - customer-safe: no cost price, no margin, no other tenant's catalogue, and no stock figure unless
 *     the product has explicitly opted in.
 */
@Injectable()
export class KioskService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(user: AuthUser, rawCode: string) {
    // A kiosk is a device, not a person. Refusing a JWT keeps the endpoint from becoming a price-lookup
    // shortcut for staff, and it means the only credential that works is the one an operator attached
    // to a physical thing in a specific branch.
    if (user.authType !== 'API_KEY' || !user.branchId || !user.companyId) {
      throw new ForbiddenException('Endpoint ini hanya untuk perangkat kios.');
    }

    const code = (rawCode ?? '').trim();
    if (!code) throw new NotFoundException('Produk tidak ditemukan.');

    // Company-scoped on the same read as the price, so a cross-tenant barcode is not even a
    // distinguishable 404 — it is indistinguishable from a barcode that does not exist.
    const product = await this.prisma.product.findFirst({
      where: {
        companyId: user.companyId,
        isActive: true,
        OR: [{ barcode: code }, { sku: code }],
      },
      select: {
        id: true, name: true, sku: true, barcode: true, unit: true, salePrice: true,
        allowCustomerStockVisibility: true,
      },
    });
    // One message for "no such product" and "not your product". Distinguishing them would turn this
    // endpoint into a catalogue oracle for other companies' barcodes, which is the only thing the
    // company-scoped lookup above is protecting.
    if (!product) throw new NotFoundException('Produk tidak ditemukan.');

    // Canonical. The kiosk does not know the branch→company→segment→minQty priority order, and must
    // not grow its own copy of it.
    const price = await resolveProductUnitPrice(this.prisma, {
      companyId: user.companyId,
      branchId: user.branchId,
      product,
      quantity: 1,
      segmentCode: 'RETAIL',
    });

    const promotion = await this.activePromotion(user.companyId, user.branchId, product.id);
    const availability = await this.availability(user.branchId, product.id, product.allowCustomerStockVisibility);

    return {
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? code,
      unit: product.unit,
      price: price.toString(),
      // A name and a code, never a computed discount. `resolveSalePromotion` is the sale engine's
      // path and it needs a customer, a subtotal and a quota check; a kiosk has none of those. Showing
      // a discount this screen invented would put a number on the wall that the till then refuses.
      promotion: promotion ? { name: promotion.name, code: promotion.code } : null,
      availability,
    };
  }

  private async activePromotion(companyId: string, branchId: string, productId: string) {
    const at = new Date();
    const rules = await this.prisma.promoRule.findMany({
      where: {
        companyId,
        branchId,
        isActive: true,
        startsAt: { lte: at },
        OR: [{ endsAt: null }, { endsAt: { gte: at } }],
        AND: [{ OR: [{ channel: 'ALL' }, { channel: 'KIOSK' }] }],
      },
      select: { id: true, name: true, code: true, productIds: true, minQuantity: true },
      take: 100,
    });
    // A rule scoped to a product list is a claim about specific products; one with no list is branch-wide.
    const inScope = (rule: { productIds: unknown }) => {
      if (!Array.isArray(rule.productIds) || !rule.productIds.length) return true;
      return rule.productIds.some((value) => String(value) === productId);
    };
    // minQuantity is a basket rule. A single scanned item does not meet it, so listing the promo here
    // would advertise something the customer cannot actually use at this screen.
    return rules.find((rule) => inScope(rule) && !rule.minQuantity) ?? null;
  }

  private async availability(branchId: string, productId: string, allowed: boolean) {
    if (!allowed) return null;
    // A message, never a count. A precise "3 left" on a customer screen starts an argument the chain
    // cannot settle — the shelf, the back room and other customers' baskets are all different numbers.
    const warehouse = await this.prisma.warehouse.findFirst({ where: { branchId, isActive: true }, select: { id: true } });
    if (!warehouse) return { message: 'Stok tidak dapat diperiksa di cabang ini.' };
    const row = await this.prisma.inventory.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId } },
      select: { available: true },
    });
    return { message: (row?.available ?? 0) > 0 ? 'Tersedia' : 'Stok habis' };
  }
}
