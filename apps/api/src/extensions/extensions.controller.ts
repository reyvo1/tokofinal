import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import {
  CreateBatchDto, CreateFiscalPeriodDto, CreateLoyaltyProgramDto, CreateReconciliationDto,
  CreateSerialDto, CreateShipmentDto, ImportBankStatementDto, ImportMarketplaceOrderDto,
  LoyaltyTransactionDto, MatchBankReconciliationDto, QueueNotificationDto, RegisterDeviceDto, RunForecastDto, UpsertNotificationTemplateDto,
  AcknowledgeSyncReceiptDto, OperatorAssistantQueryDto, RotateDeviceCredentialDto, SetDeviceStatusDto, SubmitOfflineTransactionsDto, UnmatchBankReconciliationDto,
  UpdateOperatorInsightStatusDto, MaterializeDailySummariesDto, RunDataArchiveDto, UpsertDataRetentionPolicyDto, UpsertExternalMappingDto,
  CloseFiscalPeriodDto,
} from './dto/extensions.dto';
import { ExtensionsService } from './extensions.service';

@ApiTags('extensions') @ApiBearerAuth() @Controller()
  export class ExtensionsController {
  constructor(private readonly service: ExtensionsService) {}

  @Get('inventory-batches')
  batches(
    @CurrentUser() user: AuthUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) { return this.service.batches(user, warehouseId, productId); }

  @Post('inventory-batches')
  @Permissions('inventory.batch')
  createBatch(@Body() dto: CreateBatchDto, @CurrentUser() user: AuthUser) {
    return this.service.createBatch(dto, user);
  }

  @Get('inventory-serials')
  serials(
    @CurrentUser() user: AuthUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) { return this.service.serials(user, warehouseId, productId); }

  @Post('inventory-serials')
  @Permissions('inventory.serial')
  createSerial(@Body() dto: CreateSerialDto, @CurrentUser() user: AuthUser) {
    return this.service.createSerial(dto, user);
  }

  @Get('loyalty/programs')
  loyaltyPrograms(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.loyaltyPrograms(user, companyId);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('loyalty/programs')
  @Permissions('loyalty.manage')
  createLoyaltyProgram(@Body() dto: CreateLoyaltyProgramDto, @CurrentUser() user: AuthUser) {
    return this.service.createLoyaltyProgram(dto, user);
  }

  @Post('loyalty/transactions')
  @Permissions('loyalty.manage')
  loyaltyTransaction(@Body() dto: LoyaltyTransactionDto, @CurrentUser() user: AuthUser) {
    return this.service.loyaltyTransaction(dto, user);
  }

  /** Daftar pelanggan (untuk dropdown POS) — T360-20260825. */
  @Get('customers')
  customers(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.customers(user, search, limit ? Number(limit) : undefined);
  }

  /** Saldo poin pelanggan pada program aktif — T360-20260825. */
  @Get('loyalty/accounts/:customerId')
  loyaltyAccount(@Param('customerId') customerId: string, @CurrentUser() user: AuthUser) {
    return this.service.loyaltyAccountForCustomer(user, customerId);
  }

  /** Tier & diskon member otomatis — T360-20260825 Fitur 2. */
  @Get('loyalty/tier/:customerId')
  loyaltyTier(@Param('customerId') customerId: string, @CurrentUser() user: AuthUser) {
    return this.service.loyaltyTierForCustomer(user, customerId);
  }

  @Get('finance/fiscal-periods')
  fiscalPeriods(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.service.fiscalPeriods(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Post('finance/fiscal-periods')
  @Permissions('finance.close_period')
  createFiscalPeriod(@Body() dto: CreateFiscalPeriodDto, @CurrentUser() user: AuthUser) {
    return this.service.createFiscalPeriod(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Patch('finance/fiscal-periods/:id/soft-close')
  @Permissions('finance.close_period')
  softCloseFiscalPeriod(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.softCloseFiscalPeriod(id, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Patch('finance/fiscal-periods/:id/reopen')
  @Permissions('finance.close_period')
  reopenFiscalPeriod(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reopenFiscalPeriod(id, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Patch('finance/fiscal-periods/:id/close')
  @Permissions('finance.close_period')
  closeFiscalPeriod(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CloseFiscalPeriodDto) {
    return this.service.closeFiscalPeriod(id, user, dto?.notes);
  }

  @Get('finance/bank-statements')
  bankStatements(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.service.bankStatements(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Post('finance/bank-statements/import')
  @Permissions('finance.reconcile')
  importBankStatement(@Body() dto: ImportBankStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.importBankStatement(dto, user);
  }

  @Get('finance/reconciliations')
  reconciliations(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.service.reconciliations(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Post('finance/reconciliations')
  @Permissions('finance.reconcile')
  createReconciliation(@Body() dto: CreateReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.service.createReconciliation(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Get('finance/reconciliations/:id/details')
  @Permissions('finance.view')
  reconciliationDetails(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reconciliationDetails(id, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Post('finance/reconciliations/:id/auto-match')
  @Permissions('finance.reconcile')
  autoMatchReconciliation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.autoMatchReconciliation(id, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Post('finance/reconciliations/:id/match')
  @Permissions('finance.reconcile')
  matchReconciliation(@Param('id') id: string, @Body() dto: MatchBankReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.service.matchReconciliation(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Post('finance/reconciliations/:id/unmatch')
  @Permissions('finance.reconcile')
  unmatchReconciliation(@Param('id') id: string, @Body() dto: UnmatchBankReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.service.unmatchReconciliation(id, dto, user);
  }

  @Get('devices')
  devices(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.devices(user, companyId);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('devices')
  @Permissions('integration.manage')
  registerDevice(@Body() dto: RegisterDeviceDto, @CurrentUser() user: AuthUser) {
    return this.service.registerDevice(dto, user);
  }

  @Get('sync/pull')
  syncPull(
    @CurrentUser() user: AuthUser,
    @Query('since') since?: string,
    @Query('cursor') cursor?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.service.syncPull(user, since, cursor, deviceId);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Get('devices/:id/sync/diagnostics')
  @Permissions('integration.view')
  deviceSyncDiagnostics(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ) {
    return this.service.deviceSyncDiagnostics(id, user, limit);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('devices/:id/credentials/rotate')
  @Permissions('integration.manage')
  rotateDeviceCredential(@Param('id') id: string, @Body() dto: RotateDeviceCredentialDto, @CurrentUser() user: AuthUser) {
    return this.service.rotateDeviceCredential(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Patch('devices/:id/status')
  @Permissions('integration.manage')
  setDeviceStatus(@Param('id') id: string, @Body() dto: SetDeviceStatusDto, @CurrentUser() user: AuthUser) {
    return this.service.setDeviceStatus(id, dto.isActive, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('devices/:id/sync/ack')
  @Permissions('integration.manage')
  acknowledgeSync(@Param('id') id: string, @Body() dto: AcknowledgeSyncReceiptDto, @CurrentUser() user: AuthUser) {
    return this.service.acknowledgeSyncReceipt(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('devices/:id/offline-transactions/:transactionId/requeue')
  @Permissions('integration.manage')
  requeueOffline(@Param('id') id: string, @Param('transactionId') transactionId: string, @CurrentUser() user: AuthUser) {
    return this.service.requeueOfflineTransaction(id, transactionId, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('devices/:id/offline-transactions')
  @Permissions('integration.manage')
  submitOfflineTransactions(
    @Param('id') id: string,
    @Body() dto: SubmitOfflineTransactionsDto,
    @CurrentUser() user: AuthUser,
  ) { return this.service.submitOfflineTransactions(id, dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','AUDITOR') @Get('analytics/daily-summaries')
  @Permissions('report.view')
  dailySummaries(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.dailySummaries(user, from, to);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE') @Post('analytics/daily-summaries/materialize')
  @Permissions('report.export')
  materializeDailySummaries(@Body() dto: MaterializeDailySummariesDto, @CurrentUser() user: AuthUser) {
    return this.service.materializeDailySummaries(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','AUDITOR') @Get('retention/policies')
  @Permissions('report.view')
  retentionPolicies(@CurrentUser() user: AuthUser) { return this.service.retentionPolicies(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('retention/policies')
  @Permissions('report.export')
  upsertRetentionPolicy(@Body() dto: UpsertDataRetentionPolicyDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertRetentionPolicy(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Get('retention/archive-runs')
  @Permissions('report.view')
  archiveRuns(@CurrentUser() user: AuthUser) { return this.service.archiveRuns(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('retention/archive-runs')
  @Permissions('report.export')
  runArchive(@Body() dto: RunDataArchiveDto, @CurrentUser() user: AuthUser) { return this.service.runArchive(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Get('integrations/:id/mappings')
  @Permissions('integration.view')
  externalMappings(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.externalMappings(id, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('integrations/:id/mappings')
  @Permissions('integration.manage')
  upsertExternalMapping(@Param('id') id: string, @Body() dto: UpsertExternalMappingDto, @CurrentUser() user: AuthUser) { return this.service.upsertExternalMapping(id, dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Delete('integrations/:id/mappings/:mappingId')
  @Permissions('integration.manage')
  deleteExternalMapping(@Param('id') id: string, @Param('mappingId') mappingId: string, @CurrentUser() user: AuthUser) { return this.service.deleteExternalMapping(id, mappingId, user); }

  @Get('forecasts')
  @Permissions('forecast.view')
  forecasts(@CurrentUser() user: AuthUser) { return this.service.forecasts(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','PURCHASING') @Post('forecasts/run')
  @Permissions('forecast.run')
  runForecast(@Body() dto: RunForecastDto, @CurrentUser() user: AuthUser) {
    return this.service.runForecast(dto, user);
  }

  @Get('forecasts/:id')
  @Permissions('forecast.view')
  forecastDetail(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.forecastDetail(id, user); }

  @Get('operator-insights')
  @Permissions('assistant.use')
  operatorInsights(@CurrentUser() user: AuthUser) { return this.service.operatorInsights(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('operator-insights/refresh')
  @Permissions('assistant.manage')
  refreshOperatorInsights(@CurrentUser() user: AuthUser) { return this.service.refreshOperatorInsights(user); }

  @Patch('operator-insights/:id/status')
  @Permissions('assistant.use')
  updateOperatorInsight(@Param('id') id: string, @Body() dto: UpdateOperatorInsightStatusDto, @CurrentUser() user: AuthUser) {
    return this.service.updateOperatorInsightStatus(id, dto.status, user);
  }

  @Get('operator-assistant/history')
  @Permissions('assistant.use')
  assistantHistory(@CurrentUser() user: AuthUser) { return this.service.assistantHistory(user); }

  @Post('operator-assistant/query')
  @Permissions('assistant.use')
  assistantQuery(@Body() dto: OperatorAssistantQueryDto, @CurrentUser() user: AuthUser) { return this.service.operatorAssistantQuery(dto, user); }

  @Get('shipments')
  shipments(@CurrentUser() user: AuthUser) { return this.service.shipments(user); }

  @Post('shipments')
  @Permissions('shipment.manage')
  createShipment(@Body() dto: CreateShipmentDto, @CurrentUser() user: AuthUser) {
    return this.service.createShipment(dto, user);
  }

  @Get('marketplace-orders')
  marketplaces(@CurrentUser() user: AuthUser) { return this.service.marketplaces(user); }

  @Post('marketplace-orders/import')
  @Permissions('integration.manage')
  importMarketplaceOrder(@Body() dto: ImportMarketplaceOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.importMarketplaceOrder(dto, user);
  }

  @Get('notifications/providers')
  notificationProviders(@CurrentUser() user: AuthUser) { return this.service.notificationProviders(user); }

  @Get('notifications/templates')
  notificationTemplates(@CurrentUser() user: AuthUser) { return this.service.notificationTemplates(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post('notifications/templates')
  @Permissions('notification.manage')
  upsertNotificationTemplate(@Body() dto: UpsertNotificationTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertNotificationTemplate(dto, user);
  }

  @Get('notifications')
  notifications(
    @CurrentUser() user: AuthUser,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) { return this.service.notifications(user, channel, status, limit ? Number(limit) : 200); }

  @Post('notifications')
  @Permissions('notification.manage')
  queueNotification(@Body() dto: QueueNotificationDto, @CurrentUser() user: AuthUser) {
    return this.service.queueNotification(dto, user);
  }
}
