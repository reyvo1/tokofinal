import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';

// POST-1D. A module of one read. It imports PrismaModule and nothing else on purpose: it calls the
// canonical price resolver rather than owning one, and it deliberately does not import the sales,
// inventory or promotions services, because a kiosk that could call those could also grow into
// something that mutates them.
@Module({
  imports: [PrismaModule],
  controllers: [KioskController],
  providers: [KioskService],
  exports: [KioskService],
})
export class KioskModule {}
