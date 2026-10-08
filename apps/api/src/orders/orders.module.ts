import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { StorefrontCustomerModule } from '../storefront-customer/storefront-customer.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
@Module({ imports: [PrismaModule, AccountingCoreModule, StorefrontCustomerModule, PromotionsModule], controllers: [OrdersController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
