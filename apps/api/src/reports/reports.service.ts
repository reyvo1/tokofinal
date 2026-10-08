import { BadRequestException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { existsSync, createReadStream, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { businessDateKey, businessDayBounds, businessHour, businessMonthStart, parseBusinessDateBoundary, startOfBusinessDaysAgo, zonedDateParts, zonedLocalToUtc } from '../common/business-time';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportJobDto } from './dto/create-report-job.dto';
import { CreateReportScheduleDto, UpdateReportScheduleDto } from './dto/report-schedule.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };

function accountNormalBalance(type: string, debit: Prisma.Decimal, credit: Prisma.Decimal): Prisma.Decimal {
  return ['ASSET', 'EXPENSE'].includes(type) ? debit.sub(credit) : credit.sub(debit);
}


type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

function nextScheduledReportRun(
  after: Date,
  timeZone: string,
  frequency: ReportFrequency,
  localTime: string,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
): Date {
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(after); } catch { throw new BadRequestException('Timezone company tidak valid.'); }
  const [hour, minute] = localTime.split(':').map(Number);
  const current = zonedDateParts(after, timeZone);
  let localDate = new Date(Date.UTC(current.year, current.month - 1, current.day, hour, minute, 0, 0));
  if (frequency === 'WEEKLY') {
    if (dayOfWeek === undefined || dayOfWeek === null) throw new BadRequestException('dayOfWeek wajib untuk schedule WEEKLY.');
    const currentDow = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
    localDate.setUTCDate(localDate.getUTCDate() + ((dayOfWeek - currentDow + 7) % 7));
  } else if (frequency === 'MONTHLY') {
    if (dayOfMonth === undefined || dayOfMonth === null) throw new BadRequestException('dayOfMonth wajib untuk schedule MONTHLY.');
    localDate = new Date(Date.UTC(current.year, current.month - 1, dayOfMonth, hour, minute, 0, 0));
  }
  let candidate = zonedLocalToUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), hour, minute, timeZone);
  if (candidate <= after) {
    if (frequency === 'DAILY') localDate.setUTCDate(localDate.getUTCDate() + 1);
    else if (frequency === 'WEEKLY') localDate.setUTCDate(localDate.getUTCDate() + 7);
    else localDate = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, dayOfMonth!, hour, minute, 0, 0));
    candidate = zonedLocalToUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), hour, minute, timeZone);
  }
  return candidate;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
    entityType = 'Report',
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

  private async branchWarehouseIds(client: DbClient, user: AuthUser, scope: TenantScope): Promise<string[]> {
    const branch = await client.branch.findFirst({
      where: { id: scope.branchId, companyId: scope.companyId },
      select: { id: true },
    });
    if (!branch) return this.denyTenantAccess(client, user, scope, 'Branch', scope.branchId);
    const warehouses = await client.warehouse.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      select: { id: true },
    });
    return warehouses.map((warehouse) => warehouse.id);
  }

  private async companyTimeZone(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new ForbiddenException('Tenant tidak ditemukan.');
    // Validated by business-time helpers as well; returning the persisted value keeps one authority.
    return company.timezone;
  }

  private async accountActivity(scope: TenantScope, from?: Date, to?: Date) {
    const grouped = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        ...(from || to ? { journalEntry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}),
        account: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      },
      _sum: { debit: true, credit: true },
    });
    const ids = grouped.map((row) => row.accountId);
    const accounts = ids.length ? await this.prisma.account.findMany({
      where: { id: { in: ids }, branchId: scope.branchId, branch: { companyId: scope.companyId } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    }) : [];
    const activity = new Map(grouped.map((row) => [row.accountId, row]));
    return accounts.map((account) => {
      const row = activity.get(account.id);
      const debit = new Prisma.Decimal(row?._sum.debit ?? 0);
      const credit = new Prisma.Decimal(row?._sum.credit ?? 0);
      return { ...account, debit, credit, balance: accountNormalBalance(account.type, debit, credit) };
    });
  }

  private async reportRange(scope: TenantScope, fromValue?: string, toValue?: string) {
    const now = new Date();
    const timeZone = await this.companyTimeZone(scope.companyId);
    const from = parseBusinessDateBoundary(fromValue, businessMonthStart(now, timeZone), timeZone, false);
    const to = parseBusinessDateBoundary(toValue, now, timeZone, true);
    if (from > to) throw new BadRequestException('Tanggal awal tidak boleh melebihi tanggal akhir.');
    return { from, to, timeZone };
  }

  async dashboard(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const warehouseIds = await this.branchWarehouseIds(this.prisma, user, scope);
    const now = new Date();
    const timeZone = await this.companyTimeZone(scope.companyId);
    const { start } = businessDayBounds(now, timeZone);
    const [financialActivity, recognizedTransactions, inventorySummary, inventoryTotals, pendingOrders, recentReceipts] = await Promise.all([
      this.accountActivity(scope, start, now),
      this.prisma.accountingEvent.count({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: 'POSTED',
          businessDate: { gte: start, lte: now },
          eventType: { in: ['SALE_CASH', 'SALE_BANK', 'SALE_SPLIT', 'ONLINE_ORDER_PREPAID_FULFILLED', 'ONLINE_ORDER_CREDIT_FULFILLED'] },
        },
      }),
      this.prisma.dailyInventorySummary.findFirst({
        where: { companyId: scope.companyId, warehouseId: { in: warehouseIds } },
        orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.inventory.aggregate({
        where: { warehouseId: { in: warehouseIds } },
        _count: true,
        _sum: { quantity: true, reserved: true, available: true },
      }),
      this.prisma.order.count({
        where: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
          status: { in: ['PAID', 'PROCESSING', 'PACKED'] },
        },
      }),
      this.prisma.goodsReceipt.findMany({
        where: { warehouseId: { in: warehouseIds } },
        include: { supplier: true },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    ]);

    const revenue = financialActivity.filter((row) => row.type === 'REVENUE')
      .reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const cogs = financialActivity.filter((row) => row.code === '5101')
      .reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const expenses = financialActivity.filter((row) => row.type === 'EXPENSE')
      .reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const netProfit = revenue.sub(expenses);
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      today: {
        revenue: Number(revenue),
        recognizedRevenue: Number(revenue),
        transactions: recognizedTransactions,
        cogs: Number(cogs),
        grossProfit: Number(revenue.sub(cogs)),
        expenses: Number(expenses),
        netProfit: Number(netProfit),
        source: 'POSTED_JOURNAL',
      },
      inventory: {
        items: inventorySummary?.skuCount ?? inventoryTotals._count,
        lowStock: inventorySummary?.lowStockCount ?? 0,
        value: Number(inventorySummary?.inventoryValue ?? 0),
        quantity: inventorySummary?.quantity ?? inventoryTotals._sum.quantity ?? 0,
        reserved: inventorySummary?.reserved ?? inventoryTotals._sum.reserved ?? 0,
        available: inventorySummary?.available ?? inventoryTotals._sum.available ?? 0,
        source: inventorySummary ? 'DAILY_SUMMARY' : 'LIVE_TOTALS_WITHOUT_VALUE',
      },
      pendingOrders,
      recentReceipts,
    };
  }

  async analytics(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const timeZone = await this.companyTimeZone(scope.companyId);
    const start = startOfBusinessDaysAgo(new Date(), timeZone, 29);

    // Gunakan jurnal POSTED sebagai sumber kebenaran analitik keuangan. Daily summary boleh kosong
    // pada instalasi yang belum menjalankan materializer, jadi dashboard tidak boleh bergantung padanya.
    const [recognizedEvents, cogsLines, cashLines] = await Promise.all([
      this.prisma.accountingEvent.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: 'POSTED',
          businessDate: { gte: start },
          eventType: { in: ['SALE_CASH', 'SALE_BANK', 'SALE_SPLIT', 'ONLINE_ORDER_PREPAID_FULFILLED', 'ONLINE_ORDER_CREDIT_FULFILLED', 'SALE_RETURN', 'ORDER_RETURN'] },
        },
        select: { businessDate: true, eventType: true, netAmount: true },
        orderBy: { businessDate: 'asc' },
      }),
      this.prisma.journalLine.findMany({
        where: {
          account: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: '5101' },
          journalEntry: { date: { gte: start } },
        },
        select: { debit: true, credit: true, journalEntry: { select: { date: true } } },
      }),
      this.prisma.journalLine.findMany({
        where: {
          account: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: { in: ['1101', '1102', '1103'] } },
          journalEntry: { date: { gte: start } },
        },
        select: { debit: true, credit: true, journalEntry: { select: { date: true, description: true } } },
      }),
    ]);
    const salesByDay = new Map<string, { revenue: number; cogs: number; transactions: number }>();
    const channelRevenue = new Map<string, number>();
    for (const event of recognizedEvents) {
      const key = businessDateKey(new Date(event.businessDate), timeZone);
      const bucket = salesByDay.get(key) ?? { revenue: 0, cogs: 0, transactions: 0 };
      const signedRevenue = ['SALE_RETURN','ORDER_RETURN'].includes(event.eventType) ? -Number(event.netAmount) : Number(event.netAmount);
      bucket.revenue += signedRevenue;
      if (!['SALE_RETURN','ORDER_RETURN'].includes(event.eventType)) bucket.transactions += 1;
      salesByDay.set(key, bucket);
      const channel = event.eventType.startsWith('ONLINE_ORDER_') ? 'STOREFRONT' : 'POS';
      channelRevenue.set(channel, (channelRevenue.get(channel) ?? 0) + signedRevenue);
    }
    for (const line of cogsLines) {
      const key = businessDateKey(new Date(line.journalEntry.date), timeZone);
      const bucket = salesByDay.get(key) ?? { revenue: 0, cogs: 0, transactions: 0 };
      bucket.cogs += Number(line.debit) - Number(line.credit);
      salesByDay.set(key, bucket);
    }
    const cashByDay = new Map<string, { cashIn: number; cashOut: number }>();
    for (const line of cashLines) {
      // Transfer internal Kas <-> Bank bukan arus kas perusahaan dan sengaja dikeluarkan.
      if (line.journalEntry.description.startsWith('BALANCE_TRANSFER ')) continue;
      const key = businessDateKey(new Date(line.journalEntry.date), timeZone);
      const bucket = cashByDay.get(key) ?? { cashIn: 0, cashOut: 0 };
      bucket.cashIn += Number(line.debit);
      bucket.cashOut += Number(line.credit);
      cashByDay.set(key, bucket);
    }
    const topItems = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED', createdAt: { gte: start } } },
      _sum: { quantity: true, grossSubtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });
    const productIds = topItems.map((row) => row.productId);
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } }) : [];
    const lowStock = await this.prisma.inventory.findMany({
      where: { warehouseId: { in: await this.branchWarehouseIds(this.prisma, user, scope) } },
      include: { product: true, warehouse: true },
      orderBy: { available: 'asc' },
      take: 5,
    });

    return {
      salesTrend: [...salesByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({
        date,
        revenue: row.revenue,
        profit: row.revenue - row.cogs,
        transactions: row.transactions,
      })),
      channels: [...channelRevenue.entries()].map(([channel, revenue]) => ({ channel, revenue })),
      cashFlow: [...cashByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({
        date,
        cashIn: amount.cashIn,
        cashOut: amount.cashOut,
        netCashFlow: amount.cashIn - amount.cashOut,
      })),
      topProducts: topItems.map((row) => ({
        name: products.find((p) => p.id === row.productId)?.name ?? '(produk terhapus)',
        sku: products.find((p) => p.id === row.productId)?.sku ?? '-',
        quantity: row._sum.quantity ?? 0,
        revenue: Number(row._sum.grossSubtotal ?? 0),
      })),
      lowStock: lowStock.map((row) => ({ name: row.product.name, warehouse: row.warehouse.name, available: row.available, minStock: row.product.minStock })),
    };
  }

  async profitLoss(
    user: AuthUser,
    fromValue?: string,
    toValue?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'ProfitLossReport');
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const activity = await this.accountActivity(scope, from, to);
    const revenueAccounts = activity.filter((row) => row.type === 'REVENUE');
    const expenseAccounts = activity.filter((row) => row.type === 'EXPENSE');
    const revenue = revenueAccounts.reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const expenses = expenseAccounts.reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    return {
      from,
      to,
      companyId: scope.companyId,
      branchId: scope.branchId,
      revenue: Number(revenue),
      expenses: Number(expenses),
      netProfit: Number(revenue.sub(expenses)),
      revenueAccounts: revenueAccounts.map((row) => ({ code: row.code, name: row.name, amount: Number(row.balance) })),
      expenseAccounts: expenseAccounts.map((row) => ({ code: row.code, name: row.name, amount: Number(row.balance) })),
      source: 'POSTED_JOURNAL',
    };
  }

  async trialBalance(
    user: AuthUser,
    fromValue?: string,
    toValue?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'TrialBalanceReport');
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const rows = await this.accountActivity(scope, from, to);
    const totalDebit = rows.reduce((sum, row) => sum.add(row.debit), new Prisma.Decimal(0));
    const totalCredit = rows.reduce((sum, row) => sum.add(row.credit), new Prisma.Decimal(0));
    return {
      from,
      to,
      companyId: scope.companyId,
      branchId: scope.branchId,
      rows: rows.map((row) => ({
        accountId: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        debit: Number(row.debit),
        credit: Number(row.credit),
        normalBalance: Number(row.balance),
      })),
      totalDebit: Number(totalDebit),
      totalCredit: Number(totalCredit),
      difference: Number(totalDebit.sub(totalCredit)),
      balanced: totalDebit.equals(totalCredit),
    };
  }

  async balanceSheet(
    user: AuthUser,
    asOfValue?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'BalanceSheetReport');
    const timeZone = await this.companyTimeZone(scope.companyId);
    const asOf = parseBusinessDateBoundary(asOfValue, new Date(), timeZone, true);
    const rows = await this.accountActivity(scope, undefined, asOf);
    const assets = rows.filter((row) => row.type === 'ASSET');
    const liabilities = rows.filter((row) => row.type === 'LIABILITY');
    const equity = rows.filter((row) => row.type === 'EQUITY');
    const revenue = rows.filter((row) => row.type === 'REVENUE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const expenses = rows.filter((row) => row.type === 'EXPENSE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const currentEarnings = revenue.sub(expenses);
    const totalAssets = assets.reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const totalLiabilities = liabilities.reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const postedEquity = equity.reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const totalEquity = postedEquity.add(currentEarnings);
    const totalLiabilitiesAndEquity = totalLiabilities.add(totalEquity);
    return {
      asOf,
      companyId: scope.companyId,
      branchId: scope.branchId,
      assets: assets.map((row) => ({ code: row.code, name: row.name, amount: Number(row.balance) })),
      liabilities: liabilities.map((row) => ({ code: row.code, name: row.name, amount: Number(row.balance) })),
      equity: equity.map((row) => ({ code: row.code, name: row.name, amount: Number(row.balance) })),
      currentEarnings: Number(currentEarnings),
      totalAssets: Number(totalAssets),
      totalLiabilities: Number(totalLiabilities),
      postedEquity: Number(postedEquity),
      totalEquity: Number(totalEquity),
      totalLiabilitiesAndEquity: Number(totalLiabilitiesAndEquity),
      difference: Number(totalAssets.sub(totalLiabilitiesAndEquity)),
      balanced: totalAssets.equals(totalLiabilitiesAndEquity),
      source: 'POSTED_JOURNAL',
    };
  }

  async generalLedger(
    user: AuthUser,
    accountCode?: string,
    fromValue?: string,
    toValue?: string,
    limitValue?: string,
  ) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const limit = Math.min(parsePageLimit(limitValue), 200);
    if (accountCode) {
      const account = await this.prisma.account.findFirst({
        where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: accountCode },
        select: { id: true },
      });
      if (!account) throw new NotFoundException('Akun buku besar tidak ditemukan pada branch ini.');
    }
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        lines: { some: { account: { branchId: scope.branchId, branch: { companyId: scope.companyId }, ...(accountCode ? { code: accountCode } : {}) } } },
      },
      include: {
        lines: {
          where: { account: { branchId: scope.branchId, branch: { companyId: scope.companyId }, ...(accountCode ? { code: accountCode } : {}) } },
          include: { account: { select: { code: true, name: true, type: true } } },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      from,
      to,
      accountCode: accountCode ?? null,
      entries: entries.map((entry) => ({
        id: entry.id,
        number: entry.number,
        date: entry.date,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: entry.description,
        lines: entry.lines.map((line) => ({
          accountCode: line.account.code,
          accountName: line.account.name,
          accountType: line.account.type,
          debit: Number(line.debit),
          credit: Number(line.credit),
        })),
      })),
    };
  }

  async taxSummary(
    user: AuthUser,
    fromValue?: string,
    toValue?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'TaxSummaryReport');
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const transactions = await this.prisma.taxTransaction.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        status: 'POSTED',
        transactionDate: { gte: from, lte: to },
      },
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
    });
    const taxCodeIds = [...new Set(transactions.map((row) => row.taxCodeId))];
    const taxCodes = taxCodeIds.length ? await this.prisma.taxCode.findMany({
      where: { companyId: scope.companyId, id: { in: taxCodeIds } },
      select: { id: true, code: true, name: true, scope: true, recoverable: true },
    }) : [];
    const codeMap = new Map(taxCodes.map((row) => [row.id, row]));
    const buckets = new Map<string, { taxCodeId: string; code: string; name: string; direction: string; taxableBase: Prisma.Decimal; taxAmount: Prisma.Decimal; recoverable: boolean }>();
    for (const row of transactions) {
      const code = codeMap.get(row.taxCodeId);
      const key = `${row.taxCodeId}:${row.direction}`;
      const current = buckets.get(key) ?? {
        taxCodeId: row.taxCodeId,
        code: code?.code ?? '(tax code terhapus)',
        name: code?.name ?? '(tax code terhapus)',
        direction: row.direction,
        taxableBase: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        recoverable: code?.recoverable ?? false,
      };
      current.taxableBase = current.taxableBase.add(row.taxableBase);
      current.taxAmount = current.taxAmount.add(row.taxAmount);
      buckets.set(key, current);
    }
    const outputTax = transactions.filter((row) => row.direction === 'OUTPUT')
      .reduce((sum, row) => sum.add(row.taxAmount), new Prisma.Decimal(0));
    const recoverableInputTax = transactions.filter((row) => row.direction === 'INPUT' && codeMap.get(row.taxCodeId)?.recoverable)
      .reduce((sum, row) => sum.add(row.taxAmount), new Prisma.Decimal(0));
    const nonRecoverableInputTax = transactions.filter((row) => row.direction === 'INPUT' && !codeMap.get(row.taxCodeId)?.recoverable)
      .reduce((sum, row) => sum.add(row.taxAmount), new Prisma.Decimal(0));
    const withholdingTax = transactions.filter((row) => row.direction === 'WITHHOLDING')
      .reduce((sum, row) => sum.add(row.taxAmount), new Prisma.Decimal(0));
    const netIndirectTax = outputTax.sub(recoverableInputTax);
    const documents = await this.prisma.taxDocument.aggregate({
      where: { companyId: scope.companyId, branchId: scope.branchId, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _count: true,
      _sum: { netAmount: true, taxAmount: true, grossAmount: true },
    });
    return {
      from,
      to,
      companyId: scope.companyId,
      branchId: scope.branchId,
      rows: [...buckets.values()].map((row) => ({ ...row, taxableBase: Number(row.taxableBase), taxAmount: Number(row.taxAmount) })),
      outputTax: Number(outputTax),
      recoverableInputTax: Number(recoverableInputTax),
      nonRecoverableInputTax: Number(nonRecoverableInputTax),
      withholdingTax: Number(withholdingTax),
      netIndirectTaxPayable: Number(Prisma.Decimal.max(netIndirectTax, 0)),
      indirectTaxCredit: Number(Prisma.Decimal.max(netIndirectTax.negated(), 0)),
      taxDocuments: {
        count: documents._count,
        netAmount: Number(documents._sum.netAmount ?? 0),
        taxAmount: Number(documents._sum.taxAmount ?? 0),
        grossAmount: Number(documents._sum.grossAmount ?? 0),
      },
      note: 'Retur tersimpan sebagai TaxTransaction bernilai negatif dan otomatis mengurangi periode terkait.',
    };
  }

  async financialIntegrity(user: AuthUser, asOfValue?: string) {
    const scope = this.requireTenantScope(user);
    const timeZone = await this.companyTimeZone(scope.companyId);
    const asOf = parseBusinessDateBoundary(asOfValue, new Date(), timeZone, true);
    const activity = await this.accountActivity(scope, undefined, asOf);
    const totalDebit = activity.reduce((sum, row) => sum.add(row.debit), new Prisma.Decimal(0));
    const totalCredit = activity.reduce((sum, row) => sum.add(row.credit), new Prisma.Decimal(0));
    const assets = activity.filter((row) => row.type === 'ASSET').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const liabilities = activity.filter((row) => row.type === 'LIABILITY').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const equity = activity.filter((row) => row.type === 'EQUITY').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const revenue = activity.filter((row) => row.type === 'REVENUE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const expenses = activity.filter((row) => row.type === 'EXPENSE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const balanceSheetDifference = assets.sub(liabilities.add(equity).add(revenue.sub(expenses)));
    const journalGroups = await this.prisma.journalLine.groupBy({
      by: ['journalEntryId'],
      where: {
        journalEntry: { date: { lte: asOf } },
        account: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      },
      _sum: { debit: true, credit: true },
    });
    const unbalancedJournalIds = journalGroups
      .filter((row) => !new Prisma.Decimal(row._sum.debit ?? 0).equals(row._sum.credit ?? 0))
      .map((row) => row.journalEntryId);
    const [postedEventsMissingJournal, failedEvents, queuedEvents, pendingFinanceTransactions, nonPostedTaxTransactions] = await Promise.all([
      this.prisma.accountingEvent.count({ where: { companyId: scope.companyId, branchId: scope.branchId, status: 'POSTED', journalEntryId: null, businessDate: { lte: asOf } } }),
      this.prisma.accountingEvent.count({ where: { companyId: scope.companyId, branchId: scope.branchId, status: 'FAILED', businessDate: { lte: asOf } } }),
      this.prisma.accountingEvent.count({ where: { companyId: scope.companyId, branchId: scope.branchId, status: { in: ['PENDING', 'VALIDATED'] }, businessDate: { lte: asOf } } }),
      this.prisma.operationalFinanceTransaction.count({ where: { companyId: scope.companyId, branchId: scope.branchId, transactionDate: { lte: asOf }, status: { in: ['DRAFT', 'WAITING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.taxTransaction.count({ where: { companyId: scope.companyId, branchId: scope.branchId, transactionDate: { lte: asOf }, status: 'CALCULATED' } }),
    ]);
    const trialDifference = totalDebit.sub(totalCredit);
    const structuralMismatch = (trialDifference.isZero() ? 0 : 1) + (balanceSheetDifference.isZero() ? 0 : 1);
    const blockers = unbalancedJournalIds.length + postedEventsMissingJournal + failedEvents + structuralMismatch;
    const warnings = queuedEvents + pendingFinanceTransactions + nonPostedTaxTransactions;
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      asOf,
      status: blockers > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS',
      trialBalance: { debit: Number(totalDebit), credit: Number(totalCredit), difference: Number(trialDifference), balanced: trialDifference.isZero() },
      balanceSheet: { difference: Number(balanceSheetDifference), balanced: balanceSheetDifference.isZero() },
      unbalancedJournalIds: unbalancedJournalIds.slice(0, 50),
      postedEventsMissingJournal,
      failedEvents,
      queuedEvents,
      unresolvedEvents: failedEvents + queuedEvents,
      pendingFinanceTransactions,
      nonPostedTaxTransactions,
      blockers,
      warnings,
    };
  }

  async inventoryValuation(
    user: AuthUser,
    warehouseId?: string,
    limitValue?: string,
    cursorValue?: string,
  ) {
    const scope = this.requireTenantScope(user);
    const branchWarehouseIds = await this.branchWarehouseIds(this.prisma, user, scope);
    let warehouseIds = branchWarehouseIds;
    if (warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: {
          id: warehouseId,
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        select: { id: true },
      });
      if (!warehouse) return this.denyTenantAccess(this.prisma, user, scope, 'Warehouse', warehouseId);
      warehouseIds = [warehouse.id];
    }

    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ updatedAt: string; id: string }>(cursorValue);
    const valuationRows = await this.prisma.inventory.findMany({
      where: { warehouseId: { in: warehouseIds } },
      select: { quantity: true, reserved: true, available: true, product: { select: { costPrice: true } } },
    });
    const inventoryValue = valuationRows.reduce(
      (sum, row) => sum.add(new Prisma.Decimal(row.product.costPrice).mul(row.quantity)),
      new Prisma.Decimal(0),
    );
    const rows = await this.prisma.inventory.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        AND: cursor ? [{ OR: [
          { updatedAt: { lt: new Date(cursor.updatedAt) } },
          { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } },
        ] }] : undefined,
      },
      include: { product: true, warehouse: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = toCursorPage(rows, limit, (item) => ({ updatedAt: item.updatedAt.toISOString(), id: item.id }));
    return {
      ...page,
      companyId: scope.companyId,
      branchId: scope.branchId,
      summary: {
        skuCount: valuationRows.length,
        quantity: valuationRows.reduce((sum, row) => sum + row.quantity, 0),
        reserved: valuationRows.reduce((sum, row) => sum + row.reserved, 0),
        available: valuationRows.reduce((sum, row) => sum + row.available, 0),
        inventoryValue: Number(inventoryValue),
        source: 'LIVE_INVENTORY',
      },
      items: page.items.map((item) => ({
        ...item,
        inventoryValue: new Prisma.Decimal(item.product.costPrice).mul(item.quantity),
      })),
    };
  }

  async cashFlowReport(user: AuthUser, fromValue?: string, toValue?: string) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const lines = await this.prisma.journalLine.findMany({
      where: {
        journalEntry: { date: { gte: from, lte: to } },
        account: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: { in: ['1101', '1102', '1103'] } },
      },
      include: {
        account: { select: { code: true, name: true } },
        journalEntry: { select: { id: true, number: true, date: true, description: true, referenceType: true, referenceId: true } },
      },
      orderBy: [{ journalEntryId: 'asc' }, { id: 'asc' }],
    });
    const rows = lines
      .filter((line) => !line.journalEntry.description.startsWith('BALANCE_TRANSFER '))
      .map((line) => ({
        journalEntryId: line.journalEntry.id,
        journalNumber: line.journalEntry.number,
        date: line.journalEntry.date,
        accountCode: line.account.code,
        accountName: line.account.name,
        referenceType: line.journalEntry.referenceType,
        referenceId: line.journalEntry.referenceId,
        description: line.journalEntry.description,
        cashIn: Number(line.debit),
        cashOut: Number(line.credit),
        net: Number(new Prisma.Decimal(line.debit).sub(line.credit)),
      }));
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      from,
      to,
      cashIn: rows.reduce((sum, row) => sum + row.cashIn, 0),
      cashOut: rows.reduce((sum, row) => sum + row.cashOut, 0),
      netCashFlow: rows.reduce((sum, row) => sum + row.net, 0),
      rows,
      source: 'POSTED_JOURNAL_CASH_BANK',
    };
  }

  async marginReport(user: AuthUser, fromValue?: string, toValue?: string, limitValue?: string) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const limit = Math.min(parsePageLimit(limitValue), 200);
    const sales = await this.prisma.sale.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      select: { id: true, number: true, createdAt: true, channel: true, total: true, tax: true, discount: true, costTotal: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    const rows = sales.map((sale) => {
      const revenueExTax = new Prisma.Decimal(sale.total).sub(sale.tax);
      const margin = revenueExTax.sub(sale.costTotal);
      return {
        id: sale.id,
        number: sale.number,
        date: sale.createdAt,
        channel: sale.channel,
        revenueExTax: Number(revenueExTax),
        cost: Number(sale.costTotal),
        margin: Number(margin),
        marginPercent: revenueExTax.isZero() ? 0 : Number(margin.div(revenueExTax).mul(100)),
      };
    });
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      from,
      to,
      revenueExTax: rows.reduce((sum, row) => sum + row.revenueExTax, 0),
      cost: rows.reduce((sum, row) => sum + row.cost, 0),
      grossMargin: rows.reduce((sum, row) => sum + row.margin, 0),
      rows,
      note: 'Margin operasional ini menggunakan snapshot Sale.costTotal; laporan P&L tetap authoritative dari posted journal.',
    };
  }

  private activitySummary(rows: Awaited<ReturnType<ReportsService['accountActivity']>>) {
    const revenue = rows.filter((row) => row.type === 'REVENUE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    const expenses = rows.filter((row) => row.type === 'EXPENSE').reduce((sum, row) => sum.add(row.balance), new Prisma.Decimal(0));
    return { revenue, expenses, netProfit: revenue.sub(expenses) };
  }

  async periodComparison(user: AuthUser, fromValue?: string, toValue?: string) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const durationMs = to.getTime() - from.getTime() + 1;
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - durationMs + 1);
    const [currentRows, previousRows] = await Promise.all([
      this.accountActivity(scope, from, to),
      this.accountActivity(scope, previousFrom, previousTo),
    ]);
    const current = this.activitySummary(currentRows);
    const previous = this.activitySummary(previousRows);
    const pct = (now: Prisma.Decimal, old: Prisma.Decimal) => old.isZero() ? null : Number(now.sub(old).div(old.abs()).mul(100));
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      current: { from, to, revenue: Number(current.revenue), expenses: Number(current.expenses), netProfit: Number(current.netProfit) },
      previous: { from: previousFrom, to: previousTo, revenue: Number(previous.revenue), expenses: Number(previous.expenses), netProfit: Number(previous.netProfit) },
      changePercent: { revenue: pct(current.revenue, previous.revenue), expenses: pct(current.expenses, previous.expenses), netProfit: pct(current.netProfit, previous.netProfit) },
      source: 'POSTED_JOURNAL',
    };
  }

  async dimensionComparison(user: AuthUser, fromValue?: string, toValue?: string) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const canCompareCompanyBranches = user.roles.includes('SUPER_ADMIN') || user.roles.includes('OWNER');
    const branches = await this.prisma.branch.findMany({
      where: { companyId: scope.companyId, ...(canCompareCompanyBranches ? {} : { id: scope.branchId }) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const branchIds = branches.map((branch) => branch.id);
    const grouped = branchIds.length ? await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: { date: { gte: from, lte: to } }, account: { branchId: { in: branchIds }, branch: { companyId: scope.companyId } } },
      _sum: { debit: true, credit: true },
    }) : [];
    const accountIds = grouped.map((row) => row.accountId);
    const accounts = accountIds.length ? await this.prisma.account.findMany({
      where: { id: { in: accountIds }, branchId: { in: branchIds }, branch: { companyId: scope.companyId } },
      select: { id: true, type: true, branchId: true },
    }) : [];
    const accountById = new Map(accounts.map((row) => [row.id, row]));
    const branchTotals = new Map(branches.map((branch) => [branch.id, { branch, revenue: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) }]));
    for (const row of grouped) {
      const account = accountById.get(row.accountId);
      if (!account) continue;
      const bucket = branchTotals.get(account.branchId);
      if (!bucket) continue;
      const balance = accountNormalBalance(account.type, new Prisma.Decimal(row._sum.debit ?? 0), new Prisma.Decimal(row._sum.credit ?? 0));
      if (account.type === 'REVENUE') bucket.revenue = bucket.revenue.add(balance);
      if (account.type === 'EXPENSE') bucket.expenses = bucket.expenses.add(balance);
    }
    const eventLines = await this.prisma.accountingEventLine.findMany({
      where: { event: { companyId: scope.companyId, branchId: scope.branchId, status: 'POSTED', businessDate: { gte: from, lte: to } } },
      select: { netAmount: true, dimensions: true },
      take: 10000,
    });
    const costCenters = new Map<string, Prisma.Decimal>();
    for (const line of eventLines) {
      const dimensions = line.dimensions && typeof line.dimensions === 'object' && !Array.isArray(line.dimensions) ? line.dimensions as Record<string, unknown> : {};
      const costCenterId = typeof dimensions.costCenterId === 'string' && dimensions.costCenterId ? dimensions.costCenterId : 'UNASSIGNED';
      costCenters.set(costCenterId, (costCenters.get(costCenterId) ?? new Prisma.Decimal(0)).add(line.netAmount));
    }
    const costCenterIds = [...costCenters.keys()].filter((id) => id !== 'UNASSIGNED');
    const departments = costCenterIds.length ? await this.prisma.department.findMany({
      where: { companyId: scope.companyId, costCenterId: { in: costCenterIds } },
      select: { costCenterId: true, code: true, name: true },
    }) : [];
    return {
      companyId: scope.companyId,
      branchScope: canCompareCompanyBranches ? 'COMPANY' : 'CURRENT_BRANCH',
      from,
      to,
      branches: [...branchTotals.values()].map(({ branch, revenue, expenses }) => ({ ...branch, revenue: Number(revenue), expenses: Number(expenses), netProfit: Number(revenue.sub(expenses)) })),
      costCenters: [...costCenters.entries()].map(([costCenterId, amount]) => {
        const department = departments.find((row) => row.costCenterId === costCenterId);
        return { costCenterId, label: department ? `${department.code} · ${department.name}` : costCenterId === 'UNASSIGNED' ? 'Tanpa cost center' : costCenterId, amount: Number(amount) };
      }),
      note: 'Cost center hanya tersedia bila accounting event line membawa dimensions.costCenterId; data tanpa dimensi tetap ditampilkan sebagai UNASSIGNED.',
    };
  }

  async reportDrillDown(user: AuthUser, accountCode: string, fromValue?: string, toValue?: string, limitValue?: string) {
    const scope = this.requireTenantScope(user);
    if (!accountCode?.trim()) throw new BadRequestException('accountCode wajib untuk drill-down laporan.');
    const { from, to } = await this.reportRange(scope, fromValue, toValue);
    const limit = Math.min(parsePageLimit(limitValue), 200);
    const account = await this.prisma.account.findFirst({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: accountCode.trim() },
      select: { id: true, code: true, name: true, type: true },
    });
    if (!account) throw new NotFoundException('Akun laporan tidak ditemukan pada branch aktif.');
    const lines = await this.prisma.journalLine.findMany({
      where: { accountId: account.id, journalEntry: { date: { gte: from, lte: to } } },
      include: { journalEntry: true },
      orderBy: [{ journalEntry: { date: 'desc' } }, { id: 'desc' }],
      take: limit,
    });
    const journalEntryIds = [...new Set(lines.map((line) => line.journalEntryId))];
    const postings = journalEntryIds.length ? await this.prisma.accountingPosting.findMany({
      where: { journalEntryId: { in: journalEntryIds }, event: { companyId: scope.companyId, branchId: scope.branchId } },
      include: { event: { select: { id: true, eventType: true, sourceType: true, sourceId: true, businessDate: true, status: true } } },
    }) : [];
    const postingByJournal = new Map(postings.map((posting) => [posting.journalEntryId, posting]));
    let running = new Prisma.Decimal(0);
    const chronological = [...lines].reverse().map((line) => {
      running = running.add(accountNormalBalance(account.type, new Prisma.Decimal(line.debit), new Prisma.Decimal(line.credit)));
      const posting = postingByJournal.get(line.journalEntryId);
      return {
        journalLineId: line.id,
        journalEntryId: line.journalEntryId,
        journalNumber: line.journalEntry.number,
        date: line.journalEntry.date,
        debit: Number(line.debit),
        credit: Number(line.credit),
        runningBalance: Number(running),
        referenceType: line.journalEntry.referenceType,
        referenceId: line.journalEntry.referenceId,
        description: line.journalEntry.description,
        accountingEvent: posting?.event ?? null,
      };
    });
    return { companyId: scope.companyId, branchId: scope.branchId, from, to, account, rows: chronological.reverse() };
  }

  private async validateReportFilters(scope: TenantScope, reportType: string, filters: Record<string, unknown> | undefined) {
    const safe: Record<string, unknown> = {};
    if (!filters) return safe;
    const timeZone = await this.companyTimeZone(scope.companyId);
    for (const key of ['from', 'to', 'asOf']) {
      const value = filters[key];
      if (value !== undefined) {
        if (typeof value !== 'string') throw new BadRequestException(`Filter ${key} harus berupa tanggal.`);
        parseBusinessDateBoundary(value, new Date(), timeZone, key !== 'from');
        safe[key] = value;
      }
    }
    if (filters.days !== undefined) {
      const days = Number(filters.days);
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new BadRequestException('Filter days harus integer 1-3650.');
      safe.days = days;
    }
    if (filters.accountCode !== undefined) {
      if (typeof filters.accountCode !== 'string' || !filters.accountCode.trim()) throw new BadRequestException('accountCode report tidak valid.');
      const account = await this.prisma.account.findFirst({ where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: filters.accountCode.trim() }, select: { id: true } });
      if (!account) throw new BadRequestException('accountCode report tidak ditemukan pada branch aktif.');
      safe.accountCode = filters.accountCode.trim();
    }
    if (filters.warehouseId !== undefined) {
      if (typeof filters.warehouseId !== 'string' || !filters.warehouseId) throw new BadRequestException('warehouseId report tidak valid.');
      const warehouse = await this.prisma.warehouse.findFirst({ where: { id: filters.warehouseId, branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true } });
      if (!warehouse) throw new BadRequestException('warehouseId report tidak ditemukan pada branch aktif.');
      safe.warehouseId = filters.warehouseId;
    }
    if (reportType === 'GENERAL_LEDGER' && !safe.accountCode && filters.accountCode !== undefined) throw new BadRequestException('General Ledger accountCode tidak valid.');
    return safe;
  }

  async createJob(dto: CreateReportJobDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'ReportJob');
    const filters = await this.validateReportFilters(scope, dto.reportType, dto.filters);
    if (dto.reportType === 'BRANCH_COMPARISON') {
      const canCompareCompanyBranches = user.roles.includes('SUPER_ADMIN') || user.roles.includes('OWNER');
      const branches = await this.prisma.branch.findMany({
        where: { companyId: scope.companyId, ...(canCompareCompanyBranches ? {} : { id: scope.branchId }) },
        select: { id: true },
      });
      filters.branchIds = branches.map((branch) => branch.id);
    }
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.reportJob.create({
        data: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          requestedById: user.sub,
          reportType: dto.reportType,
          format: dto.format ?? 'CSV',
          filters: filters as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_REPORT_JOB',
          entityType: 'ReportJob',
          entityId: job.id,
          payload: {
            branchId: scope.branchId,
            reportType: job.reportType,
            format: job.format,
          },
        },
      });
      return job;
    });
  }

  async listJobs(
    user: AuthUser,
    requestedCompanyId?: string,
    requestedBranchId?: string,
    limitValue?: string,
    cursorValue?: string,
  ) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'ReportJob');
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ createdAt: string; id: string }>(cursorValue);
    const rows = await this.prisma.reportJob.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        AND: cursor ? [{ OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ] }] : undefined,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  async listSchedules(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.reportSchedule.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      orderBy: [{ isActive: 'desc' }, { nextRunAt: 'asc' }, { name: 'asc' }],
    });
  }

  private validateScheduleShape(frequency: ReportFrequency, dayOfWeek?: number | null, dayOfMonth?: number | null) {
    if (frequency === 'WEEKLY' && (dayOfWeek === undefined || dayOfWeek === null)) throw new BadRequestException('Schedule WEEKLY wajib memiliki dayOfWeek.');
    if (frequency === 'MONTHLY' && (dayOfMonth === undefined || dayOfMonth === null)) throw new BadRequestException('Schedule MONTHLY wajib memiliki dayOfMonth.');
  }

  async createSchedule(dto: CreateReportScheduleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    this.validateScheduleShape(dto.frequency, dto.dayOfWeek, dto.dayOfMonth);
    const filters = await this.validateReportFilters(scope, dto.reportType, dto.filters);
    const company = await this.prisma.company.findUnique({ where: { id: scope.companyId }, select: { timezone: true } });
    if (!company) return this.denyTenantAccess(this.prisma, user, scope, 'Company', scope.companyId);
    if (dto.reportType === 'BRANCH_COMPARISON') {
      const canCompareCompanyBranches = user.roles.includes('SUPER_ADMIN') || user.roles.includes('OWNER');
      const branches = await this.prisma.branch.findMany({ where: { companyId: scope.companyId, ...(canCompareCompanyBranches ? {} : { id: scope.branchId }) }, select: { id: true } });
      filters.branchIds = branches.map((branch) => branch.id);
    }
    const nextRunAt = nextScheduledReportRun(new Date(), company.timezone, dto.frequency, dto.localTime, dto.dayOfWeek, dto.dayOfMonth);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.reportSchedule.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, requestedById: user.sub,
        name: dto.name.trim(), reportType: dto.reportType, format: dto.format ?? 'CSV', filters: filters as Prisma.InputJsonValue,
        frequency: dto.frequency, localTime: dto.localTime, dayOfWeek: dto.frequency === 'WEEKLY' ? dto.dayOfWeek : null,
        dayOfMonth: dto.frequency === 'MONTHLY' ? dto.dayOfMonth : null, timezone: company.timezone,
        isActive: dto.isActive ?? true, nextRunAt,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_REPORT_SCHEDULE', entityType: 'ReportSchedule', entityId: row.id, payload: { branchId: scope.branchId, reportType: row.reportType, frequency: row.frequency, nextRunAt: row.nextRunAt.toISOString() } } });
      return row;
    });
  }

  async updateSchedule(id: string, dto: UpdateReportScheduleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const existing = await this.prisma.reportSchedule.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!existing) return this.denyTenantAccess(this.prisma, user, scope, 'ReportSchedule', id);
    const frequency = (dto.frequency ?? existing.frequency) as ReportFrequency;
    const dayOfWeek = dto.dayOfWeek !== undefined ? dto.dayOfWeek : existing.dayOfWeek;
    const dayOfMonth = dto.dayOfMonth !== undefined ? dto.dayOfMonth : existing.dayOfMonth;
    this.validateScheduleShape(frequency, dayOfWeek, dayOfMonth);
    const reportType = dto.reportType ?? existing.reportType;
    const filters = dto.filters !== undefined ? await this.validateReportFilters(scope, reportType, dto.filters) : (existing.filters ?? {}) as Record<string, unknown>;
    const nextRunAt = nextScheduledReportRun(new Date(), existing.timezone, frequency, dto.localTime ?? existing.localTime, dayOfWeek, dayOfMonth);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.reportSchedule.update({ where: { id }, data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), reportType,
        ...(dto.format !== undefined ? { format: dto.format } : {}),
        ...(dto.filters !== undefined || dto.reportType !== undefined ? { filters: filters as Prisma.InputJsonValue } : {}),
        frequency, localTime: dto.localTime ?? existing.localTime,
        dayOfWeek: frequency === 'WEEKLY' ? dayOfWeek : null, dayOfMonth: frequency === 'MONTHLY' ? dayOfMonth : null,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}), nextRunAt, lastError: null,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_REPORT_SCHEDULE', entityType: 'ReportSchedule', entityId: row.id, payload: { branchId: scope.branchId, isActive: row.isActive, nextRunAt: row.nextRunAt.toISOString() } } });
      return row;
    });
  }

  async runScheduleNow(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const schedule = await this.prisma.reportSchedule.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!schedule) return this.denyTenantAccess(this.prisma, user, scope, 'ReportSchedule', id);
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const job = await tx.reportJob.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, requestedById: user.sub, scheduleId: schedule.id, scheduledFor: now,
        reportType: schedule.reportType, format: schedule.format, filters: schedule.filters ?? undefined,
      } });
      await tx.reportSchedule.update({ where: { id }, data: { lastJobId: job.id, lastRunAt: now, lastError: null } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RUN_REPORT_SCHEDULE_NOW', entityType: 'ReportSchedule', entityId: id, payload: { branchId: scope.branchId, reportJobId: job.id } } });
      return job;
    });
  }

  // T360-20260829 value pack 2 — penjualan per jam untuk deteksi jam ramai.
  async peakHours(user: AuthUser, daysValue?: string) {
    const scope = this.requireTenantScope(user);
    const days = Math.min(Math.max(Number(daysValue ?? 30) || 30, 1), 90);
    const timeZone = await this.companyTimeZone(scope.companyId);
    const start = startOfBusinessDaysAgo(new Date(), timeZone, days - 1);
    const sales = await this.prisma.sale.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED', createdAt: { gte: start } },
      select: { createdAt: true, total: true },
    });
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, transactions: 0, revenue: 0 }));
    for (const sale of sales) {
      const bucket = buckets[businessHour(new Date(sale.createdAt), timeZone)];
      bucket.transactions += 1;
      bucket.revenue += Number(sale.total);
    }
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      days,
      buckets,
      peakHour: buckets.reduce((best, current) => (current.transactions > best.transactions ? current : best)).hour,
    };
  }

  // T360-20260829 value pack 2 — stok menganggur tanpa penjualan pada periode.
  async deadStock(user: AuthUser, daysValue?: string, limitValue?: string) {
    const scope = this.requireTenantScope(user);
    const days = Math.min(Math.max(Number(daysValue ?? 30) || 30, 1), 365);
    const limit = parsePageLimit(limitValue);
    const start = new Date();
    start.setDate(start.getDate() - days);
    const warehouseIds = await this.branchWarehouseIds(this.prisma, user, scope);
    const sold = await this.prisma.saleItem.findMany({
      where: { sale: { branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED', createdAt: { gte: start } } },
      select: { productId: true },
      distinct: ['productId'],
    });
    const soldIds = sold.map((row) => row.productId);
    const rows = await this.prisma.inventory.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        quantity: { gt: 0 },
        productId: soldIds.length ? { notIn: soldIds } : undefined,
      },
      include: {
        product: { select: { id: true, sku: true, name: true, costPrice: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: [{ quantity: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      days,
      items: rows.map((row) => ({
        productId: row.productId,
        sku: row.product.sku,
        name: row.product.name,
        warehouse: row.warehouse.name,
        quantity: row.quantity,
        tiedUpValue: new Prisma.Decimal(row.product.costPrice).mul(row.quantity),
      })),
    };
  }

  // T360-20260829 value pack 2 — segmentasi pelanggan RFM sederhana.
  async customerRfm(user: AuthUser, daysValue?: string, limitValue?: string) {
    const scope = this.requireTenantScope(user);
    const days = Math.min(Math.max(Number(daysValue ?? 90) || 90, 7), 365);
    const limit = parsePageLimit(limitValue);
    const start = new Date();
    start.setDate(start.getDate() - days);
    const grouped = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED', customerId: { not: null }, createdAt: { gte: start } },
      _count: true,
      _sum: { total: true },
      _max: { createdAt: true },
    });
    const customerIds = grouped.map((row) => row.customerId).filter((value): value is string => Boolean(value));
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { companyId: scope.companyId, id: { in: customerIds } }, select: { id: true, name: true, phone: true } })
      : [];
    const nameById = new Map(customers.map((customer) => [customer.id, customer]));
    const now = Date.now();
    const items = grouped
      .filter((row) => row.customerId)
      .map((row) => {
        const recencyDays = Math.floor((now - (row._max.createdAt?.getTime() ?? now)) / 86400000);
        const frequency = row._count;
        const monetary = Number(row._sum.total ?? 0);
        return {
          customerId: row.customerId as string,
          name: nameById.get(row.customerId as string)?.name ?? '(terhapus)',
          phone: nameById.get(row.customerId as string)?.phone ?? null,
          recencyDays,
          frequency,
          monetary,
          segment: rfmSegment(recencyDays, frequency, monetary),
        };
      })
      .sort((a, b) => b.monetary - a.monetary)
      .slice(0, limit);
    return { companyId: scope.companyId, branchId: scope.branchId, days, items };
  }

  // T360-20260829 value pack 2 — unduh hasil export CSV milik company/branch sendiri.
  async downloadJob(user: AuthUser, jobId: string): Promise<StreamableFile> {
    const scope = this.requireTenantScope(user);
    const job = await this.prisma.reportJob.findFirst({
      where: { id: jobId, companyId: scope.companyId, branchId: scope.branchId },
    });
    if (!job) return this.denyTenantAccess(this.prisma, user, scope, 'ReportJob', jobId);
    if (job.status !== 'DONE' || !job.outputUrl) throw new BadRequestException('Export belum tersedia.');
    const filePath = resolveExportPath(job.outputUrl);
    if (!existsSync(filePath)) throw new NotFoundException('Berkas export sudah tidak tersedia.');
    const extension = job.outputUrl.split('.').pop()?.toLowerCase() ?? 'csv';
    const contentType = extension === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : extension === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8';
    return new StreamableFile(createReadStream(filePath), {
      type: contentType,
      disposition: `attachment; filename="${job.id}.${extension}"`,
    });
  }
}

// T360-20260829 value pack 2 — logika segmentasi murni agar mudah diuji.
export function rfmSegment(recencyDays: number, frequency: number, monetary: number): string {
  if (recencyDays <= 7 && frequency >= 4) return 'CHAMPION';
  if (recencyDays <= 30 && frequency >= 2) return 'LOYAL';
  if (recencyDays <= 30) return 'NEW_PROMISING';
  if (recencyDays <= 90 && monetary > 0) return 'AT_RISK';
  return 'HIBERNATING';
}

// T360-20260829 value pack 2 — direktori export bersama API dan worker.
export function resolveExportDir(): string {
  const configured = process.env.REPORT_EXPORT_DIR?.trim();
  if (configured) {
    const dir = resolve(configured);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const candidates = [
    join(process.cwd(), 'logs', 'report-exports'),
    resolve(process.env.INIT_CWD || process.cwd(), 'logs', 'report-exports'),
    resolve(process.cwd(), '..', '..', 'logs', 'report-exports'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  const fallback = candidates[1];
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

function resolveExportPath(outputUrl: string): string {
  const fileName = outputUrl.split(/[\\/]/).pop() ?? '';
  if (!fileName || fileName.includes('..')) throw new BadRequestException('Path export tidak valid.');
  return join(resolveExportDir(), fileName);
}
