import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { ConfirmReturnDto, CreatePurchaseReturnDto, CreateSaleReturnDto } from './dto/returns.dto';
import { ConfirmOrderReturnDto, RejectOrderReturnDto } from './dto/order-return.dto';
import { ReturnsService } from './returns.service';

@ApiTags('returns') @ApiBearerAuth() @Controller('returns')
  export class ReturnsController {
  constructor(private readonly service: ReturnsService) {}

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER','WAREHOUSE','FINANCE') @Permissions('sale.return') @Get('sales')
  saleReturns(@CurrentUser() user: AuthUser) { return this.service.listSaleReturns(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER') @Permissions('sale.return') @Post('sales')
  createSale(@Body() dto: CreateSaleReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.createSaleReturn(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE') @Permissions('sale.refund') @Post('sales/:id/confirm')
  confirmSale(@Param('id') id: string, @Body() dto: ConfirmReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.confirmSaleReturn(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','PURCHASING','WAREHOUSE','FINANCE') @Permissions('purchase.return') @Get('purchases')
  purchaseReturns(@CurrentUser() user: AuthUser) { return this.service.listPurchaseReturns(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','PURCHASING','WAREHOUSE') @Permissions('purchase.return') @Post('purchases')
  createPurchase(@Body() dto: CreatePurchaseReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.createPurchaseReturn(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','PURCHASING','WAREHOUSE','FINANCE') @Permissions('purchase.return') @Post('purchases/:id/confirm')
  confirmPurchase(@Param('id') id: string, @Body() dto: ConfirmReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.confirmPurchaseReturn(id, dto, user);
  }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','FINANCE') @Permissions('sale.return') @Get('orders')
  orderReturns(@CurrentUser() user: AuthUser) { return this.service.listOrderReturns(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('sale.return') @Post('orders/:id/inspection')
  startOrderReturnInspection(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.startOrderReturnInspection(id, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','FINANCE') @Permissions('sale.return') @Post('orders/:id/reject')
  rejectOrderReturn(@Param('id') id: string, @Body() dto: RejectOrderReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.rejectOrderReturn(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE') @Permissions('sale.refund') @Post('orders/:id/confirm')
  confirmOrderReturn(@Param('id') id: string, @Body() dto: ConfirmOrderReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.confirmOrderReturn(id, dto, user);
  }

}
