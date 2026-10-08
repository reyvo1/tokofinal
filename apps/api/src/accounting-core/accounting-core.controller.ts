import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { AccountingCoreService } from './accounting-core.service';
import { CreateAccountDto, CreateAccountingCloseControlDto, CreatePostingRuleDto, CreateTaxCodeDto, PostManualAccountingEventDto, PreviewTaxDto, ReopenAccountingCloseControlDto, UpdateAccountDto, UpdatePostingRuleStatusDto, UpdateTaxCodeStatusDto } from './dto/accounting-core.dto';

@ApiTags('accounting-core') @ApiBearerAuth() @Controller('accounting-core')
  export class AccountingCoreController {
  constructor(private readonly accounting: AccountingCoreService) {}

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('accounts')
  accounts(@CurrentUser() user: AuthUser) {
    return this.accounting.listAccounts(user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('accounting.rule.manage') @Post('accounts')
  createAccount(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('accounting.rule.manage') @Patch('accounts/:id')
  updateAccount(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accounting.updateAccount(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('events')
  events(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.accounting.listEvents(user, limit, cursor, companyId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('events/:id')
  eventDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounting.getEventDetail(id, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('tax.view') @Get('tax-codes')
  taxCodes(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.accounting.listTaxCodes(user, companyId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('tax.manage') @Post('tax-codes')
  createTaxCode(@CurrentUser() user: AuthUser, @Body() dto: CreateTaxCodeDto) {
    return this.accounting.createTaxCode(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('tax.manage') @Patch('tax-codes/:id/status')
  updateTaxCodeStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTaxCodeStatusDto) {
    return this.accounting.updateTaxCodeStatus(id, dto.status, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('tax.view') @Get('tax-transactions')
  taxTransactions(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('direction') direction?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.accounting.listTaxTransactions(user, from, to, direction, limit, cursor);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('tax.view') @Get('tax-documents')
  taxDocuments(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.accounting.listTaxDocuments(user, from, to, limit, cursor);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('tax.view') @Get('tax-reconciliation')
  taxReconciliation(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.taxReconciliation(user, from, to);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('tax.view') @Post('tax/preview')
  previewTax(@CurrentUser() user: AuthUser, @Body() dto: PreviewTaxDto) {
    return this.accounting.previewTax(dto.taxCodeId, dto.amount, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('posting-rules')
  postingRules(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('eventType') eventType?: string,
  ) {
    return this.accounting.listPostingRules(user, eventType, companyId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('accounting.rule.manage') @Post('posting-rules')
  createPostingRule(@CurrentUser() user: AuthUser, @Body() dto: CreatePostingRuleDto) {
    return this.accounting.createPostingRule(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('accounting.rule.manage') @Patch('posting-rules/:id/status')
  updatePostingRuleStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePostingRuleStatusDto) {
    return this.accounting.updatePostingRuleStatus(id, dto.status, user);
  }


  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('close-controls')
  closeControls(@CurrentUser() user: AuthUser) {
    return this.accounting.listCloseControls(user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.close_period') @Post('close-controls')
  createCloseControl(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountingCloseControlDto) {
    return this.accounting.createCloseControl(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.close_period') @Post('close-controls/:id/close')
  closeControl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounting.closeControl(id, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.close_period') @Post('close-controls/:id/reopen')
  reopenCloseControl(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReopenAccountingCloseControlDto) {
    return this.accounting.reopenCloseControl(id, dto.reopenReason, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.journal') @Post('events/post')
  post(@CurrentUser() user: AuthUser, @Body() dto: PostManualAccountingEventDto) {
    return this.accounting.postManual(dto, user);
  }
}
