import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApprovalStatus, AutomationJobStatus, IntegrationStatus, IntegrationType, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateApprovalPolicyDto, CreateApprovalRequestDto, CreateBusinessRuleDto, CreateCustomFieldDto,
  CreateIntegrationDto, CreateUiSchemaDto, CreateWebhookDto, DecideApprovalDto, DelegateApprovalDto, UpdateBusinessRuleDto, UpdateIntegrationDto,
  SetCustomFieldValueDto, UpdateTenantProfileDto, UpsertFeatureFlagDto, UpsertSettingDto,
} from './dto/platform.dto';
import { PluginRegistryService } from './plugin-registry.service';
import { SecretProtectorService } from './secret-protector.service';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService, private readonly plugins: PluginRegistryService, private readonly secrets: SecretProtectorService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user?.companyId || !user.branchId) {
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
    entityType = 'PlatformConfiguration',
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

  private async auditMutation(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    action: string,
    entityType: string,
    entityId: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action,
        entityType,
        entityId,
        payload: payload ?? { branchId: scope.branchId },
      },
    });
  }

  private branchContext(value: unknown, branchId: string): Prisma.InputJsonValue {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>), branchId } as Prisma.InputJsonValue;
    }
    return { branchId, ...(value === undefined ? {} : { value }) } as Prisma.InputJsonValue;
  }

  private configRank(row: { companyId?: string | null; branchId?: string | null; userId?: string | null }): number {
    if (row.userId) return 3;
    if (row.branchId) return 2;
    if (row.companyId) return 1;
    return 0;
  }

  private approvalSteps(policy: { steps: Prisma.JsonValue } | null): Record<string, unknown>[] {
    if (!policy || !Array.isArray(policy.steps)) return [{}];
    return policy.steps.map((step) => step && typeof step === 'object' && !Array.isArray(step) ? step as Record<string, unknown> : {});
  }

  private approvalExpiry(step: Record<string, unknown>, from = new Date()): Date | null {
    const minutes = Number(step.expiresInMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return new Date(from.getTime() + Math.min(Math.floor(minutes), 30 * 24 * 60) * 60_000);
  }

  private rolloutEnabled(flag: { key: string; enabled: boolean; config: Prisma.JsonValue }, companyId: string, branchId: string, userId?: string): boolean {
    if (!flag.enabled) return false;
    if (!flag.config || typeof flag.config !== 'object' || Array.isArray(flag.config)) return true;
    const config = flag.config as Record<string, unknown>;
    const percentage = config.rolloutPercentage === undefined ? 100 : Number(config.rolloutPercentage);
    if (!Number.isFinite(percentage) || percentage >= 100) return true;
    if (percentage <= 0) return false;
    const subject = userId ?? branchId;
    const digest = createHash('sha256').update(`${companyId}:${branchId}:${flag.key}:${subject}`).digest();
    const bucket = digest.readUInt32BE(0) % 10_000;
    return bucket < Math.floor(percentage * 100);
  }

  private validateFeatureConfig(config: unknown): void {
    if (config === undefined || config === null) return;
    if (typeof config !== 'object' || Array.isArray(config)) throw new BadRequestException('Config feature flag harus berupa object.');
    const record = config as Record<string, unknown>;
    if (record.rolloutPercentage !== undefined) {
      const percentage = Number(record.rolloutPercentage);
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new BadRequestException('rolloutPercentage harus 0 sampai 100.');
    }
  }

  private async resolveManifestTenant(
    user: AuthUser | undefined,
    branchCode?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    if (user) {
      const scope = this.requireTenantScope(user);
      await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, requestedBranchId, 'RuntimeManifest');
      const branch = await this.prisma.branch.findFirst({
        where: { id: scope.branchId, companyId: scope.companyId, isActive: true },
        include: { company: true },
      });
      if (!branch) return this.denyTenantAccess(this.prisma, user, scope, 'Branch', scope.branchId);
      return { company: branch.company, branch, companyId: scope.companyId, branchId: scope.branchId, userId: user.sub };
    }

    if (requestedCompanyId || requestedBranchId) {
      throw new ForbiddenException({
        code: 'TENANT_ACCESS_DENIED',
        message: 'Runtime manifest publik tidak menerima companyId atau branchId bebas.',
      });
    }
    const normalizedCode = branchCode?.trim().toUpperCase();
    if (!normalizedCode) {
      throw new BadRequestException({
        code: 'STOREFRONT_BRANCH_REQUIRED',
        message: 'branchCode wajib untuk runtime manifest publik.',
      });
    }
    const branch = await this.prisma.branch.findUnique({
      where: { code: normalizedCode },
      include: { company: true },
    });
    if (!branch?.isActive) throw new NotFoundException('Cabang storefront tidak ditemukan.');
    return { company: branch.company, branch, companyId: branch.companyId, branchId: branch.id, userId: undefined };
  }


  async storefrontBranches(branchCode?: string) {
    const tenant = await this.resolveManifestTenant(undefined, branchCode);
    return this.prisma.branch.findMany({
      where: { companyId: tenant.companyId, isActive: true },
      select: { id: true, code: true, name: true, address: true },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  async manifest(user?: AuthUser, branchCode?: string, requestedCompanyId?: string, requestedBranchId?: string) {
    const tenant = await this.resolveManifestTenant(user, branchCode, requestedCompanyId, requestedBranchId);
    const [flags, settings, modules, uiSchemas] = await Promise.all([
      this.prisma.featureFlag.findMany({
        where: {
          OR: [
            { companyId: null, branchId: null, userId: null },
            { companyId: tenant.companyId, branchId: null, userId: null },
            { companyId: tenant.companyId, branchId: tenant.branchId, userId: null },
            ...(tenant.userId ? [{ companyId: tenant.companyId, branchId: tenant.branchId, userId: tenant.userId }] : []),
          ],
        },
        orderBy: [{ key: 'asc' }, { updatedAt: 'asc' }],
      }),
      this.prisma.systemSetting.findMany({
        where: {
          isSecret: false,
          OR: [
            { companyId: null, branchId: null, userId: null },
            { companyId: tenant.companyId, branchId: null, userId: null },
            { companyId: tenant.companyId, branchId: tenant.branchId, userId: null },
            ...(tenant.userId ? [{ companyId: tenant.companyId, branchId: tenant.branchId, userId: tenant.userId }] : []),
          ],
        },
        orderBy: [{ namespace: 'asc' }, { key: 'asc' }, { updatedAt: 'asc' }],
      }),
      this.prisma.moduleDefinition.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
      this.prisma.uiSchemaDefinition.findMany({
        where: {
          isActive: true,
          OR: [
            { companyId: null, branchId: null },
            { companyId: tenant.companyId, branchId: null },
            { companyId: tenant.companyId, branchId: tenant.branchId },
          ],
        },
        orderBy: [{ code: 'asc' }, { version: 'desc' }],
      }),
    ]);
    flags.sort((left, right) => this.configRank(left) - this.configRank(right));
    settings.sort((left, right) => this.configRank(left) - this.configRank(right));
    const featureMap: Record<string, { enabled: boolean; configuredEnabled: boolean; config: Record<string, unknown> }> = {};
    for (const flag of flags) {
      const prior = featureMap[flag.key];
      const priorConfig = prior?.config ?? {};
      const nextConfig = flag.config && typeof flag.config === 'object' && !Array.isArray(flag.config)
        ? flag.config as Record<string, unknown>
        : {};
      featureMap[flag.key] = {
        enabled: this.rolloutEnabled(flag, tenant.companyId, tenant.branchId, tenant.userId),
        configuredEnabled: flag.enabled,
        config: { ...priorConfig, ...nextConfig },
      };
    }
    const settingMap = Object.fromEntries(settings.map((setting) => [`${setting.namespace}.${setting.key}`, setting.value]));
    return {
      version: process.env.APP_VERSION ?? '0.5.3', company: tenant.company, branch: tenant.branch,
      features: featureMap, settings: settingMap, modules,
      navigation: modules.flatMap((module) => Array.isArray(module.navigation) ? module.navigation : module.navigation ? [module.navigation] : []),
      uiSchemas, plugins: this.plugins.list(),
    };
  }

  async setupReadiness(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const [company, branch, defaultWarehouse, activeUsers, activeProducts, accounts, paymentMethods, inventorySetting, connectedIntegrations] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: scope.companyId }, select: { id: true, name: true, timezone: true, currency: true } }),
      this.prisma.branch.findFirst({ where: { id: scope.branchId, companyId: scope.companyId, isActive: true }, select: { id: true, code: true, name: true, address: true } }),
      this.prisma.warehouse.findFirst({ where: { branchId: scope.branchId, isActive: true, isDefault: true }, select: { id: true, code: true, name: true } }),
      this.prisma.user.count({ where: { branchId: scope.branchId, isActive: true } }),
      this.prisma.product.count({ where: { companyId: scope.companyId, isActive: true } }),
      this.prisma.account.count({ where: { branchId: scope.branchId, isActive: true } }),
      this.prisma.masterReference.count({ where: { companyId: scope.companyId, type: 'PAYMENT_METHOD', isActive: true } }),
      this.prisma.systemSetting.findFirst({ where: { companyId: scope.companyId, branchId: null, namespace: 'inventory', key: 'costing_method' } }),
      this.prisma.integrationConnection.count({ where: { companyId: scope.companyId, status: 'CONNECTED', OR: [{ branchId: scope.branchId }, { branchId: null }] } }),
    ]);
    const steps = [
      { key: 'company', label: 'Profil perusahaan', complete: Boolean(company?.name && company.timezone && company.currency), detail: company ? `${company.name} · ${company.currency} · ${company.timezone}` : 'Company belum tersedia.', route: '/settings/platform' },
      { key: 'branch', label: 'Cabang aktif', complete: Boolean(branch), detail: branch ? `${branch.code} · ${branch.name}${branch.address ? ` · ${branch.address}` : ''}` : 'Branch aktif belum tersedia.', route: '/organization/organization' },
      { key: 'warehouse', label: 'Gudang default', complete: Boolean(defaultWarehouse), detail: defaultWarehouse ? `${defaultWarehouse.code} · ${defaultWarehouse.name}` : 'Gudang default aktif belum ditentukan.', route: '/organization/organization' },
      { key: 'users', label: 'User operasional', complete: activeUsers > 0, detail: `${activeUsers} user aktif pada branch.`, route: '/settings/users' },
      { key: 'products', label: 'Master produk', complete: activeProducts > 0, detail: `${activeProducts} produk aktif.`, route: '/master-data/products' },
      { key: 'accounting', label: 'Chart of accounts', complete: accounts > 0, detail: `${accounts} account aktif.`, route: '/finance/ledger' },
      { key: 'payments', label: 'Metode pembayaran', complete: paymentMethods > 0, detail: `${paymentMethods} payment method aktif.`, route: '/master-data/references' },
      { key: 'inventory', label: 'Metode costing inventory', complete: Boolean(inventorySetting), detail: inventorySetting ? `Costing: ${String(inventorySetting.value)}` : 'Setting inventory.costing_method belum tersedia.', route: '/settings/platform' },
      { key: 'integrations', label: 'Integrasi eksternal', complete: connectedIntegrations > 0, required: false, detail: `${connectedIntegrations} integration connection CONNECTED. Langkah ini opsional untuk operasi inti.`, route: '/integrations/connections' },
    ];
    const required = steps.filter((step) => step.required !== false);
    const completed = required.filter((step) => step.complete).length;
    return { readyForOperations: completed === required.length, score: Math.round((completed / required.length) * 100), completed, required: required.length, optionalConnectedIntegrations: connectedIntegrations, steps };
  }

  async tenantProfile(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const [company, branches] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: scope.companyId },
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.branch.findMany({
        where: { companyId: scope.companyId },
        select: { id: true, code: true, name: true, address: true, isActive: true, createdAt: true, updatedAt: true },
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
      }),
    ]);
    if (!company) return this.denyTenantAccess(this.prisma, user, scope, 'Company', scope.companyId);
    return {
      company,
      branches,
      activeBranchId: scope.branchId,
      provisioningMode: 'BOOTSTRAP_ONLY',
      provisioningNote: 'Pembuatan company baru dilakukan melalui bootstrap/deployment terkontrol. Operator hanya mengelola company aktif.',
    };
  }

  async updateTenantProfile(dto: UpdateTenantProfileDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (dto.name === undefined && dto.timezone === undefined && dto.currency === undefined) {
      throw new BadRequestException('Minimal satu field tenant harus diubah.');
    }
    const name = dto.name?.trim();
    const timezone = dto.timezone?.trim();
    const currency = dto.currency?.trim().toUpperCase();
    if (timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
      } catch {
        throw new BadRequestException('Timezone IANA tidak valid.');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.company.findUnique({ where: { id: scope.companyId }, select: { id: true } });
      if (!existing) return this.denyTenantAccess(tx, user, scope, 'Company', scope.companyId);
      const row = await tx.company.update({
        where: { id: scope.companyId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(currency !== undefined ? { currency } : {}),
        },
        select: { id: true, name: true, slug: true, timezone: true, currency: true, createdAt: true, updatedAt: true },
      });
      await this.auditMutation(tx, user, scope, 'UPDATE_TENANT_PROFILE', 'Company', row.id, {
        branchId: scope.branchId,
        changedFields: [
          ...(dto.name !== undefined ? ['name'] : []),
          ...(dto.timezone !== undefined ? ['timezone'] : []),
          ...(dto.currency !== undefined ? ['currency'] : []),
        ],
      });
      return row;
    });
  }

  async listFeatures(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'FeatureFlag');
    return this.prisma.featureFlag.findMany({
      where: { OR: [
        { companyId: null, branchId: null, userId: null },
        { companyId: scope.companyId, branchId: null, userId: null },
        { companyId: scope.companyId, branchId: scope.branchId, userId: null },
        { companyId: scope.companyId, branchId: scope.branchId, userId: user.sub },
      ] },
      orderBy: [{ key: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async setFeature(dto: UpsertFeatureFlagDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'FeatureFlag');
    const targetBranchId = dto.branchId ? scope.branchId : null;
    this.validateFeatureConfig(dto.config);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlag.findFirst({ where: { companyId: scope.companyId, branchId: targetBranchId, userId: null, key: dto.key } });
      const data = { companyId: scope.companyId, branchId: targetBranchId, userId: null, key: dto.key, enabled: dto.enabled, config: dto.config === undefined ? undefined : json(dto.config) };
      const row = existing ? await tx.featureFlag.update({ where: { id: existing.id }, data }) : await tx.featureFlag.create({ data });
      await this.auditMutation(tx, user, scope, 'UPSERT_FEATURE_FLAG', 'FeatureFlag', row.id, { branchId: targetBranchId, key: dto.key, enabled: dto.enabled });
      return row;
    });
  }

  async listSettings(user: AuthUser, requestedCompanyId?: string, namespace?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'SystemSetting');
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        ...(namespace ? { namespace } : {}),
        OR: [
          { companyId: null, branchId: null, userId: null },
          { companyId: scope.companyId, branchId: null, userId: null },
          { companyId: scope.companyId, branchId: scope.branchId, userId: null },
          { companyId: scope.companyId, branchId: scope.branchId, userId: user.sub },
        ],
      },
      orderBy: [{ namespace: 'asc' }, { key: 'asc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => row.isSecret ? { ...row, value: '***REDACTED***' } : row);
  }

  async setSetting(dto: UpsertSettingDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'SystemSetting');
    const targetBranchId = dto.branchId ? scope.branchId : null;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.systemSetting.findFirst({ where: { companyId: scope.companyId, branchId: targetBranchId, userId: null, namespace: dto.namespace, key: dto.key } });
      const isSecret = dto.isSecret ?? existing?.isSecret ?? false;
      const storedValue = isSecret ? this.secrets.encryptJson(dto.value) : dto.value;
      const data = { companyId: scope.companyId, branchId: targetBranchId, userId: null, namespace: dto.namespace, key: dto.key, value: json(storedValue), isSecret };
      const row = existing ? await tx.systemSetting.update({ where: { id: existing.id }, data }) : await tx.systemSetting.create({ data });
      await this.auditMutation(tx, user, scope, 'UPSERT_SYSTEM_SETTING', 'SystemSetting', row.id, { branchId: targetBranchId, namespace: dto.namespace, key: dto.key, isSecret: row.isSecret });
      return row.isSecret ? { ...row, value: '***REDACTED***' } : row;
    });
  }

  async listCustomFields(user: AuthUser, requestedCompanyId?: string, entityType?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'CustomFieldDefinition');
    return this.prisma.customFieldDefinition.findMany({ where: { companyId: scope.companyId, ...(entityType ? { entityType } : {}) }, orderBy: { sortOrder: 'asc' } });
  }

  async createCustomField(dto: CreateCustomFieldDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'CustomFieldDefinition');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.customFieldDefinition.create({ data: {
        companyId: scope.companyId, entityType: dto.entityType, key: dto.key, label: dto.label, dataType: dto.dataType,
        required: dto.required, searchable: dto.searchable,
        defaultValue: dto.defaultValue === undefined ? undefined : json(dto.defaultValue),
        options: dto.options === undefined ? undefined : json(dto.options),
        validation: dto.validation === undefined ? undefined : json(dto.validation), sortOrder: dto.sortOrder,
      } });
      await this.auditMutation(tx, user, scope, 'CREATE_CUSTOM_FIELD', 'CustomFieldDefinition', row.id, { branchId: scope.branchId, entityType: dto.entityType, key: dto.key });
      return row;
    });
  }

  async setCustomFieldValue(dto: SetCustomFieldValueDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const definition = await this.prisma.customFieldDefinition.findFirst({ where: { id: dto.definitionId, companyId: scope.companyId, isActive: true } });
    if (!definition) return this.denyTenantAccess(this.prisma, user, scope, 'CustomFieldDefinition', dto.definitionId);
    if (definition.entityType !== dto.entityType) throw new BadRequestException('Jenis entitas tidak sesuai dengan definisi custom field.');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customFieldValue.findFirst({ where: { definitionId: dto.definitionId, entityId: dto.entityId } });
      const data = { definitionId: dto.definitionId, entityType: dto.entityType, entityId: dto.entityId, value: json(dto.value) };
      const row = existing ? await tx.customFieldValue.update({ where: { id: existing.id }, data }) : await tx.customFieldValue.create({ data });
      await this.auditMutation(tx, user, scope, 'UPSERT_CUSTOM_FIELD_VALUE', 'CustomFieldValue', row.id, { branchId: scope.branchId, definitionId: dto.definitionId, entityType: dto.entityType, entityId: dto.entityId });
      return row;
    });
  }

  async listIntegrations(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'IntegrationConnection');
    const rows = await this.prisma.integrationConnection.findMany({
      where: { companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ encryptedSecrets, ...row }) => ({ ...row, hasSecrets: Boolean(encryptedSecrets) }));
  }

  async createIntegration(dto: CreateIntegrationDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'IntegrationConnection');
    const targetBranchId = dto.branchId ? scope.branchId : null;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.integrationConnection.create({ data: {
        companyId: scope.companyId, branchId: targetBranchId, type: dto.type as IntegrationType,
        provider: dto.provider, name: dto.name,
        config: dto.config === undefined ? undefined : json(dto.config), encryptedSecrets: dto.encryptedSecrets ? this.secrets.encryptText(dto.encryptedSecrets) : undefined,
        capabilities: dto.capabilities === undefined ? undefined : json(dto.capabilities),
      } });
      await this.auditMutation(tx, user, scope, 'CREATE_INTEGRATION', 'IntegrationConnection', row.id, { branchId: targetBranchId, type: dto.type, provider: dto.provider });
      const { encryptedSecrets, ...safeRow } = row;
      return { ...safeRow, hasSecrets: Boolean(encryptedSecrets) };
    });
  }


  async updateIntegration(id: string, dto: UpdateIntegrationDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const existing = await this.prisma.integrationConnection.findFirst({
      where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] },
    });
    if (!existing) return this.denyTenantAccess(this.prisma, user, scope, 'IntegrationConnection', id);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.integrationConnection.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status as IntegrationStatus } : {}),
          ...(dto.config !== undefined ? { config: json(dto.config) } : {}),
          ...(dto.capabilities !== undefined ? { capabilities: json(dto.capabilities) } : {}),
          ...(dto.encryptedSecrets?.trim() ? { encryptedSecrets: this.secrets.encryptText(dto.encryptedSecrets.trim()) } : {}),
        },
      });
      await this.auditMutation(tx, user, scope, 'UPDATE_INTEGRATION', 'IntegrationConnection', row.id, {
        branchId: row.branchId, status: row.status, provider: row.provider, secretRotated: Boolean(dto.encryptedSecrets?.trim()),
      });
      const { encryptedSecrets, ...safeRow } = row;
      return { ...safeRow, hasSecrets: Boolean(encryptedSecrets) };
    });
  }

  async listWebhooks(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'WebhookEndpoint');
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { companyId: scope.companyId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => ({ ...row, headers: row.headers ? { redacted: true } : null }));
  }

  async createWebhook(dto: CreateWebhookDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'WebhookEndpoint');
    const webhookUrl = new URL(dto.url);
    const allowPrivate = process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true';
    const host = webhookUrl.hostname.toLowerCase();
    const privateHost = host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (webhookUrl.protocol !== 'https:' && !allowPrivate) throw new BadRequestException('Webhook production wajib memakai HTTPS.');
    if (privateHost && !allowPrivate) throw new BadRequestException('Webhook ke localhost/private network ditolak.');
    return this.prisma.$transaction(async (tx) => {
      const protectedHeaders = dto.headers === undefined ? undefined : this.secrets.encryptJson(dto.headers);
      const row = await tx.webhookEndpoint.create({ data: { companyId: scope.companyId, name: dto.name, url: dto.url, events: json(dto.events), headers: protectedHeaders === undefined ? undefined : json(protectedHeaders) } });
      await this.auditMutation(tx, user, scope, 'CREATE_WEBHOOK', 'WebhookEndpoint', row.id, { branchId: scope.branchId, name: dto.name, events: dto.events });
      return { ...row, headers: row.headers ? { redacted: true } : null };
    });
  }

  async listRules(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'BusinessRule');
    return this.prisma.businessRule.findMany({ where: { companyId: scope.companyId }, orderBy: [{ priority: 'asc' }, { name: 'asc' }] });
  }

  private validateBusinessRuleDefinition(conditions: unknown, actions: unknown) {
    if (conditions !== undefined && conditions !== null && (typeof conditions !== 'object' || Array.isArray(conditions))) {
      throw new BadRequestException('conditions business rule harus berupa object JSON.');
    }
    if (!Array.isArray(actions) || actions.length === 0) throw new BadRequestException('Business rule wajib memiliki minimal satu action.');
    const supported = new Set(['notification.enqueue', 'approval.create', 'reorder_suggestion.create', 'outbox.emit', 'report.enqueue', 'automation.enqueue']);
    for (const [index, action] of actions.entries()) {
      if (!action || typeof action !== 'object' || Array.isArray(action)) throw new BadRequestException(`Action business rule ${index + 1} tidak valid.`);
      const type = (action as Record<string, unknown>).type;
      if (typeof type !== 'string' || !supported.has(type)) throw new BadRequestException(`Action business rule ${index + 1} belum didukung: ${String(type ?? '')}`);
      if (type === 'automation.enqueue') {
        const actionType = (action as Record<string, unknown>).actionType;
        if (actionType !== 'CREATE_MAINTENANCE_WORK_ORDER') throw new BadRequestException('automation.enqueue hanya menerima actionType yang didukung worker.');
      }
      if (type === 'report.enqueue') {
        const reportType = (action as Record<string, unknown>).reportType;
        const format = (action as Record<string, unknown>).format;
        if (typeof reportType !== 'string' || !reportType.trim()) throw new BadRequestException('report.enqueue wajib memiliki reportType.');
        if (format !== undefined && !['CSV','XLSX','PDF'].includes(String(format))) throw new BadRequestException('Format report.enqueue tidak didukung.');
      }
    }
  }

  async createRule(dto: CreateBusinessRuleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'BusinessRule');
    this.validateBusinessRuleDefinition(dto.conditions, dto.actions);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.businessRule.create({ data: {
        companyId: scope.companyId, code: dto.code, name: dto.name, trigger: dto.trigger,
        conditions: dto.conditions === undefined ? undefined : json(dto.conditions), actions: json(dto.actions), priority: dto.priority,
      } });
      await this.auditMutation(tx, user, scope, 'CREATE_BUSINESS_RULE', 'BusinessRule', row.id, { branchId: scope.branchId, code: dto.code, trigger: dto.trigger });
      return row;
    });
  }

  async updateRule(id: string, dto: UpdateBusinessRuleDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const existing = await this.prisma.businessRule.findFirst({ where: { id, companyId: scope.companyId } });
    if (!existing) return this.denyTenantAccess(this.prisma, user, scope, 'BusinessRule', id);
    const conditions = dto.conditions !== undefined ? dto.conditions : existing.conditions;
    const actions = dto.actions !== undefined ? dto.actions : existing.actions;
    this.validateBusinessRuleDefinition(conditions, actions);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.businessRule.update({ where: { id }, data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.trigger !== undefined ? { trigger: dto.trigger.trim() } : {}),
        ...(dto.conditions !== undefined ? { conditions: dto.conditions === null ? Prisma.JsonNull : json(dto.conditions) } : {}),
        ...(dto.actions !== undefined ? { actions: json(dto.actions) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      } });
      await this.auditMutation(tx, user, scope, 'UPDATE_BUSINESS_RULE', 'BusinessRule', row.id, { branchId: scope.branchId, code: row.code, trigger: row.trigger, isActive: row.isActive });
      return row;
    });
  }

  async listAutomationJobs(user: AuthUser, status?: string, ruleCode?: string, limitValue = 100) {
    const scope = this.requireTenantScope(user);
    const allowedStatuses = ['PENDING','PROCESSING','SUCCEEDED','RETRYING','FAILED','CANCELLED'];
    if (status && !allowedStatuses.includes(status)) throw new BadRequestException('Status automation job tidak valid.');
    const limit = Math.min(Math.max(Number(limitValue) || 100, 1), 200);
    return this.prisma.automationJob.findMany({
      where: { companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }], ...(status ? { status: status as AutomationJobStatus } : {}), ...(ruleCode ? { ruleCode } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async automationJobDetail(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const job = await this.prisma.automationJob.findFirst({ where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] } });
    if (!job) return this.denyTenantAccess(this.prisma, user, scope, 'AutomationJob', id);
    const audit = await this.prisma.auditLog.findMany({ where: { companyId: scope.companyId, entityType: 'AutomationJob', entityId: id }, orderBy: { createdAt: 'asc' }, take: 100 });
    return { ...job, audit };
  }

  async cancelAutomationJob(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.automationJob.findFirst({ where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] } });
      if (!job) return this.denyTenantAccess(tx, user, scope, 'AutomationJob', id);
      if (!['PENDING','RETRYING'].includes(job.status)) throw new BadRequestException('Hanya automation job PENDING/RETRYING yang dapat dibatalkan.');
      const row = await tx.automationJob.update({ where: { id }, data: { status: 'CANCELLED', lockedAt: null, lockedBy: null, completedAt: new Date(), lastError: 'Dibatalkan operator.' } });
      await this.auditMutation(tx, user, scope, 'CANCEL_AUTOMATION_JOB', 'AutomationJob', id, { branchId: job.branchId, ruleCode: job.ruleCode, actionType: job.actionType });
      return row;
    });
  }

  async listApprovalPolicies(user: AuthUser, requestedCompanyId?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'ApprovalPolicy');
    return this.prisma.approvalPolicy.findMany({ where: { companyId: scope.companyId }, orderBy: { name: 'asc' } });
  }

  async createApprovalPolicy(dto: CreateApprovalPolicyDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'ApprovalPolicy');
    if (!Array.isArray(dto.steps) || dto.steps.length === 0) throw new BadRequestException('Approval policy wajib memiliki minimal satu langkah.');
    for (const [index, step] of dto.steps.entries()) {
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw new BadRequestException(`Approval step ${index + 1} tidak valid.`);
      const roles = (step as Record<string, unknown>).roles;
      const permissions = (step as Record<string, unknown>).permissions;
      if (roles !== undefined && (!Array.isArray(roles) || roles.some((v) => typeof v !== 'string'))) throw new BadRequestException(`roles pada approval step ${index + 1} tidak valid.`);
      if (permissions !== undefined && (!Array.isArray(permissions) || permissions.some((v) => typeof v !== 'string'))) throw new BadRequestException(`permissions pada approval step ${index + 1} tidak valid.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.approvalPolicy.create({ data: {
        companyId: scope.companyId, code: dto.code, name: dto.name, entityType: dto.entityType,
        conditions: dto.conditions === undefined ? undefined : json(dto.conditions), steps: json(dto.steps),
      } });
      await this.auditMutation(tx, user, scope, 'CREATE_APPROVAL_POLICY', 'ApprovalPolicy', row.id, { branchId: scope.branchId, code: dto.code, entityType: dto.entityType });
      return row;
    });
  }

  private async branchRequesterIds(scope: TenantScope): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      select: { id: true },
    });
    return users.map((item) => item.id);
  }

  async listApprovalRequests(user: AuthUser, requestedCompanyId?: string, status?: ApprovalStatus) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'ApprovalRequest');
    const requesterIds = await this.branchRequesterIds(scope);
    return this.prisma.approvalRequest.findMany({
      where: { companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null, requesterId: { in: requesterIds } }], ...(status ? { status } : {}) },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async createApprovalRequest(dto: CreateApprovalRequestDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, undefined, 'ApprovalRequest');
    const policy = dto.policyId
      ? await this.prisma.approvalPolicy.findFirst({ where: { id: dto.policyId, companyId: scope.companyId, isActive: true } })
      : null;
    if (dto.policyId && !policy) return this.denyTenantAccess(this.prisma, user, scope, 'ApprovalPolicy', dto.policyId);
    if (policy && policy.entityType !== dto.entityType) throw new BadRequestException('Jenis entitas tidak sesuai dengan approval policy.');
    const firstStep = this.approvalSteps(policy)[0] ?? {};
    const expiresAt = this.approvalExpiry(firstStep);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.approvalRequest.create({ data: {
        companyId: scope.companyId, branchId: scope.branchId, policyId: dto.policyId, entityType: dto.entityType, entityId: dto.entityId,
        requesterId: user.sub, amount: dto.amount === undefined ? undefined : new Prisma.Decimal(dto.amount), expiresAt,
        context: this.branchContext(dto.context, scope.branchId),
      } });
      await this.auditMutation(tx, user, scope, 'CREATE_APPROVAL_REQUEST', 'ApprovalRequest', row.id, { branchId: scope.branchId, entityType: dto.entityType, entityId: dto.entityId, expiresAt: expiresAt?.toISOString() ?? null, ...(dto.policyId ? { policyId: dto.policyId } : {}) });
      return row;
    });
  }

  async decideApproval(id: string, dto: DecideApprovalDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const requesterIds = await this.branchRequesterIds(scope);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.findFirst({
        where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null, requesterId: { in: requesterIds } }] },
      });
      if (!request) return this.denyTenantAccess(tx, user, scope, 'ApprovalRequest', id);
      if (request.status !== 'PENDING') throw new BadRequestException('Permintaan approval sudah diputuskan.');
      if (request.expiresAt && request.expiresAt <= new Date()) throw new BadRequestException('Masa berlaku approval sudah habis. Muat ulang status approval.');
      if (request.requesterId === user.sub) throw new ForbiddenException('Pembuat permintaan tidak boleh menyetujui permintaannya sendiri.');
      if (request.delegatedToId && request.delegatedToId !== user.sub) throw new ForbiddenException('Langkah approval ini sedang didelegasikan kepada pengguna lain.');

      const policy = request.policyId ? await tx.approvalPolicy.findFirst({ where: { id: request.policyId, companyId: scope.companyId, isActive: true } }) : null;
      const steps = this.approvalSteps(policy);
      const stepIndex = Math.max(0, request.currentStep - 1);
      const step = steps[stepIndex] ?? {};
      const context = request.context && typeof request.context === 'object' && !Array.isArray(request.context) ? request.context as Record<string, unknown> : {};
      const escalationRoles = request.escalatedAt && Array.isArray(context.escalationRoles) ? context.escalationRoles.filter((v): v is string => typeof v === 'string') : [];
      const roles = [...new Set([...(Array.isArray(step.roles) ? step.roles.filter((v): v is string => typeof v === 'string') : []), ...escalationRoles])];
      const permissions = Array.isArray(step.permissions) ? step.permissions.filter((v): v is string => typeof v === 'string') : [];
      if (!request.delegatedToId && roles.length && !roles.some((role) => user.roles.includes(role))) throw new ForbiddenException('Role pengguna tidak berhak memutuskan langkah approval ini.');
      if (!request.delegatedToId && permissions.length && !permissions.every((permission) => user.permissions.includes(permission))) throw new ForbiddenException('Permission pengguna tidak memenuhi langkah approval ini.');
      const alreadyDecided = await tx.approvalDecision.findFirst({ where: { requestId: id, step: request.currentStep, approverId: user.sub } });
      if (alreadyDecided) throw new BadRequestException('Pengguna sudah memberikan keputusan pada langkah approval ini.');

      await tx.approvalDecision.create({ data: { requestId: id, step: request.currentStep, approverId: user.sub, status: dto.status, notes: dto.notes } });
      const finalApproval = dto.status === 'APPROVED' && request.currentStep >= steps.length;
      const nextStep = steps[request.currentStep] ?? {};
      const nextData = dto.status === 'REJECTED'
        ? { status: ApprovalStatus.REJECTED, decidedAt: new Date(), expiresAt: null, delegatedToId: null, delegatedById: null, delegatedAt: null }
        : finalApproval
          ? { status: ApprovalStatus.APPROVED, decidedAt: new Date(), expiresAt: null, delegatedToId: null, delegatedById: null, delegatedAt: null }
          : { status: ApprovalStatus.PENDING, currentStep: { increment: 1 }, decidedAt: null, expiresAt: this.approvalExpiry(nextStep), escalatedAt: null, delegatedToId: null, delegatedById: null, delegatedAt: null };
      const claimed = await tx.approvalRequest.updateMany({ where: { id, status: 'PENDING', currentStep: request.currentStep }, data: nextData });
      if (claimed.count !== 1) throw new BadRequestException('Approval berubah oleh proses lain. Muat ulang dan coba lagi.');
      const row = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
      await this.auditMutation(tx, user, scope, 'DECIDE_APPROVAL_REQUEST', 'ApprovalRequest', row.id, { branchId: scope.branchId, status: dto.status, step: request.currentStep, final: row.status !== 'PENDING' });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async delegateApproval(id: string, dto: DelegateApprovalDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.findFirst({ where: { id, companyId: scope.companyId, branchId: scope.branchId, status: 'PENDING' } });
      if (!request) return this.denyTenantAccess(tx, user, scope, 'ApprovalRequest', id);
      if (request.requesterId === dto.targetUserId) throw new BadRequestException('Approval tidak boleh didelegasikan kembali kepada requester.');
      const target = await tx.user.findFirst({
        where: { id: dto.targetUserId, branchId: scope.branchId, isActive: true, branch: { companyId: scope.companyId, isActive: true } },
        include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      });
      if (!target) throw new BadRequestException('Target delegasi tidak aktif pada branch yang sama.');
      const policy = request.policyId ? await tx.approvalPolicy.findFirst({ where: { id: request.policyId, companyId: scope.companyId, isActive: true } }) : null;
      const step = this.approvalSteps(policy)[Math.max(0, request.currentStep - 1)] ?? {};
      const stepRoles = Array.isArray(step.roles) ? step.roles.filter((v): v is string => typeof v === 'string') : [];
      const stepPermissions = Array.isArray(step.permissions) ? step.permissions.filter((v): v is string => typeof v === 'string') : [];
      const targetRoles = target.roles.map((entry) => entry.role.name);
      const targetPermissions = [...new Set(target.roles.flatMap((entry) => entry.role.permissions.map((permission) => permission.permission.code)))];
      if (stepRoles.length && !stepRoles.some((role) => targetRoles.includes(role))) throw new BadRequestException('Target delegasi tidak memenuhi role langkah approval.');
      if (stepPermissions.length && !stepPermissions.every((permission) => targetPermissions.includes(permission))) throw new BadRequestException('Target delegasi tidak memenuhi permission langkah approval.');
      const privileged = user.roles.some((role) => ['SUPER_ADMIN','OWNER','ADMIN'].includes(role));
      if (!privileged) {
        if (request.delegatedToId && request.delegatedToId !== user.sub) throw new ForbiddenException('Approval ini sudah didelegasikan kepada pengguna lain.');
        if (stepRoles.length && !stepRoles.some((role) => user.roles.includes(role))) throw new ForbiddenException('Role pengguna tidak berhak mendelegasikan langkah approval ini.');
        if (stepPermissions.length && !stepPermissions.every((permission) => user.permissions.includes(permission))) throw new ForbiddenException('Permission pengguna tidak memenuhi langkah approval ini.');
      }
      const row = await tx.approvalRequest.update({ where: { id }, data: { delegatedToId: target.id, delegatedById: user.sub, delegatedAt: new Date() } });
      await this.auditMutation(tx, user, scope, 'DELEGATE_APPROVAL_REQUEST', 'ApprovalRequest', row.id, { branchId: scope.branchId, targetUserId: target.id, notes: dto.notes ?? null, step: row.currentStep });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async replayAutomationJob(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.automationJob.findFirst({ where: { id, companyId: scope.companyId, OR: [{ branchId: scope.branchId }, { branchId: null }] } });
      if (!job) return this.denyTenantAccess(tx, user, scope, 'AutomationJob', id);
      if (!['FAILED','CANCELLED'].includes(job.status)) throw new BadRequestException('Hanya automation job FAILED/CANCELLED yang dapat direplay.');
      const row = await tx.automationJob.update({ where: { id }, data: { status: 'RETRYING', attempts: 0, scheduledAt: new Date(), lockedAt: null, lockedBy: null, completedAt: null, lastError: null } });
      await this.auditMutation(tx, user, scope, 'REPLAY_AUTOMATION_JOB', 'AutomationJob', id, { branchId: job.branchId });
      return row;
    });
  }

  async listWebhookDeliveries(user: AuthUser, status?: string, limit?: string) {
    const scope = this.requireTenantScope(user);
    const normalized = status?.trim().toUpperCase();
    const allowed = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'];
    if (normalized && !allowed.includes(normalized)) throw new BadRequestException('Status delivery webhook tidak valid.');
    // Without this read path the ops panel could report a FAILED count but give the operator
    // no way to see which deliveries failed, making POST /webhook-deliveries/:id/replay
    // unreachable from the UI.
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { companyId: scope.companyId }, select: { id: true } });
    const endpointIds = endpoints.map((row) => row.id);
    if (!endpointIds.length) return [];
    const take = Math.max(1, Math.min(Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 100, 500));
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: { in: endpointIds }, ...(normalized ? { status: normalized } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, endpointId: true, eventId: true, eventType: true, status: true, attempts: true,
        responseCode: true, responseBody: true, nextRetryAt: true, deliveredAt: true, createdAt: true,
      },
    });
  }

  async replayWebhookDelivery(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.webhookDelivery.findUnique({ where: { id } });
      const endpoint = delivery ? await tx.webhookEndpoint.findFirst({ where: { id: delivery.endpointId, companyId: scope.companyId } }) : null;
      if (!delivery || !endpoint) return this.denyTenantAccess(tx, user, scope, 'WebhookDelivery', id);
      const deliveryPayload = delivery.payload && typeof delivery.payload === 'object' && !Array.isArray(delivery.payload) ? delivery.payload as Record<string, unknown> : {};
      if (deliveryPayload.branchId && deliveryPayload.branchId !== scope.branchId) return this.denyTenantAccess(tx, user, scope, 'WebhookDelivery', id);
      if (!['FAILED','CANCELLED'].includes(delivery.status)) throw new BadRequestException('Hanya webhook FAILED/CANCELLED yang dapat direplay.');
      const row = await tx.webhookDelivery.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextRetryAt: new Date(), deliveredAt: null, responseCode: null, responseBody: null } });
      await this.auditMutation(tx, user, scope, 'REPLAY_WEBHOOK_DELIVERY', 'WebhookDelivery', id, { branchId: scope.branchId, endpointId: delivery.endpointId });
      return row;
    });
  }

  async replayOutboxEvent(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.eventOutbox.findFirst({ where: { id, companyId: scope.companyId } });
      if (!event) return this.denyTenantAccess(tx, user, scope, 'EventOutbox', id);
      const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
      if (payload.branchId && payload.branchId !== scope.branchId) return this.denyTenantAccess(tx, user, scope, 'EventOutbox', id);
      if (event.status !== 'FAILED') throw new BadRequestException('Hanya outbox FAILED yang dapat direplay.');
      const row = await tx.eventOutbox.update({ where: { id }, data: { status: 'PENDING', attempts: 0, availableAt: new Date(), publishedAt: null, lastError: null } });
      await this.auditMutation(tx, user, scope, 'REPLAY_OUTBOX_EVENT', 'EventOutbox', id, { branchId: scope.branchId, eventType: event.eventType });
      return row;
    });
  }

  async replayNotification(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.findFirst({ where: { id, companyId: scope.companyId } });
      if (!notification) return this.denyTenantAccess(tx, user, scope, 'Notification', id);
      const data = notification.data && typeof notification.data === 'object' && !Array.isArray(notification.data) ? notification.data as Record<string, unknown> : {};
      if (data.branchId && data.branchId !== scope.branchId) return this.denyTenantAccess(tx, user, scope, 'Notification', id);
      if (!['FAILED','CANCELLED'].includes(notification.status)) throw new BadRequestException('Hanya notification FAILED/CANCELLED yang dapat direplay.');
      const row = await tx.notification.update({ where: { id }, data: { status: 'QUEUED', attempts: 0, scheduledAt: new Date(), sentAt: null, deliveredAt: null, externalRef: null, provider: null, lastError: null } });
      await tx.employeeNotificationDelivery.updateMany({ where: { notificationId: id }, data: { status: 'QUEUED', attempts: 0, sentAt: null, deliveredAt: null, externalReference: null, lastError: null } });
      await this.auditMutation(tx, user, scope, 'REPLAY_NOTIFICATION', 'Notification', id, { branchId: scope.branchId, channel: notification.channel });
      return row;
    });
  }


  async cancelNotification(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.findFirst({ where: { id, companyId: scope.companyId } });
      if (!notification) return this.denyTenantAccess(tx, user, scope, 'Notification', id);
      const data = notification.data && typeof notification.data === 'object' && !Array.isArray(notification.data) ? notification.data as Record<string, unknown> : {};
      if (data.branchId && data.branchId !== scope.branchId) return this.denyTenantAccess(tx, user, scope, 'Notification', id);
      if (notification.status !== 'QUEUED') throw new BadRequestException('Hanya notification QUEUED yang dapat dibatalkan.');
      const row = await tx.notification.update({ where: { id }, data: { status: 'CANCELLED', lastError: null } });
      await tx.employeeNotificationDelivery.updateMany({ where: { notificationId: id }, data: { status: 'CANCELLED', lastError: null } });
      await this.auditMutation(tx, user, scope, 'CANCEL_NOTIFICATION', 'Notification', id, { branchId: scope.branchId, channel: notification.channel });
      return row;
    });
  }

  async listAuditLogs(user: AuthUser, limit = 100, action?: string, entityType?: string) {
    const scope = this.requireTenantScope(user);
    const take = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 100, 500));
    const rows = await this.prisma.auditLog.findMany({
      where: { companyId: scope.companyId, ...(action ? { action } : {}), ...(entityType ? { entityType } : {}) },
      take: Math.min(take * 5, 2000),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { user: { select: { id: true, email: true, name: true, branchId: true } } },
    });
    return rows.filter((row) => {
      const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {};
      return payload.branchId ? payload.branchId === scope.branchId : row.user?.branchId === scope.branchId;
    }).slice(0, take);
  }

  async listUiSchemas(user: AuthUser, requestedCompanyId?: string, code?: string) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, requestedCompanyId, undefined, 'UiSchemaDefinition');
    return this.prisma.uiSchemaDefinition.findMany({
      where: {
        ...(code ? { code } : {}),
        OR: [
          { companyId: null, branchId: null },
          { companyId: scope.companyId, branchId: null },
          { companyId: scope.companyId, branchId: scope.branchId },
        ],
      },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
  }

  async createUiSchema(dto: CreateUiSchemaDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedScope(this.prisma, user, scope, dto.companyId, dto.branchId, 'UiSchemaDefinition');
    const targetBranchId = dto.branchId ? scope.branchId : null;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.uiSchemaDefinition.create({ data: {
        companyId: scope.companyId, branchId: targetBranchId, code: dto.code, surface: dto.surface,
        schema: json(dto.schema), version: dto.version ?? 1,
      } });
      await this.auditMutation(tx, user, scope, 'CREATE_UI_SCHEMA', 'UiSchemaDefinition', row.id, { branchId: targetBranchId, code: dto.code, version: row.version });
      return row;
    });
  }

  listModules() { return this.prisma.moduleDefinition.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }); }
  pluginCatalog() { return this.plugins.list(); }

  async outbox(user: AuthUser, limit = 100) {
    const scope = this.requireTenantScope(user);
    const take = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 100, 500));
    const rows = await this.prisma.eventOutbox.findMany({
      where: { companyId: scope.companyId },
      take: Math.min(take * 5, 1000),
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) => {
      const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? row.payload as Record<string, unknown>
        : undefined;
      return !payload?.branchId || payload.branchId === scope.branchId;
    }).slice(0, take);
  }

  // T360-20260829 value pack 2 — kesehatan operasional: outbox, webhook, export, automation.
  async opsHealth(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const oneHourAgo = new Date(Date.now() - 3600000);
    const webhookEndpointIds = (await this.prisma.webhookEndpoint.findMany({
      where: { companyId: scope.companyId },
      select: { id: true },
    })).map((row) => row.id);
    const [outboxPending, outboxFailed, webhookFailed, reportPendingStale, reportFailed, automationFailed] = await Promise.all([
      this.prisma.eventOutbox.count({ where: { companyId: scope.companyId, status: 'PENDING' } }),
      this.prisma.eventOutbox.count({ where: { companyId: scope.companyId, status: 'FAILED' } }),
      webhookEndpointIds.length
        ? this.prisma.webhookDelivery.count({ where: { status: 'FAILED', endpointId: { in: webhookEndpointIds } } })
        : Promise.resolve(0),
      this.prisma.reportJob.count({ where: { companyId: scope.companyId, branchId: scope.branchId, status: 'PENDING', createdAt: { lt: oneHourAgo } } }),
      this.prisma.reportJob.count({ where: { companyId: scope.companyId, branchId: scope.branchId, status: 'FAILED' } }),
      this.prisma.automationJob.count({ where: { companyId: scope.companyId, status: 'FAILED' } }),
    ]);
    const healthy = outboxFailed === 0 && webhookFailed === 0 && reportPendingStale === 0 && reportFailed === 0 && automationFailed === 0;
    return {
      companyId: scope.companyId,
      branchId: scope.branchId,
      healthy,
      outbox: { pending: outboxPending, failed: outboxFailed },
      webhooks: { failed: webhookFailed },
      reportJobs: { pendingStale: reportPendingStale, failed: reportFailed },
      automationJobs: { failed: automationFailed },
      checkedAt: new Date().toISOString(),
    };
  }
}
