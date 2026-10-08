import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingCoreService, OperationalTaxLineInput } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { consumeAvailableLocationStock } from '../common/location-inventory';
import { serializableTx } from '../common/serializable-tx';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { normalizeTenderPolicy, TenderPolicy } from '../common/tender-policy';
import { resolveSellingUnitLine } from '../common/transaction-uom';
import { PrismaService } from '../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { SupervisorApprovalService } from '../supervisor-approval/supervisor-approval.service';
import { CashierCashMovementDto, CreateSaleDto, ReplayOfflineSalesDto } from './dto/create-sale.dto';
import { StockAlertService } from './stock-alert.service';

type TenantScope = { companyId: string; branchId: string };
type SaleCreateOptions = {
  occurredAt?: Date;
  offline?: { transactionId: string; deviceId: string; localId: string; sequence: number };
};
type TenderDefinition = { id: string; code: string; name: string; policy: TenderPolicy };
type ResolvedSalePayment = {
  method: string;
  amount: Prisma.Decimal;
  provider?: string;
  externalRef?: string;
  tender: TenderDefinition;
  feeAmount: Prisma.Decimal;
  settlementAmount: Prisma.Decimal;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}



/**
 * Chargeable service fee for a payment mix.
 *
 * A percentage fee has to be computed on the SETTLEMENT, not the basket: a card fee is a percentage
 * of what was actually charged, and a split payment pays different rates per method. Hard-fee
 * amounts are passed through untouched. A negative fee is clamped to zero rather than allowed to
 * become a discount, because `dto.serviceFee` comes straight from the request body.
 */
function serviceFeeFor(dto: Pick<CreateSaleDto, 'serviceFee'>, settlement: Prisma.Decimal): Prisma.Decimal {
  const requested = new Prisma.Decimal(dto.serviceFee ?? 0);
  if (requested.isNegative()) return new Prisma.Decimal(0);
  return requested.greaterThan(settlement) ? settlement : requested;
}

/**
 * A manual discount at or below this share of the subtotal is an ordinary cashier action; above it,
 * the till must carry a supervisor grant. Fixed here rather than configured so the threshold cannot
 * be raised from a screen — a per-branch configurable cap is a per-branch fraud setting.
 */
const SUPERVISOR_DISCOUNT_RATIO = new Prisma.Decimal('0.20');

/**
 * Cash leaving the drawer, and closing a shift that does not reconcile, are the two remaining ways a
 * cashier can move money without a second pair of eyes.
 *
 * Both were reachable with nothing but a free-text reason. Probed live against a CASHIER: CASH_OUT of
 * Rp 2.500.000 returned 201, and closing with Rp 1 declared against a drawer short Rp 2.311.201 also
 * returned 201 — the shortfall was recorded as a number and the shift simply closed. The supervisor
 * gate existed for exactly these actions (`SALE_CASH_MOVEMENT`, `SHIFT_CLOSE` are in the enum) and
 * nothing consumed them, so grep found no `consume()` call and the hole looked like dead code.
 *
 * Fixed thresholds rather than configured ones, for the same reason as the discount ratio: a
 * per-branch cash cap is a per-branch fraud setting. The daily float is the yardstick, not a fixed
 * rupiah figure — 5% of a small shop's float is petty cash, and 5% of a supermarket's is a payday.
 */
const SUPERVISOR_CASH_MOVEMENT_RATIO = new Prisma.Decimal('0.05');
/** A shortfall this small is ordinary change error; a supervisor is not summoned for loose coins. */
const SUPERVISOR_SHIFT_DIFFERENCE_TOLERANCE = 10000;

function syncErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingCoreService, private readonly stockAlerts: StockAlertService, private readonly promotions: PromotionsService, private readonly approvals: SupervisorApprovalService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException('Pengguna belum memiliki company dan branch yang valid.');
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async resolveSellingLine(
    client: Prisma.TransactionClient | PrismaService,
    scope: TenantScope,
    product: { id: string; unit: string; salePrice: Prisma.Decimal | number | string },
    input: { quantity: number; barcodeCode?: string; productUnitId?: string; variantId?: string },
    segmentCode?: string | null,
    occurredAt?: Date,
  ) {
    return resolveSellingUnitLine(client, scope, product, input, segmentCode, occurredAt);
  }

  private async tenderDefinitions(client: Prisma.TransactionClient | PrismaService, scope: TenantScope, activeOnly = true) {
    const rows = await client.masterReference.findMany({
      where: {
        companyId: scope.companyId,
        type: 'PAYMENT_METHOD',
        ...(activeOnly ? { isActive: true } : {}),
        OR: [{ branchId: null }, { branchId: scope.branchId }],
      },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
    return rows.map((row) => ({ id: row.id, code: row.code.trim().toUpperCase(), name: row.name, policy: normalizeTenderPolicy(row.code, row.metadata) }));
  }

  private tenderSnapshot(tender: TenderDefinition): Prisma.InputJsonValue {
    return {
      version: 1,
      referenceId: tender.id,
      code: tender.code,
      name: tender.name,
      policy: tender.policy as unknown as Prisma.InputJsonValue,
    };
  }

  private paymentIsCash(payment: { method: string; methodSnapshot?: Prisma.JsonValue | null }) {
    const snapshot = payment.methodSnapshot;
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      const policy = (snapshot as Record<string, unknown>).policy;
      if (policy && typeof policy === 'object' && !Array.isArray(policy) && (policy as Record<string, unknown>).kind === 'CASH') return true;
    }
    return payment.method === 'CASH';
  }

  private refundCashAmount(details: Prisma.JsonValue | null, fallbackMethod: string | null | undefined, fallbackAmount: Prisma.Decimal) {
    if (Array.isArray(details)) {
      return details.reduce<number>((sum, item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return sum;
        const row = item as Record<string, unknown>;
        if (row.kind !== 'CASH') return sum;
        const amount = Number(row.amount ?? 0);
        return Number.isFinite(amount) ? sum + amount : sum;
      }, 0);
    }
    return fallbackMethod === 'CASH' ? Number(fallbackAmount) : 0;
  }

  private async resolveSalePayments(
    client: Prisma.TransactionClient | PrismaService,
    scope: TenantScope,
    requested: Array<{ method: string; amount: Prisma.Decimal; provider?: string; externalRef?: string }>,
  ): Promise<ResolvedSalePayment[]> {
    const tenders = await this.tenderDefinitions(client, scope);
    const tenderMap = new Map(tenders.map((item) => [item.code, item]));
    const resolved = requested.map((item) => {
      const method = item.method.trim().toUpperCase();
      const tender = tenderMap.get(method);
      if (!tender) throw new BadRequestException(`Tender ${method} tidak aktif/diizinkan pada cabang ini.`);
      const provider = item.provider?.trim() || undefined;
      const externalRef = item.externalRef?.trim() || undefined;
      if (tender.policy.requiresProvider && !provider) throw new BadRequestException(`Tender ${method} mewajibkan provider.`);
      if (tender.policy.requiresReference && !externalRef) throw new BadRequestException(`Tender ${method} mewajibkan reference pembayaran.`);
      const amount = item.amount.toDecimalPlaces(2);
      const feeAmount = amount.mul(tender.policy.feeRatePercent).div(100).toDecimalPlaces(2);
      const settlementAmount = amount.sub(feeAmount);
      if (settlementAmount.isNegative()) throw new BadRequestException(`Fee tender ${method} melebihi nominal pembayaran.`);
      return { method, amount, provider, externalRef, tender, feeAmount, settlementAmount };
    });

    const settlementCodes = [...new Set(resolved.map((item) => item.tender.policy.settlementAccountCode))];
    const feeCodes = [...new Set(resolved.map((item) => item.tender.policy.feeAccountCode).filter((value): value is string => Boolean(value)))];
    const accounts = await client.account.findMany({
      where: {
        branchId: scope.branchId,
        code: { in: [...new Set([...settlementCodes, ...feeCodes])] },
        isActive: true,
        branch: { companyId: scope.companyId },
      },
      select: { code: true, type: true },
    });
    const accountMap = new Map(accounts.map((account) => [account.code, account.type]));
    for (const item of resolved) {
      if (accountMap.get(item.tender.policy.settlementAccountCode) !== 'ASSET') {
        throw new BadRequestException(`Akun settlement tender ${item.method} (${item.tender.policy.settlementAccountCode}) harus berupa akun aset aktif pada cabang.`);
      }
      if (item.feeAmount.greaterThan(0) && (!item.tender.policy.feeAccountCode || accountMap.get(item.tender.policy.feeAccountCode) !== 'EXPENSE')) {
        throw new BadRequestException(`Akun fee tender ${item.method} harus berupa akun beban aktif pada cabang.`);
      }
    }
    return resolved;
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
    const cursorFilter: Prisma.SaleWhereInput | undefined = cursor ? {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ],
    } : undefined;
    const rows = await this.prisma.sale.findMany({
      where: {
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
        AND: cursorFilter ? [cursorFilter] : undefined,
      },
      include: { items: { include: { product: true } }, payments: true, warehouse: true, customer: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  async currentShift(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.cashierShift.findFirst({
      where: {
        userId: user.sub,
        status: 'OPEN',
        user: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      },
      orderBy: { openedAt: 'desc' },
    });
  }

  async currentCashMovements(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const shift = await this.prisma.cashierShift.findFirst({
      where: { userId: user.sub, status: 'OPEN', user: { branchId: scope.branchId, branch: { companyId: scope.companyId } } },
      select: { id: true },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift) return [];
    return this.prisma.cashierCashMovement.findMany({
      where: { cashierShiftId: shift.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async recordCashMovement(user: AuthUser, dto: CashierCashMovementDto, grantId?: string) {
    const scope = this.requireTenantScope(user);
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) throw new BadRequestException('Nominal kas harus lebih besar dari nol.');
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Alasan kas masuk/keluar wajib diisi.');
    return serializableTx(this.prisma, async (tx) => {
      const shift = await tx.cashierShift.findFirst({
        where: { userId: user.sub, status: 'OPEN', user: { branchId: scope.branchId, branch: { companyId: scope.companyId } } },
        orderBy: { openedAt: 'desc' },
      });
      if (!shift) throw new BadRequestException('Buka shift kasir sebelum mencatat kas masuk/keluar.');
      // Gate the COMMIT path. Money in the drawer is what leaves, so CASH_IN (petty cash added for
      // change) stays an ordinary cashier action and only CASH_OUT is gated. The yardstick is the
      // float the shift started with, so the same rule fits a warung and a supermarket.
      if (dto.type === 'CASH_OUT') {
        const summary = await this.shiftCashSummary(tx, scope, shift);
        const float = new Prisma.Decimal(shift.openingCash)
          .plus(summary.cashSales)
          .plus(summary.cashIn)
          .minus(summary.cashRefunds);
        const amount = new Prisma.Decimal(dto.amount);
        if (float.greaterThan(0) && amount.dividedBy(float).greaterThan(SUPERVISOR_CASH_MOVEMENT_RATIO)) {
          if (!grantId) {
            throw new ForbiddenException('Pengambilan kas di atas 5% dari isi laci memerlukan persetujuan supervisor.');
          }
          this.approvals.consume(grantId, 'SALE_CASH_MOVEMENT', user);
        }
      }
      const movement = await tx.cashierCashMovement.create({
        data: { cashierShiftId: shift.id, type: dto.type, amount: new Prisma.Decimal(dto.amount), reason, createdById: user.sub },
      });
      await tx.auditLog.create({
        data: { companyId: scope.companyId, userId: user.sub, action: dto.type, entityType: 'CashierCashMovement', entityId: movement.id, payload: { shiftId: shift.id, amount: dto.amount, reason } },
      });
      return movement;
    });
  }

  async openShift(user: AuthUser, openingCash: number) {
    const scope = this.requireTenantScope(user);
    if (!Number.isFinite(openingCash) || openingCash < 0) throw new BadRequestException('Saldo awal kas tidak valid.');
    return serializableTx(this.prisma, async (tx) => {
      const existing = await tx.cashierShift.findFirst({
        where: {
          userId: user.sub,
          status: 'OPEN',
          user: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
        },
      });
      if (existing) throw new BadRequestException('Shift kasir sudah terbuka.');
      const shift = await tx.cashierShift.create({
        data: {
          userId: user.sub,
          openingCash: new Prisma.Decimal(openingCash),
          expectedCash: new Prisma.Decimal(openingCash),
          status: 'OPEN',
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'OPEN_CASHIER_SHIFT',
          entityType: 'CashierShift',
          entityId: shift.id,
          payload: { branchId: scope.branchId, openingCash },
        },
      });
      return shift;
    });
  }

  private async shiftCashSummary(
    client: Prisma.TransactionClient | PrismaService,
    scope: TenantScope,
    shift: { id: string; userId: string; openedAt: Date; closedAt: Date | null },
  ) {
    const end = shift.closedAt ?? new Date();
    const [payments, warehouseRows, cashMovements] = await Promise.all([
      client.payment.findMany({
        where: {
          status: 'PAID',
          sale: {
            is: {
              cashierShiftId: shift.id,
              branchId: scope.branchId,
              branch: { companyId: scope.companyId },
              status: 'COMPLETED',
            },
          },
        },
        select: { method: true, methodName: true, methodSnapshot: true, amount: true, settlementAccountCode: true, settlementBehavior: true, feeAmount: true, feeAccountCode: true },
      }),
      client.warehouse.findMany({
        where: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
        select: { id: true },
      }),
      client.cashierCashMovement.findMany({
        where: { cashierShiftId: shift.id, createdAt: { gte: shift.openedAt, lte: end } },
        select: { type: true, amount: true },
      }),
    ]);
    const paymentTotals = new Map<string, number>();
    const paymentBreakdown = new Map<string, { method: string; methodName: string; settlementAccountCode: string; settlementBehavior: string; grossAmount: number; feeAmount: number; netSettlementAmount: number; feeAccountCode: string | null }>();
    let cashSales = 0;
    for (const payment of payments) {
      const method = payment.method || 'UNKNOWN';
      paymentTotals.set(method, (paymentTotals.get(method) ?? 0) + Number(payment.amount));
      if (this.paymentIsCash(payment)) cashSales += Number(payment.amount);
      const fallbackPolicy = normalizeTenderPolicy(method, payment.settlementAccountCode ? { settlementAccountCode: payment.settlementAccountCode, settlementBehavior: payment.settlementBehavior ?? undefined, feeAccountCode: payment.feeAccountCode ?? undefined } : undefined);
      const settlementAccountCode = payment.settlementAccountCode ?? fallbackPolicy.settlementAccountCode;
      const settlementBehavior = payment.settlementBehavior ?? fallbackPolicy.settlementBehavior;
      const feeAmount = Number(payment.feeAmount ?? 0);
      const key = [method, settlementAccountCode, settlementBehavior, payment.feeAccountCode ?? ''].join('|');
      const current = paymentBreakdown.get(key) ?? { method, methodName: payment.methodName ?? method, settlementAccountCode, settlementBehavior, grossAmount: 0, feeAmount: 0, netSettlementAmount: 0, feeAccountCode: payment.feeAccountCode ?? null };
      current.grossAmount += Number(payment.amount);
      current.feeAmount += feeAmount;
      current.netSettlementAmount += Number(payment.amount) - feeAmount;
      paymentBreakdown.set(key, current);
    }
    const warehouseIds = warehouseRows.map((row) => row.id);
    const completedReturns = warehouseIds.length ? await client.saleReturn.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        status: 'COMPLETED',
        approvedById: shift.userId,
        postedAt: { gte: shift.openedAt, lte: end },
      },
      select: { refundDetails: true, refundMethod: true, refundAmount: true },
    }) : [];
    const cashRefundRows = completedReturns
      .map((row) => this.refundCashAmount(row.refundDetails, row.refundMethod, row.refundAmount))
      .filter((amount) => amount > 0);
    const cashIn = cashMovements.filter((item) => item.type === 'CASH_IN').reduce((sum, item) => sum + Number(item.amount), 0);
    const cashOut = cashMovements.filter((item) => item.type === 'CASH_OUT').reduce((sum, item) => sum + Number(item.amount), 0);
    return {
      paymentTotals,
      paymentBreakdown: [...paymentBreakdown.values()],
      cashSales,
      cashRefunds: cashRefundRows.reduce((sum, amount) => sum + amount, 0),
      cashRefundCount: cashRefundRows.length,
      cashIn,
      cashOut,
    };
  }

  async closeShift(user: AuthUser, closingCash: number, grantId?: string) {
    const scope = this.requireTenantScope(user);
    if (!Number.isFinite(closingCash) || closingCash < 0) throw new BadRequestException('Saldo akhir kas tidak valid.');
    return serializableTx(this.prisma, async (tx) => {
      const shift = await tx.cashierShift.findFirst({
        where: {
          userId: user.sub,
          status: 'OPEN',
          user: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
        },
      });
      if (!shift) throw new BadRequestException('Tidak ada shift kasir yang terbuka.');
      const summary = await this.shiftCashSummary(tx, scope, shift);
      const expected = Number(shift.openingCash) + summary.cashSales + summary.cashIn - summary.cashOut - summary.cashRefunds;
      // A drawer that comes up SHORT past the change tolerance is a second gate. Probed live: closing
      // with Rp 1 declared against a drawer short Rp 2.311.201 returned 201, so the missing money was
      // written to a column and the shift closed anyway — the loss was recorded, not prevented.
      //
      // Only a shortfall is gated. Money left OVER is a safe outcome and must never be blocked, or
      // this control becomes a way to stop a till from closing.
      const shortfall = expected - closingCash;
      if (shortfall > SUPERVISOR_SHIFT_DIFFERENCE_TOLERANCE) {
        if (!grantId) {
          throw new ForbiddenException(
            `Selisih kas Rp ${Math.round(shortfall).toLocaleString('id-ID')} melebihi toleransi. Tutup shift memerlukan persetujuan supervisor.`,
          );
        }
        this.approvals.consume(grantId, 'SHIFT_CLOSE', user);
      }
      const row = await tx.cashierShift.update({
        where: { id: shift.id },
        data: {
          closingCash: new Prisma.Decimal(closingCash),
          expectedCash: new Prisma.Decimal(expected),
          difference: new Prisma.Decimal(Number(closingCash) - expected),
          closedAt: new Date(),
          status: 'CLOSED',
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CLOSE_CASHIER_SHIFT',
          entityType: 'CashierShift',
          entityId: shift.id,
          payload: { expected, closingCash, cashSales: summary.cashSales, cashIn: summary.cashIn, cashOut: summary.cashOut, cashRefunds: summary.cashRefunds },
        },
      });
      return row;
    });
  }

  async shiftRecap(user: AuthUser, shiftId: string) {
    const scope = this.requireTenantScope(user);
    const shift = await this.prisma.cashierShift.findFirst({
      where: { id: shiftId, user: { branchId: scope.branchId, branch: { companyId: scope.companyId } } },
      include: { user: true },
    });
    if (!shift) return this.denyTenantAccess(user, scope, 'CashierShift', shiftId);
    const [salesAgg, summary] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { cashierShiftId: shift.id, branchId: scope.branchId, status: 'COMPLETED' },
        _sum: { total: true, costTotal: true, tax: true },
        _count: true,
      }),
      this.shiftCashSummary(this.prisma, scope, shift),
    ]);
    return {
      shift: { id: shift.id, openedAt: shift.openedAt, closedAt: shift.closedAt, status: shift.status, cashier: shift.user.name },
      openingCash: Number(shift.openingCash),
      closingCash: shift.closingCash !== null ? Number(shift.closingCash) : null,
      expectedCash: shift.expectedCash !== null ? Number(shift.expectedCash) : null,
      difference: shift.difference !== null ? Number(shift.difference) : null,
      sales: {
        count: salesAgg._count,
        total: Number(salesAgg._sum.total ?? 0),
        tax: Number(salesAgg._sum.tax ?? 0),
        cogs: Number(salesAgg._sum.costTotal ?? 0),
      },
      payments: Object.fromEntries(summary.paymentTotals.entries()),
      paymentBreakdown: summary.paymentBreakdown,
      refunds: { count: summary.cashRefundCount, cashTotal: summary.cashRefunds },
      cashMovements: { cashIn: summary.cashIn, cashOut: summary.cashOut },
      expectedCashFormula: {
        openingCash: Number(shift.openingCash),
        cashSales: summary.cashSales,
        cashIn: summary.cashIn,
        cashOut: summary.cashOut,
        cashRefunds: summary.cashRefunds,
      },
    };
  }

  async quote(dto: CreateSaleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.items.length) throw new BadRequestException('Penjualan harus memiliki barang.');
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, branchId: scope.branchId, branch: { companyId: scope.companyId } },
    });
    if (!warehouse) return this.denyTenantAccess(user, scope, 'Warehouse', dto.warehouseId);

    const ids = [...new Set(dto.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, companyId: scope.companyId, isActive: true },
    });
    if (products.length !== ids.length) throw new BadRequestException('Satu atau lebih produk tidak ditemukan.');

    const quoteCustomer = dto.customerId
      ? await this.prisma.customer.findFirst({ where: { id: dto.customerId, companyId: scope.companyId }, select: { id: true, customerType: true } })
      : null;
    if (dto.customerId && !quoteCustomer) throw new BadRequestException('Pelanggan tidak ditemukan.');
    let rawSubtotal = new Prisma.Decimal(0);
    const raw: Array<{ input: (typeof dto.items)[number]; product: (typeof products)[number]; line: Prisma.Decimal; conversion: Awaited<ReturnType<SalesService['resolveSellingLine']>> }> = [];
    for (const input of dto.items) {
      const product = products.find((value) => value.id === input.productId)!;
      const conversion = await this.resolveSellingLine(this.prisma, scope, product, input, quoteCustomer?.customerType);
      const line = conversion.sellingUnitPrice.mul(conversion.unitQuantity);
      rawSubtotal = rawSubtotal.add(line);
      raw.push({ input, product, line, conversion });
    }
    const discount = new Prisma.Decimal(dto.discount ?? 0);
    if (discount.greaterThan(rawSubtotal)) throw new BadRequestException('Diskon melebihi subtotal.');
    const promotion = await this.promotions.resolveSalePromotion(this.prisma, scope, rawSubtotal, dto.promoCode, new Date(), dto.customerId, { channel: 'POS', lines: raw.map((item) => ({ productId: item.product.id, quantity: item.conversion.unitQuantity, unitPrice: item.conversion.sellingUnitPrice })) });
    const promoDiscount = promotion.discount;

    const redeemRequested = Math.floor(dto.redeemPoints ?? 0);
    if (redeemRequested > 0 && !dto.customerId) throw new BadRequestException('Penukaran poin membutuhkan pelanggan.');
    let loyaltyRedeemDiscount = new Prisma.Decimal(0);
    if (dto.customerId) {
      if (!quoteCustomer) throw new BadRequestException('Pelanggan tidak ditemukan.');
      if (redeemRequested > 0) {
        const program = await this.prisma.loyaltyProgram.findFirst({
          where: { companyId: scope.companyId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, redemptionRate: true, minimumRedeem: true },
        });
        if (!program) throw new BadRequestException('Program loyalitas aktif tidak ditemukan.');
        const account = await this.prisma.loyaltyAccount.findUnique({
          where: { programId_customerId: { programId: program.id, customerId: dto.customerId } },
          select: { points: true },
        });
        if (!account || account.points < redeemRequested) {
          throw new BadRequestException(`Poin tidak mencukupi. Saldo: ${account?.points ?? 0}, diminta: ${redeemRequested}.`);
        }
        if (redeemRequested < program.minimumRedeem) {
          throw new BadRequestException(`Penukaran minimal ${program.minimumRedeem} poin.`);
        }
        loyaltyRedeemDiscount = new Prisma.Decimal(redeemRequested).div(program.redemptionRate).toDecimalPlaces(2);
      }
    }

    const totalDiscount = discount.plus(promoDiscount).plus(loyaltyRedeemDiscount);
    if (totalDiscount.greaterThan(rawSubtotal)) throw new BadRequestException('Diskon melebihi subtotal.');
    let netTotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    let total = new Prisma.Decimal(0);
    let allocatedDiscount = new Prisma.Decimal(0);
    for (const [index, item] of raw.entries()) {
      const share = rawSubtotal.isZero()
        ? new Prisma.Decimal(0)
        : index === raw.length - 1
          ? totalDiscount.sub(allocatedDiscount)
          : totalDiscount.mul(item.line).div(rawSubtotal).toDecimalPlaces(2);
      allocatedDiscount = allocatedDiscount.add(share);
      const discountedBase = item.line.sub(share);
      const calc = await this.accounting.calculateTax(
        this.prisma,
        item.input.taxCodeId ?? item.product.salesTaxCodeId ?? undefined,
        discountedBase,
        scope.companyId,
        new Date(),
        ['SALE', 'OTHER'],
      );
      netTotal = netTotal.add(calc.net);
      taxTotal = taxTotal.add(calc.tax);
      total = total.add(calc.gross);
      const inventory = await this.prisma.inventory.findUnique({
        where: { warehouseId_productId: { warehouseId: warehouse.id, productId: item.product.id } },
      });
      if ((!inventory || inventory.available < item.conversion.baseQuantity) && !item.product.allowNegativeStock) {
        throw new BadRequestException(`Stok ${item.product.name} tidak mencukupi untuk ${item.conversion.unitQuantity} ${item.conversion.unitCode} (${item.conversion.baseQuantity} ${item.product.unit}).`);
      }
    }
    const serviceFee = serviceFeeFor(dto, total);
    return {
      subtotal: rawSubtotal,
      discount,
      promoDiscount,
      appliedPromo: promotion.rule,
      loyaltyDiscount: loyaltyRedeemDiscount,
      totalDiscount,
      net: netTotal,
      tax: taxTotal,
      // The fee is added on top and reported separately, so the cashier can see what the customer is
      // being charged for instead of a total that quietly grew by an unexplained amount.
      serviceFee,
      total: total.add(serviceFee),
      redeemPoints: redeemRequested,
      items: raw.map((item) => ({
        productId: item.product.id,
        barcodeCode: item.conversion.sourceBarcode,
        // `variantId` WAJIB ikut: tanpa ini kasir tidak bisa mencocokkan baris ini dengan baris
        // keranjangnya, karena satu produk bisa punya beberapa jenis dengan harga berbeda. Dua
        // jenis dari produk yang sama punya productId yang sama, jadi `productId` saja tidak
        // unik dan layar akan menampilkan harga jenis pertama untuk semua baris.
        variantId: item.conversion.variantId,
        unitCode: item.conversion.unitCode,
        unitQuantity: item.conversion.unitQuantity,
        quantityFactor: item.conversion.quantityFactor,
        baseQuantity: item.conversion.baseQuantity,
        sellingUnitPrice: item.conversion.sellingUnitPrice,
        baseUnitPrice: item.conversion.baseUnitPrice,
        lineSubtotal: item.line,
      })),
    };
  }

  async offlineConfig(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const configuredMaxAge = Number(process.env.POS_OFFLINE_MAX_CACHE_MINUTES ?? 1440);
    const maxOfflineAgeMinutes = Number.isFinite(configuredMaxAge) ? Math.min(Math.max(Math.floor(configuredMaxAge), 30), 10080) : 1440;
    const [taxCodes, shift, tenderMethods] = await Promise.all([
      this.prisma.taxCode.findMany({
        where: { companyId: scope.companyId, scope: 'SALE', status: 'ACTIVE' },
        select: { id: true, code: true, rate: true, inclusive: true, updatedAt: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
      this.currentShift(user),
      this.tenderDefinitions(this.prisma, scope),
    ]);
    return {
      serverTime: new Date().toISOString(),
      branchId: scope.branchId,
      shift,
      taxCodes,
      tenderMethods: tenderMethods.map((item) => ({ code: item.code, name: item.name, ...item.policy })),
      policy: {
        paymentMethods: tenderMethods.filter((item) => item.policy.allowOffline).map((item) => item.code),
        loyaltyRedeemAllowed: false,
        maxOfflineAgeMinutes,
        note: 'Transaksi offline hanya menerima tender yang diizinkan konfigurasi dan tetap divalidasi ulang server saat replay.',
      },
    };
  }

  async replayOfflineSales(dto: ReplayOfflineSalesDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.transactions.length) return { deviceId: null, applied: 0, conflicts: 0, failed: 0, remaining: 0, results: [] };

    const sequenceSet = new Set<number>();
    const localIdSet = new Set<string>();
    for (const item of dto.transactions) {
      if (sequenceSet.has(item.sequence)) throw new BadRequestException(`Sequence offline duplikat dalam batch: ${item.sequence}.`);
      if (localIdSet.has(item.localId)) throw new BadRequestException(`Local ID offline duplikat dalam batch: ${item.localId}.`);
      sequenceSet.add(item.sequence);
      localIdSet.add(item.localId);
    }

    const device = await serializableTx(this.prisma, async (tx) => {
      const existing = await tx.device.findUnique({
        where: { companyId_code: { companyId: scope.companyId, code: dto.deviceCode } },
      });
      if (existing?.branchId && existing.branchId !== scope.branchId) {
        throw new ForbiddenException('Device POS sudah terikat ke cabang lain.');
      }
      const data = {
        branchId: scope.branchId,
        code: dto.deviceCode,
        name: dto.deviceName?.trim() || `POS ${dto.deviceCode.slice(-8)}`,
        platform: 'WEB_POS',
        appVersion: dto.appVersion,
        lastSeenAt: new Date(),
        isActive: true,
        metadata: { purpose: 'POS_OFFLINE_REPLAY' } as Prisma.InputJsonValue,
      };
      return existing
        ? tx.device.update({ where: { id: existing.id }, data })
        : tx.device.create({ data: { companyId: scope.companyId, ...data } });
    });

    const ordered = [...dto.transactions].sort((left, right) => left.sequence - right.sequence);
    const offlineTenderMap = new Map((await this.tenderDefinitions(this.prisma, scope)).map((item) => [item.code, item]));
    const results: Array<Record<string, unknown>> = [];
    let blocked = false;

    for (const item of ordered) {
      if (blocked) {
        results.push({ localId: item.localId, sequence: item.sequence, status: 'PENDING', reason: 'Menunggu penyelesaian transaksi offline sebelumnya.' });
        continue;
      }

      const occurredAt = new Date(item.capturedAt);
      if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new BadRequestException(`Waktu transaksi offline tidak valid untuk sequence ${item.sequence}.`);
      }

      const normalizedPayload: CreateSaleDto = {
        ...item.payload,
        idempotencyKey: item.payload.idempotencyKey?.trim() || `offline-sale:${device.id}:${item.localId}`,
      };
      const receiptPayload = {
        capturedAt: occurredAt.toISOString(),
        configSyncedAt: item.configSyncedAt,
        expectedTotal: item.expectedTotal,
        payload: normalizedPayload,
      };

      const claim = await serializableTx(this.prisma, async (tx) => {
        const existing = await tx.offlineTransaction.findFirst({
          where: { deviceId: device.id, OR: [{ localId: item.localId }, { sequence: item.sequence }] },
        });
        if (existing) {
          const sameIdentity = existing.localId === item.localId
            && existing.sequence === item.sequence
            && existing.transactionType === 'SALE'
            && stableJson(existing.payload) === stableJson(receiptPayload);
          if (!sameIdentity) throw new BadRequestException('Replay offline memakai localId/sequence yang sama dengan payload berbeda.');
          if (existing.status === 'APPLIED') return { receipt: existing, claimed: false, processing: false, deadLetter: false };
          if (existing.status === 'DEAD_LETTER') return { receipt: existing, claimed: false, processing: false, deadLetter: true };

          // Lease PROCESSING mencegah dua request replay mengerjakan sale yang sama bersamaan.
          // Lease lama boleh direbut kembali setelah 10 menit untuk recovery pasca-crash.
          const leaseCutoff = new Date(Date.now() - 10 * 60 * 1000);
          if (existing.status === 'PROCESSING' && existing.processedAt && existing.processedAt > leaseCutoff) {
            return { receipt: existing, claimed: false, processing: true, deadLetter: false };
          }
          const claimed = await tx.offlineTransaction.updateMany({
            where: {
              id: existing.id,
              OR: [
                { status: { in: ['PENDING', 'FAILED', 'CONFLICT'] } },
                { status: 'PROCESSING', OR: [{ processedAt: null }, { processedAt: { lte: leaseCutoff } }] },
              ],
            },
            data: { status: 'PROCESSING', conflict: Prisma.JsonNull, errorMessage: null, processedAt: new Date(), attempts: { increment: 1 }, nextRetryAt: null, deadLetteredAt: null },
          });
          if (!claimed.count) {
            const current = await tx.offlineTransaction.findUnique({ where: { id: existing.id } });
            return { receipt: current ?? existing, claimed: false, processing: current?.status === 'PROCESSING', deadLetter: current?.status === 'DEAD_LETTER' };
          }
          const current = await tx.offlineTransaction.findUnique({ where: { id: existing.id } });
          return { receipt: current ?? existing, claimed: true, processing: false, deadLetter: false };
        }
        const created = await tx.offlineTransaction.create({
          data: {
            deviceId: device.id,
            localId: item.localId,
            sequence: item.sequence,
            transactionType: 'SALE',
            payload: receiptPayload as unknown as Prisma.InputJsonValue,
            status: 'PROCESSING',
            attempts: 1,
            processedAt: new Date(),
          },
        });
        return { receipt: created, claimed: true, processing: false, deadLetter: false };
      });

      if (claim.receipt.status === 'APPLIED') {
        results.push({ localId: item.localId, sequence: item.sequence, status: 'APPLIED', saleId: claim.receipt.serverEntityId, replay: true });
        continue;
      }
      if (claim.deadLetter || claim.receipt.status === 'DEAD_LETTER') {
        results.push({ localId: item.localId, sequence: item.sequence, status: 'DEAD_LETTER', reason: claim.receipt.errorMessage ?? 'Transaksi dipindahkan ke dead letter setelah retry berulang.' });
        blocked = true;
        continue;
      }
      if (!claim.claimed) {
        results.push({ localId: item.localId, sequence: item.sequence, status: 'PENDING', reason: claim.processing ? 'Transaksi sedang diproses request replay lain.' : 'Transaksi belum bisa diklaim.' });
        blocked = true;
        continue;
      }

      const receipt = claim.receipt;
      const registerConflict = async (code: string, message: string, details: Record<string, unknown> = {}) => {
        const conflict = { code, message, ...details } as Prisma.InputJsonValue;
        await this.prisma.offlineTransaction.updateMany({
          where: { id: receipt.id, status: 'PROCESSING' },
          data: { status: 'CONFLICT', conflict, errorMessage: message, processedAt: new Date() },
        });
        results.push({ localId: item.localId, sequence: item.sequence, status: 'CONFLICT', reason: message, ...details });
        blocked = true;
      };

      const configSyncedAt = new Date(item.configSyncedAt);
      const configuredMaxAge = Number(process.env.POS_OFFLINE_MAX_CACHE_MINUTES ?? 1440);
      const maxOfflineAgeMinutes = Number.isFinite(configuredMaxAge) ? Math.min(Math.max(Math.floor(configuredMaxAge), 30), 10080) : 1440;
      const cacheAgeAtCapture = occurredAt.getTime() - configSyncedAt.getTime();
      if (Number.isNaN(configSyncedAt.getTime()) || cacheAgeAtCapture < -5 * 60 * 1000 || cacheAgeAtCapture > maxOfflineAgeMinutes * 60 * 1000) {
        await registerConflict('OFFLINE_CONFIG_STALE', `Cache harga/pajak melebihi batas ${maxOfflineAgeMinutes} menit saat transaksi dibuat.`);
        continue;
      }

      const offlinePayments = normalizedPayload.payments ?? [];
      if (offlinePayments.length > 1 || normalizedPayload.onAccount || normalizedPayload.onAccountAmount) {
        await registerConflict('OFFLINE_PAYMENT_NOT_ALLOWED', 'Split payment dan piutang pelanggan tidak boleh direkam saat offline.');
        continue;
      }
      const offlineMethod = (offlinePayments[0]?.method ?? normalizedPayload.paymentMethod ?? 'CASH').trim().toUpperCase();
      const offlineTender = offlineTenderMap.get(offlineMethod);
      if (!offlineTender || !offlineTender.policy.allowOffline) {
        await registerConflict('OFFLINE_PAYMENT_NOT_ALLOWED', `Tender ${offlineMethod} tidak diizinkan untuk transaksi offline.`);
        continue;
      }
      const offlineProvider = offlinePayments[0]?.provider?.trim();
      const offlineReference = offlinePayments[0]?.externalRef?.trim();
      if ((offlineTender.policy.requiresProvider && !offlineProvider) || (offlineTender.policy.requiresReference && !offlineReference)) {
        await registerConflict('OFFLINE_PAYMENT_DETAILS_REQUIRED', `Tender ${offlineMethod} memerlukan provider/reference yang tidak tersedia.`);
        continue;
      }
      if (normalizedPayload.promoCode?.trim()) {
        await registerConflict('OFFLINE_PROMO_NOT_ALLOWED', 'Promo membutuhkan validasi server online pada saat transaksi.');
        continue;
      }
      if ((normalizedPayload.redeemPoints ?? 0) > 0) {
        await registerConflict('OFFLINE_LOYALTY_REDEEM_NOT_ALLOWED', 'Penukaran poin membutuhkan validasi online.');
        continue;
      }
      if (!normalizedPayload.cashierShiftId) {
        await registerConflict('OFFLINE_SHIFT_REQUIRED', 'Transaksi offline tidak memiliki shift kasir asal.');
        continue;
      }
      const replayShift = await this.prisma.cashierShift.findFirst({
        where: {
          id: normalizedPayload.cashierShiftId,
          userId: user.sub,
          status: 'OPEN',
          user: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
        },
        select: { openedAt: true },
      });
      if (!replayShift) {
        await registerConflict('OFFLINE_SHIFT_INVALID', 'Shift kasir asal sudah tidak aktif atau bukan milik pengguna ini.');
        continue;
      }
      const beforeShiftMs = replayShift.openedAt.getTime() - occurredAt.getTime();
      if (beforeShiftMs > 2 * 60 * 1000) {
        await registerConflict('OFFLINE_CAPTURE_BEFORE_SHIFT', 'Waktu transaksi offline berada sebelum shift kasir dibuka.', {
          capturedAt: occurredAt.toISOString(),
          shiftOpenedAt: replayShift.openedAt.toISOString(),
        });
        continue;
      }
      // Koreksi skew kecil jam terminal agar payment tetap masuk rentang shift untuk rekonsiliasi kas.
      const businessOccurredAt = beforeShiftMs > 0 ? replayShift.openedAt : occurredAt;

      try {
        const serverQuote = await this.quote(normalizedPayload, user);
        const serverTotal = Number(serverQuote.total);
        if (!Number.isFinite(serverTotal) || Math.abs(serverTotal - item.expectedTotal) > 0.01) {
          await registerConflict('OFFLINE_TOTAL_CHANGED', 'Total server berbeda dari total yang diterima saat offline.', {
            expectedTotal: item.expectedTotal,
            serverTotal,
            capturedAt: occurredAt.toISOString(),
          });
          continue;
        }

        const sale = await this.create(normalizedPayload, user, {
          occurredAt: businessOccurredAt,
          offline: { transactionId: receipt.id, deviceId: device.id, localId: item.localId, sequence: item.sequence },
        }) as unknown as { id: string; number?: string; total?: Prisma.Decimal };
        await this.prisma.offlineTransaction.updateMany({
          where: { id: receipt.id, status: 'PROCESSING' },
          data: { status: 'APPLIED', serverEntityType: 'Sale', serverEntityId: sale.id, conflict: Prisma.JsonNull, errorMessage: null, processedAt: new Date() },
        });
        results.push({ localId: item.localId, sequence: item.sequence, status: 'APPLIED', saleId: sale.id, number: sale.number, total: Number(sale.total ?? item.expectedTotal) });
      } catch (error) {
        const businessConflict = error instanceof BadRequestException || error instanceof ForbiddenException;
        const message = syncErrorMessage(error);
        const maxAttempts = 5;
        const deadLetter = !businessConflict && receipt.attempts >= maxAttempts;
        const retryDelayMinutes = Math.min(60, Math.max(1, 2 ** Math.max(0, receipt.attempts - 1)));
        const failureStatus = businessConflict ? 'CONFLICT' : deadLetter ? 'DEAD_LETTER' : 'FAILED';
        await this.prisma.offlineTransaction.updateMany({
          where: { id: receipt.id, status: 'PROCESSING' },
          data: {
            status: failureStatus as never,
            conflict: businessConflict ? ({ code: 'OFFLINE_REPLAY_REJECTED', message } as Prisma.InputJsonValue) : Prisma.JsonNull,
            errorMessage: message,
            nextRetryAt: !businessConflict && !deadLetter ? new Date(Date.now() + retryDelayMinutes * 60_000) : null,
            deadLetteredAt: deadLetter ? new Date() : null,
            processedAt: new Date(),
          },
        });
        results.push({ localId: item.localId, sequence: item.sequence, status: failureStatus, reason: message, attempts: receipt.attempts, ...(deadLetter ? { deadLetter: true } : { retryAfterMinutes: businessConflict ? undefined : retryDelayMinutes }) });
        blocked = true;
      }
    }

    await this.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    const applied = results.filter((item) => item.status === 'APPLIED').length;
    const conflicts = results.filter((item) => item.status === 'CONFLICT').length;
    const failed = results.filter((item) => item.status === 'FAILED').length;
    const deadLetters = results.filter((item) => item.status === 'DEAD_LETTER').length;
    const remaining = results.filter((item) => item.status === 'PENDING').length + conflicts + failed + deadLetters;
    return { deviceId: device.id, applied, conflicts, failed, deadLetters, remaining, results };
  }

  async create(dto: CreateSaleDto, user: AuthUser, options: SaleCreateOptions = {}) {
    const scope = this.requireTenantScope(user);
    if (!dto.items.length) throw new BadRequestException('Penjualan harus memiliki barang.');
    const occurredAt = options.occurredAt ?? new Date();

    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: dto.warehouseId,
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
      },
      include: { branch: true },
    });
    if (!warehouse) return this.denyTenantAccess(user, scope, 'Warehouse', dto.warehouseId);

    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const saleResult = await serializableTx(this.prisma, async (tx) => {
      const scopeKey = dto.idempotencyKey ? 'sale:create' : null;
      if (scopeKey) {
        const gate = await beginIdempotent(tx, { companyId: scope.companyId, scope: scopeKey, key: dto.idempotencyKey!, payload: dto });
        if (gate.replay && gate.status === 'COMPLETED') return gate.response as never;
      }
      let cashierShiftId = dto.cashierShiftId;
      if (cashierShiftId) {
        const shift = await tx.cashierShift.findFirst({
          where: {
            id: cashierShiftId,
            userId: user.sub,
            status: 'OPEN',
            user: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
          },
          select: { id: true },
        });
        if (!shift) throw new ForbiddenException('Shift kasir tidak aktif atau bukan milik pengguna pada cabang ini.');
      } else {
        const shift = await tx.cashierShift.findFirst({
          where: {
            userId: user.sub,
            status: 'OPEN',
            user: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
          },
          select: { id: true },
          orderBy: { openedAt: 'desc' },
        });
        cashierShiftId = shift?.id;
        if (user.roles.includes('CASHIER') && !cashierShiftId) {
          throw new BadRequestException('Kasir wajib membuka shift sebelum membuat penjualan.');
        }
      }

      const ids = productIds;
      const products = await tx.product.findMany({
        where: { id: { in: ids }, companyId: scope.companyId, isActive: true },
      });
      if (products.length !== ids.length) {
        const accepted = new Set(products.map((product) => product.id));
        const missingIds = ids.filter((id) => !accepted.has(id));
        const crossTenant = await tx.product.findFirst({ where: { id: { in: missingIds } }, select: { id: true } });
        if (crossTenant) return this.denyTenantAccess(user, scope, 'Product', crossTenant.id);
        throw new BadRequestException('Satu atau lebih produk tidak ditemukan.');
      }
      const saleCustomer = dto.customerId
        ? await tx.customer.findFirst({ where: { id: dto.customerId, companyId: scope.companyId }, select: { id: true, customerType: true, name: true, taxIdNumber: true } })
        : null;
      if (dto.customerId && !saleCustomer) throw new BadRequestException('Pelanggan tidak ditemukan.');
      let rawSubtotal = new Prisma.Decimal(0), costTotal = new Prisma.Decimal(0);
      const raw: Array<{ input: (typeof dto.items)[number]; product: (typeof products)[number]; line: Prisma.Decimal; conversion: Awaited<ReturnType<SalesService['resolveSellingLine']>> }> = [];
      for (const input of dto.items) {
        const product = products.find((value) => value.id === input.productId)!;
        const conversion = await this.resolveSellingLine(tx, scope, product, input, saleCustomer?.customerType, occurredAt);
        const line = conversion.sellingUnitPrice.mul(conversion.unitQuantity);
        rawSubtotal = rawSubtotal.add(line);
        costTotal = costTotal.add(new Prisma.Decimal(product.costPrice).mul(conversion.baseQuantity));
        raw.push({ input, product, line, conversion });
      }
      const discount = new Prisma.Decimal(dto.discount ?? 0);
      if (discount.greaterThan(rawSubtotal)) throw new BadRequestException('Diskon melebihi subtotal.');
    // Gate the COMMIT path, not the preview. Before this, the only check was "not more than the
    // subtotal", so a cashier could hand out a 99% discount on a large basket with no approver and
    // no audit trail. The grant is single-use and company-scoped, so this consumes it.
    //
    // This must NOT be in quote(): quote() runs on every keystroke, so spending the grant there
    // would let the preview consume the approval and then refuse the real sale.
    if (rawSubtotal.greaterThan(0) && discount.dividedBy(rawSubtotal).greaterThan(SUPERVISOR_DISCOUNT_RATIO)) {
      const grantId = dto.supervisorApprovalId;
      if (!grantId) {
        throw new ForbiddenException('Diskon di atas 20% memerlukan persetujuan supervisor.');
      }
      this.approvals.consume(grantId, 'SALE_LINE_DISCOUNT', user);
    }
      if (options.offline && dto.promoCode?.trim()) throw new BadRequestException('Promo tidak boleh diterapkan dari transaksi offline.');
      const promotion = await this.promotions.resolveSalePromotion(tx, scope, rawSubtotal, dto.promoCode, occurredAt, dto.customerId, { channel: 'POS', lines: raw.map((item) => ({ productId: item.product.id, quantity: item.conversion.unitQuantity, unitPrice: item.conversion.sellingUnitPrice })) });
      const promoDiscount = promotion.discount;

      // Loyalty: validasi program + saldo poin SEBELUM perhitungan pajak (T360-20260825).
      const redeemRequested = Math.floor(dto.redeemPoints ?? 0);
      if (redeemRequested > 0 && !dto.customerId) throw new BadRequestException('Penukaran poin membutuhkan pelanggan.');
      if (dto.customerId && !saleCustomer) throw new BadRequestException('Pelanggan tidak ditemukan.');
      let loyaltyRedeemDiscount = new Prisma.Decimal(0);
      let loyaltyProgram: { id: string; earnRate: Prisma.Decimal; redemptionRate: Prisma.Decimal; minimumRedeem: number } | null = null;
      let loyaltyAccount: { id: string; points: number } | null = null;
      if ((redeemRequested > 0 || dto.customerId) && dto.customerId) {
        loyaltyProgram = await tx.loyaltyProgram.findFirst({
          where: { companyId: scope.companyId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, earnRate: true, redemptionRate: true, minimumRedeem: true },
        });
        if (loyaltyProgram && redeemRequested > 0) {
          const account = await tx.loyaltyAccount.findUnique({
            where: { programId_customerId: { programId: loyaltyProgram.id, customerId: dto.customerId } },
            select: { id: true, points: true },
          });
          if (!account || account.points < redeemRequested) {
            throw new BadRequestException(`Poin tidak mencukupi. Saldo: ${account?.points ?? 0}, diminta: ${redeemRequested}.`);
          }
          if (redeemRequested < loyaltyProgram.minimumRedeem) {
            throw new BadRequestException(`Penukaran minimal ${loyaltyProgram.minimumRedeem} poin.`);
          }
          loyaltyAccount = account;
          loyaltyRedeemDiscount = new Prisma.Decimal(redeemRequested).div(loyaltyProgram.redemptionRate).toDecimalPlaces(2);
        }
      }
      const totalDiscount = discount.plus(promoDiscount).plus(loyaltyRedeemDiscount);
      if (totalDiscount.greaterThan(rawSubtotal)) throw new BadRequestException('Diskon melebihi subtotal.');
      let netTotal = new Prisma.Decimal(0), taxTotal = new Prisma.Decimal(0), total = new Prisma.Decimal(0);
      const taxGroups = new Map<string, { base: Prisma.Decimal; tax: Prisma.Decimal }>();
      const prepared = [] as Array<{ productId: string; variantId: string | null; productUnitId: string | null; quantity: number; unitPrice: Prisma.Decimal; unitCost: Prisma.Decimal; unitCode: string; unitQuantity: number; quantityFactor: number; sourceBarcode: string | null; subtotal: Prisma.Decimal; netSubtotal: Prisma.Decimal; taxAmount: Prisma.Decimal; grossSubtotal: Prisma.Decimal; taxCodeId?: string; productName: string }>;
      let allocatedDiscount = new Prisma.Decimal(0);
      for (const [index, item] of raw.entries()) {
        const share = rawSubtotal.isZero()
          ? new Prisma.Decimal(0)
          : index === raw.length - 1
            ? totalDiscount.sub(allocatedDiscount)
            : totalDiscount.mul(item.line).div(rawSubtotal).toDecimalPlaces(2);
        allocatedDiscount = allocatedDiscount.add(share);
        const discountedBase = item.line.sub(share);
        const calc = await this.accounting.calculateTax(
          tx,
          item.input.taxCodeId ?? item.product.salesTaxCodeId ?? undefined,
          discountedBase,
          scope.companyId,
          occurredAt,
          ['SALE', 'OTHER'],
        );
        netTotal = netTotal.add(calc.net); taxTotal = taxTotal.add(calc.tax); total = total.add(calc.gross);
        prepared.push({
          productId: item.product.id,
          variantId: item.conversion.variantId,
          productUnitId: item.conversion.productUnitId,
          quantity: item.conversion.baseQuantity,
          unitPrice: item.conversion.baseUnitPrice,
          unitCost: item.product.costPrice,
          unitCode: item.conversion.unitCode,
          unitQuantity: item.conversion.unitQuantity,
          quantityFactor: item.conversion.quantityFactor,
          sourceBarcode: item.conversion.sourceBarcode,
          subtotal: calc.gross,
          netSubtotal: calc.net,
          taxAmount: calc.tax,
          grossSubtotal: calc.gross,
          taxCodeId: calc.taxCode?.id,
          productName: item.product.name,
        });
        if (calc.taxCode && calc.tax.greaterThan(0)) {
          const group = taxGroups.get(calc.taxCode.id) ?? { base: new Prisma.Decimal(0), tax: new Prisma.Decimal(0) };
          group.base = group.base.add(calc.net); group.tax = group.tax.add(calc.tax); taxGroups.set(calc.taxCode.id, group);
        }
      }
      for (const item of prepared) {
        const inventory = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: item.productId } } });
        const product = products.find((value) => value.id === item.productId)!;
        if ((!inventory || inventory.available < item.quantity) && !product.allowNegativeStock) throw new BadRequestException(`Stok ${product.name} tidak mencukupi.`);
      }

      // Customer-facing service fee is part of the amount that must be settled. Historically the
      // split-payment validator compared against goods gross before this fee, which made a correct
      // split fail while a single legacy payment could understate the actual sale total.
      const serviceFee = serviceFeeFor(dto, total);
      const saleTotal = total.add(serviceFee).toDecimalPlaces(2);
      if (dto.payments !== undefined && dto.paymentMethod) throw new BadRequestException('Gunakan paymentMethod atau payments, jangan keduanya.');

      const onAccountAmount = dto.onAccountAmount === undefined
        ? new Prisma.Decimal(0)
        : new Prisma.Decimal(dto.onAccountAmount).toDecimalPlaces(2);
      if (dto.onAccountAmount !== undefined && dto.onAccount !== true) {
        throw new BadRequestException('onAccount harus true saat onAccountAmount dikirim agar piutang tidak terbentuk diam-diam.');
      }
      if (dto.onAccount === true && dto.onAccountAmount === undefined) {
        throw new BadRequestException('onAccountAmount wajib diisi saat onAccount true.');
      }
      if (onAccountAmount.greaterThan(0) && !dto.customerId) throw new BadRequestException('Penjualan piutang wajib memiliki pelanggan.');
      if (onAccountAmount.greaterThan(saleTotal)) throw new BadRequestException('Piutang pelanggan melebihi total transaksi.');
      if (options.offline && onAccountAmount.greaterThan(0)) throw new BadRequestException('Penjualan piutang tidak boleh direkam saat offline.');

      const tenderDue = saleTotal.sub(onAccountAmount).toDecimalPlaces(2);
      const rawRequestedPayments = dto.payments !== undefined
        ? dto.payments.map((item) => ({ ...item, method: item.method.toUpperCase(), amount: new Prisma.Decimal(item.amount).toDecimalPlaces(2) }))
        : tenderDue.greaterThan(0)
          ? [{ method: (dto.paymentMethod ?? 'CASH').toUpperCase(), amount: tenderDue, provider: undefined, externalRef: undefined }]
          : [];
      const paymentTotal = rawRequestedPayments.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
      if (!paymentTotal.equals(tenderDue)) {
        throw new BadRequestException(`Total tender ${paymentTotal.toFixed(2)} + piutang ${onAccountAmount.toFixed(2)} tidak sama dengan total transaksi ${saleTotal.toFixed(2)}.`);
      }
      if (tenderDue.greaterThan(0) && !rawRequestedPayments.length) throw new BadRequestException('Tender pembayaran wajib diisi untuk bagian transaksi yang tidak menjadi piutang.');
      const requestedPayments = await this.resolveSalePayments(tx, scope, rawRequestedPayments);
      if (options.offline && (requestedPayments.length !== 1 || !requestedPayments[0].tender.policy.allowOffline)) {
        throw new BadRequestException('Tender transaksi offline tidak diizinkan konfigurasi cabang.');
      }
      if (onAccountAmount.greaterThan(0)) {
        const receivableAccount = await tx.account.findFirst({
          where: { branchId: scope.branchId, code: '1201', type: 'ASSET', isActive: true, branch: { companyId: scope.companyId } },
          select: { id: true },
        });
        if (!receivableAccount) throw new BadRequestException('Akun Piutang Usaha 1201 belum aktif pada cabang.');
      }
      const cashSettlement = requestedPayments.filter((item) => item.tender.policy.kind === 'CASH').reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const settlementComponentCount = requestedPayments.length + (onAccountAmount.greaterThan(0) ? 1 : 0);
      const saleEventType = onAccountAmount.greaterThan(0) || settlementComponentCount > 1 ? 'SALE_SPLIT' : !cashSettlement.isZero() ? 'SALE_CASH' : 'SALE_BANK';
      const sale = await tx.sale.create({ data: {
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'SALE', prefix: 'POS' }), branchId: scope.branchId, warehouseId: warehouse.id, customerId: dto.customerId,
        cashierShiftId, subtotal: rawSubtotal, discount: totalDiscount, tax: taxTotal, serviceFee, total: saleTotal, costTotal, createdAt: occurredAt,
        items: { create: prepared.map(({ productName, ...item }) => item) },
      } });
      if (promotion.rule && promoDiscount.greaterThan(0)) {
        await this.promotions.recordRedemption(tx, scope, promotion.rule.id, dto.customerId, 'Sale', sale.id, promoDiscount);
      }
      for (const item of prepared) {
        const allocations = await consumeAvailableLocationStock(tx, { warehouseId: warehouse.id, productId: item.productId, quantity: item.quantity });
        const inventory = await tx.inventory.update({
          where: { warehouseId_productId: { warehouseId: warehouse.id, productId: item.productId } },
          data: { quantity: { decrement: item.quantity }, available: { decrement: item.quantity } },
        });
        for (const allocation of allocations) await tx.inventoryMovement.create({ data: { warehouseId: warehouse.id, productId: item.productId, locationId: allocation.locationId, type: 'SALE', quantity: -allocation.quantity, balanceAfter: inventory.quantity, referenceType: 'Sale', referenceId: sale.id, createdAt: occurredAt } });
      }
      const payments: Array<{ id: string }> = [];
      for (const requested of requestedPayments) {
        payments.push(await tx.payment.create({ data: {
          number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PAYMENT', prefix: 'PAY' }),
          saleId: sale.id,
          method: requested.method,
          methodName: requested.tender.name,
          methodReferenceId: requested.tender.id,
          methodSnapshot: this.tenderSnapshot(requested.tender),
          provider: requested.provider,
          externalRef: requested.externalRef,
          amount: requested.amount,
          settlementAccountCode: requested.tender.policy.settlementAccountCode,
          settlementBehavior: requested.tender.policy.settlementBehavior,
          feeAmount: requested.feeAmount,
          feeAccountCode: requested.tender.policy.feeAccountCode,
          status: 'PAID', paidAt: occurredAt, createdAt: occurredAt,
        } }));
      }
      if (onAccountAmount.greaterThan(0)) {
        payments.push(await tx.payment.create({ data: {
          number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PAYMENT', prefix: 'PAY' }),
          saleId: sale.id,
          method: 'ON_ACCOUNT',
          methodName: 'Piutang Pelanggan',
          methodSnapshot: { version: 1, code: 'ON_ACCOUNT', name: 'Piutang Pelanggan', policy: { kind: 'RECEIVABLE', receivableAccountCode: '1201', refundBehavior: 'RECEIVABLE', allowOffline: false } },
          amount: onAccountAmount,
          settlementAccountCode: '1201',
          settlementBehavior: 'RECEIVABLE',
          feeAmount: new Prisma.Decimal(0),
          status: 'PENDING',
          createdAt: occurredAt,
        } }));
      }
      const taxLines: OperationalTaxLineInput[] = [...taxGroups.entries()].map(([taxCodeId, value]) => ({ taxCodeId, direction: 'OUTPUT', taxableBase: value.base, taxAmount: value.tax, counterpartyType: 'CUSTOMER', counterpartyId: dto.customerId }));
      const settlementJournalLines = [
        ...requestedPayments.flatMap((item) => [
          ...(item.settlementAmount.greaterThan(0) ? [{ accountCode: item.tender.policy.settlementAccountCode, side: 'DEBIT' as const, amount: item.settlementAmount }] : []),
          ...(item.feeAmount.greaterThan(0) && item.tender.policy.feeAccountCode ? [{ accountCode: item.tender.policy.feeAccountCode, side: 'DEBIT' as const, amount: item.feeAmount }] : []),
        ]),
        ...(onAccountAmount.greaterThan(0) ? [{ accountCode: '1201', side: 'DEBIT' as const, amount: onAccountAmount }] : []),
      ];
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: saleEventType,
        sourceType: 'Sale', sourceId: sale.id, idempotencyKey: `sale:${sale.id}`,
        amounts: { settlement: 0, cashSettlement: 0, bankSettlement: 0, revenue: netTotal, serviceRevenue: serviceFee, outputTax: taxTotal, cogs: costTotal, inventory: costTotal, gross: saleTotal, net: netTotal, tax: taxTotal },
        accountCodes: {
          revenue: '4101', serviceRevenue: '4104', outputTax: '2201', cogs: '5101', inventory: '1301',
        },
        additionalJournalLines: settlementJournalLines,
        lines: prepared.map((item) => ({ itemType: 'Product', itemId: item.productId, description: item.productName, quantity: item.quantity, unitAmount: item.unitPrice, netAmount: item.netSubtotal, taxAmount: item.taxAmount, grossAmount: item.grossSubtotal, taxCodeId: item.taxCodeId })),
        taxLines, businessDate: occurredAt, context: {
          warehouseId: warehouse.id, customerId: dto.customerId, paymentIds: payments.map((item) => item.id),
          payments: requestedPayments.map((item) => ({ method: item.method, name: item.tender.name, amount: item.amount.toFixed(2), provider: item.provider, externalRef: item.externalRef, settlementAccountCode: item.tender.policy.settlementAccountCode, settlementBehavior: item.tender.policy.settlementBehavior, feeAmount: item.feeAmount.toFixed(2), feeAccountCode: item.tender.policy.feeAccountCode })),
          ...(onAccountAmount.greaterThan(0) ? { onAccount: { amount: onAccountAmount.toFixed(2), accountCode: '1201' } } : {}),
          promo: promotion.rule ? { ...promotion.rule, discount: promoDiscount.toFixed(2) } : null,
          ...(options.offline ? { offline: options.offline } : {}),
        } as Prisma.InputJsonValue,
      });
      let taxDocumentId: string | undefined;
      if (taxTotal.greaterThan(0)) {
        const customer = saleCustomer;
        const taxDocument = await tx.taxDocument.create({ data: {
          companyId: scope.companyId, branchId: scope.branchId, number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'TAX_SALE', prefix: 'TAX-SALE' }), documentType: 'SALES_TAX_DOCUMENT', status: 'ISSUED', sourceType: 'Sale', sourceId: sale.id,
          counterpartyName: customer?.name, counterpartyTaxId: customer?.taxIdNumber, netAmount: netTotal, taxAmount: taxTotal, grossAmount: total,
          issueDate: occurredAt, taxPeriod: occurredAt.toISOString().slice(0, 7),
        } }); taxDocumentId = taxDocument.id;
      }
      await tx.payment.updateMany({ where: { saleId: sale.id }, data: { accountingEventId: event.id } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'commerce.sale.completed', aggregateType: 'Sale', aggregateId: sale.id, payload: { companyId: scope.companyId, branchId: scope.branchId, saleId: sale.id, accountingEventId: event.id, taxDocumentId, occurredAt: occurredAt.toISOString(), ...(options.offline ? { offline: options.offline } : {}) } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_SALE', entityType: 'Sale', entityId: sale.id, payload: { ...(dto as unknown as Record<string, unknown>), occurredAt: occurredAt.toISOString(), ...(options.offline ? { offline: options.offline } : {}) } as Prisma.InputJsonValue } });
      const saleResult = await tx.sale.update({ where: { id: sale.id }, data: { accountingEventId: event.id, taxDocumentId }, include: { items: { include: { product: true } }, payments: true } });

      // Loyalty mutations — atomik dalam tx penjualan (T360-20260825).
      if (loyaltyProgram && dto.customerId) {
        const earnPoints = Math.floor(Number(total) * Number(loyaltyProgram.earnRate));
        let runningBalance = loyaltyAccount?.points ?? 0;
        if (redeemRequested > 0 && loyaltyAccount) {
          runningBalance -= redeemRequested;
          await tx.loyaltyAccount.update({ where: { id: loyaltyAccount.id }, data: { points: { decrement: redeemRequested } } });
          await tx.loyaltyTransaction.create({ data: {
            accountId: loyaltyAccount.id, type: 'REDEEM', points: -redeemRequested, balanceAfter: runningBalance,
            referenceType: 'Sale', referenceId: sale.id,
          } });
        }
        if (earnPoints > 0) {
          const account = await tx.loyaltyAccount.upsert({
            where: { programId_customerId: { programId: loyaltyProgram.id, customerId: dto.customerId } },
            create: { programId: loyaltyProgram.id, customerId: dto.customerId },
            update: {},
            select: { id: true, points: true },
          });
          runningBalance += earnPoints;
          await tx.loyaltyAccount.update({ where: { id: account.id }, data: { points: { increment: earnPoints }, lifetimePoints: { increment: earnPoints } } });
          await tx.loyaltyTransaction.create({ data: {
            accountId: account.id, type: 'EARN', points: earnPoints, balanceAfter: runningBalance,
            referenceType: 'Sale', referenceId: sale.id,
          } });
        }
        await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'LOYALTY_SALE_SYNC', entityType: 'Sale', entityId: sale.id, payload: { customerId: dto.customerId, redeemed: redeemRequested, earned: earnPoints } as Prisma.InputJsonValue } });
        (saleResult as unknown as { loyaltyEarned?: number }).loyaltyEarned = earnPoints;
        (saleResult as unknown as { loyaltyRedeemed?: number }).loyaltyRedeemed = redeemRequested;
      }

      if (scopeKey) await completeIdempotent(tx, { companyId: scope.companyId, scope: scopeKey, key: dto.idempotencyKey!, resourceType: 'Sale', resourceId: sale.id, response: saleResult });
      return saleResult;
    });

    // Alert stok benar-benar dijalankan setelah transaksi commit sehingga tidak memperpanjang lock transaksi.
    try {
      await this.stockAlerts.alertLowStock(scope.companyId, scope.branchId, productIds, warehouse.id);
    } catch { /* best-effort */ }
    return saleResult;
  }
}
