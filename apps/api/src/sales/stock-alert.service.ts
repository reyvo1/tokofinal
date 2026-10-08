import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessDateKey } from '../common/business-time';

/**
 * T360-20260825 GROWTH PACK — Fitur 1: notifikasi stok menipis real-time.
 * Dipanggil dari sales.service setelah posting penjualan: bila available
 * produk <= minStock, buat Notification TELEGRAM (dedupe 1x per hari per produk).
 */
const DEDUPE_PREFIX = 'low-stock-alert';

@Injectable()
export class StockAlertService {
  constructor(private readonly prisma: PrismaService) {}

  async alertLowStock(companyId: string, branchId: string | null, productIds: string[], warehouseId: string) {
    if (!productIds.length) return { alerted: [] as string[] };
    const [recipients, company, warehouse] = await Promise.all([
      this.digestRecipients(companyId),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } }),
      this.prisma.warehouse.findFirst({ where: { id: warehouseId, branch: { companyId, ...(branchId ? { id: branchId } : {}) } }, select: { id: true } }),
    ]);
    if (!company || !warehouse || !recipients.length) return { alerted: [] as string[] };

    const todayKey = businessDateKey(new Date(), company.timezone);
    const inventories = await this.prisma.inventory.findMany({
      where: {
        warehouseId,
        warehouse: { branch: { companyId, ...(branchId ? { id: branchId } : {}) } },
        productId: { in: productIds },
        product: { companyId, isActive: true },
      },
      select: { available: true, productId: true, product: { select: { name: true, sku: true, minStock: true, unit: true } } },
    });
    const breached = inventories.filter((inv) => inv.available <= inv.product.minStock);
    const alerted: string[] = [];

    for (const inv of breached) {
      for (const recipient of recipients) {
        const dedupeKey = `${DEDUPE_PREFIX}:${companyId}:${warehouseId}:${inv.productId}:${todayKey}`;
        const duplicate = await this.prisma.notification.findFirst({
          where: { companyId, channel: 'TELEGRAM', recipient, templateCode: dedupeKey },
        });
        if (duplicate) continue;
        await this.prisma.notification.create({
          data: {
            companyId,
            channel: 'TELEGRAM',
            recipient,
            templateCode: dedupeKey,
            subject: `Stok menipis: ${inv.product.name}`,
            body: `⚠️ STOK MENIPIS — ${inv.product.name} (${inv.product.sku})\nSisa ${inv.available} ${inv.product.unit} di gudang (minimum ${inv.product.minStock} ${inv.product.unit}).\nSegera restock sebelum kehabisan.`,
          },
        });
      }
      alerted.push(inv.productId);
    }
    return { alerted };
  }

  private async digestRecipients(companyId: string): Promise<string[]> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { companyId, namespace: 'reports', key: 'daily_digest' },
    });
    if (!setting) return [];
    try {
      const parsed = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value;
      const ids = Array.isArray(parsed?.recipientBindingIds)
        ? parsed.recipientBindingIds.filter((id: unknown): id is string => typeof id === 'string' && !!id.trim()).slice(0, 10)
        : [];
      if (!ids.length) return [];
      const bindings = await this.prisma.employeeChannelBinding.findMany({
        where: {
          id: { in: ids },
          companyId,
          channel: 'TELEGRAM',
          verifiedAt: { not: null },
          revokedAt: null,
          externalUserId: { not: null },
        },
        select: { externalUserId: true },
      });
      return [...new Set(bindings.map((binding) => binding.externalUserId).filter((value): value is string => Boolean(value)))];
    } catch {
      return [];
    }
  }
}
