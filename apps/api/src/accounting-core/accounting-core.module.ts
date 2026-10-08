import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingCoreController } from './accounting-core.controller';
import { AccountingCoreService } from './accounting-core.service';

@Module({ imports: [PrismaModule], controllers: [AccountingCoreController], providers: [AccountingCoreService], exports: [AccountingCoreService] })
export class AccountingCoreModule {}
