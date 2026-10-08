import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApprovalStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import {
  CreateApprovalPolicyDto, CreateApprovalRequestDto, CreateBusinessRuleDto, CreateCustomFieldDto,
  CreateIntegrationDto, CreateUiSchemaDto, CreateWebhookDto, DecideApprovalDto, DelegateApprovalDto, UpdateBusinessRuleDto, UpdateIntegrationDto,
  SetCustomFieldValueDto, UpdateTenantProfileDto, UpsertFeatureFlagDto, UpsertSettingDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

@ApiTags('platform') @ApiBearerAuth() @Controller('platform')
  export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Public() @Get('manifest')
  manifest(
    @CurrentUser() user: AuthUser | undefined,
    @Query('branchCode') branchCode?: string,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.platform.manifest(user, branchCode, companyId, branchId); }

  @Public() @Get('storefront-branches')
  storefrontBranches(@Query('branchCode') branchCode?: string) {
    return this.platform.storefrontBranches(branchCode);
  }

  @Get('modules') modules() { return this.platform.listModules(); }
  @Get('plugins') plugins() { return this.platform.pluginCatalog(); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('platform.configure') @Get('setup-readiness')
  setupReadiness(@CurrentUser() user: AuthUser) { return this.platform.setupReadiness(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('platform.configure') @Get('tenant')
  tenant(@CurrentUser() user: AuthUser) { return this.platform.tenantProfile(user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('platform.configure') @Patch('tenant')
  updateTenant(@Body() dto: UpdateTenantProfileDto, @CurrentUser() user: AuthUser) { return this.platform.updateTenantProfile(dto, user); }

  @Permissions('platform.configure') @Get('features') features(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) { return this.platform.listFeatures(user, companyId); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('platform.configure') @Post('features') setFeature(@Body() dto: UpsertFeatureFlagDto, @CurrentUser() user: AuthUser) { return this.platform.setFeature(dto, user); }

  @Permissions('platform.configure') @Get('settings') settings(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string, @Query('namespace') namespace?: string) { return this.platform.listSettings(user, companyId, namespace); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('platform.configure') @Post('settings') setSetting(@Body() dto: UpsertSettingDto, @CurrentUser() user: AuthUser) { return this.platform.setSetting(dto, user); }

  @Permissions('custom_field.manage') @Get('custom-fields') customFields(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string, @Query('entityType') entityType?: string) { return this.platform.listCustomFields(user, companyId, entityType); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('custom_field.manage') @Post('custom-fields') createCustomField(@Body() dto: CreateCustomFieldDto, @CurrentUser() user: AuthUser) { return this.platform.createCustomField(dto, user); }
  @Permissions('custom_field.manage') @Post('custom-field-values') setCustomFieldValue(@Body() dto: SetCustomFieldValueDto, @CurrentUser() user: AuthUser) { return this.platform.setCustomFieldValue(dto, user); }

  @Get('integrations') integrations(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) { return this.platform.listIntegrations(user, companyId); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('integration.manage') @Post('integrations') createIntegration(@Body() dto: CreateIntegrationDto, @CurrentUser() user: AuthUser) { return this.platform.createIntegration(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('integration.manage') @Patch('integrations/:id') updateIntegration(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @CurrentUser() user: AuthUser) { return this.platform.updateIntegration(id, dto, user); }

  @Permissions('webhook.manage') @Get('webhooks') webhooks(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) { return this.platform.listWebhooks(user, companyId); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('webhook.manage') @Post('webhooks') createWebhook(@Body() dto: CreateWebhookDto, @CurrentUser() user: AuthUser) { return this.platform.createWebhook(dto, user); }

  @Get('business-rules') @Permissions('automation.manage') rules(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) { return this.platform.listRules(user, companyId); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('business-rules') @Permissions('automation.manage') createRule(@Body() dto: CreateBusinessRuleDto, @CurrentUser() user: AuthUser) { return this.platform.createRule(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Patch('business-rules/:id') @Permissions('automation.manage') updateRule(@Param('id') id: string, @Body() dto: UpdateBusinessRuleDto, @CurrentUser() user: AuthUser) { return this.platform.updateRule(id, dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Get('automation-jobs') automationJobs(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('ruleCode') ruleCode?: string, @Query('limit') limit?: string) { return this.platform.listAutomationJobs(user, status, ruleCode, limit ? Number(limit) : 100); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Get('automation-jobs/:id') automationJob(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.platform.automationJobDetail(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('automation-jobs/:id/cancel') @Permissions('automation.manage') cancelAutomation(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.platform.cancelAutomationJob(id, user); }

  @Permissions('approval.manage') @Get('approval-policies') approvalPolicies(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) { return this.platform.listApprovalPolicies(user, companyId); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('approval.manage') @Post('approval-policies') createApprovalPolicy(@Body() dto: CreateApprovalPolicyDto, @CurrentUser() user: AuthUser) { return this.platform.createApprovalPolicy(dto, user); }
  @Get('approval-requests') approvalRequests(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string, @Query('status') status?: ApprovalStatus) { return this.platform.listApprovalRequests(user, companyId, status); }
  @Post('approval-requests') createApprovalRequest(@Body() dto: CreateApprovalRequestDto, @CurrentUser() user: AuthUser) { return this.platform.createApprovalRequest(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE','PURCHASING') @Patch('approval-requests/:id/decision') decideApproval(@Param('id') id: string, @Body() dto: DecideApprovalDto, @CurrentUser() user: AuthUser) { return this.platform.decideApproval(id, dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE','PURCHASING') @Patch('approval-requests/:id/delegate') delegateApproval(@Param('id') id: string, @Body() dto: DelegateApprovalDto, @CurrentUser() user: AuthUser) { return this.platform.delegateApproval(id, dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('automation-jobs/:id/replay') @Permissions('automation.manage') replayAutomation(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.platform.replayAutomationJob(id, user); }
  @Permissions('webhook.manage') @Get('webhook-deliveries')
  webhookDeliveries(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.platform.listWebhookDeliveries(user, status, limit);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('webhook.manage') @Post('webhook-deliveries/:id/replay') replayWebhook(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.platform.replayWebhookDelivery(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('platform.configure') @Post('outbox/:id/replay') replayOutbox(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.platform.replayOutboxEvent(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('notifications/:id/cancel') @Permissions('notification.manage') cancelNotification(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.platform.cancelNotification(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('notifications/:id/replay') @Permissions('notification.manage') replayNotification(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.platform.replayNotification(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Permissions('audit.view') @Get('audit-logs') auditLogs(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('action') action?: string, @Query('entityType') entityType?: string) { return this.platform.listAuditLogs(user, limit ? Number(limit) : 100, action, entityType); }

  @Permissions('ui_schema.manage') @Get('ui-schemas') uiSchemas(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string, @Query('code') code?: string) { return this.platform.listUiSchemas(user, companyId, code); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('ui_schema.manage') @Post('ui-schemas') createUiSchema(@Body() dto: CreateUiSchemaDto, @CurrentUser() user: AuthUser) { return this.platform.createUiSchema(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Permissions('audit.view') @Get('outbox') outbox(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) { return this.platform.outbox(user, limit ? Number(limit) : 100); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Permissions('audit.view') @Get('ops-health') opsHealth(@CurrentUser() user: AuthUser) { return this.platform.opsHealth(user); }
  }
