import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateRoleDto, SetRolePermissionsDto, SetUserRolesDto, SetUserStatusDto } from './dto/manage-access.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles('SUPER_ADMIN', 'OWNER', 'ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) { return this.users.list(user); }

  @Get('roles')
  roles(@CurrentUser() user: AuthUser) { return this.users.roles(user); }

  @Get('permissions')
  permissions(@CurrentUser() user: AuthUser) { return this.users.permissions(user); }

  @Roles('SUPER_ADMIN')
  @Permissions('role.manage')
  @Post('roles')
  createRole(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) { return this.users.createRole(user, dto); }

  @Roles('SUPER_ADMIN')
  @Permissions('role.manage')
  @Patch('roles/:id/permissions')
  setRolePermissions(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetRolePermissionsDto) {
    return this.users.setRolePermissions(user, id, dto);
  }

  @Permissions('user.manage')
  @Patch(':id/roles')
  setUserRoles(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetUserRolesDto) {
    return this.users.setUserRoles(user, id, dto);
  }

  @Permissions('user.manage')
  @Patch(':id/status')
  setUserStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetUserStatusDto) {
    return this.users.setUserStatus(user, id, dto);
  }

  @Permissions('user.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) { return this.users.create(user, dto); }
}
