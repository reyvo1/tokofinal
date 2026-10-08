import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { ConvertPurchaseRequestDto, CreatePurchaseRequestDto, DecidePurchaseRequestDto, SubmitPurchaseRequestDto } from './dto/purchase-request.dto';
import { PurchaseRequestsService } from './purchase-requests.service';

@ApiTags('purchase-requests')
@ApiBearerAuth()
@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(private readonly requests: PurchaseRequestsService) {}

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING', 'WAREHOUSE', 'FINANCE')
  @Permissions('purchase.view')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) { return this.requests.list(user, status); }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING', 'WAREHOUSE', 'FINANCE')
  @Permissions('purchase.view')
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.requests.findOne(id, user); }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING')
  @Permissions('purchase.create')
  @Post()
  create(@Body() dto: CreatePurchaseRequestDto, @CurrentUser() user: AuthUser) { return this.requests.create(dto, user); }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING')
  @Permissions('purchase.create')
  @Post(':id/submit')
  submit(@Param('id') id: string, @Body() dto: SubmitPurchaseRequestDto, @CurrentUser() user: AuthUser) { return this.requests.submit(id, dto, user); }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING')
  @Permissions('purchase.approve')
  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: DecidePurchaseRequestDto, @CurrentUser() user: AuthUser) { return this.requests.decide(id, dto, user); }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING')
  @Permissions('purchase.create')
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.requests.cancel(id, user); }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING')
  @Permissions('purchase.create')
  @Post(':id/convert')
  convert(@Param('id') id: string, @Body() dto: ConvertPurchaseRequestDto, @CurrentUser() user: AuthUser) { return this.requests.convert(id, dto, user); }
}
