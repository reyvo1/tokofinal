import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { BranchContinuityService } from './branch-continuity.service';
import { DeclareContinuityCapabilityDto, MarkReadWatermarkDto, RecordBackupMetadataDto, RejoinBranchDto, ReportConnectivityDto, SetNodePolicyDto, VerifyRestoreChecksumDto } from './dto/branch-continuity.dto';

// POST-1B — local-first branch continuity.
//
// Everything here is tenant administration: declaring which flows may run disconnected, reporting a
// branch as offline, and re-registering a replaced server. None of it may be reachable by a cashier,
// because a cashier who can mark their own branch ONLINE — or widen their own offline permission —
// can quietly trade on data the rest of the company cannot see.
@ApiTags('branch-continuity')
@ApiBearerAuth()
@Controller('branch-continuity')
export class BranchContinuityController {
  constructor(private readonly service: BranchContinuityService) {}

  @Get('capabilities')
  @Permissions('integration.manage')
  listCapabilities(@CurrentUser() user: AuthUser) {
    return this.service.listCapabilities(user);
  }

  @Put('capabilities')
  @Permissions('integration.manage')
  declareCapability(@Body() dto: DeclareContinuityCapabilityDto, @CurrentUser() user: AuthUser) {
    return this.service.declareCapability(user, dto);
  }

  @Get('nodes/:nodeId/policy/:flowCode')
  @Permissions('integration.manage')
  effectivePolicy(@Param('nodeId') nodeId: string, @Param('flowCode') flowCode: string, @CurrentUser() user: AuthUser) {
    return this.service.effectivePolicy(user, nodeId, flowCode);
  }

  @Put('nodes/:nodeId/policy')
  @Permissions('integration.manage')
  setNodePolicy(@Param('nodeId') nodeId: string, @Body() dto: SetNodePolicyDto, @CurrentUser() user: AuthUser) {
    return this.service.setNodePolicy(user, nodeId, dto);
  }

  // The gate a POS/inventory call must consult before serving a write from a disconnected branch.
  @Get('nodes/:nodeId/permit/:flowCode')
  @Permissions('integration.manage')
  permit(@Param('nodeId') nodeId: string, @Param('flowCode') flowCode: string, @CurrentUser() user: AuthUser) {
    return this.service.assertMayProceed(user, nodeId, flowCode);
  }

  @Get('nodes/:nodeId/read-authority/:resource')
  @Permissions('integration.manage')
  readAuthority(@Param('nodeId') nodeId: string, @Param('resource') resource: string, @CurrentUser() user: AuthUser) {
    return this.service.readWithAuthority(user, nodeId, resource);
  }

  @Post('nodes/:nodeId/read-watermark')
  @Permissions('integration.manage')
  markSynced(@Param('nodeId') nodeId: string, @Body() dto: MarkReadWatermarkDto, @CurrentUser() user: AuthUser) {
    return this.service.markSynced(user, nodeId, dto);
  }

  @Get('nodes/:nodeId/connectivity')
  @Permissions('integration.manage')
  connectivity(@Param('nodeId') nodeId: string, @CurrentUser() user: AuthUser) {
    return this.service.connectionState(user, nodeId);
  }

  @Put('connectivity')
  @Permissions('integration.manage')
  reportConnectivity(@Body() dto: ReportConnectivityDto, @CurrentUser() user: AuthUser) {
    return this.service.reportConnectivity(user, dto);
  }

  @Get('consolidated')
  @Permissions('integration.manage')
  consolidated(@CurrentUser() user: AuthUser) {
    return this.service.consolidatedStatus(user);
  }

  // LAN discovery for approved clients. Narrow on purpose: node code, role, reachability and the
  // endpoint. No inventory, no price, no business data of any kind.
  @Get('discover')
  @Permissions('integration.manage')
  discover(@CurrentUser() user: AuthUser) {
    return this.service.discover(user);
  }

  @Post('backups')
  @Permissions('integration.manage')
  recordBackup(@Body() dto: RecordBackupMetadataDto, @CurrentUser() user: AuthUser) {
    return this.service.recordBackupMetadata(user, dto);
  }

  @Get('backups')
  @Permissions('integration.manage')
  listBackups(@CurrentUser() user: AuthUser) {
    return this.service.listBackupMetadata(user);
  }

  @Post('backups/verify-restore')
  @Permissions('integration.manage')
  verifyRestore(@Body() dto: VerifyRestoreChecksumDto, @CurrentUser() user: AuthUser) {
    return this.service.verifyRestoreChecksum(user, dto);
  }

  @Post('rejoin')
  @Permissions('integration.manage')
  rejoin(@Body() dto: RejoinBranchDto, @CurrentUser() user: AuthUser) {
    return this.service.rejoinBranch(user, dto);
  }
}
