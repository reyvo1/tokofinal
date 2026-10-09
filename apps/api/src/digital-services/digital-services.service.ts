import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DigitalServiceTransactionStatus, Prisma } from '@prisma/client';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { CreateDigitalServiceTransactionDto, VerifyDigitalServiceTaxDto } from './dto/digital-services.dto';

type Scope = { companyId: string; branchId: string };
type ProductCursor = { name: string; id: string };
type TxCursor = { createdAt: string; id: string };

@Injectable()
export class DigitalServicesService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingCoreService, private readonly sales: SalesService) {}
  private scope(user: AuthUser): Scope {
    if (!user.companyId || !user.branchId) throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Company dan branch aktif wajib tersedia.' });
    return { companyId: user.companyId, branchId: user.branchId };
  }
  private integrationWhere(scope: Scope): Prisma.IntegrationConnectionWhereInput {
    return { companyId: scope.companyId, type: 'PPOB', provider: { equals: 'DIGIFLAZZ' }, status: 'CONNECTED', OR: [{ branchId: scope.branchId }, { branchId: null }] };
  }
  private async integration(scope: Scope) {
    const integration = await this.prisma.integrationConnection.findFirst({ where: this.integrationWhere(scope), orderBy: [{ branchId: 'desc' }, { updatedAt: 'desc' }] });
    if (!integration) throw new BadRequestException('IntegrationConnection PPOB DIGIFLAZZ berstatus CONNECTED belum dikonfigurasi untuk tenant/branch ini.');
    return integration;
  }

  async products(user: AuthUser, search?: string, category?: string, limitValue?: string, cursorValue?: string) {
    const scope = this.scope(user); const limit = parsePageLimit(limitValue); const cursor = decodeCursor<ProductCursor>(cursorValue);
    const filters: Prisma.DigitalServiceProductWhereInput[] = [];
    if (search?.trim()) filters.push({ OR: [{ providerSku: { contains: search.trim() } }, { name: { contains: search.trim() } }, { brand: { contains: search.trim() } }] });
    if (category?.trim()) filters.push({ category: category.trim() });
    if (cursor) filters.push({ OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }] });
    const rows = await this.prisma.digitalServiceProduct.findMany({ where: { companyId: scope.companyId, active: true, integration: this.integrationWhere(scope), AND: filters.length ? filters : undefined }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit + 1 });
    return toCursorPage(rows, limit, (row) => ({ name: row.name, id: row.id }));
  }

  async verifyTax(id: string, dto: VerifyDigitalServiceTaxDto, user: AuthUser) {
    const scope = this.scope(user);
    if (dto.taxTreatment !== 'NO_TAX_VERIFIED' || !dto.reason.trim() || dto.reason.trim().length < 12) {
      throw new BadRequestException('Keputusan pajak dan alasan minimal 12 karakter wajib diberikan.');
    }
    return serializableTx(this.prisma, async (tx) => {
      const product = await tx.digitalServiceProduct.findFirst({ where: { id, companyId: scope.companyId, integration: this.integrationWhere(scope) } });
      if (!product) throw new NotFoundException('Produk digital tidak ditemukan pada tenant/cabang aktif.');
      const metadata = product.metadata && typeof product.metadata === 'object' && !Array.isArray(product.metadata)
        ? product.metadata as Record<string, unknown> : {};
      const updated = await tx.digitalServiceProduct.update({ where: { id: product.id }, data: {
        metadata: { ...metadata, taxTreatment: dto.taxTreatment, taxVerificationReason: dto.reason.trim(), taxVerifiedById: user.sub, taxVerifiedAt: new Date().toISOString() } as Prisma.InputJsonObject,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'VERIFY_DIGITAL_PRODUCT_TAX', entityType: 'DigitalServiceProduct', entityId: product.id, payload: { branchId: scope.branchId, taxTreatment: dto.taxTreatment, reason: dto.reason.trim() } } });
      return updated;
    });
  }

  async syncCatalog(user: AuthUser) {
    const scope = this.scope(user); const integration = await this.integration(scope);
    const recent = await this.prisma.eventOutbox.findFirst({ where: { companyId: scope.companyId, eventType: 'digital-service.catalog.sync', aggregateId: integration.id, status: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' } });
    if (recent) return { queued: false, eventId: recent.id, message: 'Sinkronisasi katalog sudah berada di antrean.' };
    const event = await this.prisma.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'digital-service.catalog.sync', aggregateType: 'IntegrationConnection', aggregateId: integration.id, payload: { companyId: scope.companyId, branchId: scope.branchId, integrationId: integration.id, requestedById: user.sub } } });
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'QUEUE_DIGITAL_SERVICE_CATALOG_SYNC', entityType: 'IntegrationConnection', entityId: integration.id, payload: { branchId: scope.branchId, provider: integration.provider } } });
    return { queued: true, eventId: event.id };
  }

  async transactions(user: AuthUser, status?: string, limitValue?: string, cursorValue?: string) {
    const scope = this.scope(user); const limit = parsePageLimit(limitValue); const cursor = decodeCursor<TxCursor>(cursorValue);
    const normalized = status?.trim().toUpperCase();
    if (normalized && !Object.values(DigitalServiceTransactionStatus).includes(normalized as DigitalServiceTransactionStatus)) throw new BadRequestException('Status transaksi digital tidak valid.');
    const filters: Prisma.DigitalServiceTransactionWhereInput[] = [];
    if (cursor) { const createdAt = new Date(cursor.createdAt); if (Number.isNaN(createdAt.getTime())) throw new BadRequestException('Cursor transaksi digital tidak valid.'); filters.push({ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }] }); }
    const rows = await this.prisma.digitalServiceTransaction.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, ...(normalized ? { status: normalized as DigitalServiceTransactionStatus } : {}), AND: filters.length ? filters : undefined }, include: { integration: { select: { id: true, provider: true, name: true } }, requestedBy: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    return toCursorPage(rows, limit, (row) => ({ createdAt: row.createdAt.toISOString(), id: row.id }));
  }

  async transaction(id: string, user: AuthUser) {
    const scope = this.scope(user); const row = await this.prisma.digitalServiceTransaction.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId }, include: { integration: { select: { id: true, provider: true, name: true } }, requestedBy: { select: { id: true, name: true } } } });
    if (!row) throw new NotFoundException('Transaksi digital tidak ditemukan pada branch aktif.');
    return row;
  }

  // A provider request may only leave the transactional outbox after cash is captured into
  // Accounting Core as a customer advance. Unpaid legacy rows are never reusable as a purchase.
  async createTransaction(dto: CreateDigitalServiceTransactionDto, user: AuthUser) {
    const scope = this.scope(user);
    if (dto.providerSku.trim().length < 1 || dto.customerNo.trim().length < 3 || dto.idempotencyKey.trim().length < 8) {
      throw new BadRequestException('SKU, nomor tujuan dan idempotencyKey PPOB wajib valid setelah trim.');
    }
    return serializableTx(this.prisma, async (tx) => {
      const existing = await tx.digitalServiceTransaction.findUnique({ where: { companyId_idempotencyKey: { companyId: scope.companyId, idempotencyKey: dto.idempotencyKey.trim() } } });
      if (existing) {
        if (existing.branchId !== scope.branchId || existing.requestedById !== user.sub) {
          throw new NotFoundException('Transaksi digital tidak ditemukan pada branch/operator aktif.');
        }
        const requestData = existing.requestData && typeof existing.requestData === 'object' && !Array.isArray(existing.requestData)
          ? existing.requestData as Record<string, unknown> : {};
        const previousMaxPrice = requestData.requestedMaxPrice;
        const priceMatches = Object.hasOwn(requestData, 'requestedMaxPrice')
          ? (dto.maxPrice == null ? previousMaxPrice === null : previousMaxPrice !== null && new Prisma.Decimal(String(previousMaxPrice)).equals(dto.maxPrice))
          : (dto.maxPrice == null || (existing.maxPrice != null && new Prisma.Decimal(existing.maxPrice).equals(dto.maxPrice)));
        if (existing.providerSku !== dto.providerSku.trim() || existing.customerNo !== dto.customerNo.trim() || !priceMatches
          || requestData.paymentMethod !== dto.paymentMethod) {
          throw new BadRequestException('Idempotency key PPOB dipakai ulang dengan payload yang berbeda.');
        }
        if (!existing.paymentAccountingEventId || !existing.capturedAt) {
          throw new BadRequestException('Transaksi PPOB historis belum memiliki bukti pembayaran. Provider tidak boleh dipanggil.');
        }
        return existing;
      }
      if (dto.paymentMethod !== 'CASH') throw new BadRequestException('PPOB hanya menerima pembayaran CASH yang terbukti terjurnal.');
      const shift = await tx.cashierShift.findFirst({
        where: { userId: user.sub, status: 'OPEN', user: { branchId: scope.branchId, branch: { companyId: scope.companyId } } },
        orderBy: { openedAt: 'desc' },
      });
      if (!shift) throw new BadRequestException('Buka shift kasir sebelum menerima uang PPOB.');
      const integration = await tx.integrationConnection.findFirst({ where: this.integrationWhere(scope), orderBy: [{ branchId: 'desc' }, { updatedAt: 'desc' }] });
      if (!integration) throw new BadRequestException('IntegrationConnection PPOB DIGIFLAZZ CONNECTED belum tersedia.');
      const config = integration.config && typeof integration.config === 'object' && !Array.isArray(integration.config)
        ? integration.config as Record<string, unknown> : {};
      // High-risk provider dispatch is opt-in. All prerequisites are checked BEFORE accepting cash.
      if (config.ppobCashEnabled !== true) throw new BadRequestException('Penjualan tunai PPOB belum diaktifkan pada konfigurasi integrasi cabang.');
      const providerBalance = typeof config.providerBalanceAccountCode === 'string' ? config.providerBalanceAccountCode.trim().toUpperCase() : '';
      if (!providerBalance) throw new BadRequestException('Konfigurasikan akun aset saldo provider sebelum menerima uang PPOB.');
      const balanceAccount = await tx.account.findFirst({ where: { code: providerBalance, branchId: scope.branchId, isActive: true, type: 'ASSET', branch: { companyId: scope.companyId } } });
      if (!balanceAccount) throw new BadRequestException('Akun saldo provider PPOB harus bertipe ASSET, aktif, dan milik cabang.');
      for (const eventType of ['DIGITAL_SERVICE_FULFILLED', 'DIGITAL_SERVICE_REFUND']) {
        const rule = await tx.accountingPostingRule.findFirst({ where: { companyId: scope.companyId, eventType, status: 'ACTIVE' } });
        if (!rule) throw new BadRequestException(`Accounting rule ACTIVE ${eventType} wajib tersedia sebelum kas PPOB diterima.`);
      }
      const product = await tx.digitalServiceProduct.findFirst({ where: { companyId: scope.companyId, integrationId: integration.id, providerSku: dto.providerSku.trim(), active: true, buyerProductStatus: true, sellerProductStatus: true } });
      if (!product) throw new BadRequestException('Produk digital tidak tersedia/aktif pada katalog provider yang tersinkron.');
      const price = new Prisma.Decimal(product.salePrice);
      if (!price.isFinite() || !price.greaterThan(0) || price.decimalPlaces() > 2) throw new BadRequestException('Harga jual PPOB belum valid sebagai nominal kas.');
      if (dto.maxPrice == null || !Number.isFinite(dto.maxPrice) || dto.maxPrice <= 0 || new Prisma.Decimal(dto.maxPrice).decimalPlaces() > 2) {
        throw new BadRequestException('Batas biaya provider maxPrice wajib positif, terbatas dua desimal, dan diakui operator.');
      }
      if (!product.costPrice || new Prisma.Decimal(product.costPrice).lessThanOrEqualTo(0) || new Prisma.Decimal(product.costPrice).decimalPlaces() > 2) {
        throw new BadRequestException('Harga beli provider tidak tersedia atau belum valid. Jangan menerima uang pelanggan.');
      }
      const maxPrice = new Prisma.Decimal(dto.maxPrice);
      if (new Prisma.Decimal(product.costPrice).greaterThan(maxPrice)) throw new BadRequestException('Harga beli provider saat ini melebihi batas maxPrice transaksi.');
      if (maxPrice.greaterThan(price)) throw new BadRequestException('Batas biaya provider tidak boleh melebihi harga jual tanpa kebijakan rugi yang disetujui.');
      // Fail closed for missing/ambiguous tax classification; the provider's selling price cannot
      // silently become untaxed product revenue merely because the catalog lacks tax fields.
      const metadata = product.metadata && typeof product.metadata === 'object' && !Array.isArray(product.metadata)
        ? product.metadata as Record<string, unknown> : {};
      if (metadata.taxTreatment !== 'NO_TAX_VERIFIED') {
        throw new BadRequestException('PPOB memerlukan klasifikasi pajak produk NO_TAX_VERIFIED yang telah diperiksa operator pajak.');
      }
      const number = await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'DIGITAL_SERVICE', prefix: 'PPOB' });
      const row = await tx.digitalServiceTransaction.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, integrationId: integration.id, requestedById: user.sub,
        providerSku: product.providerSku, customerNo: dto.customerNo.trim(), number,
        idempotencyKey: dto.idempotencyKey.trim(), kind: product.kind,
        sellingPrice: price, maxPrice: maxPrice ?? undefined, cashierShiftId: shift.id,
        requestData: { providerSku: product.providerSku, customerNo: dto.customerNo.trim(), paymentMethod: dto.paymentMethod,
          requestedMaxPrice: dto.maxPrice == null ? null : new Prisma.Decimal(dto.maxPrice).toString(),
          productId: product.id, taxTreatment: 'NO_TAX_VERIFIED' },
      } });
      // This MUST be inside the same serializable transaction as provider outbox insertion.
      const paymentEvent = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'DIGITAL_SERVICE_PREPAYMENT',
        sourceType: 'DigitalServiceTransaction', sourceId: row.id, idempotencyKey: `ppob:prepayment:${row.id}`,
        amounts: { gross: price }, accountCodes: { settlement: '1101', customerAdvance: '2105' },
        context: { cashierShiftId: shift.id, paymentMethod: 'CASH', providerSku: product.providerSku },
      });
      await tx.digitalServiceTransaction.update({ where: { id: row.id }, data: { paymentAccountingEventId: paymentEvent.id, capturedAt: new Date() } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'digital-service.transaction.requested', aggregateType: 'DigitalServiceTransaction', aggregateId: row.id, payload: { companyId: scope.companyId, branchId: scope.branchId, transactionId: row.id, integrationId: integration.id } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CAPTURE_DIGITAL_SERVICE_PREPAYMENT', entityType: 'DigitalServiceTransaction', entityId: row.id, payload: { branchId: scope.branchId, number, paymentAccountingEventId: paymentEvent.id, amount: price.toFixed(2) } } });
      return tx.digitalServiceTransaction.findUniqueOrThrow({ where: { id: row.id } });
    });
  }

  async settle(id: string, user: AuthUser) {
    const scope = this.scope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await tx.digitalServiceTransaction.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId }, include: { integration: true } });
      if (!row) throw new NotFoundException('Transaksi PPOB tidak ditemukan pada cabang aktif.');
      if (row.settlementAccountingEventId) return row;
      if (row.status !== 'SUCCESS' || !row.paymentAccountingEventId || row.refundAccountingEventId) {
        throw new BadRequestException('Hanya PPOB provider SUCCESS yang telah dibayar dan belum direfund boleh diselesaikan.');
      }
      const config = row.integration.config && typeof row.integration.config === 'object' && !Array.isArray(row.integration.config)
        ? row.integration.config as Record<string, unknown> : {};
      const providerBalance = typeof config.providerBalanceAccountCode === 'string' ? config.providerBalanceAccountCode.trim().toUpperCase() : '';
      if (!providerBalance) throw new BadRequestException('Akun saldo provider PPOB belum dikonfigurasi; jurnal settlement ditahan.');
      const account = await tx.account.findFirst({ where: { branchId: scope.branchId, code: providerBalance, isActive: true, type: 'ASSET', branch: { companyId: scope.companyId } } });
      if (!account) throw new BadRequestException('Akun saldo provider harus berupa aset aktif milik cabang.');
      if (row.costAmount == null || new Prisma.Decimal(row.costAmount).isNegative() || new Prisma.Decimal(row.costAmount).decimalPlaces() > 2) {
        throw new BadRequestException('Harga beli provider belum final. Recheck provider sebelum settlement.');
      }
      if (row.maxPrice != null && new Prisma.Decimal(row.costAmount ?? -1).greaterThan(row.maxPrice)) {
        throw new BadRequestException('Harga final provider melebihi batas biaya yang disetujui; settlement ditahan.');
      }
      const prepayment = await tx.accountingEvent.findFirst({ where: { id: row.paymentAccountingEventId, companyId: scope.companyId, branchId: scope.branchId, eventType: 'DIGITAL_SERVICE_PREPAYMENT', sourceType: 'DigitalServiceTransaction', sourceId: row.id, status: 'POSTED' } });
      if (!prepayment) throw new BadRequestException('Jurnal uang muka PPOB tidak ditemukan atau belum POSTED.');
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'DIGITAL_SERVICE_FULFILLED', sourceType: 'DigitalServiceTransaction',
        sourceId: row.id, idempotencyKey: `ppob:fulfilled:${row.id}`,
        amounts: { gross: row.sellingPrice, cost: row.costAmount },
        accountCodes: { customerAdvance: '2105', serviceRevenue: '4104', cogs: '5101', providerBalance },
        context: { paymentAccountingEventId: row.paymentAccountingEventId, providerRef: row.providerRef ?? row.number },
      });
      const updated = await tx.digitalServiceTransaction.update({ where: { id: row.id }, data: { settlementAccountingEventId: event.id, settledAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'SETTLE_DIGITAL_SERVICE', entityType: 'DigitalServiceTransaction', entityId: row.id, payload: { accountingEventId: event.id, branchId: scope.branchId } } });
      return updated;
    });
  }

  async refund(id: string, user: AuthUser) {
    const scope = this.scope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await tx.digitalServiceTransaction.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!row) throw new NotFoundException('Transaksi PPOB tidak ditemukan pada cabang aktif.');
      if (row.refundAccountingEventId) return row;
      if (row.status !== 'FAILED' || !row.paymentAccountingEventId || row.settlementAccountingEventId) {
        throw new BadRequestException('Refund hanya dapat dilakukan atas provider FAILED yang telah dibayar dan belum diselesaikan. Status PENDING tidak boleh direfund.');
      }
      const shift = await tx.cashierShift.findFirst({ where: { userId: user.sub, status: 'OPEN', user: { branchId: scope.branchId, branch: { companyId: scope.companyId } } }, orderBy: { openedAt: 'desc' } });
      if (!shift) throw new BadRequestException('Buka shift kasir yang berwenang sebelum refund uang tunai.');
      const prepayment = await tx.accountingEvent.findFirst({ where: { id: row.paymentAccountingEventId, companyId: scope.companyId, branchId: scope.branchId, eventType: 'DIGITAL_SERVICE_PREPAYMENT', sourceId: row.id, status: 'POSTED' } });
      if (!prepayment) throw new BadRequestException('Jurnal penerimaan pelanggan belum tersedia.');
      await this.sales.assertDrawerCashAvailable(tx, scope, shift, new Prisma.Decimal(row.sellingPrice));
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'DIGITAL_SERVICE_REFUND', sourceType: 'DigitalServiceTransaction',
        sourceId: row.id, idempotencyKey: `ppob:refund:${row.id}`,
        amounts: { gross: row.sellingPrice }, accountCodes: { customerAdvance: '2105', settlement: '1101' },
        context: { paymentAccountingEventId: row.paymentAccountingEventId, refundCashierShiftId: shift.id },
      });
      const updated = await tx.digitalServiceTransaction.update({ where: { id: row.id }, data: { refundAccountingEventId: event.id, refundCashierShiftId: shift.id, refundedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'REFUND_DIGITAL_SERVICE', entityType: 'DigitalServiceTransaction', entityId: row.id, payload: { accountingEventId: event.id, branchId: scope.branchId, amount: row.sellingPrice.toFixed(2) } } });
      return updated;
    });
  }

  async recheck(id: string, user: AuthUser) {
    const scope = this.scope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await tx.digitalServiceTransaction.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!row) throw new NotFoundException('Transaksi digital tidak ditemukan.');
      if (!['PENDING', 'PROCESSING'].includes(row.status)) throw new BadRequestException('Recheck hanya untuk transaksi PENDING/PROCESSING.');
      if (!row.paymentAccountingEventId || !row.capturedAt) throw new BadRequestException('PPOB historis tanpa pembayaran tidak boleh direcheck ke provider.');
      if (row.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < 60_000) throw new BadRequestException('Recheck provider dibatasi minimal 60 detik untuk transaksi yang sama.');
      const updated = await tx.digitalServiceTransaction.update({ where: { id: row.id }, data: { lastCheckedAt: new Date() } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'digital-service.transaction.recheck', aggregateType: 'DigitalServiceTransaction', aggregateId: row.id, payload: { companyId: scope.companyId, branchId: scope.branchId, transactionId: row.id, integrationId: row.integrationId } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RECHECK_DIGITAL_SERVICE_TRANSACTION', entityType: 'DigitalServiceTransaction', entityId: row.id, payload: { branchId: scope.branchId } } });
      return updated;
    });
  }
}
