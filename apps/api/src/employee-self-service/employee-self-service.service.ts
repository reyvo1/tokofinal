import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { AuthUser } from '../auth/auth.types';
import { HrService } from '../hr/hr.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestChannelBindingDto, SubmitAttendanceCorrectionDto, UpdateNotificationPreferenceDto, VerifyChannelBindingDto } from './employee-self-service.dto';

const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');


const toPrismaJsonValue = (value: unknown): Prisma.InputJsonValue | null => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map((item) => toPrismaJsonValue(item));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
      if (nestedValue === undefined) {
        throw new BadRequestException(`Nilai JSON untuk field ${key} tidak boleh undefined.`);
      }
      return [key, toPrismaJsonValue(nestedValue)] as const;
    });
    const objectValue: Prisma.InputJsonObject = Object.fromEntries(entries);
    return objectValue;
  }

  throw new BadRequestException('Payload koreksi absensi harus berupa nilai JSON yang valid.');
};

@Injectable()
export class EmployeeSelfServiceService {
  constructor(
    private readonly hr: HrService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async requestBinding(user: AuthUser, dto: RequestChannelBindingDto) {
    const employee = await this.hr.byUserId(user);
    const normalized = dto.externalUserId.trim();
    if (!normalized) throw new BadRequestException('Alamat kanal tidak boleh kosong.');
    const addressHash = sha256(`${dto.channel}:${normalized}`);
    const code = String(randomInt(100000, 1000000));
    const tokenHash = sha256(code);
    const existing = await this.prisma.employeeChannelBinding.findFirst({
      where: { companyId: employee.companyId, employeeId: employee.id, channel: dto.channel as never, addressHash },
    });
    const binding = existing
      ? await this.prisma.employeeChannelBinding.update({
        where: { id: existing.id },
        data: { externalUserId: normalized, verificationTokenHash: tokenHash, verifiedAt: null, revokedAt: null },
      })
      : await this.prisma.employeeChannelBinding.create({
        data: {
          companyId: employee.companyId, employeeId: employee.id, channel: dto.channel as never,
          addressHash, externalUserId: normalized, verificationTokenHash: tokenHash,
        },
      });
    await this.prisma.notification.create({ data: {
      companyId: employee.companyId, channel: dto.channel, recipient: normalized, templateCode: 'CHANNEL_VERIFICATION',
      subject: 'Kode verifikasi kanal karyawan', body: `Kode verifikasi Toko360 Anda: ${code}. Jangan berikan kode ini kepada orang lain.`,
      data: { employeeId: employee.id, bindingId: binding.id },
    } });
    return {
      bindingId: binding.id,
      status: 'VERIFICATION_QUEUED',
      ...(this.config.get('NODE_ENV') === 'production' ? {} : { developmentCode: code }),
    };
  }

  async verifyBinding(user: AuthUser, dto: VerifyChannelBindingDto) {
    const employee = await this.hr.byUserId(user);
    const addressHash = sha256(`${dto.channel}:${dto.externalUserId.trim()}`);
    const binding = await this.prisma.employeeChannelBinding.findFirst({
      where: {
        companyId: employee.companyId, employeeId: employee.id,
        channel: dto.channel as never, addressHash, revokedAt: null,
      },
    });
    if (!binding?.verificationTokenHash || binding.verificationTokenHash !== sha256(dto.code)) {
      throw new BadRequestException('Kode verifikasi tidak valid.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.employeeChannelBinding.updateMany({
        where: { companyId: employee.companyId, employeeId: employee.id, channel: dto.channel as never, id: { not: binding.id } },
        data: { isPrimary: false },
      });
      const verified = await tx.employeeChannelBinding.update({
        where: { id: binding.id },
        data: { verifiedAt: new Date(), verificationTokenHash: null, isPrimary: true },
      });
      await tx.auditLog.create({ data: { companyId: employee.companyId, userId: user.sub, action: 'VERIFY_EMPLOYEE_CHANNEL', entityType: 'EmployeeChannelBinding', entityId: verified.id, payload: { branchId: employee.branchId, employeeId: employee.id, channel: dto.channel } } });
      return verified;
    });
  }

  async updatePreference(user: AuthUser, dto: UpdateNotificationPreferenceDto) {
    const employee = await this.hr.byUserId(user);
    if ((dto.enabled ?? true) && ['TELEGRAM', 'WHATSAPP', 'EMAIL', 'SMS'].includes(dto.channel)) {
      const verified = await this.prisma.employeeChannelBinding.findFirst({ where: { companyId: employee.companyId, employeeId: employee.id, channel: dto.channel as never, verifiedAt: { not: null }, revokedAt: null } });
      if (!verified) throw new BadRequestException(`Kanal ${dto.channel} harus diverifikasi sebelum preferensi delivery diaktifkan.`);
    }
    return this.prisma.employeeNotificationPreference.upsert({
      where: {
        employeeId_eventCode_channel: {
          employeeId: employee.id,
          eventCode: dto.eventCode,
          channel: dto.channel as never,
        },
      },
      create: {
        companyId: employee.companyId, employeeId: employee.id,
        eventCode: dto.eventCode, channel: dto.channel as never, enabled: dto.enabled ?? true,
      },
      update: { enabled: dto.enabled ?? true },
    });
  }

  async channelState(user: AuthUser) {
    const employee = await this.hr.byUserId(user);
    return this.prisma.employeeChannelBinding.findMany({
      where: { companyId: employee.companyId, employeeId: employee.id, revokedAt: null },
      select: { id: true, channel: true, externalUserId: true, verifiedAt: true, isPrimary: true, createdAt: true },
      orderBy: [{ channel: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async preferences(user: AuthUser) {
    const employee = await this.hr.byUserId(user);
    return this.prisma.employeeNotificationPreference.findMany({
      where: { companyId: employee.companyId, employeeId: employee.id },
      orderBy: [{ eventCode: 'asc' }, { channel: 'asc' }],
    });
  }

  async corrections(user: AuthUser) {
    const employee = await this.hr.byUserId(user);
    return this.prisma.attendanceCorrection.findMany({
      where: { companyId: employee.companyId, employeeId: employee.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    });
  }

  async submitAttendanceCorrection(user: AuthUser, dto: SubmitAttendanceCorrectionDto) {
    const employee = await this.hr.byUserId(user);
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.findFirst({ where: { id: dto.attendanceRecordId, companyId: employee.companyId, branchId: employee.branchId, employeeId: employee.id } });
      if (!record) throw new BadRequestException('AttendanceRecord tidak ditemukan pada akun karyawan aktif.');
      if (record.lockedAt) throw new BadRequestException('Absensi sudah dikunci payroll; ajukan payroll adjustment melalui HR setelah koreksi administratif diverifikasi.');
      const pending = await tx.attendanceCorrection.findFirst({ where: { companyId: employee.companyId, employeeId: employee.id, attendanceRecordId: record.id, status: 'SUBMITTED' } });
      if (pending) throw new BadRequestException('Koreksi untuk tanggal ini sudah diajukan dan belum diputuskan.');
      const allowed = new Set(['firstCheckInAt','lastCheckOutAt','workedMinutes','breakMinutes','lateMinutes','earlyLeaveMinutes','overtimeMinutes','status','notes']);
      const proposedEntries = Object.entries(dto.proposedData)
        .filter(([key]) => allowed.has(key))
        .map(([key, value]) => {
          if (value === undefined) throw new BadRequestException(`Nilai koreksi ${key} tidak boleh undefined.`);
          return [key, toPrismaJsonValue(value)] as const;
        });
      const proposed: Prisma.InputJsonObject = Object.fromEntries(proposedEntries);
      if (!Object.keys(proposed).length) throw new BadRequestException('Tidak ada field absensi yang dapat dikoreksi.');
      const row = await tx.attendanceCorrection.create({ data: { companyId: employee.companyId, employeeId: employee.id, attendanceRecordId: record.id, requestedById: user.sub, reason: dto.reason.trim(), proposedData: proposed } });
      await tx.auditLog.create({ data: { companyId: employee.companyId, userId: user.sub, action: 'SUBMIT_SELF_ATTENDANCE_CORRECTION', entityType: 'AttendanceCorrection', entityId: row.id, payload: { branchId: employee.branchId, employeeId: employee.id, attendanceRecordId: record.id } } });
      return row;
    });
  }

}
