import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { AssignEmployeeComponentDto, CancelPayrollRunDto, CreatePayrollAdjustmentRunDto, CreatePayrollComponentDto, CreatePayrollPeriodDto, CreatePayrollRunDto, CreateRuleSetDto, CreateSocialSecurityRuleSetDto, PublishPayslipsDto, SettlePayrollPaymentDto, UpsertEmployeeSocialSecurityProfileDto, UpsertEmployeeTaxProfileDto, UpsertPayrollAccountingMappingDto } from './dto/payroll.dto';
import { PayrollService } from './payroll.service';

@ApiTags('payroll') @ApiBearerAuth() @Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Permissions('payroll.view') @Get('periods')
  periods(@CurrentUser() user: AuthUser, @Query('year') year?: string, @Query('month') month?: string) {
    return this.payroll.listPeriods(user, year, month);
  }

  @Permissions('tax.view') @Get('tax-rule-sets')
  taxRuleSets(@CurrentUser() user: AuthUser) {
    return this.payroll.listTaxRuleSets(user);
  }

  @Permissions('payroll.view') @Get('social-security-rule-sets')
  socialRuleSets(@CurrentUser() user: AuthUser) {
    return this.payroll.listSocialSecurityRuleSets(user);
  }


  @Permissions('payroll.view') @Get('employee-profiles/:employeeId')
  employeeProfiles(@Param('employeeId') employeeId: string, @CurrentUser() user: AuthUser) { return this.payroll.employeeProfiles(employeeId, user); }

  @Permissions('payroll.manage') @Post('employee-tax-profiles')
  taxProfile(@Body() dto: UpsertEmployeeTaxProfileDto, @CurrentUser() user: AuthUser) { return this.payroll.upsertEmployeeTaxProfile(dto, user); }

  @Permissions('payroll.manage') @Post('employee-social-security-profiles')
  socialProfile(@Body() dto: UpsertEmployeeSocialSecurityProfileDto, @CurrentUser() user: AuthUser) { return this.payroll.upsertEmployeeSocialSecurityProfile(dto, user); }

  @Permissions('payroll.view') @Get('accounting-mappings')
  accountingMappings(@CurrentUser() user: AuthUser) { return this.payroll.listAccountingMappings(user); }

  @Permissions('payroll.manage') @Post('accounting-mappings')
  accountingMapping(@Body() dto: UpsertPayrollAccountingMappingDto, @CurrentUser() user: AuthUser) { return this.payroll.upsertAccountingMapping(dto, user); }

  @Permissions('payroll.view') @Get('runs')
  list(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.payroll.listRuns(user, companyId);
  }

  @Permissions('payroll.view') @Get('runs/:id/results')
  results(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.listRunResults(id, user);
  }

  @Permissions('payroll.view') @Get('runs/:id/payments')
  payments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.listPayments(id, user);
  }

  @Permissions('payroll.view') @Get('liabilities')
  liabilities(@CurrentUser() user: AuthUser) {
    return this.payroll.listLiabilities(user);
  }

  @Permissions('payroll.manage') @Post('periods')
  period(@Body() dto: CreatePayrollPeriodDto, @CurrentUser() user: AuthUser) {
    return this.payroll.createPeriod(dto, user);
  }

  @Permissions('payroll.calculate') @Post('periods/:id/lock-attendance')
  lockAttendance(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.lockAttendance(id, user);
  }

  @Permissions('payroll.view') @Get('components')
  listComponents(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.payroll.listComponents(user, limit, cursor);
  }

  @Permissions('payroll.view') @Get('employee-components')
  listEmployeeComponents(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.payroll.listEmployeeComponents(user, limit, cursor);
  }

  @Permissions('payroll.manage') @Post('components')
  component(@Body() dto: CreatePayrollComponentDto, @CurrentUser() user: AuthUser) {
    return this.payroll.createComponent(dto, user);
  }

  @Permissions('payroll.manage') @Post('employee-components')
  assign(@Body() dto: AssignEmployeeComponentDto, @CurrentUser() user: AuthUser) {
    return this.payroll.assignComponent(dto, user);
  }

  @Permissions('tax.manage') @Post('tax-rule-sets')
  taxRules(@Body() dto: CreateRuleSetDto, @CurrentUser() user: AuthUser) {
    return this.payroll.createTaxRuleSet(dto, user);
  }

  @Permissions('payroll.manage') @Post('social-security-rule-sets')
  socialRules(@Body() dto: CreateSocialSecurityRuleSetDto, @CurrentUser() user: AuthUser) {
    return this.payroll.createSocialSecurityRuleSet(dto, user);
  }

  @Permissions('tax.manage') @Post('tax-rule-sets/:id/approve')
  approveTaxRule(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.approveTaxRuleSet(id, user);
  }

  @Permissions('payroll.approve') @Post('social-security-rule-sets/:id/approve')
  approveSocialRule(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.approveSocialSecurityRuleSet(id, user);
  }

  @Permissions('payroll.manage') @Post('runs')
  createRun(@Body() dto: CreatePayrollRunDto, @CurrentUser() user: AuthUser) {
    return this.payroll.createRun(dto, user);
  }

  @Permissions('payroll.manage') @Post('runs/:id/adjustments')
  createAdjustment(@Param('id') id: string, @Body() dto: CreatePayrollAdjustmentRunDto, @CurrentUser() user: AuthUser) {
    return this.payroll.createAdjustmentRun(id, dto, user);
  }

  @Permissions('payroll.manage') @Post('runs/:id/cancel')
  cancelRun(@Param('id') id: string, @Body() dto: CancelPayrollRunDto, @CurrentUser() user: AuthUser) {
    return this.payroll.cancelRun(id, dto.reason, user);
  }

  @Permissions('payroll.calculate') @Post('runs/:id/calculate')
  calculate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.calculateRun(id, user);
  }

  @Permissions('payroll.approve') @Post('runs/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.approveRun(id, user);
  }

  @Permissions('payroll.post') @Post('runs/:id/post-accounting')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.postAccounting(id, user);
  }

  @Permissions('payroll.post') @Post('payments/:id/settle')
  settlePayment(@Param('id') id: string, @Body() dto: SettlePayrollPaymentDto, @CurrentUser() user: AuthUser) {
    return this.payroll.settlePayment(id, dto, user);
  }

  @Permissions('payroll.publish') @Post('runs/:id/publish-payslips')
  publish(@Param('id') id: string, @Body() dto: PublishPayslipsDto, @CurrentUser() user: AuthUser) {
    return this.payroll.publishPayslips(id, dto, user);
  }
}
