import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { DailyDigestController } from './daily-digest.controller';
import { DailyDigestService } from './daily-digest.service';
import { MultiOutletController } from './multi-outlet.controller';
import { MultiOutletService } from './multi-outlet.service';
@Module({
  controllers: [ReportsController, DailyDigestController, MultiOutletController],
  providers: [ReportsService, DailyDigestService, MultiOutletService],
})
export class ReportsModule {}
