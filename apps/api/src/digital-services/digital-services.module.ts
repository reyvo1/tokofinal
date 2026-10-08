import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DigitalServicesController } from './digital-services.controller';
import { DigitalServicesService } from './digital-services.service';

@Module({ imports: [PrismaModule], controllers: [DigitalServicesController], providers: [DigitalServicesService] })
export class DigitalServicesModule {}
