import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinanceOperationsController } from './finance-operations.controller';
import { FinanceOperationsService } from './finance-operations.service';
@Module({ imports: [PrismaModule, AccountingCoreModule], controllers: [FinanceOperationsController], providers: [FinanceOperationsService] })
export class FinanceOperationsModule {}
