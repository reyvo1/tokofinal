import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InspectionStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AddInspectionEvidenceDto, ApproveInspectionDto, CompleteInspectionDto, ConfirmOperationDto, CreateGatePassDto, CreateInspectionDto, CreateInspectionTemplateDto, UpsertOperationPolicyDto } from './dto/operations-control.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class OperationsControlService {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Pengguna belum memiliki company dan branch yang valid.' });
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
    await client.auditLog.create({ data: {
      companyId: scope.companyId, userId: user.sub, action: 'TENANT_ACCESS_DENIED', entityType, entityId,
      payload: payload ?? { authenticatedCompanyId: scope.companyId, authenticatedBranchId: scope.branchId },
    } });
    throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED', message: `${entityType} tidak tersedia dalam company dan branch pengguna.` });
  }

  private async assertRequestedScope(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    companyId?: string,
    branchId?: string,
    entityType = 'OperationsControl',
  ) {
    if ((companyId && companyId !== scope.companyId) || (branchId && branchId !== scope.branchId)) {
      await this.denyTenantAccess(client, user, scope, entityType, undefined, {
        authenticatedCompanyId: scope.companyId, authenticatedBranchId: scope.branchId,
        ...(companyId ? { requestedCompanyId: companyId } : {}), ...(branchId ? { requestedBranchId: branchId } : {}),
      });
    }
  }

  private async scopedInspection(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.operationalInspection.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'OperationalInspection', id);
    return row;
  }

  private async scopedGatePass(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.gatePass.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'GatePass', id);
    return row;
  }

  private inspectionOperationType(sourceType: string): string | null {
    if (sourceType === 'GoodsReceipt') return 'PURCHASE_RECEIPT';
    if (sourceType === 'Shipment' || sourceType === 'Order') return 'ORDER_OUTBOUND';
    if (sourceType === 'PurchaseReturn') return 'PURCHASE_RETURN';
    if (sourceType === 'SaleReturn' || sourceType === 'OrderReturn') return 'SALE_RETURN';
    return null;
  }

  private evidenceRoot(): string {
    return resolve(process.env.INSPECTION_EVIDENCE_DIR ?? 'runtime/inspection-evidence');
  }

  private safeEvidenceSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
  }

  async addInspectionEvidence(id: string, dto: AddInspectionEvidenceDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const inspection = await this.scopedInspection(this.prisma, user, scope, id);
    if (['APPROVED','REJECTED','CANCELLED'].includes(inspection.status)) {
      throw new BadRequestException(`Pemeriksaan sudah ${inspection.status}; evidence tidak dapat diubah.`);
    }

    const evidenceType = dto.evidenceType.toUpperCase();
    let storageKey = '';
    let sha256 = '';
    let mimeType = dto.mimeType?.trim();
    let writtenPath: string | null = null;
    const metadata: Record<string, unknown> = { ...(dto.metadata ?? {}), verifiedByServer: true };

    let scannedProductId: string | undefined;
    let scannedSerialId: string | undefined;
    if (evidenceType === 'BARCODE') {
      const value = dto.value?.trim();
      if (!value) throw new BadRequestException('Nilai barcode wajib diisi.');
      if (inspection.sourceType === 'GoodsReceipt') {
        const receipt = await this.prisma.goodsReceipt.findFirst({
          where: { id: inspection.sourceId, warehouse: { branchId: scope.branchId, branch: { companyId: scope.companyId } } },
          include: { items: { include: { product: true } } },
        });
        if (!receipt) return this.denyTenantAccess(this.prisma, user, scope, 'GoodsReceipt', inspection.sourceId);
        const matched = receipt.items.find((item) => item.product.barcode === value || item.product.sku === value);
        if (!matched) throw new BadRequestException('Barcode/SKU tidak termasuk dalam Goods Receipt ini.');
        scannedProductId = matched.productId;
        metadata.productId = matched.productId;
      } else if (inspection.sourceType === 'OrderReturn') {
        const orderReturn = await this.prisma.orderReturn.findFirst({
          where: { id: inspection.sourceId, companyId: scope.companyId, branchId: scope.branchId },
          include: { items: { include: { product: { include: { barcodes: true } } } } },
        });
        if (!orderReturn) return this.denyTenantAccess(this.prisma, user, scope, 'OrderReturn', inspection.sourceId);
        const matched = orderReturn.items.find((item) => item.product.sku === value || item.product.barcode === value || item.product.barcodes.some((barcode) => barcode.code === value));
        if (!matched) throw new BadRequestException('Barcode/SKU tidak termasuk dalam retur order ini.');
        scannedProductId = matched.productId;
        metadata.productId = matched.productId;
      } else if (inspection.sourceType === 'Shipment') {
        const shipment = await this.prisma.shipment.findUnique({
          where: { id: inspection.sourceId },
          select: { id: true, orderId: true, warehouseId: true },
        });
        if (!shipment?.orderId || !(await this.assertWarehouseSource(this.prisma, scope, shipment.warehouseId))) {
          return this.denyTenantAccess(this.prisma, user, scope, 'Shipment', inspection.sourceId);
        }
        const order = await this.prisma.order.findFirst({
          where: { id: shipment.orderId, branchId: scope.branchId, branch: { companyId: scope.companyId } },
          include: { items: { include: { product: true } } },
        });
        if (!order) return this.denyTenantAccess(this.prisma, user, scope, 'Order', shipment.orderId);
        const serial = await this.prisma.inventorySerial.findUnique({ where: { serialNumber: value } });
        if (serial) {
          const orderItem = order.items.find((item) => item.productId === serial.productId && item.product.trackSerial);
          if (!orderItem || serial.warehouseId !== shipment.warehouseId) {
            throw new BadRequestException('Serial tidak termasuk produk/warehouse pada shipment ini.');
          }
          if (serial.status !== 'AVAILABLE') {
            if (!(serial.status === 'RESERVED' && serial.referenceType === 'Shipment' && serial.referenceId === shipment.id)) {
              throw new BadRequestException(`Serial ${value} berstatus ${serial.status} dan tidak tersedia untuk shipment ini.`);
            }
            throw new BadRequestException('Serial ini sudah pernah discan untuk shipment yang sama.');
          }
          scannedProductId = serial.productId;
          scannedSerialId = serial.id;
          metadata.productId = serial.productId;
          metadata.serialNumber = serial.serialNumber;
        } else {
          const matched = order.items.find((item) => !item.product.trackSerial && (item.product.barcode === value || item.product.sku === value));
          if (!matched) throw new BadRequestException('Barcode/SKU/serial tidak termasuk dalam shipment ini.');
          scannedProductId = matched.productId;
          metadata.productId = matched.productId;
        }
      }
      sha256 = createHash('sha256').update(value).digest('hex');
      storageKey = `barcode:${sha256}:${randomUUID()}`;
      mimeType = 'text/plain';
      metadata.barcode = value;
    } else {
      const raw = dto.dataBase64?.trim();
      if (!raw) throw new BadRequestException('Data evidence base64 wajib diisi.');
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) throw new BadRequestException('Format base64 evidence tidak valid.');
      const bytes = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
      if (!bytes.length) throw new BadRequestException('Evidence kosong.');
      if (bytes.length > 8 * 1024 * 1024) throw new BadRequestException('Ukuran evidence maksimum 8 MiB.');
      const allowedMime = new Map([
        ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['application/pdf', '.pdf'],
      ]);
      const normalizedMime = (mimeType ?? '').toLowerCase();
      const extension = allowedMime.get(normalizedMime);
      if (!extension) throw new BadRequestException('Tipe evidence harus JPEG, PNG, WEBP, atau PDF.');
      if (evidenceType === 'PHOTO' && !normalizedMime.startsWith('image/')) throw new BadRequestException('Evidence PHOTO harus berupa gambar.');
      const signatureValid = normalizedMime === 'image/jpeg'
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : normalizedMime === 'image/png'
          ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
          : normalizedMime === 'image/webp'
            ? bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
            : bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
      if (!signatureValid) throw new BadRequestException('Isi evidence tidak sesuai dengan MIME type yang dikirim.');
      sha256 = createHash('sha256').update(bytes).digest('hex');
      const relativeKey = [this.safeEvidenceSegment(scope.companyId), this.safeEvidenceSegment(id), `${randomUUID()}${extension}`].join('/');
      const absolute = resolve(this.evidenceRoot(), relativeKey);
      const root = this.evidenceRoot();
      if (!absolute.startsWith(root)) throw new BadRequestException('Lokasi evidence tidak valid.');
      await mkdir(resolve(root, this.safeEvidenceSegment(scope.companyId), this.safeEvidenceSegment(id)), { recursive: true });
      await writeFile(absolute, bytes, { flag: 'wx' });
      writtenPath = absolute;
      storageKey = `inspection-evidence/${relativeKey}`;
      metadata.byteLength = bytes.length;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (scannedProductId) {
          const results = await tx.inspectionResultItem.findMany({ where: { inspectionId: id, productId: scannedProductId }, orderBy: { id: 'asc' } });
          const result = results.find((row) => (row.expectedQty ?? 0) > 0 && (row.scannedQty ?? 0) < (row.expectedQty ?? 0));
          if (!result) throw new BadRequestException('Jumlah scan produk ini sudah memenuhi kuantitas yang diharapkan.');
          if (scannedSerialId) {
            const claimed = await tx.inventorySerial.updateMany({
              where: { id: scannedSerialId, status: 'AVAILABLE' },
              data: { status: 'RESERVED', referenceType: 'Shipment', referenceId: inspection.sourceId },
            });
            if (claimed.count !== 1) throw new BadRequestException('Serial berubah status saat scan. Silakan scan ulang.');
          }
          const currentScanned = result.scannedQty ?? 0;
          const expectedQty = result.expectedQty ?? 0;
          const scanClaim = await tx.inspectionResultItem.updateMany({
            where: { id: result.id, scannedQty: currentScanned },
            data: { scannedQty: { increment: 1 }, ...(currentScanned + 1 >= expectedQty ? { result: 'PASS' } : {}) },
          });
          if (scanClaim.count !== 1) throw new BadRequestException('Jumlah scan berubah saat proses berjalan. Silakan scan ulang.');
        }
        const row = await tx.inspectionEvidence.create({ data: {
          inspectionId: id,
          evidenceType,
          storageKey,
          mimeType,
          sha256,
          latitude: dto.latitude === undefined ? undefined : new Prisma.Decimal(dto.latitude),
          longitude: dto.longitude === undefined ? undefined : new Prisma.Decimal(dto.longitude),
          capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
          capturedById: user.sub,
          metadata: metadata as Prisma.InputJsonValue,
        } });
        await tx.auditLog.create({ data: {
          companyId: scope.companyId, userId: user.sub, action: 'ADD_INSPECTION_EVIDENCE', entityType: 'OperationalInspection', entityId: id,
          payload: { branchId: scope.branchId, evidenceType, evidenceId: row.id, sha256 },
        } });
        return row;
      });
    } catch (error) {
      if (writtenPath) await unlink(writtenPath).catch(() => undefined);
      throw error;
    }
  }

  private async enforceInspectionEvidencePolicy(client: DbClient, inspection: { id: string; companyId: string; branchId: string | null; sourceType: string }) {
    const operationType = this.inspectionOperationType(inspection.sourceType);
    if (!operationType || !inspection.branchId) return;
    const policy = await client.operationPolicy.findFirst({
      where: { companyId: inspection.companyId, operationType, enabled: true, OR: [{ branchId: inspection.branchId }, { branchId: null }] },
      orderBy: [{ branchId: 'desc' }, { updatedAt: 'desc' }],
    });
    if (!policy?.requirePhoto && !policy?.requireBarcodeScan) return;
    const evidence = await client.inspectionEvidence.findMany({ where: { inspectionId: inspection.id } });
    const verified = evidence.filter((row) => {
      const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : null;
      return meta?.verifiedByServer === true;
    });
    if (policy.requirePhoto && !verified.some((row) => row.evidenceType === 'PHOTO')) {
      throw new BadRequestException('Policy mewajibkan foto evidence yang diunggah dan diverifikasi server sebelum inspeksi diselesaikan.');
    }
    if (policy.requireBarcodeScan) {
      if (!verified.some((row) => row.evidenceType === 'BARCODE')) {
        throw new BadRequestException('Policy mewajibkan hasil scan barcode sebelum inspeksi diselesaikan.');
      }
      const results = await client.inspectionResultItem.findMany({ where: { inspectionId: inspection.id, productId: { not: null } } });
      const incomplete = results.find((row) => (row.scannedQty ?? 0) < (row.expectedQty ?? 0));
      if (incomplete) throw new BadRequestException(`Scan barcode belum lengkap untuk ${incomplete.label}: ${incomplete.scannedQty ?? 0}/${incomplete.expectedQty ?? 0}.`);
    }
  }

  private async assertWarehouseSource(client: DbClient, scope: TenantScope, warehouseId: string) {
    return client.warehouse.findFirst({ where: { id: warehouseId, branchId: scope.branchId, branch: { companyId: scope.companyId } } });
  }

  private async assertSource(client: DbClient, user: AuthUser, scope: TenantScope, sourceType: string, sourceId: string) {
    let found = false;
    switch (sourceType) {
      case 'GoodsReceipt': {
        const row = await client.goodsReceipt.findUnique({ where: { id: sourceId }, select: { warehouseId: true } });
        found = Boolean(row && await this.assertWarehouseSource(client, scope, row.warehouseId)); break;
      }
      case 'PurchaseOrder': {
        const row = await client.purchaseOrder.findUnique({ where: { id: sourceId }, select: { warehouseId: true } });
        found = Boolean(row && await this.assertWarehouseSource(client, scope, row.warehouseId)); break;
      }
      case 'Sale': found = Boolean(await client.sale.findFirst({ where: { id: sourceId, branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true } })); break;
      case 'Order': found = Boolean(await client.order.findFirst({ where: { id: sourceId, branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true } })); break;
      case 'SaleReturn': {
        const row = await client.saleReturn.findUnique({ where: { id: sourceId }, select: { warehouseId: true } });
        found = Boolean(row && await this.assertWarehouseSource(client, scope, row.warehouseId)); break;
      }
      case 'PurchaseReturn': {
        const row = await client.purchaseReturn.findUnique({ where: { id: sourceId }, select: { warehouseId: true } });
        found = Boolean(row && await this.assertWarehouseSource(client, scope, row.warehouseId)); break;
      }
      case 'OrderReturn': {
        const row = await client.orderReturn.findFirst({ where: { id: sourceId, companyId: scope.companyId, branchId: scope.branchId }, select: { warehouseId: true } });
        found = Boolean(row && await this.assertWarehouseSource(client, scope, row.warehouseId)); break;
      }
      case 'Asset': found = Boolean(await client.asset.findFirst({ where: { id: sourceId, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } })); break;
      case 'MaintenanceWorkOrder': found = Boolean(await client.maintenanceWorkOrder.findFirst({ where: { id: sourceId, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } })); break;
      case 'DeliveryTrip': found = Boolean(await client.deliveryTrip.findFirst({ where: { id: sourceId, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } })); break;
      case 'DeliveryStop': {
        const row = await client.deliveryStop.findUnique({ where: { id: sourceId }, select: { tripId: true } });
        found = Boolean(row && await client.deliveryTrip.findFirst({ where: { id: row.tripId, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } })); break;
      }
      case 'FuelTransaction': found = Boolean(await client.fuelTransaction.findFirst({ where: { id: sourceId, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } })); break;
      case 'StockOpname': {
        const row = await client.stockOpname.findUnique({ where: { id: sourceId }, select: { warehouseId: true } });
        found = Boolean(row && await this.assertWarehouseSource(client, scope, row.warehouseId)); break;
      }
      case 'StockTransfer': {
        const row = await client.stockTransfer.findUnique({ where: { id: sourceId }, select: { sourceWarehouseId: true, destinationWarehouseId: true } });
        found = Boolean(row && (await this.assertWarehouseSource(client, scope, row.sourceWarehouseId) || await this.assertWarehouseSource(client, scope, row.destinationWarehouseId))); break;
      }
      case 'Shipment': {
        const row = await client.shipment.findUnique({ where: { id: sourceId }, select: { warehouseId: true } });
        found = Boolean(row && await this.assertWarehouseSource(client, scope, row.warehouseId)); break;
      }
      default: throw new BadRequestException(`sourceType ${sourceType} belum didukung untuk kontrol operasional.`);
    }
    if (!found) return this.denyTenantAccess(client, user, scope, sourceType, sourceId);
  }

  async listInspections(user: AuthUser, limitValue?: string, cursorValue?: string, status?: InspectionStatus, sourceType?: string) {
    const scope = this.requireTenantScope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ createdAt: string; id: string }>(cursorValue);
    const rows = await this.prisma.operationalInspection.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        ...(status ? { status } : {}),
        ...(sourceType ? { sourceType } : {}),
        ...(cursor ? { OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ] } : {}),
      },
      include: { results: true, evidence: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  async listGatePasses(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ createdAt: string; id: string }>(cursorValue);
    const rows = await this.prisma.gatePass.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        ...(cursor ? { OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  async listPolicies(user: AuthUser, companyId?: string, branchId?: string, operationType?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, companyId, branchId, 'OperationPolicy');
    return this.prisma.operationPolicy.findMany({
      where: { companyId: scope.companyId, ...(operationType ? { operationType } : {}), OR: [{ branchId: scope.branchId }, { branchId: null }] },
      orderBy: [{ branchId: 'desc' }, { operationType: 'asc' }, { code: 'asc' }], take: 500,
    });
  }

  async resolvePolicy(companyId: string, branchId: string | undefined, operationType: string) {
    const rows = await this.prisma.operationPolicy.findMany({
      where: { companyId, operationType, enabled: true, OR: [{ branchId }, { branchId: null }] },
      orderBy: [{ branchId: 'desc' }, { updatedAt: 'desc' }], take: 1,
    });
    return rows[0] ?? null;
  }

  async upsertPolicy(dto: UpsertOperationPolicyDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'OperationPolicy');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.operationPolicy.findFirst({ where: { companyId: scope.companyId, branchId: scope.branchId, code: dto.code } });
      const data = {
        companyId: scope.companyId, branchId: scope.branchId, code: dto.code, operationType: dto.operationType, name: dto.name,
        enabled: dto.enabled ?? true, requireInspection: dto.requireInspection ?? false, requirePhoto: dto.requirePhoto ?? false,
        requireBarcodeScan: dto.requireBarcodeScan ?? false, requireBatchScan: dto.requireBatchScan ?? false,
        requireSerialScan: dto.requireSerialScan ?? false, requireVehicle: dto.requireVehicle ?? false,
        requireGatePass: dto.requireGatePass ?? false, requireGeofence: dto.requireGeofence ?? false,
        requiredConfirmations: dto.requiredConfirmations ?? 1, blockOnMismatch: dto.blockOnMismatch ?? true,
        quantityTolerancePercent: new Prisma.Decimal(dto.quantityTolerancePercent ?? 0),
        autoPostInventory: dto.autoPostInventory ?? true, autoPostAccounting: dto.autoPostAccounting ?? true,
        autoCalculateTax: dto.autoCalculateTax ?? true, approvalPolicyCode: dto.approvalPolicyCode,
        inspectionTemplateCode: dto.inspectionTemplateCode, workflow: dto.workflow as Prisma.InputJsonValue | undefined,
      };
      const row = existing ? await tx.operationPolicy.update({ where: { id: existing.id }, data }) : await tx.operationPolicy.create({ data });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPSERT_OPERATION_POLICY', entityType: 'OperationPolicy', entityId: row.id, payload: { branchId: scope.branchId, code: row.code } } });
      return row;
    });
  }

  async createTemplate(dto: CreateInspectionTemplateDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'InspectionTemplate');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.inspectionTemplate.upsert({
        where: { companyId_code_version: { companyId: scope.companyId, code: dto.code, version: dto.version ?? 1 } },
        update: { name: dto.name, type: dto.type, appliesTo: dto.appliesTo, rules: dto.rules as Prisma.InputJsonValue | undefined,
          items: { deleteMany: {}, create: dto.items.map((item) => ({ ...item, expectedValue: item.expectedValue as Prisma.InputJsonValue | undefined })) } },
        create: { companyId: scope.companyId, code: dto.code, version: dto.version ?? 1, name: dto.name, type: dto.type,
          appliesTo: dto.appliesTo, rules: dto.rules as Prisma.InputJsonValue | undefined,
          items: { create: dto.items.map((item) => ({ ...item, expectedValue: item.expectedValue as Prisma.InputJsonValue | undefined })) } },
        include: { items: true },
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPSERT_INSPECTION_TEMPLATE', entityType: 'InspectionTemplate', entityId: row.id, payload: { code: row.code, version: row.version } } });
      return row;
    });
  }

  async createInspectionInTransaction(tx: Prisma.TransactionClient, dto: CreateInspectionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(tx, user, scope, dto.companyId, dto.branchId, 'OperationalInspection');
    await this.assertSource(tx, user, scope, dto.sourceType, dto.sourceId);
    const template = dto.templateCode ? await tx.inspectionTemplate.findFirst({
      where: { companyId: scope.companyId, code: dto.templateCode, status: 'ACTIVE' }, orderBy: { version: 'desc' }, include: { items: true },
    }) : null;
    const inspection = await tx.operationalInspection.create({ data: {
      companyId: scope.companyId, branchId: scope.branchId, number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'INSPECTION', prefix: 'INSP' }), type: dto.type,
      sourceType: dto.sourceType, sourceId: dto.sourceId, templateId: template?.id, status: 'IN_PROGRESS',
      inspectedById: user.sub, startedAt: new Date(), metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      results: template?.items.length ? { create: template.items.map((item) => ({ templateItemId: item.id, code: item.code, label: item.label, result: 'OBSERVATION', value: Prisma.JsonNull })) } : undefined,
    }, include: { results: true, evidence: true } });
    await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_OPERATIONAL_INSPECTION', entityType: 'OperationalInspection', entityId: inspection.id, payload: { branchId: scope.branchId, sourceType: dto.sourceType, sourceId: dto.sourceId } } });
    return inspection;
  }

  async createInspection(dto: CreateInspectionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'OperationalInspection');
    await this.assertSource(this.prisma, user, scope, dto.sourceType, dto.sourceId);
    return this.prisma.$transaction((tx) => this.createInspectionInTransaction(tx, dto, user));
  }

  async completeInspection(id: string, dto: CompleteInspectionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const inspection = await this.scopedInspection(this.prisma, user, scope, id);
    if (['APPROVED','REJECTED','CANCELLED'].includes(inspection.status)) throw new BadRequestException(`Pemeriksaan sudah ${inspection.status}.`);
    await this.enforceInspectionEvidencePolicy(this.prisma, inspection);
    const persistedResults = await this.prisma.inspectionResultItem.findMany({ where: { inspectionId: id } });
    const serverScanByCode = new Map(persistedResults.map((row) => [row.code, row.scannedQty]));
    const templateIds = [...new Set(dto.results.map((row) => row.templateItemId).filter(Boolean) as string[])];
    if (templateIds.length) {
      const count = await this.prisma.inspectionTemplateItem.count({ where: { id: { in: templateIds }, ...(inspection.templateId ? { templateId: inspection.templateId } : { id: '__NO_TEMPLATE__' }) } });
      if (count !== templateIds.length) return this.denyTenantAccess(this.prisma, user, scope, 'InspectionTemplateItem');
    }
    const templateItems = inspection.templateId
      ? await this.prisma.inspectionTemplateItem.findMany({ where: { templateId: inspection.templateId } })
      : [];
    const templateById = new Map(templateItems.map((item) => [item.id, item]));
    // Compatibility: old in-progress Goods Receipts created before checklist materialization had no template result rows.
    // New inspections always persist template rows, so once present the required checklist cannot be omitted by the client.
    const persistedTemplateResultIds = new Set(persistedResults.map((row) => row.templateItemId).filter(Boolean) as string[]);
    if (persistedTemplateResultIds.size > 0) {
      for (const item of templateItems.filter((row) => row.required)) {
        const submitted = dto.results.find((row) => row.templateItemId === item.id);
        if (!submitted) throw new BadRequestException(`Checklist wajib ${item.label} tidak boleh dihilangkan.`);
        if (!['PASS','FAIL'].includes(submitted.result)) {
          throw new BadRequestException(`Checklist wajib ${item.label} harus diputuskan PASS atau FAIL sebelum inspeksi diselesaikan.`);
        }
      }
    }
    if (inspection.sourceType === 'GoodsReceipt') {
      const receipt = await this.prisma.goodsReceipt.findFirst({
        where: {
          id: inspection.sourceId,
          warehouse: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
          supplier: { companyId: scope.companyId },
          items: { every: { product: { companyId: scope.companyId } } },
        },
        include: { items: true },
      });
      if (!receipt) return this.denyTenantAccess(this.prisma, user, scope, 'GoodsReceipt', inspection.sourceId);
      const expectedByProduct = new Map<string, { received: number; accepted: number; damaged: number }>();
      for (const item of receipt.items) {
        const current = expectedByProduct.get(item.productId) ?? { received: 0, accepted: 0, damaged: 0 };
        current.received += item.quantityReceived;
        current.accepted += item.acceptedQty;
        current.damaged += item.quantityDamaged;
        expectedByProduct.set(item.productId, current);
      }
      const resultByProduct = new Map<string, { received: number; accepted: number; damaged: number }>();
      for (const result of dto.results.filter((row) => row.productId)) {
        if (!expectedByProduct.has(result.productId!)) {
          throw new BadRequestException(`Produk inspeksi ${result.productId} tidak termasuk dalam penerimaan barang.`);
        }
        const accepted = result.acceptedQty ?? 0;
        const rejected = result.rejectedQty ?? 0;
        const damaged = result.damagedQty ?? rejected;
        if (accepted < 0 || rejected < 0 || damaged < 0) throw new BadRequestException('Kuantitas hasil inspeksi tidak boleh negatif.');
        const current = resultByProduct.get(result.productId!) ?? { received: 0, accepted: 0, damaged: 0 };
        current.received += accepted + rejected;
        current.accepted += accepted;
        current.damaged += damaged;
        resultByProduct.set(result.productId!, current);
      }
      for (const [productId, expected] of expectedByProduct) {
        const actual = resultByProduct.get(productId);
        if (!actual || actual.received !== expected.received || actual.accepted !== expected.accepted || actual.damaged !== expected.damaged) {
          throw new BadRequestException(`Hasil inspeksi produk ${productId} tidak sesuai dengan kuantitas Goods Receipt.`);
        }
      }
    }
    if (inspection.sourceType === 'OrderReturn') {
      const orderReturn = await this.prisma.orderReturn.findFirst({
        where: { id: inspection.sourceId, companyId: scope.companyId, branchId: scope.branchId },
        include: { items: true },
      });
      if (!orderReturn) return this.denyTenantAccess(this.prisma, user, scope, 'OrderReturn', inspection.sourceId);
      const expectedByCode = new Map(orderReturn.items.map((item) => [`ORDER_RETURN_ITEM:${item.id}`, item.quantity]));
      for (const [code, expected] of expectedByCode) {
        const result = dto.results.find((row) => row.code === code);
        if (!result) throw new BadRequestException(`Hasil inspeksi ${code} wajib diisi.`);
        const accepted = result.acceptedQty ?? 0;
        const rejected = result.rejectedQty ?? 0;
        const damaged = result.damagedQty ?? 0;
        const missing = result.missingQty ?? 0;
        const extra = result.extraQty ?? 0;
        if ((result.expectedQty ?? expected) !== expected || accepted < 0 || rejected < 0 || damaged < 0 || missing < 0 || extra < 0) {
          throw new BadRequestException(`Kuantitas inspeksi ${code} tidak valid.`);
        }
        if (accepted + rejected !== expected || missing !== 0 || extra !== 0 || damaged > accepted) {
          throw new BadRequestException(`Hasil inspeksi ${code} harus mencakup tepat ${expected} unit tanpa kuantitas hilang/lebih.`);
        }
        if (result.result === 'OBSERVATION' || result.result === 'NOT_APPLICABLE') {
          throw new BadRequestException(`Hasil inspeksi ${code} harus diputuskan PASS atau FAIL.`);
        }
      }
    }
    if (inspection.sourceType === 'Shipment') {
      const shipment = await this.prisma.shipment.findUnique({
        where: { id: inspection.sourceId },
        select: { id: true, orderId: true, warehouseId: true },
      });
      if (!shipment?.orderId || !(await this.assertWarehouseSource(this.prisma, scope, shipment.warehouseId))) {
        return this.denyTenantAccess(this.prisma, user, scope, 'Shipment', inspection.sourceId);
      }
      const order = await this.prisma.order.findFirst({
        where: { id: shipment.orderId, branchId: scope.branchId, branch: { companyId: scope.companyId } },
        include: { items: true },
      });
      if (!order) return this.denyTenantAccess(this.prisma, user, scope, 'Order', shipment.orderId);
      const expectedByProduct = new Map<string, number>();
      for (const item of order.items) expectedByProduct.set(item.productId, (expectedByProduct.get(item.productId) ?? 0) + item.quantity);
      const productResults = dto.results.filter((row) => row.productId);
      const submittedByProduct = new Map<string, number>();
      for (const result of productResults) {
        if (!expectedByProduct.has(result.productId!)) throw new BadRequestException(`Produk inspeksi ${result.productId} tidak termasuk shipment.`);
        const expected = result.expectedQty ?? 0;
        const accepted = result.acceptedQty ?? expected;
        const rejected = result.rejectedQty ?? 0;
        const damaged = result.damagedQty ?? 0;
        const missing = result.missingQty ?? 0;
        const extra = result.extraQty ?? 0;
        if (accepted !== expected || rejected !== 0 || damaged !== 0 || missing !== 0 || extra !== 0 || result.result !== 'PASS') {
          throw new BadRequestException(`Shipment saat ini hanya mendukung fulfillment penuh; hasil inspeksi ${result.productId} harus PASS tanpa mismatch.`);
        }
        submittedByProduct.set(result.productId!, (submittedByProduct.get(result.productId!) ?? 0) + expected);
      }
      for (const [productId, expected] of expectedByProduct) {
        if (submittedByProduct.get(productId) !== expected) throw new BadRequestException(`Manifest inspeksi produk ${productId} tidak sesuai dengan order.`);
      }
    }
    const failedRows = dto.results.filter((result) => result.result === 'FAIL');
    const failed = failedRows.length;
    const blockingFailures = failedRows.filter((result) => !result.templateItemId || templateById.get(result.templateItemId)?.failureSeverity === 'BLOCKING').length;
    const warningFailures = failed - blockingFailures;
    const mismatch = dto.results.filter((result) => (result.missingQty ?? 0) > 0 || (result.extraQty ?? 0) > 0 || (result.damagedQty ?? 0) > 0).length;
    const status: InspectionStatus = blockingFailures > 0 ? 'FAILED' : mismatch > 0 ? 'PARTIAL' : warningFailures > 0 ? 'REVIEW_REQUIRED' : 'PASSED';
    return this.prisma.$transaction(async (tx) => {
      await tx.inspectionResultItem.deleteMany({ where: { inspectionId: id } });
      if (dto.results.length) await tx.inspectionResultItem.createMany({ data: dto.results.map((result) => ({
        inspectionId: id, templateItemId: result.templateItemId, code: result.code, label: result.label,
        result: result.result, value: result.value as Prisma.InputJsonValue | undefined, productId: result.productId,
        expectedQty: result.expectedQty, scannedQty: serverScanByCode.get(result.code) ?? result.scannedQty, acceptedQty: result.acceptedQty,
        rejectedQty: result.rejectedQty, damagedQty: result.damagedQty, missingQty: result.missingQty, extraQty: result.extraQty, notes: result.notes,
      })) });
      if (dto.evidence?.length) await tx.inspectionEvidence.createMany({ data: dto.evidence.map((item) => ({
        inspectionId: id, evidenceType: item.evidenceType, storageKey: item.storageKey, mimeType: item.mimeType,
        sha256: item.sha256, latitude: item.latitude === undefined ? undefined : new Prisma.Decimal(item.latitude),
        longitude: item.longitude === undefined ? undefined : new Prisma.Decimal(item.longitude), capturedAt: new Date(), capturedById: user.sub,
        metadata: { ...((item.metadata ?? {}) as Record<string, unknown>), legacyUnverified: true } as Prisma.InputJsonValue,
      })) });
      const row = await tx.operationalInspection.update({ where: { id }, data: {
        status, completedAt: new Date(), inspectedById: user.sub, mismatchCount: mismatch, blockingFailureCount: blockingFailures,
        summary: { notes: dto.notes, failed, blockingFailures, warningFailures, mismatch },
      }, include: { results: true, evidence: true } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'COMPLETE_OPERATIONAL_INSPECTION', entityType: 'OperationalInspection', entityId: id, payload: { branchId: scope.branchId, status, failed, blockingFailures, warningFailures, mismatch } } });
      await tx.eventOutbox.create({ data: {
        companyId: scope.companyId,
        eventType: 'inspection.completed',
        aggregateType: inspection.sourceType,
        aggregateId: inspection.sourceId,
        payload: {
          companyId: scope.companyId, branchId: scope.branchId, inspectionId: row.id,
          sourceType: inspection.sourceType, sourceId: inspection.sourceId,
          type: inspection.type, status, mismatchCount: mismatch,
          blockingFailureCount: blockingFailures, warningFailureCount: warningFailures,
        },
      } });
      return row;
    });
  }

  async approveInspection(id: string, dto: ApproveInspectionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const inspection = await this.scopedInspection(this.prisma, user, scope, id);
    if (!['PASSED','PARTIAL','FAILED','REVIEW_REQUIRED'].includes(inspection.status)) throw new BadRequestException('Pemeriksaan belum selesai.');
    return this.prisma.$transaction(async (tx) => {
      const status = inspection.status === 'FAILED' ? 'REJECTED' : 'APPROVED';
      const row = await tx.operationalInspection.update({ where: { id }, data: {
        status, reviewedById: user.sub, approvedAt: status === 'APPROVED' ? new Date() : undefined,
        summary: { ...((inspection.summary as Record<string, unknown> | null) ?? {}), approvalNotes: dto.notes },
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'APPROVE_OPERATIONAL_INSPECTION', entityType: 'OperationalInspection', entityId: id, payload: { branchId: scope.branchId, status } } });
      return row;
    });
  }

  async createGatePass(dto: CreateGatePassDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'GatePass');
    await this.assertSource(this.prisma, user, scope, dto.sourceType, dto.sourceId);
    if (dto.vehicleId && !await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, companyId: scope.companyId, branchId: scope.branchId } })) {
      return this.denyTenantAccess(this.prisma, user, scope, 'Vehicle', dto.vehicleId);
    }
    if (dto.driverEmployeeId && !await this.prisma.employee.findFirst({ where: { id: dto.driverEmployeeId, companyId: scope.companyId, branchId: scope.branchId, isActive: true } })) {
      return this.denyTenantAccess(this.prisma, user, scope, 'Employee', dto.driverEmployeeId);
    }
    if (dto.inspectionId) {
      const inspection = await this.scopedInspection(this.prisma, user, scope, dto.inspectionId);
      if (inspection.sourceType !== dto.sourceType || inspection.sourceId !== dto.sourceId) throw new BadRequestException('Pemeriksaan tidak terkait dengan sumber gate pass.');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.gatePass.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: dto.direction === 'INBOUND' ? 'GATE_PASS_IN' : 'GATE_PASS_OUT', prefix: dto.direction === 'INBOUND' ? 'GP-IN' : 'GP-OUT' }),
        direction: dto.direction, sourceType: dto.sourceType, sourceId: dto.sourceId, vehicleId: dto.vehicleId,
        plateNumber: dto.plateNumber, driverName: dto.driverName, driverEmployeeId: dto.driverEmployeeId,
        inspectionId: dto.inspectionId, documents: dto.documents as Prisma.InputJsonValue | undefined,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_GATE_PASS', entityType: 'GatePass', entityId: row.id, payload: { branchId: scope.branchId, sourceType: dto.sourceType, sourceId: dto.sourceId } } });
      return row;
    });
  }

  async approveGatePass(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const pass = await this.scopedGatePass(this.prisma, user, scope, id);
    if (pass.inspectionId) {
      const inspection = await this.scopedInspection(this.prisma, user, scope, pass.inspectionId);
      if (!['PASSED','APPROVED','PARTIAL'].includes(inspection.status)) throw new BadRequestException('Pemeriksaan gate pass belum memenuhi syarat.');
      if (inspection.sourceType !== pass.sourceType || inspection.sourceId !== pass.sourceId) throw new BadRequestException('Pemeriksaan tidak terkait dengan sumber gate pass.');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.gatePass.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date(), checkedById: user.sub, checkedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'APPROVE_GATE_PASS', entityType: 'GatePass', entityId: id, payload: { branchId: scope.branchId } } });
      return row;
    });
  }

  async recordGateMovement(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const pass = await this.scopedGatePass(this.prisma, user, scope, id);
    if (pass.status !== 'APPROVED') throw new BadRequestException('Gate pass belum disetujui.');
    return this.prisma.$transaction(async (tx) => {
      const status = pass.direction === 'INBOUND' ? 'ENTERED' : 'EXITED';
      const row = await tx.gatePass.update({ where: { id }, data: { status, movementAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RECORD_GATE_MOVEMENT', entityType: 'GatePass', entityId: id, payload: { branchId: scope.branchId, status } } });
      return row;
    });
  }

  async confirmOperation(dto: ConfirmOperationDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'OperationalConfirmation');
    await this.assertSource(this.prisma, user, scope, dto.sourceType, dto.sourceId);
    if (dto.inspectionId) {
      const inspection = await this.scopedInspection(this.prisma, user, scope, dto.inspectionId);
      if (!['PASSED','PARTIAL','APPROVED'].includes(inspection.status)) throw new BadRequestException('Pemeriksaan belum lulus atau disetujui.');
      if (inspection.sourceType !== dto.sourceType || inspection.sourceId !== dto.sourceId) throw new BadRequestException('Pemeriksaan tidak terkait dengan sumber konfirmasi.');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.operationalConfirmation.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, sourceType: dto.sourceType, sourceId: dto.sourceId,
        confirmationType: dto.confirmationType, status: 'APPROVED', requestedById: user.sub, confirmedById: user.sub,
        inspectionId: dto.inspectionId, decision: dto.decision as Prisma.InputJsonValue | undefined, confirmedAt: new Date(),
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CONFIRM_OPERATION', entityType: 'OperationalConfirmation', entityId: row.id, payload: { branchId: scope.branchId, sourceType: dto.sourceType, sourceId: dto.sourceId } } });
      return row;
    });
  }
}
