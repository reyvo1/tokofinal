import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { ConfirmGoodsReceiptDto, CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { GoodsReceiptsService } from './goods-receipts.service';
@ApiTags('goods-receipts') @ApiBearerAuth() @Controller('goods-receipts')
  export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','FINANCE') @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) { return this.receipts.list(user, limit, cursor); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('purchase.receive') @Post()
  create(@Body() dto: CreateGoodsReceiptDto, @CurrentUser() user: AuthUser) { return this.receipts.create(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('goods_receipt.confirm') @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmGoodsReceiptDto, @CurrentUser() user: AuthUser) { return this.receipts.confirm(id, dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('goods_receipt.reject') @Post(':id/reject')
  reject(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser() user: AuthUser) { return this.receipts.reject(id, reason, user); }
}
