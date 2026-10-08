import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { AssetsService } from './assets.service';
import { AssignAssetDto, CompleteMaintenanceDto, CreateAssetCategoryDto, CreateAssetDto, CreateAssetMaintenancePlanDto, CreateMaintenanceWorkOrderDto, DisposeAssetDto, RunDepreciationDto, TransferAssetDto, UpdateAssetMaintenancePlanDto } from './dto/assets.dto';

@ApiTags('assets') @ApiBearerAuth() @Controller('assets')
  export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','AUDITOR') @Permissions('asset.view') @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.assets.list(user, companyId, branchId); }


  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','AUDITOR') @Permissions('asset.view') @Get('summary')
  summary(@CurrentUser() user: AuthUser) { return this.assets.summary(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE','AUDITOR') @Permissions('asset.view') @Get('maintenances')
  maintenances(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.assets.listMaintenances(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE','AUDITOR') @Permissions('asset.view') @Get('maintenance-plans')
  maintenancePlans(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.assets.listMaintenancePlans(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('asset.maintenance') @Post('maintenance-plans')
  createMaintenancePlan(@Body() dto: CreateAssetMaintenancePlanDto, @CurrentUser() user: AuthUser) {
    return this.assets.createMaintenancePlan(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('asset.maintenance') @Post('maintenance-plans/:id/update')
  updateMaintenancePlan(@Param('id') id: string, @Body() dto: UpdateAssetMaintenancePlanDto, @CurrentUser() user: AuthUser) {
    return this.assets.updateMaintenancePlan(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE') @Permissions('asset.view') @Get('categories')
  categories(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.assets.categories(user, companyId);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE') @Permissions('asset.manage') @Post('categories')
  createCategory(@Body() dto: CreateAssetCategoryDto, @CurrentUser() user: AuthUser) {
    return this.assets.createCategory(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE') @Permissions('asset.acquire') @Post()
  acquire(@Body() dto: CreateAssetDto, @CurrentUser() user: AuthUser) { return this.assets.acquire(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('asset.assign') @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.assign(id, dto, user);
  }


  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('asset.assign') @Post(':id/transfer')
  transfer(@Param('id') id: string, @Body() dto: TransferAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.transfer(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('asset.acquire') @Post(':id/dispose')
  dispose(@Param('id') id: string, @Body() dto: DisposeAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.dispose(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('asset.maintenance') @Post('maintenance')
  maintenance(@Body() dto: CreateMaintenanceWorkOrderDto, @CurrentUser() user: AuthUser) {
    return this.assets.createMaintenance(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE') @Permissions('asset.maintenance') @Post('maintenance/:id/complete')
  completeMaintenance(@Param('id') id: string, @Body() dto: CompleteMaintenanceDto, @CurrentUser() user: AuthUser) {
    return this.assets.completeMaintenance(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','FINANCE') @Permissions('asset.depreciate') @Post('depreciation-runs')
  depreciation(@Body() dto: RunDepreciationDto, @CurrentUser() user: AuthUser) {
    return this.assets.runDepreciation(dto, user);
  }
}
