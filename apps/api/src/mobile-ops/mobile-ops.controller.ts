import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import {
  AddMobileScanDto,
  BindMobileIdentityDto,
  DiscardMobileDraftDto,
  ListMobileBindingsQueryDto,
  ListMobileDraftsQueryDto,
  OpenMobileDraftDto,
  RevokeMobileIdentityDto,
  SubmitMobileDraftDto,
} from './dto/mobile-ops.dto';
import { MobileOpsService } from './mobile-ops.service';

@ApiTags('mobile-ops')
@ApiBearerAuth()
@Controller('mobile-ops')
export class MobileOpsController {
  constructor(private readonly service: MobileOpsService) {}

  @Get('telegram/bindings')
  @Permissions('user.manage')
  listBindings(@CurrentUser() user: AuthUser, @Query() query: ListMobileBindingsQueryDto) {
    return this.service.listBindings(user, query.limit, query.cursor);
  }

  @Post('telegram/bindings')
  @Permissions('user.manage')
  bind(@Body() dto: BindMobileIdentityDto, @CurrentUser() user: AuthUser) {
    return this.service.bindIdentity(user, dto);
  }

  @Put('telegram/bindings/revoke')
  @Permissions('user.manage')
  revoke(@Body() dto: RevokeMobileIdentityDto, @CurrentUser() user: AuthUser) {
    return this.service.revokeBinding(user, dto.bindingId, dto.reason);
  }

  @Get('drafts')
  @Permissions('inventory.opname')
  listDrafts(@CurrentUser() user: AuthUser, @Query() query: ListMobileDraftsQueryDto) {
    return this.service.listDrafts(user, query.status, query.warehouseId, query.limit, query.cursor);
  }

  @Post('drafts/open')
  @Permissions('inventory.opname')
  openDraft(@Body() dto: OpenMobileDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.openDraft(user, dto);
  }

  @Post('drafts/:draftId/scan')
  @Permissions('inventory.opname')
  addScan(@Param('draftId') draftId: string, @Body() dto: AddMobileScanDto, @CurrentUser() user: AuthUser) {
    return this.service.addScan(user, draftId, dto);
  }

  @Get('drafts/:draftId')
  @Permissions('inventory.opname')
  getDraft(@Param('draftId') draftId: string, @CurrentUser() user: AuthUser) {
    return this.service.getDraft(user, draftId);
  }

  @Get('drafts/:draftId/discrepancy')
  @Permissions('inventory.opname')
  discrepancy(@Param('draftId') draftId: string, @CurrentUser() user: AuthUser) {
    return this.service.reviewDiscrepancy(user, draftId);
  }

  @Post('drafts/:draftId/submit')
  @Permissions('inventory.opname')
  submit(@Param('draftId') draftId: string, @Body() dto: SubmitMobileDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.submitDraft(user, draftId, dto.opnameId);
  }

  @Post('drafts/:draftId/discard')
  @Permissions('inventory.opname')
  discard(@Param('draftId') draftId: string, @Body() dto: DiscardMobileDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.discardDraft(user, draftId, dto.reason);
  }
}
