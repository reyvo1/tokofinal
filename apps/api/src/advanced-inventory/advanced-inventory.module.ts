import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { AdvancedInventoryController } from './advanced-inventory.controller';
import { AdvancedInventoryService } from './advanced-inventory.service';
@Module({ imports: [AccountingCoreModule], controllers: [AdvancedInventoryController], providers: [AdvancedInventoryService] })
export class AdvancedInventoryModule {}
