import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { parseBusinessDateBoundary } from '../common/business-time';
import { nextDocumentNumber } from '../common/numbering';
import { PrismaService } from '../prisma/prisma.service';
import { CloseTripDto, CompleteStopDto, ConfirmLoadingDto, CreateDeliveryTripDto, CreateVehicleDriverAssignmentDto, CreateVehicleDto, DispatchTripDto, EndVehicleDriverAssignmentDto, RecordFuelDto } from './dto/fleet.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class FleetService {
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

  private async companyTimeZone(client: DbClient, companyId: string): Promise<string> {
    const company = await client.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new BadRequestException('Company armada tidak ditemukan.');
    return company.timezone;
  }

  private parseBusinessDate(value: string | undefined, timeZone: string, endOfDay = false) {
    return parseBusinessDateBoundary(value, new Date(), timeZone, endOfDay);
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
    entityType = 'Fleet',
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

  private async scopedVehicle(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.vehicle.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Vehicle', id);
    return row;
  }

  private async scopedTrip(client: DbClient, user: AuthUser, scope: TenantScope, id: string) {
    const row = await client.deliveryTrip.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'DeliveryTrip', id);
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

  private async assertWarehouse(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.warehouse.findFirst({
      where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Warehouse', id);
    return row;
  }

  private async assertAsset(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.asset.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Asset', id);
    return row;
  }

  private async assertSupplier(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.supplier.findFirst({ where: { id, companyId: scope.companyId } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Supplier', id);
    return row;
  }

  private async assertDevice(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.device.findFirst({
      where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }], isActive: true },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Device', id);
    return row;
  }

  private async assertInspection(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    id: string,
    sourceType?: string,
    sourceId?: string,
  ) {
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

  private async assertGatePass(client: DbClient, user: AuthUser, scope: TenantScope, id: string, tripId: string) {
    const row = await client.gatePass.findFirst({
      where: {
        id,
        companyId: scope.companyId,
        branchId: scope.branchId,
        sourceType: 'DeliveryTrip',
        sourceId: tripId,
      },
    });
    if (!row) return this.denyTenantAccess(client, user, scope, 'GatePass', id);
    return row;
  }

  private async assertShipment(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.shipment.findUnique({ where: { id } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Shipment', id);
    await this.assertWarehouse(client, user, scope, row.warehouseId);
    return row;
  }

  private async assertOrder(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.order.findFirst({ where: { id, branchId: scope.branchId } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Order', id);
    await this.assertWarehouse(client, user, scope, row.warehouseId);
    return row;
  }

  private async assertSale(client: DbClient, user: AuthUser, scope: TenantScope, id?: string) {
    if (!id) return undefined;
    const row = await client.sale.findFirst({ where: { id, branchId: scope.branchId } });
    if (!row) return this.denyTenantAccess(client, user, scope, 'Sale', id);
    await this.assertWarehouse(client, user, scope, row.warehouseId);
    return row;
  }

  async listVehicles(user: AuthUser, requestedCompanyId?: string, requestedBranchId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'Vehicle');
    return this.prisma.vehicle.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
      take: 500,
    });
  }

  async listDriverAssignments(user: AuthUser, requestedCompanyId?: string, requestedBranchId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'VehicleDriverAssignment');
    const vehicles = await this.prisma.vehicle.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      select: { id: true, code: true, plateNumber: true },
    });
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    if (!vehicleIds.length) return [];
    const rows = await this.prisma.vehicleDriverAssignment.findMany({
      where: { companyId: scope.companyId, vehicleId: { in: vehicleIds } },
      orderBy: [{ effectiveTo: 'asc' }, { effectiveFrom: 'desc' }],
      take: 500,
    });
    const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId: scope.companyId, branchId: scope.branchId },
      select: { id: true, employeeNumber: true, fullName: true, isActive: true },
    });
    const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
    return rows.map((row) => ({ ...row, vehicle: vehicleMap.get(row.vehicleId), employee: employeeMap.get(row.employeeId) }));
  }

  async createDriverAssignment(dto: CreateVehicleDriverAssignmentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'VehicleDriverAssignment');
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await this.scopedVehicle(tx, user, scope, dto.vehicleId);
      const employee = await this.assertEmployee(tx, user, scope, dto.employeeId);
      if (!employee) throw new BadRequestException('Pengemudi tidak ditemukan.');
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const effectiveFrom = this.parseBusinessDate(dto.effectiveFrom, timeZone);
      const effectiveTo = dto.effectiveTo ? this.parseBusinessDate(dto.effectiveTo, timeZone, true) : undefined;
      if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException('Akhir penugasan pengemudi tidak boleh sebelum tanggal mulai.');
      const overlap = await tx.vehicleDriverAssignment.findFirst({
        where: { companyId: scope.companyId, vehicleId: vehicle.id, employeeId: employee.id, effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
        select: { id: true },
      });
      if (overlap) throw new BadRequestException('Pengemudi sudah memiliki penugasan yang bertumpang tindih pada kendaraan ini.');
      if (dto.isPrimary) {
        const primaryOverlap = await tx.vehicleDriverAssignment.findFirst({
          where: { companyId: scope.companyId, vehicleId: vehicle.id, isPrimary: true, effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
          select: { id: true },
        });
        if (primaryOverlap) throw new BadRequestException('Kendaraan sudah memiliki primary driver pada periode yang sama.');
      }
      const row = await tx.vehicleDriverAssignment.create({ data: {
        companyId: scope.companyId, vehicleId: vehicle.id, employeeId: employee.id, effectiveFrom, effectiveTo, isPrimary: dto.isPrimary ?? false, notes: dto.notes,
      } });
      const now = new Date();
      if (row.isPrimary && row.effectiveFrom <= now && (!row.effectiveTo || row.effectiveTo >= now)) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { defaultDriverEmployeeId: employee.id } });
      }
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'CREATE_VEHICLE_DRIVER_ASSIGNMENT', entityType: 'VehicleDriverAssignment', entityId: row.id,
        payload: { branchId: scope.branchId, vehicleId: vehicle.id, employeeId: employee.id, isPrimary: row.isPrimary },
      } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async endDriverAssignment(id: string, dto: EndVehicleDriverAssignmentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.vehicleDriverAssignment.findFirst({ where: { id, companyId: scope.companyId } });
      if (!assignment) return this.denyTenantAccess(tx, user, scope, 'VehicleDriverAssignment', id);
      const vehicle = await this.scopedVehicle(tx, user, scope, assignment.vehicleId);
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const effectiveTo = this.parseBusinessDate(dto.effectiveTo, timeZone, true);
      if (effectiveTo < assignment.effectiveFrom) throw new BadRequestException('Akhir penugasan pengemudi tidak boleh sebelum tanggal mulai.');
      if (assignment.effectiveTo && assignment.effectiveTo <= effectiveTo) return assignment;
      const row = await tx.vehicleDriverAssignment.update({ where: { id }, data: { effectiveTo, notes: dto.notes ?? assignment.notes } });
      if (assignment.isPrimary && vehicle.defaultDriverEmployeeId === assignment.employeeId && effectiveTo <= new Date()) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { defaultDriverEmployeeId: null } });
      }
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'END_VEHICLE_DRIVER_ASSIGNMENT', entityType: 'VehicleDriverAssignment', entityId: row.id,
        payload: { branchId: scope.branchId, vehicleId: vehicle.id, employeeId: row.employeeId, effectiveTo: effectiveTo.toISOString() },
      } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createVehicle(dto: CreateVehicleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'Vehicle');
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.assertAsset(tx, user, scope, dto.assetId);
      if (asset && asset.assetType !== 'VEHICLE') throw new BadRequestException('Master kendaraan hanya dapat dihubungkan ke aset bertipe VEHICLE.');
      if (asset) {
        const existingVehicle = await tx.vehicle.findFirst({ where: { assetId: asset.id, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true, code: true } });
        if (existingVehicle) throw new BadRequestException(`Aset sudah terhubung ke kendaraan ${existingVehicle.code}.`);
      }
      await this.assertEmployee(tx, user, scope, dto.defaultDriverEmployeeId);
      await this.assertDevice(tx, user, scope, dto.gpsDeviceId);
      const row = await tx.vehicle.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        assetId: dto.assetId,
        code: dto.code,
        plateNumber: dto.plateNumber,
        vehicleType: dto.vehicleType,
        capacityWeight: dto.capacityWeight === undefined ? undefined : new Prisma.Decimal(dto.capacityWeight),
        capacityVolume: dto.capacityVolume === undefined ? undefined : new Prisma.Decimal(dto.capacityVolume),
        currentOdometer: dto.currentOdometer ?? 0,
        fuelType: dto.fuelType,
        defaultDriverEmployeeId: dto.defaultDriverEmployeeId,
        gpsDeviceId: dto.gpsDeviceId,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'CREATE_VEHICLE',
        entityType: 'Vehicle',
        entityId: row.id,
        payload: { branchId: scope.branchId, code: row.code, assetId: dto.assetId },
      } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createTrip(dto: CreateDeliveryTripDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'DeliveryTrip');
    if (!dto.stops.length || !dto.manifestItems.length) {
      throw new BadRequestException('Trip membutuhkan tujuan dan manifest barang.');
    }
    if (new Set(dto.stops.map((stop) => stop.sequence)).size !== dto.stops.length) {
      throw new BadRequestException('Sequence tujuan pengiriman harus unik.');
    }
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await this.scopedVehicle(tx, user, scope, dto.vehicleId);
      if (vehicle.status !== 'AVAILABLE') throw new BadRequestException(`Kendaraan berstatus ${vehicle.status}.`);
      await this.assertEmployee(tx, user, scope, dto.driverEmployeeId);
      await this.assertWarehouse(tx, user, scope, dto.originWarehouseId);
      for (const stop of dto.stops) {
        await this.assertShipment(tx, user, scope, stop.shipmentId);
        await this.assertOrder(tx, user, scope, stop.orderId);
        await this.assertSale(tx, user, scope, stop.saleId);
      }
      for (const item of dto.manifestItems) {
        if (item.stopSequence !== undefined && !dto.stops.some((stop) => stop.sequence === item.stopSequence)) {
          throw new BadRequestException(`Stop sequence ${item.stopSequence} tidak ditemukan.`);
        }
        await this.assertShipment(tx, user, scope, item.shipmentId);
        await this.assertOrder(tx, user, scope, item.orderId);
        const product = await tx.product.findFirst({ where: { id: item.productId, companyId: scope.companyId, isActive: true } });
        if (!product) {
          const productExists = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true } });
          if (productExists) return this.denyTenantAccess(tx, user, scope, 'Product', item.productId);
          throw new BadRequestException(`Produk ${item.productId} tidak ditemukan.`);
        }
        if (item.batchId) {
          const batch = await tx.inventoryBatch.findUnique({ where: { id: item.batchId } });
          if (!batch || batch.productId !== item.productId) {
            return this.denyTenantAccess(tx, user, scope, 'InventoryBatch', item.batchId);
          }
          await this.assertWarehouse(tx, user, scope, batch.warehouseId);
        }
        if (item.serialId) {
          const serial = await tx.inventorySerial.findUnique({ where: { id: item.serialId } });
          if (!serial || serial.productId !== item.productId) {
            return this.denyTenantAccess(tx, user, scope, 'InventorySerial', item.serialId);
          }
          await this.assertWarehouse(tx, user, scope, serial.warehouseId);
        }
      }
      if (dto.startOdometer !== undefined && dto.startOdometer < vehicle.currentOdometer) {
        throw new BadRequestException('Odometer awal trip tidak boleh lebih kecil dari odometer kendaraan saat ini.');
      }
      if (dto.plannedDepartureAt && dto.plannedReturnAt && new Date(dto.plannedReturnAt) < new Date(dto.plannedDepartureAt)) {
        throw new BadRequestException('Rencana waktu kembali tidak boleh sebelum waktu berangkat.');
      }
      const totalWeight = new Prisma.Decimal(dto.totalWeight ?? 0);
      const totalVolume = new Prisma.Decimal(dto.totalVolume ?? 0);
      if (vehicle.capacityWeight && totalWeight.greaterThan(vehicle.capacityWeight)) {
        throw new BadRequestException('Berat muatan melebihi kapasitas kendaraan.');
      }
      if (vehicle.capacityVolume && totalVolume.greaterThan(vehicle.capacityVolume)) {
        throw new BadRequestException('Volume muatan melebihi kapasitas kendaraan.');
      }
      const trip = await tx.deliveryTrip.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'DELIVERY_TRIP', prefix: 'TRIP' }),
        vehicleId: vehicle.id,
        driverEmployeeId: dto.driverEmployeeId,
        originWarehouseId: dto.originWarehouseId,
        plannedDepartureAt: dto.plannedDepartureAt ? new Date(dto.plannedDepartureAt) : undefined,
        plannedReturnAt: dto.plannedReturnAt ? new Date(dto.plannedReturnAt) : undefined,
        startOdometer: dto.startOdometer,
        totalWeight,
        totalVolume,
        totalPackages: dto.manifestItems.reduce((sum, item) => sum + item.expectedQty, 0),
        codExpected: dto.stops.reduce((sum, stop) => sum + (stop.codExpected ?? 0), 0),
        routePlan: dto.routePlan as Prisma.InputJsonValue | undefined,
      } });
      const stopMap = new Map<number, string>();
      for (const stop of dto.stops) {
        const created = await tx.deliveryStop.create({ data: {
          tripId: trip.id,
          sequence: stop.sequence,
          shipmentId: stop.shipmentId,
          orderId: stop.orderId,
          saleId: stop.saleId,
          customerName: stop.customerName,
          customerPhone: stop.customerPhone,
          address: stop.address,
          latitude: stop.latitude === undefined ? undefined : new Prisma.Decimal(stop.latitude),
          longitude: stop.longitude === undefined ? undefined : new Prisma.Decimal(stop.longitude),
          codExpected: new Prisma.Decimal(stop.codExpected ?? 0),
        } });
        stopMap.set(stop.sequence, created.id);
      }
      await tx.deliveryManifestItem.createMany({ data: dto.manifestItems.map((item) => ({
        tripId: trip.id,
        stopId: item.stopSequence === undefined ? undefined : stopMap.get(item.stopSequence),
        shipmentId: item.shipmentId,
        orderId: item.orderId,
        productId: item.productId,
        batchId: item.batchId,
        serialId: item.serialId,
        expectedQty: item.expectedQty,
      })) });
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { status: 'ASSIGNED', defaultDriverEmployeeId: dto.driverEmployeeId },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'CREATE_DELIVERY_TRIP',
        entityType: 'DeliveryTrip',
        entityId: trip.id,
        payload: { branchId: scope.branchId, vehicleId: vehicle.id, driverEmployeeId: dto.driverEmployeeId },
      } });
      return tx.deliveryTrip.findUniqueOrThrow({ where: { id: trip.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirmLoading(tripId: string, dto: ConfirmLoadingDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const trip = await this.scopedTrip(tx, user, scope, tripId);
      if (!['DRAFT','PLANNED','LOADING'].includes(trip.status)) {
        throw new BadRequestException('Trip tidak dapat diproses loading.');
      }
      const inspection = await this.assertInspection(tx, user, scope, dto.inspectionId, 'DeliveryTrip', trip.id);
      if (!['PASSED','PARTIAL','APPROVED'].includes(inspection.status)) {
        throw new BadRequestException('Pemeriksaan loading belum lulus.');
      }
      const items = await tx.deliveryManifestItem.findMany({ where: { tripId: trip.id } });
      for (const scan of dto.scans) {
        const item = items.find((row) => row.id === scan.manifestItemId);
        if (!item) throw new BadRequestException(`Manifest item ${scan.manifestItemId} tidak ditemukan.`);
        if (scan.scannedQty > item.expectedQty) throw new BadRequestException('Jumlah scan melebihi manifest.');
        await tx.deliveryManifestItem.update({
          where: { id: item.id },
          data: {
            scannedQty: scan.scannedQty,
            loadedQty: Math.max(0, scan.scannedQty - (scan.damagedQty ?? 0)),
            damagedQty: scan.damagedQty ?? 0,
            status: scan.scannedQty === item.expectedQty && !(scan.damagedQty ?? 0) ? 'LOADED' : 'MISMATCH',
            notes: scan.notes,
          },
        });
      }
      const updatedItems = await tx.deliveryManifestItem.findMany({ where: { tripId: trip.id } });
      if (updatedItems.some((item) => item.loadedQty !== item.expectedQty || item.damagedQty > 0)) {
        throw new BadRequestException('Masih ada selisih loading. Koreksi manifest atau minta approval sebelum dispatch.');
      }
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'DELIVERY_LOADING_CONFIRMED',
        entityType: 'DeliveryTrip',
        entityId: trip.id,
        payload: { branchId: scope.branchId, inspectionId: inspection.id },
      } });
      return tx.deliveryTrip.update({
        where: { id: trip.id },
        data: { status: 'READY_TO_DISPATCH', loadingInspectionId: inspection.id },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async dispatch(tripId: string, dto: DispatchTripDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const trip = await this.scopedTrip(tx, user, scope, tripId);
      if (trip.status !== 'READY_TO_DISPATCH') throw new BadRequestException('Trip belum siap dispatch.');
      const preTrip = await this.assertInspection(tx, user, scope, dto.preTripInspectionId, 'DeliveryTrip', trip.id);
      if (!['PASSED','APPROVED'].includes(preTrip.status)) {
        throw new BadRequestException('Pemeriksaan kendaraan sebelum jalan belum lulus.');
      }
      const gatePass = await this.assertGatePass(tx, user, scope, dto.gatePassId, trip.id);
      if (gatePass.status !== 'APPROVED') throw new BadRequestException('Gate pass outbound belum disetujui.');
      const shipments = await tx.deliveryManifestItem.findMany({
        where: { tripId: trip.id },
        select: { shipmentId: true },
      });
      const shipmentIds = [...new Set(shipments.map((item) => item.shipmentId).filter(Boolean) as string[])];
      for (const shipmentId of shipmentIds) await this.assertShipment(tx, user, scope, shipmentId);
      if (shipmentIds.length) {
        await tx.shipment.updateMany({
          where: { id: { in: shipmentIds } },
          data: {
            status: 'IN_TRANSIT',
            deliveryTripId: trip.id,
            outboundInspectionId: trip.loadingInspectionId,
            gatePassId: gatePass.id,
            confirmedAt: new Date(),
            confirmedById: user.sub,
            pickedUpAt: new Date(),
          },
        });
      }
      await tx.vehicle.update({
        where: { id: trip.vehicleId },
        data: { status: 'ON_TRIP', currentOdometer: dto.startOdometer ?? trip.startOdometer ?? undefined },
      });
      await tx.gatePass.update({ where: { id: gatePass.id }, data: { status: 'EXITED', movementAt: new Date() } });
      const updated = await tx.deliveryTrip.update({
        where: { id: trip.id },
        data: {
          status: 'DISPATCHED',
          preTripInspectionId: preTrip.id,
          gatePassId: gatePass.id,
          actualDepartureAt: new Date(),
          startOdometer: dto.startOdometer ?? trip.startOdometer,
        },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'DISPATCH_DELIVERY_TRIP',
        entityType: 'DeliveryTrip',
        entityId: trip.id,
        payload: { branchId: scope.branchId, gatePassId: gatePass.id, inspectionId: preTrip.id },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async completeStop(stopId: string, dto: CompleteStopDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const stop = await tx.deliveryStop.findUnique({ where: { id: stopId } });
      if (!stop) return this.denyTenantAccess(tx, user, scope, 'DeliveryStop', stopId);
      const trip = await this.scopedTrip(tx, user, scope, stop.tripId);
      if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(trip.status)) {
        throw new BadRequestException(`Stop tidak dapat diselesaikan ketika trip berstatus ${trip.status}.`);
      }
      if (!['PENDING', 'ARRIVED'].includes(stop.status)) {
        if (stop.status === dto.status) return stop;
        throw new BadRequestException(`Stop sudah berstatus ${stop.status} dan tidak dapat ditimpa.`);
      }
      const codCollected = new Prisma.Decimal(dto.codCollected ?? 0);
      if (codCollected.greaterThan(stop.codExpected)) throw new BadRequestException('COD yang diterima melebihi COD yang diharapkan pada stop.');
      if (!['DELIVERED', 'PARTIAL'].includes(dto.status) && codCollected.greaterThan(0)) {
        throw new BadRequestException('COD tidak boleh dicatat pada stop gagal/returned.');
      }
      if (dto.status === 'DELIVERED' && !dto.proofInspectionId) {
        throw new BadRequestException('Bukti serah terima wajib untuk status DELIVERED.');
      }
      if (dto.proofInspectionId) {
        const proof = await this.assertInspection(tx, user, scope, dto.proofInspectionId, 'DeliveryStop', stop.id);
        if (!['PASSED','APPROVED'].includes(proof.status)) {
          throw new BadRequestException('Bukti pengiriman belum disetujui.');
        }
      }
      if (stop.shipmentId) await this.assertShipment(tx, user, scope, stop.shipmentId);
      const status = dto.status;
      const updated = await tx.deliveryStop.update({
        where: { id: stop.id },
        data: {
          status,
          completedAt: new Date(),
          codCollected,
          proofInspectionId: dto.proofInspectionId,
          failureReason: dto.failureReason,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      const items = await tx.deliveryManifestItem.findMany({ where: { stopId: stop.id, tripId: trip.id } });
      for (const item of items) {
        await tx.deliveryManifestItem.update({
          where: { id: item.id },
          data: status === 'DELIVERED'
            ? { deliveredQty: item.loadedQty, status: 'DELIVERED' }
            : { returnedQty: item.loadedQty, status: 'RETURN_PENDING' },
        });
      }
      if (stop.shipmentId) {
        await tx.shipment.update({
          where: { id: stop.shipmentId },
          data: {
            status: status === 'DELIVERED' ? 'DELIVERED' : 'FAILED',
            deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
          },
        });
      }
      const tripStops = await tx.deliveryStop.findMany({ where: { tripId: trip.id } });
      const allDone = tripStops.every((row) => !['PENDING','ARRIVED'].includes(row.id === stop.id ? status : row.status));
      const codTotal = tripStops.reduce((sum, row) => sum.add(row.id === stop.id ? codCollected : row.codCollected), new Prisma.Decimal(0));
      await tx.deliveryTrip.update({
        where: { id: trip.id },
        data: {
          codCollected: codTotal,
          ...(allDone ? {
            status: tripStops.some((row) => ['FAILED','PARTIAL','RETURNED'].includes(row.id === stop.id ? status : row.status))
              ? 'PARTIALLY_DELIVERED'
              : 'DELIVERED',
          } : {}),
        },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'COMPLETE_DELIVERY_STOP',
        entityType: 'DeliveryStop',
        entityId: stop.id,
        payload: { branchId: scope.branchId, tripId: trip.id, status },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async closeTrip(tripId: string, dto: CloseTripDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const trip = await this.scopedTrip(tx, user, scope, tripId);
      if (!['DELIVERED','PARTIALLY_DELIVERED','RETURNING'].includes(trip.status)) {
        throw new BadRequestException('Trip belum dapat ditutup.');
      }
      if (trip.startOdometer !== null && dto.endOdometer < trip.startOdometer) {
        throw new BadRequestException('Odometer akhir lebih kecil dari awal.');
      }
      const inspection = await this.assertInspection(tx, user, scope, dto.postTripInspectionId, 'DeliveryTrip', trip.id);
      if (!['PASSED','PARTIAL','APPROVED'].includes(inspection.status)) {
        throw new BadRequestException('Pemeriksaan kendaraan setelah perjalanan belum selesai.');
      }
      const returnStops = await tx.deliveryStop.findMany({
        where: { tripId: trip.id, status: { in: ['FAILED','PARTIAL','RETURNED'] } },
      });
      for (const stop of returnStops) {
        if (stop.status !== 'RETURNED') {
          await tx.deliveryStop.update({ where: { id: stop.id }, data: { status: 'RETURNED' } });
        }
        if (stop.shipmentId) {
          await this.assertShipment(tx, user, scope, stop.shipmentId);
          await tx.shipment.update({ where: { id: stop.shipmentId }, data: { status: 'RETURNED' } });
        }
        const returnItems = await tx.deliveryManifestItem.findMany({ where: { tripId: trip.id, stopId: stop.id } });
        for (const item of returnItems) {
          const returnedQty = Math.max(0, item.loadedQty - item.deliveredQty);
          await tx.deliveryManifestItem.update({
            where: { id: item.id },
            data: { returnedQty, status: returnedQty > 0 ? 'RETURNED' : item.status },
          });
        }
      }
      await this.scopedVehicle(tx, user, scope, trip.vehicleId);
      await tx.vehicle.update({
        where: { id: trip.vehicleId },
        data: {
          status: inspection.status === 'PARTIAL' ? 'MAINTENANCE' : 'AVAILABLE',
          currentOdometer: dto.endOdometer,
        },
      });
      await tx.vehicleMeterReading.create({ data: {
        vehicleId: trip.vehicleId,
        value: new Prisma.Decimal(dto.endOdometer),
        sourceType: 'DeliveryTrip',
        sourceId: trip.id,
        recordedById: user.sub,
      } });
      const updated = await tx.deliveryTrip.update({
        where: { id: trip.id },
        data: {
          status: 'CLOSED',
          actualReturnAt: new Date(),
          endOdometer: dto.endOdometer,
          postTripInspectionId: inspection.id,
        },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'CLOSE_DELIVERY_TRIP',
        entityType: 'DeliveryTrip',
        entityId: trip.id,
        payload: { branchId: scope.branchId, endOdometer: dto.endOdometer, inspectionId: inspection.id },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async recordFuel(dto: RecordFuelDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'FuelTransaction');
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await this.scopedVehicle(tx, user, scope, dto.vehicleId);
      if (['INACTIVE', 'DISPOSED'].includes(vehicle.status)) throw new BadRequestException(`Kendaraan berstatus ${vehicle.status} tidak dapat menerima transaksi BBM.`);
      await this.assertSupplier(tx, user, scope, dto.supplierId);
      let trip: Awaited<ReturnType<FleetService['scopedTrip']>> | undefined;
      if (dto.tripId) {
        trip = await this.scopedTrip(tx, user, scope, dto.tripId);
        if (trip.vehicleId !== vehicle.id) throw new BadRequestException('Trip tidak menggunakan kendaraan yang dipilih.');
      }
      const timeZone = await this.companyTimeZone(tx, scope.companyId);
      const transactionDate = this.parseBusinessDate(dto.transactionDate, timeZone);
      if (dto.odometer !== undefined && dto.odometer < vehicle.currentOdometer) {
        throw new BadRequestException('Odometer transaksi BBM tidak boleh lebih kecil dari odometer kendaraan saat ini.');
      }
      if (trip?.startOdometer !== null && trip?.startOdometer !== undefined && dto.odometer !== undefined && dto.odometer < trip.startOdometer) {
        throw new BadRequestException('Odometer transaksi BBM tidak boleh lebih kecil dari odometer awal trip.');
      }
      const liters = new Prisma.Decimal(dto.liters);
      const unitPrice = new Prisma.Decimal(dto.unitPrice);
      const base = liters.mul(unitPrice).toDecimalPlaces(2);
      const tax = await this.accounting.calculateTax(tx, dto.taxCodeId, base, scope.companyId, transactionDate, ['EXPENSE', 'PURCHASE', 'OTHER']);
      if (!dto.receiptNumber && !dto.evidenceReference) throw new BadRequestException('Transaksi BBM wajib memiliki receiptNumber atau evidenceReference untuk trace dan retry aman.');
      const duplicate = await tx.fuelTransaction.findFirst({
        where: dto.receiptNumber
          ? { companyId: scope.companyId, branchId: scope.branchId, vehicleId: vehicle.id, receiptNumber: dto.receiptNumber }
          : dto.evidenceReference
            ? { companyId: scope.companyId, branchId: scope.branchId, vehicleId: vehicle.id, evidenceReference: dto.evidenceReference }
            : { companyId: scope.companyId, branchId: scope.branchId, vehicleId: vehicle.id, transactionDate, liters, unitPrice, odometer: dto.odometer },
      });
      if (duplicate) {
        const same = new Prisma.Decimal(duplicate.liters).equals(liters)
          && new Prisma.Decimal(duplicate.unitPrice).equals(unitPrice)
          && duplicate.odometer === (dto.odometer ?? null);
        if (same) return duplicate;
        throw new BadRequestException('Receipt/evidence BBM sudah digunakan oleh transaksi lain dengan nilai berbeda.');
      }
      const paymentMode = (dto.paymentMode ?? 'CASH').toUpperCase();
      if (!['CASH', 'BANK', 'CREDIT'].includes(paymentMode)) throw new BadRequestException('Payment mode BBM hanya CASH, BANK, atau CREDIT.');
      if (paymentMode === 'CREDIT' && !dto.supplierId) throw new BadRequestException('BBM kredit wajib memiliki supplier agar utang dapat direkonsiliasi.');
      const fuel = await tx.fuelTransaction.create({ data: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        vehicleId: vehicle.id,
        tripId: dto.tripId,
        supplierId: dto.supplierId,
        transactionDate,
        liters,
        unitPrice,
        totalAmount: tax.gross,
        odometer: dto.odometer,
        vendorName: dto.vendorName,
        receiptNumber: dto.receiptNumber,
        taxCodeId: dto.taxCodeId,
        evidenceReference: dto.evidenceReference,
      } });
      const stableReference = dto.receiptNumber
        ? `receipt:${dto.receiptNumber}`
        : dto.evidenceReference
          ? `evidence:${dto.evidenceReference}`
          : `fact:${transactionDate.toISOString()}:${liters.toString()}:${unitPrice.toString()}:${dto.odometer ?? 'na'}`;
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        eventType: paymentMode === 'CREDIT' ? 'FLEET_FUEL_CREDIT' : 'FLEET_FUEL_CASH',
        sourceType: 'FuelTransaction',
        sourceId: fuel.id,
        idempotencyKey: `fuel:${vehicle.id}:${stableReference}`,
        businessDate: transactionDate,
        amounts: { expense: tax.net, inputTax: tax.tax, gross: tax.gross, settlement: tax.gross },
        accountCodes: {
          expense: '5202',
          inputTax: tax.taxCode?.receivableAccountCode ?? '1205',
          settlement: paymentMode === 'CASH' ? '1101' : paymentMode === 'BANK' ? '1102' : '2101',
        },
        taxLines: tax.taxCode && tax.tax.greaterThan(0) ? [{ taxCodeId: tax.taxCode.id, direction: 'INPUT', taxableBase: tax.net, taxAmount: tax.tax }] : [],
        context: { vehicleId: vehicle.id, tripId: dto.tripId, liters: dto.liters, odometer: dto.odometer, paymentMode, receiptNumber: dto.receiptNumber },
      });
      if (dto.odometer !== undefined && dto.odometer > vehicle.currentOdometer) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { currentOdometer: dto.odometer } });
        await tx.vehicleMeterReading.create({ data: {
          vehicleId: vehicle.id, value: new Prisma.Decimal(dto.odometer), recordedAt: transactionDate,
          sourceType: 'FuelTransaction', sourceId: fuel.id, recordedById: user.sub, evidenceReference: dto.evidenceReference,
        } });
      }
      const updated = await tx.fuelTransaction.update({ where: { id: fuel.id }, data: { accountingEventId: event.id } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'RECORD_FLEET_FUEL', entityType: 'FuelTransaction', entityId: fuel.id,
        payload: { branchId: scope.branchId, vehicleId: vehicle.id, tripId: dto.tripId, accountingEventId: event.id, transactionDate: transactionDate.toISOString() },
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listTrips(user: AuthUser, requestedCompanyId?: string, requestedBranchId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'DeliveryTrip');
    const trips = await this.prisma.deliveryTrip.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (!trips.length) return [];
    const tripIds = trips.map((row) => row.id);
    const vehicleIds = [...new Set(trips.map((row) => row.vehicleId))];
    const driverIds = [...new Set(trips.map((row) => row.driverEmployeeId))];
    const warehouseIds = [...new Set(trips.map((row) => row.originWarehouseId).filter(Boolean) as string[])];
    const inspectionIds = [...new Set(trips.flatMap((row) => [row.loadingInspectionId, row.preTripInspectionId, row.postTripInspectionId]).filter(Boolean) as string[])];
    const gatePassIds = [...new Set(trips.map((row) => row.gatePassId).filter(Boolean) as string[])];
    const [stops, manifestItems, vehicles, drivers, warehouses, inspections, gatePasses] = await Promise.all([
      this.prisma.deliveryStop.findMany({ where: { tripId: { in: tripIds } }, orderBy: [{ tripId: 'asc' }, { sequence: 'asc' }] }),
      this.prisma.deliveryManifestItem.findMany({ where: { tripId: { in: tripIds } }, orderBy: [{ tripId: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.vehicle.findMany({ where: { id: { in: vehicleIds }, companyId: scope.companyId, branchId: scope.branchId } }),
      this.prisma.employee.findMany({ where: { id: { in: driverIds }, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true, employeeNumber: true, fullName: true, isActive: true } }),
      warehouseIds.length ? this.prisma.warehouse.findMany({ where: { id: { in: warehouseIds }, branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
      inspectionIds.length ? this.prisma.operationalInspection.findMany({ where: { id: { in: inspectionIds }, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true, number: true, type: true, status: true, sourceType: true, sourceId: true, completedAt: true, approvedAt: true } }) : Promise.resolve([]),
      gatePassIds.length ? this.prisma.gatePass.findMany({ where: { id: { in: gatePassIds }, companyId: scope.companyId, branchId: scope.branchId } }) : Promise.resolve([]),
    ]);
    const shipmentIds = [...new Set([...stops.map((row) => row.shipmentId), ...manifestItems.map((row) => row.shipmentId)].filter(Boolean) as string[])];
    const productIds = [...new Set(manifestItems.map((row) => row.productId))];
    const [shipments, products] = await Promise.all([
      shipmentIds.length ? this.prisma.shipment.findMany({ where: { id: { in: shipmentIds }, warehouseId: { in: await this.prisma.warehouse.findMany({ where: { branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true } }).then((rows) => rows.map((row) => row.id)) } }, select: { id: true, number: true, orderId: true, saleId: true, warehouseId: true, status: true, trackingNumber: true, deliveryTripId: true, pickedUpAt: true, deliveredAt: true } }) : Promise.resolve([]),
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds }, companyId: scope.companyId }, select: { id: true, sku: true, name: true, barcode: true } }) : Promise.resolve([]),
    ]);
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
    const vehicleById = byId(vehicles); const driverById = byId(drivers); const warehouseById = byId(warehouses);
    const inspectionById = byId(inspections); const gatePassById = byId(gatePasses); const shipmentById = byId(shipments); const productById = byId(products);
    return trips.map((trip) => ({
      ...trip,
      vehicle: vehicleById.get(trip.vehicleId) ?? null,
      driver: driverById.get(trip.driverEmployeeId) ?? null,
      originWarehouse: trip.originWarehouseId ? warehouseById.get(trip.originWarehouseId) ?? null : null,
      loadingInspection: trip.loadingInspectionId ? inspectionById.get(trip.loadingInspectionId) ?? null : null,
      preTripInspection: trip.preTripInspectionId ? inspectionById.get(trip.preTripInspectionId) ?? null : null,
      postTripInspection: trip.postTripInspectionId ? inspectionById.get(trip.postTripInspectionId) ?? null : null,
      gatePass: trip.gatePassId ? gatePassById.get(trip.gatePassId) ?? null : null,
      stops: stops.filter((stop) => stop.tripId === trip.id).map((stop) => ({ ...stop, shipment: stop.shipmentId ? shipmentById.get(stop.shipmentId) ?? null : null })),
      manifestItems: manifestItems.filter((item) => item.tripId === trip.id).map((item) => ({ ...item, shipment: item.shipmentId ? shipmentById.get(item.shipmentId) ?? null : null, product: productById.get(item.productId) ?? null })),
    }));
  }

  async listFuel(user: AuthUser, requestedCompanyId?: string, requestedBranchId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'FuelTransaction');
    return this.prisma.fuelTransaction.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, orderBy: { transactionDate: 'desc' }, take: 300 });
  }

  async summary(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const [vehicles, activeTrips, fuelAgg, codAgg] = await Promise.all([
      this.prisma.vehicle.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, select: { status: true, currentOdometer: true } }),
      this.prisma.deliveryTrip.count({ where: { companyId: scope.companyId, branchId: scope.branchId, status: { notIn: ['CLOSED', 'CANCELLED'] } } }),
      this.prisma.fuelTransaction.aggregate({ where: { companyId: scope.companyId, branchId: scope.branchId }, _sum: { liters: true, totalAmount: true }, _count: { id: true } }),
      this.prisma.deliveryTrip.aggregate({ where: { companyId: scope.companyId, branchId: scope.branchId }, _sum: { codExpected: true, codCollected: true } }),
    ]);
    const codExpected = new Prisma.Decimal(codAgg._sum.codExpected ?? 0);
    const codCollected = new Prisma.Decimal(codAgg._sum.codCollected ?? 0);
    return {
      vehicleCount: vehicles.length,
      availableVehicles: vehicles.filter((row) => row.status === 'AVAILABLE').length,
      maintenanceVehicles: vehicles.filter((row) => row.status === 'MAINTENANCE').length,
      activeTrips,
      fuelTransactionCount: fuelAgg._count.id,
      fuelLiters: fuelAgg._sum.liters ?? new Prisma.Decimal(0),
      fuelCost: fuelAgg._sum.totalAmount ?? new Prisma.Decimal(0),
      codExpected,
      codCollected,
      codVariance: codExpected.sub(codCollected),
    };
  }
}
