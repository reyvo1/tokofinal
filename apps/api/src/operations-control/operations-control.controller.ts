import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InspectionStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { OperationsControlService } from './operations-control.service';
import { AddInspectionEvidenceDto, ApproveInspectionDto, CompleteInspectionDto, ConfirmOperationDto, CreateGatePassDto, CreateInspectionDto, CreateInspectionTemplateDto, UpsertOperationPolicyDto } from './dto/operations-control.dto';

@ApiTags('operations-control') @ApiBearerAuth() @Controller('operations-control')
  export class OperationsControlController {
  constructor(private readonly operations: OperationsControlService) {}

  @Roles('SUPER_ADMIN','OWNER','ADMIN','AUDITOR') @Permissions('operations.policy.view') @Get('policies')
  policies(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
    @Query('operationType') operationType?: string,
  ) {
    return this.operations.listPolicies(user, companyId, branchId, operationType);
  }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('operations.policy.manage') @Post('policies')
  upsertPolicy(@Body() dto: UpsertOperationPolicyDto, @CurrentUser() user: AuthUser) { return this.operations.upsertPolicy(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','FINANCE','AUDITOR') @Permissions('inspection.view') @Get('inspections')
  inspections(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: InspectionStatus,
    @Query('sourceType') sourceType?: string,
  ) { return this.operations.listInspections(user, limit, cursor, status, sourceType); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','FINANCE','AUDITOR') @Permissions('inspection.view') @Get('gate-passes')
  gatePasses(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.operations.listGatePasses(user, limit, cursor);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('inspection.manage') @Post('inspection-templates')
  template(@Body() dto: CreateInspectionTemplateDto, @CurrentUser() user: AuthUser) { return this.operations.createTemplate(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','CASHIER') @Permissions('inspection.record') @Post('inspections')
  createInspection(@Body() dto: CreateInspectionDto, @CurrentUser() user: AuthUser) { return this.operations.createInspection(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','CASHIER') @Permissions('inspection.record') @Post('inspections/:id/evidence')
  addEvidence(@Param('id') id: string, @Body() dto: AddInspectionEvidenceDto, @CurrentUser() user: AuthUser) { return this.operations.addInspectionEvidence(id, dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','CASHIER') @Permissions('inspection.record') @Post('inspections/:id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteInspectionDto, @CurrentUser() user: AuthUser) { return this.operations.completeInspection(id, dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('inspection.approve') @Post('inspections/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveInspectionDto, @CurrentUser() user: AuthUser) { return this.operations.approveInspection(id, dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('gate_pass.manage') @Post('gate-passes')
  gatePass(@Body() dto: CreateGatePassDto, @CurrentUser() user: AuthUser) { return this.operations.createGatePass(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('gate_pass.approve') @Post('gate-passes/:id/approve')
  approveGate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.operations.approveGatePass(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('gate_pass.manage') @Post('gate-passes/:id/movement')
  moveGate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.operations.recordGateMovement(id, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','FINANCE') @Permissions('operations.confirm') @Post('confirmations')
  confirm(@Body() dto: ConfirmOperationDto, @CurrentUser() user: AuthUser) { return this.operations.confirmOperation(dto, user); }
}
