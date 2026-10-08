import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { KioskService } from './kiosk.service';

// POST-1D — the LAN barcode price checker.
//
// One GET, and that is the entire attack surface. There is no POST, PATCH or DELETE here on purpose:
// "no Admin or POS mutation capabilities" is far easier to keep true by having nowhere to put them than
// by auditing a set of write methods for restraint. `@Permissions('kiosk.price.read')` is the second
// half of the control — an API key carrying any other scope is refused by PermissionsGuard before this
// handler is ever reached.
@ApiTags('kiosk')
@ApiBearerAuth()
@Controller('kiosk')
export class KioskController {
  constructor(private readonly service: KioskService) {}

  @Get('price')
  @Permissions('kiosk.price.read')
  price(@CurrentUser() user: AuthUser, @Query('code') code: string) {
    return this.service.lookup(user, code);
  }
}
