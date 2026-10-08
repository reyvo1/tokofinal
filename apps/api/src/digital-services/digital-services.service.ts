import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DigitalServiceTransactionStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDigitalServiceTransactionDto } from './dto/digital-services.dto';

type Scope = { companyId: string; branchId: string };
type ProductCursor = { name: string; id: string };
type TxCursor = { createdAt: string; id: string };

@Injectable()
export class DigitalServicesService {
  constructor(private readonly prisma: PrismaService) {}
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

  async createTransaction(dto: CreateDigitalServiceTransactionDto, user: AuthUser) {
    const scope = this.scope(user);
    return serializableTx(this.prisma, async (tx) => {
      const existing = await tx.digitalServiceTransaction.findUnique({ where: { companyId_idempotencyKey: { companyId: scope.companyId, idempotencyKey: dto.idempotencyKey.trim() } } });
      if (existing) return existing;
      const integration = await tx.integrationConnection.findFirst({ where: this.integrationWhere(scope), orderBy: [{ branchId: 'desc' }, { updatedAt: 'desc' }] });
      if (!integration) throw new BadRequestException('IntegrationConnection PPOB DIGIFLAZZ CONNECTED belum tersedia.');
      const product = await tx.digitalServiceProduct.findFirst({ where: { companyId: scope.companyId, integrationId: integration.id, providerSku: dto.providerSku.trim(), active: true, buyerProductStatus: true, sellerProductStatus: true } });
      if (!product) throw new BadRequestException('Produk digital tidak tersedia/aktif pada katalog provider yang tersinkron.');
      const maxPrice = dto.maxPrice == null ? product.costPrice : new Prisma.Decimal(dto.maxPrice);
      if (product.costPrice && maxPrice && new Prisma.Decimal(product.costPrice).greaterThan(maxPrice)) throw new BadRequestException('Harga beli provider saat ini melebihi batas maxPrice transaksi.');
      const number = await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'DIGITAL_SERVICE', prefix: 'PPOB' });
      const row = await tx.digitalServiceTransaction.create({ data: { companyId: scope.companyId, branchId: scope.branchId, integrationId: integration.id, requestedById: user.sub, providerSku: product.providerSku, customerNo: dto.customerNo.trim(), number, idempotencyKey: dto.idempotencyKey.trim(), kind: product.kind, sellingPrice: product.salePrice, maxPrice: maxPrice ?? undefined, requestData: { providerSku: product.providerSku, customerNo: dto.customerNo.trim() } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'digital-service.transaction.requested', aggregateType: 'DigitalServiceTransaction', aggregateId: row.id, payload: { companyId: scope.companyId, branchId: scope.branchId, transactionId: row.id, integrationId: integration.id } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_DIGITAL_SERVICE_TRANSACTION', entityType: 'DigitalServiceTransaction', entityId: row.id, payload: { branchId: scope.branchId, number, providerSku: product.providerSku, customerNo: dto.customerNo.trim() } } });
      return row;
    });
  }

  async recheck(id: string, user: AuthUser) {
    const scope = this.scope(user);
    return serializableTx(this.prisma, async (tx) => {
      const row = await tx.digitalServiceTransaction.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!row) throw new NotFoundException('Transaksi digital tidak ditemukan.');
      if (!['PENDING', 'PROCESSING'].includes(row.status)) throw new BadRequestException('Recheck hanya untuk transaksi PENDING/PROCESSING.');
      if (row.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < 60_000) throw new BadRequestException('Recheck provider dibatasi minimal 60 detik untuk transaksi yang sama.');
      const updated = await tx.digitalServiceTransaction.update({ where: { id: row.id }, data: { lastCheckedAt: new Date() } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'digital-service.transaction.recheck', aggregateType: 'DigitalServiceTransaction', aggregateId: row.id, payload: { companyId: scope.companyId, branchId: scope.branchId, transactionId: row.id, integrationId: row.integrationId } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RECHECK_DIGITAL_SERVICE_TRANSACTION', entityType: 'DigitalServiceTransaction', entityId: row.id, payload: { branchId: scope.branchId } } });
      return updated;
    });
  }
}
