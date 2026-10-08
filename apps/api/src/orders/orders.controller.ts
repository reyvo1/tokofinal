import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { CancelOrderDto, ConfirmOrderPaymentDto, CreateOrderDto, DispatchOrderDto, PayOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
  export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orders.list(user, limit, cursor);
  }

  @Public()
  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-order-access-token', required: true })
  @Get(':number')
  get(
    @Param('number') number: string,
    @Headers('x-branch-code') branchCode?: string,
    @Headers('x-order-access-token') accessToken?: string,
  ) {
    return this.orders.getByNumber(number, branchCode, accessToken);
  }

  @Public()
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Wajib bila idempotencyKey tidak dikirim di body; gunakan key yang sama saat retry.' })
  create(
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-customer-session') customerSession?: string,
  ) {
    return this.orders.create(dto, idempotencyKey, customerSession);
  }

  @Public()
  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-order-access-token', required: true })
  @Post(':number/payment-selection')
  selectPayment(
    @Param('number') number: string,
    @Body() dto: PayOrderDto,
    @Headers('x-branch-code') branchCode?: string,
    @Headers('x-order-access-token') accessToken?: string,
  ) {
    return this.orders.selectPayment(number, dto, branchCode, accessToken);
  }

  // Backward-compatible alias for clients from the earlier prototype. It no longer means "mark paid".
  @Public()
  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-order-access-token', required: true })
  @Post(':number/mock-pay')
  legacyPaymentSelection(
    @Param('number') number: string,
    @Body() dto: PayOrderDto,
    @Headers('x-branch-code') branchCode?: string,
    @Headers('x-order-access-token') accessToken?: string,
  ) {
    return this.orders.selectPayment(number, dto, branchCode, accessToken);
  }
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE')
  @Permissions('payment.manage')
  @Post(':id/confirm-payment')
  confirmPayment(@Param('id') id: string, @Body() dto: ConfirmOrderPaymentDto, @CurrentUser() user: AuthUser) {
    return this.orders.confirmPayment(id, dto, user);
  }

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE')
  @Permissions('payment.manage')
  @Post(':id/authorize-invoice')
  authorizeInvoice(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.authorizeInvoice(id, user);
  }

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE')
  @Permissions('shipment.manage')
  @Post(':id/pack')
  pack(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.pack(id, user);
  }

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE')
  @Permissions('shipment.manage')
  @Post(':id/ship')
  ship(@Param('id') id: string, @Body() dto: DispatchOrderDto, @CurrentUser() user: AuthUser) {
    return this.orders.ship(id, dto, user);
  }

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','FINANCE')
  @Permissions('order.cancel')
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto, @CurrentUser() user: AuthUser) {
    return this.orders.cancel(id, dto, user);
  }

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE')
  @Permissions('shipment.manage')
  @Post(':id/deliver')
  deliver(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.deliver(id, user);
  }

}
