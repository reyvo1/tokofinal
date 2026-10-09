import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { DigitalServicesService } from './digital-services.service';
import { CreateDigitalServiceTransactionDto, VerifyDigitalServiceTaxDto } from './dto/digital-services.dto';

@ApiTags('digital-services')
@ApiBearerAuth()
@Controller('digital-services')
export class DigitalServicesController {
  constructor(private readonly services: DigitalServicesService) {}

  @Get('products') @Permissions('digital_service.view')
  products(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('category') category?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.services.products(user, search, category, limit, cursor);
  }

  @Patch('products/:id/tax-verification') @Roles('SUPER_ADMIN', 'OWNER', 'FINANCE') @Permissions('digital_service.manage')
  verifyTax(@Param('id') id: string, @Body() dto: VerifyDigitalServiceTaxDto, @CurrentUser() user: AuthUser) {
    return this.services.verifyTax(id, dto, user);
  }

  @Post('catalog/sync') @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN') @Permissions('digital_service.manage')
  syncCatalog(@CurrentUser() user: AuthUser) { return this.services.syncCatalog(user); }

  @Get('transactions') @Permissions('digital_service.view')
  transactions(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.services.transactions(user, status, limit, cursor);
  }

  @Post('transactions') @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'CASHIER') @Permissions('digital_service.manage')
  create(@Body() dto: CreateDigitalServiceTransactionDto, @CurrentUser() user: AuthUser) { return this.services.createTransaction(dto, user); }

  @Get('transactions/:id') @Permissions('digital_service.view')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.services.transaction(id, user); }

  @Post('transactions/:id/settle') @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'FINANCE') @Permissions('digital_service.manage')
  settle(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.services.settle(id, user); }

  @Post('transactions/:id/refund') @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'FINANCE') @Permissions('payment.refund')
  refund(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.services.refund(id, user); }

  @Post('transactions/:id/recheck') @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'CASHIER') @Permissions('digital_service.manage')
  recheck(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.services.recheck(id, user); }
}
