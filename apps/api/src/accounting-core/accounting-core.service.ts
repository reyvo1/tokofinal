import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Prisma, TaxTransactionDirection } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { businessMonthStart, parseBusinessDateBoundary } from '../common/business-time';
import { nextDocumentNumber } from '../common/numbering';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, CreateAccountingCloseControlDto, CreatePostingRuleDto, CreateTaxCodeDto, PostManualAccountingEventDto, UpdateAccountDto } from './dto/accounting-core.dto';

export interface OperationalEventLineInput {
  itemType?: string;
  itemId?: string;
  description?: string;
  quantity?: Prisma.Decimal.Value;
  unitAmount?: Prisma.Decimal.Value;
  netAmount?: Prisma.Decimal.Value;
  taxAmount?: Prisma.Decimal.Value;
  grossAmount?: Prisma.Decimal.Value;
  taxCodeId?: string;
  dimensions?: Prisma.InputJsonValue;
}

export interface OperationalTaxLineInput {
  taxCodeId: string;
  direction: TaxTransactionDirection;
  taxableBase: Prisma.Decimal.Value;
  taxAmount: Prisma.Decimal.Value;
  counterpartyType?: string;
  counterpartyId?: string;
  documentNumber?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface OperationalJournalLineInput {
  accountCode: string;
  side: 'DEBIT' | 'CREDIT';
  amount: Prisma.Decimal.Value;
}

export interface PostOperationalEventInput {
  companyId: string;
  branchId: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  businessDate?: Date;
  currency?: string;
  amounts: Record<string, Prisma.Decimal.Value>;
  accountCodes?: Record<string, string>;
  additionalJournalLines?: OperationalJournalLineInput[];
  lines?: OperationalEventLineInput[];
  taxLines?: OperationalTaxLineInput[];
  context?: Prisma.InputJsonValue;
}

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
type RuleLine = { accountCode?: string; accountCodeKey?: string; side: 'DEBIT'|'CREDIT'; amountKey: string; description?: string; skipIfZero?: boolean };

@Injectable()
export class AccountingCoreService {
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
        payload: payload ?? { authenticatedBranchId: scope.branchId },
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
    entityType = 'AccountingScope',
  ): Promise<void> {
    const companyMismatch = requestedCompanyId && requestedCompanyId !== scope.companyId;
    const branchMismatch = requestedBranchId && requestedBranchId !== scope.branchId;
    if (companyMismatch || branchMismatch) {
      await this.denyTenantAccess(client, user, scope, entityType, undefined, {
        authenticatedCompanyId: scope.companyId,
        authenticatedBranchId: scope.branchId,
        ...(requestedCompanyId ? { requestedCompanyId } : {}),
        ...(requestedBranchId ? { requestedBranchId } : {}),
      });
    }
  }


  async listCloseControls(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.accountingCloseControl.findMany({
      where: { companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] },
      orderBy: [{ periodEnd: 'desc' }, { module: 'asc' }],
    });
  }

  async createCloseControl(dto: CreateAccountingCloseControlDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const module = (dto.module || 'ACCOUNTING').trim().toUpperCase();
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (!module) throw new BadRequestException('Module close control wajib diisi.');
    if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodStart > periodEnd) {
      throw new BadRequestException('Rentang AccountingCloseControl tidak valid.');
    }
    return this.prisma.$transaction(async (tx) => {
      const overlap = await tx.accountingCloseControl.findFirst({
        where: {
          companyId: scope.companyId,
          branchId: scope.branchId,
          module,
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart },
        },
      });
      if (overlap) throw new BadRequestException(`Close control ${module} bertumpang tindih dengan periode yang sudah ada.`);
      const row = await tx.accountingCloseControl.create({
        data: { companyId: scope.companyId, branchId: scope.branchId, module, periodStart, periodEnd, status: 'OPEN' },
      });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_ACCOUNTING_CLOSE_CONTROL', entityType: 'AccountingCloseControl', entityId: row.id, payload: { branchId: scope.branchId, module, periodStart: dto.periodStart, periodEnd: dto.periodEnd } } });
      return row;
    });
  }

  async closeControl(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.accountingCloseControl.findFirst({ where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] } });
      if (!row) return this.denyTenantAccess(tx, user, scope, 'AccountingCloseControl', id);
      if (row.status === 'CLOSED') return row;
      const updated = await tx.accountingCloseControl.update({ where: { id }, data: { status: 'CLOSED', closedById: user.sub, closedAt: new Date(), reopenReason: null } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CLOSE_ACCOUNTING_CONTROL', entityType: 'AccountingCloseControl', entityId: id, payload: { branchId: scope.branchId, module: row.module } } });
      return updated;
    });
  }

  async reopenCloseControl(id: string, reason: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const reopenReason = reason?.trim();
    if (!reopenReason) throw new BadRequestException('Alasan reopen wajib diisi.');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.accountingCloseControl.findFirst({ where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] } });
      if (!row) return this.denyTenantAccess(tx, user, scope, 'AccountingCloseControl', id);
      if (row.status !== 'CLOSED') throw new BadRequestException('Hanya AccountingCloseControl CLOSED yang dapat direopen.');
      const updated = await tx.accountingCloseControl.update({ where: { id }, data: { status: 'OPEN', closedById: null, closedAt: null, reopenReason } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'REOPEN_ACCOUNTING_CONTROL', entityType: 'AccountingCloseControl', entityId: id, payload: { branchId: scope.branchId, module: row.module, reason: reopenReason } } });
      return updated;
    });
  }

  async listAccounts(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.account.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      select: { id: true, code: true, name: true, type: true, isActive: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
  }

  async createAccount(dto: CreateAccountDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    if (!code || !name) throw new BadRequestException('Kode dan nama akun wajib diisi.');
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.account.findUnique({ where: { branchId_code: { branchId: scope.branchId, code } } });
      if (duplicate) throw new BadRequestException(`Akun ${code} sudah ada pada branch ini.`);
      const account = await tx.account.create({ data: { branchId: scope.branchId, code, name, type: dto.type as AccountType } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_ACCOUNT', entityType: 'Account', entityId: account.id, payload: { branchId: scope.branchId, code, type: dto.type } } });
      return account;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateAccount(id: string, dto: UpdateAccountDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const account = (await tx.account.findFirst({ where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } } }))
        ?? (await this.denyTenantAccess(tx, user, scope, 'Account', id));
      const journalUsage = dto.type && dto.type !== account.type
        ? await tx.journalLine.count({ where: { accountId: id } }) : 0;
      if (journalUsage > 0) throw new BadRequestException('Tipe akun yang sudah memiliki histori jurnal tidak boleh diubah. Buat akun baru untuk klasifikasi baru.');
      if (dto.isActive === false) {
        const activeRules = await tx.accountingPostingRule.findMany({ where: { companyId: scope.companyId, status: 'ACTIVE' }, select: { id: true, code: true, journalLines: true } });
        const usedByRule = activeRules.find((rule) => Array.isArray(rule.journalLines) && rule.journalLines.some((line) => typeof line === 'object' && line !== null && (line as { accountCode?: string }).accountCode === account.code));
        if (usedByRule) throw new BadRequestException(`Akun ${account.code} masih dipakai posting rule ACTIVE ${usedByRule.code}. Nonaktifkan/versikan rule terlebih dahulu.`);
      }
      const updated = await tx.account.update({ where: { id }, data: { ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.type !== undefined ? { type: dto.type as AccountType } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_ACCOUNT', entityType: 'Account', entityId: id, payload: { branchId: scope.branchId, name: dto.name, type: dto.type, isActive: dto.isActive } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listEvents(user: AuthUser, limitValue?: string, cursorValue?: string, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ createdAt: string; id: string }>(cursorValue);
    const rows = await this.prisma.accountingEvent.findMany({
      where: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        ...(cursor ? { OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ] } : {}),
      },
      include: { lines: true, postings: true, taxTransactions: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  async getEventDetail(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const event = (await this.prisma.accountingEvent.findFirst({
      where: { id, companyId: scope.companyId, branchId: scope.branchId },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, postings: { orderBy: { postedAt: 'asc' } }, taxTransactions: { orderBy: { transactionDate: 'asc' } } },
    })) ?? (await this.denyTenantAccess(this.prisma, user, scope, 'AccountingEvent', id));
    const ruleIds = [...new Set(event.postings.map((row) => row.ruleId).filter((value): value is string => Boolean(value)))];
    const rules = ruleIds.length ? await this.prisma.accountingPostingRule.findMany({ where: { id: { in: ruleIds }, companyId: scope.companyId } }) : [];
    const journalEntry = event.journalEntryId ? await this.prisma.journalEntry.findFirst({
      where: { id: event.journalEntryId, lines: { some: { account: { branchId: scope.branchId, branch: { companyId: scope.companyId } } } } },
      include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } }, orderBy: { id: 'asc' } } },
    }) : null;
    return { event, rules, journalEntry, source: { type: event.sourceType, id: event.sourceId } };
  }

  async listTaxCodes(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'TaxCode');
    return this.prisma.taxCode.findMany({
      where: { companyId: scope.companyId },
      orderBy: [{ scope: 'asc' }, { code: 'asc' }, { version: 'desc' }],
    });
  }

  private async validateTaxCodeDefinition(
    client: DbClient,
    scope: TenantScope,
    dto: CreateTaxCodeDto,
    excludeId?: string,
  ) {
    const code = dto.code.trim().toUpperCase();
    if (!code || !dto.name.trim()) throw new BadRequestException('Kode dan nama pajak wajib diisi.');
    if (dto.effectiveFrom && dto.effectiveTo && new Date(dto.effectiveFrom) > new Date(dto.effectiveTo)) {
      throw new BadRequestException('Tanggal efektif tax code tidak valid.');
    }
    const accountRules: Array<{ code?: string; type: AccountType; label: string }> = [
      { code: dto.payableAccountCode, type: 'LIABILITY', label: 'payableAccountCode' },
      { code: dto.receivableAccountCode, type: 'ASSET', label: 'receivableAccountCode' },
      { code: dto.expenseAccountCode, type: 'EXPENSE', label: 'expenseAccountCode' },
    ];
    for (const rule of accountRules) {
      const accountCode = rule.code?.trim().toUpperCase();
      if (!accountCode) continue;
      const account = await client.account.findFirst({
        where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: accountCode, isActive: true },
        select: { type: true },
      });
      if (!account) throw new BadRequestException(`${rule.label} ${accountCode} belum aktif/tersedia pada branch ini.`);
      if (account.type !== rule.type) throw new BadRequestException(`${rule.label} ${accountCode} harus bertipe ${rule.type}.`);
    }
    if ((dto.status ?? 'DRAFT') === 'ACTIVE') {
      const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
      const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
      const overlap = await client.taxCode.findFirst({
        where: {
          companyId: scope.companyId,
          code,
          status: 'ACTIVE',
          ...(excludeId ? { id: { not: excludeId } } : {}),
          AND: [
            effectiveFrom ? { OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] } : {},
            effectiveTo ? { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveTo } }] } : {},
          ],
        },
        select: { code: true, version: true },
      });
      if (overlap) throw new BadRequestException(`Tax code ACTIVE ${overlap.code} v${overlap.version} memiliki periode efektif yang bertumpang tindih.`);
    }
  }

  async createTaxCode(dto: CreateTaxCodeDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'TaxCode');
    const code = dto.code.trim().toUpperCase();
    const version = dto.version ?? 1;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.taxCode.findUnique({ where: { companyId_code_version: { companyId: scope.companyId, code, version } } });
      if (existing) {
        const usage = await tx.taxTransaction.count({ where: { taxCodeId: existing.id } });
        if (existing.status !== 'DRAFT' || usage > 0) {
          throw new BadRequestException(`Tax code ${code} v${version} sudah menjadi histori. Buat version baru, jangan menimpa konfigurasi lama.`);
        }
      }
      await this.validateTaxCodeDefinition(tx, scope, dto, existing?.id);
      const data = {
        name: dto.name.trim(), scope: dto.scope, rate: new Prisma.Decimal(dto.rate), inclusive: dto.inclusive ?? false,
        recoverable: dto.recoverable ?? false,
        payableAccountCode: dto.payableAccountCode?.trim().toUpperCase() || null,
        receivableAccountCode: dto.receivableAccountCode?.trim().toUpperCase() || null,
        expenseAccountCode: dto.expenseAccountCode?.trim().toUpperCase() || null,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        status: dto.status ?? 'DRAFT', calculationRules: dto.calculationRules as Prisma.InputJsonValue | undefined,
        legalReference: dto.legalReference?.trim() || null,
      };
      const taxCode = existing
        ? await tx.taxCode.update({ where: { id: existing.id }, data })
        : await tx.taxCode.create({ data: { companyId: scope.companyId, code, version, ...data } });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId, userId: user.sub, action: 'UPSERT_TAX_CODE', entityType: 'TaxCode', entityId: taxCode.id,
          payload: { operation: existing ? 'UPDATE_DRAFT_VERSION' : 'CREATE_VERSION', code: taxCode.code, version: taxCode.version, status: taxCode.status },
        },
      });
      return taxCode;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateTaxCodeStatus(id: string, status: 'DRAFT'|'ACTIVE'|'INACTIVE', user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const taxCode = (await tx.taxCode.findFirst({ where: { id, companyId: scope.companyId } }))
        ?? (await this.denyTenantAccess(tx, user, scope, 'TaxCode', id));
      if (status === 'DRAFT' && taxCode.status !== 'DRAFT') {
        throw new BadRequestException('Tax code yang sudah pernah ACTIVE/INACTIVE tidak boleh kembali menjadi DRAFT. Buat version baru.');
      }
      if (status === 'ACTIVE') {
        await this.validateTaxCodeDefinition(tx, scope, {
          code: taxCode.code, version: taxCode.version, name: taxCode.name, scope: taxCode.scope as never,
          rate: Number(taxCode.rate), inclusive: taxCode.inclusive, recoverable: taxCode.recoverable,
          payableAccountCode: taxCode.payableAccountCode ?? undefined, receivableAccountCode: taxCode.receivableAccountCode ?? undefined,
          expenseAccountCode: taxCode.expenseAccountCode ?? undefined, effectiveFrom: taxCode.effectiveFrom?.toISOString(), effectiveTo: taxCode.effectiveTo?.toISOString(),
          status: 'ACTIVE', calculationRules: taxCode.calculationRules as Record<string, unknown> | undefined, legalReference: taxCode.legalReference ?? undefined,
        }, taxCode.id);
      }
      const updated = await tx.taxCode.update({ where: { id }, data: { status } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_TAX_CODE_STATUS', entityType: 'TaxCode', entityId: id, payload: { code: taxCode.code, version: taxCode.version, from: taxCode.status, to: status } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async taxDateRange(companyId: string, fromValue?: string, toValue?: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new BadRequestException('Company tidak ditemukan.');
    const now = new Date();
    const from = parseBusinessDateBoundary(fromValue, businessMonthStart(now, company.timezone), company.timezone, false);
    const to = parseBusinessDateBoundary(toValue, now, company.timezone, true);
    if (from > to) throw new BadRequestException('Rentang tanggal pajak tidak valid.');
    return { from, to };
  }

  async listTaxTransactions(user: AuthUser, fromValue?: string, toValue?: string, directionValue?: string, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.taxDateRange(scope.companyId, fromValue, toValue);
    const allowedDirections = ['INPUT','OUTPUT','WITHHOLDING','SELF_ASSESSED'] as const;
    if (directionValue && !allowedDirections.includes(directionValue as typeof allowedDirections[number])) throw new BadRequestException('Direction pajak tidak valid.');
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ transactionDate: string; id: string }>(cursorValue);
    const rows = await this.prisma.taxTransaction.findMany({
      where: {
        companyId: scope.companyId, branchId: scope.branchId, transactionDate: { gte: from, lte: to },
        ...(directionValue ? { direction: directionValue as TaxTransactionDirection } : {}),
        ...(cursor ? { OR: [{ transactionDate: { lt: new Date(cursor.transactionDate) } }, { transactionDate: new Date(cursor.transactionDate), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    const codeIds = [...new Set(rows.map((row) => row.taxCodeId))];
    const codes = codeIds.length ? await this.prisma.taxCode.findMany({ where: { companyId: scope.companyId, id: { in: codeIds } }, select: { id: true, code: true, version: true, name: true } }) : [];
    const codeMap = new Map(codes.map((row) => [row.id, row]));
    const page = toCursorPage(rows, limit, (item) => ({ transactionDate: item.transactionDate.toISOString(), id: item.id }));
    return { ...page, items: page.items.map((row) => ({ ...row, taxCode: codeMap.get(row.taxCodeId) ?? null })) };
  }

  async listTaxDocuments(user: AuthUser, fromValue?: string, toValue?: string, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.taxDateRange(scope.companyId, fromValue, toValue);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ issueDate: string; id: string }>(cursorValue);
    const rows = await this.prisma.taxDocument.findMany({
      where: {
        companyId: scope.companyId, branchId: scope.branchId, issueDate: { gte: from, lte: to },
        ...(cursor ? { OR: [{ issueDate: { lt: new Date(cursor.issueDate) } }, { issueDate: new Date(cursor.issueDate), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ issueDate: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ issueDate: item.issueDate.toISOString(), id: item.id }));
  }

  async taxReconciliation(user: AuthUser, fromValue?: string, toValue?: string) {
    const scope = this.requireTenantScope(user);
    const { from, to } = await this.taxDateRange(scope.companyId, fromValue, toValue);
    const transactions = await this.prisma.taxTransaction.findMany({
      where: { companyId: scope.companyId, branchId: scope.branchId, transactionDate: { gte: from, lte: to } },
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
    });
    const codeIds = [...new Set(transactions.map((row) => row.taxCodeId))];
    const codes = codeIds.length ? await this.prisma.taxCode.findMany({ where: { companyId: scope.companyId, id: { in: codeIds } } }) : [];
    const codeMap = new Map(codes.map((row) => [row.id, row]));
    const eventIds = [...new Set(transactions.map((row) => row.accountingEventId).filter((value): value is string => Boolean(value)))];
    const events = eventIds.length ? await this.prisma.accountingEvent.findMany({ where: { id: { in: eventIds }, companyId: scope.companyId, branchId: scope.branchId }, select: { id: true, journalEntryId: true, status: true } }) : [];
    const eventMap = new Map(events.map((row) => [row.id, row]));
    const journalEntryIds = [...new Set(events.map((row) => row.journalEntryId).filter((value): value is string => Boolean(value)))];
    const mappedCodes = [...new Set(codes.flatMap((row) => [row.payableAccountCode, row.receivableAccountCode, row.expenseAccountCode].filter((value): value is string => Boolean(value))))];
    const journalLines = journalEntryIds.length && mappedCodes.length ? await this.prisma.journalLine.findMany({
      where: { journalEntryId: { in: journalEntryIds }, account: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: { in: mappedCodes } } },
      include: { account: { select: { code: true, name: true, type: true } } },
    }) : [];
    const byDirection = new Map<string, { taxableBase: Prisma.Decimal; taxAmount: Prisma.Decimal; count: number }>();
    for (const row of transactions) {
      const current = byDirection.get(row.direction) ?? { taxableBase: new Prisma.Decimal(0), taxAmount: new Prisma.Decimal(0), count: 0 };
      current.taxableBase = current.taxableBase.add(row.taxableBase); current.taxAmount = current.taxAmount.add(row.taxAmount); current.count += 1;
      byDirection.set(row.direction, current);
    }
    const accountMovement = new Map<string, { name: string; type: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const line of journalLines) {
      const current = accountMovement.get(line.account.code) ?? { name: line.account.name, type: line.account.type, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      current.debit = current.debit.add(line.debit); current.credit = current.credit.add(line.credit); accountMovement.set(line.account.code, current);
    }
    const missingAccountingEvent = transactions.filter((row) => !row.accountingEventId || !eventMap.has(row.accountingEventId)).length;
    const missingJournal = transactions.filter((row) => row.accountingEventId && !eventMap.get(row.accountingEventId)?.journalEntryId).length;
    const nonPosted = transactions.filter((row) => row.status !== 'POSTED').length;
    const documents = await this.prisma.taxDocument.aggregate({ where: { companyId: scope.companyId, branchId: scope.branchId, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } }, _count: true, _sum: { taxAmount: true, netAmount: true, grossAmount: true } });
    return {
      from, to, companyId: scope.companyId, branchId: scope.branchId,
      directions: [...byDirection.entries()].map(([direction, value]) => ({ direction, count: value.count, taxableBase: Number(value.taxableBase), taxAmount: Number(value.taxAmount) })),
      mappedAccountMovement: [...accountMovement.entries()].map(([code, value]) => ({ code, ...value, debit: Number(value.debit), credit: Number(value.credit), net: Number(value.debit.sub(value.credit)) })),
      integrity: { transactionCount: transactions.length, missingAccountingEvent, missingJournal, nonPosted, ok: missingAccountingEvent === 0 && missingJournal === 0 && nonPosted === 0 },
      documents: { count: documents._count, netAmount: Number(documents._sum.netAmount ?? 0), taxAmount: Number(documents._sum.taxAmount ?? 0), grossAmount: Number(documents._sum.grossAmount ?? 0) },
      codes: codes.map((row) => ({ id: row.id, code: row.code, version: row.version, name: row.name, status: row.status, payableAccountCode: row.payableAccountCode, receivableAccountCode: row.receivableAccountCode, expenseAccountCode: row.expenseAccountCode })),
    };
  }

  async listPostingRules(user: AuthUser, eventType?: string, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'AccountingPostingRule');
    return this.prisma.accountingPostingRule.findMany({
      where: { companyId: scope.companyId, ...(eventType ? { eventType } : {}) },
      orderBy: [{ eventType: 'asc' }, { priority: 'asc' }, { version: 'desc' }],
    });
  }

  private async validatePostingRuleDefinition(
    client: DbClient,
    scope: TenantScope,
    dto: CreatePostingRuleDto,
    excludeRuleId?: string,
  ) {
    if (!dto.journalLines.length) throw new BadRequestException('Aturan jurnal harus memiliki baris.');
    if (!dto.journalLines.some((line) => line.side === 'DEBIT') || !dto.journalLines.some((line) => line.side === 'CREDIT')) {
      throw new BadRequestException('Posting rule wajib memiliki minimal satu baris DEBIT dan satu baris CREDIT.');
    }
    if (dto.effectiveFrom && dto.effectiveTo && new Date(dto.effectiveFrom) > new Date(dto.effectiveTo)) {
      throw new BadRequestException('Tanggal efektif posting rule tidak valid.');
    }
    const literalCodes = new Set<string>();
    for (const line of dto.journalLines) {
      const hasLiteral = Boolean(line.accountCode?.trim());
      const hasKey = Boolean(line.accountCodeKey?.trim());
      if (hasLiteral === hasKey) throw new BadRequestException('Setiap baris posting rule harus memakai tepat satu accountCode atau accountCodeKey.');
      if (!line.amountKey.trim()) throw new BadRequestException('amountKey posting rule wajib diisi.');
      if (hasLiteral) literalCodes.add(line.accountCode!.trim().toUpperCase());
    }
    if (literalCodes.size) {
      const accounts = await client.account.findMany({
        where: { branchId: scope.branchId, branch: { companyId: scope.companyId }, code: { in: [...literalCodes] }, isActive: true },
        select: { code: true },
      });
      const found = new Set(accounts.map((row) => row.code));
      const missing = [...literalCodes].filter((code) => !found.has(code));
      if (missing.length) throw new BadRequestException(`Akun posting rule belum aktif/tersedia pada branch ini: ${missing.join(', ')}.`);
    }
    if ((dto.status ?? 'DRAFT') === 'ACTIVE') {
      const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
      const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
      const overlapping = await client.accountingPostingRule.findFirst({
        where: {
          companyId: scope.companyId,
          eventType: dto.eventType,
          priority: dto.priority ?? 100,
          status: 'ACTIVE',
          ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}),
          AND: [
            effectiveFrom ? { OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] } : {},
            effectiveTo ? { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveTo } }] } : {},
          ],
        },
        select: { code: true, version: true },
      });
      if (overlapping) throw new BadRequestException(`Posting rule ACTIVE ${overlapping.code} v${overlapping.version} bertumpang tindih untuk eventType/priority yang sama.`);
    }
  }

  async createPostingRule(dto: CreatePostingRuleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'AccountingPostingRule');
    const version = dto.version ?? 1;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.accountingPostingRule.findUnique({ where: { companyId_code_version: { companyId: scope.companyId, code: dto.code, version } } });
      if (existing) {
        const postingCount = await tx.accountingPosting.count({ where: { ruleId: existing.id } });
        if (existing.status !== 'DRAFT' || postingCount > 0) {
          throw new BadRequestException(`Posting rule ${dto.code} v${version} sudah menjadi histori. Buat version baru, jangan menimpa rule lama.`);
        }
      }
      await this.validatePostingRuleDefinition(tx, scope, dto, existing?.id);
      const rule = existing
        ? await tx.accountingPostingRule.update({ where: { id: existing.id }, data: {
            name: dto.name, eventType: dto.eventType, priority: dto.priority ?? 100,
            status: (dto.status ?? 'DRAFT') as never,
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            conditions: dto.conditions as Prisma.InputJsonValue | undefined,
            journalLines: dto.journalLines.map((line) => ({ ...line, accountCode: line.accountCode?.trim().toUpperCase() })) as unknown as Prisma.InputJsonValue,
            taxBehavior: dto.taxBehavior as Prisma.InputJsonValue | undefined,
            dimensions: dto.dimensions as Prisma.InputJsonValue | undefined,
          } })
        : await tx.accountingPostingRule.create({ data: {
            companyId: scope.companyId, code: dto.code.trim().toUpperCase(), version, name: dto.name,
            eventType: dto.eventType, priority: dto.priority ?? 100, status: (dto.status ?? 'DRAFT') as never,
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
            conditions: dto.conditions as Prisma.InputJsonValue | undefined,
            journalLines: dto.journalLines.map((line) => ({ ...line, accountCode: line.accountCode?.trim().toUpperCase() })) as unknown as Prisma.InputJsonValue,
            taxBehavior: dto.taxBehavior as Prisma.InputJsonValue | undefined,
            dimensions: dto.dimensions as Prisma.InputJsonValue | undefined,
          } });
      await tx.auditLog.create({
        data: { companyId: scope.companyId, userId: user.sub, action: 'UPSERT_ACCOUNTING_POSTING_RULE', entityType: 'AccountingPostingRule', entityId: rule.id, payload: { operation: existing ? 'UPDATE_DRAFT_VERSION' : 'CREATE_VERSION', code: rule.code, version: rule.version, status: rule.status, eventType: rule.eventType, priority: rule.priority } },
      });
      return rule;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updatePostingRuleStatus(id: string, status: 'DRAFT'|'ACTIVE'|'INACTIVE', user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const rule = (await tx.accountingPostingRule.findFirst({ where: { id, companyId: scope.companyId } }))
        ?? (await this.denyTenantAccess(tx, user, scope, 'AccountingPostingRule', id));
      if (status === 'DRAFT' && rule.status !== 'DRAFT') throw new BadRequestException('Rule yang sudah pernah ACTIVE/INACTIVE tidak boleh kembali menjadi DRAFT. Buat version baru.');
      if (status === 'ACTIVE') {
        const lines = Array.isArray(rule.journalLines) ? rule.journalLines as Array<Record<string, unknown>> : [];
        await this.validatePostingRuleDefinition(tx, scope, {
          code: rule.code, name: rule.name, eventType: rule.eventType, version: rule.version, priority: rule.priority, status: 'ACTIVE',
          effectiveFrom: rule.effectiveFrom?.toISOString(), effectiveTo: rule.effectiveTo?.toISOString(),
          journalLines: lines.map((line) => ({ accountCode: typeof line.accountCode === 'string' ? line.accountCode : undefined, accountCodeKey: typeof line.accountCodeKey === 'string' ? line.accountCodeKey : undefined, side: line.side as 'DEBIT'|'CREDIT', amountKey: String(line.amountKey ?? ''), description: typeof line.description === 'string' ? line.description : undefined, skipIfZero: typeof line.skipIfZero === 'boolean' ? line.skipIfZero : undefined })),
        }, rule.id);
      }
      const updated = await tx.accountingPostingRule.update({ where: { id }, data: { status: status as never } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'UPDATE_ACCOUNTING_POSTING_RULE_STATUS', entityType: 'AccountingPostingRule', entityId: id, payload: { code: rule.code, version: rule.version, from: rule.status, to: status } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async previewTax(taxCodeId: string, amount: Prisma.Decimal.Value, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.calculateTax(this.prisma, taxCodeId, amount, scope.companyId);
  }

  async calculateTax(
    client: DbClient,
    taxCodeId: string | undefined,
    amount: Prisma.Decimal.Value,
    companyId?: string,
    effectiveAt: Date = new Date(),
    expectedScopes?: string[],
  ) {
    const grossOrBase = new Prisma.Decimal(amount);
    if (!taxCodeId) return { taxCode: null, net: grossOrBase, tax: new Prisma.Decimal(0), gross: grossOrBase };
    const taxCode = companyId
      ? await client.taxCode.findFirst({ where: { id: taxCodeId, companyId } })
      : await client.taxCode.findUnique({ where: { id: taxCodeId } });
    if (!taxCode) throw new NotFoundException(companyId ? 'Tax code tidak ditemukan.' : `Tax code ${taxCodeId} tidak ditemukan.`);
    if (taxCode.status !== 'ACTIVE') throw new BadRequestException(`Tax code ${taxCode.code} belum ACTIVE.`);
    if (taxCode.effectiveFrom && taxCode.effectiveFrom > effectiveAt) throw new BadRequestException(`Tax code ${taxCode.code} belum berlaku pada tanggal transaksi.`);
    if (taxCode.effectiveTo && taxCode.effectiveTo < effectiveAt) throw new BadRequestException(`Tax code ${taxCode.code} sudah tidak berlaku pada tanggal transaksi.`);
    if (expectedScopes?.length && !expectedScopes.includes(taxCode.scope)) {
      throw new BadRequestException(`Tax code ${taxCode.code} scope ${taxCode.scope} tidak sesuai transaksi ini.`);
    }
    const rate = new Prisma.Decimal(taxCode.rate);
    if (rate.lessThan(0)) throw new BadRequestException('Tarif pajak tidak valid.');
    if (taxCode.inclusive && rate.greaterThan(0)) {
      const divisor = new Prisma.Decimal(1).add(rate);
      const net = grossOrBase.div(divisor).toDecimalPlaces(2);
      const tax = grossOrBase.sub(net);
      return { taxCode, net, tax, gross: grossOrBase };
    }
    const tax = grossOrBase.mul(rate).toDecimalPlaces(2);
    return { taxCode, net: grossOrBase, tax, gross: grossOrBase.add(tax) };
  }

  async postOperationalEvent(client: DbClient, input: PostOperationalEventInput) {
    const existing = await client.accountingEvent.findUnique({
      where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
      include: { postings: true, taxTransactions: true },
    });
    if (existing) {
      const sameIdentity = existing.branchId === input.branchId
        && existing.eventType === input.eventType
        && existing.sourceType === input.sourceType
        && existing.sourceId === input.sourceId;
      if (!sameIdentity) throw new BadRequestException('Idempotency key sudah digunakan untuk event atau branch yang berbeda.');
      return existing;
    }

    const businessDate = input.businessDate ?? new Date();
    if (input.taxLines?.length) {
      const taxCodeIds = [...new Set(input.taxLines.map((line) => line.taxCodeId))];
      const taxCodes = await client.taxCode.findMany({
        where: { id: { in: taxCodeIds }, companyId: input.companyId },
      });
      const taxCodeMap = new Map(taxCodes.map((taxCode) => [taxCode.id, taxCode]));
      for (const line of input.taxLines) {
        const taxCode = taxCodeMap.get(line.taxCodeId);
        if (!taxCode) throw new BadRequestException('Tax code event tidak tersedia untuk company transaksi.');
        if (taxCode.status !== 'ACTIVE') throw new BadRequestException(`Tax code ${taxCode.code} belum ACTIVE.`);
        if (taxCode.effectiveFrom && taxCode.effectiveFrom > businessDate) throw new BadRequestException(`Tax code ${taxCode.code} belum berlaku pada tanggal transaksi.`);
        if (taxCode.effectiveTo && taxCode.effectiveTo < businessDate) throw new BadRequestException(`Tax code ${taxCode.code} sudah tidak berlaku pada tanggal transaksi.`);
        const allowedScopesByDirection: Record<string, string[]> = {
          OUTPUT: ['SALE', 'SHIPPING', 'OTHER'],
          INPUT: ['PURCHASE', 'EXPENSE', 'ASSET', 'SHIPPING', 'OTHER'],
          WITHHOLDING: ['WITHHOLDING', 'PAYROLL', 'OTHER'],
          SELF_ASSESSED: ['PURCHASE', 'EXPENSE', 'ASSET', 'OTHER'],
        };
        const allowedScopes = allowedScopesByDirection[line.direction] ?? [];
        if (!allowedScopes.includes(taxCode.scope)) {
          throw new BadRequestException(`Tax code ${taxCode.code} scope ${taxCode.scope} tidak sesuai arah pajak ${line.direction}.`);
        }
      }
    }

    const rule = await client.accountingPostingRule.findFirst({
      where: {
        companyId: input.companyId, eventType: input.eventType, status: 'ACTIVE',
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: businessDate } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDate } }] },
        ],
      },
      orderBy: [{ priority: 'asc' }, { version: 'desc' }],
    });
    if (!rule) throw new BadRequestException(`Accounting posting rule ACTIVE untuk ${input.eventType} belum dikonfigurasi.`);

    const closeControl = await client.accountingCloseControl.findFirst({
      where: {
        companyId: input.companyId,
        status: 'CLOSED',
        periodStart: { lte: businessDate },
        periodEnd: { gte: businessDate },
        module: { in: ['ACCOUNTING', input.eventType] },
        OR: [{ branchId: input.branchId }, { branchId: null }],
      },
      orderBy: [{ branchId: 'desc' }, { periodEnd: 'desc' }],
    });
    if (closeControl) {
      throw new BadRequestException(`Accounting close control ${closeControl.module} menutup posting pada periode ${closeControl.periodStart.toISOString().slice(0, 10)} sampai ${closeControl.periodEnd.toISOString().slice(0, 10)}.`);
    }

    // Period close enforcement: SOFT_CLOSED maupun CLOSED sama-sama membekukan posting normal.
    // Koreksi harus dilakukan setelah period direopen secara eksplisit (SOFT_CLOSED) atau pada periode baru.
    const fiscalPeriod = await client.fiscalPeriod.findFirst({
      where: {
        companyId: input.companyId,
        branchId: input.branchId,
        startDate: { lte: businessDate },
        endDate: { gte: businessDate },
      },
      orderBy: { startDate: 'desc' },
    });
    if (fiscalPeriod && fiscalPeriod.status !== 'OPEN') {
      throw new BadRequestException(`Periode fiskal berstatus ${fiscalPeriod.status}; posting jurnal ke periode ini tidak diizinkan.`);
    }

    const amounts = Object.fromEntries(Object.entries(input.amounts).map(([key, value]) => [key, new Prisma.Decimal(value)]));
    const netAmount = amounts.net ?? amounts.revenue ?? amounts.inventory ?? amounts.expense ?? amounts.asset ?? amounts.gain ?? amounts.loss ?? new Prisma.Decimal(0);
    const taxAmount = amounts.tax ?? amounts.outputTax ?? amounts.inputTax ?? new Prisma.Decimal(0);
    const grossAmount = amounts.gross ?? amounts.cash ?? amounts.bank ?? amounts.payable ?? amounts.receivable ?? netAmount.add(taxAmount);

    const event = await client.accountingEvent.create({
      data: {
        companyId: input.companyId, branchId: input.branchId, eventType: input.eventType,
        sourceType: input.sourceType, sourceId: input.sourceId, idempotencyKey: input.idempotencyKey,
        businessDate, currency: input.currency ?? 'IDR',
        netAmount, taxAmount, grossAmount, status: 'VALIDATED', context: input.context,
        lines: input.lines?.length ? { create: input.lines.map((line, index) => ({
          lineNumber: index + 1, itemType: line.itemType, itemId: line.itemId, description: line.description,
          quantity: new Prisma.Decimal(line.quantity ?? 0), unitAmount: new Prisma.Decimal(line.unitAmount ?? 0),
          netAmount: new Prisma.Decimal(line.netAmount ?? 0), taxAmount: new Prisma.Decimal(line.taxAmount ?? 0),
          grossAmount: new Prisma.Decimal(line.grossAmount ?? 0), taxCodeId: line.taxCodeId, dimensions: line.dimensions,
        })) } : undefined,
      },
    });

    const configuredLines = rule.journalLines as unknown as RuleLine[];
    const usable = configuredLines.filter((line) => {
      const amount = amounts[line.amountKey] ?? new Prisma.Decimal(0);
      return !(line.skipIfZero ?? true) || !amount.isZero();
    });
    const resolvedRuleLines = usable.map((line) => {
      const accountCode = line.accountCodeKey ? input.accountCodes?.[line.accountCodeKey] : line.accountCode;
      if (!accountCode) throw new BadRequestException(`Account code untuk baris ${line.amountKey} belum dikonfigurasi.`);
      const amount = amounts[line.amountKey] ?? new Prisma.Decimal(0);
      if (amount.lessThan(0)) throw new BadRequestException(`Nilai ${line.amountKey} tidak boleh negatif.`);
      return { accountCode, side: line.side, amount };
    });
    const resolvedAdditionalLines = (input.additionalJournalLines ?? []).map((line) => {
      const accountCode = line.accountCode.trim().toUpperCase();
      if (!accountCode) throw new BadRequestException('Account code additional journal line wajib diisi.');
      const amount = new Prisma.Decimal(line.amount).toDecimalPlaces(2);
      if (amount.lessThan(0)) throw new BadRequestException('Nilai additional journal line tidak boleh negatif.');
      return { accountCode, side: line.side, amount };
    }).filter((line) => !line.amount.isZero());
    const resolvedLines = [...resolvedRuleLines, ...resolvedAdditionalLines];
    if (!resolvedLines.length) throw new BadRequestException(`Aturan ${rule.code} tidak menghasilkan jurnal.`);
    const codes = [...new Set(resolvedLines.map((line) => line.accountCode))];
    const accounts = await client.account.findMany({ where: { branchId: input.branchId, code: { in: codes }, isActive: true } });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const missing = codes.filter((code) => !accountMap.has(code));
    if (missing.length) throw new BadRequestException(`Akun belum dikonfigurasi: ${missing.join(', ')}.`);

    let debitTotal = new Prisma.Decimal(0);
    let creditTotal = new Prisma.Decimal(0);
    const journalLines = resolvedLines.map((line) => {
      const amount = line.amount;
      if (line.side === 'DEBIT') debitTotal = debitTotal.add(amount); else creditTotal = creditTotal.add(amount);
      return {
        accountId: accountMap.get(line.accountCode)!.id,
        debit: line.side === 'DEBIT' ? amount : new Prisma.Decimal(0),
        credit: line.side === 'CREDIT' ? amount : new Prisma.Decimal(0),
      };
    });
    if (!debitTotal.equals(creditTotal)) {
      throw new BadRequestException(`Jurnal ${rule.code} tidak seimbang. Debit ${debitTotal.toFixed(2)}, kredit ${creditTotal.toFixed(2)}.`);
    }

    const journalEntry = await client.journalEntry.create({
      data: {
        number: await nextDocumentNumber(client, { companyId: input.companyId, branchId: input.branchId, documentType: 'JOURNAL', prefix: 'JRN' }), date: businessDate,
        referenceType: input.sourceType, referenceId: input.sourceId,
        description: `${input.eventType} ${input.sourceType} ${input.sourceId}`,
        lines: { create: journalLines },
      },
    });

    if (input.taxLines?.length) {
      await client.taxTransaction.createMany({ data: input.taxLines.map((tax) => ({
        companyId: input.companyId, branchId: input.branchId, accountingEventId: event.id,
        sourceType: input.sourceType, sourceId: input.sourceId, taxCodeId: tax.taxCodeId,
        direction: tax.direction, transactionDate: businessDate,
        taxPeriod: businessDate.toISOString().slice(0, 7),
        taxableBase: new Prisma.Decimal(tax.taxableBase), taxAmount: new Prisma.Decimal(tax.taxAmount),
        status: 'POSTED', counterpartyType: tax.counterpartyType, counterpartyId: tax.counterpartyId,
        documentNumber: tax.documentNumber, metadata: tax.metadata,
      })) });
    }
    await client.accountingPosting.create({
      data: { accountingEventId: event.id, ruleId: rule.id, journalEntryId: journalEntry.id, postingTrace: { ruleCode: rule.code, debitTotal: debitTotal.toFixed(2), creditTotal: creditTotal.toFixed(2) } },
    });
    return client.accountingEvent.update({
      where: { id: event.id }, data: { status: 'POSTED', journalEntryId: journalEntry.id },
      include: { postings: true, taxTransactions: true, lines: true },
    });
  }

  async postManual(dto: PostManualAccountingEventDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'AccountingEvent');
    return this.prisma.$transaction(async (tx) => {
      const taxCodeIds = [...new Set([
        ...(dto.lines?.map((line) => line.taxCodeId).filter((value): value is string => Boolean(value)) ?? []),
        ...(dto.taxLines?.map((line) => line.taxCodeId) ?? []),
      ])];
      if (taxCodeIds.length) {
        const ownedTaxCodes = await tx.taxCode.findMany({
          where: { id: { in: taxCodeIds }, companyId: scope.companyId },
          select: { id: true },
        });
        const ownedIds = new Set(ownedTaxCodes.map((taxCode) => taxCode.id));
        const foreignTaxCodeId = taxCodeIds.find((id) => !ownedIds.has(id));
        if (foreignTaxCodeId) {
          await this.denyTenantAccess(tx, user, scope, 'TaxCode', foreignTaxCodeId, {
            authenticatedCompanyId: scope.companyId,
            authenticatedBranchId: scope.branchId,
          });
        }
      }

      const existing = await tx.accountingEvent.findUnique({
        where: { companyId_idempotencyKey: { companyId: scope.companyId, idempotencyKey: dto.idempotencyKey } },
        include: { postings: true, taxTransactions: true, lines: true },
      });
      if (existing) {
        if (existing.branchId !== scope.branchId) {
          await this.denyTenantAccess(tx, user, scope, 'AccountingEvent', existing.id, {
            authenticatedBranchId: scope.branchId,
            eventBranchId: existing.branchId,
            idempotencyKey: dto.idempotencyKey,
          });
        }
        return existing;
      }

      const event = await this.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType: dto.eventType,
        sourceType: dto.sourceType, sourceId: dto.sourceId, idempotencyKey: dto.idempotencyKey,
        currency: dto.currency, businessDate: dto.businessDate ? new Date(dto.businessDate) : undefined,
        amounts: dto.amounts, accountCodes: dto.accountCodes,
        lines: dto.lines?.map((line) => ({ ...line, dimensions: line.dimensions as Prisma.InputJsonValue | undefined })),
        taxLines: dto.taxLines?.map((line) => ({ ...line, direction: line.direction as TaxTransactionDirection })),
        context: dto.context as Prisma.InputJsonValue | undefined,
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'POST_MANUAL_ACCOUNTING_EVENT',
          entityType: 'AccountingEvent',
          entityId: event.id,
          payload: { eventType: dto.eventType, sourceType: dto.sourceType, sourceId: dto.sourceId },
        },
      });
      return event;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
