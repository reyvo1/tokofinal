import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
@Module({ imports: [PrismaModule, AccountingCoreModule], controllers: [PayrollController], providers: [PayrollService], exports: [PayrollService] })
export class PayrollModule {}
