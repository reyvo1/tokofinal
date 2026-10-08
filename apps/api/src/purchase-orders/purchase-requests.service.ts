import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { serializableTx } from '../common/serializable-tx';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ConvertPurchaseRequestDto, CreatePurchaseRequestDto, DecidePurchaseRequestDto, SubmitPurchaseRequestDto } from './dto/purchase-request.dto';

type TenantScope = { companyId: string; branchId: string };
const OPEN_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] as const;

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) throw new ForbiddenException('Pengguna belum memiliki company dan branch yang valid.');
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(user: AuthUser, scope: TenantScope, entityId?: string): Promise<never> {
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'TENANT_ACCESS_DENIED', entityType: 'PurchaseRequest', entityId, payload: { authenticatedBranchId: scope.branchId } } });
    throw new ForbiddenException('PurchaseRequest tidak tersedia dalam company dan branch pengguna.');
  }

  private include = {
    warehouse: true,
    supplier: true,
    items: { include: { product: true } },
  } as const;

  async list(user: AuthUser, status?: string) {
    const scope = this.requireTenantScope(user);
    return this.prisma.purchaseRequest.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId, ...(status ? { status } : {}) },
      include: this.include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
  }

  async findOne(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const row = await this.prisma.purchaseRequest.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId }, include: this.include });
    if (!row) return this.denyTenantAccess(user, scope, id);
    return row;
  }

  async create(dto: CreatePurchaseRequestDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.items.length) throw new BadRequestException('Purchase request harus memiliki minimal satu barang.');

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true } });
    if (!warehouse) throw new BadRequestException('Gudang tidak ditemukan pada branch aktif.');
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, companyId: scope.companyId, isActive: true }, select: { id: true } });
      if (!supplier) throw new BadRequestException('Supplier tidak ditemukan pada company aktif.');
    }
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds }, companyId: scope.companyId, isActive: true }, select: { id: true } });
    if (products.length !== productIds.length) throw new BadRequestException('Satu atau lebih produk tidak ditemukan pada company aktif.');

    return serializableTx(this.prisma, async (tx) => {
      const row = await tx.purchaseRequest.create({
        data: {
          number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PURCHASE_REQUEST', prefix: 'PR' }),
          companyId: scope.companyId,
          branchId: scope.branchId,
          warehouseId: warehouse.id,
          supplierId: dto.supplierId,
          requestedById: user.sub,
          neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined,
          reason: dto.reason,
          notes: dto.notes,
          items: { create: dto.items.map((item) => ({ productId: item.productId, quantity: item.quantity, estimatedUnitCost: new Prisma.Decimal(item.estimatedUnitCost), notes: item.notes })) },
        },
        include: this.include,
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_PURCHASE_REQUEST', entityType: 'PurchaseRequest', entityId: row.id, payload: { branchId: scope.branchId, number: row.number, itemCount: dto.items.length } } });
      return row;
    });
  }

  async submit(id: string, dto: SubmitPurchaseRequestDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const request = await this.prisma.purchaseRequest.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId }, include: { items: true } });
    if (!request) return this.denyTenantAccess(user, scope, id);
    if (!['DRAFT', 'SUBMITTING'].includes(request.status)) throw new BadRequestException('Hanya purchase request DRAFT yang dapat diajukan.');
    if (!request.items.length) throw new BadRequestException('Purchase request tidak memiliki item.');
    const amount = request.items.reduce((sum, item) => sum.add(item.estimatedUnitCost.mul(item.quantity)), new Prisma.Decimal(0));

    // Claim status first so concurrent submit cannot create two approval requests. SUBMITTING is recoverable:
    // if a process died after ApprovalRequest creation, retry links that pending approval instead of creating another.
    if (request.status === 'DRAFT') {
      const claimed = await this.prisma.purchaseRequest.updateMany({ where: { id, status: 'DRAFT', approvalRequestId: null }, data: { status: 'SUBMITTING' } });
      if (claimed.count !== 1) throw new BadRequestException('Purchase request berubah oleh proses lain. Muat ulang status.');
    }

    let approval = await this.prisma.approvalRequest.findFirst({
      where: { companyId: scope.companyId, branchId: scope.branchId, entityType: 'PurchaseRequest', entityId: id, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
    });
    if (!approval) {
      try {
        approval = await this.platform.createApprovalRequest({ policyId: dto.policyId, entityType: 'PurchaseRequest', entityId: id, amount: Number(amount), context: { purchaseRequestNumber: request.number, warehouseId: request.warehouseId, supplierId: request.supplierId } }, user);
      } catch (error) {
        await this.prisma.purchaseRequest.updateMany({ where: { id, status: 'SUBMITTING', approvalRequestId: null }, data: { status: 'DRAFT' } });
        throw error;
      }
    }
    const updated = await this.prisma.purchaseRequest.update({ where: { id }, data: { status: 'PENDING_APPROVAL', approvalRequestId: approval.id, requestedAt: request.requestedAt ?? new Date() }, include: this.include });
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'SUBMIT_PURCHASE_REQUEST', entityType: 'PurchaseRequest', entityId: id, payload: { approvalRequestId: approval.id, amount: amount.toString() } } });
    return updated;
  }

  async decide(id: string, dto: DecidePurchaseRequestDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const request = await this.prisma.purchaseRequest.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!request) return this.denyTenantAccess(user, scope, id);
    if (request.status !== 'PENDING_APPROVAL' || !request.approvalRequestId) throw new BadRequestException('Purchase request belum menunggu approval.');
    const approval = await this.platform.decideApproval(request.approvalRequestId, dto, user);
    const nextStatus = approval.status === 'APPROVED' ? 'APPROVED' : approval.status === 'REJECTED' ? 'REJECTED' : 'PENDING_APPROVAL';
    const updated = await this.prisma.purchaseRequest.update({
      where: { id },
      data: nextStatus === 'APPROVED'
        ? { status: nextStatus, approvedById: user.sub, approvedAt: new Date() }
        : nextStatus === 'REJECTED'
          ? { status: nextStatus }
          : { status: nextStatus },
      include: this.include,
    });
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'DECIDE_PURCHASE_REQUEST', entityType: 'PurchaseRequest', entityId: id, payload: { decision: dto.status, approvalStatus: approval.status } } });
    return updated;
  }

  async cancel(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const request = await this.prisma.purchaseRequest.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!request) return this.denyTenantAccess(user, scope, id);
    if (!(OPEN_STATUSES as readonly string[]).includes(request.status)) throw new BadRequestException('Purchase request pada status ini tidak dapat dibatalkan.');
    if (request.status === 'PENDING_APPROVAL') throw new BadRequestException('Purchase request yang sedang approval harus ditolak melalui workflow approval.');
    const updated = await this.prisma.purchaseRequest.update({ where: { id }, data: { status: 'CANCELLED' }, include: this.include });
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CANCEL_PURCHASE_REQUEST', entityType: 'PurchaseRequest', entityId: id, payload: { previousStatus: request.status } } });
    return updated;
  }

  async convert(id: string, dto: ConvertPurchaseRequestDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const request = await this.prisma.purchaseRequest.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId }, include: { items: true } });
    if (!request) return this.denyTenantAccess(user, scope, id);
    if (request.status === 'CONVERTED' && request.purchaseOrderId) return this.purchaseOrders.findOne(request.purchaseOrderId, user);
    if (request.status !== 'APPROVED') throw new BadRequestException('Hanya purchase request APPROVED yang dapat dikonversi menjadi PO.');
    const supplierId = dto.supplierId ?? request.supplierId;
    if (!supplierId) throw new BadRequestException('Supplier wajib ditentukan sebelum purchase request dikonversi menjadi PO.');
    const activeSupplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, companyId: scope.companyId, isActive: true }, select: { id: true } });
    if (!activeSupplier) throw new BadRequestException('Supplier tidak aktif atau tidak tersedia pada company aktif.');
    const order = await this.purchaseOrders.create({
      idempotencyKey: `purchase-request:${request.id}`,
      supplierId,
      warehouseId: request.warehouseId,
      expectedDate: dto.expectedDate ?? request.neededBy?.toISOString(),
      notes: dto.notes ?? request.notes ?? `Konversi dari ${request.number}`,
      items: request.items.map((item) => ({ productId: item.productId, orderedQty: item.quantity, unitCost: Number(item.estimatedUnitCost) })),
    }, user);
    const claimed = await this.prisma.purchaseRequest.updateMany({ where: { id, status: 'APPROVED', purchaseOrderId: null }, data: { status: 'CONVERTED', supplierId, purchaseOrderId: order.id, convertedAt: new Date() } });
    if (claimed.count === 0) {
      const current = await this.prisma.purchaseRequest.findUnique({ where: { id } });
      if (current?.status !== 'CONVERTED' || current.purchaseOrderId !== order.id) throw new BadRequestException('Purchase request berubah saat konversi. Muat ulang status.');
    }
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CONVERT_PURCHASE_REQUEST', entityType: 'PurchaseRequest', entityId: id, payload: { purchaseOrderId: order.id, supplierId } } });
    return order;
  }
}
