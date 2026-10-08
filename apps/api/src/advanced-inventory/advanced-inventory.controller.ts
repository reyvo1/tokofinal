import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { AdvancedInventoryService } from './advanced-inventory.service';
import { CountStockOpnameDto, CreateStockOpnameDto, CreateStockTransferDto, MoveInventoryConditionDto, ReceiveStockTransferDto, RelocateInventoryDto } from './dto/advanced-inventory.dto';

@ApiTags('advanced-inventory') @ApiBearerAuth() @Controller('advanced-inventory')
  export class AdvancedInventoryController {
  constructor(private readonly service: AdvancedInventoryService) {}

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Get('stock-transfers')
  transfers(@CurrentUser() user: AuthUser) { return this.service.listTransfers(user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Get('transit-balances')
  @Permissions('inventory.view')
  transitBalances(@CurrentUser() user: AuthUser) { return this.service.listTransitBalances(user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Get('reorder-visibility')
  @Permissions('inventory.view')
  reorderVisibility(@CurrentUser() user: AuthUser) { return this.service.listReorderVisibility(user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Post('stock-transfers')
  @Permissions('inventory.transfer')
  createTransfer(@Body() dto: CreateStockTransferDto, @CurrentUser() user: AuthUser) { return this.service.createTransfer(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Patch('stock-transfers/:id/approve')
  @Permissions('inventory.transfer')
  approveTransfer(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.approveTransfer(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Patch('stock-transfers/:id/ship')
  @Permissions('inventory.transfer')
  shipTransfer(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.shipTransfer(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Patch('stock-transfers/:id/receive')
  @Permissions('inventory.transfer')
  receiveTransfer(@Param('id') id: string, @Body() dto: ReceiveStockTransferDto, @CurrentUser() user: AuthUser) { return this.service.receiveTransfer(id, dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Get('location-balances')
  locationBalances(@CurrentUser() user: AuthUser, @Query('warehouseId') warehouseId: string, @Query('productId') productId?: string) { return this.service.listLocationBalances(user, warehouseId, productId); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Post('location-relocations')
  @Permissions('inventory.transfer')
  relocate(@Body() dto: RelocateInventoryDto, @CurrentUser() user: AuthUser) { return this.service.relocateLocation(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Get('condition-balances')
  @Permissions('inventory.view')
  conditionBalances(@CurrentUser() user: AuthUser, @Query('warehouseId') warehouseId: string, @Query('productId') productId: string) { return this.service.listConditionBalances(user, warehouseId, productId); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Post('condition-movements')
  @Permissions('inventory.adjust')
  moveCondition(@Body() dto: MoveInventoryConditionDto, @CurrentUser() user: AuthUser) { return this.service.moveCondition(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Get('stock-opnames')
  opnames(@CurrentUser() user: AuthUser) { return this.service.listOpnames(user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Post('stock-opnames')
  @Permissions('inventory.opname')
  createOpname(@Body() dto: CreateStockOpnameDto, @CurrentUser() user: AuthUser) { return this.service.createOpname(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Patch('stock-opnames/:id/count')
  @Permissions('inventory.opname')
  countOpname(@Param('id') id: string, @Body() dto: CountStockOpnameDto, @CurrentUser() user: AuthUser) { return this.service.countOpname(id, dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Patch('stock-opnames/:id/submit')
  @Permissions('inventory.opname')
  submitOpname(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.submitOpname(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Patch('stock-opnames/:id/complete')
  @Permissions('inventory.opname')
  completeOpname(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.completeOpname(id, user); }
}
