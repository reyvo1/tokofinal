import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';
import { Roles } from './roles.decorator';
import { Permissions } from './permissions.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@ApiTags('api-keys') @ApiBearerAuth() @Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Get() @Permissions('api_key.view') list(@CurrentUser() user: AuthUser) { return this.service.list(user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post() @Permissions('api_key.manage') create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Patch(':id/revoke') @Permissions('api_key.manage') revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.revoke(id, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Post(':id/rotate') @Permissions('api_key.manage') rotate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.rotate(id, user); }
}
