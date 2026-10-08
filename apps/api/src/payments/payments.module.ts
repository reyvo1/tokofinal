import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PlatformModule } from '../platform/platform.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PrismaModule, PlatformModule, OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
