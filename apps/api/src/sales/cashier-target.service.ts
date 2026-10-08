import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { businessDayBounds } from '../common/business-time';

type TargetMap = Record<string, number>;
const KEY = 'cashier_targets';

@Injectable()
export class CashierTargetService {
  constructor(private readonly prisma: PrismaService) {}

  private requireScope(user: AuthUser) {
    if (!user.companyId || !user.branchId) throw new ForbiddenException('Target kasir membutuhkan company dan branch aktif.');
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async loadTargets(companyId: string, branchId: string): Promise<TargetMap> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { companyId, branchId, userId: null, namespace: 'sales', key: KEY },
    }) ?? await this.prisma.systemSetting.findFirst({
      // Compatibility read for the old company-wide row. New writes are always branch scoped.
      where: { companyId, branchId: null, userId: null, namespace: 'sales', key: KEY },
    });
    if (!setting) return {};
    try {
      const value = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return value as TargetMap;
    } catch {
      return {};
    }
  }

  private async activeCashiers(companyId: string, branchId: string) {
    return this.prisma.user.findMany({
      where: {
        branchId,
        branch: { companyId },
        isActive: true,
        roles: { some: { role: { name: 'CASHIER' } } },
      },
      select: { id: true, name: true },
      take: 200,
    });
  }

  async saveTargets(user: AuthUser, targets: TargetMap) {
    const scope = this.requireScope(user);
    const cashiers = await this.activeCashiers(scope.companyId, scope.branchId);
    const allowedIds = new Set(cashiers.map((cashier) => cashier.id));
    const clean: TargetMap = {};
    for (const [userId, value] of Object.entries(targets ?? {})) {
      if (!allowedIds.has(userId)) throw new BadRequestException(`User ${userId} bukan kasir aktif pada branch ini.`);
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0 || !Number.isSafeInteger(Math.round(v))) throw new BadRequestException(`Target tidak valid untuk user ${userId}.`);
      clean[userId] = Math.round(v);
    }
    const value = clean as unknown as Prisma.InputJsonValue;
    const existing = await this.prisma.systemSetting.findFirst({
      where: { companyId: scope.companyId, branchId: scope.branchId, userId: null, namespace: 'sales', key: KEY },
      select: { id: true },
    });
    if (existing) await this.prisma.systemSetting.update({ where: { id: existing.id }, data: { value, updatedAt: new Date() } });
    else await this.prisma.systemSetting.create({ data: { companyId: scope.companyId, branchId: scope.branchId, namespace: 'sales', key: KEY, value } });
    return clean;
  }

  async progress(user: AuthUser) {
    const scope = this.requireScope(user);
    const [targets, company, cashiers] = await Promise.all([
      this.loadTargets(scope.companyId, scope.branchId),
      this.prisma.company.findUnique({ where: { id: scope.companyId }, select: { timezone: true } }),
      this.activeCashiers(scope.companyId, scope.branchId),
    ]);
    if (!company) throw new ForbiddenException('Tenant target kasir tidak ditemukan.');
    const now = new Date();
    const { start } = businessDayBounds(now, company.timezone);

    const rows = await Promise.all(cashiers.map(async (cashier) => {
      const agg = await this.prisma.sale.aggregate({
        where: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
          cashierShift: { userId: cashier.id },
          status: 'COMPLETED',
          createdAt: { gte: start, lte: now },
        },
        _sum: { total: true },
        _count: true,
      });
      const achieved = Number(agg._sum.total ?? 0);
      const target = targets[cashier.id] ?? 0;
      return {
        userId: cashier.id,
        name: cashier.name,
        target,
        achieved,
        transactions: agg._count,
        progressPct: target > 0 ? Math.min(999, Math.round((achieved / target) * 100)) : null,
        onTrack: target > 0 ? achieved >= target : null,
      };
    }));

    return { generatedAt: now.toISOString(), rows: rows.sort((a, b) => b.achieved - a.achieved) };
  }
}
