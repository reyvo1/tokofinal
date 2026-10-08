import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileOpsController } from './mobile-ops.controller';
import { MobileOpsService } from './mobile-ops.service';
import { TelegramCommandService } from './telegram-command.service';

// POST-1C — mobile stock-opname drafts, Telegram identity administration, and the Telegram command
// surface. TelegramCommandService is a provider rather than a controller: it has no route, because the
// transport (a polling loop in the worker) is not the API's business. Nothing may call it without a
// resolved platform identity, and it resolves one itself before every command.
@Module({
  imports: [PrismaModule],
  controllers: [MobileOpsController],
  providers: [MobileOpsService, TelegramCommandService],
  exports: [MobileOpsService, TelegramCommandService],
})
export class MobileOpsModule {}
