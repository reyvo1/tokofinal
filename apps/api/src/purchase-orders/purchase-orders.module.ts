import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';

@Module({
  imports: [PlatformModule],
  controllers: [PurchaseOrdersController, PurchaseRequestsController],
  providers: [PurchaseOrdersService, PurchaseRequestsService],
  exports: [PurchaseOrdersService, PurchaseRequestsService],
})
export class PurchaseOrdersModule {}
