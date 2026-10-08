import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { CashierTargetService } from './cashier-target.service';
import { SaveCashierTargetsDto } from './dto/cashier-target.dto';

@ApiTags('sales') @ApiBearerAuth() @Controller()
export class CashierTargetController {
  constructor(private readonly service: CashierTargetService) {}

  /** T360-20260825 Fitur 5: progres target kasir hari ini. */
  @Get('sales/cashier-targets')
  progress(@CurrentUser() user: AuthUser) {
    return this.service.progress(user);
  }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN')
  @Post('sales/cashier-targets')
  save(@Body() dto: SaveCashierTargetsDto, @CurrentUser() user: AuthUser) {
    return this.service.saveTargets(user, dto?.targets ?? {});
  }
}
