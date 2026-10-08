import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { BranchTransferService } from './branch-transfer.service';
import { AbandonBranchTransferDto, AcknowledgeTransferArrivalDto } from './dto/branch-continuity.dto';

// POST-1B — offline inter-branch transfer tracking.
//
// Deliberately NOT @Public(): acknowledging that goods arrived is a tenant-administration action, and
// a branch that could acknowledge another's stock would make the transfer ledger meaningless.
//
// Permission note, recorded because it is a real trade-off rather than a detail. These routes are
// gated on `integration.manage`, not `inventory.transfer`, because the operator surface lives in the
// settings workspace whose gate grants `integration.manage`. The alternative — widening the settings
// gate to `inventory.transfer` — would hand every settings operator inventory write access across the
// whole product, which is far worse.
//
// What `integration.manage` can and cannot do here: it can see and record the acknowledgement, and
// abandon a leg with a reason. It still CANNOT move stock. Posting inventory stays behind
// receiveTransfer under `inventory.transfer`, and the service contains no inventory write at all — a
// test asserts that. So the wider permission buys visibility and an audited status change, not a
// posting.
@ApiTags('branch-transfer')
@ApiBearerAuth()
@Controller('branch-transfer')
export class BranchTransferController {
  constructor(private readonly service: BranchTransferService) {}

  @Post('transfers/:transferId/departure')
  @Permissions('integration.manage')
  registerDeparture(@Param('transferId') transferId: string, @CurrentUser() user: AuthUser) {
    return this.service.registerDeparture(user, transferId);
  }

  @Post('transfers/:transferId/arrival')
  @Permissions('integration.manage')
  acknowledgeArrival(@Param('transferId') transferId: string, @Body() dto: AcknowledgeTransferArrivalDto, @CurrentUser() user: AuthUser) {
    return this.service.acknowledgeArrival(user, transferId, dto);
  }

  @Get('pending')
  @Permissions('integration.manage')
  pending(@CurrentUser() user: AuthUser) {
    return this.service.pendingWithConnectivity(user);
  }

  @Get('transfers/:transferId')
  @Permissions('integration.manage')
  state(@Param('transferId') transferId: string, @CurrentUser() user: AuthUser) {
    return this.service.transferSyncState(user, transferId);
  }

  @Post('transfers/:transferId/abandon')
  @Permissions('integration.manage')
  abandon(@Param('transferId') transferId: string, @Body() dto: AbandonBranchTransferDto, @CurrentUser() user: AuthUser) {
    return this.service.abandon(user, transferId, dto.reason);
  }
}
