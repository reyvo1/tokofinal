import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { FinanceTransactionType } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { ApproveFinanceTransactionDto, CreateFinanceTransactionDto } from './dto/finance-operations.dto';
import { FinanceOperationsService } from './finance-operations.service';

@ApiTags('finance-operations') @ApiBearerAuth() @Controller('finance-operations')
  export class FinanceOperationsController {
  constructor(private readonly service: FinanceOperationsService) {}

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('customer-receivables')
  customerReceivables(@CurrentUser() user: AuthUser) {
    return this.service.listCustomerReceivables(user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('supplier-payables')
  supplierPayables(@CurrentUser() user: AuthUser, @Query('supplierId') supplierId?: string) {
    return this.service.listSupplierPayables(user, supplierId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('supplier-refunds')
  supplierRefunds(@CurrentUser() user: AuthUser, @Query('supplierId') supplierId?: string) {
    return this.service.listSupplierRefundReceivables(user, supplierId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('ar-aging')
  arAging(@CurrentUser() user: AuthUser, @Query('asOf') asOf?: string) {
    return this.service.customerReceivableAging(user, asOf);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('ap-aging')
  apAging(@CurrentUser() user: AuthUser, @Query('asOf') asOf?: string, @Query('supplierId') supplierId?: string) {
    return this.service.supplierPayableAging(user, asOf, supplierId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('cash-bank-position')
  cashBankPosition(@CurrentUser() user: AuthUser) {
    return this.service.cashBankPosition(user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get('settlement-trace')
  settlementTrace(@CurrentUser() user: AuthUser, @Query('referenceType') referenceType?: string, @Query('referenceId') referenceId?: string) {
    return this.service.settlementTrace(user, referenceType, referenceId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','AUDITOR') @Permissions('finance.view') @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
    @Query('type') type?: FinanceTransactionType,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.list(user, type, status, limit, cursor, companyId, branchId);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE','ADMIN') @Permissions('finance.create') @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Wajib bila idempotencyKey tidak dikirim di body; gunakan key yang sama saat retry.' })
  create(
    @Body() dto: CreateFinanceTransactionDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.service.create(dto, user, idempotencyKey);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.approve') @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveFinanceTransactionDto, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.approve') @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: ApproveFinanceTransactionDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.approve') @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: ApproveFinanceTransactionDto, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('finance.post') @Post(':id/post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user);
  }
}
