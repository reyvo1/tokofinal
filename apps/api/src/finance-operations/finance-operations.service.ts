import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { FinanceTransactionType, Prisma, TaxTransactionDirection } from '@prisma/client';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { parseBusinessDateBoundary } from '../common/business-time';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { nextDocumentNumber } from '../common/numbering';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveFinanceTransactionDto, CreateFinanceTransactionDto } from './dto/finance-operations.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
const FINANCE_TRANSACTION_STATUSES = new Set(['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'POSTED', 'PAID', 'CANCELLED']);

function validatedFinanceStatus(status?: string): string | undefined {
  if (!status) return undefined;
  if (!FINANCE_TRANSACTION_STATUSES.has(status)) throw new BadRequestException('Status transaksi keuangan tidak valid.');
  return status;
}

@Injectable()
export class FinanceOperationsService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingCoreService) {}

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

  private async assertRequestedScope(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    requestedCompanyId?: string,
    requestedBranchId?: string,
    entityType = 'FinanceTransaction',
  ): Promise<void> {
    if ((requestedCompanyId && requestedCompanyId !== scope.companyId)
      || (requestedBranchId && requestedBranchId !== scope.branchId)) {
      await this.denyTenantAccess(client, user, scope, entityType, undefined, {
        authenticatedCompanyId: scope.companyId,
        authenticatedBranchId: scope.branchId,
        ...(requestedCompanyId ? { requestedCompanyId } : {}),
        ...(requestedBranchId ? { requestedBranchId } : {}),
      });
    }
  }

  private async scopedTransaction(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.operationalFinanceTransaction.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'OperationalFinanceTransaction', id);
    return row;
  }

  private async supplierPayableSnapshot(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    goodsReceiptId: string,
    excludeFinanceTransactionId?: string,
  ) {
    const receipt = await client.goodsReceipt.findFirst({
      where: {
        id: goodsReceiptId,
        operationalStatus: { in: ['CONFIRMED', 'PARTIALLY_ACCEPTED'] },
        warehouse: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
      },
      include: { supplier: true, purchaseOrder: true },
    });
    if (!receipt) return this.denyTenantAccess(client, user, scope, 'GoodsReceipt', goodsReceiptId);

    const [returns, payments] = await Promise.all([
      client.purchaseReturn.findMany({
        where: { goodsReceiptId: receipt.id, status: 'COMPLETED' },
        select: { amount: true },
      }),
      client.operationalFinanceTransaction.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          type: 'SUPPLIER_PAYMENT',
          referenceType: 'GoodsReceipt',
          referenceId: receipt.id,
          status: { not: 'CANCELLED' },
          ...(excludeFinanceTransactionId ? { id: { not: excludeFinanceTransactionId } } : {}),
        },
        select: { grossAmount: true, status: true },
      }),
    ]);
    const gross = new Prisma.Decimal(receipt.grossTotal);
    const returned = returns.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
    let paid = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    for (const payment of payments) {
      if (['POSTED', 'PAID'].includes(payment.status)) paid = paid.add(payment.grossAmount);
      else if (['DRAFT', 'WAITING_APPROVAL', 'APPROVED'].includes(payment.status)) pending = pending.add(payment.grossAmount);
    }
    const rawOutstanding = gross.sub(returned).sub(paid);
    const outstanding = rawOutstanding.greaterThan(0) ? rawOutstanding : new Prisma.Decimal(0);
    const rawAvailable = outstanding.sub(pending);
    const available = rawAvailable.greaterThan(0) ? rawAvailable : new Prisma.Decimal(0);
    return { receipt, gross, returned, paid, pending, outstanding, available };
  }

  private async assetPayableSnapshot(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    assetId: string,
    excludeFinanceTransactionId?: string,
  ) {
    const asset = await client.asset.findFirst({
      where: { id: assetId, companyId: scope.companyId, branchId: scope.branchId, supplierId: { not: null } },
    });
    if (!asset) return this.denyTenantAccess(client, user, scope, 'Asset', assetId);
    const supplier = await client.supplier.findFirst({ where: { id: asset.supplierId!, companyId: scope.companyId } });
    if (!supplier) return this.denyTenantAccess(client, user, scope, 'Supplier', asset.supplierId!);
    const acquisition = await client.accountingEvent.findFirst({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        sourceType: 'Asset',
        sourceId: asset.id,
        eventType: 'ASSET_ACQUISITION_CREDIT',
        status: 'POSTED',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!acquisition) throw new BadRequestException('Aset tidak memiliki acquisition payable yang sudah diposting.');
    const payments = await client.operationalFinanceTransaction.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        type: 'SUPPLIER_PAYMENT',
        referenceType: 'Asset',
        referenceId: asset.id,
        status: { not: 'CANCELLED' },
        ...(excludeFinanceTransactionId ? { id: { not: excludeFinanceTransactionId } } : {}),
      },
      select: { grossAmount: true, status: true },
    });
    let paid = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    for (const payment of payments) {
      if (['POSTED', 'PAID'].includes(payment.status)) paid = paid.add(payment.grossAmount);
      else if (['DRAFT', 'WAITING_APPROVAL', 'APPROVED'].includes(payment.status)) pending = pending.add(payment.grossAmount);
    }
    const gross = new Prisma.Decimal(acquisition.grossAmount);
    const rawOutstanding = gross.sub(paid);
    const outstanding = rawOutstanding.greaterThan(0) ? rawOutstanding : new Prisma.Decimal(0);
    const rawAvailable = outstanding.sub(pending);
    const available = rawAvailable.greaterThan(0) ? rawAvailable : new Prisma.Decimal(0);
    return { asset, supplier, supplierId: supplier.id, gross, paid, pending, outstanding, available };
  }

  private async operationalCreditPayableSnapshot(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    referenceType: 'MaintenanceWorkOrder'|'FuelTransaction',
    referenceId: string,
    excludeFinanceTransactionId?: string,
  ) {
    let supplierId: string;
    let eventType: string;
    let document: Record<string, unknown>;
    if (referenceType === 'MaintenanceWorkOrder') {
      const work = await client.maintenanceWorkOrder.findFirst({
        where: { id: referenceId, companyId: scope.companyId, branchId: scope.branchId, status: 'COMPLETED', vendorId: { not: null } },
      });
      if (!work?.vendorId) return this.denyTenantAccess(client, user, scope, 'MaintenanceWorkOrder', referenceId);
      supplierId = work.vendorId;
      eventType = 'ASSET_MAINTENANCE_CREDIT';
      document = work as unknown as Record<string, unknown>;
    } else {
      const fuel = await client.fuelTransaction.findFirst({
        where: { id: referenceId, companyId: scope.companyId, branchId: scope.branchId, supplierId: { not: null } },
      });
      if (!fuel?.supplierId) return this.denyTenantAccess(client, user, scope, 'FuelTransaction', referenceId);
      supplierId = fuel.supplierId;
      eventType = 'FLEET_FUEL_CREDIT';
      document = fuel as unknown as Record<string, unknown>;
    }
    const supplier = await client.supplier.findFirst({ where: { id: supplierId, companyId: scope.companyId } });
    if (!supplier) return this.denyTenantAccess(client, user, scope, 'Supplier', supplierId);
    const event = await client.accountingEvent.findFirst({
      where: { companyId: scope.companyId, branchId: scope.branchId, sourceType: referenceType, sourceId: referenceId, eventType, status: 'POSTED' },
      orderBy: { createdAt: 'asc' },
    });
    if (!event) throw new BadRequestException(`${referenceType} tidak memiliki supplier payable yang sudah diposting.`);
    const payments = await client.operationalFinanceTransaction.findMany({
      where: {
        companyId: scope.companyId, branchId: scope.branchId, type: 'SUPPLIER_PAYMENT', referenceType, referenceId,
        status: { not: 'CANCELLED' }, ...(excludeFinanceTransactionId ? { id: { not: excludeFinanceTransactionId } } : {}),
      },
      select: { grossAmount: true, status: true },
    });
    let paid = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    for (const payment of payments) {
      if (['POSTED', 'PAID'].includes(payment.status)) paid = paid.add(payment.grossAmount);
      else if (['DRAFT', 'WAITING_APPROVAL', 'APPROVED'].includes(payment.status)) pending = pending.add(payment.grossAmount);
    }
    const gross = new Prisma.Decimal(event.grossAmount);
    const rawOutstanding = gross.sub(paid);
    const outstanding = rawOutstanding.greaterThan(0) ? rawOutstanding : new Prisma.Decimal(0);
    const rawAvailable = outstanding.sub(pending);
    const available = rawAvailable.greaterThan(0) ? rawAvailable : new Prisma.Decimal(0);
    return { document, supplier, supplierId, gross, paid, pending, outstanding, available, event };
  }

  private async supplierPayableReferenceSnapshot(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    referenceType: string,
    referenceId: string,
    excludeFinanceTransactionId?: string,
  ) {
    if (referenceType === 'GoodsReceipt') {
      const snapshot = await this.supplierPayableSnapshot(client, user, scope, referenceId, excludeFinanceTransactionId);
      return { ...snapshot, supplierId: snapshot.receipt.supplierId };
    }
    if (referenceType === 'Asset') return this.assetPayableSnapshot(client, user, scope, referenceId, excludeFinanceTransactionId);
    if (referenceType === 'MaintenanceWorkOrder' || referenceType === 'FuelTransaction') {
      return this.operationalCreditPayableSnapshot(client, user, scope, referenceType, referenceId, excludeFinanceTransactionId);
    }
    throw new BadRequestException('Pembayaran supplier hanya dapat mereferensikan GoodsReceipt, Asset, MaintenanceWorkOrder, atau FuelTransaction kredit.');
  }

  private async supplierRefundSnapshot(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    purchaseReturnId: string,
    excludeFinanceTransactionId?: string,
  ) {
    const purchaseReturn = await client.purchaseReturn.findFirst({
      where: {
        id: purchaseReturnId,
        status: 'COMPLETED',
        supplierReceivableAmount: { gt: 0 },
      },
    });
    if (!purchaseReturn) return this.denyTenantAccess(client, user, scope, 'PurchaseReturn', purchaseReturnId);
    const warehouse = await client.warehouse.findFirst({
      where: { id: purchaseReturn.warehouseId, branchId: scope.branchId, branch: { companyId: scope.companyId } },
      select: { id: true },
    });
    if (!warehouse) return this.denyTenantAccess(client, user, scope, 'PurchaseReturn', purchaseReturnId);
    const supplier = await client.supplier.findFirst({ where: { id: purchaseReturn.supplierId, companyId: scope.companyId } });
    if (!supplier) return this.denyTenantAccess(client, user, scope, 'Supplier', purchaseReturn.supplierId);
    const refunds = await client.operationalFinanceTransaction.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        type: 'SUPPLIER_REFUND',
        referenceType: 'PurchaseReturn',
        referenceId: purchaseReturn.id,
        status: { not: 'CANCELLED' },
        ...(excludeFinanceTransactionId ? { id: { not: excludeFinanceTransactionId } } : {}),
      },
      select: { grossAmount: true, status: true },
    });
    let received = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    for (const refund of refunds) {
      if (['POSTED','PAID'].includes(refund.status)) received = received.add(refund.grossAmount);
      else if (['DRAFT','WAITING_APPROVAL','APPROVED'].includes(refund.status)) pending = pending.add(refund.grossAmount);
    }
    const receivable = new Prisma.Decimal(purchaseReturn.supplierReceivableAmount);
    const rawOutstanding = receivable.sub(received);
    const outstanding = rawOutstanding.greaterThan(0) ? rawOutstanding : new Prisma.Decimal(0);
    const rawAvailable = outstanding.sub(pending);
    const available = rawAvailable.greaterThan(0) ? rawAvailable : new Prisma.Decimal(0);
    return { purchaseReturn, supplier, receivable, received, pending, outstanding, available };
  }

  private async customerReceivableSnapshot(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    referenceType: 'Order' | 'Sale',
    referenceId: string,
    excludeFinanceTransactionId?: string,
  ) {
    let payment: any;
    let documentNumber = '';
    let customerName = '';
    let customerPhone: string | null = null;
    let customerId: string | null = null;
    let gross = new Prisma.Decimal(0);
    let documentDate = new Date();
    let sourceStatus = '';
    let receivableAccountCode = '1201';

    if (referenceType === 'Order') {
      const order = await client.order.findFirst({
        where: {
          id: referenceId,
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
          status: { in: ['SHIPPED','COMPLETED'] },
        },
        include: { payments: true },
      });
      if (!order) return this.denyTenantAccess(client, user, scope, 'Order', referenceId);
      payment = order.payments[0];
      if (!payment || !['COD','INVOICE'].includes(payment.method)) throw new BadRequestException('Order bukan transaksi piutang COD/INVOICE.');
      if (!order.accountingEventId) throw new BadRequestException('Order belum mempunyai posting fulfillment/piutang.');
      gross = new Prisma.Decimal(order.total);
      receivableAccountCode = payment.method === 'COD' ? '1203' : '1201';
      documentNumber = order.number;
      customerName = order.customerName;
      customerPhone = order.customerPhone ?? null;
      customerId = order.customerId ?? null;
      documentDate = payment.createdAt;
      sourceStatus = order.status;
    } else {
      const sale = await client.sale.findFirst({
        where: { id: referenceId, branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED' },
        include: { payments: true, customer: true },
      });
      if (!sale) return this.denyTenantAccess(client, user, scope, 'Sale', referenceId);
      payment = sale.payments.find((item) => item.method === 'ON_ACCOUNT');
      if (!payment) throw new BadRequestException('Sale bukan transaksi piutang pelanggan.');
      if (!sale.accountingEventId) throw new BadRequestException('Sale belum mempunyai posting accounting/piutang.');
      const returns = await client.saleReturn.findMany({
        where: { saleId: sale.id, status: 'COMPLETED' },
        select: { refundDetails: true },
      });
      let receivableReturns = new Prisma.Decimal(0);
      for (const row of returns) {
        if (!Array.isArray(row.refundDetails)) continue;
        for (const value of row.refundDetails) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const item = value as Record<string, unknown>;
          if (item.sourcePaymentId !== payment.id || item.kind !== 'RECEIVABLE') continue;
          receivableReturns = receivableReturns.add(typeof item.amount === 'string' || typeof item.amount === 'number' ? item.amount : 0);
        }
      }
      const receivableAfterReturns = new Prisma.Decimal(payment.amount).sub(receivableReturns);
      gross = receivableAfterReturns.greaterThan(0) ? receivableAfterReturns : new Prisma.Decimal(0);
      receivableAccountCode = payment.settlementAccountCode ?? '1201';
      documentNumber = sale.number;
      customerName = sale.customer?.name ?? 'Pelanggan';
      customerPhone = sale.customer?.phone ?? null;
      customerId = sale.customerId ?? null;
      documentDate = payment.createdAt;
      sourceStatus = sale.status;
    }

    const receipts = await client.operationalFinanceTransaction.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        type: 'CUSTOMER_RECEIPT',
        referenceType,
        referenceId,
        status: { not: 'CANCELLED' },
        ...(excludeFinanceTransactionId ? { id: { not: excludeFinanceTransactionId } } : {}),
      },
      select: { grossAmount: true, status: true },
    });
    let received = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    for (const receipt of receipts) {
      if (['POSTED','PAID'].includes(receipt.status)) received = received.add(receipt.grossAmount);
      else if (['DRAFT','WAITING_APPROVAL','APPROVED'].includes(receipt.status)) pending = pending.add(receipt.grossAmount);
    }
    const rawOutstanding = gross.sub(received);
    const outstanding = rawOutstanding.greaterThan(0) ? rawOutstanding : new Prisma.Decimal(0);
    const rawAvailable = outstanding.sub(pending);
    const available = rawAvailable.greaterThan(0) ? rawAvailable : new Prisma.Decimal(0);
    return { referenceType, referenceId, documentNumber, customerName, customerPhone, customerId, payment, gross, received, pending, outstanding, available, receivableAccountCode, documentDate, sourceStatus };
  }

  private async payrollLiabilitySnapshot(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    payrollRunId: string,
    liabilityAccountCode: string,
    excludeFinanceTransactionId?: string,
  ) {
    if (!['2103', '2104'].includes(liabilityAccountCode)) {
      throw new BadRequestException('Settlement kewajiban payroll hanya mendukung akun 2103/2104.');
    }
    const run = await client.payrollRun.findFirst({
      where: { id: payrollRunId, companyId: scope.companyId, branchId: scope.branchId, status: { in: ['POSTED', 'PAID'] } },
    });
    if (!run) return this.denyTenantAccess(client, user, scope, 'PayrollRun', payrollRunId);
    const rootRunId = run.adjustmentOfRunId ?? run.id;
    const chainRuns = await client.payrollRun.findMany({ where: {
      companyId: scope.companyId, branchId: scope.branchId, status: { in: ['POSTED', 'PAID'] },
      OR: [{ id: rootRunId }, { adjustmentOfRunId: rootRunId }],
    } });
    if (!chainRuns.some((item) => item.id === rootRunId)) throw new BadRequestException('Payroll sumber adjustment tidak lagi tersedia sebagai POSTED/PAID.');
    const recognized = liabilityAccountCode === '2103'
      ? chainRuns.reduce((sum, item) => sum.add(item.taxTotal), new Prisma.Decimal(0))
      : chainRuns.reduce((sum, item) => sum.add(item.deductionTotal).add(item.employerContributionTotal), new Prisma.Decimal(0));
    const chainRunIds = chainRuns.map((item) => item.id);
    const settlements = await client.operationalFinanceTransaction.findMany({
      where: {
        companyId: scope.companyId, branchId: scope.branchId, referenceType: 'PayrollRun', referenceId: { in: chainRunIds },
        debitAccountCode: liabilityAccountCode,
        type: { in: ['PAYROLL_LIABILITY_PAYMENT', ...(liabilityAccountCode === '2103' ? ['TAX_PAYMENT'] : [])] as FinanceTransactionType[] },
        status: { not: 'CANCELLED' },
        ...(excludeFinanceTransactionId ? { id: { not: excludeFinanceTransactionId } } : {}),
      },
      select: { grossAmount: true, status: true },
    });
    let paid = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    for (const row of settlements) {
      if (['POSTED', 'PAID'].includes(row.status)) paid = paid.add(row.grossAmount);
      else if (['DRAFT', 'WAITING_APPROVAL', 'APPROVED'].includes(row.status)) pending = pending.add(row.grossAmount);
    }
    const rawOutstanding = recognized.sub(paid);
    const outstanding = rawOutstanding.greaterThan(0) ? rawOutstanding : new Prisma.Decimal(0);
    const rawAvailable = outstanding.sub(pending);
    const available = rawAvailable.greaterThan(0) ? rawAvailable : new Prisma.Decimal(0);
    return { run, rootRunId, chainRunIds, recognized, paid, pending, outstanding, available };
  }

  private async parseAsOf(companyId: string, value?: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new BadRequestException('Company tidak ditemukan.');
    return parseBusinessDateBoundary(value, new Date(), company.timezone, true);
  }

  private agingDays(documentDate: Date, asOf: Date) {
    return Math.max(0, Math.floor((asOf.getTime() - documentDate.getTime()) / 86400000));
  }

  private agingBucket(days: number) {
    if (days <= 0) return 'CURRENT';
    if (days <= 30) return '1_30';
    if (days <= 60) return '31_60';
    if (days <= 90) return '61_90';
    return '90_PLUS';
  }

  private summarizeAging(rows: Array<{ outstandingAmount: string | number; agingBucket: string }>) {
    const buckets: Record<string, { count: number; amount: string }> = {};
    const values = new Map<string, Prisma.Decimal>();
    for (const key of ['CURRENT','1_30','31_60','61_90','90_PLUS']) { values.set(key, new Prisma.Decimal(0)); buckets[key] = { count: 0, amount: '0.00' }; }
    for (const row of rows) {
      const key = row.agingBucket;
      const amount = new Prisma.Decimal(row.outstandingAmount);
      values.set(key, (values.get(key) ?? new Prisma.Decimal(0)).add(amount));
      buckets[key] = { count: (buckets[key]?.count ?? 0) + 1, amount: values.get(key)!.toFixed(2) };
    }
    const total = [...values.values()].reduce((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
    return { asOfBuckets: buckets, totalOutstanding: total.toFixed(2), openDocuments: rows.length };
  }

  async listCustomerReceivables(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const [orders, sales] = await Promise.all([
      this.prisma.order.findMany({
        where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, status: { in: ['SHIPPED','COMPLETED'] }, payments: { some: { method: { in: ['COD','INVOICE'] } } } },
        select: { id: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
      this.prisma.sale.findMany({
        where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED', payments: { some: { method: 'ON_ACCOUNT' } } },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
    ]);
    const result: Array<Record<string, unknown>> = [];
    for (const order of orders) {
      const snapshot = await this.customerReceivableSnapshot(this.prisma, user, scope, 'Order', order.id);
      result.push({
        referenceType: 'Order', referenceId: order.id, documentNumber: snapshot.documentNumber,
        orderId: order.id, orderNumber: snapshot.documentNumber,
        customerName: snapshot.customerName, customerPhone: snapshot.customerPhone, customerId: snapshot.customerId,
        paymentMethod: snapshot.payment.method, receivableAccountCode: snapshot.receivableAccountCode,
        grossAmount: snapshot.gross.toFixed(2), receivedAmount: snapshot.received.toFixed(2), pendingAmount: snapshot.pending.toFixed(2),
        outstandingAmount: snapshot.outstanding.toFixed(2), availableToReceive: snapshot.available.toFixed(2), documentDate: snapshot.documentDate, sourceStatus: snapshot.sourceStatus,
      });
    }
    for (const sale of sales) {
      const snapshot = await this.customerReceivableSnapshot(this.prisma, user, scope, 'Sale', sale.id);
      result.push({
        referenceType: 'Sale', referenceId: sale.id, documentNumber: snapshot.documentNumber,
        saleId: sale.id, saleNumber: snapshot.documentNumber,
        customerName: snapshot.customerName, customerPhone: snapshot.customerPhone, customerId: snapshot.customerId,
        paymentMethod: snapshot.payment.method, receivableAccountCode: snapshot.receivableAccountCode,
        grossAmount: snapshot.gross.toFixed(2), receivedAmount: snapshot.received.toFixed(2), pendingAmount: snapshot.pending.toFixed(2),
        outstandingAmount: snapshot.outstanding.toFixed(2), availableToReceive: snapshot.available.toFixed(2), documentDate: snapshot.documentDate, sourceStatus: snapshot.sourceStatus,
      });
    }
    return result.sort((left, right) => new Date(String(right.documentDate)).getTime() - new Date(String(left.documentDate)).getTime()).slice(0, 500);
  }

  async listSupplierPayables(user: AuthUser, supplierId?: string) {
    const scope = this.requireTenantScope(user);
    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, companyId: scope.companyId }, select: { id: true } });
      if (!supplier) return this.denyTenantAccess(this.prisma, user, scope, 'Supplier', supplierId);
    }
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: {
        operationalStatus: { in: ['CONFIRMED', 'PARTIALLY_ACCEPTED'] },
        warehouse: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
        supplier: { companyId: scope.companyId, ...(supplierId ? { id: supplierId } : {}) },
        items: { every: { product: { companyId: scope.companyId } } },
      },
      include: { supplier: true, purchaseOrder: true },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const receiptIds = receipts.map((row) => row.id);
    const [returns, receiptPayments, creditEvents] = await Promise.all([
      receiptIds.length ? this.prisma.purchaseReturn.findMany({ where: { goodsReceiptId: { in: receiptIds }, status: 'COMPLETED' }, select: { goodsReceiptId: true, amount: true } }) : Promise.resolve([]),
      receiptIds.length ? this.prisma.operationalFinanceTransaction.findMany({
        where: { companyId: scope.companyId, branchId: scope.branchId, type: 'SUPPLIER_PAYMENT', referenceType: 'GoodsReceipt', referenceId: { in: receiptIds }, status: { not: 'CANCELLED' } },
        select: { referenceId: true, grossAmount: true, status: true },
      }) : Promise.resolve([]),
      this.prisma.accountingEvent.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: 'POSTED',
          OR: [
            { eventType: 'ASSET_ACQUISITION_CREDIT', sourceType: 'Asset' },
            { eventType: 'ASSET_MAINTENANCE_CREDIT', sourceType: 'MaintenanceWorkOrder' },
            { eventType: 'FLEET_FUEL_CREDIT', sourceType: 'FuelTransaction' },
          ],
        },
        orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: 500,
      }),
    ]);
    const returnedByReceipt = new Map<string, Prisma.Decimal>();
    for (const row of returns) if (row.goodsReceiptId) returnedByReceipt.set(row.goodsReceiptId, (returnedByReceipt.get(row.goodsReceiptId) ?? new Prisma.Decimal(0)).add(row.amount));
    const paidByReceipt = new Map<string, Prisma.Decimal>();
    const pendingByReceipt = new Map<string, Prisma.Decimal>();
    for (const row of receiptPayments) {
      if (!row.referenceId) continue;
      const target = ['POSTED', 'PAID'].includes(row.status) ? paidByReceipt : pendingByReceipt;
      target.set(row.referenceId, (target.get(row.referenceId) ?? new Prisma.Decimal(0)).add(row.grossAmount));
    }
    const result: Array<Record<string, unknown>> = receipts.map((receipt) => {
      const gross = new Prisma.Decimal(receipt.grossTotal);
      const returned = returnedByReceipt.get(receipt.id) ?? new Prisma.Decimal(0);
      const paid = paidByReceipt.get(receipt.id) ?? new Prisma.Decimal(0);
      const pending = pendingByReceipt.get(receipt.id) ?? new Prisma.Decimal(0);
      const rawOutstanding = gross.sub(returned).sub(paid);
      const outstanding = rawOutstanding.greaterThan(0) ? rawOutstanding : new Prisma.Decimal(0);
      const rawAvailable = outstanding.sub(pending);
      const available = rawAvailable.greaterThan(0) ? rawAvailable : new Prisma.Decimal(0);
      return {
        referenceType: 'GoodsReceipt', referenceId: receipt.id, documentNumber: receipt.number,
        goodsReceiptId: receipt.id, goodsReceiptNumber: receipt.number,
        purchaseOrderId: receipt.purchaseOrderId, purchaseOrderNumber: receipt.purchaseOrder.number,
        supplierId: receipt.supplierId, supplierName: receipt.supplier.name, paymentTermDays: receipt.supplier.paymentTermDays, transactionDate: receipt.receivedAt, receivedAt: receipt.receivedAt,
        grossAmount: gross.toFixed(2), returnedAmount: returned.toFixed(2), paidAmount: paid.toFixed(2), pendingPaymentAmount: pending.toFixed(2),
        outstandingAmount: outstanding.toFixed(2), availableToPay: available.toFixed(2),
      };
    });

    const assetIds = creditEvents.filter((event) => event.sourceType === 'Asset').map((event) => event.sourceId);
    const maintenanceIds = creditEvents.filter((event) => event.sourceType === 'MaintenanceWorkOrder').map((event) => event.sourceId);
    const fuelIds = creditEvents.filter((event) => event.sourceType === 'FuelTransaction').map((event) => event.sourceId);
    const [assets, maintenanceRows, fuelRows] = await Promise.all([
      assetIds.length ? this.prisma.asset.findMany({ where: { id: { in: assetIds }, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true, code: true, name: true, supplierId: true, acquisitionDate: true } }) : Promise.resolve([]),
      maintenanceIds.length ? this.prisma.maintenanceWorkOrder.findMany({ where: { id: { in: maintenanceIds }, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true, number: true, vendorId: true, completedAt: true, assetId: true } }) : Promise.resolve([]),
      fuelIds.length ? this.prisma.fuelTransaction.findMany({ where: { id: { in: fuelIds }, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true, supplierId: true, receiptNumber: true, transactionDate: true, vehicleId: true } }) : Promise.resolve([]),
    ]);
    const assetMap = new Map(assets.map((row) => [row.id, row]));
    const maintenanceMap = new Map(maintenanceRows.map((row) => [row.id, row]));
    const fuelMap = new Map(fuelRows.map((row) => [row.id, row]));
    const supplierIds = [...new Set([
      ...assets.map((row) => row.supplierId),
      ...maintenanceRows.map((row) => row.vendorId),
      ...fuelRows.map((row) => row.supplierId),
    ].filter(Boolean) as string[])];
    const suppliers = supplierIds.length ? await this.prisma.supplier.findMany({ where: { id: { in: supplierIds }, companyId: scope.companyId }, select: { id: true, name: true, paymentTermDays: true } }) : [];
    const supplierMap = new Map(suppliers.map((row) => [row.id, row]));
    for (const event of creditEvents) {
      const referenceType = event.sourceType as 'Asset'|'MaintenanceWorkOrder'|'FuelTransaction';
      let sourceSupplierId: string | null | undefined;
      let documentNumber = event.sourceId;
      let sourceName = event.sourceType;
      let transactionDate: Date = event.businessDate;
      if (referenceType === 'Asset') {
        const row = assetMap.get(event.sourceId); if (!row) continue;
        sourceSupplierId = row.supplierId; documentNumber = row.code; sourceName = row.name; transactionDate = row.acquisitionDate ?? event.businessDate;
      } else if (referenceType === 'MaintenanceWorkOrder') {
        const row = maintenanceMap.get(event.sourceId); if (!row) continue;
        sourceSupplierId = row.vendorId; documentNumber = row.number; sourceName = `Maintenance ${row.number}`; transactionDate = row.completedAt ?? event.businessDate;
      } else {
        const row = fuelMap.get(event.sourceId); if (!row) continue;
        sourceSupplierId = row.supplierId; documentNumber = row.receiptNumber ?? row.id; sourceName = `BBM ${row.receiptNumber ?? row.id.slice(0, 8)}`; transactionDate = row.transactionDate;
      }
      if (!sourceSupplierId || (supplierId && sourceSupplierId !== supplierId)) continue;
      const snapshot = await this.supplierPayableReferenceSnapshot(this.prisma, user, scope, referenceType, event.sourceId);
      result.push({
        referenceType, referenceId: event.sourceId, documentNumber, sourceName,
        assetId: referenceType === 'Asset' ? event.sourceId : undefined,
        assetCode: referenceType === 'Asset' ? documentNumber : undefined,
        assetName: referenceType === 'Asset' ? sourceName : undefined,
        supplierId: sourceSupplierId, supplierName: supplierMap.get(sourceSupplierId)?.name ?? 'Supplier', paymentTermDays: supplierMap.get(sourceSupplierId)?.paymentTermDays ?? 0, transactionDate,
        grossAmount: snapshot.gross.toFixed(2), returnedAmount: '0.00', paidAmount: snapshot.paid.toFixed(2), pendingPaymentAmount: snapshot.pending.toFixed(2),
        outstandingAmount: snapshot.outstanding.toFixed(2), availableToPay: snapshot.available.toFixed(2),
      });
    }
    return result.sort((a, b) => new Date(String(b.transactionDate ?? 0)).getTime() - new Date(String(a.transactionDate ?? 0)).getTime());
  }

  async listSupplierRefundReceivables(user: AuthUser, supplierId?: string) {
    const scope = this.requireTenantScope(user);
    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, companyId: scope.companyId }, select: { id: true } });
      if (!supplier) return this.denyTenantAccess(this.prisma, user, scope, 'Supplier', supplierId);
    }
    const warehouses = await this.prisma.warehouse.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true },
    });
    const warehouseIds = warehouses.map((row) => row.id);
    if (!warehouseIds.length) return [];
    const returns = await this.prisma.purchaseReturn.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        status: 'COMPLETED',
        supplierReceivableAmount: { gt: 0 },
        ...(supplierId ? { supplierId } : {}),
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const result = [];
    for (const row of returns) {
      const snapshot = await this.supplierRefundSnapshot(this.prisma, user, scope, row.id);
      result.push({
        purchaseReturnId: row.id,
        purchaseReturnNumber: row.number,
        supplierId: row.supplierId,
        supplierName: snapshot.supplier.name,
        creditNoteNumber: row.supplierCreditNoteNumber,
        receivableAmount: snapshot.receivable.toFixed(2),
        receivedAmount: snapshot.received.toFixed(2),
        pendingAmount: snapshot.pending.toFixed(2),
        outstandingAmount: snapshot.outstanding.toFixed(2),
        availableToReceive: snapshot.available.toFixed(2),
        postedAt: row.postedAt,
      });
    }
    return result;
  }

  async customerReceivableAging(user: AuthUser, asOfValue?: string) {
    const scope = this.requireTenantScope(user);
    const asOf = await this.parseAsOf(scope.companyId, asOfValue);
    const rows = (await this.listCustomerReceivables(user))
      .filter((row) => new Prisma.Decimal(String(row.outstandingAmount ?? 0)).greaterThan(0))
      .map((row) => {
        const documentDate = new Date(String(row.documentDate));
        const ageDays = this.agingDays(documentDate, asOf);
        return {
          ...row,
          outstandingAmount: String(row.outstandingAmount ?? 0),
          ageDays,
          agingBucket: this.agingBucket(ageDays),
        };
      });
    return { asOf: asOf.toISOString(), ...this.summarizeAging(rows), rows };
  }

  async supplierPayableAging(user: AuthUser, asOfValue?: string, supplierId?: string) {
    const scope = this.requireTenantScope(user);
    const asOf = await this.parseAsOf(scope.companyId, asOfValue);
    const rows = (await this.listSupplierPayables(user, supplierId))
      .filter((row) => new Prisma.Decimal(String(row.outstandingAmount ?? 0)).greaterThan(0))
      .map((row) => {
        const documentDate = new Date(String(row.transactionDate));
        const paymentTermDays = Number(row.paymentTermDays ?? 0);
        const dueDate = new Date(documentDate.getTime() + paymentTermDays * 86400000);
        const ageDays = this.agingDays(dueDate, asOf);
        return { ...row, outstandingAmount: String(row.outstandingAmount ?? 0), dueDate: dueDate.toISOString(), ageDays, agingBucket: this.agingBucket(ageDays) };
      });
    return { asOf: asOf.toISOString(), ...this.summarizeAging(rows), rows };
  }

  async cashBankPosition(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const [statements, transactions] = await Promise.all([
      this.prisma.bankStatement.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, bankAccountId: { not: null } }, select: { bankAccountId: true, closingBalance: true, periodEnd: true, importedAt: true }, orderBy: { importedAt: 'desc' } }),
      this.prisma.operationalFinanceTransaction.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, status: { not: 'CANCELLED' } }, select: { debitAccountCode: true, creditAccountCode: true, type: true }, take: 5000 }),
    ]);
    const settlementCodes = new Set<string>(['1101','1102']);
    for (const row of transactions) {
      if (['CUSTOMER_RECEIPT','SUPPLIER_PAYMENT','SUPPLIER_REFUND','TAX_PAYMENT','PAYROLL_LIABILITY_PAYMENT','CASH_TRANSFER','BANK_TRANSFER','OPERATING_EXPENSE','OTHER_INCOME'].includes(row.type)) {
        settlementCodes.add(row.debitAccountCode); settlementCodes.add(row.creditAccountCode);
      }
    }
    const statementAccountIds = [...new Set(statements.map((row) => row.bankAccountId).filter((value): value is string => Boolean(value)))];
    const accounts = await this.prisma.account.findMany({ where: { branchId: scope.branchId, type: 'ASSET', isActive: true, branch: { companyId: scope.companyId }, OR: [{ code: { in: [...settlementCodes] } }, ...(statementAccountIds.length ? [{ id: { in: statementAccountIds } }] : [])] }, orderBy: { code: 'asc' } });
    const result = [];
    for (const account of accounts) {
      const lines = await this.prisma.journalLine.findMany({ where: { accountId: account.id }, select: { debit: true, credit: true } });
      const bookBalance = lines.reduce((sum, row) => sum.add(row.debit).sub(row.credit), new Prisma.Decimal(0));
      const latestStatement = statements.find((row) => row.bankAccountId === account.id);
      result.push({ accountId: account.id, code: account.code, name: account.name, bookBalance: bookBalance.toFixed(2), latestStatementBalance: latestStatement?.closingBalance?.toFixed(2) ?? null, latestStatementAt: latestStatement?.periodEnd ?? latestStatement?.importedAt ?? null, statementDelta: latestStatement?.closingBalance ? latestStatement.closingBalance.sub(bookBalance).toFixed(2) : null });
    }
    return result;
  }

  async settlementTrace(user: AuthUser, referenceType?: string, referenceId?: string) {
    const scope = this.requireTenantScope(user);
    if (!referenceType || !referenceId) throw new BadRequestException('referenceType dan referenceId wajib diisi.');
    const transactions = await this.prisma.operationalFinanceTransaction.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId, referenceType, referenceId },
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
    });
    const eventIds = transactions.map((row) => row.accountingEventId).filter((value): value is string => Boolean(value));
    const events = eventIds.length ? await this.prisma.accountingEvent.findMany({ where: { id: { in: eventIds }, companyId: scope.companyId, branchId: scope.branchId }, include: { postings: true }, orderBy: { businessDate: 'asc' } }) : [];
    const journalIds = [...new Set(events.flatMap((event) => event.postings.map((posting) => posting.journalEntryId)))];
    const journals = journalIds.length ? await this.prisma.journalEntry.findMany({ where: { id: { in: journalIds } }, include: { lines: { include: { account: true } } }, orderBy: { date: 'asc' } }) : [];
    return { reference: { type: referenceType, id: referenceId }, transactions, accountingEvents: events, journals };
  }

  async list(
    user: AuthUser,
    type?: FinanceTransactionType,
    status?: string,
    limitValue?: string,
    cursorValue?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ transactionDate: string; id: string }>(cursorValue);
    const validatedStatus = validatedFinanceStatus(status);
    const rows = await this.prisma.operationalFinanceTransaction.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        ...(type ? { type } : {}),
        ...(validatedStatus ? { status: validatedStatus as never } : {}),
        ...(cursor ? { OR: [
          { transactionDate: { lt: new Date(cursor.transactionDate) } },
          { transactionDate: new Date(cursor.transactionDate), id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ transactionDate: item.transactionDate.toISOString(), id: item.id }));
  }

  async create(dto: CreateFinanceTransactionDto, user: AuthUser, headerIdempotencyKey?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId);
    const bodyIdempotencyKey = dto.idempotencyKey?.trim();
    const headerKey = headerIdempotencyKey?.trim();
    if (bodyIdempotencyKey && headerKey && bodyIdempotencyKey !== headerKey) {
      throw new BadRequestException('Idempotency key pada body dan header harus sama.');
    }
    const idempotencyKey = bodyIdempotencyKey || headerKey;
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency key wajib untuk membuat transaksi keuangan. Kirim idempotencyKey atau header Idempotency-Key dan gunakan key yang sama saat retry.');
    }
    if (idempotencyKey.length > 200) throw new BadRequestException('Idempotency key maksimal 200 karakter.');
    const { idempotencyKey: _bodyKey, ...idempotencyPayload } = dto;

    return serializableTx(this.prisma, async (tx) => {
      const legacyExisting = await tx.operationalFinanceTransaction.findUnique({
        where: { companyId_idempotencyKey: { companyId: scope.companyId, idempotencyKey } },
      });
      const transactionDate = dto.transactionDate ? new Date(dto.transactionDate) : legacyExisting?.transactionDate ?? new Date();
      if (Number.isNaN(transactionDate.getTime())) throw new BadRequestException('Tanggal transaksi keuangan tidak valid.');
      const expectedTaxScopes = dto.type === 'OPERATING_EXPENSE'
        ? ['EXPENSE', 'PURCHASE', 'OTHER']
        : dto.type === 'OTHER_INCOME'
          ? ['SALE', 'OTHER']
          : undefined;
      const tax = await this.accounting.calculateTax(tx, dto.taxCodeId, dto.amount, scope.companyId, transactionDate, expectedTaxScopes);
      const isIncome = dto.type === 'OTHER_INCOME';
      const net = tax.net;
      const taxAmount = tax.tax;
      const gross = tax.gross;
      if (!taxAmount.isZero() && !dto.taxAccountCode) {
        throw new BadRequestException('Akun pajak wajib diisi ketika transaksi memiliki pajak.');
      }

      const existing = legacyExisting;
      if (existing) {
        if (existing.branchId !== scope.branchId) {
          await this.denyTenantAccess(tx, user, scope, 'OperationalFinanceTransaction', existing.id, {
            authenticatedCompanyId: scope.companyId,
            authenticatedBranchId: scope.branchId,
            existingBranchId: existing.branchId,
            idempotencyKey,
          });
        }
        const sameIdentity = existing.type === (dto.type as FinanceTransactionType)
          && existing.description === dto.description
          && existing.netAmount.equals(net)
          && existing.taxAmount.equals(taxAmount)
          && existing.grossAmount.equals(gross)
          && existing.taxCodeId === (dto.taxCodeId ?? null)
          && existing.debitAccountCode === dto.debitAccountCode
          && existing.creditAccountCode === dto.creditAccountCode
          && existing.taxAccountCode === (dto.taxAccountCode ?? null)
          && existing.paymentMethod === (dto.paymentMethod ?? null)
          && existing.referenceType === (dto.referenceType ?? null)
          && existing.referenceId === (dto.referenceId ?? null);
        if (!sameIdentity) {
          throw new ConflictException('Idempotency key sudah digunakan untuk transaksi keuangan dengan payload berbeda.');
        }
        return existing;
      }

      const gate = await beginIdempotent(tx, {
        companyId: scope.companyId,
        scope: `finance:${scope.companyId}:${scope.branchId}`,
        key: idempotencyKey,
        payload: idempotencyPayload,
      });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response as never;

      if (dto.type === 'CUSTOMER_RECEIPT') {
        if (!dto.referenceId || !dto.referenceType || !['Order', 'Sale'].includes(dto.referenceType)) {
          throw new BadRequestException('Penerimaan pelanggan wajib mereferensikan Order terkirim atau Sale piutang yang sudah diposting.');
        }
        if (dto.taxCodeId || dto.taxAccountCode || !taxAmount.isZero()) {
          throw new BadRequestException('Penerimaan piutang pelanggan tidak membuat pajak baru; tax code tidak boleh diisi.');
        }
        const receivable = await this.customerReceivableSnapshot(tx, user, scope, dto.referenceType as 'Order' | 'Sale', dto.referenceId);
        if (dto.creditAccountCode !== receivable.receivableAccountCode) {
          throw new BadRequestException(`Penerimaan ${receivable.payment.method} wajib mengkredit akun ${receivable.receivableAccountCode}.`);
        }
        const settlementAccount = await tx.account.findFirst({
          where: { branchId: scope.branchId, code: dto.debitAccountCode, type: 'ASSET', isActive: true }, select: { id: true },
        });
        if (!settlementAccount) throw new BadRequestException('Akun penerimaan pelanggan harus berupa akun aset aktif pada branch.');
        if (gross.lessThanOrEqualTo(0)) throw new BadRequestException('Nominal penerimaan pelanggan harus lebih dari nol.');
        if (gross.greaterThan(receivable.available)) {
          throw new BadRequestException(`Penerimaan pelanggan melebihi piutang tersedia (${receivable.available.toFixed(2)}).`);
        }
      }

      if (dto.type === 'SUPPLIER_PAYMENT') {
        if (!dto.referenceType || !dto.referenceId || !['GoodsReceipt', 'Asset', 'MaintenanceWorkOrder', 'FuelTransaction'].includes(dto.referenceType)) {
          throw new BadRequestException('Pembayaran supplier wajib mereferensikan dokumen payable yang sudah diposting (GoodsReceipt/Asset/Maintenance/Fuel).');
        }
        if (dto.taxCodeId || dto.taxAccountCode || !taxAmount.isZero()) {
          throw new BadRequestException('Pembayaran utang supplier tidak membuat pajak baru; tax code tidak boleh diisi.');
        }
        if (dto.debitAccountCode !== '2101') {
          throw new BadRequestException('Pembayaran supplier wajib mendebit akun Utang Usaha (2101).');
        }
        const settlementAccount = await tx.account.findFirst({
          where: { branchId: scope.branchId, code: dto.creditAccountCode, type: 'ASSET', isActive: true },
          select: { id: true },
        });
        if (!settlementAccount) throw new BadRequestException('Akun sumber pembayaran supplier harus berupa akun aset aktif pada branch (contoh Kas/Bank).');
        const payable = await this.supplierPayableReferenceSnapshot(tx, user, scope, dto.referenceType, dto.referenceId);
        if (dto.counterpartyId && dto.counterpartyId !== payable.supplierId) {
          return this.denyTenantAccess(tx, user, scope, 'Supplier', dto.counterpartyId);
        }
        if (gross.lessThanOrEqualTo(0)) throw new BadRequestException('Nominal pembayaran supplier harus lebih dari nol.');
        if (gross.greaterThan(payable.available)) {
          throw new BadRequestException(`Pembayaran supplier melebihi sisa yang tersedia (${payable.available.toFixed(2)}).`);
        }
      }

      if (dto.type === 'SUPPLIER_REFUND') {
        if (dto.referenceType !== 'PurchaseReturn' || !dto.referenceId) {
          throw new BadRequestException('Refund supplier wajib mereferensikan PurchaseReturn yang sudah diposting.');
        }
        if (dto.taxCodeId || dto.taxAccountCode || !taxAmount.isZero()) {
          throw new BadRequestException('Penerimaan refund supplier tidak membuat pajak baru; tax code tidak boleh diisi.');
        }
        if (dto.creditAccountCode !== '1202') {
          throw new BadRequestException('Refund supplier wajib mengkredit akun Piutang Refund Supplier (1202).');
        }
        const settlementAccount = await tx.account.findFirst({
          where: { branchId: scope.branchId, code: dto.debitAccountCode, type: 'ASSET', isActive: true },
          select: { id: true },
        });
        if (!settlementAccount) throw new BadRequestException('Akun penerima refund supplier harus berupa akun aset aktif pada branch (Kas/Bank).');
        const receivable = await this.supplierRefundSnapshot(tx, user, scope, dto.referenceId);
        if (dto.counterpartyId && dto.counterpartyId !== receivable.purchaseReturn.supplierId) {
          return this.denyTenantAccess(tx, user, scope, 'Supplier', dto.counterpartyId);
        }
        if (gross.lessThanOrEqualTo(0)) throw new BadRequestException('Nominal refund supplier harus lebih dari nol.');
        if (gross.greaterThan(receivable.available)) {
          throw new BadRequestException(`Refund supplier melebihi piutang yang tersedia (${receivable.available.toFixed(2)}).`);
        }
      }

      if (dto.type === 'PAYROLL_LIABILITY_PAYMENT') {
        if (dto.referenceType !== 'PayrollRun' || !dto.referenceId) {
          throw new BadRequestException('Pembayaran kewajiban payroll wajib mereferensikan PayrollRun yang sudah diposting.');
        }
        if (dto.taxCodeId || dto.taxAccountCode || !taxAmount.isZero()) {
          throw new BadRequestException('Pelunasan kewajiban payroll tidak membuat pajak baru; tax code tidak boleh diisi.');
        }
        if (!['2103', '2104'].includes(dto.debitAccountCode)) {
          throw new BadRequestException('Pelunasan kewajiban payroll wajib mendebit 2103 (PPh payroll) atau 2104 (BPJS/potongan payroll).');
        }
        const settlementAccount = await tx.account.findFirst({
          where: { branchId: scope.branchId, code: dto.creditAccountCode, type: 'ASSET', isActive: true, branch: { companyId: scope.companyId } },
          select: { id: true },
        });
        if (!settlementAccount) throw new BadRequestException('Sumber pembayaran kewajiban payroll harus berupa akun aset aktif pada branch (Kas/Bank).');
        const liability = await this.payrollLiabilitySnapshot(tx, user, scope, dto.referenceId, dto.debitAccountCode);
        if (gross.lessThanOrEqualTo(0)) throw new BadRequestException('Nominal pembayaran kewajiban payroll harus lebih dari nol.');
        if (gross.greaterThan(liability.available)) {
          throw new BadRequestException(`Pembayaran kewajiban payroll melebihi saldo tersedia (${liability.available.toFixed(2)}).`);
        }
      }

      if (dto.type === 'TAX_PAYMENT') {
        if (dto.taxCodeId || dto.taxAccountCode || !taxAmount.isZero()) {
          throw new BadRequestException('Pembayaran utang pajak tidak membuat pajak baru; tax code tidak boleh diisi.');
        }
        const taxPayableAccount = await tx.account.findFirst({
          where: {
            branchId: scope.branchId,
            code: dto.debitAccountCode,
            type: 'LIABILITY',
            isActive: true,
            branch: { companyId: scope.companyId },
          },
          select: { id: true, code: true },
        });
        if (!taxPayableAccount || !['2103', '2201', '2202'].includes(taxPayableAccount.code)) {
          throw new BadRequestException('Pembayaran pajak wajib mendebit akun utang pajak aktif (2103/2201/2202).');
        }
        const settlementAccount = await tx.account.findFirst({
          where: {
            branchId: scope.branchId,
            code: dto.creditAccountCode,
            type: 'ASSET',
            isActive: true,
            branch: { companyId: scope.companyId },
          },
          select: { id: true },
        });
        if (!settlementAccount) throw new BadRequestException('Pembayaran pajak wajib mengkredit akun aset aktif pada branch (Kas/Bank).');
        if (gross.lessThanOrEqualTo(0)) throw new BadRequestException('Nominal pembayaran pajak harus lebih dari nol.');
      }

      const created = await tx.operationalFinanceTransaction.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'FINANCE_TRANSACTION', prefix: 'FIN' }),
        type: dto.type as FinanceTransactionType,
        status: dto.requireApproval ? 'WAITING_APPROVAL' : 'DRAFT',
        transactionDate,
        counterpartyType: dto.counterpartyType,
        counterpartyId: dto.counterpartyId,
        counterpartyName: dto.counterpartyName,
        description: dto.description,
        netAmount: net,
        taxAmount,
        grossAmount: gross,
        taxCodeId: dto.taxCodeId,
        debitAccountCode: dto.debitAccountCode,
        creditAccountCode: dto.creditAccountCode,
        taxAccountCode: dto.taxAccountCode,
        paymentMethod: dto.paymentMethod,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        evidence: dto.evidence as Prisma.InputJsonValue | undefined,
        metadata: { ...(dto.metadata ?? {}), taxDirection: isIncome ? 'OUTPUT' : 'INPUT' },
        idempotencyKey,
        createdById: user.sub,
      } });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_FINANCE_TRANSACTION',
          entityType: 'OperationalFinanceTransaction',
          entityId: created.id,
          payload: { branchId: scope.branchId, type: created.type, number: created.number },
        },
      });
      await completeIdempotent(tx, {
        companyId: scope.companyId,
        scope: `finance:${scope.companyId}:${scope.branchId}`,
        key: idempotencyKey,
        resourceType: 'OperationalFinanceTransaction',
        resourceId: created.id,
        response: created,
      });
      return created;
    });
  }

  async approve(id: string, dto: ApproveFinanceTransactionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.scopedTransaction(tx, user, scope, id);
      if (!['DRAFT','WAITING_APPROVAL'].includes(row.status)) {
        throw new BadRequestException(`Transaksi berstatus ${row.status}.`);
      }
      const updated = await tx.operationalFinanceTransaction.update({
        where: { id: row.id },
        data: {
          status: 'APPROVED',
          approvedById: user.sub,
          approvedAt: new Date(),
          metadata: { ...((row.metadata as Record<string, unknown> | null) ?? {}), approvalNotes: dto.notes },
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'APPROVE_FINANCE_TRANSACTION',
          entityType: 'OperationalFinanceTransaction',
          entityId: row.id,
          payload: { branchId: scope.branchId, notes: dto.notes },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reject(id: string, dto: ApproveFinanceTransactionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.scopedTransaction(tx, user, scope, id);
      if (row.status !== 'WAITING_APPROVAL') {
        throw new BadRequestException(`Transaksi hanya dapat ditolak dari status WAITING_APPROVAL, status saat ini ${row.status}.`);
      }
      const updated = await tx.operationalFinanceTransaction.update({
        where: { id: row.id },
        data: {
          status: 'CANCELLED',
          metadata: { ...((row.metadata as Record<string, unknown> | null) ?? {}), rejectionNotes: dto.notes, rejectedById: user.sub, rejectedAt: new Date().toISOString() },
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'REJECT_FINANCE_TRANSACTION',
          entityType: 'OperationalFinanceTransaction',
          entityId: row.id,
          payload: { branchId: scope.branchId, notes: dto.notes },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async cancel(id: string, dto: ApproveFinanceTransactionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.scopedTransaction(tx, user, scope, id);
      if (!['DRAFT', 'WAITING_APPROVAL', 'APPROVED'].includes(row.status)) {
        throw new BadRequestException(`Transaksi tidak dapat dibatalkan dari status ${row.status}.`);
      }
      const updated = await tx.operationalFinanceTransaction.update({
        where: { id: row.id },
        data: {
          status: 'CANCELLED',
          metadata: { ...((row.metadata as Record<string, unknown> | null) ?? {}), cancellationNotes: dto.notes, cancelledById: user.sub, cancelledAt: new Date().toISOString() },
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CANCEL_FINANCE_TRANSACTION',
          entityType: 'OperationalFinanceTransaction',
          entityId: row.id,
          payload: { branchId: scope.branchId, previousStatus: row.status, notes: dto.notes },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async post(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await this.scopedTransaction(tx, user, scope, id);
      if (!['DRAFT','APPROVED'].includes(row.status)) {
        throw new BadRequestException(`Transaksi tidak dapat diposting dari status ${row.status}.`);
      }
      const eventType = this.resolveEventType(row.type);
      const isExpense = row.type === 'OPERATING_EXPENSE';
      const isIncome = row.type === 'OTHER_INCOME';
      const isCustomerReceipt = row.type === 'CUSTOMER_RECEIPT';
      const isSupplierPayment = row.type === 'SUPPLIER_PAYMENT';
      const isSupplierRefund = row.type === 'SUPPLIER_REFUND';
      const isTaxPayment = row.type === 'TAX_PAYMENT';
      const isPayrollLiabilityPayment = row.type === 'PAYROLL_LIABILITY_PAYMENT';
      let customerReceivable: any = null;
      if (isCustomerReceipt) {
        if (!row.referenceId || !row.referenceType || !['Order', 'Sale'].includes(row.referenceType)) {
          throw new BadRequestException('Penerimaan pelanggan kehilangan referensi Order/Sale yang valid.');
        }
        customerReceivable = await this.customerReceivableSnapshot(tx, user, scope, row.referenceType as 'Order' | 'Sale', row.referenceId, row.id);
        if (row.creditAccountCode !== customerReceivable.receivableAccountCode) throw new BadRequestException('Akun piutang penerimaan pelanggan tidak sesuai dokumen sumber.');
        if (row.grossAmount.greaterThan(customerReceivable.available)) {
          throw new BadRequestException(`Penerimaan pelanggan melebihi piutang tersedia saat posting (${customerReceivable.available.toFixed(2)}).`);
        }
      }
      if (isSupplierPayment) {
        if (!row.referenceType || !row.referenceId || !['GoodsReceipt', 'Asset', 'MaintenanceWorkOrder', 'FuelTransaction'].includes(row.referenceType)) {
          throw new BadRequestException('Pembayaran supplier kehilangan referensi payable yang valid.');
        }
        const payable = await this.supplierPayableReferenceSnapshot(tx, user, scope, row.referenceType, row.referenceId, row.id);
        if (row.grossAmount.greaterThan(payable.available)) {
          throw new BadRequestException(`Pembayaran supplier melebihi utang tersedia saat posting (${payable.available.toFixed(2)}).`);
        }
      }
      if (isSupplierRefund) {
        if (row.referenceType !== 'PurchaseReturn' || !row.referenceId) throw new BadRequestException('Refund supplier kehilangan referensi PurchaseReturn.');
        const receivable = await this.supplierRefundSnapshot(tx, user, scope, row.referenceId, row.id);
        if (row.grossAmount.greaterThan(receivable.available)) {
          throw new BadRequestException(`Refund supplier melebihi piutang tersedia saat posting (${receivable.available.toFixed(2)}).`);
        }
      }
      if (isPayrollLiabilityPayment) {
        if (row.referenceType !== 'PayrollRun' || !row.referenceId) throw new BadRequestException('Pembayaran kewajiban payroll kehilangan referensi PayrollRun.');
        if (!['2103', '2104'].includes(row.debitAccountCode)) throw new BadRequestException('Akun kewajiban payroll tidak lagi valid saat posting.');
        const settlementAccount = await tx.account.findFirst({
          where: { branchId: scope.branchId, code: row.creditAccountCode, type: 'ASSET', isActive: true, branch: { companyId: scope.companyId } },
          select: { id: true },
        });
        if (!settlementAccount) throw new BadRequestException('Akun sumber settlement payroll tidak lagi valid saat posting.');
        const liability = await this.payrollLiabilitySnapshot(tx, user, scope, row.referenceId, row.debitAccountCode, row.id);
        if (row.grossAmount.greaterThan(liability.available)) {
          throw new BadRequestException(`Pembayaran kewajiban payroll melebihi saldo tersedia saat posting (${liability.available.toFixed(2)}).`);
        }
      }
      if (isTaxPayment) {
        const [taxPayableAccount, settlementAccount] = await Promise.all([
          tx.account.findFirst({
            where: { branchId: scope.branchId, code: row.debitAccountCode, type: 'LIABILITY', isActive: true, branch: { companyId: scope.companyId } },
            select: { code: true },
          }),
          tx.account.findFirst({
            where: { branchId: scope.branchId, code: row.creditAccountCode, type: 'ASSET', isActive: true, branch: { companyId: scope.companyId } },
            select: { id: true },
          }),
        ]);
        if (!taxPayableAccount || !['2103', '2201', '2202'].includes(taxPayableAccount.code) || !settlementAccount) {
          throw new BadRequestException('Akun pembayaran pajak tidak lagi valid saat posting.');
        }
      }
      const taxDirection: TaxTransactionDirection | null = row.taxCodeId && !row.taxAmount.isZero()
        ? (isIncome ? 'OUTPUT' : 'INPUT') : null;
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        eventType,
        sourceType: 'OperationalFinanceTransaction',
        sourceId: row.id,
        idempotencyKey: `accounting:${row.idempotencyKey}`,
        businessDate: row.transactionDate,
        amounts: isExpense ? { net: row.netAmount, inputTax: row.taxAmount, gross: row.grossAmount }
          : isIncome ? { gross: row.grossAmount, net: row.netAmount, outputTax: row.taxAmount }
          : { gross: row.grossAmount },
        accountCodes: isExpense
          ? { expense: row.debitAccountCode, inputTax: row.taxAccountCode ?? row.debitAccountCode, settlement: row.creditAccountCode }
          : isIncome
            ? { settlement: row.debitAccountCode, revenue: row.creditAccountCode, outputTax: row.taxAccountCode ?? row.creditAccountCode }
            : isCustomerReceipt
              ? { settlement: row.debitAccountCode, receivable: row.creditAccountCode }
              : isSupplierPayment
                ? { payable: row.debitAccountCode, settlement: row.creditAccountCode }
                : isSupplierRefund
                ? { settlement: row.debitAccountCode, supplierReceivable: row.creditAccountCode }
                : isPayrollLiabilityPayment
                  ? { payrollLiability: row.debitAccountCode, settlement: row.creditAccountCode }
                  : isTaxPayment
                    ? { taxPayable: row.debitAccountCode, settlement: row.creditAccountCode }
                    : { debit: row.debitAccountCode, credit: row.creditAccountCode },
        taxLines: taxDirection && row.taxCodeId ? [{
          taxCodeId: row.taxCodeId,
          direction: taxDirection,
          taxableBase: row.netAmount,
          taxAmount: row.taxAmount,
          counterpartyType: row.counterpartyType ?? undefined,
          counterpartyId: row.counterpartyId ?? undefined,
          documentNumber: row.number,
        }] : undefined,
        context: { transactionType: row.type, paymentMethod: row.paymentMethod, postedById: user.sub },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'POST_FINANCE_TRANSACTION',
          entityType: 'OperationalFinanceTransaction',
          entityId: row.id,
          payload: { branchId: scope.branchId, eventId: event.id },
        },
      });
      await tx.eventOutbox.create({
        data: {
          companyId: scope.companyId,
          eventType: 'finance.transaction.posted',
          aggregateType: 'OperationalFinanceTransaction',
          aggregateId: row.id,
          payload: {
            companyId: scope.companyId,
            branchId: scope.branchId,
            transactionId: row.id,
            accountingEventId: event.id,
          },
        },
      });
      const posted = await tx.operationalFinanceTransaction.update({
        where: { id: row.id },
        data: { status: 'POSTED', accountingEventId: event.id, postedAt: new Date() },
      });
      if (isCustomerReceipt && customerReceivable) {
        const receivedAfter = customerReceivable.received.add(row.grossAmount);
        if (receivedAfter.greaterThanOrEqualTo(customerReceivable.gross)) {
          await tx.payment.update({ where: { id: customerReceivable.payment.id }, data: { status: 'PAID', paidAt: new Date() } });
        }
      }
      return posted;
    });
  }

  private resolveEventType(type: FinanceTransactionType) {
    if (type === 'OPERATING_EXPENSE') return 'OPERATING_EXPENSE';
    if (type === 'OTHER_INCOME') return 'OTHER_INCOME';
    if (type === 'CUSTOMER_RECEIPT') return 'CUSTOMER_RECEIPT';
    if (type === 'SUPPLIER_PAYMENT') return 'SUPPLIER_PAYMENT';
    if (type === 'SUPPLIER_REFUND') return 'SUPPLIER_REFUND';
    if (type === 'TAX_PAYMENT') return 'TAX_PAYMENT';
    if (type === 'PAYROLL_LIABILITY_PAYMENT') return 'PAYROLL_LIABILITY_PAYMENT';
    return 'BALANCE_TRANSFER';
  }
}
