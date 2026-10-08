import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionOrderStatus } from '@prisma/client';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { consumeAvailableLocationStock, depositLocationStock } from '../common/location-inventory';
import { nextDocumentNumber } from '../common/numbering';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteProductionOrderDto, CreateProductionOrderDto, CreateProductionRecipeDto } from './dto/manufacturing.dto';

type Scope = { companyId: string; branchId: string };
type RecipeCursor = { name: string; id: string };
type OrderCursor = { createdAt: string; id: string };

@Injectable()
export class ManufacturingService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingCoreService) {}

  private scope(user: AuthUser): Scope {
    if (!user.companyId || !user.branchId) throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Company dan branch aktif wajib tersedia.' });
    return { companyId: user.companyId, branchId: user.branchId };
  }

  async listRecipes(user: AuthUser, search?: string, limitValue?: string, cursorValue?: string) {
    const scope = this.scope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<RecipeCursor>(cursorValue);
    const filters: Prisma.ProductionRecipeWhereInput[] = [];
    if (search?.trim()) filters.push({ OR: [{ code: { contains: search.trim() } }, { name: { contains: search.trim() } }, { outputProduct: { name: { contains: search.trim() } } }] });
    if (cursor) filters.push({ OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }] });
    const rows = await this.prisma.productionRecipe.findMany({
      where: { companyId: scope.companyId, isActive: true, AND: filters.length ? filters : undefined },
      include: { outputProduct: true, items: { include: { componentProduct: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit + 1,
    });
    return toCursorPage(rows, limit, (row) => ({ name: row.name, id: row.id }));
  }

  async createRecipe(dto: CreateProductionRecipeDto, user: AuthUser) {
    const scope = this.scope(user);
    const code = dto.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('Kode resep wajib diisi.');
    const componentIds = [...new Set(dto.items.map((item) => item.componentProductId))];
    if (componentIds.length !== dto.items.length) throw new BadRequestException('Komponen resep tidak boleh duplikat.');
    if (componentIds.includes(dto.outputProductId)) throw new BadRequestException('Produk hasil tidak boleh menjadi bahan bakunya sendiri.');
    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { companyId: scope.companyId, id: { in: [dto.outputProductId, ...componentIds] }, isActive: true } });
      if (products.length !== componentIds.length + 1) throw new BadRequestException('Produk output atau komponen tidak ditemukan pada company aktif.');
      if (products.some((product) => product.productType !== 'PHYSICAL')) throw new BadRequestException('Resep produksi hanya dapat memakai produk PHYSICAL.');
      const latest = await tx.productionRecipe.findFirst({ where: { companyId: scope.companyId, code }, orderBy: { version: 'desc' } });
      if (latest) await tx.productionRecipe.updateMany({ where: { companyId: scope.companyId, code, isActive: true }, data: { isActive: false } });
      const recipe = await tx.productionRecipe.create({
        data: {
          companyId: scope.companyId, code, name: dto.name.trim(), outputProductId: dto.outputProductId,
          outputQtyPerBatch: dto.outputQtyPerBatch, version: (latest?.version ?? 0) + 1, notes: dto.notes?.trim() || null,
          items: { create: dto.items.map((item) => ({ componentProductId: item.componentProductId, quantityPerBatch: item.quantityPerBatch, wastePct: new Prisma.Decimal(item.wastePct ?? 0) })) },
        },
        include: { outputProduct: true, items: { include: { componentProduct: true } } },
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_PRODUCTION_RECIPE_VERSION', entityType: 'ProductionRecipe', entityId: recipe.id, payload: { branchId: scope.branchId, code, version: recipe.version } } });
      return recipe;
    });
  }

  async listOrders(user: AuthUser, status?: string, limitValue?: string, cursorValue?: string) {
    const scope = this.scope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<OrderCursor>(cursorValue);
    const normalizedStatus = status?.trim().toUpperCase();
    if (normalizedStatus && !Object.values(ProductionOrderStatus).includes(normalizedStatus as ProductionOrderStatus)) throw new BadRequestException('Status production order tidak valid.');
    const filters: Prisma.ProductionOrderWhereInput[] = [];
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      if (Number.isNaN(createdAt.getTime())) throw new BadRequestException('Cursor production order tidak valid.');
      filters.push({ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }] });
    }
    const rows = await this.prisma.productionOrder.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId, ...(normalizedStatus ? { status: normalizedStatus as ProductionOrderStatus } : {}), AND: filters.length ? filters : undefined },
      include: { recipe: { include: { outputProduct: true } }, warehouse: true, components: { include: { product: true } }, createdBy: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    return toCursorPage(rows, limit, (row) => ({ createdAt: row.createdAt.toISOString(), id: row.id }));
  }

  async createOrder(dto: CreateProductionOrderDto, user: AuthUser) {
    const scope = this.scope(user);
    return serializableTx(this.prisma, async (tx) => {
      const [recipe, warehouse] = await Promise.all([
        tx.productionRecipe.findFirst({ where: { id: dto.recipeId, companyId: scope.companyId, isActive: true }, include: { items: true } }),
        tx.warehouse.findFirst({ where: { id: dto.warehouseId, branchId: scope.branchId, branch: { companyId: scope.companyId }, isActive: true } }),
      ]);
      if (!recipe) throw new BadRequestException('Resep aktif tidak ditemukan pada company ini.');
      if (!warehouse) throw new BadRequestException('Gudang produksi tidak ditemukan pada branch aktif.');
      const number = await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PRODUCTION_ORDER', prefix: 'PROD' });
      const order = await tx.productionOrder.create({
        data: {
          companyId: scope.companyId, branchId: scope.branchId, warehouseId: warehouse.id, recipeId: recipe.id, createdById: user.sub,
          number, batchCount: dto.batchCount, plannedOutputQty: recipe.outputQtyPerBatch * dto.batchCount, notes: dto.notes?.trim() || null,
          components: { create: recipe.items.map((item) => ({ productId: item.componentProductId, plannedQty: Math.ceil(item.quantityPerBatch * dto.batchCount * (1 + Number(item.wastePct) / 100)) })) },
        },
        include: { recipe: { include: { outputProduct: true } }, warehouse: true, components: { include: { product: true } } },
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_PRODUCTION_ORDER', entityType: 'ProductionOrder', entityId: order.id, payload: { branchId: scope.branchId, number, recipeId: recipe.id, batchCount: dto.batchCount } } });
      return order;
    });
  }

  private async scopedOrder(id: string, user: AuthUser) {
    const scope = this.scope(user);
    const row = await this.prisma.productionOrder.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!row) throw new NotFoundException('Production order tidak ditemukan pada branch aktif.');
    return { scope, row };
  }

  async release(id: string, user: AuthUser) {
    const { scope, row } = await this.scopedOrder(id, user);
    if (row.status !== 'DRAFT') throw new BadRequestException('Hanya production order DRAFT yang dapat dirilis.');
    const updated = await this.prisma.productionOrder.update({ where: { id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RELEASE_PRODUCTION_ORDER', entityType: 'ProductionOrder', entityId: id, payload: { branchId: scope.branchId } } });
    return updated;
  }

  async start(id: string, user: AuthUser) {
    const { scope, row } = await this.scopedOrder(id, user);
    if (row.status !== 'RELEASED') throw new BadRequestException('Production order harus RELEASED sebelum dimulai.');
    const updated = await this.prisma.productionOrder.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'START_PRODUCTION_ORDER', entityType: 'ProductionOrder', entityId: id, payload: { branchId: scope.branchId } } });
    return updated;
  }

  async complete(id: string, dto: CompleteProductionOrderDto, user: AuthUser) {
    const scope = this.scope(user);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.productionOrder.findFirst({
        where: { id, companyId: scope.companyId, branchId: scope.branchId },
        include: { warehouse: { include: { branch: true } }, recipe: { include: { outputProduct: true } }, components: { include: { product: true } } },
      });
      if (!order) throw new NotFoundException('Production order tidak ditemukan pada branch aktif.');
      if (order.status !== 'IN_PROGRESS') throw new BadRequestException('Production order harus IN_PROGRESS sebelum diselesaikan.');
      const output = order.recipe.outputProduct;
      const tracked = [output, ...order.components.map((component) => component.product)].filter((product) => product.trackBatch || product.trackExpiry || product.trackSerial);
      if (tracked.length) throw new BadRequestException(`Produksi batch/expiry/serial belum boleh diposting tanpa traceability produksi: ${tracked.map((product) => product.sku).join(', ')}.`);
      const actualOutputQty = dto.actualOutputQty ?? order.plannedOutputQty;
      if (!Number.isInteger(actualOutputQty) || actualOutputQty <= 0) throw new BadRequestException('Actual output harus integer positif.');

      let totalCost = new Prisma.Decimal(0);
      for (const component of order.components) {
        const quantity = component.plannedQty;
        const inventory = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: component.productId } } });
        if (!inventory || inventory.available < quantity || inventory.quantity < quantity) throw new BadRequestException(`Stok bahan ${component.product.sku} tidak mencukupi untuk production order.`);
        const allocations = await consumeAvailableLocationStock(tx, { warehouseId: order.warehouseId, productId: component.productId, quantity });
        const changed = await tx.inventory.updateMany({ where: { id: inventory.id, quantity: { gte: quantity }, available: { gte: quantity } }, data: { quantity: { decrement: quantity }, available: { decrement: quantity } } });
        if (changed.count !== 1) throw new BadRequestException(`Saldo bahan ${component.product.sku} berubah saat posting produksi. Ulangi transaksi.`);
        const after = await tx.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
        for (const allocation of allocations) await tx.inventoryMovement.create({ data: { warehouseId: order.warehouseId, locationId: allocation.locationId, productId: component.productId, type: 'PRODUCTION_CONSUME', quantity: -allocation.quantity, balanceAfter: after.quantity, referenceType: 'ProductionOrder', referenceId: order.id, notes: `Consume ${order.number}` } });
        const unitCost = new Prisma.Decimal(component.product.costPrice);
        const componentCost = unitCost.mul(quantity);
        totalCost = totalCost.add(componentCost);
        await tx.productionOrderComponent.update({ where: { id: component.id }, data: { actualQty: quantity, unitCost, totalCost: componentCost } });
      }

      const outputInventoryBefore = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: output.id } } });
      const locationStock = await depositLocationStock(tx, { warehouseId: order.warehouseId, productId: output.id, quantity: actualOutputQty });
      const outputInventory = await tx.inventory.upsert({
        where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: output.id } },
        create: { warehouseId: order.warehouseId, productId: output.id, quantity: actualOutputQty, available: actualOutputQty },
        update: { quantity: { increment: actualOutputQty }, available: { increment: actualOutputQty } },
      });
      await tx.inventoryMovement.create({ data: { warehouseId: order.warehouseId, locationId: locationStock.locationId, productId: output.id, type: 'PRODUCTION_OUTPUT', quantity: actualOutputQty, balanceAfter: outputInventory.quantity, referenceType: 'ProductionOrder', referenceId: order.id, notes: `Output ${order.number}` } });

      const batchUnitCost = totalCost.div(actualOutputQty).toDecimalPlaces(4);
      const oldQty = outputInventoryBefore?.quantity ?? 0;
      const oldValue = new Prisma.Decimal(output.costPrice).mul(oldQty);
      const nextMovingAverageCost = oldValue.add(totalCost).div(oldQty + actualOutputQty).toDecimalPlaces(4);
      if (!new Prisma.Decimal(output.costPrice).equals(nextMovingAverageCost)) {
        await tx.product.update({ where: { id: output.id }, data: { costPrice: nextMovingAverageCost } });
        await tx.productPriceHistory.create({ data: { companyId: scope.companyId, productId: output.id, field: 'costPrice', oldValue: output.costPrice, newValue: nextMovingAverageCost, changedById: user.sub } });
      }

      const consumeEvent = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'PRODUCTION_CONSUME', sourceType: 'ProductionOrder', sourceId: order.id,
        idempotencyKey: `production-consume:${order.id}`, amounts: { inventory: totalCost }, accountCodes: { wip: '1303', inventory: '1301' },
        lines: order.components.map((component) => ({ itemType: 'Product', itemId: component.productId, description: component.product.name, quantity: component.plannedQty, unitAmount: component.product.costPrice, netAmount: new Prisma.Decimal(component.product.costPrice).mul(component.plannedQty), grossAmount: new Prisma.Decimal(component.product.costPrice).mul(component.plannedQty), dimensions: { warehouseId: order.warehouseId } })),
        context: { productionOrderNumber: order.number, phase: 'CONSUME' },
      });
      const outputEvent = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'PRODUCTION_COMPLETE', sourceType: 'ProductionOrder', sourceId: order.id,
        idempotencyKey: `production-complete:${order.id}`, amounts: { inventory: totalCost }, accountCodes: { inventory: '1301', wip: '1303' },
        lines: [{ itemType: 'Product', itemId: output.id, description: output.name, quantity: actualOutputQty, unitAmount: batchUnitCost, netAmount: totalCost, grossAmount: totalCost, dimensions: { warehouseId: order.warehouseId } }],
        context: { productionOrderNumber: order.number, phase: 'OUTPUT', consumeAccountingEventId: consumeEvent.id },
      });
      const completed = await tx.productionOrder.update({ where: { id: order.id }, data: { status: 'COMPLETED', actualOutputQty, totalCost, completedAt: new Date(), notes: dto.notes?.trim() || order.notes } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'manufacturing.production.completed', aggregateType: 'ProductionOrder', aggregateId: order.id, payload: { companyId: scope.companyId, branchId: scope.branchId, productionOrderId: order.id, number: order.number, outputProductId: output.id, actualOutputQty, totalCost: totalCost.toString(), accountingEventIds: [consumeEvent.id, outputEvent.id] } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'COMPLETE_PRODUCTION_ORDER', entityType: 'ProductionOrder', entityId: order.id, payload: { branchId: scope.branchId, actualOutputQty, totalCost: totalCost.toString(), batchUnitCost: batchUnitCost.toString(), nextMovingAverageCost: nextMovingAverageCost.toString() } } });
      return completed;
    });
  }

  async cancel(id: string, reason: string, user: AuthUser) {
    const { scope, row } = await this.scopedOrder(id, user);
    if (!reason.trim()) throw new BadRequestException('Alasan pembatalan wajib diisi.');
    if (!['DRAFT', 'RELEASED'].includes(row.status)) throw new BadRequestException('Hanya production order DRAFT/RELEASED yang dapat dibatalkan tanpa reversal stok.');
    const updated = await this.prisma.productionOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), notes: reason.trim() } });
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CANCEL_PRODUCTION_ORDER', entityType: 'ProductionOrder', entityId: id, payload: { branchId: scope.branchId, reason: reason.trim() } } });
    return updated;
  }
}
