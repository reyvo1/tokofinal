import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { businessDateKey, businessDayBounds } from '../common/business-time';
import { ReportsService } from './reports.service';

/**
 * T360-20260825 OWNER VALUE PACK
 * Fitur 1: Laporan harian otomatis — digest disusun dari data live dan masuk
 * antrian Notification (channel TELEGRAM) untuk dikirim oleh notification hub.
 * Pengaturan penerima per perusahaan disimpan via PlatformSetting (key: daily_digest).
 */

const DIGEST_SETTING_KEY = 'daily_digest';

export type DigestConfig = { enabled: boolean; hour: number; recipientBindingIds: string[] };

@Injectable()
export class DailyDigestService {
  constructor(private readonly prisma: PrismaService, private readonly reports: ReportsService) {}

  private requireCompanyId(user: AuthUser): string {
    if (!user.companyId) throw new ForbiddenException('Tenant scope tidak lengkap.');
    return user.companyId;
  }

  private async getConfig(companyId: string): Promise<DigestConfig> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { companyId, namespace: 'reports', key: DIGEST_SETTING_KEY },
    });
    if (!setting) return { enabled: false, hour: 21, recipientBindingIds: [] };
    try {
      const parsed = (typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value) as Partial<DigestConfig>;
      return { enabled: !!parsed.enabled, hour: Math.min(23, Math.max(0, Number(parsed.hour ?? 21))), recipientBindingIds: Array.isArray(parsed.recipientBindingIds) ? parsed.recipientBindingIds.filter((id): id is string => typeof id === 'string' && !!id.trim()).slice(0, 10) : [] };
    } catch {
      return { enabled: false, hour: 21, recipientBindingIds: [] };
    }
  }

  async saveConfig(user: AuthUser, dto: Partial<DigestConfig> & { companyId?: string }) {
    const companyId = this.requireCompanyId(user);
    if (dto.companyId && dto.companyId !== companyId) throw new ForbiddenException('Tenant tidak sesuai token.');
    const requestedBindingIds = (dto.recipientBindingIds ?? []).filter((id) => typeof id === 'string' && id.trim()).slice(0, 10);
    const verifiedBindings = requestedBindingIds.length ? await this.prisma.employeeChannelBinding.findMany({
      where: { id: { in: requestedBindingIds }, companyId, channel: 'TELEGRAM', verifiedAt: { not: null }, revokedAt: null },
      select: { id: true },
    }) : [];
    if (verifiedBindings.length !== requestedBindingIds.length) throw new BadRequestException('Semua penerima owner digest harus memakai binding Telegram terverifikasi pada tenant aktif.');
    const config: DigestConfig = {
      enabled: !!dto.enabled,
      hour: Math.min(23, Math.max(0, Number(dto.hour ?? 21))),
      recipientBindingIds: requestedBindingIds,
    };
    const existing = await this.prisma.systemSetting.findFirst({ where: { companyId, namespace: 'reports', key: DIGEST_SETTING_KEY } });
    const value = config as unknown as import('@prisma/client').Prisma.InputJsonValue;
    if (existing) await this.prisma.systemSetting.update({ where: { id: existing.id }, data: { value, updatedAt: new Date() } });
    else await this.prisma.systemSetting.create({ data: { companyId, branchId: user.branchId ?? null, namespace: 'reports', key: DIGEST_SETTING_KEY, value } });
    return config;
  }

  private async verifiedRecipientOptions(companyId: string) {
    const bindings = await this.prisma.employeeChannelBinding.findMany({
      where: { companyId, channel: 'TELEGRAM', verifiedAt: { not: null }, revokedAt: null, externalUserId: { not: null } },
      select: { id: true, employeeId: true, externalUserId: true, verifiedAt: true, isPrimary: true },
      orderBy: [{ isPrimary: 'desc' }, { verifiedAt: 'desc' }],
      take: 100,
    });
    const employeeIds = [...new Set(bindings.map((binding) => binding.employeeId))];
    const employees = employeeIds.length ? await this.prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } },
      select: { id: true, employeeNumber: true, fullName: true },
    }) : [];
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    return bindings.map((binding) => ({
      id: binding.id,
      employeeId: binding.employeeId,
      externalUserId: binding.externalUserId,
      verifiedAt: binding.verifiedAt,
      isPrimary: binding.isPrimary,
      employeeNumber: employeeById.get(binding.employeeId)?.employeeNumber ?? null,
      employeeName: employeeById.get(binding.employeeId)?.fullName ?? binding.employeeId,
    }));
  }

  async getConfigForUser(user: AuthUser) {
    const companyId = this.requireCompanyId(user);
    const [config, availableRecipients] = await Promise.all([
      this.getConfig(companyId),
      this.verifiedRecipientOptions(companyId),
    ]);
    return { ...config, availableRecipients };
  }

  private async findLowStock(companyId: string, branchId: string) {
    const products = await this.prisma.product.findMany({
      where: { companyId, isActive: true, minStock: { gt: 0 }, inventories: { some: { warehouse: { branchId, branch: { companyId } } } } },
      select: {
        name: true, minStock: true, sku: true, unit: true,
        inventories: { where: { warehouse: { branchId, branch: { companyId } } }, select: { available: true } },
      },
      take: 500,
    });
    return products
      .map((product) => ({ product, available: product.inventories.reduce((sum, inventory) => sum + inventory.available, 0) }))
      .filter((item) => item.available <= item.product.minStock)
      .sort((left, right) => (left.available - left.product.minStock) - (right.available - right.product.minStock))
      .slice(0, 10);
  }

  /** Susun ringkasan hari ini untuk satu perusahaan (branch utama token). */
  async buildDigest(user: AuthUser, branchId?: string) {
    const companyId = this.requireCompanyId(user);
    const targetBranch: string | undefined = branchId ?? (user.branchId ?? undefined);
    if (!targetBranch) throw new BadRequestException('Branch tidak ditemukan pada konteks token.');
    const branch = await this.prisma.branch.findFirst({ where: { id: targetBranch, companyId }, select: { id: true } });
    if (!branch) throw new ForbiddenException('Branch digest tidak tersedia pada tenant aktif.');
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new ForbiddenException('Tenant digest tidak ditemukan.');
    const now = new Date();
    const { start } = businessDayBounds(now, company.timezone);
    const scopedUser: AuthUser = { ...user, companyId, branchId: targetBranch };
    const dashboard = await this.reports.dashboard(scopedUser);

    const [lowStockItems, pendingOrders, topProducts] = await Promise.all([
      this.findLowStock(companyId, targetBranch),
      this.prisma.order.count({ where: { branchId: targetBranch, branch: { companyId }, status: { in: ['PAID', 'PROCESSING'] } } }),
      this.prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: { branchId: targetBranch, branch: { companyId }, status: 'COMPLETED', createdAt: { gte: start } } },
        _sum: { quantity: true, netSubtotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
    ]);

    const productIds = topProducts.map((t) => t.productId).filter(Boolean);
    const productNames = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds }, companyId }, select: { id: true, name: true, unit: true } })
      : [];
    const productLabel = (id: string) => productNames.find((p) => p.id === id) ?? { id, name: id, unit: '' };

    const revenue = Number(dashboard.today.revenue ?? 0);
    const grossProfit = Number(dashboard.today.grossProfit ?? 0);
    const lines = [
      `📊 LAPORAN HARIAN TOKO360 — ${now.toLocaleDateString('id-ID', { timeZone: company.timezone, day: 'numeric', month: 'long', year: 'numeric' })}`,
      ``,
      `💰 Omzet: Rp ${revenue.toLocaleString('id-ID')}`,
      `📈 Laba kotor: Rp ${grossProfit.toLocaleString('id-ID')}`,
      `🧾 Transaksi: ${dashboard.today.transactions}`,
      `⏳ Pesanan online diproses: ${pendingOrders}`,
      ``,
      lowStockItems.length ? `⚠️ Stok menipis (${lowStockItems.length}):` : `✅ Stok aman, tidak ada yang menipis.`,
      ...lowStockItems.slice(0, 8).map((item) => `   • ${item.product.name}: sisa ${item.available} ${item.product.unit} (min ${item.product.minStock} ${item.product.unit})`),
      ``,
      topProducts.length ? `🏆 Produk terlaris:` : ``,
      ...topProducts.map((t, i) => { const product = productLabel(t.productId); return `   ${i + 1}. ${product.name} — ${t._sum.quantity ?? 0} ${product.unit}`.trimEnd(); }),
    ].filter((l) => l !== '');

    return { text: lines.join('\n'), summary: { revenue, grossProfit, transactions: dashboard.today.transactions, pendingOrders, lowStockCount: lowStockItems.length } };
  }

  /** Buat notifikasi TELEGRAM untuk semua penerima terdaftar. Idempotent per hari+branch. */
  async queueDailyDigest(user: AuthUser, branchId?: string) {
    const companyId = this.requireCompanyId(user);
    const config = await this.getConfig(companyId);
    if (!config.enabled) throw new BadRequestException('Owner daily digest sedang nonaktif. Aktifkan konfigurasi sebelum mengirim.');
    if (!config.recipientBindingIds.length) throw new BadRequestException('Owner daily digest belum memiliki penerima Telegram terverifikasi.');
    const bindings = await this.prisma.employeeChannelBinding.findMany({
      where: { id: { in: config.recipientBindingIds }, companyId, channel: 'TELEGRAM', verifiedAt: { not: null }, revokedAt: null, externalUserId: { not: null } },
      select: { id: true, externalUserId: true },
    });
    if (bindings.length !== config.recipientBindingIds.length) throw new BadRequestException('Penerima owner digest sudah tidak valid atau tidak lagi terverifikasi.');
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new ForbiddenException('Tenant digest tidak ditemukan.');
    const todayKey = businessDateKey(new Date(), company.timezone);
    const targetBranch = branchId ?? (user.branchId ?? 'unknown');
    const digest = await this.buildDigest(user, branchId);
    const created: string[] = [];
    for (const binding of bindings) {
      const recipient = binding.externalUserId as string;
      const dedupeKey = `daily-digest:${companyId}:${targetBranch}:${todayKey}`;
      const duplicate = await this.prisma.notification.findFirst({
        where: { companyId, channel: 'TELEGRAM', recipient, templateCode: dedupeKey },
      });
      if (duplicate) continue;
      const notification = await this.prisma.notification.create({
        data: { companyId, channel: 'TELEGRAM', recipient, templateCode: dedupeKey, body: digest.text, status: 'QUEUED', data: { branchId: targetBranch, recipientBindingId: binding.id } },
      });
      created.push(notification.id);
    }
    return { queued: created.length, notificationIds: created, enabled: config.enabled };
  }

  /** Preview tanpa mengirim. */
  async preview(user: AuthUser, branchId?: string) {
    const digest = await this.buildDigest(user, branchId);
    return digest;
  }
}
