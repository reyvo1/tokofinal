import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OperationsControlController } from './operations-control.controller';
import { OperationsControlService } from './operations-control.service';
@Module({ imports: [PrismaModule], controllers: [OperationsControlController], providers: [OperationsControlService], exports: [OperationsControlService] })
export class OperationsControlModule {}
