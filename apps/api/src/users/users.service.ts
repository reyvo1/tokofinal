import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateRoleDto, SetRolePermissionsDto, SetUserRolesDto, SetUserStatusDto } from './dto/manage-access.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type TenantScope = { companyId: string; branchId: string };
type UserWithRoles = Prisma.UserGetPayload<{ include: { roles: { include: { role: true } } } }>;
const protectedRoles = new Set(['SUPER_ADMIN', 'OWNER']);

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user?.companyId || !user.branchId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Pengguna belum memiliki company dan branch yang valid.',
      });
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    entityType: string,
    entityId?: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<never> {
    await client.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'TENANT_ACCESS_DENIED',
        entityType,
        entityId,
        payload: payload ?? {
          authenticatedCompanyId: scope.companyId,
          authenticatedBranchId: scope.branchId,
        },
      },
    });
    throw new ForbiddenException({
      code: 'TENANT_ACCESS_DENIED',
      message: `${entityType} tidak tersedia dalam company dan branch pengguna.`,
    });
  }

  private async denyAccessControl(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    entityType: string,
    entityId: string | undefined,
    message: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<never> {
    await client.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'ACCESS_CONTROL_DENIED',
        entityType,
        entityId,
        payload: payload ?? { branchId: scope.branchId },
      },
    });
    throw new ForbiddenException({ code: 'ACCESS_CONTROL_DENIED', message });
  }

  private async auditMutation(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    action: string,
    entityType: string,
    entityId: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action,
        entityType,
        entityId,
        payload: payload ?? { branchId: scope.branchId },
      },
    });
  }

  private async assertRequestedBranch(
    client: DbClient,
    user: AuthUser,
    scope: TenantScope,
    requestedBranchId?: string,
  ): Promise<void> {
    if (requestedBranchId && requestedBranchId !== scope.branchId) {
      await this.denyTenantAccess(client, user, scope, 'User', undefined, {
        authenticatedCompanyId: scope.companyId,
        authenticatedBranchId: scope.branchId,
        requestedBranchId,
      });
    }
  }

  private async requireSuperAdmin(client: DbClient, user: AuthUser, scope: TenantScope, entityType: string, entityId?: string) {
    if (!user.roles.includes('SUPER_ADMIN')) {
      await this.denyAccessControl(
        client,
        user,
        scope,
        entityType,
        entityId,
        'Katalog role dan permission global hanya dapat diubah oleh SUPER_ADMIN.',
      );
    }
  }

  private async findTenantUser(
    client: DbClient,
    actor: AuthUser,
    scope: TenantScope,
    userId: string,
  ): Promise<UserWithRoles> {
    const target = await client.user.findFirst({
      where: { id: userId, branchId: scope.branchId, branch: { companyId: scope.companyId } },
      include: { roles: { include: { role: true } } },
    });
    if (target) return target;
    const exists = await client.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (exists) return this.denyTenantAccess(client, actor, scope, 'User', userId);
    throw new NotFoundException('Pengguna tidak ditemukan.');
  }

  private normalizeRoleNames(roleNames: string[]): string[] {
    return [...new Set(roleNames.map((name) => name.trim().toUpperCase()).filter(Boolean))];
  }

  private async resolveAssignableRoles(
    client: DbClient,
    actor: AuthUser,
    scope: TenantScope,
    roleNames: string[],
  ) {
    const normalized = this.normalizeRoleNames(roleNames);
    if (!normalized.length) throw new BadRequestException('Minimal satu role harus dipilih.');
    if (!actor.roles.includes('SUPER_ADMIN') && normalized.some((name) => protectedRoles.has(name))) {
      await this.denyAccessControl(
        client,
        actor,
        scope,
        'Role',
        undefined,
        'Role SUPER_ADMIN dan OWNER hanya dapat diberikan oleh SUPER_ADMIN.',
        { branchId: scope.branchId, requestedRoles: normalized },
      );
    }
    const roles = await client.role.findMany({ where: { name: { in: normalized } } });
    if (roles.length !== normalized.length) throw new BadRequestException('Satu atau lebih role tidak ditemukan.');
    return roles;
  }

  private async assertTargetIsManageable(
    client: DbClient,
    actor: AuthUser,
    scope: TenantScope,
    target: UserWithRoles,
  ): Promise<void> {
    if (target.id === actor.sub) {
      await this.denyAccessControl(
        client,
        actor,
        scope,
        'User',
        target.id,
        'Role atau status akun sendiri tidak dapat diubah dari endpoint administrasi.',
      );
    }
    const targetRoleNames = target.roles.map((item) => item.role.name);
    if (!actor.roles.includes('SUPER_ADMIN') && targetRoleNames.some((name) => protectedRoles.has(name))) {
      await this.denyAccessControl(
        client,
        actor,
        scope,
        'User',
        target.id,
        'Akun dengan role SUPER_ADMIN atau OWNER hanya dapat diubah oleh SUPER_ADMIN.',
        { branchId: scope.branchId, targetRoles: targetRoleNames },
      );
    }
  }

  async list(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.user.findMany({
      where: { branchId: scope.branchId, branch: { companyId: scope.companyId } },
      select: {
        id: true,
        name: true,
        email: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        // Who can approve a supervisor-gated action. Without this the operator UI cannot show the
        // current arrangement, so the only way to learn it is to guess a PIN and be refused.
        canApprovePrivilegedActions: true,
        // The hash never leaves the server. Only the fact that a PIN exists, and when it was last
        // changed, which is what an administrator actually needs in order to rotate it.
        supervisorPinUpdatedAt: true,
        roles: { include: { role: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(user: AuthUser, dto: CreateUserDto) {
    const scope = this.requireTenantScope(user);
    await this.assertRequestedBranch(this.prisma, user, scope, dto.branchId);
    const email = dto.email.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const roles = await this.resolveAssignableRoles(tx, user, scope, dto.roleNames);
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) throw new ConflictException('Email tidak dapat digunakan.');
      const created = await tx.user.create({
        data: {
          name: dto.name.trim(),
          email,
          passwordHash: await hash(dto.password, 12),
          branchId: scope.branchId,
          roles: { create: roles.map((role) => ({ roleId: role.id })) },
        },
        select: {
          id: true,
          name: true,
          email: true,
          branchId: true,
          isActive: true,
          roles: { include: { role: true } },
        },
      });
      await this.auditMutation(tx, user, scope, 'CREATE_USER', 'User', created.id, {
        branchId: scope.branchId,
        roleNames: roles.map((role) => role.name),
      });
      return created;
    });
  }

  async roles(user: AuthUser) {
    this.requireTenantScope(user);
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async permissions(user: AuthUser) {
    this.requireTenantScope(user);
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  async createRole(user: AuthUser, dto: CreateRoleDto) {
    const scope = this.requireTenantScope(user);
    await this.requireSuperAdmin(this.prisma, user, scope, 'Role');
    const name = dto.name.trim().toUpperCase();
    if (!name) throw new BadRequestException('Nama role wajib diisi.');
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.role.findUnique({ where: { name }, select: { id: true } });
      if (exists) throw new ConflictException('Nama role sudah digunakan.');
      const permissionCodes = [...new Set(dto.permissionCodes ?? [])];
      const permissions = permissionCodes.length
        ? await tx.permission.findMany({ where: { code: { in: permissionCodes } } })
        : [];
      if (permissions.length !== permissionCodes.length) {
        throw new BadRequestException('Satu atau lebih permission tidak ditemukan.');
      }
      const role = await tx.role.create({
        data: {
          name,
          description: dto.description,
          permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
        },
        include: { permissions: { include: { permission: true } } },
      });
      await this.auditMutation(tx, user, scope, 'CREATE_ROLE', 'Role', role.id, {
        branchId: scope.branchId,
        name,
        permissionCodes,
      });
      return role;
    });
  }

  async setRolePermissions(user: AuthUser, roleId: string, dto: SetRolePermissionsDto) {
    const scope = this.requireTenantScope(user);
    await this.requireSuperAdmin(this.prisma, user, scope, 'Role', roleId);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } });
      if (!role) throw new NotFoundException('Role tidak ditemukan.');
      const permissionCodes = [...new Set(dto.permissionCodes)];
      const permissions = await tx.permission.findMany({ where: { code: { in: permissionCodes } } });
      if (permissions.length !== permissionCodes.length) {
        throw new BadRequestException('Satu atau lebih permission tidak ditemukan.');
      }
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
        });
      }
      const updated = await tx.role.findUniqueOrThrow({
        where: { id: roleId },
        include: { permissions: { include: { permission: true } } },
      });
      await this.auditMutation(tx, user, scope, 'SET_ROLE_PERMISSIONS', 'Role', roleId, {
        branchId: scope.branchId,
        roleName: role.name,
        permissionCodes,
      });
      return updated;
    });
  }

  async setUserRoles(user: AuthUser, userId: string, dto: SetUserRolesDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const target = await this.findTenantUser(tx, user, scope, userId);
      await this.assertTargetIsManageable(tx, user, scope, target);
      const roles = await this.resolveAssignableRoles(tx, user, scope, dto.roleNames);
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId, roleId: role.id })) });
      const updated = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          branchId: true,
          isActive: true,
          roles: { include: { role: true } },
        },
      });
      await this.auditMutation(tx, user, scope, 'SET_USER_ROLES', 'User', userId, {
        branchId: scope.branchId,
        roleNames: roles.map((role) => role.name),
      });
      return updated;
    });
  }

  async setUserStatus(user: AuthUser, userId: string, dto: SetUserStatusDto) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const target = await this.findTenantUser(tx, user, scope, userId);
      await this.assertTargetIsManageable(tx, user, scope, target);
      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: dto.isActive },
        select: { id: true, name: true, email: true, branchId: true, isActive: true },
      });
      await this.auditMutation(tx, user, scope, 'SET_USER_STATUS', 'User', userId, {
        branchId: scope.branchId,
        isActive: dto.isActive,
      });
      return updated;
    });
  }
}
