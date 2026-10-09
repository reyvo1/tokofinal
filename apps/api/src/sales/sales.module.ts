import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SupervisorApprovalModule } from '../supervisor-approval/supervisor-approval.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { CashierTargetController } from './cashier-target.controller';
import { CashierTargetService } from './cashier-target.service';
import { StockAlertService } from './stock-alert.service';
import { ReceiptController } from './receipt.controller';
@Module({
  imports: [PrismaModule, AccountingCoreModule, PromotionsModule, SupervisorApprovalModule],
  controllers: [SalesController, CashierTargetController, ReceiptController],
  providers: [SalesService, CashierTargetService, StockAlertService],
  exports: [SalesService],
})
export class SalesModule {}
