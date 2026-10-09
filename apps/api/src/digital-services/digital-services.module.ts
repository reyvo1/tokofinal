import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { SalesModule } from '../sales/sales.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DigitalServicesController } from './digital-services.controller';
import { DigitalServicesService } from './digital-services.service';

@Module({ imports: [PrismaModule, AccountingCoreModule, SalesModule], controllers: [DigitalServicesController], providers: [DigitalServicesService] })
export class DigitalServicesModule {}
