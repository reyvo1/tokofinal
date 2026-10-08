import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { CreatePromoRuleDto, UpdatePromoRuleDto } from './dto/promotions.dto';
import { PromotionsService } from './promotions.service';

@ApiTags('promotions') @ApiBearerAuth() @Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.promotions.list(user, limit);
  }

  @Get('preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Query('subtotal') subtotal?: string,
    @Query('code') code?: string,
    @Query('memberTier') memberTier?: string,
  ) {
    return this.promotions.preview(user, subtotal ? Number(subtotal) : 0, code, memberTier);
  }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN') @Permissions('promotion.manage') @Post()
  create(@Body() dto: CreatePromoRuleDto, @CurrentUser() user: AuthUser) {
    return this.promotions.create(dto, user);
  }

  @Roles('SUPER_ADMIN', 'OWNER', 'ADMIN') @Permissions('promotion.manage') @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePromoRuleDto, @CurrentUser() user: AuthUser) {
    return this.promotions.update(id, dto, user);
  }
}
