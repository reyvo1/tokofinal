import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/create-supplier.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
  export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING', 'WAREHOUSE')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.suppliers.list(user, companyId, search, limit, cursor, includeInactive);
  }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING', 'WAREHOUSE', 'FINANCE', 'AUDITOR')
  @Get(':id')
  @Permissions('supplier.view')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.suppliers.detail(id, user);
  }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING')
  @Post()
  @Permissions('supplier.create')
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.suppliers.create(dto, user);
  }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING')
  @Patch(':id')
  @Permissions('supplier.update')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.suppliers.update(id, dto, user);
  }
}
