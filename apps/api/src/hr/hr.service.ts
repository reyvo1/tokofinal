import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto, CreateEmployeeAssignmentDto, CreateEmployeeDto, CreateLeaveRequestDto, CreateLeaveTypeDto, CreateOvertimeRequestDto, CreatePositionDto, ReviewHrRequestDto, ReviewOvertimeRequestDto, UpdateEmployeeDto } from './dto/hr.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
const HR_REQUEST_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED']);

function validatedHrRequestStatus(status?: string): string | undefined {
  if (!status) return undefined;
  if (!HR_REQUEST_STATUSES.has(status)) throw new BadRequestException('Status pengajuan HR tidak valid.');
  return status;
}

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

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
        payload: payload ?? { authenticatedCompanyId: scope.companyId, authenticatedBranchId: scope.branchId },
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
    entityType = 'HrScope',
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

  private async assertDepartment(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    departmentId?: string | null,
  ): Promise<void> {
    if (!departmentId) return;
    const department = await client.department.findFirst({
      where: { id: departmentId, companyId: scope.companyId, isActive: true },
      select: { id: true },
    });
    if (!department) await this.denyTenantAccess(client, user, scope, 'Department', departmentId);
  }

  private async assertPosition(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    positionId?: string | null,
  ): Promise<void> {
    if (!positionId) return;
    const position = await client.position.findFirst({
      where: { id: positionId, companyId: scope.companyId, isActive: true },
      select: { id: true },
    });
    if (!position) await this.denyTenantAccess(client, user, scope, 'Position', positionId);
  }

  private async assertUserBranch(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    userId?: string | null,
  ): Promise<void> {
    if (!userId) return;
    const account = await client.user.findFirst({
      where: { id: userId, branchId: scope.branchId, isActive: true },
      select: { id: true },
    });
    if (!account) await this.denyTenantAccess(client, user, scope, 'User', userId);
  }

  async listEmployees(
    user: AuthUser,
    limitInput?: string,
    cursor?: string,
    requestedBranchId?: string,
    search?: string,
    requestedCompanyId?: string,
  ) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'Employee');
    const limit = parsePageLimit(limitInput);
    const decodedCursor = decodeCursor<{ id: string }>(cursor);
    const items = await this.prisma.employee.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        ...(search ? { OR: [
          { employeeNumber: { contains: search } },
          { fullName: { contains: search } },
          { email: { contains: search } },
        ] } : {}),
        ...(decodedCursor ? { id: { gt: decodedCursor.id } } : {}),
      },
      orderBy: [{ id: 'asc' }], take: limit + 1,
    });
    return toCursorPage(items, limit, (item) => ({ id: item.id }));
  }

  async createEmployee(dto: CreateEmployeeDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'Employee');
    return this.prisma.$transaction(async (tx) => {
      await this.assertDepartment(tx, user, scope, dto.departmentId);
      await this.assertPosition(tx, user, scope, dto.positionId);
      await this.assertUserBranch(tx, user, scope, dto.userId);
      const company = await tx.company.findUnique({ where: { id: scope.companyId }, select: { timezone: true } });
      if (!company) return this.denyTenantAccess(tx, user, scope, 'Company', scope.companyId);
      const employee = await tx.employee.create({
        data: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          userId: dto.userId,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          employeeNumber: dto.employeeNumber,
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          employmentStatus: dto.employmentStatus as never,
          hireDate: new Date(dto.hireDate),
          contractEnd: dto.contractEnd ? new Date(dto.contractEnd) : undefined,
          timezone: dto.timezone?.trim() || company.timezone,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_EMPLOYEE',
          entityType: 'Employee',
          entityId: employee.id,
          payload: { branchId: scope.branchId, employeeNumber: employee.employeeNumber },
        },
      });
      return employee;
    });
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, undefined, dto.branchId, 'Employee');
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id, companyId: scope.companyId, branchId: scope.branchId },
      });
      if (!employee) {
        const exists = await tx.employee.findUnique({ where: { id }, select: { id: true } });
        if (exists) await this.denyTenantAccess(tx, user, scope, 'Employee', id);
        throw new NotFoundException('Karyawan tidak ditemukan.');
      }
      await this.assertDepartment(tx, user, scope, dto.departmentId);
      await this.assertPosition(tx, user, scope, dto.positionId);
      await this.assertUserBranch(tx, user, scope, dto.userId);
      const updated = await tx.employee.update({
        where: { id },
        data: {
          userId: dto.userId,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          employmentStatus: dto.employmentStatus as never,
          isActive: dto.isActive,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'UPDATE_EMPLOYEE',
          entityType: 'Employee',
          entityId: id,
          payload: { branchId: scope.branchId },
        },
      });
      return updated;
    });
  }

  async createDepartment(dto: CreateDepartmentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'Department');
    return this.prisma.$transaction(async (tx) => {
      await this.assertDepartment(tx, user, scope, dto.parentId);
      const department = await tx.department.create({
        data: { companyId: scope.companyId, code: dto.code, name: dto.name, parentId: dto.parentId },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_DEPARTMENT',
          entityType: 'Department',
          entityId: department.id,
        },
      });
      return department;
    });
  }

  async createPosition(dto: CreatePositionDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'Position');
    return this.prisma.$transaction(async (tx) => {
      await this.assertDepartment(tx, user, scope, dto.departmentId);
      const position = await tx.position.create({
        data: {
          companyId: scope.companyId,
          departmentId: dto.departmentId,
          code: dto.code,
          name: dto.name,
          grade: dto.grade,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_POSITION',
          entityType: 'Position',
          entityId: position.id,
        },
      });
      return position;
    });
  }

  async listDepartments(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'Department');
    return this.prisma.department.findMany({
      where: { companyId: scope.companyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async listPositions(user: AuthUser, departmentId?: string, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'Position');
    await this.assertDepartment(this.prisma, user, scope, departmentId);
    return this.prisma.position.findMany({
      where: { companyId: scope.companyId, isActive: true, ...(departmentId ? { departmentId } : {}) },
      orderBy: { name: 'asc' },
    });
  }


  private parseBusinessDate(value: string, label: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} tidak valid.`);
    return date;
  }

  private inclusiveCalendarDays(start: Date, end: Date): number {
    const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    return Math.floor((endUtc - startUtc) / 86_400_000) + 1;
  }

  private async branchEmployeeIds(client: DbClient, scope: TenantScope): Promise<string[]> {
    const employees = await client.employee.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, select: { id: true } });
    return employees.map((item) => item.id);
  }

  async listLeaveTypes(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.leaveType.findMany({ where: { companyId: scope.companyId, isActive: true }, orderBy: { name: 'asc' } });
  }

  async createLeaveType(dto: CreateLeaveTypeDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.leaveType.create({ data: {
        companyId: scope.companyId, code: dto.code.trim().toUpperCase(), name: dto.name.trim(),
        paid: dto.paid ?? true, annualQuota: dto.annualQuota === undefined ? undefined : new Prisma.Decimal(dto.annualQuota),
        requiresDocument: dto.requiresDocument ?? false,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_LEAVE_TYPE', entityType: 'LeaveType', entityId: row.id, payload: { branchId: scope.branchId, code: row.code } } });
      return row;
    });
  }

  async submitLeave(dto: CreateLeaveRequestDto, user: AuthUser) {
    const employee = await this.byUserId(user);
    const startDate = this.parseBusinessDate(dto.startDate, 'Tanggal mulai cuti');
    const endDate = this.parseBusinessDate(dto.endDate, 'Tanggal akhir cuti');
    if (endDate < startDate) throw new BadRequestException('Tanggal akhir cuti tidak boleh sebelum tanggal mulai.');
    const totalDays = this.inclusiveCalendarDays(startDate, endDate);
    if (totalDays <= 0 || totalDays > 366) throw new BadRequestException('Durasi cuti tidak valid.');
    return this.prisma.$transaction(async (tx) => {
      const leaveType = await tx.leaveType.findFirst({ where: { id: dto.leaveTypeId, companyId: employee.companyId, isActive: true } });
      if (!leaveType) throw new BadRequestException('Jenis cuti tidak tersedia.');
      if (leaveType.requiresDocument && !dto.documentObjectKey?.trim()) throw new BadRequestException('Jenis cuti ini mewajibkan dokumen pendukung.');
      const overlap = await tx.leaveRequest.findFirst({ where: {
        companyId: employee.companyId, employeeId: employee.id, status: { in: ['SUBMITTED','APPROVED'] },
        startDate: { lte: endDate }, endDate: { gte: startDate },
      } });
      if (overlap) throw new ConflictException('Rentang cuti bertumpang tindih dengan pengajuan aktif lain.');
      if (leaveType.annualQuota !== null) {
        const yearStart = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1));
        const yearEnd = new Date(Date.UTC(startDate.getUTCFullYear() + 1, 0, 1));
        const approved = await tx.leaveRequest.aggregate({ where: {
          companyId: employee.companyId, employeeId: employee.id, leaveTypeId: leaveType.id, status: 'APPROVED',
          startDate: { gte: yearStart, lt: yearEnd },
        }, _sum: { totalDays: true } });
        const used = Number(approved._sum.totalDays ?? 0);
        if (used + totalDays > Number(leaveType.annualQuota)) throw new BadRequestException(`Kuota ${leaveType.name} tidak mencukupi. Terpakai ${used}, pengajuan ${totalDays}, kuota ${Number(leaveType.annualQuota)}.`);
      }
      const request = await tx.leaveRequest.create({ data: {
        companyId: employee.companyId, employeeId: employee.id, leaveTypeId: leaveType.id,
        startDate, endDate, totalDays: new Prisma.Decimal(totalDays), reason: dto.reason,
        documentObjectKey: dto.documentObjectKey,
      } });
      const policy = await tx.approvalPolicy.findFirst({ where: { companyId: employee.companyId, code: 'LEAVE_REQUEST', isActive: true } });
      const approval = await tx.approvalRequest.create({ data: {
        companyId: employee.companyId, branchId: employee.branchId, policyId: policy?.id,
        entityType: 'LeaveRequest', entityId: request.id, requesterId: user.sub,
        context: { employeeId: employee.id, leaveTypeId: leaveType.id, startDate: startDate.toISOString(), endDate: endDate.toISOString(), totalDays },
      } });
      const updated = await tx.leaveRequest.update({ where: { id: request.id }, data: { approvalRequestId: approval.id } });
      await tx.auditLog.create({ data: { companyId: employee.companyId, userId: user.sub, action: 'SUBMIT_LEAVE_REQUEST', entityType: 'LeaveRequest', entityId: request.id, payload: { branchId: employee.branchId, totalDays } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listLeaveRequests(user: AuthUser, status?: string) {
    const scope = this.requireTenantScope(user);
    const validatedStatus = validatedHrRequestStatus(status);
    const employeeIds = await this.branchEmployeeIds(this.prisma, scope);
    return this.prisma.leaveRequest.findMany({ where: {
      companyId: scope.companyId, employeeId: { in: employeeIds }, ...(validatedStatus ? { status: validatedStatus as never } : {}),
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 300 });
  }

  async reviewLeave(id: string, dto: ReviewHrRequestDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const employeeIds = await this.branchEmployeeIds(tx, scope);
      const request = await tx.leaveRequest.findFirst({ where: { id, companyId: scope.companyId, employeeId: { in: employeeIds } } });
      if (!request) return this.denyTenantAccess(tx, user, scope, 'LeaveRequest', id);
      if (request.status !== 'SUBMITTED') throw new BadRequestException(`Pengajuan cuti sudah berstatus ${request.status}.`);
      const updated = await tx.leaveRequest.update({ where: { id }, data: { status: dto.status as never } });
      if (request.approvalRequestId) {
        const approval = await tx.approvalRequest.findFirst({ where: { id: request.approvalRequestId, companyId: scope.companyId, branchId: scope.branchId, status: 'PENDING' } });
        if (approval) {
          await tx.approvalDecision.create({ data: { requestId: approval.id, step: approval.currentStep, approverId: user.sub, status: dto.status as never, notes: dto.notes } });
          await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: dto.status as never, decidedAt: new Date() } });
        }
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: dto.status === 'APPROVED' ? 'APPROVE_LEAVE_REQUEST' : 'REJECT_LEAVE_REQUEST', entityType: 'LeaveRequest', entityId: id, payload: { branchId: scope.branchId, notes: dto.notes } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async submitOvertime(dto: CreateOvertimeRequestDto, user: AuthUser) {
    const employee = await this.byUserId(user);
    const requestedStart = this.parseBusinessDate(dto.requestedStart, 'Waktu mulai lembur');
    const requestedEnd = this.parseBusinessDate(dto.requestedEnd, 'Waktu selesai lembur');
    const durationMinutes = Math.round((requestedEnd.getTime() - requestedStart.getTime()) / 60_000);
    if (durationMinutes <= 0 || durationMinutes > 1440) throw new BadRequestException('Durasi lembur harus lebih dari 0 dan maksimal 24 jam.');
    return this.prisma.$transaction(async (tx) => {
      const overlap = await tx.overtimeRequest.findFirst({ where: {
        companyId: employee.companyId, employeeId: employee.id, status: { in: ['SUBMITTED','APPROVED'] },
        requestedStart: { lt: requestedEnd }, requestedEnd: { gt: requestedStart },
      } });
      if (overlap) throw new ConflictException('Rentang lembur bertumpang tindih dengan pengajuan aktif lain.');
      const request = await tx.overtimeRequest.create({ data: {
        companyId: employee.companyId, employeeId: employee.id, branchId: employee.branchId,
        requestedStart, requestedEnd, reason: dto.reason,
      } });
      const policy = await tx.approvalPolicy.findFirst({ where: { companyId: employee.companyId, code: 'OVERTIME_REQUEST', isActive: true } });
      const approval = await tx.approvalRequest.create({ data: {
        companyId: employee.companyId, branchId: employee.branchId, policyId: policy?.id,
        entityType: 'OvertimeRequest', entityId: request.id, requesterId: user.sub,
        context: { employeeId: employee.id, requestedStart: requestedStart.toISOString(), requestedEnd: requestedEnd.toISOString(), requestedMinutes: durationMinutes },
      } });
      const updated = await tx.overtimeRequest.update({ where: { id: request.id }, data: { approvalRequestId: approval.id } });
      await tx.auditLog.create({ data: { companyId: employee.companyId, userId: user.sub, action: 'SUBMIT_OVERTIME_REQUEST', entityType: 'OvertimeRequest', entityId: request.id, payload: { branchId: employee.branchId, durationMinutes } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listOvertimeRequests(user: AuthUser, status?: string) {
    const scope = this.requireTenantScope(user);
    const validatedStatus = validatedHrRequestStatus(status);
    const employeeIds = await this.branchEmployeeIds(this.prisma, scope);
    return this.prisma.overtimeRequest.findMany({ where: {
      companyId: scope.companyId, branchId: scope.branchId, employeeId: { in: employeeIds }, ...(validatedStatus ? { status: validatedStatus as never } : {}),
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 300 });
  }

  async reviewOvertime(id: string, dto: ReviewOvertimeRequestDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.overtimeRequest.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId } });
      if (!request) return this.denyTenantAccess(tx, user, scope, 'OvertimeRequest', id);
      if (request.status !== 'SUBMITTED') throw new BadRequestException(`Pengajuan lembur sudah berstatus ${request.status}.`);
      const requestedMinutes = Math.round((request.requestedEnd.getTime() - request.requestedStart.getTime()) / 60_000);
      const approvedMinutes = dto.status === 'APPROVED' ? dto.approvedMinutes ?? requestedMinutes : null;
      if (approvedMinutes !== null && (approvedMinutes < 0 || approvedMinutes > requestedMinutes)) throw new BadRequestException('Menit lembur yang disetujui tidak boleh melebihi durasi pengajuan.');
      const updated = await tx.overtimeRequest.update({ where: { id }, data: { status: dto.status as never, approvedMinutes } });
      if (request.approvalRequestId) {
        const approval = await tx.approvalRequest.findFirst({ where: { id: request.approvalRequestId, companyId: scope.companyId, branchId: scope.branchId, status: 'PENDING' } });
        if (approval) {
          await tx.approvalDecision.create({ data: { requestId: approval.id, step: approval.currentStep, approverId: user.sub, status: dto.status as never, notes: dto.notes } });
          await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: dto.status as never, decidedAt: new Date() } });
        }
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: dto.status === 'APPROVED' ? 'APPROVE_OVERTIME_REQUEST' : 'REJECT_OVERTIME_REQUEST', entityType: 'OvertimeRequest', entityId: id, payload: { branchId: scope.branchId, approvedMinutes, notes: dto.notes } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async myLeaveRequests(user: AuthUser) {
    const employee = await this.byUserId(user);
    return this.prisma.leaveRequest.findMany({ where: { companyId: employee.companyId, employeeId: employee.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
  }

  async myOvertimeRequests(user: AuthUser) {
    const employee = await this.byUserId(user);
    return this.prisma.overtimeRequest.findMany({ where: { companyId: employee.companyId, employeeId: employee.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
  }

  async byUserId(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const employee = await this.prisma.employee.findFirst({
      where: { userId: user.sub, companyId: scope.companyId, branchId: scope.branchId, isActive: true },
    });
    if (!employee) throw new NotFoundException('Akun belum terhubung ke data karyawan pada tenant aktif.');
    return employee;
  }

  async listAssignments(employeeId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: scope.companyId, branchId: scope.branchId } });
    if (!employee) return this.denyTenantAccess(this.prisma, user, scope, 'Employee', employeeId);
    return this.prisma.employeeAssignment.findMany({ where: { employeeId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
  }

  async createAssignment(dto: CreateEmployeeAssignmentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const effectiveFrom = this.parseBusinessDate(dto.effectiveFrom, 'Tanggal mulai assignment');
    const effectiveTo = dto.effectiveTo ? this.parseBusinessDate(dto.effectiveTo, 'Tanggal akhir assignment') : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException('Tanggal akhir assignment tidak boleh sebelum tanggal mulai.');
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: dto.employeeId, companyId: scope.companyId, branchId: scope.branchId, isActive: true } });
      if (!employee) return this.denyTenantAccess(tx, user, scope, 'Employee', dto.employeeId);
      await this.assertDepartment(tx, user, scope, dto.departmentId);
      await this.assertPosition(tx, user, scope, dto.positionId);
      if (dto.managerEmployeeId) {
        const manager = await tx.employee.findFirst({ where: { id: dto.managerEmployeeId, companyId: scope.companyId, branchId: scope.branchId, isActive: true } });
        if (!manager) return this.denyTenantAccess(tx, user, scope, 'Employee', dto.managerEmployeeId);
        if (manager.id === employee.id) throw new BadRequestException('Karyawan tidak dapat menjadi manajer untuk dirinya sendiri.');
      }
      if (dto.isPrimary ?? true) {
        const overlap = await tx.employeeAssignment.findFirst({ where: {
          employeeId: employee.id, isPrimary: true,
          effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        } });
        if (overlap) throw new ConflictException('Rentang primary EmployeeAssignment bertumpang tindih dengan assignment aktif/terjadwal lain.');
      }
      const row = await tx.employeeAssignment.create({ data: {
        employeeId: employee.id, branchId: scope.branchId, departmentId: dto.departmentId, positionId: dto.positionId,
        managerEmployeeId: dto.managerEmployeeId, effectiveFrom, effectiveTo, isPrimary: dto.isPrimary ?? true,
      } });
      const now = new Date();
      if (row.isPrimary && row.effectiveFrom <= now && (!row.effectiveTo || row.effectiveTo >= now)) {
        await tx.employee.update({ where: { id: employee.id }, data: { branchId: scope.branchId, departmentId: row.departmentId, positionId: row.positionId, managerEmployeeId: row.managerEmployeeId } });
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_EMPLOYEE_ASSIGNMENT', entityType: 'EmployeeAssignment', entityId: row.id, payload: { branchId: scope.branchId, employeeId: employee.id, effectiveFrom: effectiveFrom.toISOString(), effectiveTo: effectiveTo?.toISOString() ?? null, isPrimary: row.isPrimary } } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

}
