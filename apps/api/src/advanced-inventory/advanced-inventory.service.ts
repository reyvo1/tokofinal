import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { computeReorderForecast } from './reorder-forecast';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { adjustLocationStock, consumeAvailableLocationStock, depositLocationStock, prepareConditionInventory, prepareLocationInventory, relocateLocationStock } from '../common/location-inventory';
import { CountStockOpnameDto, CreateStockOpnameDto, CreateStockTransferDto, MoveInventoryConditionDto, ReceiveStockTransferDto, RelocateInventoryDto } from './dto/advanced-inventory.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
type WarehouseRow = { id: string; branchId: string; branch: { companyId: string } };

@Injectable()
export class AdvancedInventoryService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingCoreService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Pengguna belum memiliki company dan branch yang valid.' });
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    entityType: string,
    entityId?: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<never> {
    await client.auditLog.create({ data: {
      companyId: scope.companyId, userId: user.sub, action: 'TENANT_ACCESS_DENIED', entityType, entityId,
      payload: payload ?? { authenticatedCompanyId: scope.companyId, authenticatedBranchId: scope.branchId },
    } });
    throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED', message: `${entityType} tidak tersedia dalam company dan branch pengguna.` });
  }

  private async companyWarehouseIds(client: DbClient, scope: TenantScope) {
    const rows = await client.warehouse.findMany({ where: { branch: { companyId: scope.companyId } }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  private async branchWarehouseIds(client: DbClient, scope: TenantScope) {
    const rows = await client.warehouse.findMany({ where: { branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  private async warehouse(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    id: string,
    mode: 'branch' | 'company',
    requireActive = false,
  ): Promise<WarehouseRow> {
    const row = await client.warehouse.findFirst({
      where: { id, ...(mode === 'branch' ? { branchId: scope.branchId } : {}), branch: { companyId: scope.companyId }, ...(requireActive ? { isActive: true } : {}) },
      select: { id: true, branchId: true, branch: { select: { companyId: true } } },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Warehouse', id);
    return row;
  }

  private async transfer(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    id: string,
    side: 'source' | 'destination',
  ) {
    const row = await client.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'StockTransfer', id);
    const source = await this.warehouse(client, user, scope, row.sourceWarehouseId, side === 'source' ? 'branch' : 'company');
    const destination = await this.warehouse(client, user, scope, row.destinationWarehouseId, side === 'destination' ? 'branch' : 'company');
    return { row, source, destination };
  }

  private async opname(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.stockOpname.findUnique({ where: { id }, include: { items: true } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'StockOpname', id);
    const warehouse = await this.warehouse(client, user, scope, row.warehouseId, 'branch');
    return { row, warehouse };
  }

  async listTransfers(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const branchWarehouseIds = await this.branchWarehouseIds(this.prisma, scope);
    const companyWarehouseIds = await this.companyWarehouseIds(this.prisma, scope);
    return this.prisma.stockTransfer.findMany({
      where: {
        sourceWarehouseId: { in: companyWarehouseIds }, destinationWarehouseId: { in: companyWarehouseIds },
        OR: [{ sourceWarehouseId: { in: branchWarehouseIds } }, { destinationWarehouseId: { in: branchWarehouseIds } }],
      },
      include: { items: true }, orderBy: { createdAt: 'desc' }, take: 500,
    });
  }

  async listTransitBalances(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const branchWarehouseIds = await this.branchWarehouseIds(this.prisma, scope);
    const companyWarehouseIds = await this.companyWarehouseIds(this.prisma, scope);
    const transfers = await this.prisma.stockTransfer.findMany({
      where: {
        status: { in: ['SHIPPED','PARTIALLY_RECEIVED'] },
        sourceWarehouseId: { in: companyWarehouseIds },
        destinationWarehouseId: { in: companyWarehouseIds },
        OR: [{ sourceWarehouseId: { in: branchWarehouseIds } }, { destinationWarehouseId: { in: branchWarehouseIds } }],
      },
      include: { items: true }, orderBy: { shippedAt: 'asc' }, take: 500,
    });
    return transfers.flatMap((transfer) => transfer.items.map((item) => {
      const quantity = Math.max(0, item.shippedQty - item.receivedQty);
      const serialNumbers = Array.isArray(item.serialNumbers) ? item.serialNumbers.filter((value): value is string => typeof value === 'string') : [];
      return { transferId: transfer.id, number: transfer.number, sourceWarehouseId: transfer.sourceWarehouseId, destinationWarehouseId: transfer.destinationWarehouseId, productId: item.productId, condition: 'IN_TRANSIT' as const, quantity, batchNumber: item.batchNumber, serialCount: serialNumbers.length, shippedAt: transfer.shippedAt };
    })).filter((row) => row.quantity > 0);
  }

  async listReorderVisibility(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const warehouseIds = await this.branchWarehouseIds(this.prisma, scope);
    const [inventories, transit, company] = await Promise.all([
      this.prisma.inventory.findMany({ where: { warehouseId: { in: warehouseIds } }, include: { warehouse: { select: { id: true, code: true, name: true } }, product: { select: { id: true, sku: true, name: true, minStock: true, isActive: true } } }, orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }], take: 5000 }),
      this.listTransitBalances(user),
      this.prisma.company.findUnique({ where: { id: scope.companyId }, select: { timezone: true } }),
    ]);
    if (!company) throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Company pengguna tidak ditemukan.' });
    // Demand history and observed lead time, gathered ONCE for the whole page rather than per row.
    // The previous version of this method answered only "below minStock?"; an owner then has to
    // guess how long the stock lasts and how much to order. These two queries are what let the
    // response state both with evidence instead of leaving them to be guessed.
    const productIds = [...new Set(inventories.map((row) => row.productId))];
    const windowStart = new Date(Date.now() - 30 * 86_400_000);
    const [sales, purchaseOrders] = await Promise.all([
      // `Sale` has no companyId and no occurredAt; tenant is reached through branchId, and the
      // sale timestamp is createdAt. Both were guesses that did not typecheck before being caught.
      this.prisma.saleItem.findMany({
        where: {
          productId: { in: productIds },
          sale: { branchId: scope.branchId, createdAt: { gte: windowStart } },
        },
        select: { productId: true, quantity: true, sale: { select: { createdAt: true } } },
      }),
      this.prisma.purchaseOrder.findMany({
        where: { warehouseId: { in: warehouseIds }, status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] } },
        select: { orderDate: true, expectedDate: true },
      }),
    ]);
    const demandByProduct = new Map<string, Array<{ date: Date; baseQuantity: number }>>();
    for (const row of sales) {
      const bucket = demandByProduct.get(row.productId) ?? [];
      // `SaleItem.quantity` is BASE quantity, so mixed pack sizes are already comparable here.
      bucket.push({ date: row.sale.createdAt, baseQuantity: row.quantity });
      demandByProduct.set(row.productId, bucket);
    }
    const leadTimeSamples = purchaseOrders
      .map((row) => (row.expectedDate ? (row.expectedDate.getTime() - row.orderDate.getTime()) / 86_400_000 : null))
      .filter((value): value is number => value !== null && value > 0);
    const observedLeadTimeDays = leadTimeSamples.length
      ? leadTimeSamples.reduce((sum, value) => sum + value, 0) / leadTimeSamples.length
      : null;

    // Purchase packs: the product's default purchase unit, so a recommendation comes back in the
    // unit the owner actually orders in rather than in base units.
    const defaultPurchaseUnits = await this.prisma.productUnit.findMany({
      where: { productId: { in: productIds }, isDefaultPurchase: true },
      select: { productId: true, quantityFactor: true },
    });
    const packSizeByProduct = new Map(defaultPurchaseUnits.map((row) => [row.productId, row.quantityFactor]));

    return inventories.filter((row) => row.product.isActive && row.product.minStock > 0).map((row) => {
      const inboundInTransit = transit.filter((item) => item.destinationWarehouseId === row.warehouseId && item.productId === row.productId).reduce((sum, item) => sum + item.quantity, 0);
      const outboundInTransit = transit.filter((item) => item.sourceWarehouseId === row.warehouseId && item.productId === row.productId).reduce((sum, item) => sum + item.quantity, 0);
      const projectedAvailable = row.available + inboundInTransit;
      const forecast = computeReorderForecast({
        minStock: row.product.minStock,
        available: row.available,
        projectedAvailable,
        inboundInTransit,
        demand: demandByProduct.get(row.productId) ?? [],
        observedLeadTimeDays,
        timeZone: company.timezone,
        packSize: packSizeByProduct.get(row.productId) ?? null,
      });
      return { warehouseId: row.warehouseId, warehouse: row.warehouse, productId: row.productId, product: row.product, available: row.available, minStock: row.product.minStock, inboundInTransit, outboundInTransit, projectedAvailable, shortage: Math.max(0, row.product.minStock - projectedAvailable), lowStock: row.available <= row.product.minStock, forecast };
    }).filter((row) => row.lowStock || row.inboundInTransit > 0 || row.forecast.recommendedQuantity > 0)
      .sort((a, b) => b.forecast.recommendedQuantity - a.forecast.recommendedQuantity || a.product.sku.localeCompare(b.product.sku));
  }

  async createTransfer(dto: CreateStockTransferDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) throw new BadRequestException('Gudang asal dan tujuan harus berbeda.');
    if (!dto.items.length) throw new BadRequestException('Transfer harus memiliki barang.');
    const source = await this.warehouse(this.prisma, user, scope, dto.sourceWarehouseId, 'branch', true);
    const destination = await this.warehouse(this.prisma, user, scope, dto.destinationWarehouseId, 'company', true);
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId: scope.companyId, isActive: true },
      select: { id: true, name: true, trackBatch: true, trackExpiry: true, trackSerial: true },
    });
    if (products.length !== productIds.length) {
      const accepted = new Set(products.map((product) => product.id));
      const missingIds = productIds.filter((id) => !accepted.has(id));
      const crossTenant = await this.prisma.product.findFirst({ where: { id: { in: missingIds } }, select: { id: true } });
      if (crossTenant) return this.denyTenantAccess(this.prisma, user, scope, 'Product', crossTenant.id);
      throw new BadRequestException('Satu atau lebih produk tidak ditemukan.');
    }
    const productMap = new Map(products.map((product) => [product.id, product]));
    for (const item of dto.items) {
      const product = productMap.get(item.productId)!;
      const batchNumber = item.batchNumber?.trim() || undefined;
      const serialNumbers = (item.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean);
      if (product.trackBatch && !batchNumber) throw new BadRequestException(`Batch wajib untuk transfer produk ${product.name}.`);
      if (!product.trackBatch && batchNumber) throw new BadRequestException(`Produk ${product.name} tidak memakai batch.`);
      if (product.trackSerial && serialNumbers.length !== item.quantity) throw new BadRequestException(`Jumlah serial transfer ${product.name} harus sama dengan quantity (${item.quantity}).`);
      if (!product.trackSerial && serialNumbers.length) throw new BadRequestException(`Produk ${product.name} tidak memakai serial.`);
      if (new Set(serialNumbers).size !== serialNumbers.length) throw new BadRequestException(`Serial transfer ${product.name} tidak boleh duplikat.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.stockTransfer.create({ data: {
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'STOCK_TRANSFER', prefix: 'TRF' }), sourceWarehouseId: source.id, destinationWarehouseId: destination.id, requestedById: user.sub,
        status: 'REQUESTED', requestedAt: new Date(), notes: dto.notes,
        items: { create: dto.items.map((item) => ({ productId: item.productId, quantity: item.quantity, batchNumber: item.batchNumber?.trim() || undefined, serialNumbers: (item.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean) })) },
      }, include: { items: true } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_STOCK_TRANSFER', entityType: 'StockTransfer', entityId: row.id, payload: { branchId: scope.branchId, sourceWarehouseId: source.id, destinationWarehouseId: destination.id, destinationBranchId: destination.branchId } } });
      return row;
    });
  }

  async approveTransfer(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const { row: transfer } = await this.transfer(this.prisma, user, scope, id, 'source');
    if (!['DRAFT','REQUESTED'].includes(transfer.status)) throw new BadRequestException(`Transfer berstatus ${transfer.status}.`);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.stockTransfer.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date() }, include: { items: true } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'APPROVE_STOCK_TRANSFER', entityType: 'StockTransfer', entityId: id, payload: { branchId: scope.branchId } } });
      return row;
    });
  }

  async shipTransfer(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const { row: transfer, source, destination } = await this.transfer(tx, user, scope, id, 'source');
      if (transfer.status !== 'APPROVED') throw new BadRequestException('Transfer harus disetujui sebelum dikirim.');
      for (const item of transfer.items) {
        const inventory = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: source.id, productId: item.productId } } });
        if (!inventory || inventory.available < item.quantity) throw new BadRequestException(`Stok produk ${item.productId} tidak mencukupi.`);
        if (item.batchNumber) {
          const batch = await tx.inventoryBatch.findUnique({ where: { warehouseId_productId_batchNumber: { warehouseId: source.id, productId: item.productId, batchNumber: item.batchNumber } } });
          if (!batch || batch.quantity - batch.reserved < item.quantity) throw new BadRequestException(`Stok batch ${item.batchNumber} tidak mencukupi untuk transfer.`);
          if (batch.expiryDate && batch.expiryDate <= new Date()) throw new BadRequestException(`Batch ${item.batchNumber} sudah kedaluwarsa dan tidak boleh dikirim sebagai stok AVAILABLE.`);
          const changedBatch = await tx.inventoryBatch.updateMany({ where: { id: batch.id, quantity: { gte: item.quantity + batch.reserved } }, data: { quantity: { decrement: item.quantity } } });
          if (changedBatch.count !== 1) throw new BadRequestException(`Saldo batch ${item.batchNumber} berubah saat transfer diproses.`);
        }
        const serialNumbers = Array.isArray(item.serialNumbers) ? item.serialNumbers.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean) : [];
        if (serialNumbers.length) {
          const serials = await tx.inventorySerial.findMany({ where: { serialNumber: { in: serialNumbers }, warehouseId: source.id, productId: item.productId, status: 'AVAILABLE' }, select: { id: true } });
          if (serials.length !== serialNumbers.length) throw new BadRequestException('Satu atau lebih serial transfer tidak tersedia pada gudang asal.');
          const claimed = await tx.inventorySerial.updateMany({ where: { id: { in: serials.map((row) => row.id) }, status: 'AVAILABLE' }, data: { status: 'IN_TRANSIT', referenceType: 'StockTransfer', referenceId: transfer.id } });
          if (claimed.count !== serialNumbers.length) throw new BadRequestException('Status serial berubah saat transfer dikirim. Ulangi proses.');
        }
        const allocations = await consumeAvailableLocationStock(tx, { warehouseId: source.id, productId: item.productId, quantity: item.quantity });
        const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { quantity: { decrement: item.quantity }, available: { decrement: item.quantity } } });
        for (const allocation of allocations) await tx.inventoryMovement.create({ data: { warehouseId: source.id, productId: item.productId, locationId: allocation.locationId, type: 'TRANSFER_OUT', quantity: -allocation.quantity, balanceAfter: updated.quantity, referenceType: 'StockTransfer', referenceId: transfer.id } });
        await tx.stockTransferItem.update({ where: { id: item.id }, data: { shippedQty: item.quantity } });
      }
      const transferProductIds = [...new Set(transfer.items.map((item) => item.productId))];
      const products = await tx.product.findMany({ where: { id: { in: transferProductIds }, companyId: scope.companyId } });
      if (products.length !== transferProductIds.length) return this.denyTenantAccess(tx, user, scope, 'StockTransferProduct', transfer.id);
      const costMap = new Map(products.map((product) => [product.id, new Prisma.Decimal(product.costPrice)]));
      const value = transfer.items.reduce((total, item) => total.add((costMap.get(item.productId) ?? new Prisma.Decimal(0)).mul(item.quantity)), new Prisma.Decimal(0));
      if (value.greaterThan(0)) await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: source.branchId, eventType: 'STOCK_TRANSFER_SHIPPED', sourceType: 'StockTransfer', sourceId: transfer.id,
        idempotencyKey: `stock-transfer-shipped:${transfer.id}`, amounts: { gross: value }, accountCodes: { debit: '1302', credit: '1301' },
        context: { sourceWarehouseId: source.id, destinationWarehouseId: destination.id, destinationBranchId: destination.branchId },
      });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'inventory.transfer.shipped', aggregateType: 'StockTransfer', aggregateId: id, payload: { companyId: scope.companyId, branchId: source.branchId, destinationBranchId: destination.branchId, transferId: id } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'SHIP_STOCK_TRANSFER', entityType: 'StockTransfer', entityId: id, payload: { branchId: source.branchId, destinationBranchId: destination.branchId } } });
      return tx.stockTransfer.update({ where: { id }, data: { status: 'SHIPPED', shippedAt: new Date() }, include: { items: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async receiveTransfer(id: string, dto: ReceiveStockTransferDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const { row: transfer, source, destination } = await this.transfer(tx, user, scope, id, 'destination');
      if (!['SHIPPED','PARTIALLY_RECEIVED'].includes(transfer.status)) throw new BadRequestException('Transfer belum dikirim atau sudah selesai.');
      for (const input of dto.items) {
        const item = transfer.items.find((row) => row.id === input.transferItemId);
        if (!item) throw new BadRequestException(`Item transfer ${input.transferItemId} tidak ditemukan.`);
        const remaining = item.shippedQty - item.receivedQty;
        if (input.receivedQty > remaining) throw new BadRequestException('Jumlah diterima melebihi jumlah dalam perjalanan.');
        if (input.receivedQty === 0) continue;
        if (item.batchNumber) {
          const sourceBatch = await tx.inventoryBatch.findUnique({ where: { warehouseId_productId_batchNumber: { warehouseId: source.id, productId: item.productId, batchNumber: item.batchNumber } } });
          if (!sourceBatch) throw new BadRequestException(`Metadata batch ${item.batchNumber} tidak ditemukan pada gudang asal.`);
          await tx.inventoryBatch.upsert({
            where: { warehouseId_productId_batchNumber: { warehouseId: destination.id, productId: item.productId, batchNumber: item.batchNumber } },
            create: { warehouseId: destination.id, productId: item.productId, batchNumber: item.batchNumber, producedAt: sourceBatch.producedAt, expiryDate: sourceBatch.expiryDate, quantity: input.receivedQty },
            update: { quantity: { increment: input.receivedQty } },
          });
        }
        const manifest = Array.isArray(item.serialNumbers) ? item.serialNumbers.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean) : [];
        if (manifest.length) {
          const requestedSerials = (input.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean);
          let receiveSerials = requestedSerials;
          if (!receiveSerials.length && input.receivedQty === remaining) {
            const rows = await tx.inventorySerial.findMany({ where: { serialNumber: { in: manifest }, warehouseId: source.id, productId: item.productId, status: 'IN_TRANSIT', referenceType: 'StockTransfer', referenceId: transfer.id }, orderBy: { serialNumber: 'asc' }, take: input.receivedQty });
            receiveSerials = rows.map((row) => row.serialNumber);
          }
          if (receiveSerials.length !== input.receivedQty) throw new BadRequestException('Penerimaan parsial produk serial wajib menyebut serialNumbers tepat sejumlah receivedQty.');
          if (receiveSerials.some((serialNumber) => !manifest.includes(serialNumber))) throw new BadRequestException('Serial penerimaan bukan bagian dari manifest transfer.');
          const movedSerials = await tx.inventorySerial.updateMany({
            where: { serialNumber: { in: receiveSerials }, warehouseId: source.id, productId: item.productId, status: 'IN_TRANSIT', referenceType: 'StockTransfer', referenceId: transfer.id },
            data: { warehouseId: destination.id, status: 'AVAILABLE', referenceType: 'StockTransferReceipt', referenceId: `${transfer.id}:${item.id}` },
          });
          if (movedSerials.count !== input.receivedQty) throw new BadRequestException('Serial in-transit tidak lengkap atau sudah diterima sebelumnya.');
        }
        const locationStock = await depositLocationStock(tx, { warehouseId: destination.id, productId: item.productId, quantity: input.receivedQty });
        const inventory = await tx.inventory.upsert({
          where: { warehouseId_productId: { warehouseId: destination.id, productId: item.productId } },
          create: { warehouseId: destination.id, productId: item.productId, quantity: input.receivedQty, available: input.receivedQty },
          update: { quantity: { increment: input.receivedQty }, available: { increment: input.receivedQty } },
        });
        await tx.inventoryMovement.create({ data: { warehouseId: destination.id, productId: item.productId, locationId: locationStock.locationId, type: 'TRANSFER_IN', quantity: input.receivedQty, balanceAfter: inventory.quantity, referenceType: 'StockTransfer', referenceId: transfer.id, notes: dto.notes } });
        await tx.stockTransferItem.update({ where: { id: item.id }, data: { receivedQty: { increment: input.receivedQty } } });
      }
      const updatedItems = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      const complete = updatedItems.every((item) => item.receivedQty >= item.shippedQty);
      const receivedInputs = dto.items.filter((item) => item.receivedQty > 0);
      const productIds = transfer.items.filter((row) => receivedInputs.some((input) => input.transferItemId === row.id)).map((row) => row.productId);
      const uniqueProductIds = [...new Set(productIds)];
      const products = await tx.product.findMany({ where: { id: { in: uniqueProductIds }, companyId: scope.companyId } });
      if (products.length !== uniqueProductIds.length) return this.denyTenantAccess(tx, user, scope, 'StockTransferProduct', transfer.id);
      const costMap = new Map(products.map((product) => [product.id, new Prisma.Decimal(product.costPrice)]));
      const value = receivedInputs.reduce((total, input) => {
        const item = transfer.items.find((row) => row.id === input.transferItemId)!;
        return total.add((costMap.get(item.productId) ?? new Prisma.Decimal(0)).mul(input.receivedQty));
      }, new Prisma.Decimal(0));
      const receiptSequence = updatedItems.reduce((sum, item) => sum + item.receivedQty, 0);
      if (value.greaterThan(0)) await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: destination.branchId, eventType: 'STOCK_TRANSFER_RECEIVED', sourceType: 'StockTransferReceipt', sourceId: `${transfer.id}:${receiptSequence}`,
        idempotencyKey: `stock-transfer-received:${transfer.id}:${receiptSequence}`, amounts: { gross: value }, accountCodes: { debit: '1301', credit: '1302' },
        context: { transferId: transfer.id, sourceWarehouseId: source.id, sourceBranchId: source.branchId, destinationWarehouseId: destination.id },
      });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: complete ? 'inventory.transfer.received' : 'inventory.transfer.partially_received', aggregateType: 'StockTransfer', aggregateId: id, payload: { companyId: scope.companyId, branchId: destination.branchId, sourceBranchId: source.branchId, transferId: id } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RECEIVE_STOCK_TRANSFER', entityType: 'StockTransfer', entityId: id, payload: { branchId: destination.branchId, sourceBranchId: source.branchId, complete } } });
      return tx.stockTransfer.update({ where: { id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', receivedAt: complete ? new Date() : undefined }, include: { items: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listLocationBalances(user: AuthUser, warehouseId: string, productId?: string) {
    const scope = this.requireTenantScope(user);
    if (!warehouseId) throw new BadRequestException('warehouseId wajib diisi.');
    await this.warehouse(this.prisma, user, scope, warehouseId, 'branch');
    return this.prisma.$transaction(async (tx) => {
      const aggregates = await tx.inventory.findMany({
        where: { warehouseId, ...(productId ? { productId } : {}) },
        select: { productId: true },
      });
      for (const aggregate of aggregates) await prepareLocationInventory(tx, warehouseId, aggregate.productId);
      const balances = await tx.inventoryLocationBalance.findMany({
        where: { warehouseId, ...(productId ? { productId } : {}) },
        orderBy: [{ locationId: 'asc' }, { productId: 'asc' }],
      });
      const locationIds = [...new Set(balances.map((row) => row.locationId))];
      const productIds = [...new Set(balances.map((row) => row.productId))];
      const [locations, products] = await Promise.all([
        tx.warehouseLocation.findMany({ where: { id: { in: locationIds }, warehouseId }, select: { id: true, code: true, name: true, type: true, isDefault: true, isActive: true } }),
        tx.product.findMany({ where: { id: { in: productIds }, companyId: scope.companyId }, select: { id: true, sku: true, name: true, unit: true } }),
      ]);
      const locationMap = new Map(locations.map((row) => [row.id, row]));
      const productMap = new Map(products.map((row) => [row.id, row]));
      return balances.map((row) => ({ ...row, location: locationMap.get(row.locationId) ?? null, product: productMap.get(row.productId) ?? null }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async relocateLocation(dto: RelocateInventoryDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const warehouse = await this.warehouse(this.prisma, user, scope, dto.warehouseId, 'branch', true);
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, companyId: scope.companyId, isActive: true }, select: { id: true } });
    if (!product) throw new BadRequestException('Produk tidak ditemukan atau tidak aktif.');
    const referenceId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await relocateLocationStock(tx, { warehouseId: warehouse.id, productId: dto.productId, sourceLocationId: dto.sourceLocationId, destinationLocationId: dto.destinationLocationId, quantity: dto.quantity });
      const aggregate = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: dto.productId } }, select: { quantity: true } });
      const balanceAfter = aggregate?.quantity ?? 0;
      await tx.inventoryMovement.createMany({ data: [
        { warehouseId: warehouse.id, productId: dto.productId, locationId: dto.sourceLocationId, type: 'LOCATION_MOVE_OUT', quantity: -dto.quantity, balanceAfter, referenceType: 'LocationRelocation', referenceId, notes: dto.notes },
        { warehouseId: warehouse.id, productId: dto.productId, locationId: dto.destinationLocationId, type: 'LOCATION_MOVE_IN', quantity: dto.quantity, balanceAfter, referenceType: 'LocationRelocation', referenceId, notes: dto.notes },
      ] });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RELOCATE_INVENTORY_LOCATION', entityType: 'InventoryLocationBalance', entityId: referenceId, payload: { branchId: scope.branchId, warehouseId: warehouse.id, productId: dto.productId, sourceLocationId: dto.sourceLocationId, destinationLocationId: dto.destinationLocationId, quantity: dto.quantity } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'inventory.location.relocated', aggregateType: 'InventoryLocationBalance', aggregateId: referenceId, payload: { companyId: scope.companyId, branchId: scope.branchId, warehouseId: warehouse.id, productId: dto.productId, sourceLocationId: dto.sourceLocationId, destinationLocationId: dto.destinationLocationId, quantity: dto.quantity } } });
      return { id: referenceId, warehouseId: warehouse.id, productId: dto.productId, sourceLocationId: dto.sourceLocationId, destinationLocationId: dto.destinationLocationId, quantity: dto.quantity };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listConditionBalances(user: AuthUser, warehouseId: string, productId: string) {
    const scope = this.requireTenantScope(user);
    if (!warehouseId || !productId) throw new BadRequestException('warehouseId dan productId wajib diisi.');
    await this.warehouse(this.prisma, user, scope, warehouseId, 'branch');
    const product = await this.prisma.product.findFirst({ where: { id: productId, companyId: scope.companyId }, select: { id: true } });
    if (!product) throw new BadRequestException('Produk tidak ditemukan dalam company aktif.');
    return this.prisma.$transaction(async (tx) => {
      await prepareConditionInventory(tx, warehouseId, productId);
      const [balances, locations] = await Promise.all([
        tx.inventoryConditionBalance.findMany({ where: { warehouseId, productId, quantity: { gt: 0 } }, orderBy: [{ locationId: 'asc' }, { condition: 'asc' }] }),
        tx.warehouseLocation.findMany({ where: { warehouseId }, select: { id: true, code: true, name: true, isActive: true } }),
      ]);
      const locationMap = new Map(locations.map((row) => [row.id, row]));
      return balances.map((row) => ({ ...row, location: locationMap.get(row.locationId) ?? null }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async moveCondition(dto: MoveInventoryConditionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (dto.fromCondition === dto.toCondition) throw new BadRequestException('Kondisi asal dan tujuan harus berbeda.');
    await this.warehouse(this.prisma, user, scope, dto.warehouseId, 'branch', true);
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, companyId: scope.companyId, isActive: true }, select: { id: true } });
    if (!product) throw new BadRequestException('Produk tidak ditemukan atau tidak aktif.');
    const referenceId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await prepareConditionInventory(tx, dto.warehouseId, dto.productId);
      const location = await tx.warehouseLocation.findFirst({ where: { id: dto.locationId, warehouseId: dto.warehouseId, isActive: true }, select: { id: true } });
      if (!location) throw new BadRequestException('Lokasi inventory tidak aktif atau tidak berada pada gudang yang dipilih.');
      const source = await tx.inventoryConditionBalance.findUnique({
        where: { locationId_productId_condition: { locationId: dto.locationId, productId: dto.productId, condition: dto.fromCondition } },
      });
      if (!source || source.quantity < dto.quantity) throw new BadRequestException(`Saldo kondisi ${dto.fromCondition} tidak mencukupi.`);

      if (dto.fromCondition === 'AVAILABLE') {
        const free = await tx.inventoryLocationBalance.findUnique({ where: { locationId_productId: { locationId: dto.locationId, productId: dto.productId } }, select: { available: true } });
        if (!free || free.available < dto.quantity) throw new BadRequestException('Stok AVAILABLE yang bebas reservasi tidak mencukupi untuk perubahan kondisi.');
      }

      const reduced = await tx.inventoryConditionBalance.updateMany({
        where: { id: source.id, quantity: { gte: dto.quantity } },
        data: { quantity: { decrement: dto.quantity } },
      });
      if (reduced.count !== 1) throw new BadRequestException('Saldo kondisi berubah saat diproses. Ulangi transaksi.');
      await tx.inventoryConditionBalance.upsert({
        where: { locationId_productId_condition: { locationId: dto.locationId, productId: dto.productId, condition: dto.toCondition } },
        create: { warehouseId: dto.warehouseId, locationId: dto.locationId, productId: dto.productId, condition: dto.toCondition, quantity: dto.quantity },
        update: { quantity: { increment: dto.quantity } },
      });

      if (dto.fromCondition === 'AVAILABLE') {
        const [locationChanged, inventoryChanged] = await Promise.all([
          tx.inventoryLocationBalance.updateMany({ where: { locationId: dto.locationId, productId: dto.productId, available: { gte: dto.quantity } }, data: { available: { decrement: dto.quantity } } }),
          tx.inventory.updateMany({ where: { warehouseId: dto.warehouseId, productId: dto.productId, available: { gte: dto.quantity } }, data: { available: { decrement: dto.quantity } } }),
        ]);
        if (locationChanged.count !== 1 || inventoryChanged.count !== 1) throw new BadRequestException('Saldo sellable berubah saat perubahan kondisi. Ulangi transaksi.');
      } else if (dto.toCondition === 'AVAILABLE') {
        await Promise.all([
          tx.inventoryLocationBalance.update({ where: { locationId_productId: { locationId: dto.locationId, productId: dto.productId } }, data: { available: { increment: dto.quantity } } }),
          tx.inventory.update({ where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: dto.productId } }, data: { available: { increment: dto.quantity } } }),
        ]);
      }

      const movement = await tx.inventoryConditionMovement.create({ data: {
        id: referenceId, warehouseId: dto.warehouseId, locationId: dto.locationId, productId: dto.productId,
        fromCondition: dto.fromCondition, toCondition: dto.toCondition, quantity: dto.quantity, notes: dto.notes,
        referenceType: 'MANUAL_CONDITION_CHANGE', referenceId, createdById: user.sub,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'MOVE_INVENTORY_CONDITION', entityType: 'InventoryConditionMovement', entityId: movement.id, payload: { branchId: scope.branchId, warehouseId: dto.warehouseId, locationId: dto.locationId, productId: dto.productId, fromCondition: dto.fromCondition, toCondition: dto.toCondition, quantity: dto.quantity } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'inventory.condition.moved', aggregateType: 'InventoryConditionMovement', aggregateId: movement.id, payload: { companyId: scope.companyId, branchId: scope.branchId, warehouseId: dto.warehouseId, locationId: dto.locationId, productId: dto.productId, fromCondition: dto.fromCondition, toCondition: dto.toCondition, quantity: dto.quantity } } });
      return movement;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listOpnames(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const warehouseIds = await this.branchWarehouseIds(this.prisma, scope);
    return this.prisma.stockOpname.findMany({ where: { warehouseId: { in: warehouseIds } }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  async createOpname(dto: CreateStockOpnameDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const warehouse = await this.warehouse(this.prisma, user, scope, dto.warehouseId, 'branch', true);
    if (dto.locationId) {
      const location = await this.prisma.warehouseLocation.findFirst({ where: { id: dto.locationId, warehouseId: warehouse.id, isActive: true } });
      if (!location) return this.denyTenantAccess(this.prisma, user, scope, 'WarehouseLocation', dto.locationId);
    }
    return this.prisma.$transaction(async (tx) => {
      const warehouseInventories = await tx.inventory.findMany({ where: { warehouseId: warehouse.id }, include: { product: { select: { trackBatch: true } } } });
      for (const inventory of warehouseInventories) await prepareLocationInventory(tx, warehouse.id, inventory.productId);
      const snapshotItems: Array<{ productId: string; batchNumber?: string; systemQty: number }> = [];
      if (dto.locationId) {
        const locationSnapshot = await tx.inventoryLocationBalance.findMany({ where: { warehouseId: warehouse.id, locationId: dto.locationId } });
        snapshotItems.push(...locationSnapshot.map((inventory) => ({ productId: inventory.productId, systemQty: inventory.quantity })));
      } else {
        for (const inventory of warehouseInventories) {
          if (!inventory.product.trackBatch) {
            snapshotItems.push({ productId: inventory.productId, systemQty: inventory.quantity });
            continue;
          }
          const batches = await tx.inventoryBatch.findMany({ where: { warehouseId: warehouse.id, productId: inventory.productId }, orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }] });
          const batchTotal = batches.reduce((sum, batch) => sum + batch.quantity, 0);
          if (batchTotal !== inventory.quantity) throw new BadRequestException(`BATCH_INVENTORY_DRIFT:${warehouse.id}:${inventory.productId}; aggregate=${inventory.quantity}; batches=${batchTotal}`);
          snapshotItems.push(...batches.map((batch) => ({ productId: inventory.productId, batchNumber: batch.batchNumber, systemQty: batch.quantity })));
        }
      }
      const row = await tx.stockOpname.create({ data: {
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'STOCK_OPNAME', prefix: 'SO' }), warehouseId: warehouse.id, locationId: dto.locationId, status: 'COUNTING', createdById: user.sub, notes: dto.notes, startedAt: new Date(),
        items: { create: snapshotItems },
      }, include: { items: true } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_STOCK_OPNAME', entityType: 'StockOpname', entityId: row.id, payload: { branchId: scope.branchId, warehouseId: warehouse.id, ...(dto.locationId ? { locationId: dto.locationId } : {}) } } });
      return row;
    });
  }

  async countOpname(id: string, dto: CountStockOpnameDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const { row: opname } = await this.opname(this.prisma, user, scope, id);
    if (opname.status !== 'COUNTING') throw new BadRequestException('Stock opname tidak dalam proses penghitungan.');
    return this.prisma.$transaction(async (tx) => {
      for (const input of dto.items) {
        const item = await tx.stockOpnameItem.findFirst({ where: { id: input.opnameItemId, opnameId: id } });
        if (!item) throw new BadRequestException(`Item opname ${input.opnameItemId} tidak ditemukan.`);
        await tx.stockOpnameItem.update({ where: { id: item.id }, data: { countedQty: input.countedQty, difference: input.countedQty - item.systemQty, reason: input.reason } });
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'COUNT_STOCK_OPNAME', entityType: 'StockOpname', entityId: id, payload: { branchId: scope.branchId, itemCount: dto.items.length } } });
      return tx.stockOpname.findUniqueOrThrow({ where: { id }, include: { items: true } });
    });
  }

  async submitOpname(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const { row: opname } = await this.opname(this.prisma, user, scope, id);
    if (opname.items.some((item) => item.countedQty === null)) throw new BadRequestException('Semua barang harus dihitung sebelum diajukan.');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.stockOpname.update({ where: { id }, data: { status: 'WAITING_APPROVAL' }, include: { items: true } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'SUBMIT_STOCK_OPNAME', entityType: 'StockOpname', entityId: id, payload: { branchId: scope.branchId } } });
      return row;
    });
  }

  async completeOpname(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const { row: opname, warehouse } = await this.opname(tx, user, scope, id);
      if (opname.status !== 'WAITING_APPROVAL') throw new BadRequestException('Stock opname belum diajukan untuk persetujuan.');
      const opnameProductIds = [...new Set(opname.items.map((item) => item.productId))];
      const products = await tx.product.findMany({ where: { id: { in: opnameProductIds }, companyId: scope.companyId } });
      if (products.length !== opnameProductIds.length) return this.denyTenantAccess(tx, user, scope, 'StockOpnameProduct', opname.id);
      const costMap = new Map(products.map((product) => [product.id, new Prisma.Decimal(product.costPrice)]));
      let gainValue = new Prisma.Decimal(0); let lossValue = new Prisma.Decimal(0);
      for (const item of opname.items) {
        const counted = item.countedQty ?? item.systemQty; const difference = counted - item.systemQty;
        if (difference === 0) continue;
        const adjustmentValue = (costMap.get(item.productId) ?? new Prisma.Decimal(0)).mul(Math.abs(difference));
        if (difference > 0) gainValue = gainValue.add(adjustmentValue); else lossValue = lossValue.add(adjustmentValue);
        if (item.batchNumber) {
          const batch = await tx.inventoryBatch.findUnique({ where: { warehouseId_productId_batchNumber: { warehouseId: warehouse.id, productId: item.productId, batchNumber: item.batchNumber } } });
          if (!batch) throw new BadRequestException(`Batch ${item.batchNumber} pada opname tidak ditemukan.`);
          if (difference < 0 && batch.quantity - batch.reserved < Math.abs(difference)) throw new BadRequestException(`Stok bebas batch ${item.batchNumber} tidak cukup untuk adjustment opname.`);
          await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantity: difference > 0 ? { increment: difference } : { decrement: Math.abs(difference) } } });
        }
        let locationChanges: Array<{ locationId: string; quantity: number }> = [];
        if (opname.locationId) {
          const locationChange = await adjustLocationStock(tx, { warehouseId: warehouse.id, productId: item.productId, difference, locationId: opname.locationId });
          if (locationChange) locationChanges = [{ locationId: locationChange.locationId, quantity: Math.abs(difference) }];
        } else if (difference > 0) {
          const locationChange = await depositLocationStock(tx, { warehouseId: warehouse.id, productId: item.productId, quantity: difference });
          locationChanges = [{ locationId: locationChange.locationId, quantity: difference }];
        } else {
          locationChanges = await consumeAvailableLocationStock(tx, { warehouseId: warehouse.id, productId: item.productId, quantity: Math.abs(difference) });
        }
        const aggregateBefore = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: item.productId } } });
        const nextQuantity = (aggregateBefore?.quantity ?? 0) + difference;
        const nextAvailable = (aggregateBefore?.available ?? 0) + difference;
        if (nextQuantity < 0 || nextAvailable < 0) throw new BadRequestException('Adjustment opname membuat stok aggregate negatif atau mengurangi stok yang sedang direservasi.');
        const inventory = await tx.inventory.upsert({
          where: { warehouseId_productId: { warehouseId: warehouse.id, productId: item.productId } },
          create: { warehouseId: warehouse.id, productId: item.productId, quantity: nextQuantity, available: nextAvailable },
          update: { quantity: nextQuantity, available: nextAvailable },
        });
        for (const locationChange of locationChanges) await tx.inventoryMovement.create({ data: { warehouseId: warehouse.id, productId: item.productId, locationId: locationChange.locationId, type: difference > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', quantity: difference > 0 ? locationChange.quantity : -locationChange.quantity, balanceAfter: inventory.quantity, referenceType: 'StockOpname', referenceId: id, notes: item.reason } });
      }
      if (gainValue.greaterThan(0) || lossValue.greaterThan(0)) await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'STOCK_OPNAME_ADJUSTMENT', sourceType: 'StockOpname', sourceId: id,
        idempotencyKey: `stock-opname:${id}`, amounts: { inventoryGain: gainValue, gain: gainValue, loss: lossValue, inventoryLoss: lossValue },
        accountCodes: { inventoryGain: '1301', gain: '4201', loss: '5102', inventoryLoss: '1301' }, context: { warehouseId: warehouse.id, approvedById: user.sub },
      });
      const postedMobileDrafts = await tx.mobileOpnameDraft.updateMany({
        where: { companyId: scope.companyId, opnameId: id, status: 'SUBMITTED' },
        data: { status: 'POSTED' },
      });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'inventory.opname.completed', aggregateType: 'StockOpname', aggregateId: id, payload: { companyId: scope.companyId, branchId: scope.branchId, warehouseId: warehouse.id, opnameId: id } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'COMPLETE_STOCK_OPNAME', entityType: 'StockOpname', entityId: id, payload: { branchId: scope.branchId, warehouseId: warehouse.id, postedMobileDrafts: postedMobileDrafts.count } } });
      return tx.stockOpname.update({ where: { id }, data: { status: 'COMPLETED', approvedById: user.sub, completedAt: new Date() }, include: { items: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
