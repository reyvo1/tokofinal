import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { parseBusinessDateBoundary } from '../common/business-time';
import { nextDocumentNumber } from '../common/numbering';
import { consumeAvailableLocationStock } from '../common/location-inventory';
import { PrismaService } from '../prisma/prisma.service';
import { AssignAssetDto, CompleteMaintenanceDto, CreateAssetCategoryDto, CreateAssetDto, CreateAssetMaintenancePlanDto, CreateMaintenanceWorkOrderDto, DisposeAssetDto, RunDepreciationDto, TransferAssetDto, UpdateAssetMaintenancePlanDto } from './dto/assets.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingCoreService) {}

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
    entityType = 'Asset',
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

  private async scopedAsset(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.asset.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Asset', id);
    return row;
  }

  private async scopedWorkOrder(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.maintenanceWorkOrder.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'MaintenanceWorkOrder', id);
    return row;
  }

  private async assertWarehouse(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.warehouse.findFirst({
      where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Warehouse', id);
    return row;
  }

  private async assertEmployee(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.employee.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId, isActive: true },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Employee', id);
    return row;
  }

  private async assertVehicle(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.vehicle.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Vehicle', id);
    return row;
  }


  private async companyTimeZone(client: DbClient, companyId: string): Promise<string> {
    const company = await client.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new BadRequestException({ code: 'COMPANY_NOT_FOUND', message: 'Company aset tidak ditemukan.' });
    return company.timezone;
  }

  private parseBusinessDate(value: string | undefined, timeZone: string, endOfDay = false) {
    return parseBusinessDateBoundary(value, new Date(), timeZone, endOfDay);
  }

  private countCalendarMonths(start: Date, end: Date, capitalizationDate: Date) {
    const first = new Date(Math.max(start.getTime(), capitalizationDate.getTime()));
    if (first > end) return 0;
    return (end.getFullYear() - first.getFullYear()) * 12 + (end.getMonth() - first.getMonth()) + 1;
  }

  private async assertSupplier(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.supplier.findFirst({ where: { id, companyId: scope.companyId } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Supplier', id);
    return row;
  }

  private async assertAssetOperationallyFree(client: DbClient, assetId: string) {
    const [openMaintenance, linkedVehicle] = await Promise.all([
      client.maintenanceWorkOrder.findFirst({ where: { assetId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_PART'] } }, select: { id: true, number: true } }),
      client.vehicle.findFirst({ where: { assetId }, select: { id: true, status: true } }),
    ]);
    if (openMaintenance) throw new BadRequestException(`Aset masih memiliki maintenance aktif ${openMaintenance.number}.`);
    if (linkedVehicle && ['ASSIGNED', 'ON_TRIP'].includes(linkedVehicle.status)) {
      throw new BadRequestException('Aset kendaraan sedang digunakan dalam operasi armada.');
    }
  }
  private async assertInspection(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    id?: string | null,
    sourceType?: string,
    sourceId?: string,
  ) {
    if (!id) return undefined;
    const row = await client.operationalInspection.findFirst({
      where: {
        id,
        companyId: scope.companyId,
        branchId: scope.branchId,
        ...(sourceType ? { sourceType } : {}),
        ...(sourceId ? { sourceId } : {}),
      },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'OperationalInspection', id);
    return row;
  }

  async list(user: AuthUser, requestedCompanyId?: string, requestedBranchId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId);
    return this.prisma.asset.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
      take: 500,
    });
  }

  async categories(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'AssetCategory');
    return this.prisma.assetCategory.findMany({
      where: { companyId: scope.companyId, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createCategory(dto: CreateAssetCategoryDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'AssetCategory');
    if (dto.defaultInspectionTemplateId) {
      const template = await this.prisma.inspectionTemplate.findFirst({
        where: { id: dto.defaultInspectionTemplateId, companyId: scope.companyId },
      });
      if (!template) {
        await this.denyTenantAccess(this.prisma, user, scope, 'InspectionTemplate', dto.defaultInspectionTemplateId);
      }
    }
    const data = {
      companyId: scope.companyId,
      code: dto.code,
      name: dto.name,
      assetType: dto.assetType as never,
      depreciationMethod: dto.depreciationMethod ?? 'STRAIGHT_LINE',
      usefulLifeMonths: dto.usefulLifeMonths,
      residualValuePercent: new Prisma.Decimal(dto.residualValuePercent ?? 0),
      assetAccountCode: dto.assetAccountCode,
      accumulatedDepreciationCode: dto.accumulatedDepreciationCode,
      depreciationExpenseCode: dto.depreciationExpenseCode,
      maintenanceExpenseCode: dto.maintenanceExpenseCode,
      defaultInspectionTemplateId: dto.defaultInspectionTemplateId,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    };
    const row = await this.prisma.assetCategory.upsert({
      where: { companyId_code: { companyId: scope.companyId, code: dto.code } },
      create: data,
      update: data,
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'UPSERT_ASSET_CATEGORY',
        entityType: 'AssetCategory',
        entityId: row.id,
        payload: { branchId: scope.branchId, code: row.code },
      },
    });
    return row;
  }

  async acquire(dto: CreateAssetDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId);
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.assetCategory.findFirst({
        where: { id: dto.categoryId, companyId: scope.companyId, isActive: true },
      });
      if (!category) return this.denyTenantAccess(tx, user, scope, 'AssetCategory', dto.categoryId);
      await this.assertWarehouse(tx, user, scope, dto.warehouseId);
      await this.assertEmployee(tx, user, scope, dto.assignedEmployeeId);
      await this.assertSupplier(tx, user, scope, dto.supplierId);
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const acquisitionDate = this.parseBusinessDate(dto.acquisitionDate, timeZone);
      const tax = await this.accounting.calculateTax(tx, dto.taxCodeId, dto.acquisitionCost, scope.companyId, acquisitionDate, ['ASSET', 'PURCHASE', 'OTHER']);
      const usefulLife = dto.usefulLifeMonths ?? category.usefulLifeMonths;
      const residual = new Prisma.Decimal(dto.residualValue ?? 0);
      const paymentMode = (dto.paymentMode ?? 'CREDIT').toUpperCase();
      if (!['CASH', 'BANK', 'CREDIT'].includes(paymentMode)) throw new BadRequestException('Payment mode aset hanya CASH, BANK, atau CREDIT.');
      if (paymentMode === 'CREDIT' && !dto.supplierId) throw new BadRequestException('Akuisisi aset kredit wajib memiliki supplier agar utang dapat direkonsiliasi.');
      const asset = await tx.asset.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        warehouseId: dto.warehouseId,
        categoryId: category.id,
        code: dto.code,
        name: dto.name,
        assetType: category.assetType,
        status: 'ACTIVE',
        serialNumber: dto.serialNumber,
        registrationNumber: dto.registrationNumber,
        acquisitionDate,
        capitalizationDate: acquisitionDate,
        acquisitionCost: tax.net,
        residualValue: residual,
        bookValue: tax.net,
        usefulLifeMonths: usefulLife,
        depreciationMethod: category.depreciationMethod,
        locationName: dto.locationName,
        latitude: dto.latitude === undefined ? undefined : new Prisma.Decimal(dto.latitude),
        longitude: dto.longitude === undefined ? undefined : new Prisma.Decimal(dto.longitude),
        assignedEmployeeId: dto.assignedEmployeeId,
        supplierId: dto.supplierId,
        taxCodeId: dto.taxCodeId,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      } });
      const eventType = paymentMode === 'CREDIT' ? 'ASSET_ACQUISITION_CREDIT' : 'ASSET_ACQUISITION_CASH';
      const paymentAccount = paymentMode === 'CASH' ? '1101' : paymentMode === 'BANK' ? '1102' : '2101';
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        eventType,
        sourceType: 'Asset',
        sourceId: asset.id,
        idempotencyKey: `asset-acquire:${asset.id}`,
        businessDate: acquisitionDate,
        amounts: { asset: tax.net, inputTax: tax.tax, gross: tax.gross, settlement: tax.gross },
        accountCodes: {
          asset: category.assetAccountCode ?? '1401',
          settlement: paymentAccount,
          inputTax: tax.taxCode?.receivableAccountCode ?? '1205',
        },
        lines: [{
          itemType: 'Asset', itemId: asset.id, description: asset.name, quantity: 1,
          netAmount: tax.net, taxAmount: tax.tax, grossAmount: tax.gross, taxCodeId: dto.taxCodeId,
        }],
        taxLines: tax.taxCode && tax.tax.greaterThan(0) ? [{
          taxCodeId: tax.taxCode.id,
          direction: 'INPUT',
          taxableBase: tax.net,
          taxAmount: tax.tax,
          counterpartyType: 'SUPPLIER',
          counterpartyId: dto.supplierId,
        }] : [],
        context: { categoryCode: category.code, paymentMode },
      });
      await tx.assetTransaction.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        assetId: asset.id,
        type: 'ACQUISITION',
        amount: tax.net,
        bookValueAfter: tax.net,
        sourceType: 'Asset',
        sourceId: asset.id,
        accountingEventId: event.id,
        journalEntryId: event.journalEntryId,
        metadata: { gross: tax.gross, tax: tax.tax },
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'ASSET_ACQUIRED',
        entityType: 'Asset',
        entityId: asset.id,
        payload: { branchId: scope.branchId, categoryId: category.id, warehouseId: dto.warehouseId },
      } });
      return tx.asset.findUniqueOrThrow({ where: { id: asset.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async assign(assetId: string, dto: AssignAssetDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'AssetAssignment');
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.scopedAsset(tx, user, scope, assetId);
      await this.assertEmployee(tx, user, scope, dto.employeeId);
      await this.assertWarehouse(tx, user, scope, dto.warehouseId);
      await this.assertInspection(tx, user, scope, dto.handoverInspectionId, 'Asset', asset.id);
      await tx.assetAssignment.updateMany({
        where: { assetId: asset.id, companyId: scope.companyId, returnedAt: null },
        data: { returnedAt: new Date() },
      });
      const assignment = await tx.assetAssignment.create({ data: {
        companyId: scope.companyId,
        assetId: asset.id,
        employeeId: dto.employeeId,
        branchId: scope.branchId,
        warehouseId: dto.warehouseId,
        handoverInspectionId: dto.handoverInspectionId,
        conditionAtIssue: dto.conditionAtIssue as Prisma.InputJsonValue | undefined,
        notes: dto.notes,
      } });
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          assignedEmployeeId: dto.employeeId,
          branchId: scope.branchId,
          warehouseId: dto.warehouseId ?? asset.warehouseId,
        },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'ASSIGN_ASSET',
        entityType: 'AssetAssignment',
        entityId: assignment.id,
        payload: { assetId: asset.id, employeeId: dto.employeeId, branchId: scope.branchId },
      } });
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createMaintenance(dto: CreateMaintenanceWorkOrderDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'MaintenanceWorkOrder');
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.scopedAsset(tx, user, scope, dto.assetId);
      const vehicle = await this.assertVehicle(tx, user, scope, dto.vehicleId);
      if (vehicle?.assetId && vehicle.assetId !== asset.id) throw new BadRequestException('Kendaraan maintenance tidak terhubung ke aset yang dipilih.');
      await this.assertSupplier(tx, user, scope, dto.supplierId);
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const scheduledAt = dto.scheduledAt ? this.parseBusinessDate(dto.scheduledAt, timeZone) : new Date();
      if (dto.taxCodeId) await this.accounting.calculateTax(tx, dto.taxCodeId, 0, scope.companyId, scheduledAt, ['EXPENSE', 'ASSET', 'OTHER']);
      const row = await tx.maintenanceWorkOrder.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'MAINTENANCE_WORK_ORDER', prefix: 'MWO' }),
        assetId: asset.id,
        vehicleId: dto.vehicleId,
        maintenanceType: dto.maintenanceType,
        priority: dto.priority ?? 'NORMAL',
        scheduledAt: dto.scheduledAt ? scheduledAt : undefined,
        estimatedCost: new Prisma.Decimal(dto.estimatedCost ?? 0),
        vendorId: dto.supplierId,
        taxCodeId: dto.taxCodeId,
        notes: dto.notes,
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'CREATE_MAINTENANCE_WORK_ORDER',
        entityType: 'MaintenanceWorkOrder',
        entityId: row.id,
        payload: { assetId: asset.id, vehicleId: dto.vehicleId, branchId: scope.branchId },
      } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async completeMaintenance(id: string, dto: CompleteMaintenanceDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const work = await this.scopedWorkOrder(tx, user, scope, id);
      if (work.status === 'COMPLETED') return work;
      if (work.status === 'CANCELLED') throw new BadRequestException('Maintenance yang dibatalkan tidak dapat diselesaikan.');
      const asset = await this.scopedAsset(tx, user, scope, work.assetId);
      const category = await tx.assetCategory.findFirst({ where: { id: asset.categoryId, companyId: scope.companyId } });
      if (!category) return this.denyTenantAccess(tx, user, scope, 'AssetCategory', asset.categoryId);
      const inspectionId = dto.inspectionId ?? work.inspectionId;
      const inspection = await this.assertInspection(tx, user, scope, inspectionId, 'MaintenanceWorkOrder', work.id);
      if (inspection && !['PASSED', 'APPROVED'].includes(inspection.status)) {
        throw new BadRequestException('Inspeksi maintenance belum lulus untuk penyelesaian work order.');
      }
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const completedAt = this.parseBusinessDate(dto.completedAt, timeZone);
      const paymentMode = (dto.paymentMode ?? 'CASH').toUpperCase();
      if (!['CASH', 'BANK', 'CREDIT'].includes(paymentMode)) throw new BadRequestException('Payment mode maintenance hanya CASH, BANK, atau CREDIT.');
      if (paymentMode === 'CREDIT' && !work.vendorId) throw new BadRequestException('Maintenance kredit wajib memiliki supplier pada work order agar utang dapat direkonsiliasi.');
      const taxCodeId = dto.taxCodeId ?? work.taxCodeId ?? undefined;
      const tax = await this.accounting.calculateTax(tx, taxCodeId, dto.actualCost, scope.companyId, completedAt, ['EXPENSE', 'ASSET', 'OTHER']);

      if (work.vehicleId && dto.odometer !== undefined) {
        const vehicle = await this.assertVehicle(tx, user, scope, work.vehicleId);
        if (vehicle && dto.odometer < vehicle.currentOdometer) throw new BadRequestException('Odometer maintenance tidak boleh lebih kecil dari odometer kendaraan saat ini.');
      }

      let partsCost = new Prisma.Decimal(0);
      const partDetails: Prisma.InputJsonObject[] = [];
      for (const part of dto.parts ?? []) {
        await this.assertWarehouse(tx, user, scope, part.warehouseId);
        const product = await tx.product.findFirst({ where: { id: part.productId, companyId: scope.companyId, isActive: true } });
        if (!product) return this.denyTenantAccess(tx, user, scope, 'Product', part.productId);
        const serialIds = [...new Set((part.serialIds ?? []).map((value) => value.trim()).filter(Boolean))];
        if (product.trackSerial && serialIds.length !== part.quantity) throw new BadRequestException(`Part ${product.sku} memakai serial; serialIds unik wajib berjumlah sama dengan quantity.`);
        if (!product.trackSerial && serialIds.length) throw new BadRequestException(`Part ${product.sku} tidak memakai serial; serialIds tidak boleh dikirim.`);
        if (product.trackBatch && !part.batchId) throw new BadRequestException(`Part ${product.sku} wajib memilih batch.`);
        const inventory = await tx.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: part.warehouseId, productId: part.productId } } });
        if (!inventory || inventory.available < part.quantity || inventory.quantity < part.quantity) {
          throw new BadRequestException(`Stok part ${product.sku} tidak mencukupi untuk maintenance.`);
        }
        if (product.trackSerial) {
          const serials = await tx.inventorySerial.findMany({ where: { id: { in: serialIds }, warehouseId: part.warehouseId, productId: part.productId, status: 'AVAILABLE' } });
          if (serials.length !== part.quantity) throw new BadRequestException(`Serial part ${product.sku} tidak lengkap, tidak tersedia, atau tidak berada pada gudang yang dipilih.`);
          const serialUpdate = await tx.inventorySerial.updateMany({
            where: { id: { in: serialIds }, warehouseId: part.warehouseId, productId: part.productId, status: 'AVAILABLE' },
            data: { status: 'CONSUMED' as never, referenceType: 'MaintenanceWorkOrder', referenceId: work.id },
          });
          if (serialUpdate.count !== part.quantity) throw new BadRequestException(`Status serial part ${product.sku} berubah; ulangi transaksi maintenance.`);
        }
        if (part.batchId) {
          const batch = await tx.inventoryBatch.findUnique({ where: { id: part.batchId } });
          if (!batch || batch.warehouseId !== part.warehouseId || batch.productId !== part.productId) {
            return this.denyTenantAccess(tx, user, scope, 'InventoryBatch', part.batchId);
          }
          if (batch.quantity - batch.reserved < part.quantity) throw new BadRequestException(`Stok batch part ${product.sku} tidak mencukupi.`);
          const batchUpdate = await tx.inventoryBatch.updateMany({
            where: { id: batch.id, quantity: { gte: batch.reserved + part.quantity } },
            data: { quantity: { decrement: part.quantity } },
          });
          if (batchUpdate.count !== 1) throw new BadRequestException(`Stok batch part ${product.sku} berubah; ulangi transaksi.`);
        }
        const allocations = await consumeAvailableLocationStock(tx, { warehouseId: part.warehouseId, productId: part.productId, quantity: part.quantity });
        const stockUpdate = await tx.inventory.updateMany({
          where: { id: inventory.id, quantity: { gte: part.quantity }, available: { gte: part.quantity } },
          data: { quantity: { decrement: part.quantity }, available: { decrement: part.quantity } },
        });
        if (stockUpdate.count !== 1) throw new BadRequestException(`Stok part ${product.sku} berubah; ulangi transaksi.`);
        const updatedInventory = await tx.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
        const lineCost = new Prisma.Decimal(product.costPrice).mul(part.quantity).toDecimalPlaces(2);
        partsCost = partsCost.add(lineCost);
        for (const allocation of allocations) await tx.inventoryMovement.create({ data: {
          warehouseId: part.warehouseId,
          productId: part.productId,
          locationId: allocation.locationId,
          type: 'ADJUSTMENT_OUT',
          quantity: -allocation.quantity,
          balanceAfter: updatedInventory.quantity,
          referenceType: 'MaintenanceWorkOrder',
          referenceId: work.id,
          notes: `MAINTENANCE_PART:${work.number}`,
          createdAt: completedAt,
        } });
        partDetails.push({ productId: part.productId, sku: product.sku, warehouseId: part.warehouseId, batchId: part.batchId ?? null, serialIds, quantity: part.quantity, unitCost: product.costPrice.toString(), totalCost: lineCost.toString() });
      }

      let externalEvent: Awaited<ReturnType<AccountingCoreService['postOperationalEvent']>> | undefined;
      if (tax.gross.greaterThan(0)) {
        externalEvent = await this.accounting.postOperationalEvent(tx, {
          companyId: scope.companyId,
          branchId: scope.branchId,
          eventType: paymentMode === 'CREDIT' ? 'ASSET_MAINTENANCE_CREDIT' : 'ASSET_MAINTENANCE_CASH',
          sourceType: 'MaintenanceWorkOrder',
          sourceId: work.id,
          idempotencyKey: `maintenance-complete:${work.id}`,
          businessDate: completedAt,
          amounts: { expense: tax.net, inputTax: tax.tax, gross: tax.gross, settlement: tax.gross },
          accountCodes: {
            expense: category.maintenanceExpenseCode ?? '5203',
            inputTax: tax.taxCode?.receivableAccountCode ?? '1205',
            settlement: paymentMode === 'CASH' ? '1101' : paymentMode === 'BANK' ? '1102' : '2101',
          },
          taxLines: tax.taxCode && tax.tax.greaterThan(0) ? [{ taxCodeId: tax.taxCode.id, direction: 'INPUT', taxableBase: tax.net, taxAmount: tax.tax }] : [],
          context: { assetId: asset.id, vehicleId: work.vehicleId, odometer: dto.odometer, paymentMode },
        });
      }
      let partsEvent: Awaited<ReturnType<AccountingCoreService['postOperationalEvent']>> | undefined;
      if (partsCost.greaterThan(0)) {
        partsEvent = await this.accounting.postOperationalEvent(tx, {
          companyId: scope.companyId,
          branchId: scope.branchId,
          eventType: 'ASSET_MAINTENANCE_PARTS',
          sourceType: 'MaintenanceWorkOrderParts',
          sourceId: work.id,
          idempotencyKey: `maintenance-parts:${work.id}`,
          businessDate: completedAt,
          amounts: { gross: partsCost },
          accountCodes: { debit: category.maintenanceExpenseCode ?? '5203', credit: '1301' },
          context: { assetId: asset.id, vehicleId: work.vehicleId, parts: partDetails },
        });
      }
      if (!externalEvent && !partsEvent) throw new BadRequestException('Maintenance tanpa biaya atau pemakaian part tidak dapat diposting sebagai COMPLETED.');
      const primaryEvent = externalEvent ?? partsEvent!;
      const maintenanceAmount = tax.net.add(partsCost);
      await tx.assetTransaction.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        assetId: asset.id,
        type: 'MAINTENANCE',
        transactionDate: completedAt,
        amount: maintenanceAmount,
        bookValueAfter: asset.bookValue,
        sourceType: 'MaintenanceWorkOrder',
        sourceId: work.id,
        accountingEventId: primaryEvent.id,
        journalEntryId: primaryEvent.journalEntryId,
        metadata: { externalGross: tax.gross.toString(), externalNet: tax.net.toString(), partsCost: partsCost.toString(), externalAccountingEventId: externalEvent?.id, partsAccountingEventId: partsEvent?.id },
      } });
      if (work.vehicleId && dto.odometer !== undefined) {
        await tx.vehicle.update({ where: { id: work.vehicleId }, data: { currentOdometer: dto.odometer } });
        await tx.vehicleMeterReading.create({ data: { vehicleId: work.vehicleId, value: new Prisma.Decimal(dto.odometer), sourceType: 'MaintenanceWorkOrder', sourceId: work.id, recordedById: user.sub } });
      }
      const updated = await tx.maintenanceWorkOrder.update({
        where: { id: work.id },
        data: {
          status: 'COMPLETED', completedAt, actualCost: tax.gross.add(partsCost), odometer: dto.odometer,
          inspectionId, accountingEventId: primaryEvent.id, taxCodeId, parts: partDetails as Prisma.InputJsonValue,
          notes: dto.notes ?? work.notes,
        },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'COMPLETE_MAINTENANCE_WORK_ORDER', entityType: 'MaintenanceWorkOrder', entityId: work.id,
        payload: { branchId: scope.branchId, assetId: asset.id, accountingEventId: primaryEvent.id, partsAccountingEventId: partsEvent?.id, partsCost: partsCost.toString() },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async runDepreciation(dto: RunDepreciationDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'AssetDepreciationRun');
    const timeZone = await this.companyTimeZone(this.prisma, scope.companyId);
    const start = this.parseBusinessDate(dto.periodStart, timeZone);
    const end = this.parseBusinessDate(dto.periodEnd, timeZone, true);
    if (start > end) throw new BadRequestException('Periode depresiasi tidak valid.');
    return this.prisma.$transaction(async (tx) => {
      const overlapping = await tx.assetDepreciationRun.findFirst({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: 'POSTED',
          periodStart: { lte: end },
          periodEnd: { gte: start },
        },
        select: { id: true, number: true, periodStart: true, periodEnd: true },
      });
      if (overlapping) {
        throw new BadRequestException(`Periode depresiasi bertumpang tindih dengan run ${overlapping.number}.`);
      }
      const assets = await tx.asset.findMany({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          status: 'ACTIVE',
          capitalizationDate: { lte: end },
          bookValue: { gt: 0 },
        },
      });
      const run = await tx.assetDepreciationRun.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'DEPRECIATION_RUN', prefix: 'DEP' }),
        periodStart: start,
        periodEnd: end,
        processedById: user.sub,
      } });
      let total = new Prisma.Decimal(0);
      let processedCount = 0;
      const accountTotals = new Map<string, { expenseCode: string; accumulatedCode: string; amount: Prisma.Decimal; assetIds: string[] }>();
      for (const asset of assets) {
        if (!asset.usefulLifeMonths || asset.usefulLifeMonths <= 0) continue;
        if (asset.depreciationMethod !== 'STRAIGHT_LINE') {
          throw new BadRequestException(`Metode depresiasi ${asset.depreciationMethod} untuk aset ${asset.code} belum didukung; run dibatalkan agar tidak menghasilkan angka asumsi.`);
        }
        if (!asset.capitalizationDate) continue;
        const monthCount = this.countCalendarMonths(start, end, asset.capitalizationDate);
        if (monthCount <= 0) continue;
        const depreciable = new Prisma.Decimal(asset.acquisitionCost).sub(asset.residualValue);
        if (depreciable.lessThanOrEqualTo(0)) continue;
        const monthly = depreciable.div(asset.usefulLifeMonths).toDecimalPlaces(2);
        const available = new Prisma.Decimal(asset.bookValue).sub(asset.residualValue);
        const amount = Prisma.Decimal.min(monthly.mul(monthCount), available).toDecimalPlaces(2);
        if (amount.lessThanOrEqualTo(0)) continue;
        const category = await tx.assetCategory.findFirst({ where: { id: asset.categoryId, companyId: scope.companyId } });
        if (!category) return this.denyTenantAccess(tx, user, scope, 'AssetCategory', asset.categoryId);
        if (!category.depreciationExpenseCode || !category.accumulatedDepreciationCode) {
          throw new BadRequestException(`Akun depresiasi kategori ${category.code} belum lengkap.`);
        }
        const before = new Prisma.Decimal(asset.bookValue);
        const after = before.sub(amount);
        await tx.assetDepreciationLine.create({ data: {
          runId: run.id, assetId: asset.id, amount, bookValueBefore: before, bookValueAfter: after,
          trace: { method: asset.depreciationMethod, usefulLifeMonths: asset.usefulLifeMonths, monthCount, monthlyAmount: monthly.toString(), capitalizationDate: asset.capitalizationDate.toISOString() },
        } });
        await tx.asset.update({ where: { id: asset.id }, data: { bookValue: after, accumulatedDepreciation: { increment: amount } } });
        await tx.assetTransaction.create({ data: {
          companyId: scope.companyId, branchId: scope.branchId, assetId: asset.id, type: 'DEPRECIATION', transactionDate: end,
          amount, accumulatedDepreciation: new Prisma.Decimal(asset.accumulatedDepreciation).add(amount), bookValueAfter: after,
          sourceType: 'AssetDepreciationRun', sourceId: run.id,
        } });
        total = total.add(amount);
        processedCount += 1;
        const key = `${category.depreciationExpenseCode}:${category.accumulatedDepreciationCode}`;
        const current = accountTotals.get(key) ?? { expenseCode: category.depreciationExpenseCode, accumulatedCode: category.accumulatedDepreciationCode, amount: new Prisma.Decimal(0), assetIds: [] };
        current.amount = current.amount.add(amount);
        current.assetIds.push(asset.id);
        accountTotals.set(key, current);
      }
      if (processedCount === 0 || total.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Tidak ada aset yang memenuhi syarat depresiasi pada periode ini.');
      }
      let firstJournalEntryId: string | undefined;
      for (const [key, group] of accountTotals) {
        const event = await this.accounting.postOperationalEvent(tx, {
          companyId: scope.companyId,
          branchId: scope.branchId,
          eventType: 'ASSET_DEPRECIATION',
          sourceType: 'AssetDepreciationRun',
          sourceId: `${run.id}:${key}`,
          idempotencyKey: `asset-depreciation:${run.id}:${key}`,
          businessDate: end,
          amounts: { gross: group.amount },
          accountCodes: { debit: group.expenseCode, credit: group.accumulatedCode },
          context: { runId: run.id, assetIds: group.assetIds, periodStart: start.toISOString(), periodEnd: end.toISOString() },
        });
        firstJournalEntryId ??= event.journalEntryId ?? undefined;
        await tx.assetTransaction.updateMany({
          where: { sourceType: 'AssetDepreciationRun', sourceId: run.id, assetId: { in: group.assetIds }, companyId: scope.companyId, branchId: scope.branchId },
          data: { accountingEventId: event.id, journalEntryId: event.journalEntryId },
        });
      }
      const updated = await tx.assetDepreciationRun.update({
        where: { id: run.id },
        data: { status: 'POSTED', assetCount: processedCount, totalAmount: total, journalEntryId: firstJournalEntryId, processedAt: new Date() },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'RUN_ASSET_DEPRECIATION', entityType: 'AssetDepreciationRun', entityId: run.id,
        payload: { branchId: scope.branchId, assetCount: processedCount, totalAmount: total.toString(), periodStart: start.toISOString(), periodEnd: end.toISOString() },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listMaintenancePlans(user: AuthUser, requestedCompanyId?: string, requestedBranchId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'AssetMaintenancePlan');
    const assets = await this.prisma.asset.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      select: { id: true, code: true, name: true },
    });
    const assetIds = assets.map((asset) => asset.id);
    if (!assetIds.length) return [];
    const plans = await this.prisma.assetMaintenancePlan.findMany({
      where: { companyId: scope.companyId, assetId: { in: assetIds } },
      orderBy: [{ isActive: 'desc' }, { nextDueDate: 'asc' }, { code: 'asc' }],
      take: 500,
    });
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    return plans.map((plan) => ({ ...plan, asset: assetMap.get(plan.assetId) }));
  }

  async createMaintenancePlan(dto: CreateAssetMaintenancePlanDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'AssetMaintenancePlan');
    const asset = await this.scopedAsset(this.prisma, user, scope, dto.assetId);
    if (!dto.intervalDays && !dto.intervalOdometer) {
      throw new BadRequestException('Maintenance plan membutuhkan interval hari atau interval odometer.');
    }
    if (dto.intervalOdometer && asset.assetType !== 'VEHICLE') {
      throw new BadRequestException('Interval odometer hanya dapat dipakai untuk aset kendaraan.');
    }
    if (dto.checklistTemplateId) {
      const template = await this.prisma.inspectionTemplate.findFirst({ where: { id: dto.checklistTemplateId, companyId: scope.companyId, status: 'ACTIVE' } });
      if (!template) return this.denyTenantAccess(this.prisma, user, scope, 'InspectionTemplate', dto.checklistTemplateId);
    }
    const timeZone = await this.companyTimeZone(this.prisma, scope.companyId);
    const row = await this.prisma.assetMaintenancePlan.create({ data: {
      companyId: scope.companyId, assetId: asset.id, code: dto.code.trim(), name: dto.name.trim(), scheduleType: dto.scheduleType.trim(),
      intervalDays: dto.intervalDays, intervalOdometer: dto.intervalOdometer,
      nextDueDate: dto.nextDueDate ? this.parseBusinessDate(dto.nextDueDate, timeZone) : undefined, nextDueOdometer: dto.nextDueOdometer,
      checklistTemplateId: dto.checklistTemplateId, autoCreateWorkOrder: dto.autoCreateWorkOrder ?? true, isActive: dto.isActive ?? true,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    } });
    await this.prisma.auditLog.create({ data: {
      companyId: scope.companyId, userId: user.sub, action: 'CREATE_ASSET_MAINTENANCE_PLAN', entityType: 'AssetMaintenancePlan', entityId: row.id,
      payload: { branchId: scope.branchId, assetId: asset.id, code: row.code },
    } });
    return row;
  }

  async updateMaintenancePlan(id: string, dto: UpdateAssetMaintenancePlanDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const plan = await this.prisma.assetMaintenancePlan.findFirst({ where: { id, companyId: scope.companyId } });
    if (!plan) return this.denyTenantAccess(this.prisma, user, scope, 'AssetMaintenancePlan', id);
    const asset = await this.scopedAsset(this.prisma, user, scope, plan.assetId);
    const intervalDays = dto.intervalDays ?? plan.intervalDays ?? undefined;
    const intervalOdometer = dto.intervalOdometer ?? plan.intervalOdometer ?? undefined;
    if (!intervalDays && !intervalOdometer) throw new BadRequestException('Maintenance plan membutuhkan interval hari atau interval odometer.');
    if (intervalOdometer && asset.assetType !== 'VEHICLE') throw new BadRequestException('Interval odometer hanya dapat dipakai untuk aset kendaraan.');
    if (dto.checklistTemplateId) {
      const template = await this.prisma.inspectionTemplate.findFirst({ where: { id: dto.checklistTemplateId, companyId: scope.companyId, status: 'ACTIVE' } });
      if (!template) return this.denyTenantAccess(this.prisma, user, scope, 'InspectionTemplate', dto.checklistTemplateId);
    }
    const timeZone = await this.companyTimeZone(this.prisma, scope.companyId);
    const row = await this.prisma.assetMaintenancePlan.update({ where: { id }, data: {
      name: dto.name?.trim(), scheduleType: dto.scheduleType?.trim(), intervalDays: dto.intervalDays, intervalOdometer: dto.intervalOdometer,
      nextDueDate: dto.nextDueDate ? this.parseBusinessDate(dto.nextDueDate, timeZone) : undefined, nextDueOdometer: dto.nextDueOdometer,
      checklistTemplateId: dto.checklistTemplateId, autoCreateWorkOrder: dto.autoCreateWorkOrder, isActive: dto.isActive,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    } });
    await this.prisma.auditLog.create({ data: {
      companyId: scope.companyId, userId: user.sub, action: 'UPDATE_ASSET_MAINTENANCE_PLAN', entityType: 'AssetMaintenancePlan', entityId: row.id,
      payload: { branchId: scope.branchId, assetId: asset.id, isActive: row.isActive, autoCreateWorkOrder: row.autoCreateWorkOrder },
    } });
    return row;
  }

  async listMaintenances(user: AuthUser, requestedCompanyId?: string, requestedBranchId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'MaintenanceWorkOrder');
    const rows = await this.prisma.maintenanceWorkOrder.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    const assetIds = [...new Set(rows.map((row) => row.assetId))];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, companyId: scope.companyId, branchId: scope.branchId },
      select: { id: true, code: true, name: true },
    });
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    return rows.map((row) => ({ ...row, asset: assetMap.get(row.assetId) }));
  }

  async summary(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const [assets, maintenanceOpen, lastRuns] = await Promise.all([
      this.prisma.asset.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, select: { status: true, acquisitionCost: true, accumulatedDepreciation: true, bookValue: true } }),
      this.prisma.maintenanceWorkOrder.count({ where: { companyId: scope.companyId, branchId: scope.branchId, status: { in: ['PLANNED', 'OPEN', 'IN_PROGRESS', 'WAITING_PART'] } } }),
      this.prisma.assetDepreciationRun.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, status: 'POSTED' }, orderBy: { periodEnd: 'desc' }, take: 6 }),
    ]);
    const sum = (key: 'acquisitionCost'|'accumulatedDepreciation'|'bookValue') => assets.reduce((acc, row) => acc.add(row[key]), new Prisma.Decimal(0));
    return {
      assetCount: assets.length,
      activeAssetCount: assets.filter((row) => row.status === 'ACTIVE').length,
      acquisitionCost: sum('acquisitionCost'),
      accumulatedDepreciation: sum('accumulatedDepreciation'),
      bookValue: sum('bookValue'),
      maintenanceOpen,
      recentDepreciationRuns: lastRuns,
    };
  }

  async transfer(assetId: string, dto: TransferAssetDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.scopedAsset(tx, user, scope, assetId);
      if (!['ACTIVE', 'IDLE'].includes(asset.status)) throw new BadRequestException(`Aset berstatus ${asset.status} tidak dapat ditransfer.`);
      await this.assertAssetOperationallyFree(tx, asset.id);
      const targetWarehouse = await this.assertWarehouse(tx, user, scope, dto.targetWarehouseId);
      const targetEmployee = await this.assertEmployee(tx, user, scope, dto.targetEmployeeId);
      const inspection = await this.assertInspection(tx, user, scope, dto.inspectionId, 'Asset', asset.id);
      if (!inspection || !['PASSED', 'APPROVED'].includes(inspection.status)) throw new BadRequestException('Inspeksi serah-terima aset belum lulus.');
      const previousTransfer = await tx.assetTransaction.findFirst({
        where: { companyId: scope.companyId, branchId: scope.branchId, assetId: asset.id, type: 'TRANSFER', sourceType: 'AssetTransfer', sourceId: inspection.id },
        select: { id: true },
      });
      if (previousTransfer) return tx.asset.findUniqueOrThrow({ where: { id: asset.id } });
      if (!dto.targetWarehouseId && !dto.targetEmployeeId && !dto.targetLocationName) throw new BadRequestException('Tujuan transfer aset belum diisi.');
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const transferredAt = this.parseBusinessDate(dto.transferredAt, timeZone);
      await tx.assetAssignment.updateMany({
        where: { assetId: asset.id, companyId: scope.companyId, returnedAt: null },
        data: { returnedAt: transferredAt, returnInspectionId: inspection.id, notes: dto.notes },
      });
      const employeeId = targetEmployee?.id ?? asset.assignedEmployeeId ?? undefined;
      const warehouseId = targetWarehouse?.id ?? asset.warehouseId ?? undefined;
      await tx.assetAssignment.create({ data: {
        companyId: scope.companyId, assetId: asset.id, employeeId, branchId: scope.branchId, warehouseId,
        assignedAt: transferredAt, handoverInspectionId: inspection.id, notes: dto.notes,
      } });
      const updated = await tx.asset.update({
        where: { id: asset.id },
        data: { warehouseId, assignedEmployeeId: employeeId, locationName: dto.targetLocationName ?? asset.locationName },
      });
      await tx.assetTransaction.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, assetId: asset.id, type: 'TRANSFER', transactionDate: transferredAt,
        amount: new Prisma.Decimal(0), accumulatedDepreciation: asset.accumulatedDepreciation, bookValueAfter: asset.bookValue,
        sourceType: 'AssetTransfer', sourceId: inspection.id, notes: dto.notes,
        metadata: { fromWarehouseId: asset.warehouseId, toWarehouseId: warehouseId, fromEmployeeId: asset.assignedEmployeeId, toEmployeeId: employeeId, locationName: updated.locationName },
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'TRANSFER_ASSET', entityType: 'Asset', entityId: asset.id,
        payload: { branchId: scope.branchId, fromWarehouseId: asset.warehouseId, toWarehouseId: warehouseId, inspectionId: inspection.id },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async dispose(assetId: string, dto: DisposeAssetDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.scopedAsset(tx, user, scope, assetId);
      if (['SOLD', 'DISPOSED'].includes(asset.status)) {
        const previousDisposal = await tx.accountingEvent.findFirst({
          where: { companyId: scope.companyId, branchId: scope.branchId, sourceType: 'Asset', sourceId: asset.id, eventType: 'ASSET_DISPOSAL', status: 'POSTED' },
          select: { id: true },
        });
        if (previousDisposal) return asset;
      }
      if (!['ACTIVE', 'IDLE', 'DAMAGED'].includes(asset.status)) throw new BadRequestException(`Aset berstatus ${asset.status} tidak dapat dilepas.`);
      await this.assertAssetOperationallyFree(tx, asset.id);
      const category = await tx.assetCategory.findFirst({ where: { id: asset.categoryId, companyId: scope.companyId } });
      if (!category) return this.denyTenantAccess(tx, user, scope, 'AssetCategory', asset.categoryId);
      const inspection = await this.assertInspection(tx, user, scope, dto.inspectionId, 'Asset', asset.id);
      if (!inspection || !['PASSED', 'APPROVED'].includes(inspection.status)) throw new BadRequestException('Inspeksi pelepasan aset belum lulus.');
      const mode = dto.mode;
      const proceeds = new Prisma.Decimal(dto.proceeds ?? 0);
      if (mode === 'SALE' && proceeds.lessThanOrEqualTo(0)) throw new BadRequestException('Penjualan aset membutuhkan nilai proceeds lebih dari nol.');
      if (mode === 'DISPOSAL' && proceeds.greaterThan(0)) throw new BadRequestException('Gunakan mode SALE jika pelepasan aset menghasilkan proceeds.');
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const disposedAt = this.parseBusinessDate(dto.disposedAt, timeZone);
      const settlementMode = (dto.settlementMode ?? 'CASH').toUpperCase();
      if (mode === 'SALE' && !['CASH', 'BANK'].includes(settlementMode)) throw new BadRequestException('Settlement penjualan aset hanya CASH atau BANK. Penjualan kredit memerlukan workflow customer receivable yang belum diaktifkan untuk disposal aset.');
      const tax = mode === 'SALE'
        ? await this.accounting.calculateTax(tx, dto.taxCodeId, proceeds, scope.companyId, disposedAt, ['SALE', 'OTHER'])
        : { net: new Prisma.Decimal(0), tax: new Prisma.Decimal(0), gross: new Prisma.Decimal(0), taxCode: undefined as any };
      const cost = new Prisma.Decimal(asset.acquisitionCost);
      const accumulated = new Prisma.Decimal(asset.accumulatedDepreciation);
      const expectedBook = cost.sub(accumulated).toDecimalPlaces(2);
      const bookValue = new Prisma.Decimal(asset.bookValue).toDecimalPlaces(2);
      if (!expectedBook.equals(bookValue)) {
        throw new BadRequestException({ code: 'ASSET_BOOK_VALUE_RECONCILIATION_REQUIRED', message: `Nilai buku aset ${asset.code} tidak sama dengan biaya perolehan dikurangi akumulasi depresiasi.` });
      }
      const gain = Prisma.Decimal.max(tax.net.sub(bookValue), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const loss = Prisma.Decimal.max(bookValue.sub(tax.net), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        eventType: 'ASSET_DISPOSAL',
        sourceType: 'Asset',
        sourceId: asset.id,
        idempotencyKey: `asset-disposal:${asset.id}`,
        businessDate: disposedAt,
        amounts: { settlement: tax.gross, accumulatedDepreciation: accumulated, assetCost: cost, outputTax: tax.tax, gain, loss, gross: tax.gross },
        accountCodes: {
          settlement: settlementMode === 'BANK' ? '1102' : '1101',
          accumulatedDepreciation: category.accumulatedDepreciationCode ?? '1491',
          asset: category.assetAccountCode ?? '1401',
          outputTax: tax.taxCode?.payableAccountCode ?? '2201',
          gain: '4202',
          loss: '6202',
        },
        taxLines: tax.taxCode && tax.tax.greaterThan(0) ? [{ taxCodeId: tax.taxCode.id, direction: 'OUTPUT', taxableBase: tax.net, taxAmount: tax.tax }] : [],
        context: { mode, settlementMode, reason: dto.reason, inspectionId: inspection.id, bookValue: bookValue.toString() },
      });
      await tx.assetAssignment.updateMany({ where: { assetId: asset.id, companyId: scope.companyId, returnedAt: null }, data: { returnedAt: disposedAt, returnInspectionId: inspection.id } });
      const updated = await tx.asset.update({ where: { id: asset.id }, data: { status: mode === 'SALE' ? 'SOLD' : 'DISPOSED', assignedEmployeeId: null } });
      await tx.vehicle.updateMany({ where: { assetId: asset.id, companyId: scope.companyId, branchId: scope.branchId }, data: { status: 'DISPOSED' } });
      await tx.assetTransaction.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, assetId: asset.id, type: mode === 'SALE' ? 'SALE' : 'DISPOSAL', transactionDate: disposedAt,
        amount: tax.gross, accumulatedDepreciation: accumulated, bookValueAfter: new Prisma.Decimal(0), sourceType: 'Asset', sourceId: asset.id,
        accountingEventId: event.id, journalEntryId: event.journalEntryId, notes: dto.reason,
        metadata: { proceedsGross: tax.gross.toString(), proceedsNet: tax.net.toString(), outputTax: tax.tax.toString(), gain: gain.toString(), loss: loss.toString(), settlementMode },
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: mode === 'SALE' ? 'SELL_ASSET' : 'DISPOSE_ASSET', entityType: 'Asset', entityId: asset.id,
        payload: { branchId: scope.branchId, accountingEventId: event.id, mode, proceeds: tax.gross.toString(), bookValue: bookValue.toString() },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
