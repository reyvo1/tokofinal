import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthUser } from './auth.types';
import { ApiKeysService } from './api-keys.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; user?: AuthUser }>();
    const header = (name: string) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const authorization = header('authorization');
    const apiKey = header('x-api-key');
    if (isPublic && !authorization && !apiKey) return true;
    if (authorization && apiKey) throw new UnauthorizedException('Gunakan Bearer token atau API key, jangan keduanya.');
    if (apiKey) {
      request.user = await this.apiKeys.authenticate(apiKey, header('x-toko360-branch-id'));
      return true;
    }

    const [type, token] = authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Token tidak ditemukan.');

    let tokenUser: AuthUser;
    try {
      tokenUser = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau sudah kedaluwarsa.');
    }
    if (!tokenUser.sid) throw new UnauthorizedException('Sesi token tidak terdaftar. Silakan login ulang.');

    const persistedUser = await this.prisma.user.findUnique({
      where: { id: tokenUser.sub },
      include: {
        branch: { select: { companyId: true, isActive: true } },
        sessions: { where: { id: tokenUser.sid, revokedAt: null, expiresAt: { gt: new Date() } }, take: 1 },
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });
    if (!persistedUser || !persistedUser.isActive) {
      throw new UnauthorizedException('Akun tidak aktif atau tidak ditemukan.');
    }
    if (!persistedUser.sessions.length) {
      throw new UnauthorizedException('Sesi sudah dicabut atau kedaluwarsa. Silakan login ulang.');
    }
    if (persistedUser.branchId && (!persistedUser.branch || !persistedUser.branch.isActive)) {
      throw new UnauthorizedException('Cabang pengguna tidak aktif atau tidak ditemukan.');
    }

    const session = persistedUser.sessions[0];
    const homeCompanyId = persistedUser.branch?.companyId ?? null;
    const activeBranchId = session?.activeBranchId ?? persistedUser.branchId;
    const activeBranch = homeCompanyId && activeBranchId
      ? await this.prisma.branch.findFirst({
          where: { id: activeBranchId, companyId: homeCompanyId, isActive: true },
          select: { id: true },
        })
      : null;
    if (activeBranchId && !activeBranch) {
      throw new UnauthorizedException('Branch context sesi tidak valid atau sudah tidak aktif.');
    }

    const roles = persistedUser.roles.map((item) => item.role.name);
    const permissions = [...new Set(
      persistedUser.roles.flatMap((item) => item.role.permissions.map((entry) => entry.permission.code)),
    )];
    request.user = {
      sub: persistedUser.id,
      sid: tokenUser.sid,
      email: persistedUser.email,
      name: persistedUser.name,
      companyId: homeCompanyId,
      branchId: activeBranch?.id ?? null,
      roles,
      permissions,
      authType: 'JWT',
    };
    if (session && Date.now() - session.lastSeenAt.getTime() >= 5 * 60_000) {
      await this.prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastSeenAt: new Date() } });
    }
    return true;
  }
}
