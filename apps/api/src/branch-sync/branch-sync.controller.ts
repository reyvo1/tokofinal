import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { BranchSyncAuthGuard } from './branch-sync-auth.guard';
import { BranchSyncAuthService } from './branch-sync-auth.service';
import { BranchSyncService } from './branch-sync.service';
import {
  AdvanceAggregateVersionDto, BootstrapBranchDto, EnqueueSyncEventDto, NodeHeartbeatDto, PublishSyncEventsDto, PullSyncEventsDto,
  ReceiveSyncEventsDto, RecordSyncConflictDto, RecordSyncFailureDto, RegisterPeerDto, RegisterSyncNodeDto, ResolveSyncConflictDto, SetPeerActiveDto,
} from './dto/branch-sync.dto';

// POST-1A — edge topology and sync foundation.
//
// Every route is gated integration.manage, the same permission the existing device/integration
// surface uses: registering a branch node or a peer is a tenant-administration action, and a
// cashier must not be able to introduce a second authority that posts stock.
@ApiTags('branch-sync')
@ApiBearerAuth()
@Controller('branch-sync')
export class BranchSyncController {
  constructor(private readonly service: BranchSyncService, private readonly auth: BranchSyncAuthService) {}

  @Post('nodes')
  @Permissions('integration.manage')
  registerNode(@Body() dto: RegisterSyncNodeDto, @CurrentUser() user: AuthUser) {
    return this.service.registerNode(user, dto);
  }

  @Get('nodes')
  @Permissions('integration.manage')
  listNodes(@CurrentUser() user: AuthUser) {
    return this.service.listNodes(user);
  }

  @Post('nodes/:nodeId/heartbeat')
  @Permissions('integration.manage')
  heartbeat(@Param('nodeId') nodeId: string, @Body() dto: NodeHeartbeatDto, @CurrentUser() user: AuthUser) {
    return this.service.heartbeat(user, nodeId, dto);
  }

  @Post('nodes/:nodeId/peers')
  @Permissions('integration.manage')
  registerPeer(@Param('nodeId') nodeId: string, @Body() dto: RegisterPeerDto, @CurrentUser() user: AuthUser) {
    return this.service.registerPeer(user, nodeId, dto);
  }

  @Get('nodes/:nodeId/peers')
  @Permissions('integration.manage')
  listPeers(@Param('nodeId') nodeId: string, @CurrentUser() user: AuthUser) {
    return this.service.listPeers(user, nodeId);
  }

  @Patch('nodes/:nodeId/peers/:peerId')
  @Permissions('integration.manage')
  setPeerActive(@Param('nodeId') nodeId: string, @Param('peerId') peerId: string, @Body() dto: SetPeerActiveDto, @CurrentUser() user: AuthUser) {
    return this.service.setPeerActive(user, nodeId, peerId, dto);
  }

  @Post('nodes/:nodeId/events')
  @Permissions('integration.manage')
  enqueueEvent(@Param('nodeId') nodeId: string, @Body() dto: EnqueueSyncEventDto, @CurrentUser() user: AuthUser) {
    return this.service.enqueueEvent(user, nodeId, dto);
  }

  // These three are the node-to-node wire. They are @Public() because a branch server authenticates
  // with an HMAC peer signature, not an operator JWT, and it has no user session to present. When a
  // signature is present it is verified and the tenant comes from the signature — never from the
  // path. When it is absent the route still requires integration.manage, so an operator session is
  // a valid alternative. The two paths cannot be mixed.
  @Post('nodes/:nodeId/pull')
  @Public()
  @UseGuards(BranchSyncAuthGuard)
  pullEvents(
    @Param('nodeId') nodeId: string, @Body() dto: PullSyncEventsDto,
    @CurrentUser() user: AuthUser, @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.pullEvents(user, nodeId, dto, this.auth, headers);
  }

  @Post('nodes/:nodeId/publish')
  @Public()
  @UseGuards(BranchSyncAuthGuard)
  publishEvents(
    @Param('nodeId') nodeId: string, @Body() dto: PublishSyncEventsDto,
    @CurrentUser() user: AuthUser, @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.publishEvents(user, nodeId, dto, this.auth, headers);
  }

  @Post('nodes/:nodeId/receive')
  @Public()
  @UseGuards(BranchSyncAuthGuard)
  receiveEvents(
    @Param('nodeId') nodeId: string, @Body() dto: ReceiveSyncEventsDto,
    @CurrentUser() user: AuthUser, @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.receiveEvents(user, nodeId, dto.peerNodeId, dto.events ?? [], this.auth, headers);
  }

  @Get('health')
  @Permissions('integration.manage')
  health(@CurrentUser() user: AuthUser) {
    return this.service.syncHealth(user);
  }

  @Get('nodes/:nodeId/dead-letters')
  @Permissions('integration.manage')
  deadLetters(@Param('nodeId') nodeId: string, @CurrentUser() user: AuthUser) {
    return this.service.listDeadLetters(user, nodeId);
  }

  @Post('nodes/:nodeId/dead-letters/:eventId/requeue')
  @Permissions('integration.manage')
  requeue(@Param('nodeId') nodeId: string, @Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.service.requeueDeadLetter(user, nodeId, eventId);
  }

  @Post('nodes/:nodeId/failures')
  @Permissions('integration.manage')
  recordFailure(@Param('nodeId') nodeId: string, @Body() dto: RecordSyncFailureDto, @CurrentUser() user: AuthUser) {
    return this.service.recordFailure(user, nodeId, dto.eventId, dto.error);
  }

  @Post('nodes/:nodeId/aggregates/:aggregateType/:aggregateId/version')
  @Permissions('integration.manage')
  advanceVersion(@Param('nodeId') nodeId: string, @Param('aggregateType') aggregateType: string, @Param('aggregateId') aggregateId: string, @Body() dto: AdvanceAggregateVersionDto, @CurrentUser() user: AuthUser) {
    return this.service.advanceVersion(user, nodeId, aggregateType, aggregateId, dto.version);
  }

  @Get('nodes/:nodeId/conflicts')
  @Permissions('integration.manage')
  listConflicts(@Param('nodeId') nodeId: string, @CurrentUser() user: AuthUser) {
    return this.service.listConflicts(user, nodeId);
  }

  @Post('nodes/:nodeId/conflicts/:eventId')
  @Permissions('integration.manage')
  recordConflict(@Param('nodeId') nodeId: string, @Param('eventId') eventId: string, @Body() dto: RecordSyncConflictDto, @CurrentUser() user: AuthUser) {
    return this.service.recordConflict(user, nodeId, eventId, dto.remoteVersion ?? null);
  }

  @Post('nodes/:nodeId/conflicts/:eventId/resolve')
  @Permissions('integration.manage')
  resolveConflict(@Param('nodeId') nodeId: string, @Param('eventId') eventId: string, @Body() dto: ResolveSyncConflictDto, @CurrentUser() user: AuthUser) {
    return this.service.resolveConflict(user, nodeId, eventId, dto.strategy, dto.note);
  }

  @Get('nodes/:nodeId/recovery-plan')
  @Permissions('integration.manage')
  recoveryPlan(@Param('nodeId') nodeId: string, @CurrentUser() user: AuthUser) {
    return this.service.recoveryPlan(user, nodeId);
  }

  @Post('nodes/:nodeId/bootstrap')
  @Permissions('integration.manage')
  bootstrap(@Param('nodeId') nodeId: string, @Body() dto: BootstrapBranchDto, @CurrentUser() user: AuthUser) {
    return this.service.bootstrapBranch(user, nodeId, dto);
  }
}
