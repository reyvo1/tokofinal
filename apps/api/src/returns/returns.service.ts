import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, TaxTransactionDirection } from '@prisma/client';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { consumeAvailableLocationStock, depositLocationStock } from '../common/location-inventory';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { serializableTx } from '../common/serializable-tx';
import { normalizeTenderPolicy, TenderPolicy } from '../common/tender-policy';
import { OperationsControlService } from '../operations-control/operations-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmReturnDto, CreatePurchaseReturnDto, CreateSaleReturnDto } from './dto/returns.dto';
import { ConfirmOrderReturnDto, CreateCustomerOrderReturnDto, RejectOrderReturnDto } from './dto/order-return.dto';
import { StorefrontCustomerService } from '../storefront-customer/storefront-customer.service';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
type HistoricalReturnState = { quantity: number; net: Prisma.Decimal; tax: Prisma.Decimal; gross: Prisma.Decimal };
type RefundAllocation = {
  sourcePaymentId?: string;
  method: string;
  methodName: string;
  amount: string;
  accountCode: string;
  kind: 'CASH' | 'SETTLEMENT' | 'RECEIVABLE';
  behavior: string;
  methodSnapshot?: Prisma.JsonValue;
};

function zeroHistoricalReturnState(): HistoricalReturnState {
  return { quantity: 0, net: new Prisma.Decimal(0), tax: new Prisma.Decimal(0), gross: new Prisma.Decimal(0) };
}

function allocateHistoricalRemainder(
  original: Prisma.Decimal,
  alreadyAllocated: Prisma.Decimal,
  requestedQuantity: number,
  originalQuantity: number,
  alreadyReturnedQuantity: number,
): Prisma.Decimal {
  const remainingQuantity = originalQuantity - alreadyReturnedQuantity;
  if (remainingQuantity < requestedQuantity || requestedQuantity < 1 || originalQuantity < 1) {
    throw new BadRequestException('Kuantitas retur historis tidak konsisten dengan transaksi asal.');
  }
  if (requestedQuantity === remainingQuantity) {
    const remainder = original.sub(alreadyAllocated).toDecimalPlaces(2);
    if (remainder.isNegative()) throw new BadRequestException('Nilai retur historis melebihi transaksi asal.');
    return remainder;
  }
  return original.mul(requestedQuantity).div(originalQuantity).toDecimalPlaces(2);
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingCoreService,
    private readonly operations: OperationsControlService,
    private readonly storefrontCustomers: StorefrontCustomerService,
  ) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Pengguna belum memiliki company dan branch yang valid.',
      });
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
    await client.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'TENANT_ACCESS_DENIED',
        entityType,
        entityId,
        payload: payload ?? {
          authenticatedCompanyId: scope.companyId,
          authenticatedBranchId: scope.branchId,
        },
      },
    });
    throw new ForbiddenException({
      code: 'TENANT_ACCESS_DENIED',
      message: `${entityType} tidak tersedia dalam company dan branch pengguna.`,
    });
  }

  private async tenantWarehouseIds(client: DbClient, scope: TenantScope) {
    const rows = await client.warehouse.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async assertWarehouse(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.warehouse.findFirst({
      where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Warehouse', id);
    return row;
  }

  private async scopedSaleReturn(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.saleReturn.findUnique({ where: { id }, include: { items: true } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'SaleReturn', id);
    await this.assertWarehouse(client, user, scope, row.warehouseId);
    return row;
  }

  private async scopedPurchaseReturn(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.purchaseReturn.findUnique({ where: { id }, include: { items: true } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'PurchaseReturn', id);
    await this.assertWarehouse(client, user, scope, row.warehouseId);
    return row;
  }

  private async assertInspection(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    id?: string | null,
    sourceType?: string,
    sourceId?: string,
  ) {
    if (!id) return undefined;
    const row = await client.operationalInspection.findFirst({
      where: {
        id,
        companyId: scope.companyId,
        branchId: scope.branchId,
        ...(sourceType ? { sourceType } : {}),
        ...(sourceId ? { sourceId } : {}),
      },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'OperationalInspection', id);
    return row;
  }

  private async assertConfirmation(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    id?: string | null,
    sourceType?: string,
    sourceId?: string,
  ) {
    if (!id) return undefined;
    const row = await client.operationalConfirmation.findFirst({
      where: {
        id,
        companyId: scope.companyId,
        branchId: scope.branchId,
        status: 'APPROVED',
        ...(sourceType ? { sourceType } : {}),
        ...(sourceId ? { sourceId } : {}),
      },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'OperationalConfirmation', id);
    return row;
  }

  private async assertReturnTaxCodes(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    taxCodeIds: Array<string | null>,
  ): Promise<void> {
    const ids = [...new Set(taxCodeIds.filter(Boolean) as string[])];
    if (!ids.length) return;
    const rows = await client.taxCode.findMany({
      where: { id: { in: ids }, companyId: scope.companyId },
      select: { id: true },
    });
    if (rows.length !== ids.length) {
      const valid = new Set(rows.map((row) => row.id));
      const invalidId = ids.find((id) => !valid.has(id));
      await this.denyTenantAccess(client, user, scope, 'TaxCode', invalidId);
    }
  }

  private paymentPolicy(payment: { method: string; methodSnapshot?: Prisma.JsonValue | null; settlementAccountCode?: string | null }): TenderPolicy | null {
    if (payment.method === 'ON_ACCOUNT') return null;
    const snapshot = payment.methodSnapshot;
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      const policy = (snapshot as Record<string, unknown>).policy;
      if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
        try { return normalizeTenderPolicy(payment.method, policy as Record<string, unknown>); } catch { /* legacy fallback below */ }
      }
    }
    return normalizeTenderPolicy(payment.method, payment.settlementAccountCode ? { settlementAccountCode: payment.settlementAccountCode } : undefined);
  }

  private refundDestination(policy: TenderPolicy) {
    if (policy.refundBehavior === 'DISABLED') return null;
    if (policy.refundBehavior === 'RECEIVABLE') return { accountCode: '1201', kind: 'RECEIVABLE' as const };
    if (policy.refundBehavior === 'CASH') return { accountCode: policy.refundAccountCode ?? '1101', kind: 'CASH' as const };
    return { accountCode: policy.settlementAccountCode, kind: policy.kind === 'CASH' ? 'CASH' as const : 'SETTLEMENT' as const };
  }

  private async saleReceivableCapacity(
    client: DbClient,
    scope: TenantScope,
    saleId: string,
    payment: { id: string; amount: Prisma.Decimal },
    priorRefunded: Prisma.Decimal,
  ) {
    const receipts = await client.operationalFinanceTransaction.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        type: 'CUSTOMER_RECEIPT',
        referenceType: 'Sale',
        referenceId: saleId,
        status: { in: ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'POSTED', 'PAID'] },
      },
      select: { grossAmount: true },
    });
    const committedReceipts = receipts.reduce((sum, row) => sum.add(row.grossAmount), new Prisma.Decimal(0));
    const capacity = new Prisma.Decimal(payment.amount).sub(committedReceipts).sub(priorRefunded);
    return capacity.greaterThan(0) ? capacity : new Prisma.Decimal(0);
  }

  private async resolveSaleRefundAllocations(
    client: DbClient,
    scope: TenantScope,
    saleId: string,
    refundAmount: Prisma.Decimal,
    requestedMethod: string,
  ) {
    const sale = await client.sale.findFirst({
      where: { id: saleId, branchId: scope.branchId, branch: { companyId: scope.companyId } },
      include: { payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!sale) throw new BadRequestException('Penjualan asal retur tidak tersedia pada cabang ini.');
    const previousReturns = await client.saleReturn.findMany({
      where: { saleId, status: 'COMPLETED' },
      select: { id: true, refundDetails: true, refundAmount: true },
    });
    const priorByPayment = new Map<string, Prisma.Decimal>();
    let hasLegacyUnallocatedRefund = false;
    for (const previous of previousReturns) {
      if (!Array.isArray(previous.refundDetails)) {
        if (new Prisma.Decimal(previous.refundAmount).greaterThan(0)) hasLegacyUnallocatedRefund = true;
        continue;
      }
      for (const value of previous.refundDetails) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const item = value as Record<string, unknown>;
        if (typeof item.sourcePaymentId !== 'string') continue;
        const amount = new Prisma.Decimal(typeof item.amount === 'string' || typeof item.amount === 'number' ? item.amount : 0);
        priorByPayment.set(item.sourcePaymentId, (priorByPayment.get(item.sourcePaymentId) ?? new Prisma.Decimal(0)).add(amount));
      }
    }

    const method = requestedMethod.trim().toUpperCase();
    if (method === 'ORIGINAL') {
      if (hasLegacyUnallocatedRefund) {
        throw new BadRequestException('Refund ORIGINAL tidak dapat ditentukan aman karena ada retur historis tanpa snapshot alokasi. Pilih metode refund eksplisit.');
      }
      let remaining = refundAmount.toDecimalPlaces(2);
      const allocations: RefundAllocation[] = [];
      const receivable = sale.payments.find((payment) => payment.method === 'ON_ACCOUNT');
      if (receivable && remaining.greaterThan(0)) {
        const prior = priorByPayment.get(receivable.id) ?? new Prisma.Decimal(0);
        const capacity = await this.saleReceivableCapacity(client, scope, sale.id, receivable, prior);
        const amount = Prisma.Decimal.min(remaining, capacity).toDecimalPlaces(2);
        if (amount.greaterThan(0)) {
          allocations.push({ sourcePaymentId: receivable.id, method: 'ON_ACCOUNT', methodName: receivable.methodName ?? 'Piutang Pelanggan', amount: amount.toFixed(2), accountCode: '1201', kind: 'RECEIVABLE', behavior: 'RECEIVABLE', methodSnapshot: receivable.methodSnapshot ?? undefined });
          remaining = remaining.sub(amount);
        }
      }
      for (const payment of sale.payments.filter((item) => item.method !== 'ON_ACCOUNT')) {
        if (!remaining.greaterThan(0)) break;
        const prior = priorByPayment.get(payment.id) ?? new Prisma.Decimal(0);
        const capacity = new Prisma.Decimal(payment.amount).sub(prior);
        if (!capacity.greaterThan(0)) continue;
        const policy = this.paymentPolicy(payment);
        if (!policy) continue;
        const destination = this.refundDestination(policy);
        if (!destination) continue;
        const amount = Prisma.Decimal.min(remaining, capacity).toDecimalPlaces(2);
        allocations.push({ sourcePaymentId: payment.id, method: payment.method, methodName: payment.methodName ?? payment.method, amount: amount.toFixed(2), accountCode: destination.accountCode, kind: destination.kind, behavior: policy.refundBehavior, methodSnapshot: payment.methodSnapshot ?? undefined });
        remaining = remaining.sub(amount);
      }
      if (remaining.greaterThan(0)) throw new BadRequestException(`Refund ORIGINAL tidak memiliki saldo tender/piutang yang dapat direversal sebesar ${remaining.toFixed(2)}.`);
      return { sale, allocations, priorByPayment };
    }

    if (method === 'RECEIVABLE') {
      const receivable = sale.payments.find((payment) => payment.method === 'ON_ACCOUNT');
      if (!receivable) throw new BadRequestException('Penjualan ini tidak memiliki piutang pelanggan yang dapat dikurangi.');
      const prior = priorByPayment.get(receivable.id) ?? new Prisma.Decimal(0);
      const capacity = await this.saleReceivableCapacity(client, scope, sale.id, receivable, prior);
      if (refundAmount.greaterThan(capacity)) throw new BadRequestException(`Refund ke piutang melebihi saldo piutang tersedia ${capacity.toFixed(2)}.`);
      const allocations: RefundAllocation[] = [{ sourcePaymentId: receivable.id, method: 'ON_ACCOUNT', methodName: receivable.methodName ?? 'Piutang Pelanggan', amount: refundAmount.toFixed(2), accountCode: '1201', kind: 'RECEIVABLE', behavior: 'RECEIVABLE', methodSnapshot: receivable.methodSnapshot ?? undefined }];
      return { sale, allocations, priorByPayment };
    }

    const reference = await client.masterReference.findFirst({
      where: { companyId: scope.companyId, type: 'PAYMENT_METHOD', code: method, isActive: true, OR: [{ branchId: null }, { branchId: scope.branchId }] },
    });
    if (!reference) throw new BadRequestException(`Metode refund ${method} tidak aktif/diizinkan pada cabang ini.`);
    const policy = normalizeTenderPolicy(reference.code, reference.metadata);
    const destination = this.refundDestination(policy);
    if (!destination) throw new BadRequestException(`Metode ${method} tidak mengizinkan refund.`);
    if (destination.kind === 'RECEIVABLE') {
      const receivable = sale.payments.find((payment) => payment.method === 'ON_ACCOUNT');
      if (!receivable) throw new BadRequestException('Metode refund ini membutuhkan piutang pelanggan pada transaksi asal.');
      const prior = priorByPayment.get(receivable.id) ?? new Prisma.Decimal(0);
      const capacity = await this.saleReceivableCapacity(client, scope, sale.id, receivable, prior);
      if (refundAmount.greaterThan(capacity)) throw new BadRequestException(`Refund ke piutang melebihi saldo piutang tersedia ${capacity.toFixed(2)}.`);
      const allocations: RefundAllocation[] = [{ sourcePaymentId: receivable.id, method: reference.code, methodName: reference.name, amount: refundAmount.toFixed(2), accountCode: destination.accountCode, kind: destination.kind, behavior: policy.refundBehavior, methodSnapshot: { version: 1, referenceId: reference.id, code: reference.code, name: reference.name, policy: policy as unknown as Prisma.JsonValue } }];
      return { sale, allocations, priorByPayment };
    }
    const allocations: RefundAllocation[] = [{ method: reference.code, methodName: reference.name, amount: refundAmount.toFixed(2), accountCode: destination.accountCode, kind: destination.kind, behavior: policy.refundBehavior, methodSnapshot: { version: 1, referenceId: reference.id, code: reference.code, name: reference.name, policy: policy as unknown as Prisma.JsonValue } }];
    return { sale, allocations, priorByPayment };
  }

  async listSaleReturns(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const warehouseIds = await this.tenantWarehouseIds(this.prisma, scope);
    return this.prisma.saleReturn.findMany({
      where: { warehouseId: { in: warehouseIds } },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async listPurchaseReturns(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const warehouseIds = await this.tenantWarehouseIds(this.prisma, scope);
    return this.prisma.purchaseReturn.findMany({
      where: { warehouseId: { in: warehouseIds } },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async createSaleReturn(dto: CreateSaleReturnDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.items.length) throw new BadRequestException('Retur penjualan harus memiliki item.');
    const sale = await this.prisma.sale.findFirst({
      where: { id: dto.saleId, branchId: scope.branchId, branch: { companyId: scope.companyId } },
      include: { items: true, branch: true, payments: true },
    });
    if (!sale) return this.denyTenantAccess(this.prisma, user, scope, 'Sale', dto.saleId);
    await this.assertWarehouse(this.prisma, user, scope, dto.warehouseId);
    if (sale.warehouseId !== dto.warehouseId) {
      throw new BadRequestException('Gudang retur harus sesuai dengan gudang penjualan.');
    }

    // Validasi bersifat kumulatif: item yang sudah masuk retur aktif/selesai tidak
    // boleh diretur lagi melebihi kuantitas penjualan asal.
    const previousReturns = await this.prisma.saleReturn.findMany({
      where: {
        saleId: sale.id,
        status: { in: ['REQUESTED','APPROVED','COMPLETED'] },
      },
      include: { items: true },
    });
    const alreadyReturned = new Map<string, number>();
    const saleAllocation = new Map<string, HistoricalReturnState>();
    for (const previous of previousReturns) {
      for (const item of previous.items) {
        const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? item.metadata as Record<string, unknown>
          : undefined;
        const saleItemId = typeof metadata?.saleItemId === 'string' ? metadata.saleItemId : undefined;
        if (saleItemId) {
          alreadyReturned.set(saleItemId, (alreadyReturned.get(saleItemId) ?? 0) + item.quantity);
          const state = saleAllocation.get(saleItemId) ?? zeroHistoricalReturnState();
          state.quantity += item.quantity;
          state.net = state.net.add(item.netAmount);
          state.tax = state.tax.add(item.taxAmount);
          state.gross = state.gross.add(item.grossAmount);
          saleAllocation.set(saleItemId, state);
        }
      }
    }
    const requestedNow = new Map<string, number>();
    for (const input of dto.items) {
      requestedNow.set(input.saleItemId, (requestedNow.get(input.saleItemId) ?? 0) + input.quantity);
    }
    for (const [saleItemId, requestedQty] of requestedNow) {
      const original = sale.items.find((item) => item.id === saleItemId);
      const used = alreadyReturned.get(saleItemId) ?? 0;
      if (!original || requestedQty <= 0 || used + requestedQty > original.quantity) {
        throw new BadRequestException(`Jumlah retur item ${saleItemId} melebihi sisa yang dapat diretur.`);
      }
    }

    const rows = dto.items.map((input) => {
      const original = sale.items.find((item) => item.id === input.saleItemId);
      if (!original || input.quantity > original.quantity) {
        throw new BadRequestException(`Jumlah retur item ${input.saleItemId} tidak valid.`);
      }
      const factor = Math.max(1, Number(original.quantityFactor ?? 1));
      const returnedUnitQuantity = input.quantity % factor === 0 ? input.quantity / factor : null;
      const allocation = saleAllocation.get(original.id) ?? zeroHistoricalReturnState();
      const netAmount = allocateHistoricalRemainder(original.netSubtotal, allocation.net, input.quantity, original.quantity, allocation.quantity);
      const taxAmount = allocateHistoricalRemainder(original.taxAmount, allocation.tax, input.quantity, original.quantity, allocation.quantity);
      const grossAmount = allocateHistoricalRemainder(original.grossSubtotal, allocation.gross, input.quantity, original.quantity, allocation.quantity);
      allocation.quantity += input.quantity;
      allocation.net = allocation.net.add(netAmount);
      allocation.tax = allocation.tax.add(taxAmount);
      allocation.gross = allocation.gross.add(grossAmount);
      saleAllocation.set(original.id, allocation);
      return {
        productId: original.productId,
        variantId: original.variantId ?? null,
        productUnitId: original.productUnitId ?? null,
        unitCode: original.unitCode ?? null,
        unitQuantity: returnedUnitQuantity,
        quantityFactor: factor,
        sourceBarcode: original.sourceBarcode ?? null,
        quantity: input.quantity,
        condition: input.condition ?? 'GOOD',
        restock: input.restock ?? true,
        unitAmount: original.unitPrice,
        unitCost: original.unitCost,
        netAmount,
        taxAmount,
        grossAmount,
        taxCodeId: original.taxCodeId,
        metadata: { saleItemId: original.id, sourceBaseQuantity: original.quantity, sourceUnitQuantity: original.unitQuantity ?? null },
      };
    });
    await this.assertReturnTaxCodes(this.prisma, user, scope, rows.map((row) => row.taxCodeId));
    const refund = rows.reduce((sum, item) => sum.add(item.grossAmount), new Prisma.Decimal(0));
    const refundMethod = (dto.refundMethod ?? 'ORIGINAL').trim().toUpperCase();
    if (refundMethod === 'RECEIVABLE' && !sale.payments.some((payment) => payment.method === 'ON_ACCOUNT')) {
      throw new BadRequestException('Refund RECEIVABLE hanya tersedia untuk penjualan yang memiliki piutang pelanggan.');
    }
    if (!['ORIGINAL', 'RECEIVABLE'].includes(refundMethod)) {
      const reference = await this.prisma.masterReference.findFirst({
        where: { companyId: scope.companyId, type: 'PAYMENT_METHOD', code: refundMethod, isActive: true, OR: [{ branchId: null }, { branchId: scope.branchId }] },
      });
      if (!reference) throw new BadRequestException(`Metode refund ${refundMethod} tidak aktif/diizinkan pada cabang ini.`);
      if (!this.refundDestination(normalizeTenderPolicy(reference.code, reference.metadata))) throw new BadRequestException(`Metode ${refundMethod} tidak mengizinkan refund.`);
    }
    const created = await this.prisma.saleReturn.create({
      data: {
        number: await nextDocumentNumber(this.prisma, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'SALE_RETURN', prefix: 'SRT' }),
        saleId: sale.id,
        warehouseId: dto.warehouseId,
        status: 'REQUESTED',
        reason: dto.reason,
        refundMethod,
        refundAmount: refund,
        createdById: user.sub,
        items: { create: rows },
      },
      include: { items: true },
    });
    const inspection = await this.operations.createInspection({
      companyId: scope.companyId,
      branchId: scope.branchId,
      type: 'RETURN_INBOUND' as never,
      sourceType: 'SaleReturn',
      sourceId: created.id,
      templateCode: 'RETURN-INBOUND-STANDARD',
      metadata: { saleId: sale.id, warehouseId: dto.warehouseId },
    }, user);
    const updated = await this.prisma.saleReturn.update({
      where: { id: created.id },
      data: { inspectionId: inspection.id },
      include: { items: true },
    });
    await this.prisma.auditLog.create({ data: {
      companyId: scope.companyId,
      userId: user.sub,
      action: 'CREATE_SALE_RETURN',
      entityType: 'SaleReturn',
      entityId: created.id,
      payload: { branchId: scope.branchId, saleId: sale.id, warehouseId: dto.warehouseId },
    } });
    return updated;
  }

  async confirmSaleReturn(id: string, dto: ConfirmReturnDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.scopedSaleReturn(tx, user, scope, id);
      if (!['REQUESTED','APPROVED'].includes(row.status)) {
        throw new BadRequestException(`Retur berstatus ${row.status}.`);
      }
      const inspectionId = dto.inspectionId ?? row.inspectionId;
      const inspection = await this.assertInspection(tx, user, scope, inspectionId, 'SaleReturn', row.id);
      if (inspection && !['PASSED','PARTIAL','APPROVED'].includes(inspection.status)) {
        throw new BadRequestException('Pemeriksaan retur belum lulus.');
      }
      const confirmationId = dto.confirmationId ?? row.confirmationId;
      await this.assertConfirmation(tx, user, scope, confirmationId, 'SaleReturn', row.id);
      const warehouse = await this.assertWarehouse(tx, user, scope, row.warehouseId);
      await this.assertReturnTaxCodes(tx, user, scope, row.items.map((item) => item.taxCodeId));
      for (const item of row.items.filter((item) => item.restock && item.condition === 'GOOD')) {
        const locationStock = await depositLocationStock(tx, { warehouseId: row.warehouseId, productId: item.productId, quantity: item.quantity });
        const inventory = await tx.inventory.upsert({
          where: { warehouseId_productId: { warehouseId: row.warehouseId, productId: item.productId } },
          create: {
            warehouseId: row.warehouseId,
            productId: item.productId,
            quantity: item.quantity,
            available: item.quantity,
          },
          update: { quantity: { increment: item.quantity }, available: { increment: item.quantity } },
        });
        await tx.inventoryMovement.create({ data: {
          warehouseId: row.warehouseId,
          productId: item.productId,
          locationId: locationStock.locationId,
          type: 'SALE_RETURN',
          quantity: item.quantity,
          balanceAfter: inventory.quantity,
          referenceType: 'SaleReturn',
          referenceId: row.id,
        } });
      }
      const net = row.items.reduce((sum, item) => sum.add(item.netAmount), new Prisma.Decimal(0));
      const tax = row.items.reduce((sum, item) => sum.add(item.taxAmount), new Prisma.Decimal(0));
      const gross = row.items.reduce((sum, item) => sum.add(item.grossAmount), new Prisma.Decimal(0));
      const cogs = row.items
        .filter((item) => item.restock && item.condition === 'GOOD')
        .reduce((sum, item) => sum.add(item.unitCost.mul(item.quantity)), new Prisma.Decimal(0));
      const refundResolution = await this.resolveSaleRefundAllocations(tx, scope, row.saleId, gross, row.refundMethod ?? 'ORIGINAL');
      const refundAllocations = refundResolution.allocations;
      const taxLines = row.items
        .filter((item) => item.taxCodeId && !item.taxAmount.isZero())
        .map((item) => ({
          taxCodeId: item.taxCodeId!,
          direction: 'OUTPUT' as TaxTransactionDirection,
          taxableBase: item.netAmount.negated(),
          taxAmount: item.taxAmount.negated(),
          documentNumber: row.number,
        }));
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        eventType: 'SALE_RETURN',
        sourceType: 'SaleReturn',
        sourceId: row.id,
        idempotencyKey: `sale-return:${row.id}`,
        // `gross` sengaja tidak dikirim: rule legacy SALE_RETURN akan melewati settlement line,
        // sedangkan refund destination berasal dari immutable tender snapshot di additional lines.
        amounts: { net, outputTax: tax, cogs, inventory: cogs },
        accountCodes: { returns: '4102', outputTax: '2201', inventory: '1301', cogs: '5101' },
        additionalJournalLines: refundAllocations.map((item) => ({ accountCode: item.accountCode, side: 'CREDIT' as const, amount: item.amount })),
        taxLines,
        context: { inspectionId, confirmationId, notes: dto.notes, refundMethod: row.refundMethod ?? 'ORIGINAL', refundAllocations },
      });
      await tx.eventOutbox.create({ data: {
        companyId: scope.companyId,
        eventType: 'sale.return.completed',
        aggregateType: 'SaleReturn',
        aggregateId: row.id,
        payload: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          returnId: row.id,
          accountingEventId: event.id,
        },
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'CONFIRM_SALE_RETURN',
        entityType: 'SaleReturn',
        entityId: row.id,
        payload: { branchId: scope.branchId, warehouseId: warehouse.id, accountingEventId: event.id },
      } });

      // T360-20260825 Fitur 3: koreksi poin loyalitas saat retur — REFUND append-only.
      // Poin yang dikoreksi = floor(gross refund / earnRate program), dibatasi saldo tersedia.
      if (row.saleId) {
        const program = await tx.loyaltyProgram.findFirst({
          where: { companyId: scope.companyId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, earnRate: true },
        });
        if (program) {
          const saleForPoints = await tx.sale.findUnique({ where: { id: row.saleId }, select: { total: true, customerId: true } });
          const account = saleForPoints?.customerId
            ? await tx.loyaltyAccount.findUnique({
                where: { programId_customerId: { programId: program.id, customerId: saleForPoints.customerId } },
              })
            : null;
          if (account) {
            const earnedOnReturnedAmount = Math.floor(Number(gross) * Number(program.earnRate));
            const pointsToRevoke = Math.min(earnedOnReturnedAmount, account.points);
            if (pointsToRevoke > 0) {
              const newBalance = account.points - pointsToRevoke;
              await tx.loyaltyAccount.update({ where: { id: account.id }, data: { points: newBalance } });
              await tx.loyaltyTransaction.create({ data: {
                accountId: account.id,
                type: 'REFUND',
                points: -pointsToRevoke,
                balanceAfter: newBalance,
                referenceType: 'SaleReturn',
                referenceId: row.id,
                notes: `Koreksi poin karena retur ${row.number}`,
              } });
            }
          }
        }
      }
      return tx.saleReturn.update({
        where: { id: row.id },
        data: {
          status: 'COMPLETED',
          approvedById: user.sub,
          inspectionId,
          confirmationId,
          accountingEventId: event.id,
          refundDetails: refundAllocations as unknown as Prisma.InputJsonValue,
          postedAt: new Date(),
        },
        include: { items: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createPurchaseReturn(dto: CreatePurchaseReturnDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.items.length) throw new BadRequestException('Retur pembelian harus memiliki item.');
    const scopedReceipt = await this.prisma.goodsReceipt.findFirst({
      where: {
        id: dto.goodsReceiptId,
        warehouse: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
      },
      select: { id: true },
    });
    if (!scopedReceipt) return this.denyTenantAccess(this.prisma, user, scope, 'GoodsReceipt', dto.goodsReceiptId);

    const idempotencyScope = dto.idempotencyKey ? 'purchase-return:create' : null;
    return serializableTx(this.prisma, async (tx) => {
        if (idempotencyScope) {
          const gate = await beginIdempotent(tx, {
            companyId: scope.companyId,
            scope: idempotencyScope,
            key: dto.idempotencyKey!,
            payload: dto,
          });
          if (gate.replay && gate.status === 'COMPLETED') return gate.response as never;
        }

        const receipt = await tx.goodsReceipt.findFirst({
          where: {
            id: dto.goodsReceiptId,
            warehouse: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
            supplier: { companyId: scope.companyId },
            items: { every: { product: { companyId: scope.companyId } } },
          },
          include: { items: true, warehouse: { include: { branch: true } } },
        });
        if (!receipt) throw new ForbiddenException('GoodsReceipt tidak tersedia dalam company dan branch pengguna.');
        if (!['CONFIRMED','PARTIALLY_ACCEPTED'].includes(receipt.operationalStatus)) {
          throw new BadRequestException('Retur supplier hanya dapat dibuat dari penerimaan yang sudah diposting ke stok dan akuntansi.');
        }

        const previousReturns = await tx.purchaseReturn.findMany({
          where: {
            goodsReceiptId: receipt.id,
            status: { in: ['DRAFT','REQUESTED','APPROVED','RECEIVED','COMPLETED'] },
          },
          include: { items: true },
        });
        const alreadyReturned = new Map<string, number>();
        const purchaseAllocation = new Map<string, HistoricalReturnState>();
        for (const previous of previousReturns) {
          for (const item of previous.items) {
            const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
              ? item.metadata as Record<string, unknown>
              : undefined;
            const goodsReceiptItemId = typeof metadata?.goodsReceiptItemId === 'string' ? metadata.goodsReceiptItemId : undefined;
            if (goodsReceiptItemId) {
              alreadyReturned.set(goodsReceiptItemId, (alreadyReturned.get(goodsReceiptItemId) ?? 0) + item.quantity);
              const state = purchaseAllocation.get(goodsReceiptItemId) ?? zeroHistoricalReturnState();
              state.quantity += item.quantity;
              state.net = state.net.add(item.netAmount);
              state.tax = state.tax.add(item.taxAmount);
              state.gross = state.gross.add(item.grossAmount);
              purchaseAllocation.set(goodsReceiptItemId, state);
            }
          }
        }
        const requestedNow = new Map<string, number>();
        for (const input of dto.items) requestedNow.set(input.goodsReceiptItemId, (requestedNow.get(input.goodsReceiptItemId) ?? 0) + input.quantity);
        for (const [goodsReceiptItemId, requestedQty] of requestedNow) {
          const original = receipt.items.find((item) => item.id === goodsReceiptItemId);
          const used = alreadyReturned.get(goodsReceiptItemId) ?? 0;
          if (!original || requestedQty <= 0 || used + requestedQty > original.acceptedQty) {
            throw new BadRequestException(`Jumlah retur penerimaan ${goodsReceiptItemId} melebihi sisa yang dapat diretur.`);
          }
        }

        const rows = dto.items.map((input) => {
          const original = receipt.items.find((item) => item.id === input.goodsReceiptItemId);
          if (!original || input.quantity > original.acceptedQty) {
            throw new BadRequestException(`Jumlah retur penerimaan ${input.goodsReceiptItemId} tidak valid.`);
          }
          const factor = Math.max(1, Number(original.quantityFactor ?? 1));
          const returnedUnitQuantity = input.quantity % factor === 0 ? input.quantity / factor : null;
          const allocation = purchaseAllocation.get(original.id) ?? zeroHistoricalReturnState();
          const netAmount = allocateHistoricalRemainder(original.subtotal, allocation.net, input.quantity, original.acceptedQty, allocation.quantity);
          const taxAmount = allocateHistoricalRemainder(original.taxAmount, allocation.tax, input.quantity, original.acceptedQty, allocation.quantity);
          const grossAmount = allocateHistoricalRemainder(original.grossSubtotal, allocation.gross, input.quantity, original.acceptedQty, allocation.quantity);
          allocation.quantity += input.quantity;
          allocation.net = allocation.net.add(netAmount);
          allocation.tax = allocation.tax.add(taxAmount);
          allocation.gross = allocation.gross.add(grossAmount);
          purchaseAllocation.set(original.id, allocation);
          return {
            productId: original.productId,
            variantId: original.variantId ?? null,
            productUnitId: original.productUnitId ?? null,
            unitCode: original.unitCode ?? null,
            unitQuantity: returnedUnitQuantity,
            quantityFactor: factor,
            sourceBarcode: null,
            quantity: input.quantity,
            unitCost: original.unitCost,
            netAmount,
            taxAmount,
            grossAmount,
            taxCodeId: original.taxCodeId,
            reason: input.reason,
            metadata: { goodsReceiptItemId: original.id, sourceBaseQuantity: original.acceptedQty, sourceUnitQuantity: original.unitQuantity ?? null },
          };
        });
        await this.assertReturnTaxCodes(tx, user, scope, rows.map((row) => row.taxCodeId));
        const amount = rows.reduce((sum, item) => sum.add(item.grossAmount), new Prisma.Decimal(0));
        const created = await tx.purchaseReturn.create({
          data: {
            number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PURCHASE_RETURN', prefix: 'PRT' }),
            purchaseOrderId: receipt.purchaseOrderId,
            goodsReceiptId: receipt.id,
            supplierId: receipt.supplierId,
            warehouseId: receipt.warehouseId,
            status: 'REQUESTED',
            reason: dto.reason,
            amount,
            supplierCreditNoteNumber: dto.supplierCreditNoteNumber?.trim() || undefined,
            createdById: user.sub,
            items: { create: rows },
          },
          include: { items: true },
        });
        const inspection = await this.operations.createInspectionInTransaction(tx, {
          companyId: scope.companyId,
          branchId: scope.branchId,
          type: 'OTHER' as never,
          sourceType: 'PurchaseReturn',
          sourceId: created.id,
          templateCode: 'RETURN-OUTBOUND-STANDARD',
          metadata: { goodsReceiptId: receipt.id, warehouseId: receipt.warehouseId },
        }, user);
        const updated = await tx.purchaseReturn.update({
          where: { id: created.id },
          data: { inspectionId: inspection.id },
          include: { items: true },
        });
        await tx.auditLog.create({ data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_PURCHASE_RETURN',
          entityType: 'PurchaseReturn',
          entityId: created.id,
          payload: { branchId: scope.branchId, goodsReceiptId: receipt.id, warehouseId: receipt.warehouseId },
        } });
        if (idempotencyScope) {
          await completeIdempotent(tx, {
            companyId: scope.companyId,
            scope: idempotencyScope,
            key: dto.idempotencyKey!,
            resourceType: 'PurchaseReturn',
            resourceId: updated.id,
            response: updated,
          });
        }
        return updated;
    });
  }

  async confirmPurchaseReturn(id: string, dto: ConfirmReturnDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await this.scopedPurchaseReturn(tx, user, scope, id);
      if (!['REQUESTED','APPROVED'].includes(row.status)) {
        throw new BadRequestException(`Retur berstatus ${row.status}.`);
      }
      const inspectionId = dto.inspectionId ?? row.inspectionId;
      const inspection = await this.assertInspection(tx, user, scope, inspectionId, 'PurchaseReturn', row.id);
      if (inspection && !['PASSED','PARTIAL','APPROVED'].includes(inspection.status)) {
        throw new BadRequestException('Pemeriksaan barang keluar retur belum lulus.');
      }
      if (inspection?.status === 'PARTIAL') {
        throw new BadRequestException('Pemeriksaan retur supplier memiliki mismatch dan harus disetujui sebelum stok/jurnal diposting.');
      }
      const confirmationId = dto.confirmationId ?? row.confirmationId;
      await this.assertConfirmation(tx, user, scope, confirmationId, 'PurchaseReturn', row.id);
      const gatePassId = dto.gatePassId ?? row.gatePassId;
      if (gatePassId) {
        const pass = await tx.gatePass.findFirst({
          where: {
            id: gatePassId,
            companyId: scope.companyId,
            branchId: scope.branchId,
            sourceType: 'PurchaseReturn',
            sourceId: row.id,
          },
        });
        if (!pass) return this.denyTenantAccess(tx, user, scope, 'GatePass', gatePassId);
        if (!['APPROVED','EXITED'].includes(pass.status)) {
          throw new BadRequestException('Gate pass retur supplier belum disetujui.');
        }
      }
      const warehouse = await this.assertWarehouse(tx, user, scope, row.warehouseId);
      await this.assertReturnTaxCodes(tx, user, scope, row.items.map((item) => item.taxCodeId));
      if (!row.goodsReceiptId) throw new BadRequestException('Retur supplier tidak memiliki referensi penerimaan barang.');
      const sourceReceipt = await tx.goodsReceipt.findFirst({
        where: {
          id: row.goodsReceiptId,
          warehouseId: row.warehouseId,
          supplierId: row.supplierId,
          warehouse: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
          supplier: { companyId: scope.companyId },
          items: { every: { product: { companyId: scope.companyId } } },
        },
        include: { items: true },
      });
      if (!sourceReceipt || !['CONFIRMED','PARTIALLY_ACCEPTED'].includes(sourceReceipt.operationalStatus)) {
        throw new BadRequestException('Penerimaan asal retur tidak valid atau belum diposting.');
      }
      const otherReturns = await tx.purchaseReturn.findMany({
        where: {
          goodsReceiptId: sourceReceipt.id,
          id: { not: row.id },
          status: { in: ['DRAFT','REQUESTED','APPROVED','RECEIVED','COMPLETED'] },
        },
        include: { items: true },
      });
      const alreadyReturned = new Map<string, number>();
      for (const previous of otherReturns) {
        for (const item of previous.items) {
          const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
            ? item.metadata as Record<string, unknown>
            : undefined;
          const goodsReceiptItemId = typeof metadata?.goodsReceiptItemId === 'string' ? metadata.goodsReceiptItemId : undefined;
          if (goodsReceiptItemId) alreadyReturned.set(goodsReceiptItemId, (alreadyReturned.get(goodsReceiptItemId) ?? 0) + item.quantity);
        }
      }
      const requestedByReceiptItem = new Map<string, number>();
      for (const item of row.items) {
        const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? item.metadata as Record<string, unknown>
          : undefined;
        const goodsReceiptItemId = typeof metadata?.goodsReceiptItemId === 'string' ? metadata.goodsReceiptItemId : undefined;
        if (!goodsReceiptItemId) throw new BadRequestException(`Item retur ${item.id} kehilangan referensi goods receipt item.`);
        requestedByReceiptItem.set(goodsReceiptItemId, (requestedByReceiptItem.get(goodsReceiptItemId) ?? 0) + item.quantity);
      }
      for (const [goodsReceiptItemId, requestedQty] of requestedByReceiptItem) {
        const original = sourceReceipt.items.find((item) => item.id === goodsReceiptItemId);
        const used = alreadyReturned.get(goodsReceiptItemId) ?? 0;
        if (!original || used + requestedQty > original.acceptedQty) {
          throw new BadRequestException(`Retur melebihi sisa kuantitas penerimaan untuk item ${goodsReceiptItemId}.`);
        }
      }
      // Retur supplier dapat menyentuh invoice yang sebagian/seluruhnya sudah dibayar.
      // Bagian yang masih menjadi AP mengurangi 2101; kelebihannya berubah menjadi
      // piutang refund supplier (1202) dan wajib mempunyai nomor credit note supplier.
      const completedReturnAmount = otherReturns
        .filter((previous) => previous.status === 'COMPLETED')
        .reduce((sum, previous) => sum.add(previous.amount), new Prisma.Decimal(0));
      const postedSupplierPayments = await tx.operationalFinanceTransaction.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          type: 'SUPPLIER_PAYMENT',
          referenceType: 'GoodsReceipt',
          referenceId: sourceReceipt.id,
          status: { in: ['POSTED', 'PAID'] },
        },
        select: { grossAmount: true },
      });
      const paidAmount = postedSupplierPayments.reduce((sum, payment) => sum.add(payment.grossAmount), new Prisma.Decimal(0));
      const rawOpenPayable = new Prisma.Decimal(sourceReceipt.grossTotal).sub(completedReturnAmount).sub(paidAmount);
      const openPayable = rawOpenPayable.greaterThan(0) ? rawOpenPayable : new Prisma.Decimal(0);
      const payableOffset = row.amount.lessThan(openPayable) ? row.amount : openPayable;
      const supplierReceivable = row.amount.sub(payableOffset);
      const supplierCreditNoteNumber = dto.supplierCreditNoteNumber?.trim() || row.supplierCreditNoteNumber?.trim();
      if (supplierReceivable.greaterThan(0) && !supplierCreditNoteNumber) {
        throw new BadRequestException(
          `Retur supplier menciptakan piutang refund ${supplierReceivable.toFixed(2)} karena barang sudah dibayar. `
          + 'Nomor credit note supplier wajib dicatat sebelum retur diposting.',
        );
      }
      for (const item of row.items) {
        const inventory = await tx.inventory.findUnique({
          where: { warehouseId_productId: { warehouseId: row.warehouseId, productId: item.productId } },
        });
        if (!inventory || inventory.available < item.quantity) {
          throw new BadRequestException(`Stok retur produk ${item.productId} tidak mencukupi.`);
        }
        const allocations = await consumeAvailableLocationStock(tx, { warehouseId: row.warehouseId, productId: item.productId, quantity: item.quantity });
        const updated = await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: item.quantity }, available: { decrement: item.quantity } },
        });
        for (const allocation of allocations) await tx.inventoryMovement.create({ data: {
          warehouseId: row.warehouseId,
          productId: item.productId,
          locationId: allocation.locationId,
          type: 'PURCHASE_RETURN',
          quantity: -allocation.quantity,
          balanceAfter: updated.quantity,
          referenceType: 'PurchaseReturn',
          referenceId: row.id,
        } });
        const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? item.metadata as Record<string, unknown>
          : undefined;
        const goodsReceiptItemId = typeof metadata?.goodsReceiptItemId === 'string' ? metadata.goodsReceiptItemId : undefined;
        const originalReceiptItem = goodsReceiptItemId ? sourceReceipt.items.find((source) => source.id === goodsReceiptItemId) : undefined;
        if (originalReceiptItem?.batchNumber) {
          const batch = await tx.inventoryBatch.findUnique({
            where: { warehouseId_productId_batchNumber: { warehouseId: row.warehouseId, productId: item.productId, batchNumber: originalReceiptItem.batchNumber } },
          });
          if (!batch || batch.quantity - batch.reserved < item.quantity) {
            throw new BadRequestException(`Stok batch ${originalReceiptItem.batchNumber} tidak mencukupi untuk retur supplier.`);
          }
          await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: item.quantity } } });
        }
      }
      const net = row.items.reduce((sum, item) => sum.add(item.netAmount), new Prisma.Decimal(0));
      const tax = row.items.reduce((sum, item) => sum.add(item.taxAmount), new Prisma.Decimal(0));
      const gross = row.items.reduce((sum, item) => sum.add(item.grossAmount), new Prisma.Decimal(0));
      const taxLines = row.items
        .filter((item) => item.taxCodeId && !item.taxAmount.isZero())
        .map((item) => ({
          taxCodeId: item.taxCodeId!,
          direction: 'INPUT' as TaxTransactionDirection,
          taxableBase: item.netAmount.negated(),
          taxAmount: item.taxAmount.negated(),
          counterpartyType: 'Supplier',
          counterpartyId: row.supplierId,
          documentNumber: row.number,
        }));
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        eventType: 'PURCHASE_RETURN',
        sourceType: 'PurchaseReturn',
        sourceId: row.id,
        idempotencyKey: `purchase-return:${row.id}`,
        amounts: { net, inputTax: tax, gross, payableOffset, supplierReceivable },
        accountCodes: { payable: '2101', supplierReceivable: '1202', inventory: '1301', inputTax: '1205' },
        taxLines,
        context: { inspectionId, gatePassId, confirmationId, notes: dto.notes, supplierCreditNoteNumber, payableOffset: payableOffset.toFixed(2), supplierReceivable: supplierReceivable.toFixed(2) },
      });
      await tx.eventOutbox.create({ data: {
        companyId: scope.companyId,
        eventType: 'purchase.return.completed',
        aggregateType: 'PurchaseReturn',
        aggregateId: row.id,
        payload: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          returnId: row.id,
          accountingEventId: event.id,
        },
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'CONFIRM_PURCHASE_RETURN',
        entityType: 'PurchaseReturn',
        entityId: row.id,
        payload: { branchId: scope.branchId, warehouseId: warehouse.id, accountingEventId: event.id },
      } });
      return tx.purchaseReturn.update({
        where: { id: row.id },
        data: {
          status: 'COMPLETED',
          approvedById: user.sub,
          inspectionId,
          confirmationId,
          gatePassId,
          accountingEventId: event.id,
          payableOffsetAmount: payableOffset,
          supplierReceivableAmount: supplierReceivable,
          supplierCreditNoteNumber,
          postedAt: new Date(),
        },
        include: { items: true },
      });
    });
  }

  private async scopedOrderReturn(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.orderReturn.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
      include: {
        items: { include: { product: true, orderItem: true } },
        order: { include: { payments: true } },
        warehouse: true,
        customer: true,
      },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'OrderReturn', id);
    await this.assertWarehouse(client, user, scope, row.warehouseId);
    return row;
  }

  async listOrderReturns(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.orderReturn.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      include: {
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        order: { select: { id: true, number: true, status: true, customerName: true, customerEmail: true, total: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
  }

  async listCustomerOrderReturns(branchCode?: string, token?: string) {
    const identity = await this.storefrontCustomers.authenticate(branchCode, token);
    return this.prisma.orderReturn.findMany({
      where: { companyId: identity.companyId, branchId: identity.branchId, customerId: identity.customerId },
      include: {
        items: { include: { product: { select: { id: true, sku: true, name: true } }, orderItem: true } },
        order: { select: { id: true, number: true, status: true, total: true, createdAt: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async createCustomerOrderReturn(dto: CreateCustomerOrderReturnDto, branchCode?: string, token?: string) {
    if (!dto.items.length) throw new BadRequestException('Retur pesanan harus memiliki item.');
    const identity = await this.storefrontCustomers.authenticate(branchCode, token);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          id: dto.orderId,
          branchId: identity.branchId,
          customerId: identity.customerId,
          branch: { companyId: identity.companyId },
          status: 'COMPLETED',
        },
        include: { items: true, payments: true },
      });
      if (!order) throw new BadRequestException('Retur hanya dapat diajukan untuk pesanan akun yang sudah selesai.');
      const previousReturns = await tx.orderReturn.findMany({
        where: { orderId: order.id, status: { in: ['REQUESTED','INSPECTION','APPROVED','COMPLETED'] } },
        include: { items: true },
      });
      const alreadyReturned = new Map<string, number>();
      const orderAllocation = new Map<string, HistoricalReturnState>();
      for (const previous of previousReturns) {
        for (const item of previous.items) {
          alreadyReturned.set(item.orderItemId, (alreadyReturned.get(item.orderItemId) ?? 0) + item.quantity);
          const state = orderAllocation.get(item.orderItemId) ?? zeroHistoricalReturnState();
          state.quantity += item.quantity;
          state.net = state.net.add(item.netAmount);
          state.tax = state.tax.add(item.taxAmount);
          state.gross = state.gross.add(item.grossAmount);
          orderAllocation.set(item.orderItemId, state);
        }
      }
      const requestedNow = new Map<string, number>();
      for (const input of dto.items) requestedNow.set(input.orderItemId, (requestedNow.get(input.orderItemId) ?? 0) + input.quantity);
      const rows = [] as Array<{
        orderItemId: string; productId: string; variantId: string | null; productUnitId: string | null; unitCode: string | null;
        unitQuantity: number; quantityFactor: number; sourceBarcode: string | null; quantity: number; condition: string; restock: boolean;
        unitAmount: Prisma.Decimal; unitCost: Prisma.Decimal; netAmount: Prisma.Decimal; taxAmount: Prisma.Decimal;
        grossAmount: Prisma.Decimal; taxCodeId: string | null;
      }>;
      for (const [orderItemId, requestedUnitQty] of requestedNow) {
        const original = order.items.find((item) => item.id === orderItemId);
        if (!original || requestedUnitQty <= 0) {
          throw new BadRequestException(`Jumlah retur item ${orderItemId} tidak valid.`);
        }
        const factor = Math.max(1, Number(original.quantityFactor ?? 1));
        const sourceUnitQuantity = original.unitQuantity ?? Math.floor(original.quantity / factor);
        const requestedBaseQty = requestedUnitQty * factor;
        const usedBaseQty = alreadyReturned.get(orderItemId) ?? 0;
        if (!Number.isSafeInteger(requestedBaseQty) || requestedBaseQty < 1 || requestedUnitQty > sourceUnitQuantity || usedBaseQty + requestedBaseQty > original.quantity) {
          throw new BadRequestException(`Jumlah retur item ${orderItemId} melebihi sisa yang dapat diretur dalam ${original.unitCode ?? 'base unit'}.`);
        }
        const allocation = orderAllocation.get(original.id) ?? zeroHistoricalReturnState();
        const netAmount = allocateHistoricalRemainder(original.netSubtotal, allocation.net, requestedBaseQty, original.quantity, allocation.quantity);
        const taxAmount = allocateHistoricalRemainder(original.taxAmount, allocation.tax, requestedBaseQty, original.quantity, allocation.quantity);
        const grossAmount = allocateHistoricalRemainder(original.grossSubtotal, allocation.gross, requestedBaseQty, original.quantity, allocation.quantity);
        allocation.quantity += requestedBaseQty;
        allocation.net = allocation.net.add(netAmount);
        allocation.tax = allocation.tax.add(taxAmount);
        allocation.gross = allocation.gross.add(grossAmount);
        orderAllocation.set(original.id, allocation);
        rows.push({
          orderItemId: original.id,
          productId: original.productId,
          variantId: original.variantId ?? null,
          productUnitId: original.productUnitId ?? null,
          unitCode: original.unitCode ?? null,
          unitQuantity: requestedUnitQty,
          quantityFactor: factor,
          sourceBarcode: original.sourceBarcode ?? null,
          quantity: requestedBaseQty,
          condition: 'PENDING_INSPECTION',
          restock: false,
          unitAmount: original.unitPrice,
          unitCost: original.unitCost,
          netAmount,
          taxAmount,
          grossAmount,
          taxCodeId: original.taxCodeId,
        });
      }
      const taxCodeIds = [...new Set(rows.map((row) => row.taxCodeId).filter(Boolean) as string[])];
      if (taxCodeIds.length) {
        const validTaxCodes = await tx.taxCode.count({ where: { id: { in: taxCodeIds }, companyId: identity.companyId } });
        if (validTaxCodes !== taxCodeIds.length) throw new BadRequestException('Tax code retur tidak valid untuk company storefront.');
      }
      const refundAmount = rows.reduce((sum, row) => sum.add(row.grossAmount), new Prisma.Decimal(0));
      const created = await tx.orderReturn.create({
        data: {
          number: await nextDocumentNumber(tx, { companyId: identity.companyId, branchId: identity.branchId, documentType: 'ORDER_RETURN', prefix: 'ORT' }),
          companyId: identity.companyId,
          branchId: identity.branchId,
          orderId: order.id,
          warehouseId: order.warehouseId,
          customerId: identity.customerId,
          status: 'REQUESTED',
          reason: dto.reason?.trim() || null,
          refundMethod: dto.refundMethod ?? 'ORIGINAL',
          refundAmount,
          items: { create: rows },
        },
        include: { items: { include: { product: true } }, order: true },
      });
      await tx.auditLog.create({ data: {
        companyId: identity.companyId,
        action: 'CUSTOMER_ORDER_RETURN_REQUESTED',
        entityType: 'OrderReturn',
        entityId: created.id,
        payload: { branchId: identity.branchId, customerId: identity.customerId, orderId: order.id, refundAmount: refundAmount.toFixed(2) },
      } });
      await tx.eventOutbox.create({ data: {
        companyId: identity.companyId,
        eventType: 'commerce.order.return.requested',
        aggregateType: 'OrderReturn',
        aggregateId: created.id,
        payload: { companyId: identity.companyId, branchId: identity.branchId, customerId: identity.customerId, orderId: order.id, returnId: created.id },
      } });
      return created;
    });
  }

  async startOrderReturnInspection(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await this.scopedOrderReturn(tx, user, scope, id);
      if (row.status === 'INSPECTION' && row.inspectionId) return row;
      if (row.status !== 'REQUESTED') throw new BadRequestException(`Retur order berstatus ${row.status}.`);
      const inspection = await this.operations.createInspectionInTransaction(tx, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        type: 'RETURN_INBOUND' as never,
        sourceType: 'OrderReturn',
        sourceId: row.id,
        templateCode: 'RETURN-INBOUND-STANDARD',
        metadata: { orderId: row.orderId, warehouseId: row.warehouseId, customerId: row.customerId },
      }, user);
      if (row.items.length) {
        await tx.inspectionResultItem.createMany({ data: row.items.map((item) => ({
          inspectionId: inspection.id,
          code: `ORDER_RETURN_ITEM:${item.id}`,
          label: `${item.product.sku} · ${item.product.name}`,
          result: 'OBSERVATION',
          productId: item.productId,
          expectedQty: item.quantity,
          scannedQty: 0,
          acceptedQty: 0,
          rejectedQty: 0,
          damagedQty: 0,
          missingQty: 0,
          extraQty: 0,
        })) });
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'START_ORDER_RETURN_INSPECTION', entityType: 'OrderReturn', entityId: row.id, payload: { branchId: scope.branchId, inspectionId: inspection.id } } });
      return tx.orderReturn.update({ where: { id: row.id }, data: { status: 'INSPECTION', inspectionId: inspection.id }, include: { items: { include: { product: true } }, order: true } });
    });
  }

  async rejectOrderReturn(id: string, dto: RejectOrderReturnDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.reason.trim()) throw new BadRequestException('Alasan penolakan retur wajib diisi.');
    return serializableTx(this.prisma, async (tx) => {
      const row = await this.scopedOrderReturn(tx, user, scope, id);
      if (row.status === 'REJECTED') return row;
      if (!['REQUESTED','INSPECTION'].includes(row.status)) throw new BadRequestException(`Retur order berstatus ${row.status}.`);
      if (row.inspectionId) {
        await tx.operationalInspection.updateMany({ where: { id: row.inspectionId, companyId: scope.companyId, branchId: scope.branchId, status: { notIn: ['APPROVED','REJECTED','CANCELLED'] } }, data: { status: 'REJECTED', reviewedById: user.sub, summary: { rejectionReason: dto.reason.trim() } } });
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'REJECT_ORDER_RETURN', entityType: 'OrderReturn', entityId: row.id, payload: { branchId: scope.branchId, reason: dto.reason.trim() } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'commerce.order.return.rejected', aggregateType: 'OrderReturn', aggregateId: row.id, payload: { companyId: scope.companyId, branchId: scope.branchId, returnId: row.id, orderId: row.orderId, reason: dto.reason.trim() } } });
      return tx.orderReturn.update({ where: { id: row.id }, data: { status: 'REJECTED', approvedById: user.sub }, include: { items: { include: { product: true } }, order: true } });
    });
  }

  async confirmOrderReturn(id: string, dto: ConfirmOrderReturnDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await this.scopedOrderReturn(tx, user, scope, id);
      if (row.status === 'COMPLETED') return row;
      if (!['INSPECTION','APPROVED'].includes(row.status)) throw new BadRequestException(`Retur order berstatus ${row.status}.`);
      if (!row.inspectionId) throw new BadRequestException('Retur order belum memiliki inspeksi inbound.');
      const inspection = await tx.operationalInspection.findFirst({ where: { id: row.inspectionId, companyId: scope.companyId, branchId: scope.branchId }, include: { results: true } });
      if (!inspection || inspection.sourceType !== 'OrderReturn' || inspection.sourceId !== row.id || inspection.status !== 'APPROVED') {
        throw new BadRequestException('Inspeksi retur order harus APPROVED sebelum refund diposting.');
      }
      const resultByCode = new Map(inspection.results.map((result) => [result.code, result]));
      const restockableItemIds: string[] = [];
      for (const item of row.items) {
        const result = resultByCode.get(`ORDER_RETURN_ITEM:${item.id}`);
        if (!result) throw new BadRequestException(`Hasil inspeksi item ${item.id} tidak ditemukan.`);
        const expected = result.expectedQty ?? item.quantity;
        const accepted = result.acceptedQty ?? 0;
        const rejected = result.rejectedQty ?? 0;
        const damaged = result.damagedQty ?? 0;
        if (expected !== item.quantity || accepted + rejected !== expected) throw new BadRequestException(`Kuantitas inspeksi item ${item.id} belum lengkap.`);
        const restock = result.result === 'PASS' && rejected === 0 && damaged === 0 && accepted === expected;
        if (restock) restockableItemIds.push(item.id);
        await tx.orderReturnItem.update({ where: { id: item.id }, data: { condition: restock ? 'GOOD' : damaged > 0 ? 'DAMAGED' : 'UNSELLABLE', restock } });
        if (restock) {
          const locationStock = await depositLocationStock(tx, { warehouseId: row.warehouseId, productId: item.productId, quantity: item.quantity });
          const inventory = await tx.inventory.upsert({
            where: { warehouseId_productId: { warehouseId: row.warehouseId, productId: item.productId } },
            create: { warehouseId: row.warehouseId, productId: item.productId, quantity: item.quantity, available: item.quantity },
            update: { quantity: { increment: item.quantity }, available: { increment: item.quantity } },
          });
          await tx.inventoryMovement.create({ data: { warehouseId: row.warehouseId, productId: item.productId, locationId: locationStock.locationId, type: 'SALE_RETURN', quantity: item.quantity, balanceAfter: inventory.quantity, referenceType: 'OrderReturn', referenceId: row.id } });
        }
      }
      await this.assertReturnTaxCodes(tx, user, scope, row.items.map((item) => item.taxCodeId));
      const net = row.items.reduce((sum, item) => sum.add(item.netAmount), new Prisma.Decimal(0));
      const tax = row.items.reduce((sum, item) => sum.add(item.taxAmount), new Prisma.Decimal(0));
      const gross = row.items.reduce((sum, item) => sum.add(item.grossAmount), new Prisma.Decimal(0));
      const cogs = row.items.filter((item) => restockableItemIds.includes(item.id)).reduce((sum, item) => sum.add(item.unitCost.mul(item.quantity)), new Prisma.Decimal(0));
      const payment = row.order.payments[0];
      const requestedMethod = dto.refundMethod ?? row.refundMethod ?? 'ORIGINAL';
      const refundMethod = requestedMethod === 'ORIGINAL' ? (payment?.method === 'COD' ? 'CASH' : payment?.method === 'INVOICE' ? 'RECEIVABLE' : 'BANK_TRANSFER') : requestedMethod;
      const reduceReceivable = refundMethod === 'RECEIVABLE' || (!payment || payment.status !== 'PAID') && ['COD','INVOICE'].includes(payment?.method ?? '');
      const settlementAmount = reduceReceivable ? new Prisma.Decimal(0) : gross;
      const receivableAmount = reduceReceivable ? gross : new Prisma.Decimal(0);
      const taxLines = row.items.filter((item) => item.taxCodeId && !item.taxAmount.isZero()).map((item) => ({
        taxCodeId: item.taxCodeId!, direction: 'OUTPUT' as TaxTransactionDirection,
        taxableBase: item.netAmount.negated(), taxAmount: item.taxAmount.negated(), counterpartyType: 'CUSTOMER', counterpartyId: row.customerId ?? undefined, documentNumber: row.number,
      }));
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'ORDER_RETURN', sourceType: 'OrderReturn', sourceId: row.id,
        idempotencyKey: `order-return:${row.id}`,
        amounts: { net, outputTax: tax, gross, settlement: settlementAmount, receivable: receivableAmount, inventory: cogs, cogs },
        accountCodes: { returns: '4102', outputTax: '2201', settlement: refundMethod === 'CASH' ? '1101' : '1102', receivable: payment?.method === 'COD' ? '1203' : '1201', inventory: '1301', cogs: '5101' },
        taxLines,
        context: { orderId: row.orderId, inspectionId: row.inspectionId, refundMethod, notes: dto.notes, restockableItemIds },
      });
      const activeReturns = await tx.orderReturn.findMany({ where: { orderId: row.orderId, id: { not: row.id }, status: 'COMPLETED' }, include: { items: true } });
      let loyaltyRevoked = 0;
      if (row.customerId) {
        const program = await tx.loyaltyProgram.findFirst({ where: { companyId: scope.companyId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, earnRate: true } });
        if (program) {
          const [account, earned] = await Promise.all([
            tx.loyaltyAccount.findUnique({ where: { programId_customerId: { programId: program.id, customerId: row.customerId } }, select: { id: true, points: true } }),
            tx.loyaltyTransaction.findFirst({ where: { type: 'EARN', referenceType: 'Order', referenceId: row.orderId }, orderBy: { createdAt: 'asc' }, select: { points: true } }),
          ]);
          if (account && earned?.points) {
            const previousReturnIds = activeReturns.map((item) => item.id);
            const previous = previousReturnIds.length
              ? await tx.loyaltyTransaction.aggregate({ where: { accountId: account.id, type: 'REFUND', referenceType: 'OrderReturn', referenceId: { in: previousReturnIds } }, _sum: { points: true } })
              : { _sum: { points: null } };
            const alreadyRevoked = Math.abs(previous._sum.points ?? 0);
            const remainingEarned = Math.max(0, earned.points - alreadyRevoked);
            const calculated = Math.max(0, Math.floor(Number(gross) * Number(program.earnRate)));
            loyaltyRevoked = Math.min(calculated, remainingEarned, account.points);
            if (loyaltyRevoked > 0) {
              const nextBalance = account.points - loyaltyRevoked;
              await tx.loyaltyAccount.update({ where: { id: account.id }, data: { points: nextBalance } });
              await tx.loyaltyTransaction.create({ data: {
                accountId: account.id, type: 'REFUND', points: -loyaltyRevoked, balanceAfter: nextBalance,
                referenceType: 'OrderReturn', referenceId: row.id, notes: `Koreksi poin karena retur order ${row.number}`,
              } });
            }
          }
        }
      }
      const returnedByOrderItem = new Map<string, number>();
      for (const previous of activeReturns) for (const item of previous.items) returnedByOrderItem.set(item.orderItemId, (returnedByOrderItem.get(item.orderItemId) ?? 0) + item.quantity);
      for (const item of row.items) returnedByOrderItem.set(item.orderItemId, (returnedByOrderItem.get(item.orderItemId) ?? 0) + item.quantity);
      const orderItems = await tx.orderItem.findMany({ where: { orderId: row.orderId }, select: { id: true, quantity: true } });
      const fullOrderReturn = orderItems.every((item) => (returnedByOrderItem.get(item.id) ?? 0) >= item.quantity);
      if (fullOrderReturn) {
        await tx.order.update({ where: { id: row.orderId }, data: { status: 'REFUNDED' } });
        if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
      }
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'commerce.order.return.completed', aggregateType: 'OrderReturn', aggregateId: row.id, payload: { companyId: scope.companyId, branchId: scope.branchId, returnId: row.id, orderId: row.orderId, accountingEventId: event.id, fullOrderReturn, loyaltyRevoked } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CONFIRM_ORDER_RETURN', entityType: 'OrderReturn', entityId: row.id, payload: { branchId: scope.branchId, orderId: row.orderId, accountingEventId: event.id, refundMethod, fullOrderReturn, loyaltyRevoked } } });
      return tx.orderReturn.update({ where: { id: row.id }, data: { status: 'COMPLETED', refundMethod, accountingEventId: event.id, approvedById: user.sub, approvedAt: new Date(), postedAt: new Date() }, include: { items: { include: { product: true } }, order: true } });
    });
  }

}
