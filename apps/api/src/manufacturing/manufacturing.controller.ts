import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { CancelProductionOrderDto, CompleteProductionOrderDto, CreateProductionOrderDto, CreateProductionRecipeDto } from './dto/manufacturing.dto';
import { ManufacturingService } from './manufacturing.service';

@ApiTags('manufacturing')
@ApiBearerAuth()
@Controller('manufacturing')
export class ManufacturingController {
  constructor(private readonly manufacturing: ManufacturingService) {}

  @Get('recipes')
  @Permissions('manufacturing.view')
  recipes(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.manufacturing.listRecipes(user, search, limit, cursor);
  }

  @Post('recipes')
  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE')
  @Permissions('manufacturing.manage')
  createRecipe(@Body() dto: CreateProductionRecipeDto, @CurrentUser() user: AuthUser) {
    return this.manufacturing.createRecipe(dto, user);
  }

  @Get('orders')
  @Permissions('manufacturing.view')
  orders(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.manufacturing.listOrders(user, status, limit, cursor);
  }

  @Post('orders')
  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE')
  @Permissions('manufacturing.manage')
  createOrder(@Body() dto: CreateProductionOrderDto, @CurrentUser() user: AuthUser) {
    return this.manufacturing.createOrder(dto, user);
  }

  @Post('orders/:id/release')
  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE')
  @Permissions('manufacturing.manage')
  release(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.manufacturing.release(id, user); }

  @Post('orders/:id/start')
  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE')
  @Permissions('manufacturing.manage')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.manufacturing.start(id, user); }

  @Post('orders/:id/complete')
  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE')
  @Permissions('manufacturing.manage')
  complete(@Param('id') id: string, @Body() dto: CompleteProductionOrderDto, @CurrentUser() user: AuthUser) { return this.manufacturing.complete(id, dto, user); }

  @Post('orders/:id/cancel')
  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE')
  @Permissions('manufacturing.manage')
  cancel(@Param('id') id: string, @Body() dto: CancelProductionOrderDto, @CurrentUser() user: AuthUser) { return this.manufacturing.cancel(id, dto.reason, user); }
}
