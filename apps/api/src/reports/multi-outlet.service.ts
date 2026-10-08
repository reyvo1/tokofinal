import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { businessDayBounds } from '../common/business-time';

/**
 * T360-20260825 Fitur 4: dashboard multi-outlet.
 * Agregasi performa per cabang milik satu perusahaan: omzet hari ini,
 * transaksi, laba kotor, stok menipis, pesanan pending. Tenant dari token.
 *
 * Otoritas angka finansial adalah JURNAL POSTED, bukan tabel `Sale`/`Order`.
 *
 * Diperbaiki 2026-10-01 karena defect ini hanya terlihat saat service-nya dieksekusi. Versi lama
 * menjumlahkan `Sale.total` + `Order.total`, sehingga setiap retur yang sudah dikonfirmasi tidak
 * pernah mengurangi apa pun. Terbukti terhadap DB SQLite nyata: satu penjualan Rp 30.000, satu
 * penjualan Rp 15.000 yang diretur penuh, dan satu penjualan Rp 45.000 di cabang lain —
 *
 *   jurnal kanonik BR1 : kredit 45.000 - debit 15.000 = 30.000
 *   multi-outlet BR1  : 45.000            (retur hilang)
 *   total konsolidasi : 90.000 vs jurnal 75.000
 *
 * `Sale.total` adalah nilai GROSS (mengandung pajak) dan tidak pernah dikurangi retur, jadi angka
 * itu bukan omzet perusahaan melainkan nilai yang tidak akan pernah cocok dengan jurnal cabang —
 * persis butir acceptance #13. Sekarang revenue dan laba kotor dihitung dari JournalLine akun
 * REVENUE (4102 ikut mengurangi karena bertipe REVENUE dengan normal kredit), COGS dari 5101, dan
 * jumlah transaksi dari AccountingEvent berstatus POSTED.
 */
@Injectable()
export class MultiOutletService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthUser) {
    if (!user.companyId) throw new ForbiddenException('Dashboard multi-outlet harus punya tenant.');
    const companyId = user.companyId;
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new ForbiddenException('Tenant multi-outlet tidak ditemukan.');
    const now = new Date();
    const { start } = businessDayBounds(now, company.timezone);

    const branches = await this.prisma.branch.findMany({
      where: { companyId },
      select: { id: true, name: true, code: true, isActive: true },
      orderBy: { name: 'asc' },
    });

    const branchIds = branches.map((branch) => branch.id);
    const [revenueLines, cogsLines, recognizedTransactions, lowStockByWarehouse, pendingOrders] = await Promise.all([
      // Satu pengummulan untuk seluruh cabang lalu dipisah per akun — bukan N+1 per outlet.
      branchIds.length ? this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          journalEntry: { date: { gte: start, lte: now } },
          account: { branchId: { in: branchIds }, branch: { companyId }, type: 'REVENUE' },
        },
        _sum: { debit: true, credit: true },
      }) : [],
      branchIds.length ? this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          journalEntry: { date: { gte: start, lte: now } },
          account: { branchId: { in: branchIds }, branch: { companyId }, code: '5101' },
        },
        _sum: { debit: true, credit: true },
      }) : [],
      branchIds.length ? this.prisma.accountingEvent.groupBy({
        by: ['branchId'],
        where: {
          companyId,
          branchId: { in: branchIds },
          status: 'POSTED',
          businessDate: { gte: start, lte: now },
          eventType: { in: ['SALE_CASH', 'SALE_BANK', 'SALE_SPLIT', 'ONLINE_ORDER_PREPAID_FULFILLED', 'ONLINE_ORDER_CREDIT_FULFILLED'] },
        },
        _count: true,
      }) : [],
      branchIds.length ? this.prisma.inventory.findMany({
        where: { warehouse: { branchId: { in: branchIds }, branch: { companyId } }, product: { companyId, isActive: true } },
        select: { warehouseId: true, available: true, product: { select: { minStock: true } } },
      }) : [],
      branchIds.length ? this.prisma.order.findMany({
        where: { branchId: { in: branchIds }, status: { in: ['PAID', 'PROCESSING'] } },
        select: { branchId: true },
      }) : [],
    ]);

    const accountIds = [...new Set([...revenueLines.map((row) => row.accountId), ...cogsLines.map((row) => row.accountId)])];
    const accounts = accountIds.length
      ? await this.prisma.account.findMany({
        where: { id: { in: accountIds }, branchId: { in: branchIds }, branch: { companyId } },
        select: { id: true, branchId: true },
      })
      : [];
    const accountById = new Map(accounts.map((account) => [account.id, account]));

    const revenueByBranch = new Map<string, Prisma.Decimal>();
    for (const row of revenueLines) {
      const account = accountById.get(row.accountId);
      if (!account) continue;
      // REVENUE normalnya kredit, jadi retur yang|DEBIT 4102 otomatis mengurangi.
      const balance = new Prisma.Decimal(row._sum.credit ?? 0).sub(new Prisma.Decimal(row._sum.debit ?? 0));
      revenueByBranch.set(account.branchId, (revenueByBranch.get(account.branchId) ?? new Prisma.Decimal(0)).add(balance));
    }
    const cogsByBranch = new Map<string, Prisma.Decimal>();
    for (const row of cogsLines) {
      const account = accountById.get(row.accountId);
      if (!account) continue;
      const balance = new Prisma.Decimal(row._sum.debit ?? 0).sub(new Prisma.Decimal(row._sum.credit ?? 0));
      cogsByBranch.set(account.branchId, (cogsByBranch.get(account.branchId) ?? new Prisma.Decimal(0)).add(balance));
    }
    const transactionsByBranch = new Map<string, number>();
    for (const row of recognizedTransactions) {
      // branchId pada AccountingEvent nullable; event tanpa cabang tidak masuk outlet mana pun.
      if (!row.branchId) continue;
      transactionsByBranch.set(row.branchId, (transactionsByBranch.get(row.branchId) ?? 0) + row._count);
    }
    const pendingByBranch = new Map<string, number>();
    for (const row of pendingOrders) {
      pendingByBranch.set(row.branchId, (pendingByBranch.get(row.branchId) ?? 0) + 1);
    }

    const warehouses = branchIds.length
      ? await this.prisma.warehouse.findMany({ where: { branchId: { in: branchIds } }, select: { id: true, branchId: true } })
      : [];
    const lowStockByBranch = new Map<string, number>();
    for (const row of lowStockByWarehouse) {
      if (row.product.minStock <= 0 || row.available > row.product.minStock) continue;
      const branchId = warehouses.find((warehouse) => warehouse.id === row.warehouseId)?.branchId;
      if (branchId) lowStockByBranch.set(branchId, (lowStockByBranch.get(branchId) ?? 0) + 1);
    }

    const outlets = branches.map((branch) => {
      const revenue = revenueByBranch.get(branch.id) ?? new Prisma.Decimal(0);
      const cogs = cogsByBranch.get(branch.id) ?? new Prisma.Decimal(0);
      return {
        branchId: branch.id,
        name: branch.name,
        code: branch.code,
        isActive: branch.isActive,
        today: {
          revenue: Number(revenue),
          grossProfit: Number(revenue.sub(cogs)),
          transactions: transactionsByBranch.get(branch.id) ?? 0,
        },
        lowStock: lowStockByBranch.get(branch.id) ?? 0,
        pendingOrders: pendingByBranch.get(branch.id) ?? 0,
      };
    });

    const totalRevenue = outlets.reduce((sum, o) => sum + o.today.revenue, 0);
    return {
      companyId,
      generatedAt: new Date().toISOString(),
      source: 'POSTED_JOURNAL' as const,
      totals: {
        revenue: totalRevenue,
        grossProfit: outlets.reduce((s, o) => s + o.today.grossProfit, 0),
        transactions: outlets.reduce((s, o) => s + o.today.transactions, 0),
        outletCount: outlets.length,
      },
      ranked: [...outlets].sort((a, b) => b.today.revenue - a.today.revenue)
        .map((o, i) => ({ ...o, rank: i + 1, sharePct: totalRevenue > 0 ? Math.round((o.today.revenue / totalRevenue) * 1000) / 10 : 0 })),
    };
  }
}