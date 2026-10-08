import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { CrossBranchStockController } from './cross-branch-stock.controller';
// CrossBranchStockController injects PrismaService directly, so PrismaModule is imported here —
// InventoryService reaches the database through its own module, which does not re-export Prisma.
@Module({ imports: [PrismaModule], controllers: [InventoryController, CrossBranchStockController], providers: [InventoryService] })
export class InventoryModule {}
