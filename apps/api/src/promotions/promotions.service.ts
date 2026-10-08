import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { resolveLoyaltyTier } from '../common/loyalty-tier';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromoRuleDto, UpdatePromoRuleDto } from './dto/promotions.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
type PromotionLine = { productId: string; quantity: number; unitPrice: Prisma.Decimal.Value };
type PromotionContext = { channel?: 'POS' | 'STOREFRONT'; lines?: PromotionLine[] };
type PromoShape = {
  type: string;
  value: Prisma.Decimal | number;
  minSubtotal: Prisma.Decimal | number;
  maxDiscount: Prisma.Decimal | number | null;
  productIds?: Prisma.JsonValue | null;
  minQuantity?: number | null;
  buyQuantity?: number | null;
  getQuantity?: number | null;
};

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Format tanggal tidak valid.');
  return parsed;
}

function productIdsOf(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))];
}

/** Simple discount helper kept stable for reporting/preview compatibility. */
export function computeDiscount(
  rule: { type: string; value: Prisma.Decimal | number; minSubtotal: Prisma.Decimal | number; maxDiscount: Prisma.Decimal | number | null },
  subtotal: number,
): number {
  if (subtotal < Number(rule.minSubtotal ?? 0)) return 0;
  const raw = rule.type === 'PERCENT' ? (subtotal * Number(rule.value)) / 100 : rule.type === 'AMOUNT' ? Number(rule.value) : 0;
  const capped = rule.maxDiscount != null ? Math.min(raw, Number(rule.maxDiscount)) : raw;
  return Math.max(0, Math.min(capped, subtotal));
}

/**
 * Canonical line-aware promotion calculator.
 * - PERCENT / AMOUNT may be scoped to products.
 * - QUANTITY_BREAK applies percentage `value` after minQuantity eligible units.
 * - BOGO makes the cheapest eligible units free for every buy+get group.
 * - BUNDLE applies fixed `value` discount for every minQuantity eligible units.
 */
export function computeLineAwareDiscount(rule: PromoShape, subtotalValue: Prisma.Decimal.Value, lines: PromotionLine[] = []): Prisma.Decimal {
  const subtotal = new Prisma.Decimal(subtotalValue);
  if (subtotal.lessThan(Number(rule.minSubtotal ?? 0))) return new Prisma.Decimal(0);
  const productIds = productIdsOf(rule.productIds);
  const eligible = lines.filter((line) => !productIds.length || productIds.includes(line.productId));
  const eligibleSubtotal = eligible.reduce((sum, line) => sum.add(new Prisma.Decimal(line.unitPrice).mul(line.quantity)), new Prisma.Decimal(0));
  const eligibleQuantity = eligible.reduce((sum, line) => sum + Math.max(0, Math.floor(line.quantity)), 0);
  const baseForSimple = lines.length ? eligibleSubtotal : subtotal;
  let discount = new Prisma.Decimal(0);

  switch (rule.type) {
    case 'PERCENT':
      discount = baseForSimple.mul(Number(rule.value)).div(100);
      break;
    case 'AMOUNT':
      discount = new Prisma.Decimal(rule.value);
      break;
    case 'QUANTITY_BREAK': {
      const minimum = Math.max(1, rule.minQuantity ?? 1);
      if (eligibleQuantity >= minimum) discount = eligibleSubtotal.mul(Number(rule.value)).div(100);
      break;
    }
    case 'BOGO': {
      const buy = Math.max(1, rule.buyQuantity ?? 1);
      const get = Math.max(1, rule.getQuantity ?? 1);
      const freeUnits = Math.floor(eligibleQuantity / (buy + get)) * get;
      let remaining = freeUnits;
      for (const line of [...eligible].sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice))) {
        if (remaining <= 0) break;
        const freeFromLine = Math.min(remaining, Math.max(0, Math.floor(line.quantity)));
        discount = discount.add(new Prisma.Decimal(line.unitPrice).mul(freeFromLine));
        remaining -= freeFromLine;
      }
      break;
    }
    case 'BUNDLE': {
      const size = Math.max(1, rule.minQuantity ?? 1);
      const bundles = Math.floor(eligibleQuantity / size);
      discount = new Prisma.Decimal(rule.value).mul(bundles);
      break;
    }
    default:
      throw new BadRequestException(`Tipe promo ${rule.type} belum didukung.`);
  }

  if (rule.maxDiscount != null) { const cap = new Prisma.Decimal(rule.maxDiscount); if (discount.greaterThan(cap)) discount = cap; }
  const eligibleCap = baseForSimple.isZero() ? subtotal : baseForSimple;
  if (discount.greaterThan(subtotal)) discount = subtotal;
  if (discount.greaterThan(eligibleCap)) discount = eligibleCap;
  if (discount.lessThan(0)) discount = new Prisma.Decimal(0);
  return discount.toDecimalPlaces(2);
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Pengguna belum memiliki company dan branch yang valid.' });
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(client: DbClient, user: AuthUser, scope: TenantScope, entityType: string, entityId?: string): Promise<never> {
    await client.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'TENANT_ACCESS_DENIED', entityType, entityId, payload: { authenticatedCompanyId: scope.companyId, authenticatedBranchId: scope.branchId } } });
    throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED', message: `${entityType} tidak tersedia dalam company dan branch pengguna.` });
  }

  async list(user: AuthUser, limitValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = Math.min(Math.max(Number(limitValue ?? 50) || 50, 1), 200);
    return this.prisma.promoRule.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit });
  }

  private validateShape(input: { type: string; value: number; minQuantity?: number | null; buyQuantity?: number | null; getQuantity?: number | null; usageLimit?: number | null; perCustomerLimit?: number | null }) {
    if (['PERCENT', 'QUANTITY_BREAK'].includes(input.type) && (input.value < 0 || input.value > 100)) throw new BadRequestException('Nilai promo persen harus antara 0 dan 100.');
    if (input.type === 'QUANTITY_BREAK' && !input.minQuantity) throw new BadRequestException('QUANTITY_BREAK membutuhkan minQuantity.');
    if (input.type === 'BUNDLE' && !input.minQuantity) throw new BadRequestException('BUNDLE membutuhkan minQuantity.');
    if (input.type === 'BOGO' && (!input.buyQuantity || !input.getQuantity)) throw new BadRequestException('BOGO membutuhkan buyQuantity dan getQuantity.');
    if (input.usageLimit && input.perCustomerLimit && input.perCustomerLimit > input.usageLimit) throw new BadRequestException('Batas per pelanggan tidak boleh melebihi quota global.');
  }

  private async validateProducts(client: DbClient, scope: TenantScope, ids?: string[]) {
    const productIds = [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))];
    if (!productIds.length) return productIds;
    const count = await client.product.count({ where: { id: { in: productIds }, companyId: scope.companyId, isActive: true } });
    if (count !== productIds.length) throw new BadRequestException('Satu atau lebih produk promo tidak tersedia pada company ini.');
    return productIds;
  }

  async create(dto: CreatePromoRuleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const startsAt = parseDate(dto.startsAt, new Date());
    const endsAt = dto.endsAt ? parseDate(dto.endsAt, startsAt) : null;
    if (endsAt && endsAt < startsAt) throw new BadRequestException('Tanggal akhir tidak boleh sebelum tanggal mulai.');
    this.validateShape(dto);
    return this.prisma.$transaction(async (tx) => {
      const duplicated = await tx.promoRule.findUnique({ where: { companyId_code: { companyId: scope.companyId, code: dto.code.toUpperCase() } }, select: { id: true } });
      if (duplicated) throw new BadRequestException('Kode promo sudah dipakai.');
      const productIds = await this.validateProducts(tx, scope, dto.productIds);
      const row = await tx.promoRule.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, name: dto.name.trim(), code: dto.code.trim().toUpperCase(), type: dto.type,
        value: new Prisma.Decimal(dto.value), minSubtotal: new Prisma.Decimal(dto.minSubtotal ?? 0), maxDiscount: dto.maxDiscount != null ? new Prisma.Decimal(dto.maxDiscount) : null,
        memberTier: dto.memberTier?.trim().toUpperCase() || null, channel: dto.channel ?? 'ALL', productIds: productIds.length ? productIds : Prisma.JsonNull,
        minQuantity: dto.minQuantity, buyQuantity: dto.buyQuantity, getQuantity: dto.getQuantity, usageLimit: dto.usageLimit, perCustomerLimit: dto.perCustomerLimit,
        startsAt, endsAt, createdById: user.sub,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_PROMO_RULE', entityType: 'PromoRule', entityId: row.id, payload: { branchId: scope.branchId, code: row.code, type: row.type, channel: row.channel, productIds } } });
      return row;
    });
  }

  async update(id: string, dto: UpdatePromoRuleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.promoRule.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!row) return this.denyTenantAccess(tx, user, scope, 'PromoRule', id);
      const startsAt = dto.startsAt ? parseDate(dto.startsAt, row.startsAt) : row.startsAt;
      const endsAt = dto.endsAt ? parseDate(dto.endsAt, row.endsAt ?? row.startsAt) : row.endsAt;
      if (endsAt && endsAt < startsAt) throw new BadRequestException('Tanggal akhir tidak boleh sebelum tanggal mulai.');
      const merged = {
        type: dto.type ?? row.type, value: dto.value ?? Number(row.value), minQuantity: dto.minQuantity ?? row.minQuantity,
        buyQuantity: dto.buyQuantity ?? row.buyQuantity, getQuantity: dto.getQuantity ?? row.getQuantity,
        usageLimit: dto.usageLimit ?? row.usageLimit, perCustomerLimit: dto.perCustomerLimit ?? row.perCustomerLimit,
      };
      this.validateShape(merged);
      const productIds = dto.productIds !== undefined ? await this.validateProducts(tx, scope, dto.productIds) : productIdsOf(row.productIds);
      const updated = await tx.promoRule.update({ where: { id: row.id }, data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.type !== undefined ? { type: dto.type } : {}),
        value: dto.value != null ? new Prisma.Decimal(dto.value) : undefined, minSubtotal: dto.minSubtotal != null ? new Prisma.Decimal(dto.minSubtotal) : undefined,
        maxDiscount: dto.maxDiscount != null ? new Prisma.Decimal(dto.maxDiscount) : undefined,
        ...(dto.memberTier !== undefined ? { memberTier: dto.memberTier.trim().toUpperCase() || null } : {}),
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}), ...(dto.productIds !== undefined ? { productIds: productIds.length ? productIds : Prisma.JsonNull } : {}),
        ...(dto.minQuantity !== undefined ? { minQuantity: dto.minQuantity } : {}), ...(dto.buyQuantity !== undefined ? { buyQuantity: dto.buyQuantity } : {}),
        ...(dto.getQuantity !== undefined ? { getQuantity: dto.getQuantity } : {}), ...(dto.usageLimit !== undefined ? { usageLimit: dto.usageLimit } : {}),
        ...(dto.perCustomerLimit !== undefined ? { perCustomerLimit: dto.perCustomerLimit } : {}), startsAt, endsAt,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_PROMO_RULE', entityType: 'PromoRule', entityId: row.id, payload: { branchId: scope.branchId, isActive: updated.isActive } } });
      return updated;
    });
  }

  private async customerTier(client: DbClient, scope: TenantScope, customerId?: string): Promise<string | null> {
    if (!customerId) return null;
    const customer = await client.customer.findFirst({ where: { id: customerId, companyId: scope.companyId }, select: { id: true } });
    if (!customer) throw new BadRequestException('Pelanggan promo tidak ditemukan pada perusahaan ini.');
    const program = await client.loyaltyProgram.findFirst({ where: { companyId: scope.companyId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, tiers: true } });
    if (!program) return 'MEMBER';
    const account = await client.loyaltyAccount.findUnique({ where: { programId_customerId: { programId: program.id, customerId } }, select: { lifetimePoints: true } });
    return resolveLoyaltyTier(program.tiers, account?.lifetimePoints ?? 0).code;
  }

  private async assertQuota(client: DbClient, rule: { id: string; code: string; usageLimit: number | null; perCustomerLimit: number | null }, customerId?: string) {
    if (rule.usageLimit != null) {
      const used = await client.promoRedemption.count({ where: { promoRuleId: rule.id } });
      if (used >= rule.usageLimit) throw new BadRequestException(`Quota promo ${rule.code} sudah habis.`);
    }
    if (rule.perCustomerLimit != null) {
      if (!customerId) throw new BadRequestException(`Promo ${rule.code} membutuhkan pelanggan untuk batas pemakaian.`);
      const used = await client.promoRedemption.count({ where: { promoRuleId: rule.id, customerId } });
      if (used >= rule.perCustomerLimit) throw new BadRequestException(`Batas pemakaian promo ${rule.code} untuk pelanggan ini sudah tercapai.`);
    }
  }

  async resolveSalePromotion(
    client: DbClient,
    scope: TenantScope,
    subtotalValue: Prisma.Decimal.Value,
    code?: string,
    at = new Date(),
    customerId?: string,
    context: PromotionContext = {},
  ): Promise<{ discount: Prisma.Decimal; rule: { id: string; code: string; name: string; type: string } | null }> {
    if (!code?.trim()) return { discount: new Prisma.Decimal(0), rule: null };
    const subtotal = new Prisma.Decimal(subtotalValue);
    if (subtotal.lessThan(0)) throw new BadRequestException('Subtotal promo tidak valid.');
    const normalizedCode = code.trim().toUpperCase();
    const rule = await client.promoRule.findFirst({ where: { companyId: scope.companyId, branchId: scope.branchId, code: normalizedCode, isActive: true, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gte: at } }] } });
    if (!rule) throw new BadRequestException(`Promo ${normalizedCode} tidak aktif atau tidak tersedia di cabang ini.`);
    if (rule.channel !== 'ALL' && context.channel !== rule.channel) throw new BadRequestException(`Promo ${normalizedCode} hanya berlaku untuk channel ${rule.channel}.`);
    if (rule.memberTier) {
      const actualTier = await this.customerTier(client, scope, customerId);
      if (!actualTier) throw new BadRequestException(`Promo ${normalizedCode} khusus tier ${rule.memberTier} dan membutuhkan pelanggan.`);
      if (actualTier.toUpperCase() !== rule.memberTier.toUpperCase()) throw new BadRequestException(`Promo ${normalizedCode} khusus tier ${rule.memberTier}; tier pelanggan saat ini ${actualTier}.`);
    }
    await this.assertQuota(client, rule, customerId);
    const scopedProducts = productIdsOf(rule.productIds);
    if (scopedProducts.length && !(context.lines ?? []).some((line) => scopedProducts.includes(line.productId))) throw new BadRequestException(`Promo ${normalizedCode} tidak berlaku untuk produk pada transaksi ini.`);
    const discount = computeLineAwareDiscount(rule, subtotal, context.lines ?? []);
    if (discount.lessThanOrEqualTo(0)) throw new BadRequestException(`Promo ${normalizedCode} belum memenuhi syarat transaksi.`);
    return { discount, rule: { id: rule.id, code: rule.code, name: rule.name, type: rule.type } };
  }

  async recordRedemption(
    client: DbClient,
    scope: TenantScope,
    ruleId: string,
    customerId: string | undefined,
    referenceType: 'Sale' | 'Order',
    referenceId: string,
    discount: Prisma.Decimal.Value,
  ) {
    const existing = await client.promoRedemption.findFirst({ where: { promoRuleId: ruleId, referenceType, referenceId } });
    if (existing) return existing;
    const rule = await client.promoRule.findFirst({ where: { id: ruleId, companyId: scope.companyId, branchId: scope.branchId, isActive: true } });
    if (!rule) throw new BadRequestException('Promo tidak lagi tersedia saat transaksi diposting.');
    await this.assertQuota(client, rule, customerId);
    return client.promoRedemption.create({ data: { companyId: scope.companyId, branchId: scope.branchId, promoRuleId: rule.id, customerId, referenceType, referenceId, discount: new Prisma.Decimal(discount) } });
  }

  // Preview read-only untuk rule sederhana. Rule line-aware harus divalidasi lewat quote/checkout canonical.
  async preview(user: AuthUser, subtotalValue: number | undefined, code?: string, memberTier?: string) {
    const scope = this.requireTenantScope(user);
    const subtotal = Number(subtotalValue ?? 0);
    if (!Number.isFinite(subtotal) || subtotal < 0) throw new BadRequestException('Subtotal tidak valid.');
    const now = new Date();
    const rules = await this.prisma.promoRule.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }], ...(code ? { code: code.toUpperCase() } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 });
    const eligible = rules.filter((rule) => (!rule.memberTier || rule.memberTier === memberTier) && ['PERCENT', 'AMOUNT'].includes(rule.type) && productIdsOf(rule.productIds).length === 0 && rule.channel === 'ALL');
    if (!eligible.length) return { subtotal, discount: 0, appliedRule: null, note: 'Tidak ada promo sederhana yang dapat dipreview tanpa cart context. Gunakan quote/checkout untuk rule produk, channel, BOGO, bundle, atau quantity break.' };
    const best = eligible.map((rule) => ({ rule, discount: computeDiscount(rule, subtotal) })).sort((a, b) => b.discount - a.discount)[0];
    return { subtotal, discount: best.discount, appliedRule: { id: best.rule.id, code: best.rule.code, name: best.rule.name, type: best.rule.type }, note: 'Preview read-only; transaksi final tetap divalidasi server.' };
  }
}
