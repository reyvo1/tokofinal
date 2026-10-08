import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { AuthUser } from '../auth/auth.types';
import { businessDateKey, zonedDateParts } from '../common/business-time';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceMethodDto, CreateAttendanceCorrectionDto, CreateAttendanceDeviceDto, CreateAttendanceEventDto, CreateAttendancePolicyDto, CreateGeofenceDto, CreateWorkShiftDto, EnrollBiometricDto, FingerprintEventDto, ReviewAttendanceCorrectionDto, UpdateAttendanceDeviceDto, UpdateAttendancePolicyDto, UpdateBiometricCredentialDto, UpdateGeofenceDto, UpdateWorkShiftDto, UploadAttendancePhotoDto, UpsertEmployeeScheduleDto } from './dto/attendance.dto';

function radians(value: number) { return value * Math.PI / 180; }
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earth = 6371000;
  const dLat = radians(lat2 - lat1); const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const ATTENDANCE_CORRECTION_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED']);
function validatedCorrectionStatus(status?: string): string | undefined {
  if (!status) return undefined;
  if (!ATTENDANCE_CORRECTION_STATUSES.has(status)) throw new BadRequestException('Status koreksi absensi tidak valid.');
  return status;
}
function logicalWorkDate(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new BadRequestException('Tanggal kerja harus berformat YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day) {
    throw new BadRequestException('Tanggal kerja tidak valid.');
  }
  return value;
}
function normalizeWorkDate(input: string | undefined, occurredAt: Date, timeZone: string) {
  return logicalWorkDate(input ?? businessDateKey(occurredAt, timeZone));
}

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Pengguna belum memiliki company dan branch yang valid.',
      });
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async companyTimeZone(scope: TenantScope): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: scope.companyId }, select: { timezone: true } });
    if (!company) {
      throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Company pengguna tidak ditemukan.' });
    }
    return company.timezone;
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
    entityType = 'AttendanceScope',
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

  private async scopedEmployee(client: DbClient, user: AuthUser, scope: TenantScope, employeeId: string) {
    const employee = await client.employee.findFirst({
      where: { id: employeeId, companyId: scope.companyId, branchId: scope.branchId, isActive: true },
    });
    if (!employee) return this.denyTenantAccess(client, user, scope, 'Employee', employeeId);
    return employee;
  }

  private async scopedDevice(client: DbClient, user: AuthUser, scope: TenantScope, deviceId: string) {
    const device = await client.attendanceDevice.findFirst({
      where: { id: deviceId, companyId: scope.companyId, branchId: scope.branchId, status: 'ACTIVE' },
    });
    if (!device) return this.denyTenantAccess(client, user, scope, 'AttendanceDevice', deviceId);
    return device;
  }

  private async scopedDeviceByCode(client: DbClient, user: AuthUser, scope: TenantScope, deviceCode: string) {
    const device = await client.attendanceDevice.findFirst({
      where: { companyId: scope.companyId, branchId: scope.branchId, code: deviceCode, status: 'ACTIVE' },
    });
    if (!device) return this.denyTenantAccess(client, user, scope, 'AttendanceDevice', undefined, {
      authenticatedCompanyId: scope.companyId,
      authenticatedBranchId: scope.branchId,
      requestedDeviceCode: deviceCode,
    });
    return device;
  }

  private async scopedGeofence(client: DbClient, user: AuthUser, scope: TenantScope, geofenceId: string) {
    const geofence = await client.attendanceGeofence.findFirst({
      where: {
        id: geofenceId,
        companyId: scope.companyId,
        isActive: true,
        OR: [{ branchId: scope.branchId }, { branchId: null }],
      },
    });
    if (!geofence) return this.denyTenantAccess(client, user, scope, 'AttendanceGeofence', geofenceId);
    return geofence;
  }

  private async existingEventForKey(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    key: { operationId: string } | { externalEventId: string },
  ) {
    const prior = await client.attendanceEvent.findFirst({
      where: { companyId: scope.companyId, ...key },
    });
    if (!prior) return null;
    if (prior.branchId !== scope.branchId) {
      return this.denyTenantAccess(client, user, scope, 'AttendanceEvent', prior.id, {
        authenticatedCompanyId: scope.companyId,
        authenticatedBranchId: scope.branchId,
        existingBranchId: prior.branchId,
        ...key,
      });
    }
    return prior;
  }

  async employeeConfig(user: AuthUser, employeeId: string) {
    const scope = this.requireTenantScope(user);
    await this.scopedEmployee(this.prisma, user, scope, employeeId);
    const [policy, geofences] = await Promise.all([
      this.prisma.attendancePolicy.findFirst({
        where: {
          companyId: scope.companyId,
          isActive: true,
          OR: [{ branchId: scope.branchId }, { branchId: null }],
        },
        orderBy: { branchId: 'desc' },
      }),
      this.prisma.attendanceGeofence.findMany({
        where: {
          companyId: scope.companyId,
          isActive: true,
          OR: [{ branchId: scope.branchId }, { branchId: null }],
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { policy, geofences };
  }

  async uploadLocalPhoto(user: AuthUser, dto: UploadAttendancePhotoDto) {
    const scope = this.requireTenantScope(user);
    const provider = this.config.get('ATTENDANCE_MEDIA_PROVIDER') ?? 'disabled';
    if (provider !== 'local') throw new BadRequestException('Upload lokal dinonaktifkan. Konfigurasikan object-storage media provider.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(dto.contentType)) throw new BadRequestException('Format foto harus JPEG, PNG, atau WebP.');
    const data = Buffer.from(dto.base64, 'base64');
    if (!data.length || data.length > 3 * 1024 * 1024) throw new BadRequestException('Ukuran foto maksimal 3 MB.');
    const extension = extname(dto.fileName).toLowerCase() || (dto.contentType === 'image/png' ? '.png' : '.jpg');
    const safeExtension = ['.jpg', '.jpeg', '.png', '.webp'].includes(extension) ? extension : '.jpg';
    const dateFolder = new Date().toISOString().slice(0, 10);
    const relativeDirectory = `attendance-media/${scope.companyId}/${scope.branchId}/${dateFolder}`;
    const directory = resolve(process.cwd(), 'data', relativeDirectory);
    await mkdir(directory, { recursive: true });
    const objectKey = `${relativeDirectory}/${randomUUID()}${safeExtension}`;
    await writeFile(resolve(process.cwd(), 'data', objectKey), data, { flag: 'wx' });
    return { objectKey, provider: 'local', productionSafe: false };
  }

  async createDevice(user: AuthUser, dto: CreateAttendanceDeviceDto) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'AttendanceDevice');
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.attendanceDevice.create({
        data: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          code: dto.code,
          name: dto.name,
          deviceType: dto.deviceType,
          vendor: dto.vendor,
          model: dto.model,
          serialNumber: dto.serialNumber,
          ipAddress: dto.ipAddress,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_ATTENDANCE_DEVICE',
          entityType: 'AttendanceDevice',
          entityId: device.id,
          payload: { branchId: scope.branchId, code: device.code },
        },
      });
      return device;
    });
  }

  async createGeofence(user: AuthUser, dto: CreateGeofenceDto) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'AttendanceGeofence');
    return this.prisma.$transaction(async (tx) => {
      const geofence = await tx.attendanceGeofence.create({
        data: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          code: dto.code,
          name: dto.name,
          latitude: dto.latitude,
          longitude: dto.longitude,
          radiusMeters: dto.radiusMeters,
          allowedAccuracyMeters: dto.allowedAccuracyMeters,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_ATTENDANCE_GEOFENCE',
          entityType: 'AttendanceGeofence',
          entityId: geofence.id,
          payload: { branchId: scope.branchId, code: geofence.code },
        },
      });
      return geofence;
    });
  }

  async enroll(user: AuthUser, dto: EnrollBiometricDto) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'EmployeeBiometricCredential');
    if (!dto.externalTemplateRef && !dto.templateHash) {
      throw new BadRequestException('Simpan reference/hash template, bukan fingerprint mentah.');
    }
    return this.prisma.$transaction(async (tx) => {
      const employee = await this.scopedEmployee(tx, user, scope, dto.employeeId);
      const device = dto.attendanceDeviceId
        ? await this.scopedDevice(tx, user, scope, dto.attendanceDeviceId)
        : undefined;
      const credential = await tx.employeeBiometricCredential.create({
        data: {
          companyId: scope.companyId,
          employeeId: employee.id,
          attendanceDeviceId: device?.id,
          biometricType: dto.biometricType as never,
          deviceUserCode: dto.deviceUserCode,
          externalTemplateRef: dto.externalTemplateRef,
          templateHash: dto.templateHash,
          enrolledAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'ENROLL_EMPLOYEE_BIOMETRIC',
          entityType: 'EmployeeBiometricCredential',
          entityId: credential.id,
          payload: {
            branchId: scope.branchId,
            employeeId: employee.id,
            ...(device ? { attendanceDeviceId: device.id } : {}),
          },
        },
      });
      return credential;
    });
  }

  async record(user: AuthUser, dto: CreateAttendanceEventDto) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'AttendanceEvent');
    if (dto.operationId) {
      const prior = await this.existingEventForKey(this.prisma, user, scope, { operationId: dto.operationId });
      if (prior) return prior;
    }
    if (dto.externalEventId) {
      const prior = await this.existingEventForKey(this.prisma, user, scope, { externalEventId: dto.externalEventId });
      if (prior) return prior;
    }

    const employee = await this.scopedEmployee(this.prisma, user, scope, dto.employeeId);
    const device = dto.deviceId ? await this.scopedDevice(this.prisma, user, scope, dto.deviceId) : undefined;

    let geofenceId: string | undefined;
    let distance: number | undefined; let inside: boolean | undefined;
    if (dto.geofenceId) {
      const geofence = await this.scopedGeofence(this.prisma, user, scope, dto.geofenceId);
      geofenceId = geofence.id;
      if (dto.latitude === undefined || dto.longitude === undefined) throw new BadRequestException('Koordinat wajib untuk absensi geofence.');
      if (geofence.allowedAccuracyMeters && (dto.accuracyMeters ?? Number.MAX_SAFE_INTEGER) > geofence.allowedAccuracyMeters) {
        throw new BadRequestException('Akurasi lokasi tidak memenuhi kebijakan absensi.');
      }
      distance = distanceMeters(dto.latitude, dto.longitude, Number(geofence.latitude), Number(geofence.longitude));
      inside = distance <= geofence.radiusMeters;
      if (!inside) throw new BadRequestException(`Lokasi berada di luar geofence (${Math.round(distance)} meter).`);
    }
    if (dto.method === 'SELFIE_GPS' && !dto.photoObjectKey) {
      throw new BadRequestException('Foto selfie wajib untuk metode SELFIE_GPS.');
    }

    const occurredAt = new Date(dto.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Waktu absensi tidak valid.');
    const timeZone = await this.companyTimeZone(scope);
    const workDate = normalizeWorkDate(dto.workDate, occurredAt, timeZone);

    return this.prisma.$transaction(async (tx) => {
      let photoEvidenceId: string | undefined;
      if (dto.photoObjectKey) {
        const evidence = await tx.attendancePhotoEvidence.create({
          data: {
            companyId: scope.companyId,
            employeeId: employee.id,
            objectKey: dto.photoObjectKey,
            capturedAt: occurredAt,
            latitude: dto.latitude,
            longitude: dto.longitude,
            livenessScore: dto.livenessScore,
            faceMatchScore: dto.faceMatchScore,
            retentionUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
          },
        });
        photoEvidenceId = evidence.id;
      }
      const event = await tx.attendanceEvent.create({
        data: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          employeeId: employee.id,
          eventType: dto.eventType as never,
          method: dto.method as never,
          occurredAt,
          deviceId: device?.id,
          geofenceId,
          operationId: dto.operationId,
          externalEventId: dto.externalEventId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: dto.accuracyMeters,
          distanceMeters: distance,
          insideGeofence: inside,
          photoEvidenceId,
          livenessScore: dto.livenessScore,
          faceMatchScore: dto.faceMatchScore,
          sourcePayload: dto.sourcePayload as Prisma.InputJsonValue | undefined,
        },
      });
      const current = await tx.attendanceRecord.findUnique({
        where: { employeeId_workDate: { employeeId: employee.id, workDate } },
      });
      if (current && (current.companyId !== scope.companyId || current.branchId !== scope.branchId)) {
        return this.denyTenantAccess(tx, user, scope, 'AttendanceRecord', current.id, {
          authenticatedCompanyId: scope.companyId,
          authenticatedBranchId: scope.branchId,
          existingCompanyId: current.companyId,
          existingBranchId: current.branchId,
        });
      }
      const data: Record<string, unknown> = {
        companyId: scope.companyId,
        branchId: scope.branchId,
        employeeId: employee.id,
        workDate,
        status: 'PRESENT',
        sourceVersion: (current?.sourceVersion ?? 0) + 1,
        calculatedAt: new Date(),
      };
      if (dto.eventType === 'CHECK_IN' && (!current?.firstCheckInAt || occurredAt < current.firstCheckInAt)) data.firstCheckInAt = occurredAt;
      if (dto.eventType === 'CHECK_OUT' && (!current?.lastCheckOutAt || occurredAt > current.lastCheckOutAt)) data.lastCheckOutAt = occurredAt;
      await tx.attendanceRecord.upsert({
        where: { employeeId_workDate: { employeeId: employee.id, workDate } },
        create: data as never,
        update: data as never,
      });
      const grouped = await tx.attendanceRecord.groupBy({
        by: ['status'],
        where: { companyId: scope.companyId, branchId: scope.branchId, workDate },
        _count: { _all: true },
        _sum: { workedMinutes: true, overtimeMinutes: true },
      });
      const summary = {
        scheduledCount: await tx.employeeSchedule.count({
          where: { companyId: scope.companyId, branchId: scope.branchId, workDate, isDayOff: false },
        }),
        presentCount: grouped.filter((row) => ['PRESENT', 'LATE', 'EARLY_LEAVE'].includes(row.status)).reduce((sum, row) => sum + row._count._all, 0),
        lateCount: grouped.find((row) => row.status === 'LATE')?._count._all ?? 0,
        absentCount: grouped.find((row) => row.status === 'ABSENT')?._count._all ?? 0,
        leaveCount: grouped.filter((row) => ['LEAVE', 'SICK'].includes(row.status)).reduce((sum, row) => sum + row._count._all, 0),
        incompleteCount: grouped.filter((row) => ['INCOMPLETE', 'NEEDS_REVIEW'].includes(row.status)).reduce((sum, row) => sum + row._count._all, 0),
        workedMinutes: grouped.reduce((sum, row) => sum + (row._sum.workedMinutes ?? 0), 0),
        overtimeMinutes: grouped.reduce((sum, row) => sum + (row._sum.overtimeMinutes ?? 0), 0),
      };
      const existingSummary = await tx.dailyAttendanceSummary.findFirst({
        where: { companyId: scope.companyId, branchId: scope.branchId, businessDate: workDate },
      });
      if (existingSummary) {
        await tx.dailyAttendanceSummary.update({ where: { id: existingSummary.id }, data: summary });
      } else {
        await tx.dailyAttendanceSummary.create({
          data: { companyId: scope.companyId, branchId: scope.branchId, businessDate: workDate, ...summary },
        });
      }
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'RECORD_ATTENDANCE_EVENT',
          entityType: 'AttendanceEvent',
          entityId: event.id,
          payload: {
            branchId: scope.branchId,
            employeeId: employee.id,
            eventType: dto.eventType,
            method: dto.method,
            ...(device ? { deviceId: device.id } : {}),
          },
        },
      });
      return event;
    }).catch((error: unknown) => {
      if (error instanceof ConflictException) throw error;
      throw error;
    });
  }

  async ingestFingerprint(user: AuthUser, dto: FingerprintEventDto) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'AttendanceDeviceEvent');
    const device = await this.scopedDeviceByCode(this.prisma, user, scope, dto.deviceCode);
    const credential = await this.prisma.employeeBiometricCredential.findFirst({
      where: {
        companyId: scope.companyId,
        attendanceDeviceId: device.id,
        deviceUserCode: dto.deviceUserCode,
        status: 'ACTIVE',
      },
    });
    if (!credential) {
      return this.denyTenantAccess(this.prisma, user, scope, 'EmployeeBiometricCredential', undefined, {
        authenticatedCompanyId: scope.companyId,
        authenticatedBranchId: scope.branchId,
        attendanceDeviceId: device.id,
        deviceUserCode: dto.deviceUserCode,
      });
    }
    await this.scopedEmployee(this.prisma, user, scope, credential.employeeId);
    return this.record(user, {
      companyId: scope.companyId,
      branchId: scope.branchId,
      employeeId: credential.employeeId,
      eventType: dto.eventType,
      method: AttendanceMethodDto.FINGERPRINT,
      occurredAt: dto.occurredAt,
      deviceId: device.id,
      externalEventId: dto.externalEventId,
      sourcePayload: dto.sourcePayload,
    });
  }

  async listEmployee(user: AuthUser, employeeId: string, limitInput?: string, cursorInput?: string) {
    const scope = this.requireTenantScope(user);
    const employee = await this.scopedEmployee(this.prisma, user, scope, employeeId);
    const limit = parsePageLimit(limitInput);
    const cursor = decodeCursor<{ workDate: string; id: string }>(cursorInput);
    const items = await this.prisma.attendanceRecord.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        employeeId: employee.id,
        ...(cursor ? {
          OR: [
            { workDate: { lt: new Date(cursor.workDate) } },
            { workDate: new Date(cursor.workDate), id: { lt: cursor.id } },
          ],
        } : {}),
      },
      orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(items, limit, (item) => ({ workDate: item.workDate.toISOString(), id: item.id }));
  }

  async listWorkShifts(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.workShift.findMany({
      where: { companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  private validateShift(dto: CreateWorkShiftDto | UpdateWorkShiftDto) {
    if (dto.startMinute === dto.endMinute && !dto.crossesMidnight) throw new BadRequestException('Jam mulai dan selesai shift tidak boleh sama kecuali shift lintas tengah malam.');
    const span = dto.crossesMidnight
      ? (1440 - dto.startMinute) + dto.endMinute
      : dto.endMinute - dto.startMinute;
    if (span <= 0 || span > 1440) throw new BadRequestException('Rentang WorkShift tidak valid.');
    if ((dto.breakMinutes ?? 0) >= span) throw new BadRequestException('Durasi istirahat harus lebih kecil dari durasi shift.');
  }

  async createWorkShift(user: AuthUser, dto: CreateWorkShiftDto) {
    const scope = this.requireTenantScope(user);
    this.validateShift(dto);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.workShift.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, code: dto.code.trim(), name: dto.name.trim(),
        startMinute: dto.startMinute, endMinute: dto.endMinute, crossesMidnight: dto.crossesMidnight ?? false,
        breakMinutes: dto.breakMinutes ?? 0, lateToleranceMinutes: dto.lateToleranceMinutes ?? 0,
        earlyLeaveToleranceMinutes: dto.earlyLeaveToleranceMinutes ?? 0, minimumWorkMinutes: dto.minimumWorkMinutes,
        overtimeAfterMinutes: dto.overtimeAfterMinutes,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_WORK_SHIFT', entityType: 'WorkShift', entityId: row.id, payload: { branchId: scope.branchId, code: row.code } } });
      return row;
    });
  }

  async updateWorkShift(user: AuthUser, id: string, dto: UpdateWorkShiftDto) {
    const scope = this.requireTenantScope(user);
    this.validateShift(dto);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.workShift.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!current) return this.denyTenantAccess(tx, user, scope, 'WorkShift', id);
      const row = await tx.workShift.update({ where: { id }, data: {
        code: dto.code.trim(), name: dto.name.trim(), startMinute: dto.startMinute, endMinute: dto.endMinute,
        crossesMidnight: dto.crossesMidnight ?? false, breakMinutes: dto.breakMinutes ?? 0,
        lateToleranceMinutes: dto.lateToleranceMinutes ?? 0, earlyLeaveToleranceMinutes: dto.earlyLeaveToleranceMinutes ?? 0,
        minimumWorkMinutes: dto.minimumWorkMinutes, overtimeAfterMinutes: dto.overtimeAfterMinutes, isActive: dto.isActive ?? current.isActive,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_WORK_SHIFT', entityType: 'WorkShift', entityId: id, payload: { branchId: scope.branchId, isActive: row.isActive } } });
      return row;
    });
  }

  async listSchedules(user: AuthUser, from?: string, to?: string, employeeId?: string) {
    const scope = this.requireTenantScope(user);
    if (employeeId) await this.scopedEmployee(this.prisma, user, scope, employeeId);
    const timeZone = await this.companyTimeZone(scope);
    const nowParts = zonedDateParts(new Date(), timeZone);
    const defaultFrom = logicalWorkDate(`${nowParts.year.toString().padStart(4, '0')}-${nowParts.month.toString().padStart(2, '0')}-01`);
    const defaultTo = new Date(Date.UTC(nowParts.year, nowParts.month, 0));
    const fromDate = from ? logicalWorkDate(from) : defaultFrom;
    const toDate = to ? logicalWorkDate(to) : defaultTo;
    if (toDate < fromDate) throw new BadRequestException('Tanggal akhir roster tidak boleh sebelum tanggal awal.');
    return this.prisma.employeeSchedule.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId, workDate: { gte: fromDate, lte: toDate }, ...(employeeId ? { employeeId } : {}) },
      orderBy: [{ workDate: 'asc' }, { employeeId: 'asc' }], take: 1000,
    });
  }

  async upsertSchedule(user: AuthUser, dto: UpsertEmployeeScheduleDto) {
    const scope = this.requireTenantScope(user);
    const employee = await this.scopedEmployee(this.prisma, user, scope, dto.employeeId);
    const workDate = logicalWorkDate(dto.workDate.slice(0, 10));
    if (dto.isDayOff && dto.shiftId) throw new BadRequestException('Hari libur tidak boleh sekaligus memiliki shift.');
    if (!dto.isDayOff && !dto.shiftId) throw new BadRequestException('Roster hari kerja wajib memilih WorkShift.');
    if (dto.shiftId) {
      const shift = await this.prisma.workShift.findFirst({ where: { id: dto.shiftId, companyId: scope.companyId, isActive: true, OR: [{ branchId: scope.branchId }, { branchId: null }] } });
      if (!shift) await this.denyTenantAccess(this.prisma, user, scope, 'WorkShift', dto.shiftId);
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.employeeSchedule.upsert({
        where: { employeeId_workDate: { employeeId: employee.id, workDate } },
        create: { companyId: scope.companyId, branchId: scope.branchId, employeeId: employee.id, shiftId: dto.shiftId, workDate, isDayOff: dto.isDayOff ?? false, source: 'ROSTER', notes: dto.notes },
        update: { branchId: scope.branchId, shiftId: dto.shiftId ?? null, isDayOff: dto.isDayOff ?? false, source: 'ROSTER', notes: dto.notes },
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPSERT_EMPLOYEE_SCHEDULE', entityType: 'EmployeeSchedule', entityId: row.id, payload: { branchId: scope.branchId, employeeId: employee.id, workDate: workDate.toISOString(), shiftId: dto.shiftId ?? null, isDayOff: row.isDayOff } } });
      return row;
    });
  }

  async listPolicies(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.attendancePolicy.findMany({ where: { companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] }, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
  }

  private policyData(dto: CreateAttendancePolicyDto | UpdateAttendancePolicyDto) {
    const allowedMethods = [...new Set(dto.allowedMethods.map(String))];
    if (!allowedMethods.length) throw new BadRequestException('AttendancePolicy wajib memiliki minimal satu metode absensi.');
    return {
      code: dto.code.trim(), name: dto.name.trim(), allowedMethods,
      requirePhoto: dto.requirePhoto ?? false, requireLocation: dto.requireLocation ?? false,
      requireLiveness: dto.requireLiveness ?? false, allowOutsideGeofence: dto.allowOutsideGeofence ?? false,
      maxLocationAccuracyMeters: dto.maxLocationAccuracyMeters, duplicateWindowSeconds: dto.duplicateWindowSeconds ?? 60,
      offlineAllowed: dto.offlineAllowed ?? true, rules: dto.rules as Prisma.InputJsonValue | undefined,
    };
  }

  async createPolicy(user: AuthUser, dto: CreateAttendancePolicyDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.attendancePolicy.create({ data: { companyId: scope.companyId, branchId: scope.branchId, ...this.policyData(dto) } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_ATTENDANCE_POLICY', entityType: 'AttendancePolicy', entityId: row.id, payload: { branchId: scope.branchId, code: row.code } } });
      return row;
    });
  }

  async updatePolicy(user: AuthUser, id: string, dto: UpdateAttendancePolicyDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.attendancePolicy.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!current) return this.denyTenantAccess(tx, user, scope, 'AttendancePolicy', id);
      const row = await tx.attendancePolicy.update({ where: { id }, data: { ...this.policyData(dto), isActive: dto.isActive ?? current.isActive } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_ATTENDANCE_POLICY', entityType: 'AttendancePolicy', entityId: id, payload: { branchId: scope.branchId, isActive: row.isActive } } });
      return row;
    });
  }

  async listCorrections(user: AuthUser, status?: string, employeeId?: string) {
    const scope = this.requireTenantScope(user);
    const validatedStatus = validatedCorrectionStatus(status);
    if (employeeId) await this.scopedEmployee(this.prisma, user, scope, employeeId);
    const employees = await this.prisma.employee.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } });
    return this.prisma.attendanceCorrection.findMany({ where: { companyId: scope.companyId, employeeId: { in: employees.map((e) => e.id) }, ...(employeeId ? { employeeId } : {}), ...(validatedStatus ? { status: validatedStatus as never } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 300 });
  }

  async submitCorrection(user: AuthUser, dto: CreateAttendanceCorrectionDto) {
    const scope = this.requireTenantScope(user);
    const employee = await this.scopedEmployee(this.prisma, user, scope, dto.employeeId);
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.findFirst({ where: { id: dto.attendanceRecordId, companyId: scope.companyId, branchId: scope.branchId, employeeId: employee.id } });
      if (!record) return this.denyTenantAccess(tx, user, scope, 'AttendanceRecord', dto.attendanceRecordId);
      if (record.lockedAt) throw new BadRequestException('AttendanceRecord sudah dikunci payroll; gunakan payroll adjustment workflow, bukan koreksi absensi langsung.');
      const duplicate = await tx.attendanceCorrection.findFirst({ where: { companyId: scope.companyId, attendanceRecordId: record.id, status: 'SUBMITTED' } });
      if (duplicate) throw new ConflictException('AttendanceRecord sudah memiliki koreksi SUBMITTED yang belum diputuskan.');
      const row = await tx.attendanceCorrection.create({ data: { companyId: scope.companyId, employeeId: employee.id, attendanceRecordId: record.id, requestedById: user.sub, reason: dto.reason.trim(), proposedData: dto.proposedData as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'SUBMIT_ATTENDANCE_CORRECTION', entityType: 'AttendanceCorrection', entityId: row.id, payload: { branchId: scope.branchId, employeeId: employee.id, attendanceRecordId: record.id } } });
      return row;
    });
  }

  private correctionPatch(value: unknown): Prisma.AttendanceRecordUpdateInput {
    const proposed = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const patch: Prisma.AttendanceRecordUpdateInput = {};
    for (const key of ['workedMinutes','breakMinutes','lateMinutes','earlyLeaveMinutes','overtimeMinutes'] as const) {
      if (proposed[key] !== undefined) {
        const n = Number(proposed[key]);
        if (!Number.isInteger(n) || n < 0) throw new BadRequestException(`${key} koreksi harus bilangan bulat >= 0.`);
        patch[key] = n;
      }
    }
    for (const key of ['firstCheckInAt','lastCheckOutAt'] as const) {
      if (proposed[key] !== undefined) {
        if (proposed[key] === null) patch[key] = null;
        else {
          const date = new Date(String(proposed[key]));
          if (Number.isNaN(date.getTime())) throw new BadRequestException(`${key} koreksi tidak valid.`);
          patch[key] = date;
        }
      }
    }
    if (proposed.status !== undefined) {
      const allowed = new Set(['PRESENT','LATE','EARLY_LEAVE','ABSENT','LEAVE','SICK','HOLIDAY','OFF_DAY','INCOMPLETE','NEEDS_REVIEW']);
      if (!allowed.has(String(proposed.status))) throw new BadRequestException('Status AttendanceRecord koreksi tidak didukung.');
      patch.status = String(proposed.status) as never;
    }
    if (proposed.notes !== undefined) patch.notes = proposed.notes == null ? null : String(proposed.notes);
    if (!Object.keys(patch).length) throw new BadRequestException('proposedData tidak memiliki field AttendanceRecord yang dapat dikoreksi.');
    patch.sourceVersion = { increment: 1 };
    patch.calculatedAt = new Date();
    return patch;
  }

  async reviewCorrection(user: AuthUser, id: string, dto: ReviewAttendanceCorrectionDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const correction = await tx.attendanceCorrection.findFirst({ where: { id, companyId: scope.companyId, status: 'SUBMITTED' } });
      if (!correction) throw new BadRequestException('AttendanceCorrection tidak ditemukan atau sudah diputuskan.');
      const employee = await this.scopedEmployee(tx, user, scope, correction.employeeId);
      const record = correction.attendanceRecordId ? await tx.attendanceRecord.findFirst({ where: { id: correction.attendanceRecordId, companyId: scope.companyId, branchId: scope.branchId, employeeId: employee.id } }) : null;
      if (!record) return this.denyTenantAccess(tx, user, scope, 'AttendanceRecord', correction.attendanceRecordId ?? undefined);
      if (record.lockedAt) throw new BadRequestException('AttendanceRecord sudah dikunci payroll; koreksi tidak boleh mengubah periode payroll terkunci.');
      if (dto.status === 'APPROVED') await tx.attendanceRecord.update({ where: { id: record.id }, data: this.correctionPatch(correction.proposedData) });
      const row = await tx.attendanceCorrection.update({ where: { id }, data: { status: dto.status as never, reviewedById: user.sub, reviewedAt: new Date(), reviewNotes: dto.reviewNotes } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: dto.status === 'APPROVED' ? 'APPROVE_ATTENDANCE_CORRECTION' : 'REJECT_ATTENDANCE_CORRECTION', entityType: 'AttendanceCorrection', entityId: id, payload: { branchId: scope.branchId, employeeId: employee.id, attendanceRecordId: record.id, reviewNotes: dto.reviewNotes } } });
      return row;
    });
  }

  async listDevices(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.attendanceDevice.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, orderBy: [{ status: 'asc' }, { code: 'asc' }] });
  }

  async updateDevice(user: AuthUser, id: string, dto: UpdateAttendanceDeviceDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.attendanceDevice.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!current) return this.denyTenantAccess(tx, user, scope, 'AttendanceDevice', id);
      const row = await tx.attendanceDevice.update({ where: { id }, data: { name: dto.name, vendor: dto.vendor, model: dto.model, serialNumber: dto.serialNumber, ipAddress: dto.ipAddress, status: dto.status } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_ATTENDANCE_DEVICE', entityType: 'AttendanceDevice', entityId: id, payload: { branchId: scope.branchId, status: row.status } } });
      return row;
    });
  }

  async listGeofences(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.attendanceGeofence.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
  }

  async updateGeofence(user: AuthUser, id: string, dto: UpdateGeofenceDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.attendanceGeofence.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!current) return this.denyTenantAccess(tx, user, scope, 'AttendanceGeofence', id);
      const row = await tx.attendanceGeofence.update({ where: { id }, data: { name: dto.name, latitude: dto.latitude, longitude: dto.longitude, radiusMeters: dto.radiusMeters, allowedAccuracyMeters: dto.allowedAccuracyMeters, isActive: dto.isActive } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_ATTENDANCE_GEOFENCE', entityType: 'AttendanceGeofence', entityId: id, payload: { branchId: scope.branchId, isActive: row.isActive } } });
      return row;
    });
  }

  async listBiometrics(user: AuthUser, employeeId?: string) {
    const scope = this.requireTenantScope(user);
    if (employeeId) await this.scopedEmployee(this.prisma, user, scope, employeeId);
    const employees = await this.prisma.employee.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } });
    return this.prisma.employeeBiometricCredential.findMany({ where: { companyId: scope.companyId, employeeId: { in: employees.map((e) => e.id) }, ...(employeeId ? { employeeId } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  async updateBiometric(user: AuthUser, id: string, dto: UpdateBiometricCredentialDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const employees = await tx.employee.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } });
      const current = await tx.employeeBiometricCredential.findFirst({ where: { id, companyId: scope.companyId, employeeId: { in: employees.map((e) => e.id) } } });
      if (!current) return this.denyTenantAccess(tx, user, scope, 'EmployeeBiometricCredential', id);
      const row = await tx.employeeBiometricCredential.update({ where: { id }, data: { status: dto.revoke ? 'REVOKED' : dto.status, revokedAt: dto.revoke ? new Date() : undefined } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: dto.revoke ? 'REVOKE_BIOMETRIC_CREDENTIAL' : 'UPDATE_BIOMETRIC_CREDENTIAL', entityType: 'EmployeeBiometricCredential', entityId: id, payload: { branchId: scope.branchId, employeeId: row.employeeId, status: row.status } } });
      return row;
    });
  }

}
