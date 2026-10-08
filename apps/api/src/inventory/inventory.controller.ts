import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { InventoryService } from './inventory.service';

@ApiTags('inventory') @ApiBearerAuth() @Controller('inventory')
  export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','CASHIER','FINANCE')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inventory.list(user, warehouseId, limit, cursor);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','FINANCE')
  @Get('movements')
  movements(
    @CurrentUser() user: AuthUser,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inventory.movements(user, productId, warehouseId, limit, cursor);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','PURCHASING','CASHIER')
  @Get('warehouses')
  warehouses(@CurrentUser() user: AuthUser) {
    return this.inventory.warehouses(user);
  }
}
