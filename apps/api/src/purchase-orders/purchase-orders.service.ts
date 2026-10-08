import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException('Pengguna belum memiliki company dan branch yang valid.');
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(user: AuthUser, scope: TenantScope, entityType: string, entityId?: string): Promise<never> {
    await this.prisma.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'TENANT_ACCESS_DENIED',
        entityType,
        entityId,
        payload: { authenticatedBranchId: scope.branchId },
      },
    });
    throw new ForbiddenException(`${entityType} tidak tersedia dalam company dan branch pengguna.`);
  }

  async list(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ createdAt: string; id: string }>(cursorValue);
    const cursorFilter: Prisma.PurchaseOrderWhereInput | undefined = cursor ? {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ],
    } : undefined;
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
        AND: cursorFilter ? [cursorFilter] : undefined,
      },
      include: { supplier: true, warehouse: true, items: { include: { product: true } }, goodsReceipts: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  async findOne(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const row = await this.prisma.purchaseOrder.findFirst({
      where: {
        id,
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
      },
      include: { supplier: true, warehouse: true, items: { include: { product: true } }, goodsReceipts: { include: { items: true } } },
    });
    if (!row) return this.denyTenantAccess(user, scope, 'PurchaseOrder', id);
    return row;
  }

  async create(dto: CreatePurchaseOrderDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.items.length) throw new BadRequestException('Purchase order harus memiliki minimal satu barang.');

    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: dto.warehouseId,
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
      },
      select: { id: true },
    });
    if (!warehouse) return this.denyTenantAccess(user, scope, 'Warehouse', dto.warehouseId);

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, companyId: scope.companyId, isActive: true },
      select: { id: true },
    });
    if (!supplier) {
      const supplierExists = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId }, select: { id: true } });
      if (supplierExists) return this.denyTenantAccess(user, scope, 'Supplier', dto.supplierId);
      throw new BadRequestException('Supplier tidak ditemukan.');
    }

    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId: scope.companyId, isActive: true },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      const accepted = new Set(products.map((product) => product.id));
      const missingIds = productIds.filter((id) => !accepted.has(id));
      const crossTenant = await this.prisma.product.findFirst({ where: { id: { in: missingIds } }, select: { id: true } });
      if (crossTenant) return this.denyTenantAccess(user, scope, 'Product', crossTenant.id);
      throw new BadRequestException('Satu atau lebih produk tidak ditemukan.');
    }

    const preparedItems: Array<{
      productId: string; variantId: string | null; productUnitId: string | null; unitCode: string | null;
      unitQuantity: number; quantityFactor: number; orderedQty: number; unitCost: Prisma.Decimal;
      purchaseUnitCost: Prisma.Decimal; subtotal: Prisma.Decimal;
    }> = [];
    for (const item of dto.items) {
      let variantId = item.variantId?.trim() || null;
      let productUnitId: string | null = null;
      let unitCode: string | null = null;
      let quantityFactor = 1;
      if (item.productUnitId?.trim()) {
        const unit = await this.prisma.productUnit.findFirst({
          where: { id: item.productUnitId.trim(), productId: item.productId, isActive: true, product: { companyId: scope.companyId } },
          select: { id: true, variantId: true, unitCode: true, quantityFactor: true, variant: { select: { isActive: true } } },
        });
        if (!unit) throw new BadRequestException('ProductUnit pembelian tidak valid/aktif untuk produk yang dipilih.');
        if (variantId && unit.variantId !== variantId) throw new BadRequestException('Variant pembelian tidak cocok dengan ProductUnit.');
        if (unit.variantId && !unit.variant?.isActive) throw new BadRequestException('Variant pembelian sudah tidak aktif.');
        productUnitId = unit.id;
        variantId = unit.variantId ?? variantId;
        unitCode = unit.unitCode.trim().toUpperCase();
        quantityFactor = Number(unit.quantityFactor);
      } else if (variantId) {
        const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId: item.productId, isActive: true }, select: { id: true } });
        if (!variant) throw new BadRequestException('Variant pembelian tidak valid/aktif.');
      }
      if (!Number.isSafeInteger(quantityFactor) || quantityFactor < 1) throw new BadRequestException('Konversi UOM pembelian tidak aman.');
      const baseQuantity = item.orderedQty * quantityFactor;
      if (!Number.isSafeInteger(baseQuantity) || baseQuantity < 1) throw new BadRequestException('Hasil konversi quantity pembelian tidak aman.');
      const purchaseUnitCost = new Prisma.Decimal(item.unitCost);
      const baseUnitCost = purchaseUnitCost.div(quantityFactor).toDecimalPlaces(6);
      preparedItems.push({
        productId: item.productId, variantId, productUnitId, unitCode, unitQuantity: item.orderedQty,
        quantityFactor, orderedQty: baseQuantity, unitCost: baseUnitCost, purchaseUnitCost,
        subtotal: purchaseUnitCost.mul(item.orderedQty),
      });
    }
    const subtotal = preparedItems.reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0));
    const scopeKey = dto.idempotencyKey ? 'purchase-order:create' : null;
    const result = await serializableTx(this.prisma, async (tx) => {
      if (scopeKey) {
        const gate = await beginIdempotent(tx, { companyId: scope.companyId, scope: scopeKey, key: dto.idempotencyKey!, payload: dto });
        if (gate.replay && gate.status === 'COMPLETED') return gate.response as never;
      }
      const order = await tx.purchaseOrder.create({
        data: {
          number: await nextDocumentNumber(tx, { companyId: user.companyId!, branchId: user.branchId!, documentType: 'PURCHASE_ORDER', prefix: 'PO' }), supplierId: dto.supplierId, warehouseId: warehouse.id,
          status: 'APPROVED', expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          subtotal, total: subtotal, notes: dto.notes,
          items: { create: preparedItems.map((item) => ({
            productId: item.productId, variantId: item.variantId, productUnitId: item.productUnitId,
            unitCode: item.unitCode, unitQuantity: item.unitQuantity, quantityFactor: item.quantityFactor,
            orderedQty: item.orderedQty, unitCost: item.unitCost, purchaseUnitCost: item.purchaseUnitCost, subtotal: item.subtotal,
          })) },
        },
        include: { supplier: true, warehouse: true, items: { include: { product: true } } },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_PURCHASE_ORDER',
          entityType: 'PurchaseOrder',
          entityId: order.id,
          payload: dto as unknown as Prisma.InputJsonValue,
        },
      });
      if (scopeKey) await completeIdempotent(tx, { companyId: scope.companyId, scope: scopeKey, key: dto.idempotencyKey!, resourceType: 'PurchaseOrder', resourceId: order.id, response: order });
      return order;
    });
    return result;
  }
}
