import { Body, Controller, Param, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { CashierCashMovementDto, CloseCashierShiftDto, CreateSaleDto, OpenCashierShiftDto, ReplayOfflineSalesDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';

@ApiTags('sales') @ApiBearerAuth() @Controller('sales')
  export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER','FINANCE')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.sales.list(user, limit, cursor);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Get('shifts/current')
  @Permissions('sale.view')
  currentShift(@CurrentUser() user: AuthUser) {
    return this.sales.currentShift(user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Post('shifts/open')
  @Permissions('sale.create')
  openShift(@Body() dto: OpenCashierShiftDto, @CurrentUser() user: AuthUser) {
    return this.sales.openShift(user, dto.openingCash);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Post('shifts/close')
  @Permissions('sale.create')
  closeShift(@Body() dto: CloseCashierShiftDto, @CurrentUser() user: AuthUser) {
    // The grant travels with the request rather than being fetched by the server: it is
    // single-use and scoped to this operator, so anything else would let one approval close
    // several shifts.
    return this.sales.closeShift(user, dto.closingCash, dto.supervisorApprovalId);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER','FINANCE')
  @Get('shifts/:id/recap')
  @Permissions('sale.view')
  shiftRecap(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sales.shiftRecap(user, id);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Get('shifts/cash-movements/current')
  @Permissions('sale.view')
  cashMovements(@CurrentUser() user: AuthUser) {
    return this.sales.currentCashMovements(user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Post('shifts/cash-movements')
  @Permissions('sale.create')
  cashMovement(@Body() dto: CashierCashMovementDto, @CurrentUser() user: AuthUser) {
    return this.sales.recordCashMovement(user, dto, dto.supervisorApprovalId);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Post('quote')
  @Permissions('sale.view')
  quote(@Body() dto: CreateSaleDto, @CurrentUser() user: AuthUser) {
    return this.sales.quote(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Get('offline/config')
  @Permissions('sale.view')
  offlineConfig(@CurrentUser() user: AuthUser) {
    return this.sales.offlineConfig(user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Post('offline/replay')
  @Permissions('sale.create')
  replayOffline(@Body() dto: ReplayOfflineSalesDto, @CurrentUser() user: AuthUser) {
    return this.sales.replayOfflineSales(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER')
  @Post()
  @Permissions('sale.create')
  create(@Body() dto: CreateSaleDto, @CurrentUser() user: AuthUser) {
    return this.sales.create(dto, user);
  }
}
