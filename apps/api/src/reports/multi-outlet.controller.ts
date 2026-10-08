import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { MultiOutletService } from './multi-outlet.service';

@ApiTags('reports') @ApiBearerAuth() @Controller()
export class MultiOutletController {
  constructor(private readonly service: MultiOutletService) {}

  /** T360-20260825 Fitur 4: ringkasan performa semua cabang dalam satu panggilan. */
  @Get('reports/multi-outlet')
  overview(@CurrentUser() user: AuthUser) {
    return this.service.overview(user);
  }
}
