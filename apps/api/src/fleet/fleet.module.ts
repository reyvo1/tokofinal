import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';
@Module({ imports: [PrismaModule, AccountingCoreModule], controllers: [FleetController], providers: [FleetService] })
export class FleetModule {}
