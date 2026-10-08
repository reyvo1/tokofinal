import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { OperationsControlModule } from '../operations-control/operations-control.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
@Module({ imports: [PrismaModule, AccountingCoreModule, OperationsControlModule], controllers: [GoodsReceiptsController], providers: [GoodsReceiptsService] })
export class GoodsReceiptsModule {}
