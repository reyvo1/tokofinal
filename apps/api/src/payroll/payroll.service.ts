import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AttendanceRecord, type Employee, type EmployeePayrollComponent, type EmployeeSocialSecurityProfile, type EmployeeTaxProfile, type SocialSecurityRuleSet, type TaxRuleSet } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AccountingCoreService } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { evaluatePayrollFormula } from './payroll-formula';
import { applyPayrollTaxMethod, dateProration, inclusiveUtcDays, money, utcDayStart } from './payroll-method-engine';
import { AssignEmployeeComponentDto, CreatePayrollAdjustmentRunDto, CreatePayrollComponentDto, CreatePayrollPeriodDto, CreatePayrollRunDto, CreateRuleSetDto, CreateSocialSecurityRuleSetDto, PublishPayslipsDto, SettlePayrollPaymentDto, UpsertEmployeeSocialSecurityProfileDto, UpsertEmployeeTaxProfileDto, UpsertPayrollAccountingMappingDto } from './dto/payroll.dto';

const decimal = (value: Prisma.Decimal.Value = 0) => new Prisma.Decimal(value);
const nonNegative = (value: Prisma.Decimal) => value.greaterThan(0) ? value : decimal(0);
const asNumber = (value: unknown) => Number(value ?? 0);
const FINAL_ATTENDANCE_STATUSES = new Set(['PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'LEAVE', 'SICK', 'HOLIDAY', 'OFF_DAY']);
const PAYROLL_MAPPING_CODES = {
  expense: '__PAYROLL_EXPENSE__',
  salaryPayable: '__SALARY_PAYABLE__',
  taxPayable: '__PAYROLL_TAX_PAYABLE__',
  otherPayable: '__PAYROLL_OTHER_PAYABLE__',
  employeeReceivable: '__PAYROLL_RECEIVABLE__',
} as const;

type RateBand = { min?: number; max?: number; upTo?: number; rate: number };
type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
type AttendanceStats = {
  records: number;
  payableDays: number;
  absent: number;
  lateMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  allLocked: boolean;
  hasUnresolved: boolean;
  changedAfterCutoff: boolean;
};
type TemporalAmount = { amount: number; effectiveFrom: Date; effectiveTo: Date };

function lookupRate(bands: RateBand[], amount: number) {
  return bands.find((band) => amount >= (band.min ?? Number.NEGATIVE_INFINITY) && amount <= (band.max ?? band.upTo ?? Number.POSITIVE_INFINITY))?.rate ?? 0;
}

function progressiveTax(bands: RateBand[], amount: number) {
  let tax = 0; let previous = 0;
  for (const band of bands) {
    const top = band.upTo ?? Number.POSITIVE_INFINITY;
    const taxable = Math.max(0, Math.min(amount, top) - previous);
    tax += taxable * band.rate;
    previous = top;
    if (amount <= top) break;
  }
  return tax;
}

function parseDate(value: string, field: string) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${field} tidak valid.`);
  return result;
}

function parseRangeEnd(value: string, field: string) {
  const result = parseDate(value, field);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) result.setUTCHours(23, 59, 59, 999);
  return result;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly accounting: AccountingCoreService,
  ) {}

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
    requestedCompanyId?: string,
    requestedBranchId?: string,
    entityType = 'PayrollScope',
  ): Promise<void> {
    if ((requestedCompanyId && requestedCompanyId !== scope.companyId) || (requestedBranchId && requestedBranchId !== scope.branchId)) {
      await this.denyTenantAccess(client, user, scope, entityType, undefined, {
        authenticatedCompanyId: scope.companyId, authenticatedBranchId: scope.branchId,
        ...(requestedCompanyId ? { requestedCompanyId } : {}), ...(requestedBranchId ? { requestedBranchId } : {}),
      });
    }
  }

  private async scopedRun(client: DbClient, user: AuthUser, scope: TenantScope, runId: string) {
    const run = await client.payrollRun.findFirst({ where: { id: runId, companyId: scope.companyId, branchId: scope.branchId } });
    if (!run) return this.denyTenantAccess(client, user, scope, 'PayrollRun', runId);
    return run;
  }

  private async assertPeriod(client: DbClient, user: AuthUser, scope: TenantScope, periodId: string) {
    const period = await client.payrollPeriod.findFirst({ where: { id: periodId, companyId: scope.companyId } });
    if (!period) return this.denyTenantAccess(client, user, scope, 'PayrollPeriod', periodId);
    return period;
  }

  private async assertTaxRuleSet(client: DbClient, user: AuthUser, scope: TenantScope, ruleSetId?: string) {
    if (!ruleSetId) return null;
    const ruleSet = await client.taxRuleSet.findFirst({ where: { id: ruleSetId, companyId: scope.companyId } });
    if (!ruleSet) return this.denyTenantAccess(client, user, scope, 'TaxRuleSet', ruleSetId);
    return ruleSet;
  }

  private async assertSocialRuleSet(client: DbClient, user: AuthUser, scope: TenantScope, ruleSetId?: string) {
    if (!ruleSetId) return null;
    const ruleSet = await client.socialSecurityRuleSet.findFirst({ where: { id: ruleSetId, companyId: scope.companyId } });
    if (!ruleSet) return this.denyTenantAccess(client, user, scope, 'SocialSecurityRuleSet', ruleSetId);
    return ruleSet;
  }


  async createPeriod(dto: CreatePayrollPeriodDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'PayrollPeriod');
    const startDate = parseDate(dto.startDate, 'Tanggal mulai periode');
    const endDate = parseRangeEnd(dto.endDate, 'Tanggal akhir periode');
    const attendanceCutoffAt = dto.attendanceCutoffAt ? parseDate(dto.attendanceCutoffAt, 'Cutoff absensi') : null;
    if (startDate > endDate) throw new BadRequestException('Tanggal mulai payroll harus sebelum atau sama dengan tanggal akhir.');
    if (attendanceCutoffAt && (attendanceCutoffAt < startDate || attendanceCutoffAt > endDate)) {
      throw new BadRequestException('Cutoff absensi harus berada di dalam rentang periode payroll.');
    }
    return serializableTx(this.prisma, async (tx) => {
      const overlap = await tx.payrollPeriod.findFirst({ where: {
        companyId: scope.companyId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      } });
      if (overlap) throw new ConflictException(`Periode payroll bertumpang tindih dengan ${overlap.code}.`);
      const period = await tx.payrollPeriod.create({ data: {
        companyId: scope.companyId, code: dto.code, year: dto.year, month: dto.month,
        startDate, endDate, attendanceCutoffAt,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_PAYROLL_PERIOD', entityType: 'PayrollPeriod', entityId: period.id } });
      return period;
    });
  }

  async listPeriods(user: AuthUser, yearValue?: string, monthValue?: string) {
    const scope = this.requireTenantScope(user);
    const year = yearValue ? Number(yearValue) : undefined;
    const month = monthValue ? Number(monthValue) : undefined;
    if (yearValue && (!Number.isInteger(year) || Number(year) < 2000)) throw new BadRequestException('Tahun payroll tidak valid.');
    if (monthValue && (!Number.isInteger(month) || Number(month) < 1 || Number(month) > 12)) throw new BadRequestException('Bulan payroll tidak valid.');
    return this.prisma.payrollPeriod.findMany({
      where: { companyId: scope.companyId, ...(year ? { year } : {}), ...(month ? { month } : {}) },
      orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 120,
    });
  }

  async lockAttendance(periodId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const period = await this.assertPeriod(tx, user, scope, periodId);
      if (period.status !== 'OPEN') throw new BadRequestException(`Periode payroll berstatus ${period.status}.`);
      const employees = await tx.employee.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, isActive: true }, select: { id: true } });
      const employeeIds = employees.map((item) => item.id);
      const records = employeeIds.length ? await tx.attendanceRecord.findMany({
        where: { companyId: scope.companyId, branchId: scope.branchId, employeeId: { in: employeeIds }, workDate: { gte: period.startDate, lte: period.endDate } },
        select: { id: true, status: true },
      }) : [];
      const recordIds = records.map((item) => item.id);
      const [pendingCorrections, pendingLeave, pendingOvertime] = await Promise.all([
        recordIds.length ? tx.attendanceCorrection.count({ where: { companyId: scope.companyId, attendanceRecordId: { in: recordIds }, status: 'SUBMITTED' } }) : Promise.resolve(0),
        employeeIds.length ? tx.leaveRequest.count({ where: { companyId: scope.companyId, employeeId: { in: employeeIds }, status: 'SUBMITTED', startDate: { lte: period.endDate }, endDate: { gte: period.startDate } } }) : Promise.resolve(0),
        employeeIds.length ? tx.overtimeRequest.count({ where: { companyId: scope.companyId, branchId: scope.branchId, employeeId: { in: employeeIds }, status: 'SUBMITTED', requestedStart: { lte: period.endDate }, requestedEnd: { gte: period.startDate } } }) : Promise.resolve(0),
      ]);
      const unresolvedRecords = records.filter((row) => !FINAL_ATTENDANCE_STATUSES.has(row.status)).length;
      if (pendingCorrections || pendingLeave || pendingOvertime || unresolvedRecords) {
        throw new BadRequestException(`Absensi belum dapat dikunci: correction=${pendingCorrections}, leave=${pendingLeave}, overtime=${pendingOvertime}, record-review=${unresolvedRecords}.`);
      }
      const lockedAt = new Date();
      const updated = await tx.attendanceRecord.updateMany({
        where: { id: { in: recordIds }, lockedAt: null }, data: { lockedAt },
      });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'LOCK_PAYROLL_ATTENDANCE', entityType: 'PayrollPeriod', entityId: period.id,
        payload: { branchId: scope.branchId, attendanceRecords: records.length, newlyLocked: updated.count },
      } });
      return { payrollPeriodId: period.id, branchId: scope.branchId, attendanceRecords: records.length, newlyLocked: updated.count, lockedAt };
    });
  }

  // Operator surfaces: a component can only be assigned from the UI if the operator can
  // first read the catalogue and the employee's existing assignments. These were the only
  // missing read paths that made POST /payroll/components unreachable end to end.
  async listComponents(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ code: string; id: string }>(cursorValue);
    const rows = await this.prisma.payrollComponentDefinition.findMany({
      where: {
        companyId: scope.companyId,
        ...(cursor ? { OR: [{ code: { gt: cursor.code } }, { code: cursor.code, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ code: item.code, id: item.id }));
  }

  async listEmployeeComponents(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ effectiveFrom: string; id: string }>(cursorValue);
    const parsedCursorDate = cursor ? new Date(cursor.effectiveFrom) : undefined;
    if (parsedCursorDate && Number.isNaN(parsedCursorDate.getTime())) throw new BadRequestException('cursor tidak valid.');

    // EmployeePayrollComponent carries companyId but not branchId and has no employee
    // relation in Prisma. Scan assignments in bounded chunks, then branch-filter only the
    // employee IDs present in each chunk. This preserves tenant scope without loading every
    // active employee or every assignment into memory.
    const collected: EmployeePayrollComponent[] = [];
    const scanTake = Math.min(Math.max((limit + 1) * 2, 50), 200);
    let scanCursor = parsedCursorDate && cursor ? { effectiveFrom: parsedCursorDate, id: cursor.id } : undefined;

    while (collected.length <= limit) {
      const candidates = await this.prisma.employeePayrollComponent.findMany({
        where: {
          companyId: scope.companyId,
          ...(scanCursor ? {
            OR: [
              { effectiveFrom: { lt: scanCursor.effectiveFrom } },
              { effectiveFrom: scanCursor.effectiveFrom, id: { lt: scanCursor.id } },
            ],
          } : {}),
        },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        take: scanTake,
      });
      if (!candidates.length) break;

      const employeeIds = [...new Set(candidates.map((row) => row.employeeId))];
      const branchEmployees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds }, companyId: scope.companyId, branchId: scope.branchId, isActive: true },
        select: { id: true },
      });
      const allowedEmployeeIds = new Set(branchEmployees.map((row) => row.id));
      for (const candidate of candidates) {
        if (allowedEmployeeIds.has(candidate.employeeId)) collected.push(candidate);
        if (collected.length > limit) break;
      }
      if (collected.length > limit || candidates.length < scanTake) break;
      const tail = candidates.at(-1);
      if (!tail) break;
      scanCursor = { effectiveFrom: tail.effectiveFrom, id: tail.id };
    }

    return toCursorPage(collected, limit, (item) => ({ effectiveFrom: item.effectiveFrom.toISOString(), id: item.id }));
  }

  async createComponent(dto: CreatePayrollComponentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'PayrollComponentDefinition');
    return serializableTx(this.prisma, async (tx) => {
      const component = await tx.payrollComponentDefinition.create({ data: {
        companyId: scope.companyId, code: dto.code, name: dto.name, componentType: dto.componentType as never,
        calculationType: dto.calculationType as never, defaultAmount: dto.defaultAmount, formula: dto.formula,
        taxable: dto.taxable ?? true, affectsGross: dto.affectsGross ?? true, affectsNet: dto.affectsNet ?? true,
        proratable: dto.proratable ?? false, attendanceBased: dto.attendanceBased ?? false,
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_PAYROLL_COMPONENT', entityType: 'PayrollComponentDefinition', entityId: component.id } });
      return component;
    });
  }

  async assignComponent(dto: AssignEmployeeComponentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'EmployeePayrollComponent');
    return serializableTx(this.prisma, async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: dto.employeeId, companyId: scope.companyId, branchId: scope.branchId, isActive: true }, select: { id: true } });
      if (!employee) return this.denyTenantAccess(tx, user, scope, 'Employee', dto.employeeId);
      const component = await tx.payrollComponentDefinition.findFirst({ where: { id: dto.componentId, companyId: scope.companyId, isActive: true }, select: { id: true } });
      if (!component) return this.denyTenantAccess(tx, user, scope, 'PayrollComponentDefinition', dto.componentId);
      const effectiveFrom = parseDate(dto.effectiveFrom, 'Tanggal efektif komponen');
      const effectiveTo = dto.effectiveTo ? parseRangeEnd(dto.effectiveTo, 'Tanggal akhir komponen') : null;
      if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException('Tanggal akhir komponen tidak boleh sebelum tanggal mulai.');
      const overlap = await tx.employeePayrollComponent.findFirst({ where: {
        companyId: scope.companyId, employeeId: dto.employeeId, componentId: dto.componentId, isActive: true,
        effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      }, select: { id: true } });
      if (overlap) throw new ConflictException('Rentang EmployeePayrollComponent bertumpang tindih dengan assignment lain untuk komponen yang sama.');
      const assignment = await tx.employeePayrollComponent.create({ data: {
        companyId: scope.companyId, employeeId: dto.employeeId, componentId: dto.componentId,
        amount: dto.amount, percentage: dto.percentage, effectiveFrom, effectiveTo,
        formulaInputs: dto.formulaInputs as Prisma.InputJsonValue | undefined,
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'ASSIGN_PAYROLL_COMPONENT', entityType: 'EmployeePayrollComponent', entityId: assignment.id,
        payload: { employeeId: dto.employeeId, componentId: dto.componentId, branchId: scope.branchId },
      } });
      return assignment;
    });
  }

  async createTaxRuleSet(dto: CreateRuleSetDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'TaxRuleSet');
    const effectiveFrom = parseDate(dto.effectiveFrom, 'Tanggal efektif tax rule');
    const effectiveTo = dto.effectiveTo ? parseRangeEnd(dto.effectiveTo, 'Tanggal akhir tax rule') : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException('Tanggal akhir tax rule tidak valid.');
    return serializableTx(this.prisma, async (tx) => {
      const latest = await tx.taxRuleSet.findFirst({ where: { companyId: scope.companyId, code: dto.code }, orderBy: { version: 'desc' }, select: { version: true } });
      const ruleSet = await tx.taxRuleSet.create({ data: {
        companyId: scope.companyId, code: dto.code, name: dto.name, effectiveFrom, effectiveTo,
        calculationMode: dto.calculationMode, parameters: dto.parameters as Prisma.InputJsonValue,
        legalReference: dto.legalReference, version: (latest?.version ?? 0) + 1, status: 'DRAFT',
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_PAYROLL_TAX_RULE_SET', entityType: 'TaxRuleSet', entityId: ruleSet.id } });
      return ruleSet;
    });
  }

  async createSocialSecurityRuleSet(dto: CreateSocialSecurityRuleSetDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'SocialSecurityRuleSet');
    const effectiveFrom = parseDate(dto.effectiveFrom, 'Tanggal efektif social-security rule');
    const effectiveTo = dto.effectiveTo ? parseRangeEnd(dto.effectiveTo, 'Tanggal akhir social-security rule') : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException('Tanggal akhir social-security rule tidak valid.');
    return serializableTx(this.prisma, async (tx) => {
      const latest = await tx.socialSecurityRuleSet.findFirst({ where: { companyId: scope.companyId, code: dto.code }, orderBy: { version: 'desc' }, select: { version: true } });
      const ruleSet = await tx.socialSecurityRuleSet.create({ data: {
        companyId: scope.companyId, code: dto.code, name: dto.name, effectiveFrom, effectiveTo,
        parameters: dto.parameters as Prisma.InputJsonValue, legalReference: dto.legalReference,
        version: (latest?.version ?? 0) + 1, status: 'DRAFT',
      } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_SOCIAL_SECURITY_RULE_SET', entityType: 'SocialSecurityRuleSet', entityId: ruleSet.id } });
      return ruleSet;
    });
  }

  private validateTaxRuleParameters(ruleSet: { calculationMode: string; parameters: unknown }) {
    const parameters = jsonRecord(ruleSet.parameters);
    if (parameters.requiresOfficialRateImport === true) throw new BadRequestException('Tax rule masih menandai requiresOfficialRateImport=true. Import dan verifikasi tarif resmi terlebih dahulu.');
    if (ruleSet.calculationMode === 'LOOKUP_TABLE') {
      const categories = jsonRecord(parameters.categories);
      const bands = Object.values(categories).flatMap((value) => Array.isArray(value) ? value : []);
      if (!bands.length) throw new BadRequestException('Lookup-table tax rule belum memiliki rate band.');
      for (const band of bands) {
        const rate = Number(jsonRecord(band).rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new BadRequestException('Tax rate harus berupa desimal 0..1.');
      }
      return;
    }
    if (ruleSet.calculationMode === 'ANNUAL_PROGRESSIVE') {
      const brackets = Array.isArray(parameters.brackets) ? parameters.brackets : [];
      if (!brackets.length) throw new BadRequestException('Progressive tax rule belum memiliki bracket.');
      let previousTop = 0;
      for (const bracket of brackets) {
        const row = jsonRecord(bracket);
        const rate = Number(row.rate);
        const top = row.upTo == null ? Number.POSITIVE_INFINITY : Number(row.upTo);
        if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new BadRequestException('Progressive tax rate harus berupa desimal 0..1.');
        if (!(top > previousTop)) throw new BadRequestException('Bracket pajak progresif harus berurutan dan tidak tumpang tindih.');
        previousTop = top;
      }
      return;
    }
    throw new BadRequestException(`Calculation mode ${ruleSet.calculationMode} belum didukung untuk approval.`);
  }

  async approveTaxRuleSet(ruleSetId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const ruleSet = await this.assertTaxRuleSet(tx, user, scope, ruleSetId);
      if (!ruleSet) throw new BadRequestException('Tax rule tidak ditemukan.');
      if (ruleSet.status === 'APPROVED') return ruleSet;
      if (ruleSet.status !== 'DRAFT') throw new BadRequestException(`Tax rule berstatus ${ruleSet.status}.`);
      this.validateTaxRuleParameters(ruleSet);
      const overlap = await tx.taxRuleSet.findFirst({ where: {
        companyId: scope.companyId, code: ruleSet.code, status: 'APPROVED', id: { not: ruleSet.id },
        effectiveFrom: { lte: ruleSet.effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: ruleSet.effectiveFrom } }],
      }, select: { id: true, version: true } });
      if (overlap) throw new ConflictException(`Tax rule version ${overlap.version} sudah APPROVED pada rentang tanggal yang bertumpang tindih.`);
      const checksum = createHash('sha256').update(JSON.stringify({ calculationMode: ruleSet.calculationMode, parameters: ruleSet.parameters, effectiveFrom: ruleSet.effectiveFrom, effectiveTo: ruleSet.effectiveTo })).digest('hex');
      const updated = await tx.taxRuleSet.update({ where: { id: ruleSet.id }, data: { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date(), checksum } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'APPROVE_PAYROLL_TAX_RULE_SET', entityType: 'TaxRuleSet', entityId: ruleSet.id, payload: { version: ruleSet.version, checksum } } });
      return updated;
    });
  }

  async approveSocialSecurityRuleSet(ruleSetId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const ruleSet = await this.assertSocialRuleSet(tx, user, scope, ruleSetId);
      if (!ruleSet) throw new BadRequestException('Social-security rule tidak ditemukan.');
      if (ruleSet.status === 'APPROVED') return ruleSet;
      if (ruleSet.status !== 'DRAFT') throw new BadRequestException(`Social-security rule berstatus ${ruleSet.status}.`);
      const parameters = jsonRecord(ruleSet.parameters);
      if (parameters.requiresOfficialRateImport === true) throw new BadRequestException('Social-security rule masih menandai requiresOfficialRateImport=true. Import dan verifikasi tarif resmi terlebih dahulu.');
      const programs = Array.isArray(parameters.programs) ? parameters.programs : [];
      if (!programs.length) throw new BadRequestException('Social-security rule belum memiliki program/rate.');
      for (const program of programs) {
        const row = jsonRecord(program);
        if (!String(row.code ?? '').trim()) throw new BadRequestException('Setiap program social-security wajib memiliki code.');
        for (const key of ['employeeRate', 'employerRate']) {
          const rate = Number(row[key] ?? 0);
          if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new BadRequestException(`${key} harus berupa desimal 0..1.`);
        }
      }
      const overlap = await tx.socialSecurityRuleSet.findFirst({ where: {
        companyId: scope.companyId, code: ruleSet.code, status: 'APPROVED', id: { not: ruleSet.id },
        effectiveFrom: { lte: ruleSet.effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: ruleSet.effectiveFrom } }],
      }, select: { id: true, version: true } });
      if (overlap) throw new ConflictException(`Social-security rule version ${overlap.version} sudah APPROVED pada rentang tanggal yang bertumpang tindih.`);
      const updated = await tx.socialSecurityRuleSet.update({ where: { id: ruleSet.id }, data: { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'APPROVE_SOCIAL_SECURITY_RULE_SET', entityType: 'SocialSecurityRuleSet', entityId: ruleSet.id, payload: { version: ruleSet.version } } });
      return updated;
    });
  }

  async listTaxRuleSets(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.taxRuleSet.findMany({
      where: { companyId: scope.companyId },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      take: 200,
    });
  }

  async listSocialSecurityRuleSets(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.socialSecurityRuleSet.findMany({
      where: { companyId: scope.companyId },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      take: 200,
    });
  }

  async createRun(dto: CreatePayrollRunDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'PayrollRun');
    return serializableTx(this.prisma, async (tx) => {
      const period = await this.assertPeriod(tx, user, scope, dto.payrollPeriodId);
      if (period.status !== 'OPEN') throw new BadRequestException(`Periode payroll ${period.code} tidak OPEN.`);
      await this.assertTaxRuleSet(tx, user, scope, dto.taxRuleSetId);
      await this.assertSocialRuleSet(tx, user, scope, dto.socialSecurityRuleSetId);
      const existing = await tx.payrollRun.findFirst({
        where: { companyId: scope.companyId, branchId: scope.branchId, payrollPeriodId: dto.payrollPeriodId, adjustmentOfRunId: null, status: { not: 'CANCELLED' } },
      });
      if (existing) {
        if ((existing.taxRuleSetId ?? null) === (dto.taxRuleSetId ?? null) && (existing.socialSecurityRuleSetId ?? null) === (dto.socialSecurityRuleSetId ?? null)) return existing;
        throw new ConflictException(`Payroll run aktif untuk periode ${period.code} dan branch ini sudah ada.`);
      }
      const run = await tx.payrollRun.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, payrollPeriodId: dto.payrollPeriodId,
        taxRuleSetId: dto.taxRuleSetId, socialSecurityRuleSetId: dto.socialSecurityRuleSetId, notes: dto.notes,
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PAYROLL_RUN', prefix: 'PAYROLL' }),
        createdById: user.sub,
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'CREATE_PAYROLL_RUN', entityType: 'PayrollRun', entityId: run.id,
        payload: { branchId: scope.branchId, payrollPeriodId: dto.payrollPeriodId },
      } });
      return run;
    });
  }

  async createAdjustmentRun(sourceRunId: string, dto: CreatePayrollAdjustmentRunDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const source = await this.scopedRun(tx, user, scope, sourceRunId);
      if (source.adjustmentOfRunId) throw new BadRequestException('Adjustment harus dibuat dari payroll run reguler, bukan dari adjustment lain.');
      if (!['POSTED', 'PAID'].includes(source.status)) throw new BadRequestException('Adjustment hanya dapat dibuat dari payroll run POSTED/PAID.');
      const period = await this.assertPeriod(tx, user, scope, source.payrollPeriodId);
      const taxRuleSetId = dto.taxRuleSetId ?? source.taxRuleSetId ?? undefined;
      const socialSecurityRuleSetId = dto.socialSecurityRuleSetId ?? source.socialSecurityRuleSetId ?? undefined;
      await this.assertTaxRuleSet(tx, user, scope, taxRuleSetId);
      await this.assertSocialRuleSet(tx, user, scope, socialSecurityRuleSetId);
      const openAdjustment = await tx.payrollRun.findFirst({ where: {
        companyId: scope.companyId, branchId: scope.branchId, adjustmentOfRunId: source.id,
        status: { in: ['DRAFT', 'CALCULATING', 'REVIEW', 'APPROVED', 'POSTED'] },
      }, orderBy: { adjustmentSequence: 'desc' } });
      if (openAdjustment) throw new ConflictException(`Adjustment ${openAdjustment.number} masih aktif. Selesaikan atau batalkan sebelum membuat adjustment baru.`);
      const previousCount = await tx.payrollRun.count({ where: { companyId: scope.companyId, branchId: scope.branchId, adjustmentOfRunId: source.id } });
      const run = await tx.payrollRun.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, payrollPeriodId: source.payrollPeriodId,
        taxRuleSetId, socialSecurityRuleSetId, adjustmentOfRunId: source.id, adjustmentSequence: previousCount + 1,
        adjustmentReason: dto.reason.trim(), adjustmentPostingDate: dto.postingDate ? parseDate(dto.postingDate, 'Tanggal posting adjustment') : new Date(), notes: `Adjustment ${source.number}: ${dto.reason.trim()}`,
        number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PAYROLL_ADJUSTMENT', prefix: 'PAYADJ' }),
        createdById: user.sub,
      } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'CREATE_PAYROLL_ADJUSTMENT_RUN', entityType: 'PayrollRun', entityId: run.id,
        payload: { branchId: scope.branchId, sourcePayrollRunId: source.id, payrollPeriodId: period.id, adjustmentSequence: run.adjustmentSequence, reason: dto.reason.trim() },
      } });
      return run;
    });
  }

  private rowEffectiveAt<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(rows: T[], at: Date): T | null {
    const day = utcDayStart(at).getTime();
    return rows.find((row) => {
      const from = utcDayStart(row.effectiveFrom).getTime();
      const to = row.effectiveTo ? utcDayStart(row.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      return from <= day && to >= day;
    }) ?? null;
  }

  private buildEffectiveSegments(
    periodStart: Date,
    periodEnd: Date,
    rows: Array<{ effectiveFrom: Date; effectiveTo: Date | null }>,
  ) {
    const start = utcDayStart(periodStart);
    const end = utcDayStart(periodEnd);
    const endExclusive = new Date(end.getTime() + 86_400_000);
    const points = new Set<number>([start.getTime(), endExclusive.getTime()]);
    for (const row of rows) {
      const overlap = dateProration(start, end, row);
      if (!overlap) continue;
      points.add(utcDayStart(overlap.activeFrom).getTime());
      points.add(utcDayStart(overlap.activeTo).getTime() + 86_400_000);
    }
    const sorted = [...points].sort((a, b) => a - b);
    const periodDays = inclusiveUtcDays(start, end);
    return sorted.slice(0, -1).map((fromMs, index) => {
      const toExclusive = sorted[index + 1];
      const segmentStart = new Date(fromMs);
      const segmentEnd = new Date(toExclusive - 86_400_000);
      const activeDays = inclusiveUtcDays(segmentStart, segmentEnd);
      return { start: segmentStart, end: segmentEnd, activeDays, factor: activeDays / periodDays };
    }).filter((segment) => segment.activeDays > 0);
  }

  private allocateTemporalAmounts(
    segments: Array<{ start: Date; end: Date }>,
    rows: TemporalAmount[],
  ) {
    const allocated = segments.map(() => 0);
    for (const row of rows) {
      const rowStart = utcDayStart(row.effectiveFrom);
      const rowEnd = utcDayStart(row.effectiveTo);
      const rowDays = inclusiveUtcDays(rowStart, rowEnd);
      if (!rowDays || !row.amount) continue;
      const overlaps = segments.map((segment, index) => {
        const start = utcDayStart(segment.start) > rowStart ? utcDayStart(segment.start) : rowStart;
        const end = utcDayStart(segment.end) < rowEnd ? utcDayStart(segment.end) : rowEnd;
        return { index, days: inclusiveUtcDays(start, end) };
      }).filter((item) => item.days > 0);
      let recognized = 0;
      overlaps.forEach((item, index) => {
        const amount = index === overlaps.length - 1 ? money(row.amount - recognized) : money(row.amount * item.days / rowDays);
        allocated[item.index] = money(allocated[item.index] + amount);
        recognized = money(recognized + amount);
      });
    }
    return allocated;
  }

  private attendanceStats(
    records: AttendanceRecord[],
    rangeStart: Date,
    rangeEnd: Date,
    cutoffAt: Date | null,
  ): AttendanceStats {
    const from = utcDayStart(rangeStart).getTime();
    const to = utcDayStart(rangeEnd).getTime();
    const scoped = records.filter((item) => {
      const day = utcDayStart(item.workDate).getTime();
      return day >= from && day <= to;
    });
    return {
      records: scoped.length,
      payableDays: scoped.filter((item) => ['PRESENT', 'LATE', 'EARLY_LEAVE'].includes(item.status)).length,
      absent: scoped.filter((item) => item.status === 'ABSENT').length,
      lateMinutes: scoped.reduce((sum, item) => sum + item.lateMinutes, 0),
      workedMinutes: scoped.reduce((sum, item) => sum + item.workedMinutes, 0),
      overtimeMinutes: scoped.reduce((sum, item) => sum + item.overtimeMinutes, 0),
      allLocked: scoped.length > 0 && scoped.every((item) => Boolean(item.lockedAt)),
      hasUnresolved: scoped.some((item) => !FINAL_ATTENDANCE_STATUSES.has(item.status)),
      changedAfterCutoff: Boolean(cutoffAt && scoped.some((item) => item.updatedAt > cutoffAt)),
    };
  }

  private calculateTaxBase(
    taxableIncome: number,
    taxProfile: Pick<EmployeeTaxProfile, 'taxStatusCode'> | null,
    ruleSet: Pick<TaxRuleSet, 'calculationMode' | 'parameters' | 'status'> | null,
    periodFraction = 1,
  ) {
    if (taxableIncome <= 0) return { amount: 0, trace: { status: 'NOT_APPLICABLE', reason: 'No taxable income.' } };
    if (!taxProfile) return { amount: 0, trace: { status: 'REQUIRES_REVIEW', reason: 'Employee tax profile is missing for an effective segment.' } };
    if (!ruleSet || ruleSet.status !== 'APPROVED') return { amount: 0, trace: { status: 'REQUIRES_REVIEW', reason: 'No approved/effective tax rule set for an effective segment.' } };
    const parameters = (ruleSet.parameters ?? {}) as Record<string, unknown>;
    const fraction = Math.max(0.000001, Math.min(1, periodFraction));
    const periodEquivalentIncome = taxableIncome / fraction;
    if (ruleSet.calculationMode === 'LOOKUP_TABLE') {
      const category = taxProfile.taxStatusCode ?? String(parameters.defaultCategory ?? 'A');
      const categories = (parameters.categories ?? {}) as Record<string, RateBand[]>;
      const bands = categories[category] ?? [];
      if (!bands.length) return { amount: 0, trace: { status: 'REQUIRES_REVIEW', reason: `Rate table category ${category} is empty.` } };
      const rate = lookupRate(bands, periodEquivalentIncome);
      return { amount: money(taxableIncome * rate), trace: { status: 'CALCULATED', engine: 'LOOKUP_TABLE', category, rate, taxableIncome, periodEquivalentIncome, periodFraction: fraction } };
    }
    if (ruleSet.calculationMode === 'ANNUAL_PROGRESSIVE') {
      const periodsPerYear = asNumber(parameters.periodsPerYear ?? 12);
      if (!periodsPerYear || !Array.isArray(parameters.brackets) || !(parameters.brackets as unknown[]).length) {
        return { amount: 0, trace: { status: 'REQUIRES_REVIEW', reason: 'Progressive tax parameters are incomplete.' } };
      }
      const allowance = asNumber(parameters.allowance);
      const annualized = periodEquivalentIncome * periodsPerYear;
      const taxableAnnual = Math.max(0, annualized - allowance);
      const annualTax = progressiveTax(parameters.brackets as RateBand[], taxableAnnual);
      return { amount: money((annualTax / periodsPerYear) * fraction), trace: { status: 'CALCULATED', engine: 'ANNUAL_PROGRESSIVE', annualized, taxableAnnual, taxableIncome, periodEquivalentIncome, periodFraction: fraction } };
    }
    return { amount: 0, trace: { status: 'REQUIRES_REVIEW', reason: `Unsupported calculation mode ${ruleSet.calculationMode}` } };
  }

  private calculateTaxAcrossSegments(
    taxableRows: TemporalAmount[],
    netRows: TemporalAmount[],
    profiles: EmployeeTaxProfile[],
    ruleSets: TaxRuleSet[],
    periodStart: Date,
    periodEnd: Date,
  ) {
    const taxableIncome = money(taxableRows.reduce((sum, row) => sum + row.amount, 0));
    const netBeforeTax = money(netRows.reduce((sum, row) => sum + row.amount, 0));
    if (taxableIncome <= 0) {
      return {
        amount: 0, employeeDeduction: 0, employerBorneTax: 0, grossAdjustment: 0, taxableAdjustment: 0,
        netAfterTax: netBeforeTax,
        trace: { status: 'NOT_APPLICABLE', reason: 'No taxable income.', segments: [] as unknown[] },
      };
    }
    const segments = this.buildEffectiveSegments(periodStart, periodEnd, [...profiles, ...ruleSets]);
    const taxableBySegment = this.allocateTemporalAmounts(segments, taxableRows);
    const netBySegment = this.allocateTemporalAmounts(segments, netRows);
    let amount = 0; let employeeDeduction = 0; let employerBorneTax = 0; let grossAdjustment = 0; let taxableAdjustment = 0; let netAfterTax = 0;
    let requiresReview = false;
    const traceSegments: Array<Record<string, unknown>> = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const profile = this.rowEffectiveAt(profiles, segment.start);
      const ruleSet = this.rowEffectiveAt(ruleSets, segment.start);
      const segmentTaxable = taxableBySegment[index] ?? 0;
      const segmentNetBeforeTax = netBySegment[index] ?? 0;
      if (!profile || !ruleSet) {
        requiresReview = true;
        traceSegments.push({
          status: 'REQUIRES_REVIEW', start: segment.start.toISOString(), end: segment.end.toISOString(), factor: segment.factor,
          reason: !profile ? 'EmployeeTaxProfile coverage gap.' : 'Approved TaxRuleSet coverage gap.',
          taxProfileId: profile?.id ?? null, taxRuleSetId: ruleSet?.id ?? null, taxableIncome: segmentTaxable, netBeforeTax: segmentNetBeforeTax,
        });
        netAfterTax += segmentNetBeforeTax;
        continue;
      }
      try {
        const methodResult = applyPayrollTaxMethod({
          method: profile.taxMethod,
          taxableIncome: segmentTaxable,
          netBeforeTax: segmentNetBeforeTax,
          taxCalculator: (value) => this.calculateTaxBase(value, profile, ruleSet, segment.factor).amount,
        });
        const finalTaxTrace = this.calculateTaxBase(segmentTaxable + methodResult.taxableAdjustment, profile, ruleSet, segment.factor).trace;
        if (finalTaxTrace.status === 'REQUIRES_REVIEW') requiresReview = true;
        amount += methodResult.taxPayable;
        employeeDeduction += methodResult.employeeTaxDeduction;
        employerBorneTax += methodResult.employerBorneTax;
        grossAdjustment += methodResult.grossAdjustment;
        taxableAdjustment += methodResult.taxableAdjustment;
        netAfterTax += methodResult.netAfterTax;
        traceSegments.push({
          status: finalTaxTrace.status,
          start: segment.start.toISOString(), end: segment.end.toISOString(), factor: segment.factor,
          method: profile.taxMethod, taxProfileId: profile.id, taxRuleSetId: ruleSet.id,
          taxableIncome: money(segmentTaxable), netBeforeTax: money(segmentNetBeforeTax), taxPayable: methodResult.taxPayable,
          employeeTaxDeduction: methodResult.employeeTaxDeduction, employerBorneTax: methodResult.employerBorneTax,
          grossAdjustment: methodResult.grossAdjustment, taxableAdjustment: methodResult.taxableAdjustment,
          grossEquivalentAdjustment: methodResult.grossEquivalentAdjustment, iterations: methodResult.iterations,
          engine: finalTaxTrace,
        });
      } catch (error) {
        requiresReview = true;
        netAfterTax += segmentNetBeforeTax;
        traceSegments.push({
          status: 'REQUIRES_REVIEW', start: segment.start.toISOString(), end: segment.end.toISOString(), factor: segment.factor,
          method: profile.taxMethod, taxProfileId: profile.id, taxRuleSetId: ruleSet.id, taxableIncome: segmentTaxable, netBeforeTax: segmentNetBeforeTax,
          reason: error instanceof Error ? error.message : 'Tax method calculation failed.',
        });
      }
    }
    return {
      amount: money(amount), employeeDeduction: money(employeeDeduction), employerBorneTax: money(employerBorneTax),
      grossAdjustment: money(grossAdjustment), taxableAdjustment: money(taxableAdjustment), netAfterTax: money(netAfterTax),
      trace: { status: requiresReview ? 'REQUIRES_REVIEW' : 'CALCULATED', taxableIncome, netBeforeTax, segments: traceSegments },
    };
  }

  private calculateSocialSecurity(
    gross: number,
    profile: Pick<EmployeeSocialSecurityProfile, 'wageBase' | 'programs'> | null,
    ruleSet: Pick<SocialSecurityRuleSet, 'parameters' | 'status'> | null,
    periodFraction = 1,
  ) {
    if (!profile) return { employee: 0, employer: 0, lines: [] as Array<{ code: string; base: number; employeeAmount: number; employerAmount: number }>, trace: { status: 'NOT_APPLICABLE', reason: 'No employee social-security profile.' } };
    if (!ruleSet || ruleSet.status !== 'APPROVED') return { employee: 0, employer: 0, lines: [] as Array<{ code: string; base: number; employeeAmount: number; employerAmount: number }>, trace: { status: 'REQUIRES_REVIEW', reason: 'No approved/effective social-security rule set.' } };
    const parameters = (ruleSet.parameters ?? {}) as { programs?: Array<{ code: string; employeeRate?: number; employerRate?: number; maxWage?: number; minWage?: number }> };
    const selected = new Set(Array.isArray(profile.programs) ? profile.programs.map(String) : []);
    if (selected.size && !(parameters.programs ?? []).length) return { employee: 0, employer: 0, lines: [] as Array<{ code: string; base: number; employeeAmount: number; employerAmount: number }>, trace: { status: 'REQUIRES_REVIEW', reason: 'Social-security program rates are empty.' } };
    const factor = Math.max(0.000001, Math.min(1, periodFraction));
    const wage = profile.wageBase == null ? gross : Number(profile.wageBase) * factor;
    let employee = 0; let employer = 0;
    const lines = (parameters.programs ?? []).filter((item) => selected.has(item.code)).map((item) => {
      const minWage = (item.minWage ?? 0) * factor;
      const maxWage = item.maxWage == null ? wage : item.maxWage * factor;
      const base = Math.max(minWage, Math.min(wage, maxWage));
      const employeeAmount = money(base * (item.employeeRate ?? 0));
      const employerAmount = money(base * (item.employerRate ?? 0));
      employee += employeeAmount; employer += employerAmount;
      return { code: item.code, base: money(base), employeeAmount, employerAmount };
    });
    const unknownPrograms = [...selected].filter((code) => !(parameters.programs ?? []).some((item) => item.code === code));
    if (unknownPrograms.length) return { employee: money(employee), employer: money(employer), lines, trace: { status: 'REQUIRES_REVIEW', wage: money(wage), periodFraction: factor, unknownPrograms } };
    return { employee: money(employee), employer: money(employer), lines, trace: { status: 'CALCULATED', wage: money(wage), periodFraction: factor } };
  }

  private calculateSocialAcrossSegments(
    grossRows: TemporalAmount[],
    profiles: EmployeeSocialSecurityProfile[],
    ruleSets: SocialSecurityRuleSet[],
    periodStart: Date,
    periodEnd: Date,
  ) {
    if (!profiles.length) return { employee: 0, employer: 0, lines: [] as Array<{ code: string; base: number; employeeAmount: number; employerAmount: number; metadata?: Prisma.InputJsonValue }>, employeeTemporal: [] as TemporalAmount[], trace: { status: 'NOT_APPLICABLE', reason: 'No employee social-security profile.', segments: [] as unknown[] } };
    const segments = this.buildEffectiveSegments(periodStart, periodEnd, [...profiles, ...ruleSets]);
    const grossBySegment = this.allocateTemporalAmounts(segments, grossRows);
    let employee = 0; let employer = 0; let requiresReview = false;
    const lines: Array<{ code: string; base: number; employeeAmount: number; employerAmount: number; metadata?: Prisma.InputJsonValue }> = [];
    const employeeTemporal: TemporalAmount[] = [];
    const traceSegments: Array<Record<string, unknown>> = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const profile = this.rowEffectiveAt(profiles, segment.start);
      const ruleSet = this.rowEffectiveAt(ruleSets, segment.start);
      if (!profile || !ruleSet) {
        requiresReview = true;
        traceSegments.push({ status: 'REQUIRES_REVIEW', start: segment.start.toISOString(), end: segment.end.toISOString(), factor: segment.factor, reason: !profile ? 'EmployeeSocialSecurityProfile coverage gap.' : 'Approved SocialSecurityRuleSet coverage gap.' });
        continue;
      }
      const calculated = this.calculateSocialSecurity(grossBySegment[index] ?? 0, profile, ruleSet, segment.factor);
      if (calculated.trace.status === 'REQUIRES_REVIEW') requiresReview = true;
      employee += calculated.employee; employer += calculated.employer;
      if (calculated.employee) employeeTemporal.push({ amount: -calculated.employee, effectiveFrom: segment.start, effectiveTo: segment.end });
      for (const line of calculated.lines) lines.push({ ...line, metadata: { start: segment.start.toISOString(), end: segment.end.toISOString(), factor: segment.factor, profileId: profile.id, ruleSetId: ruleSet.id } });
      traceSegments.push({ ...calculated.trace, gross: money(grossBySegment[index] ?? 0), start: segment.start.toISOString(), end: segment.end.toISOString(), factor: segment.factor, profileId: profile.id, ruleSetId: ruleSet.id });
    }
    return { employee: money(employee), employer: money(employer), lines, employeeTemporal, trace: { status: requiresReview ? 'REQUIRES_REVIEW' : 'CALCULATED', segments: traceSegments } };
  }

  private calculateComponentAmount(
    definition: { calculationType: string; defaultAmount: Prisma.Decimal | null; attendanceBased: boolean; code: string; formula: string | null },
    assignment: { amount: Prisma.Decimal | null; percentage: Prisma.Decimal | null; formulaInputs: unknown },
    attendance: AttendanceStats,
    percentageBase: number,
  ) {
    const inputs = jsonRecord(assignment.formulaInputs);
    const configured = Number(assignment.amount ?? definition.defaultAmount ?? 0);
    const reviewReasons: string[] = [];
    if (definition.attendanceBased && !attendance.allLocked) reviewReasons.push('attendance-not-locked');
    if (definition.attendanceBased && attendance.hasUnresolved) reviewReasons.push('attendance-needs-review');
    if (definition.attendanceBased && attendance.changedAfterCutoff) reviewReasons.push('attendance-changed-after-cutoff');

    let amount = configured;
    if (definition.calculationType === 'PERCENTAGE') {
      const rate = Number(assignment.percentage ?? inputs.percentage ?? 0);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) reviewReasons.push('invalid-percentage');
      amount = percentageBase * (Number.isFinite(rate) ? rate : 0);
    } else if (definition.calculationType === 'ATTENDANCE') {
      const ratePerDay = asNumber(inputs.ratePerDay);
      const ratePerMinute = asNumber(inputs.ratePerMinute);
      if (ratePerDay > 0) amount = attendance.payableDays * ratePerDay;
      else if (ratePerMinute > 0) amount = attendance.workedMinutes * ratePerMinute;
      else reviewReasons.push('attendance-rate-missing');
    } else if (definition.calculationType === 'OVERTIME') {
      const ratePerMinute = asNumber(inputs.ratePerMinute);
      const ratePerHour = asNumber(inputs.ratePerHour);
      if (ratePerMinute > 0) amount = attendance.overtimeMinutes * ratePerMinute;
      else if (ratePerHour > 0) amount = (attendance.overtimeMinutes / 60) * ratePerHour;
      else reviewReasons.push('overtime-rate-missing');
    } else if (definition.calculationType === 'FORMULA') {
      try {
        const numericInputs = Object.fromEntries(Object.entries(inputs).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])));
        amount = evaluatePayrollFormula(definition.formula ?? '', {
          configured, percentageBase,
          records: attendance.records, payableDays: attendance.payableDays, absent: attendance.absent,
          lateMinutes: attendance.lateMinutes, workedMinutes: attendance.workedMinutes, overtimeMinutes: attendance.overtimeMinutes,
          ...numericInputs,
        });
      } catch (error) {
        reviewReasons.push(`formula-error:${error instanceof Error ? error.message : 'invalid'}`);
        amount = 0;
      }
    } else if (!['FIXED', 'MANUAL'].includes(definition.calculationType)) {
      reviewReasons.push(`unsupported-calculation:${definition.calculationType}`);
      amount = 0;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      reviewReasons.push('invalid-amount');
      amount = 0;
    }
    return { amount, reviewReasons };
  }

  private traceRequiresReview(value: unknown): boolean {
    if (Array.isArray(value)) return value.some((item) => this.traceRequiresReview(item));
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (record.status === 'REQUIRES_REVIEW') return true;
    return Object.values(record).some((item) => this.traceRequiresReview(item));
  }

  async cancelRun(runId: string, reason: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const cleanReason = reason.trim();
    if (cleanReason.length < 5) throw new BadRequestException('Alasan pembatalan payroll minimal 5 karakter.');
    return serializableTx(this.prisma, async (tx) => {
      const run = await this.scopedRun(tx, user, scope, runId);
      if (!['DRAFT', 'REVIEW', 'APPROVED'].includes(run.status)) {
        throw new BadRequestException('Payroll hanya dapat dibatalkan sebelum posting accounting. Run POSTED/PAID tetap immutable.');
      }
      if (run.postedJournalEntryId) throw new BadRequestException('Payroll yang sudah memiliki jurnal posting tidak dapat dibatalkan.');
      const payments = await tx.payrollPayment.count({ where: { companyId: scope.companyId, payrollRunId: run.id } });
      if (payments) throw new BadRequestException('Payroll yang sudah memiliki instruksi settlement tidak dapat dibatalkan.');
      const updated = await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'CANCELLED', notes: [run.notes, `CANCELLED: ${cleanReason}`].filter(Boolean).join('\n') } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: run.adjustmentOfRunId ? 'CANCEL_PAYROLL_ADJUSTMENT_RUN' : 'CANCEL_PAYROLL_RUN', entityType: 'PayrollRun', entityId: run.id,
        payload: { branchId: scope.branchId, reason: cleanReason, adjustmentOfRunId: run.adjustmentOfRunId ?? null, previousStatus: run.status },
      } });
      return updated;
    });
  }

  async calculateRun(runId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const run = await this.scopedRun(tx, user, scope, runId);
      if (!['DRAFT', 'REVIEW'].includes(run.status)) throw new BadRequestException('Payroll run tidak dapat dihitung pada status sekarang.');
      const period = await this.assertPeriod(tx, user, scope, run.payrollPeriodId);
      const isAdjustment = Boolean(run.adjustmentOfRunId);
      if (!isAdjustment && period.status !== 'OPEN') throw new BadRequestException(`Periode payroll ${period.code} tidak OPEN.`);

      let recognitionRunIds: string[] = [];
      if (run.adjustmentOfRunId) {
        const source = await this.scopedRun(tx, user, scope, run.adjustmentOfRunId);
        if (source.adjustmentOfRunId || source.payrollPeriodId !== run.payrollPeriodId || !['POSTED', 'PAID'].includes(source.status)) {
          throw new BadRequestException('Sumber adjustment tidak lagi valid sebagai payroll reguler POSTED/PAID pada periode yang sama.');
        }
        const priorAdjustments = await tx.payrollRun.findMany({ where: {
          companyId: scope.companyId, branchId: scope.branchId, adjustmentOfRunId: source.id,
          id: { not: run.id }, status: { in: ['POSTED', 'PAID'] }, adjustmentSequence: { lt: run.adjustmentSequence },
        }, select: { id: true }, orderBy: { adjustmentSequence: 'asc' } });
        recognitionRunIds = [source.id, ...priorAdjustments.map((item) => item.id)];
      }

      const selectedTaxRuleSet = await this.assertTaxRuleSet(tx, user, scope, run.taxRuleSetId ?? undefined);
      const selectedSocialRuleSet = await this.assertSocialRuleSet(tx, user, scope, run.socialSecurityRuleSetId ?? undefined);
      const taxRuleSets = selectedTaxRuleSet ? await tx.taxRuleSet.findMany({ where: {
        companyId: scope.companyId, code: selectedTaxRuleSet.code, status: 'APPROVED',
        effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
      }, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] }) : [];
      const socialRuleSets = selectedSocialRuleSet ? await tx.socialSecurityRuleSet.findMany({ where: {
        companyId: scope.companyId, code: selectedSocialRuleSet.code, status: 'APPROVED',
        effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
      }, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] }) : [];

      const recognizedResults = recognitionRunIds.length ? await tx.payrollResult.findMany({
        where: { companyId: scope.companyId, payrollRunId: { in: recognitionRunIds } },
        orderBy: { createdAt: 'asc' },
      }) : [];
      const recognizedResultIds = recognizedResults.map((item) => item.id);
      const recognizedLines = recognizedResultIds.length ? await tx.payrollLine.findMany({ where: { payrollResultId: { in: recognizedResultIds } } }) : [];
      const recognizedByEmployee = new Map<string, typeof recognizedResults>();
      const resultEmployee = new Map(recognizedResults.map((item) => [item.id, item.employeeId]));
      for (const result of recognizedResults) {
        const rows = recognizedByEmployee.get(result.employeeId) ?? [];
        rows.push(result); recognizedByEmployee.set(result.employeeId, rows);
      }
      const recognizedLinesByEmployee = new Map<string, typeof recognizedLines>();
      for (const line of recognizedLines) {
        const employeeId = resultEmployee.get(line.payrollResultId); if (!employeeId) continue;
        const rows = recognizedLinesByEmployee.get(employeeId) ?? [];
        rows.push(line); recognizedLinesByEmployee.set(employeeId, rows);
      }

      let employees: Employee[];
      if (isAdjustment) {
        const active = await tx.employee.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, isActive: true }, select: { id: true } });
        const employeeIds = [...new Set([...active.map((item) => item.id), ...recognizedResults.map((item) => item.employeeId)])];
        employees = employeeIds.length ? await tx.employee.findMany({ where: { id: { in: employeeIds }, companyId: scope.companyId, branchId: scope.branchId }, orderBy: { id: 'asc' } }) : [];
      } else {
        employees = await tx.employee.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId, isActive: true }, orderBy: { id: 'asc' } });
      }
      if (!employees.length) throw new BadRequestException(isAdjustment ? 'Tidak ada karyawan yang dapat direkonsiliasi pada adjustment payroll ini.' : 'Tidak ada karyawan aktif pada branch untuk payroll ini.');

      await tx.payrollRun.update({ where: { id: runId }, data: { status: 'CALCULATING' } });
      let grossTotal = decimal(0), deductionTotal = decimal(0), employeeContributionTotal = decimal(0), taxTotal = decimal(0), employerTotal = decimal(0), netTotal = decimal(0);
      for (const employee of employees) {
        const assignments = await tx.employeePayrollComponent.findMany({ where: {
          companyId: scope.companyId, employeeId: employee.id, isActive: true,
          effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
        } });
        const definitions = await tx.payrollComponentDefinition.findMany({ where: { id: { in: assignments.map((item) => item.componentId) }, companyId: scope.companyId, isActive: true } });
        const byId = new Map(definitions.map((item) => [item.id, item]));
        const attendanceRecords = await tx.attendanceRecord.findMany({ where: {
          companyId: scope.companyId, branchId: scope.branchId, employeeId: employee.id,
          workDate: { gte: period.startDate, lte: period.endDate },
        } });
        const attendance = this.attendanceStats(attendanceRecords, period.startDate, period.endDate, period.attendanceCutoffAt);

        let percentageBase = 0;
        for (const assignment of assignments) {
          const definition = byId.get(assignment.componentId);
          if (!definition || !['FIXED', 'MANUAL'].includes(definition.calculationType) || !definition.affectsGross) continue;
          if (!['EARNING', 'REIMBURSEMENT'].includes(definition.componentType)) continue;
          const proration = dateProration(period.startDate, period.endDate, assignment);
          if (!proration) continue;
          let base = Number(assignment.amount ?? definition.defaultAmount ?? 0);
          if (proration.factor < 1) {
            if (!definition.proratable) continue;
            base = money(base * proration.factor);
          }
          percentageBase += base;
        }

        let gross = 0; let otherDeductions = 0; let taxableIncome = 0;
        const grossTemporal: TemporalAmount[] = [];
        const netTemporal: TemporalAmount[] = [];
        const taxableTemporal: TemporalAmount[] = [];
        const componentReviews: Array<{ code: string; reasons: string[] }> = [];
        const targetLines: Array<{ componentId?: string; code: string; name: string; componentType: never; amount: number; taxableAmount: number; employerAmount: number; source: string; metadata?: Prisma.InputJsonValue }> = [];
        for (const assignment of assignments) {
          const definition = byId.get(assignment.componentId); if (!definition) continue;
          const proration = dateProration(period.startDate, period.endDate, assignment);
          if (!proration) continue;
          const assignmentAttendance = this.attendanceStats(attendanceRecords, proration.activeFrom, proration.activeTo, period.attendanceCutoffAt);
          const calculated = this.calculateComponentAmount(definition, assignment, assignmentAttendance, percentageBase);
          const isSplit = proration.factor < 1;
          if (isSplit) {
            if (!definition.proratable) {
              calculated.reviewReasons.push('split-period-component-not-proratable');
              calculated.amount = 0;
            } else if (!['ATTENDANCE', 'OVERTIME'].includes(definition.calculationType)) {
              calculated.amount = money(calculated.amount * proration.factor);
            }
          }
          if (calculated.reviewReasons.length) componentReviews.push({ code: definition.code, reasons: calculated.reviewReasons });
          const positiveType = definition.componentType === 'EARNING' || definition.componentType === 'REIMBURSEMENT';
          if (positiveType && definition.affectsGross) {
            gross += calculated.amount;
            grossTemporal.push({ amount: money(calculated.amount), effectiveFrom: proration.activeFrom, effectiveTo: proration.activeTo });
          }
          if (positiveType && definition.affectsNet) {
            netTemporal.push({ amount: money(calculated.amount), effectiveFrom: proration.activeFrom, effectiveTo: proration.activeTo });
          }
          if (definition.componentType === 'DEDUCTION' && definition.affectsNet) {
            otherDeductions += calculated.amount;
            netTemporal.push({ amount: -money(calculated.amount), effectiveFrom: proration.activeFrom, effectiveTo: proration.activeTo });
          }
          const taxableAmount = positiveType && definition.taxable ? calculated.amount : 0;
          taxableIncome += taxableAmount;
          if (taxableAmount) taxableTemporal.push({ amount: money(taxableAmount), effectiveFrom: proration.activeFrom, effectiveTo: proration.activeTo });
          targetLines.push({
            componentId: definition.id, code: definition.code, name: definition.name, componentType: definition.componentType as never,
            amount: money(calculated.amount), taxableAmount: money(taxableAmount), employerAmount: 0, source: definition.calculationType,
            metadata: {
              ...(calculated.reviewReasons.length ? { reviewReasons: calculated.reviewReasons } : {}),
              proration: { applied: isSplit && definition.proratable, factor: proration.factor, activeDays: proration.activeDays, periodDays: proration.periodDays, activeFrom: proration.activeFrom.toISOString(), activeTo: proration.activeTo.toISOString() },
            } as Prisma.InputJsonValue,
          });
        }

        const taxProfiles = await tx.employeeTaxProfile.findMany({ where: {
          employeeId: employee.id, companyId: scope.companyId,
          effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
        }, orderBy: { effectiveFrom: 'asc' } });
        const socialProfiles = await tx.employeeSocialSecurityProfile.findMany({ where: {
          employeeId: employee.id, companyId: scope.companyId,
          effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
        }, orderBy: { effectiveFrom: 'asc' } });
        const social = this.calculateSocialAcrossSegments(grossTemporal, socialProfiles, socialRuleSets, period.startDate, period.endDate);
        const netBeforeTaxTemporal = [...netTemporal, ...social.employeeTemporal];
        const tax = this.calculateTaxAcrossSegments(taxableTemporal, netBeforeTaxTemporal, taxProfiles, taxRuleSets, period.startDate, period.endDate);
        gross = money(gross + tax.grossAdjustment);
        taxableIncome = money(taxableIncome + tax.taxableAdjustment);
        const net = tax.netAfterTax;
        if (net < 0) throw new BadRequestException(`Gaji bersih target ${employee.employeeNumber} bernilai negatif.`);
        if (tax.grossAdjustment > 0) targetLines.push({
          code: 'TAX_GROSS_UP_ALLOWANCE', name: 'Tunjangan Pajak Gross-Up', componentType: 'EARNING' as never,
          amount: tax.grossAdjustment, taxableAmount: tax.taxableAdjustment, employerAmount: 0, source: 'TAX_METHOD_ENGINE',
          metadata: { taxMethod: 'GROSS_UP', generated: true },
        });
        if (tax.amount > 0) targetLines.push({
          code: 'INCOME_TAX', name: 'Pajak Penghasilan', componentType: 'TAX' as never, amount: tax.amount, taxableAmount: 0,
          employerAmount: tax.employerBorneTax, source: 'TAX_METHOD_ENGINE',
          metadata: { employeeTaxDeduction: tax.employeeDeduction, employerBorneTax: tax.employerBorneTax, trace: tax.trace } as Prisma.InputJsonValue,
        });
        for (const item of social.lines) targetLines.push({
          code: item.code, name: item.code, componentType: 'DEDUCTION' as never, amount: item.employeeAmount, taxableAmount: 0,
          employerAmount: item.employerAmount, source: 'SOCIAL_SECURITY', metadata: item.metadata,
        });

        const recognized = recognizedByEmployee.get(employee.id) ?? [];
        const recognizedGross = recognized.reduce((sum, row) => sum.plus(row.grossPay), decimal(0));
        const recognizedTaxable = recognized.reduce((sum, row) => sum.plus(row.taxableIncome), decimal(0));
        const recognizedEmployeeContribution = recognized.reduce((sum, row) => sum.plus(row.employeeContribution), decimal(0));
        const recognizedEmployerContribution = recognized.reduce((sum, row) => sum.plus(row.employerContribution), decimal(0));
        const recognizedTax = recognized.reduce((sum, row) => sum.plus(row.incomeTax), decimal(0));
        const recognizedOtherDeductions = recognized.reduce((sum, row) => sum.plus(row.otherDeductions), decimal(0));
        const recognizedNet = recognized.reduce((sum, row) => sum.plus(row.netPay), decimal(0));

        const resultGross = isAdjustment ? decimal(gross).minus(recognizedGross) : decimal(gross);
        const resultTaxable = isAdjustment ? decimal(taxableIncome).minus(recognizedTaxable) : decimal(taxableIncome);
        const resultEmployeeContribution = isAdjustment ? decimal(social.employee).minus(recognizedEmployeeContribution) : decimal(social.employee);
        const resultEmployerContribution = isAdjustment ? decimal(social.employer).minus(recognizedEmployerContribution) : decimal(social.employer);
        const resultTax = isAdjustment ? decimal(tax.amount).minus(recognizedTax) : decimal(tax.amount);
        const resultOtherDeductions = isAdjustment ? decimal(otherDeductions).minus(recognizedOtherDeductions) : decimal(otherDeductions);
        const resultNet = isAdjustment ? decimal(net).minus(recognizedNet) : decimal(net);

        const calculationTrace = {
          status: componentReviews.length || tax.trace.status === 'REQUIRES_REVIEW' || social.trace.status === 'REQUIRES_REVIEW'
            ? 'REQUIRES_REVIEW' : 'CALCULATED',
          components: componentReviews,
          tax: tax.trace,
          socialSecurity: social.trace,
          attendance: { ...attendance, cutoffAt: period.attendanceCutoffAt?.toISOString() ?? null },
          ruleVersions: { taxRuleSetIds: taxRuleSets.map((item) => item.id), socialSecurityRuleSetIds: socialRuleSets.map((item) => item.id) },
          ...(isAdjustment ? { adjustment: {
            sourcePayrollRunId: run.adjustmentOfRunId, recognitionRunIds,
            target: { grossPay: gross, taxableIncome, employeeContribution: social.employee, employerContribution: social.employer, incomeTax: tax.amount, otherDeductions, netPay: net },
            recognized: { grossPay: recognizedGross.toFixed(2), taxableIncome: recognizedTaxable.toFixed(2), employeeContribution: recognizedEmployeeContribution.toFixed(2), employerContribution: recognizedEmployerContribution.toFixed(2), incomeTax: recognizedTax.toFixed(2), otherDeductions: recognizedOtherDeductions.toFixed(2), netPay: recognizedNet.toFixed(2) },
          } } : {}),
        };
        const result = await tx.payrollResult.upsert({
          where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId: employee.id } },
          create: {
            companyId: scope.companyId, payrollRunId: runId, payrollPeriodId: period.id, employeeId: employee.id,
            attendanceSnapshot: attendance as unknown as Prisma.InputJsonValue, grossPay: resultGross, taxableIncome: resultTaxable,
            employeeContribution: resultEmployeeContribution, employerContribution: resultEmployerContribution, incomeTax: resultTax,
            otherDeductions: resultOtherDeductions, netPay: resultNet, calculationTrace: calculationTrace as Prisma.InputJsonValue,
            status: calculationTrace.status,
          },
          update: {
            attendanceSnapshot: attendance as unknown as Prisma.InputJsonValue, grossPay: resultGross, taxableIncome: resultTaxable,
            employeeContribution: resultEmployeeContribution, employerContribution: resultEmployerContribution, incomeTax: resultTax,
            otherDeductions: resultOtherDeductions, netPay: resultNet, calculationTrace: calculationTrace as Prisma.InputJsonValue, status: calculationTrace.status,
          },
        });
        await tx.payrollLine.deleteMany({ where: { payrollResultId: result.id } });

        let outputLines = targetLines;
        if (isAdjustment) {
          type LineShape = { componentId?: string | null; code: string; name: string; componentType: never; amount: number; taxableAmount: number; employerAmount: number; source: string; metadata?: Prisma.InputJsonValue };
          const lineKey = (line: { componentId?: string | null; code: string; componentType: unknown }) => `${line.componentId ?? ''}|${line.code}|${String(line.componentType)}`;
          const targetMap = new Map<string, LineShape>();
          for (const line of targetLines) targetMap.set(lineKey(line), { ...line });
          const priorMap = new Map<string, LineShape>();
          for (const line of recognizedLinesByEmployee.get(employee.id) ?? []) {
            const key = lineKey(line); const current = priorMap.get(key);
            if (current) {
              current.amount += Number(line.amount); current.taxableAmount += Number(line.taxableAmount); current.employerAmount += Number(line.employerAmount);
            } else {
              priorMap.set(key, { componentId: line.componentId, code: line.code, name: line.name, componentType: line.componentType as never, amount: Number(line.amount), taxableAmount: Number(line.taxableAmount), employerAmount: Number(line.employerAmount), source: line.source ?? 'ADJUSTMENT_BASE' });
            }
          }
          outputLines = [];
          for (const key of new Set([...targetMap.keys(), ...priorMap.keys()])) {
            const target = targetMap.get(key); const prior = priorMap.get(key);
            const amount = (target?.amount ?? 0) - (prior?.amount ?? 0);
            const taxableAmountDelta = (target?.taxableAmount ?? 0) - (prior?.taxableAmount ?? 0);
            const employerAmountDelta = (target?.employerAmount ?? 0) - (prior?.employerAmount ?? 0);
            if ([amount, taxableAmountDelta, employerAmountDelta].every((value) => Math.abs(value) < 0.005)) continue;
            const base = target ?? prior!;
            outputLines.push({
              componentId: base.componentId ?? undefined, code: base.code, name: base.name, componentType: base.componentType,
              amount, taxableAmount: taxableAmountDelta, employerAmount: employerAmountDelta, source: 'ADJUSTMENT_DIFFERENTIAL',
              metadata: { targetAmount: target?.amount ?? 0, recognizedAmount: prior?.amount ?? 0, sourcePayrollRunId: run.adjustmentOfRunId },
            });
          }
        }
        if (outputLines.length) await tx.payrollLine.createMany({ data: outputLines.map(({ metadata, ...line }) => ({ ...line, payrollResultId: result.id, metadata })) });

        grossTotal = grossTotal.plus(resultGross);
        deductionTotal = deductionTotal.plus(resultOtherDeductions).plus(resultEmployeeContribution);
        employeeContributionTotal = employeeContributionTotal.plus(resultEmployeeContribution);
        taxTotal = taxTotal.plus(resultTax);
        employerTotal = employerTotal.plus(resultEmployerContribution);
        netTotal = netTotal.plus(resultNet);
      }

      const updatedRun = await tx.payrollRun.update({ where: { id: runId }, data: {
        status: 'REVIEW', employeeCount: employees.length, grossTotal, deductionTotal, taxTotal,
        employerContributionTotal: employerTotal, netTotal, calculatedAt: new Date(),
      } });
      if (!isAdjustment) {
        const existingSummary = await tx.payrollPeriodSummary.findFirst({ where: { companyId: scope.companyId, payrollPeriodId: period.id, branchId: scope.branchId } });
        const summaryData = {
          companyId: scope.companyId, branchId: scope.branchId, payrollPeriodId: period.id, employeeCount: employees.length,
          grossTotal, deductionTotal, employeeContributionTotal, employerContributionTotal: employerTotal, taxTotal, netTotal, status: 'CALCULATED',
        };
        if (existingSummary) await tx.payrollPeriodSummary.update({ where: { id: existingSummary.id }, data: summaryData });
        else await tx.payrollPeriodSummary.create({ data: summaryData });
      }
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: isAdjustment ? 'CALCULATE_PAYROLL_ADJUSTMENT_RUN' : 'CALCULATE_PAYROLL_RUN', entityType: 'PayrollRun', entityId: runId,
        payload: { branchId: scope.branchId, employeeCount: employees.length, adjustmentOfRunId: run.adjustmentOfRunId ?? null, recognitionRunIds },
      } });
      return updatedRun;
    });
  }

  async approveRun(runId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const run = await this.scopedRun(tx, user, scope, runId);
      if (run.status !== 'REVIEW') throw new BadRequestException('Payroll harus berstatus REVIEW.');
      const activeEmployeeCount = await tx.employee.count({ where: { companyId: scope.companyId, branchId: scope.branchId, isActive: true } });
      const results = await tx.payrollResult.findMany({ where: { payrollRunId: run.id, companyId: scope.companyId } });
      if (!results.length || run.employeeCount !== results.length) throw new BadRequestException('Hasil payroll tidak konsisten dengan run. Hitung ulang payroll.');
      if (!run.adjustmentOfRunId && (results.length !== activeEmployeeCount || run.employeeCount !== activeEmployeeCount)) {
        throw new BadRequestException('Hasil payroll tidak mencakup seluruh karyawan aktif. Hitung ulang payroll.');
      }
      if (run.adjustmentOfRunId) {
        const source = await this.scopedRun(tx, user, scope, run.adjustmentOfRunId);
        if (source.adjustmentOfRunId || !['POSTED', 'PAID'].includes(source.status)) throw new BadRequestException('Sumber adjustment tidak lagi valid.');
        const hasDifference = [run.grossTotal, run.deductionTotal, run.taxTotal, run.employerContributionTotal, run.netTotal].some((value) => !value.isZero());
        if (!hasDifference) throw new BadRequestException('Adjustment tidak memiliki selisih terhadap payroll yang sudah diakui.');
      }
      const needsReview = results.filter((result) => result.status !== 'CALCULATED' || this.traceRequiresReview(result.calculationTrace));
      if (needsReview.length) throw new BadRequestException(`${needsReview.length} hasil payroll masih REQUIRES_REVIEW. Perbaiki rule/input lalu hitung ulang.`);
      const updated = await tx.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: run.adjustmentOfRunId ? 'APPROVE_PAYROLL_ADJUSTMENT_RUN' : 'APPROVE_PAYROLL_RUN', entityType: 'PayrollRun', entityId: runId, payload: { branchId: scope.branchId, adjustmentOfRunId: run.adjustmentOfRunId ?? null } } });
      return updated;
    });
  }

  private async resolvePayrollAccounts(client: DbClient, scope: TenantScope) {
    const mappings = await client.payrollAccountingMapping.findMany({ where: {
      companyId: scope.companyId, isActive: true,
      componentCode: { in: Object.values(PAYROLL_MAPPING_CODES) },
      OR: [{ branchId: scope.branchId }, { branchId: null }],
    } });
    const choose = (componentCode: string) => mappings.find((item) => item.componentCode === componentCode && item.branchId === scope.branchId)
      ?? mappings.find((item) => item.componentCode === componentCode && item.branchId === null);
    const expenseMapping = choose(PAYROLL_MAPPING_CODES.expense);
    const salaryMapping = choose(PAYROLL_MAPPING_CODES.salaryPayable);
    const taxMapping = choose(PAYROLL_MAPPING_CODES.taxPayable);
    const otherMapping = choose(PAYROLL_MAPPING_CODES.otherPayable);
    const receivableMapping = choose(PAYROLL_MAPPING_CODES.employeeReceivable);
    if (!expenseMapping?.debitAccountId || !salaryMapping?.creditAccountId || !taxMapping?.creditAccountId || !otherMapping?.creditAccountId) {
      throw new BadRequestException('PayrollAccountingMapping belum lengkap. Jalankan canonical seed/konfigurasi akun payroll sebelum posting.');
    }
    const ids = [expenseMapping.debitAccountId, salaryMapping.creditAccountId, taxMapping.creditAccountId, otherMapping.creditAccountId, ...(receivableMapping?.debitAccountId ? [receivableMapping.debitAccountId] : [])];
    const accounts = await client.account.findMany({ where: { id: { in: ids }, branchId: scope.branchId, isActive: true, branch: { companyId: scope.companyId } }, select: { id: true, code: true } });
    const byId = new Map(accounts.map((item) => [item.id, item.code]));
    const payrollExpense = byId.get(expenseMapping.debitAccountId);
    const salaryPayable = byId.get(salaryMapping.creditAccountId);
    const payrollTaxPayable = byId.get(taxMapping.creditAccountId);
    const payrollOtherPayable = byId.get(otherMapping.creditAccountId);
    const payrollReceivable = receivableMapping?.debitAccountId ? byId.get(receivableMapping.debitAccountId) : undefined;
    if (!payrollExpense || !salaryPayable || !payrollTaxPayable || !payrollOtherPayable) throw new BadRequestException('Akun mapping payroll tidak aktif atau bukan milik branch ini.');
    return { payrollExpense, salaryPayable, payrollTaxPayable, payrollOtherPayable, payrollReceivable };
  }

  async postAccounting(runId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const run = await this.scopedRun(tx, user, scope, runId);
      if (['POSTED', 'PAID'].includes(run.status) && run.postedJournalEntryId) return run;
      if (run.status !== 'APPROVED') throw new BadRequestException('Payroll belum disetujui.');
      const period = await this.assertPeriod(tx, user, scope, run.payrollPeriodId);
      const accounts = await this.resolvePayrollAccounts(tx, scope);
      const results = await tx.payrollResult.findMany({ where: { payrollRunId: run.id, companyId: scope.companyId } });
      if (results.length !== run.employeeCount) throw new BadRequestException('Jumlah hasil payroll berubah sejak approval. Hitung ulang payroll.');
      const employeeContribution = results.reduce((sum, row) => sum.plus(row.employeeContribution), decimal(0));
      const otherDeductions = results.reduce((sum, row) => sum.plus(row.otherDeductions), decimal(0));
      const payrollOtherPayable = employeeContribution.plus(otherDeductions).plus(run.employerContributionTotal);

      if (run.adjustmentOfRunId) {
        const source = await this.scopedRun(tx, user, scope, run.adjustmentOfRunId);
        if (source.adjustmentOfRunId || !['POSTED', 'PAID'].includes(source.status)) throw new BadRequestException('Sumber adjustment tidak lagi valid untuk posting.');
        const previousAdjustments = await tx.payrollRun.findMany({ where: {
          companyId: scope.companyId, branchId: scope.branchId, adjustmentOfRunId: source.id,
          id: { not: run.id }, adjustmentSequence: { lt: run.adjustmentSequence }, status: { in: ['POSTED', 'PAID'] },
        }, orderBy: { adjustmentSequence: 'asc' } });
        const recognitionRuns = [source, ...previousAdjustments];
        const recognitionRunIds = recognitionRuns.map((item) => item.id);
        const postingDate = run.adjustmentPostingDate ?? new Date();
        const fiscalPeriod = await tx.fiscalPeriod.findFirst({ where: {
          companyId: scope.companyId, branchId: scope.branchId, startDate: { lte: postingDate }, endDate: { gte: postingDate },
        }, orderBy: { startDate: 'desc' } });
        if (fiscalPeriod && fiscalPeriod.status !== 'OPEN') throw new BadRequestException(`Periode fiskal adjustment berstatus ${fiscalPeriod.status}; pilih tanggal posting pada periode OPEN.`);

        const settlements = await tx.operationalFinanceTransaction.findMany({ where: {
          companyId: scope.companyId, branchId: scope.branchId, referenceType: 'PayrollRun', referenceId: { in: recognitionRunIds },
          type: { in: ['PAYROLL_LIABILITY_PAYMENT', 'TAX_PAYMENT'] as never[] }, status: { not: 'CANCELLED' },
        }, select: { debitAccountCode: true, grossAmount: true, status: true } });
        const recognizedTax = recognitionRuns.reduce((sum, item) => sum.plus(item.taxTotal), decimal(0));
        const recognizedOther = recognitionRuns.reduce((sum, item) => sum.plus(item.deductionTotal).plus(item.employerContributionTotal), decimal(0));
        const committed = (accountCode: string) => settlements
          .filter((item) => item.debitAccountCode === accountCode && ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'POSTED', 'PAID'].includes(item.status))
          .reduce((sum, item) => sum.plus(item.grossAmount), decimal(0));
        const committedTax = committed('2103');
        const committedOther = committed('2104');
        if (run.taxTotal.lessThan(0) && run.taxTotal.abs().greaterThan(nonNegative(recognizedTax.minus(committedTax)))) {
          throw new BadRequestException('Koreksi pajak melebihi utang pajak payroll yang belum dibayar/belum dicadangkan settlement. Batalkan draft/approval pembayaran yang berlebih atau rekonsiliasi refund/offset eksternal sebelum adjustment diposting.');
        }
        if (payrollOtherPayable.lessThan(0) && payrollOtherPayable.abs().greaterThan(nonNegative(recognizedOther.minus(committedOther)))) {
          throw new BadRequestException('Koreksi BPJS/potongan melebihi kewajiban yang belum dibayar/belum dicadangkan settlement. Batalkan draft/approval pembayaran yang berlebih atau rekonsiliasi refund/offset eksternal terlebih dahulu.');
        }

        let salaryPayableReduction = decimal(0);
        let employeeReceivable = decimal(0);
        const recoveryByResult = new Map<string, Prisma.Decimal>();
        for (const result of results.filter((item) => item.netPay.lessThan(0))) {
          let reductionNeeded = result.netPay.abs();
          const processing = await tx.payrollPayment.count({ where: {
            companyId: scope.companyId, employeeId: result.employeeId, payrollRunId: { in: recognitionRunIds }, direction: 'OUTBOUND', status: 'PROCESSING',
          } });
          if (processing) throw new BadRequestException(`Pembayaran gaji ${result.employeeId} sedang PROCESSING; adjustment penurunan harus menunggu settlement selesai/gagal.`);
          const pending = await tx.payrollPayment.findMany({ where: {
            companyId: scope.companyId, employeeId: result.employeeId, payrollRunId: { in: recognitionRunIds }, direction: 'OUTBOUND', status: { in: ['PENDING', 'FAILED'] },
          }, orderBy: { createdAt: 'desc' } });
          for (const payment of pending) {
            if (reductionNeeded.isZero()) break;
            const applied = payment.amount.lessThan(reductionNeeded) ? payment.amount : reductionNeeded;
            const nextAmount = payment.amount.minus(applied);
            await tx.payrollPayment.update({ where: { id: payment.id }, data: nextAmount.isZero()
              ? { status: 'CANCELLED', failureReason: `Reduced by payroll adjustment ${run.number}` }
              : { amount: nextAmount, failureReason: payment.status === 'FAILED' ? payment.failureReason : null } });
            salaryPayableReduction = salaryPayableReduction.plus(applied);
            reductionNeeded = reductionNeeded.minus(applied);
          }
          if (reductionNeeded.greaterThan(0)) {
            if (!accounts.payrollReceivable) throw new BadRequestException('Mapping __PAYROLL_RECEIVABLE__ wajib dikonfigurasi untuk recovery kelebihan gaji yang sudah dibayar.');
            employeeReceivable = employeeReceivable.plus(reductionNeeded);
            recoveryByResult.set(result.id, reductionNeeded);
          }
        }

        const accountCodes = [accounts.payrollExpense, accounts.salaryPayable, accounts.payrollTaxPayable, accounts.payrollOtherPayable, ...(accounts.payrollReceivable ? [accounts.payrollReceivable] : [])];
        const accountRows = await tx.account.findMany({ where: { branchId: scope.branchId, code: { in: accountCodes }, isActive: true, branch: { companyId: scope.companyId } }, select: { id: true, code: true } });
        const accountByCode = new Map(accountRows.map((item) => [item.code, item.id]));
        const journalLines: Array<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }> = [];
        const pushSigned = (accountCode: string, signedAmount: Prisma.Decimal, positiveSide: 'DEBIT' | 'CREDIT') => {
          if (signedAmount.isZero()) return;
          const accountId = accountByCode.get(accountCode); if (!accountId) throw new BadRequestException(`Akun payroll ${accountCode} tidak tersedia pada branch.`);
          const positive = signedAmount.greaterThan(0); const side = positive ? positiveSide : (positiveSide === 'DEBIT' ? 'CREDIT' : 'DEBIT'); const amount = signedAmount.abs();
          journalLines.push({ accountId, debit: side === 'DEBIT' ? amount : decimal(0), credit: side === 'CREDIT' ? amount : decimal(0) });
        };
        const expenseDelta = run.netTotal.plus(run.taxTotal).plus(payrollOtherPayable);
        pushSigned(accounts.payrollExpense, expenseDelta, 'DEBIT');
        const positiveSalaryPayable = results.filter((item) => item.netPay.greaterThan(0)).reduce((sum, item) => sum.plus(item.netPay), decimal(0));
        if (positiveSalaryPayable.greaterThan(0)) pushSigned(accounts.salaryPayable, positiveSalaryPayable, 'CREDIT');
        if (salaryPayableReduction.greaterThan(0)) pushSigned(accounts.salaryPayable, salaryPayableReduction.negated(), 'CREDIT');
        if (employeeReceivable.greaterThan(0)) pushSigned(accounts.payrollReceivable!, employeeReceivable, 'DEBIT');
        pushSigned(accounts.payrollTaxPayable, run.taxTotal, 'CREDIT');
        pushSigned(accounts.payrollOtherPayable, payrollOtherPayable, 'CREDIT');
        const debitTotal = journalLines.reduce((sum, item) => sum.plus(item.debit), decimal(0));
        const creditTotal = journalLines.reduce((sum, item) => sum.plus(item.credit), decimal(0));
        if (!journalLines.length || !debitTotal.equals(creditTotal)) throw new BadRequestException(`Jurnal adjustment payroll tidak seimbang. Debit ${debitTotal.toFixed(2)}, kredit ${creditTotal.toFixed(2)}.`);

        const event = await tx.accountingEvent.create({ data: {
          companyId: scope.companyId, branchId: scope.branchId, eventType: 'PAYROLL_ADJUSTMENT', sourceType: 'PayrollRun', sourceId: run.id,
          idempotencyKey: `payroll-adjustment:${run.id}`, businessDate: postingDate, currency: 'IDR',
          netAmount: expenseDelta.minus(run.taxTotal), taxAmount: run.taxTotal, grossAmount: expenseDelta, status: 'VALIDATED',
          context: { sourcePayrollRunId: source.id, adjustmentSequence: run.adjustmentSequence, reason: run.adjustmentReason, recognitionRunIds, salaryPayableReduction: salaryPayableReduction.toFixed(2), employeeReceivable: employeeReceivable.toFixed(2) },
        } });
        const journalEntry = await tx.journalEntry.create({ data: {
          number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'JOURNAL', prefix: 'JRN' }), date: postingDate,
          referenceType: 'PayrollRun', referenceId: run.id, description: `PAYROLL_ADJUSTMENT ${run.number}`,
          lines: { create: journalLines },
        } });
        const taxCode = await tx.taxCode.findFirst({ where: { companyId: scope.companyId, code: 'PAYROLL_WITHHOLDING', status: 'ACTIVE' } });
        if (taxCode && !run.taxTotal.isZero()) {
          await tx.taxTransaction.create({ data: {
            companyId: scope.companyId, branchId: scope.branchId, accountingEventId: event.id, sourceType: 'PayrollRun', sourceId: run.id,
            taxCodeId: taxCode.id, direction: 'WITHHOLDING', transactionDate: postingDate,
            taxableBase: results.reduce((sum, row) => sum.plus(row.taxableIncome), decimal(0)), taxAmount: run.taxTotal, status: 'POSTED',
            counterpartyType: 'EMPLOYEE_GROUP', counterpartyId: run.id, documentNumber: run.number,
            metadata: { adjustmentOfRunId: source.id, adjustmentSequence: run.adjustmentSequence },
          } });
        }
        await tx.accountingEvent.update({ where: { id: event.id }, data: { status: 'POSTED', journalEntryId: journalEntry.id } });

        for (const result of results.filter((item) => item.netPay.greaterThan(0))) {
          await tx.payrollPayment.upsert({
            where: { payrollResultId: result.id },
            create: { companyId: scope.companyId, payrollRunId: run.id, payrollResultId: result.id, employeeId: result.employeeId, paymentMethod: 'PENDING_SELECTION', direction: 'OUTBOUND', amount: result.netPay, status: 'PENDING' },
            update: { direction: 'OUTBOUND', amount: result.netPay, status: 'PENDING' },
          });
        }
        for (const [resultId, amount] of recoveryByResult) {
          const result = results.find((item) => item.id === resultId)!;
          await tx.payrollPayment.upsert({
            where: { payrollResultId: result.id },
            create: { companyId: scope.companyId, payrollRunId: run.id, payrollResultId: result.id, employeeId: result.employeeId, paymentMethod: 'PENDING_RECOVERY', direction: 'RECOVERY', amount, status: 'PENDING' },
            update: { direction: 'RECOVERY', amount, status: 'PENDING' },
          });
        }
        for (const recognizedRunId of recognitionRunIds) {
          const remaining = await tx.payrollPayment.count({ where: { payrollRunId: recognizedRunId, companyId: scope.companyId, status: { notIn: ['PAID', 'CANCELLED'] } } });
          if (!remaining) await tx.payrollRun.updateMany({ where: { id: recognizedRunId, companyId: scope.companyId, branchId: scope.branchId, status: 'POSTED' }, data: { status: 'PAID' } });
        }
        const pendingAdjustmentPayments = await tx.payrollPayment.count({ where: { payrollRunId: run.id, companyId: scope.companyId, status: { notIn: ['PAID', 'CANCELLED'] } } });
        const updated = await tx.payrollRun.update({ where: { id: run.id }, data: { status: pendingAdjustmentPayments ? 'POSTED' : 'PAID', postedJournalEntryId: journalEntry.id } });

        const recognizedAfter = [source.id, ...previousAdjustments.map((item) => item.id), run.id];
        const postedRuns = await tx.payrollRun.findMany({ where: { id: { in: recognizedAfter }, companyId: scope.companyId, branchId: scope.branchId, status: { in: ['POSTED', 'PAID'] } } });
        const postedResults = await tx.payrollResult.findMany({ where: { companyId: scope.companyId, payrollRunId: { in: postedRuns.map((item) => item.id) } } });
        const summaryData = {
          companyId: scope.companyId, branchId: scope.branchId, payrollPeriodId: period.id,
          employeeCount: new Set(postedResults.map((item) => item.employeeId)).size,
          grossTotal: postedRuns.reduce((sum, item) => sum.plus(item.grossTotal), decimal(0)),
          deductionTotal: postedRuns.reduce((sum, item) => sum.plus(item.deductionTotal), decimal(0)),
          employeeContributionTotal: postedResults.reduce((sum, item) => sum.plus(item.employeeContribution), decimal(0)),
          employerContributionTotal: postedRuns.reduce((sum, item) => sum.plus(item.employerContributionTotal), decimal(0)),
          taxTotal: postedRuns.reduce((sum, item) => sum.plus(item.taxTotal), decimal(0)),
          netTotal: postedRuns.reduce((sum, item) => sum.plus(item.netTotal), decimal(0)), status: 'POSTED',
        };
        const existingSummary = await tx.payrollPeriodSummary.findFirst({ where: { companyId: scope.companyId, payrollPeriodId: period.id, branchId: scope.branchId } });
        if (existingSummary) await tx.payrollPeriodSummary.update({ where: { id: existingSummary.id }, data: summaryData }); else await tx.payrollPeriodSummary.create({ data: summaryData });
        await tx.auditLog.create({ data: {
          companyId: scope.companyId, userId: user.sub, action: 'POST_PAYROLL_ADJUSTMENT_ACCOUNTING', entityType: 'PayrollRun', entityId: run.id,
          payload: { branchId: scope.branchId, sourcePayrollRunId: source.id, adjustmentSequence: run.adjustmentSequence, journalEntryId: journalEntry.id, pendingSettlements: pendingAdjustmentPayments },
        } });
        return updated;
      }

      const debit = run.netTotal.plus(run.taxTotal).plus(payrollOtherPayable); // exact credits total; includes reimbursements/non-gross net components
      const taxCode = await tx.taxCode.findFirst({ where: { companyId: scope.companyId, code: 'PAYROLL_WITHHOLDING', status: 'ACTIVE' } });
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'PAYROLL_POSTED', sourceType: 'PayrollRun', sourceId: run.id,
        idempotencyKey: `payroll-post:${run.id}`, businessDate: period.endDate,
        amounts: {
          payrollExpense: debit, salaryPayable: run.netTotal, payrollTaxPayable: run.taxTotal,
          payrollOtherPayable, gross: debit, net: run.grossTotal, tax: run.taxTotal,
        },
        accountCodes: {
          payrollExpense: accounts.payrollExpense,
          salaryPayable: accounts.salaryPayable,
          payrollTaxPayable: accounts.payrollTaxPayable,
          payrollOtherPayable: accounts.payrollOtherPayable,
          ...(accounts.payrollReceivable ? { payrollReceivable: accounts.payrollReceivable } : {}),
        },
        taxLines: taxCode && run.taxTotal.greaterThan(0) ? [{
          taxCodeId: taxCode.id, direction: 'WITHHOLDING', taxableBase: results.reduce((sum, row) => sum.plus(row.taxableIncome), decimal(0)), taxAmount: run.taxTotal,
          counterpartyType: 'EMPLOYEE_GROUP', counterpartyId: run.id, documentNumber: run.number,
        }] : [],
        context: { employeeCount: run.employeeCount, payrollPeriodId: run.payrollPeriodId, employerContribution: run.employerContributionTotal, employeeContribution, otherDeductions },
      });
      for (const result of results.filter((item) => item.netPay.greaterThan(0))) {
        await tx.payrollPayment.upsert({
          where: { payrollResultId: result.id },
          create: { companyId: scope.companyId, payrollRunId: run.id, payrollResultId: result.id, employeeId: result.employeeId, paymentMethod: 'PENDING_SELECTION', direction: 'OUTBOUND', amount: result.netPay, status: 'PENDING' },
          update: { direction: 'OUTBOUND', amount: result.netPay },
        });
      }
      const paymentCount = await tx.payrollPayment.count({ where: { payrollRunId: run.id, companyId: scope.companyId } });
      const updated = await tx.payrollRun.update({ where: { id: run.id }, data: { status: paymentCount ? 'POSTED' : 'PAID', postedJournalEntryId: event.journalEntryId } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'POST_PAYROLL_ACCOUNTING', entityType: 'PayrollRun', entityId: run.id,
        payload: { branchId: scope.branchId, journalEntryId: event.journalEntryId, salaryPaymentsPrepared: paymentCount },
      } });
      return updated;
    });
  }

  async settlePayment(paymentId: string, dto: SettlePayrollPaymentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const payment = await tx.payrollPayment.findFirst({ where: { id: paymentId, companyId: scope.companyId } });
      if (!payment) return this.denyTenantAccess(tx, user, scope, 'PayrollPayment', paymentId);
      const run = await this.scopedRun(tx, user, scope, payment.payrollRunId);
      if (!['POSTED', 'PAID'].includes(run.status)) throw new BadRequestException(`Payroll run berstatus ${run.status}; settlement belum dapat diselesaikan.`);
      if (payment.status === 'PAID') {
        if (payment.settlementAccountCode === dto.settlementAccountCode
          && payment.paymentMethod === dto.paymentMethod
          && (payment.externalReference ?? null) === (dto.externalReference ?? null)) return payment;
        throw new ConflictException('Payroll payment sudah PAID dengan detail settlement berbeda.');
      }
      if (!['PENDING', 'FAILED'].includes(payment.status)) throw new BadRequestException(`Payroll payment berstatus ${payment.status}.`);
      const settlementAccount = await tx.account.findFirst({ where: {
        branchId: scope.branchId, code: dto.settlementAccountCode, type: 'ASSET', isActive: true, branch: { companyId: scope.companyId },
      } });
      if (!settlementAccount) throw new BadRequestException(payment.direction === 'RECOVERY' ? 'Akun penerimaan recovery harus berupa akun aset aktif pada branch.' : 'Akun sumber pembayaran gaji harus berupa akun aset aktif pada branch.');
      if (settlementAccount.code !== '1101' && !dto.externalReference?.trim()) {
        throw new BadRequestException('Referensi transaksi bank wajib diisi untuk settlement payroll non-tunai.');
      }
      const accounts = await this.resolvePayrollAccounts(tx, scope);
      const paidAt = dto.paidAt ? parseDate(dto.paidAt, 'Tanggal settlement payroll') : new Date();
      const isRecovery = payment.direction === 'RECOVERY';
      if (isRecovery && !accounts.payrollReceivable) throw new BadRequestException('Mapping __PAYROLL_RECEIVABLE__ belum dikonfigurasi.');
      const event = await this.accounting.postOperationalEvent(tx, isRecovery ? {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'PAYROLL_EMPLOYEE_RECOVERY', sourceType: 'PayrollPayment', sourceId: payment.id,
        idempotencyKey: `payroll-employee-recovery:${payment.id}`, businessDate: paidAt,
        amounts: { gross: payment.amount }, accountCodes: { settlement: settlementAccount.code, payrollReceivable: accounts.payrollReceivable! },
        context: { payrollRunId: run.id, employeeId: payment.employeeId, direction: payment.direction, paymentMethod: dto.paymentMethod, externalReference: dto.externalReference ?? null },
      } : {
        companyId: scope.companyId, branchId: scope.branchId, eventType: 'PAYROLL_SALARY_PAYMENT', sourceType: 'PayrollPayment', sourceId: payment.id,
        idempotencyKey: `payroll-salary-payment:${payment.id}`, businessDate: paidAt,
        amounts: { gross: payment.amount }, accountCodes: { salaryPayable: accounts.salaryPayable, settlement: settlementAccount.code },
        context: { payrollRunId: run.id, employeeId: payment.employeeId, direction: payment.direction, paymentMethod: dto.paymentMethod, externalReference: dto.externalReference ?? null },
      });
      const updated = await tx.payrollPayment.update({ where: { id: payment.id }, data: {
        status: 'PAID', paymentMethod: dto.paymentMethod, settlementAccountCode: settlementAccount.code,
        externalReference: dto.externalReference, accountingEventId: event.id, paidAt,
      } });
      const remaining = await tx.payrollPayment.count({ where: { payrollRunId: run.id, companyId: scope.companyId, status: { notIn: ['PAID', 'CANCELLED'] } } });
      if (!remaining) await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'PAID' } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: isRecovery ? 'SETTLE_PAYROLL_RECOVERY' : 'SETTLE_PAYROLL_PAYMENT', entityType: 'PayrollPayment', entityId: payment.id,
        payload: { branchId: scope.branchId, payrollRunId: run.id, direction: payment.direction, amount: payment.amount, settlementAccountCode: settlementAccount.code, accountingEventId: event.id },
      } });
      return updated;
    });
  }

  async listRunResults(runId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const run = await this.scopedRun(this.prisma, user, scope, runId);
    return this.prisma.payrollResult.findMany({ where: { payrollRunId: run.id, companyId: scope.companyId }, orderBy: { employeeId: 'asc' }, take: 2000 });
  }

  async listPayments(runId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const run = await this.scopedRun(this.prisma, user, scope, runId);
    return this.prisma.payrollPayment.findMany({ where: { payrollRunId: run.id, companyId: scope.companyId }, orderBy: { createdAt: 'asc' }, take: 2000 });
  }

  async listLiabilities(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const roots = await this.prisma.payrollRun.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId, adjustmentOfRunId: null, status: { in: ['POSTED', 'PAID'] } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    const output = [];
    for (const root of roots) {
      const chainRuns = await this.prisma.payrollRun.findMany({ where: {
        companyId: scope.companyId, branchId: scope.branchId, status: { in: ['POSTED', 'PAID'] },
        OR: [{ id: root.id }, { adjustmentOfRunId: root.id }],
      }, orderBy: { adjustmentSequence: 'asc' } });
      const chainRunIds = chainRuns.map((item) => item.id);
      const [salaryPayments, settlements] = await Promise.all([
        this.prisma.payrollPayment.findMany({ where: { companyId: scope.companyId, payrollRunId: { in: chainRunIds } }, select: { amount: true, status: true, direction: true } }),
        this.prisma.operationalFinanceTransaction.findMany({ where: {
          companyId: scope.companyId, branchId: scope.branchId, referenceType: 'PayrollRun', referenceId: { in: chainRunIds },
          type: { in: ['PAYROLL_LIABILITY_PAYMENT', 'TAX_PAYMENT'] as never[] }, status: { not: 'CANCELLED' },
        }, select: { debitAccountCode: true, grossAmount: true, status: true } }),
      ]);
      let salaryPaid = decimal(0); let salaryPending = decimal(0); let recoveryRecognized = decimal(0); let recoveryPaid = decimal(0); let recoveryPending = decimal(0);
      for (const payment of salaryPayments) {
        if (payment.direction === 'RECOVERY') {
          recoveryRecognized = recoveryRecognized.plus(payment.amount);
          if (payment.status === 'PAID') recoveryPaid = recoveryPaid.plus(payment.amount);
          else if (['PENDING', 'PROCESSING', 'FAILED'].includes(payment.status)) recoveryPending = recoveryPending.plus(payment.amount);
          continue;
        }
        if (payment.status === 'PAID') salaryPaid = salaryPaid.plus(payment.amount);
        else if (['PENDING', 'PROCESSING', 'FAILED'].includes(payment.status)) salaryPending = salaryPending.plus(payment.amount);
      }
      const settle = (accountCode: string, posted: boolean) => settlements
        .filter((row) => row.debitAccountCode === accountCode && (posted ? ['POSTED', 'PAID'].includes(row.status) : ['DRAFT', 'WAITING_APPROVAL', 'APPROVED'].includes(row.status)))
        .reduce((sum, row) => sum.plus(row.grossAmount), decimal(0));
      const recognizedSalary = chainRuns.reduce((sum, item) => sum.plus(item.netTotal), decimal(0));
      const recognizedTax = chainRuns.reduce((sum, item) => sum.plus(item.taxTotal), decimal(0));
      const recognizedOther = chainRuns.reduce((sum, item) => sum.plus(item.deductionTotal).plus(item.employerContributionTotal), decimal(0));
      const taxPaid = settle('2103', true); const taxPending = settle('2103', false);
      const otherPaid = settle('2104', true); const otherPending = settle('2104', false);
      output.push({
        payrollRunId: root.id, number: root.number, status: root.status, payrollPeriodId: root.payrollPeriodId, adjustmentCount: chainRuns.length - 1,
        salary: { recognized: recognizedSalary.toFixed(2), paid: salaryPaid.toFixed(2), pending: salaryPending.toFixed(2), outstanding: nonNegative(recognizedSalary.minus(salaryPaid)).toFixed(2) },
        tax: { recognized: recognizedTax.toFixed(2), paid: taxPaid.toFixed(2), pending: taxPending.toFixed(2), availableToPay: nonNegative(recognizedTax.minus(taxPaid).minus(taxPending)).toFixed(2), outstanding: nonNegative(recognizedTax.minus(taxPaid)).toFixed(2) },
        socialAndOther: { recognized: recognizedOther.toFixed(2), paid: otherPaid.toFixed(2), pending: otherPending.toFixed(2), availableToPay: nonNegative(recognizedOther.minus(otherPaid).minus(otherPending)).toFixed(2), outstanding: nonNegative(recognizedOther.minus(otherPaid)).toFixed(2) },
        recovery: { recognized: recoveryRecognized.toFixed(2), paid: recoveryPaid.toFixed(2), pending: recoveryPending.toFixed(2), outstanding: nonNegative(recoveryRecognized.minus(recoveryPaid)).toFixed(2) },
      });
    }
    return output;
  }

  async publishPayslips(runId: string, dto: PublishPayslipsDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const run = await this.scopedRun(this.prisma, user, scope, runId);
    if (run.status !== 'PAID') throw new BadRequestException('Slip gaji hanya dapat diterbitkan setelah pembayaran gaji selesai (status PAID).');
    const allResults = await this.prisma.payrollResult.findMany({ where: { payrollRunId: runId, companyId: scope.companyId } });
    const results = run.adjustmentOfRunId ? allResults.filter((result) => [result.grossPay, result.taxableIncome, result.employeeContribution, result.employerContribution, result.incomeTax, result.otherDeductions, result.netPay].some((value) => !value.isZero())) : allResults;
    const baseUrl = dto.baseUrl ?? this.config.get('EMPLOYEE_PORTAL_URL') ?? 'http://localhost:3003';
    const requestedChannels = new Set(dto.channels ?? ['IN_APP', 'TELEGRAM', 'WHATSAPP']);
    let queued = 0;
    for (const result of results) {
      const employee = await this.prisma.employee.findFirst({ where: { id: result.employeeId, companyId: scope.companyId, branchId: scope.branchId } });
      if (!employee) continue;
      const payslip = await this.prisma.payslip.upsert({
        where: { payrollResultId: result.id },
        create: {
          companyId: scope.companyId, employeeId: employee.id, payrollResultId: result.id,
          number: await nextDocumentNumber(this.prisma, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'PAYSLIP', prefix: 'SLIP' }), generatedAt: new Date(),
          dataSnapshot: { payrollRunNumber: run.number, adjustmentOfRunId: run.adjustmentOfRunId, adjustmentSequence: run.adjustmentSequence, adjustmentReason: run.adjustmentReason, employeeNumber: employee.employeeNumber, employeeName: employee.fullName, grossPay: result.grossPay, taxableIncome: result.taxableIncome, incomeTax: result.incomeTax, deductions: result.otherDeductions, employeeContribution: result.employeeContribution, employerContribution: result.employerContribution, netPay: result.netPay },
        },
        update: { generatedAt: new Date(), dataSnapshot: { payrollRunNumber: run.number, adjustmentOfRunId: run.adjustmentOfRunId, adjustmentSequence: run.adjustmentSequence, adjustmentReason: run.adjustmentReason, employeeNumber: employee.employeeNumber, employeeName: employee.fullName, grossPay: result.grossPay, taxableIncome: result.taxableIncome, incomeTax: result.incomeTax, deductions: result.otherDeductions, employeeContribution: result.employeeContribution, employerContribution: result.employerContribution, netPay: result.netPay } },
      });
      const bindings = await this.prisma.employeeChannelBinding.findMany({ where: { companyId: scope.companyId, employeeId: employee.id, verifiedAt: { not: null }, revokedAt: null } });
      for (const binding of bindings.filter((item) => requestedChannels.has(item.channel))) {
        const preferences = await this.prisma.employeeNotificationPreference.findFirst({ where: { companyId: scope.companyId, employeeId: employee.id, eventCode: 'PAYSLIP_PUBLISHED', channel: binding.channel } });
        if (preferences && !preferences.enabled) continue;
        const recipient = binding.externalUserId ?? binding.addressHash;
        if (!recipient) continue;
        const secureLink = `${baseUrl}/payslips/${payslip.id}`;
        const notification = await this.prisma.notification.create({ data: {
          companyId: scope.companyId, channel: binding.channel, recipient, templateCode: 'PAYSLIP_PUBLISHED', subject: 'Slip gaji tersedia',
          body: `Halo ${employee.preferredName ?? employee.fullName}, slip gaji Anda sudah tersedia. Buka melalui tautan aman: ${secureLink}`,
          data: { employeeId: employee.id, payrollResultId: result.id, payslipId: payslip.id, secureLink },
        } });
        await this.prisma.employeeNotificationDelivery.create({ data: {
          companyId: scope.companyId, employeeId: employee.id, payrollResultId: result.id, eventCode: 'PAYSLIP_PUBLISHED', channel: binding.channel, notificationId: notification.id,
        } });
        queued++;
      }
    }
    await this.prisma.auditLog.create({ data: {
      companyId: scope.companyId, userId: user.sub, action: 'PUBLISH_PAYSLIPS', entityType: 'PayrollRun', entityId: runId,
      payload: { branchId: scope.branchId, payslips: results.length, notificationsQueued: queued },
    } });
    return { payslips: results.length, notificationsQueued: queued, deliveryMode: 'SECURE_LINK' };
  }

  async listRuns(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'PayrollRun');
    return this.prisma.payrollRun.findMany({ where: { companyId: scope.companyId, branchId: scope.branchId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  private async scopedEmployee(client: DbClient, user: AuthUser, scope: TenantScope, employeeId: string) {
    const employee = await client.employee.findFirst({ where: { id: employeeId, companyId: scope.companyId, branchId: scope.branchId, isActive: true } });
    if (!employee) return this.denyTenantAccess(client, user, scope, 'Employee', employeeId);
    return employee;
  }

  async employeeProfiles(employeeId: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.scopedEmployee(this.prisma, user, scope, employeeId);
    const [taxProfiles, socialProfiles] = await Promise.all([
      this.prisma.employeeTaxProfile.findMany({ where: { companyId: scope.companyId, employeeId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.employeeSocialSecurityProfile.findMany({ where: { companyId: scope.companyId, employeeId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }),
    ]);
    return {
      employeeId,
      supportedTaxMethods: ['GROSS', 'GROSS_UP', 'NET'],
      taxProfiles,
      socialSecurityProfiles: socialProfiles,
    };
  }

  private assertEffectiveRange(start: Date, end: Date | null, label: string) {
    if (end && end < start) throw new BadRequestException(`${label}: effectiveTo tidak boleh sebelum effectiveFrom.`);
  }

  async upsertEmployeeTaxProfile(dto: UpsertEmployeeTaxProfileDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const effectiveFrom = parseDate(dto.effectiveFrom, 'EmployeeTaxProfile.effectiveFrom');
    const effectiveTo = dto.effectiveTo ? parseRangeEnd(dto.effectiveTo, 'EmployeeTaxProfile.effectiveTo') : null;
    this.assertEffectiveRange(effectiveFrom, effectiveTo, 'EmployeeTaxProfile');
    return serializableTx(this.prisma, async (tx) => {
      const employee = await this.scopedEmployee(tx, user, scope, dto.employeeId);
      const overlap = await tx.employeeTaxProfile.findFirst({ where: {
        companyId: scope.companyId, employeeId: employee.id,
        effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        NOT: { effectiveFrom },
      } });
      if (overlap) throw new ConflictException('Rentang EmployeeTaxProfile bertumpang tindih dengan profile lain.');
      const row = await tx.employeeTaxProfile.upsert({
        where: { employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom } },
        create: { companyId: scope.companyId, employeeId: employee.id, countryCode: 'ID', taxStatusCode: dto.taxStatusCode, taxMethod: dto.taxMethod, annualizationMethod: dto.annualizationMethod, effectiveFrom, effectiveTo, attributes: dto.attributes as Prisma.InputJsonValue | undefined },
        update: { taxStatusCode: dto.taxStatusCode, taxMethod: dto.taxMethod, annualizationMethod: dto.annualizationMethod, effectiveTo, attributes: dto.attributes as Prisma.InputJsonValue | undefined },
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPSERT_EMPLOYEE_TAX_PROFILE', entityType: 'EmployeeTaxProfile', entityId: row.id, payload: { branchId: scope.branchId, employeeId: employee.id, taxMethod: row.taxMethod, effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString() ?? null } } });
      return row;
    });
  }

  async upsertEmployeeSocialSecurityProfile(dto: UpsertEmployeeSocialSecurityProfileDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const effectiveFrom = parseDate(dto.effectiveFrom, 'EmployeeSocialSecurityProfile.effectiveFrom');
    const effectiveTo = dto.effectiveTo ? parseRangeEnd(dto.effectiveTo, 'EmployeeSocialSecurityProfile.effectiveTo') : null;
    this.assertEffectiveRange(effectiveFrom, effectiveTo, 'EmployeeSocialSecurityProfile');
    const programs = [...new Set(dto.programs.map((item) => item.trim()).filter(Boolean))];
    if (!programs.length) throw new BadRequestException('Minimal satu program social-security harus dipilih.');
    return serializableTx(this.prisma, async (tx) => {
      const employee = await this.scopedEmployee(tx, user, scope, dto.employeeId);
      const overlap = await tx.employeeSocialSecurityProfile.findFirst({ where: {
        companyId: scope.companyId, employeeId: employee.id,
        effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        NOT: { effectiveFrom },
      } });
      if (overlap) throw new ConflictException('Rentang EmployeeSocialSecurityProfile bertumpang tindih dengan profile lain.');
      const row = await tx.employeeSocialSecurityProfile.upsert({
        where: { employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom } },
        create: { companyId: scope.companyId, employeeId: employee.id, wageBase: dto.wageBase, programs, effectiveFrom, effectiveTo },
        update: { wageBase: dto.wageBase, programs, effectiveTo },
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPSERT_EMPLOYEE_SOCIAL_SECURITY_PROFILE', entityType: 'EmployeeSocialSecurityProfile', entityId: row.id, payload: { branchId: scope.branchId, employeeId: employee.id, programs, effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString() ?? null } } });
      return row;
    });
  }

  async listAccountingMappings(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.payrollAccountingMapping.findMany({ where: { companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] }, orderBy: [{ componentCode: 'asc' }, { branchId: 'desc' }] });
  }

  async upsertAccountingMapping(dto: UpsertPayrollAccountingMappingDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const supported = new Set(Object.values(PAYROLL_MAPPING_CODES));
    if (!supported.has(dto.componentCode as never)) throw new BadRequestException(`Payroll mapping code ${dto.componentCode} tidak didukung oleh posting engine.`);
    const accountIds = [dto.debitAccountId, dto.creditAccountId, dto.employerDebitAccountId, dto.employerCreditAccountId].filter((value): value is string => Boolean(value));
    if (!accountIds.length) throw new BadRequestException('PayrollAccountingMapping wajib mereferensikan minimal satu account.');
    return serializableTx(this.prisma, async (tx) => {
      const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, branchId: scope.branchId, isActive: true, branch: { companyId: scope.companyId } }, select: { id: true } });
      if (accounts.length !== new Set(accountIds).size) throw new BadRequestException('Satu atau lebih akun payroll mapping tidak aktif atau bukan milik branch aktif.');
      const existing = await tx.payrollAccountingMapping.findFirst({ where: { companyId: scope.companyId, branchId: scope.branchId, componentCode: dto.componentCode } });
      const data = { debitAccountId: dto.debitAccountId, creditAccountId: dto.creditAccountId, employerDebitAccountId: dto.employerDebitAccountId, employerCreditAccountId: dto.employerCreditAccountId, rules: dto.rules as Prisma.InputJsonValue | undefined, isActive: dto.isActive ?? true };
      const row = existing
        ? await tx.payrollAccountingMapping.update({ where: { id: existing.id }, data })
        : await tx.payrollAccountingMapping.create({ data: { companyId: scope.companyId, branchId: scope.branchId, componentCode: dto.componentCode, ...data } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPSERT_PAYROLL_ACCOUNTING_MAPPING', entityType: 'PayrollAccountingMapping', entityId: row.id, payload: { branchId: scope.branchId, componentCode: row.componentCode, isActive: row.isActive } } });
      return row;
    });
  }

}
