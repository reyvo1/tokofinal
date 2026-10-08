import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { DailyDigestService } from './daily-digest.service';
import { SaveDailyDigestConfigDto } from './dto/daily-digest.dto';

@ApiTags('reports') @ApiBearerAuth() @Controller()
export class DailyDigestController {
  constructor(private readonly digest: DailyDigestService) {}

  /** Lihat/ubah konfigurasi laporan harian otomatis (T360-20260825). */
  @Get('reports/daily-digest/config')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.digest.getConfigForUser(user);
  }

  @Post('reports/daily-digest/config')
  @Roles('SUPER_ADMIN','OWNER','ADMIN')
  @Permissions('notification.manage')
  saveConfig(@Body() dto: SaveDailyDigestConfigDto, @CurrentUser() user: AuthUser) {
    return this.digest.saveConfig(user, dto);
  }

  /** Preview teks laporan hari ini tanpa mengirim. */
  @Get('reports/daily-digest/preview')
  preview(@CurrentUser() user: AuthUser) {
    return this.digest.preview(user);
  }

  /** Masukkan laporan hari ini ke antrian notifikasi TELEGRAM. */
  @Post('reports/daily-digest/send')
  @Roles('SUPER_ADMIN','OWNER','ADMIN')
  @Permissions('notification.manage')
  send(@CurrentUser() user: AuthUser) {
    return this.digest.queueDailyDigest(user);
  }
}
