import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from './auth.types';
import { ROLES_KEY } from './roles.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (request.user?.authType === 'API_KEY') {
      const scopedPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
      if (!scopedPermissions?.length) throw new ForbiddenException('Endpoint role-only tidak dapat diakses dengan API key.');
      return true;
    }
    // `roles?.` matters: a user object that reached the guard without a roles array used to throw
    // "Cannot read properties of undefined (reading 'includes')" — a 500 that leaks a TypeError
    // instead of the 403 this line is written to return. The `user?.` optional chaining was already
    // here but only protected one of the two hops.
    if (!request.user || !required.some((role) => request.user?.roles?.includes(role))) {
      throw new ForbiddenException('Anda tidak memiliki hak akses untuk fitur ini.');
    }
    return true;
  }
}
