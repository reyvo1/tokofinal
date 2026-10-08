import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SecretProtectorService } from '../platform/secret-protector.service';
import { AuthUser } from './auth.types';
import { DistributedRateLimitService } from './distributed-rate-limit.service';
import { LoginDto } from './dto/login.dto';
import { ConfirmPasswordResetDto, RequestPasswordResetDto } from './dto/password-reset.dto';
import { buildTotpUri, generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, verifyTotp } from './totp';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly rateLimit: DistributedRateLimitService,
    private readonly secrets: SecretProtectorService,
  ) {}

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashRecoveryCode(code: string): string {
    return createHash('sha256').update(`toko360-recovery:${normalizeRecoveryCode(code)}`).digest('hex');
  }

  private resetExpiry(): Date {
    const minutes = Math.min(Math.max(Number(this.config.get<string>('AUTH_PASSWORD_RESET_EXPIRES_MINUTES') ?? '30') || 30, 10), 120);
    return new Date(Date.now() + minutes * 60_000);
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const targetHash = this.hashRecoveryCode(code);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true, twoFactorRecoveryCodes: true } });
      if (!row?.twoFactorEnabled) return false;
      const hashes = Array.isArray(row.twoFactorRecoveryCodes)
        ? row.twoFactorRecoveryCodes.filter((value): value is string => typeof value === 'string')
        : [];
      const index = hashes.indexOf(targetHash);
      if (index < 0) return false;
      const remaining = hashes.filter((_, itemIndex) => itemIndex !== index);
      await tx.user.update({ where: { id: userId }, data: { twoFactorRecoveryCodes: remaining } });
      return true;
    });
  }

  private async verifySecondFactor(
    user: { id: string; twoFactorEnabled: boolean; twoFactorSecretEncrypted: string | null },
    code?: string,
  ): Promise<boolean> {
    if (!user.twoFactorEnabled) return true;
    const supplied = code?.trim();
    if (!supplied) return false;
    if (/^\d{6}$/.test(supplied) && user.twoFactorSecretEncrypted) {
      const secret = this.secrets.decryptText(user.twoFactorSecretEncrypted);
      if (verifyTotp(secret, supplied)) return true;
    }
    return this.consumeRecoveryCode(user.id, supplied);
  }

  private refreshExpiry(): Date {
    const days = Math.min(Math.max(Number(this.config.get<string>('JWT_REFRESH_EXPIRES_DAYS') ?? '30') || 30, 1), 180);
    return new Date(Date.now() + days * 24 * 60 * 60_000);
  }

  private async signAccessToken(payload: AuthUser): Promise<{ accessToken: string; accessExpiresAt: Date }> {
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: (this.config.get<string>('JWT_EXPIRES_IN') ?? '15m') as never,
    });
    const decoded = this.jwt.decode<{ exp?: number }>(accessToken);
    if (!decoded?.exp) throw new UnauthorizedException('Token login tidak memiliki expiry yang valid.');
    return { accessToken, accessExpiresAt: new Date(decoded.exp * 1000) };
  }

  private rateRule(kind: 'email' | 'ip') {
    const prefix = kind === 'email' ? 'AUTH_EMAIL' : 'AUTH_IP';
    return {
      limit: Math.max(2, Number(this.config.get<string>(`${prefix}_FAIL_LIMIT`) ?? (kind === 'email' ? '5' : '30'))),
      windowMs: Math.max(60_000, Number(this.config.get<string>(`${prefix}_WINDOW_MS`) ?? '900000')),
      blockMs: Math.max(60_000, Number(this.config.get<string>(`${prefix}_BLOCK_MS`) ?? '900000')),
    };
  }

  async login(dto: LoginDto, clientIp = 'unknown') {
    const loginKey = dto.email.trim().toLowerCase();
    const ipKey = clientIp || 'unknown';
    await this.rateLimit.assertAllowed('auth-login-email', loginKey);
    await this.rateLimit.assertAllowed('auth-login-ip', ipKey);

    const user = await this.prisma.user.findUnique({
      where: { email: loginKey },
      include: {
        branch: { select: { companyId: true, isActive: true } },
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
    if (!user || !user.isActive || !(await compare(dto.password, user.passwordHash))) {
      await Promise.all([
        this.rateLimit.registerFailure('auth-login-email', loginKey, this.rateRule('email')),
        this.rateLimit.registerFailure('auth-login-ip', ipKey, this.rateRule('ip')),
      ]);
      if (user) {
        await this.prisma.auditLog.create({ data: {
          companyId: user.branch?.companyId, userId: user.id, action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id,
          payload: { branchId: user.branchId },
        } });
      }
      throw new UnauthorizedException('Email atau password tidak valid.');
    }
    if (user.branchId && (!user.branch || !user.branch.isActive)) {
      throw new UnauthorizedException('Email atau password tidak valid.');
    }
    if (user.twoFactorEnabled) {
      if (!dto.twoFactorCode?.trim()) {
        throw new UnauthorizedException({ code: 'TWO_FACTOR_REQUIRED', message: 'Kode autentikasi dua faktor diperlukan.' });
      }
      if (!(await this.verifySecondFactor(user, dto.twoFactorCode))) {
        await Promise.all([
          this.rateLimit.registerFailure('auth-login-email', loginKey, this.rateRule('email')),
          this.rateLimit.registerFailure('auth-login-ip', ipKey, this.rateRule('ip')),
        ]);
        throw new UnauthorizedException({ code: 'TWO_FACTOR_INVALID', message: 'Kode autentikasi dua faktor tidak valid.' });
      }
    }

    await Promise.all([
      this.rateLimit.clear('auth-login-email', loginKey),
      this.rateLimit.prune(),
    ]);

    const roles = user.roles.map((item) => item.role.name);
    const permissions = [...new Set(user.roles.flatMap((item) => item.role.permissions.map((entry) => entry.permission.code)))];
    const sid = randomUUID();
    const payload: AuthUser = {
      sub: user.id,
      sid,
      email: user.email,
      name: user.name,
      companyId: user.branch?.companyId ?? null,
      branchId: user.branchId,
      roles,
      permissions,
    };
    const { accessToken, accessExpiresAt } = await this.signAccessToken(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const sessionExpiresAt = this.refreshExpiry();

    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.create({ data: { id: sid, userId: user.id, activeBranchId: user.branchId, expiresAt: sessionExpiresAt, refreshTokenHash, lastRotatedAt: new Date() } });
      await tx.auditLog.create({ data: {
        companyId: user.branch?.companyId,
        userId: user.id,
        action: 'LOGIN',
        entityType: 'AuthSession',
        entityId: sid,
        payload: { branchId: user.branchId, accessExpiresAt: accessExpiresAt.toISOString(), sessionExpiresAt: sessionExpiresAt.toISOString() },
      } });
      await tx.authSession.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } } });
    });

    return { accessToken, refreshToken, accessExpiresAt, sessionExpiresAt, user: payload };
  }

  async refresh(refreshToken: string, clientIp = 'unknown') {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const now = new Date();
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: {
        user: {
          include: {
            branch: { select: { companyId: true, isActive: true } },
            roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          },
        },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) {
      throw new UnauthorizedException('Refresh token tidak valid atau sudah kedaluwarsa.');
    }
    if (session.user.branchId && (!session.user.branch || !session.user.branch.isActive)) {
      throw new UnauthorizedException('Refresh token tidak valid atau sudah kedaluwarsa.');
    }
    const homeCompanyId = session.user.branch?.companyId ?? null;
    const activeBranchId = session.activeBranchId ?? session.user.branchId;
    const activeBranch = homeCompanyId && activeBranchId
      ? await this.prisma.branch.findFirst({
          where: { id: activeBranchId, companyId: homeCompanyId, isActive: true },
          select: { id: true, code: true, name: true, companyId: true },
        })
      : null;
    if (activeBranchId && !activeBranch) {
      throw new UnauthorizedException('Branch context sesi tidak valid atau sudah tidak aktif.');
    }
    const roles = session.user.roles.map((item) => item.role.name);
    const permissions = [...new Set(session.user.roles.flatMap((item) => item.role.permissions.map((entry) => entry.permission.code)))];
    const payload: AuthUser = {
      sub: session.user.id, sid: session.id, email: session.user.email, name: session.user.name,
      companyId: homeCompanyId, branchId: activeBranch?.id ?? null, roles, permissions,
    };
    const nextRefreshToken = randomBytes(48).toString('base64url');
    const nextRefreshTokenHash = this.hashRefreshToken(nextRefreshToken);
    const sessionExpiresAt = this.refreshExpiry();
    const { accessToken, accessExpiresAt } = await this.signAccessToken(payload);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.authSession.updateMany({
        where: { id: session.id, userId: session.userId, refreshTokenHash: tokenHash, revokedAt: null, expiresAt: { gt: now } },
        data: { refreshTokenHash: nextRefreshTokenHash, lastRotatedAt: now, lastSeenAt: now, expiresAt: sessionExpiresAt },
      });
      if (updated.count !== 1) return false;
      await tx.auditLog.create({ data: {
        companyId: session.user.branch?.companyId, userId: session.user.id, action: 'REFRESH_TOKEN_ROTATED',
        entityType: 'AuthSession', entityId: session.id,
        payload: { branchId: payload.branchId, homeBranchId: session.user.branchId, clientIp, accessExpiresAt: accessExpiresAt.toISOString(), sessionExpiresAt: sessionExpiresAt.toISOString() },
      } });
      return true;
    });
    if (!rotated) throw new UnauthorizedException('Refresh token sudah digunakan atau dicabut.');
    return { accessToken, refreshToken: nextRefreshToken, accessExpiresAt, sessionExpiresAt, user: payload };
  }

  async branchContext(user: AuthUser) {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Pengguna belum memiliki company dan branch yang valid.',
      });
    }
    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { branchId: true, branch: { select: { companyId: true } } },
    });
    if (!account?.branchId || account.branch?.companyId !== user.companyId) {
      throw new UnauthorizedException('Home branch pengguna tidak valid.');
    }
    const canSwitch = user.roles.includes('SUPER_ADMIN') || user.permissions.includes('branch.switch');
    const branches = await this.prisma.branch.findMany({
      where: { companyId: user.companyId, isActive: true, ...(canSwitch ? {} : { id: user.branchId }) },
      select: { id: true, code: true, name: true, address: true, isActive: true },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { id: true, name: true, slug: true, timezone: true, currency: true },
    });
    return {
      company,
      activeBranchId: user.branchId,
      homeBranchId: account.branchId,
      canSwitch,
      branches,
    };
  }

  async switchBranchContext(user: AuthUser, targetBranchId: string) {
    if (!user.sid || !user.companyId || !user.branchId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Sesi, company, dan branch aktif wajib tersedia untuk berpindah cabang.',
      });
    }
    if (!user.roles.includes('SUPER_ADMIN') && !user.permissions.includes('branch.switch')) {
      throw new ForbiddenException({
        code: 'BRANCH_SWITCH_DENIED',
        message: 'Akun ini tidak memiliki izin berpindah cabang.',
      });
    }
    const target = await this.prisma.branch.findFirst({
      where: { id: targetBranchId, companyId: user.companyId, isActive: true },
      select: { id: true, code: true, name: true, address: true, companyId: true },
    });
    if (!target) {
      await this.prisma.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.sub,
          action: 'BRANCH_CONTEXT_SWITCH_DENIED',
          entityType: 'Branch',
          entityId: targetBranchId,
          payload: { activeBranchId: user.branchId },
        },
      });
      throw new ForbiddenException({
        code: 'BRANCH_SWITCH_DENIED',
        message: 'Cabang tujuan tidak tersedia di company aktif.',
      });
    }

    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { branchId: true, branch: { select: { companyId: true, isActive: true } } },
    });
    if (!account?.branchId || !account.branch?.isActive || account.branch.companyId !== user.companyId) {
      throw new UnauthorizedException('Home branch pengguna tidak valid.');
    }

    const now = new Date();
    const updated = await this.prisma.authSession.updateMany({
      where: { id: user.sid, userId: user.sub, revokedAt: null, expiresAt: { gt: now } },
      data: { activeBranchId: target.id, lastSeenAt: now },
    });
    if (updated.count !== 1) throw new UnauthorizedException('Sesi tidak valid atau sudah kedaluwarsa.');

    const payload: AuthUser = { ...user, branchId: target.id, companyId: target.companyId, authType: 'JWT' };
    delete payload.apiKeyId;
    const { accessToken, accessExpiresAt } = await this.signAccessToken(payload);
    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.sub,
        action: 'BRANCH_CONTEXT_SWITCHED',
        entityType: 'AuthSession',
        entityId: user.sid,
        payload: {
          previousBranchId: user.branchId,
          targetBranchId: target.id,
          homeBranchId: account.branchId,
          accessExpiresAt: accessExpiresAt.toISOString(),
        },
      },
    });
    return {
      accessToken,
      accessExpiresAt,
      user: payload,
      activeBranch: target,
      homeBranchId: account.branchId,
    };
  }

  async revokeSession(id: string, user: AuthUser) {
    if (!id.trim()) throw new BadRequestException('Session id wajib diisi.');
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: { id, userId: user.sub },
        select: { id: true, revokedAt: true, expiresAt: true },
      });
      if (!session) throw new BadRequestException('Sesi tidak ditemukan.');
      const revoked = await tx.authSession.updateMany({
        where: { id: session.id, userId: user.sub, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date(), revokeReason: session.id === user.sid ? 'SESSION_REVOKED_CURRENT' : 'SESSION_REVOKED' },
      });
      await tx.auditLog.create({ data: {
        companyId: user.companyId ?? undefined, userId: user.sub, action: 'REVOKE_AUTH_SESSION', entityType: 'AuthSession', entityId: session.id,
        payload: { branchId: user.branchId, current: session.id === user.sid, revoked: revoked.count === 1 },
      } });
      return revoked.count;
    });
    return { ok: true, revoked: result, sessionId: id, current: id === user.sid };
  }

  async logout(user: AuthUser) {
    if (!user.sid) throw new UnauthorizedException('Sesi tidak valid.');
    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { id: user.sid, userId: user.sub, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'LOGOUT' },
      });
      await tx.auditLog.create({ data: {
        companyId: user.companyId ?? undefined, userId: user.sub, action: 'LOGOUT', entityType: 'AuthSession', entityId: user.sid,
        payload: { branchId: user.branchId, revoked: revoked.count === 1 },
      } });
      return revoked.count;
    });
    return { ok: true, revoked: result };
  }

  async logoutAll(user: AuthUser) {
    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { userId: user.sub, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date(), revokeReason: 'LOGOUT_ALL' },
      });
      await tx.auditLog.create({ data: {
        companyId: user.companyId ?? undefined, userId: user.sub, action: 'LOGOUT_ALL', entityType: 'User', entityId: user.sub,
        payload: { branchId: user.branchId, revokedSessions: revoked.count },
      } });
      return revoked.count;
    });
    return { ok: true, revoked: result };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto, clientIp = 'unknown') {
    const email = dto.email.trim().toLowerCase();
    const rule = { limit: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
    await Promise.all([
      this.rateLimit.assertAllowed('auth-reset-email', email),
      this.rateLimit.assertAllowed('auth-reset-ip', clientIp || 'unknown'),
    ]);
    await Promise.all([
      this.rateLimit.registerFailure('auth-reset-email', email, rule),
      this.rateLimit.registerFailure('auth-reset-ip', clientIp || 'unknown', { ...rule, limit: 20 }),
    ]);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { branch: { select: { companyId: true, isActive: true } } },
    });
    let developmentResetToken: string | undefined;
    if (user?.isActive && (!user.branchId || user.branch?.isActive)) {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = this.hashRefreshToken(token);
      const expiresAt = this.resetExpiry();
      await this.prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
        const reset = await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
        if (user.branch?.companyId) {
          const baseUrl = (this.config.get<string>('ADMIN_PUBLIC_URL') ?? 'http://localhost:3001').replace(/\/$/, '');
          await tx.notification.create({ data: {
            companyId: user.branch.companyId,
            channel: 'EMAIL', recipient: user.email, templateCode: 'PASSWORD_RESET', subject: 'Reset password Toko360',
            body: `Permintaan reset password Toko360 diterima. Buka ${baseUrl}/?resetToken=${encodeURIComponent(token)} sebelum ${expiresAt.toISOString()}. Abaikan pesan ini bila Anda tidak meminta reset.`,
            data: { userId: user.id, resetTokenId: reset.id, purpose: 'PASSWORD_RESET', expiresAt: expiresAt.toISOString() },
          } });
        }
        await tx.auditLog.create({ data: {
          companyId: user.branch?.companyId, userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: user.id,
          payload: { expiresAt: expiresAt.toISOString(), clientIp },
        } });
      });
      const environment = (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development').toLowerCase();
      if (!['production', 'staging'].includes(environment) && this.config.get<string>('AUTH_EXPOSE_RESET_TOKEN') === 'true') {
        developmentResetToken = token;
      }
    }
    return { ok: true, message: 'Jika akun aktif ditemukan, instruksi reset password akan dikirim.', ...(developmentResetToken ? { developmentResetToken } : {}) };
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto, clientIp = 'unknown') {
    const tokenHash = this.hashRefreshToken(dto.token.trim());
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { branch: { select: { companyId: true, isActive: true } } } } },
    });
    const now = new Date();
    if (!reset || reset.usedAt || reset.expiresAt <= now || !reset.user.isActive || (reset.user.branchId && !reset.user.branch?.isActive)) {
      throw new BadRequestException('Token reset password tidak valid atau sudah kedaluwarsa.');
    }
    const passwordHash = await hash(dto.newPassword, 12);
    const completed = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claimed.count !== 1) return false;
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      await tx.authSession.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'PASSWORD_RESET' } });
      await tx.passwordResetToken.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: now } });
      await tx.auditLog.create({ data: {
        companyId: reset.user.branch?.companyId, userId: reset.userId, action: 'PASSWORD_RESET_COMPLETED', entityType: 'User', entityId: reset.userId,
        payload: { clientIp },
      } });
      return true;
    });
    if (!completed) throw new BadRequestException('Token reset password sudah digunakan.');
    return { ok: true, message: 'Password berhasil diubah. Silakan login kembali.' };
  }

  async twoFactorStatus(user: AuthUser) {
    const row = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { twoFactorEnabled: true, twoFactorPendingSecretEncrypted: true, twoFactorRecoveryCodes: true } });
    if (!row) throw new UnauthorizedException('Akun tidak ditemukan.');
    return {
      enabled: row.twoFactorEnabled,
      setupPending: Boolean(row.twoFactorPendingSecretEncrypted),
      remainingRecoveryCodes: Array.isArray(row.twoFactorRecoveryCodes) ? row.twoFactorRecoveryCodes.filter((item) => typeof item === 'string').length : 0,
    };
  }

  async startTwoFactorSetup(user: AuthUser) {
    const account = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { id: true, email: true, twoFactorEnabled: true } });
    if (!account) throw new UnauthorizedException('Akun tidak ditemukan.');
    if (account.twoFactorEnabled) throw new BadRequestException('2FA sudah aktif. Nonaktifkan terlebih dahulu sebelum membuat secret baru.');
    const secret = generateTotpSecret();
    const encrypted = this.secrets.encryptText(secret);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.sub }, data: { twoFactorPendingSecretEncrypted: encrypted } });
      await tx.auditLog.create({ data: { companyId: user.companyId ?? undefined, userId: user.sub, action: 'TWO_FACTOR_SETUP_STARTED', entityType: 'User', entityId: user.sub, payload: { branchId: user.branchId } } });
    });
    return { secret, otpauthUri: buildTotpUri(secret, account.email), algorithm: 'SHA1', digits: 6, period: 30 };
  }

  async confirmTwoFactorSetup(user: AuthUser, code: string) {
    const account = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { twoFactorPendingSecretEncrypted: true, twoFactorEnabled: true } });
    if (!account?.twoFactorPendingSecretEncrypted || account.twoFactorEnabled) throw new BadRequestException('Setup 2FA belum dimulai atau sudah aktif.');
    const secret = this.secrets.decryptText(account.twoFactorPendingSecretEncrypted);
    if (!verifyTotp(secret, code.trim())) throw new BadRequestException('Kode TOTP tidak valid. Pastikan waktu perangkat sinkron.');
    const recoveryCodes = generateRecoveryCodes(10);
    const recoveryHashes = recoveryCodes.map((value) => this.hashRecoveryCode(value));
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.sub }, data: {
        twoFactorEnabled: true,
        twoFactorSecretEncrypted: account.twoFactorPendingSecretEncrypted,
        twoFactorPendingSecretEncrypted: null,
        twoFactorRecoveryCodes: recoveryHashes,
      } });
      await tx.auditLog.create({ data: { companyId: user.companyId ?? undefined, userId: user.sub, action: 'TWO_FACTOR_ENABLED', entityType: 'User', entityId: user.sub, payload: { branchId: user.branchId, recoveryCodeCount: recoveryCodes.length } } });
    });
    return { ok: true, recoveryCodes, message: '2FA aktif. Simpan recovery code sekarang; kode tidak akan ditampilkan lagi.' };
  }

  async regenerateRecoveryCodes(user: AuthUser, code: string) {
    const account = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { id: true, twoFactorEnabled: true, twoFactorSecretEncrypted: true } });
    if (!account?.twoFactorEnabled || !account.twoFactorSecretEncrypted) throw new BadRequestException('2FA belum aktif.');
    if (!(await this.verifySecondFactor(account, code))) throw new BadRequestException('Kode 2FA atau recovery code tidak valid.');
    const recoveryCodes = generateRecoveryCodes(10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.sub }, data: { twoFactorRecoveryCodes: recoveryCodes.map((value) => this.hashRecoveryCode(value)) } });
      await tx.auditLog.create({ data: { companyId: user.companyId ?? undefined, userId: user.sub, action: 'TWO_FACTOR_RECOVERY_REGENERATED', entityType: 'User', entityId: user.sub, payload: { branchId: user.branchId, count: recoveryCodes.length } } });
    });
    return { ok: true, recoveryCodes };
  }

  async disableTwoFactor(user: AuthUser, password: string, code: string) {
    const account = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { id: true, passwordHash: true, twoFactorEnabled: true, twoFactorSecretEncrypted: true } });
    if (!account?.twoFactorEnabled || !account.twoFactorSecretEncrypted) throw new BadRequestException('2FA belum aktif.');
    if (!(await compare(password, account.passwordHash))) throw new UnauthorizedException('Password tidak valid.');
    if (!(await this.verifySecondFactor(account, code))) throw new BadRequestException('Kode 2FA atau recovery code tidak valid.');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.sub }, data: {
        twoFactorEnabled: false, twoFactorSecretEncrypted: null, twoFactorPendingSecretEncrypted: null, twoFactorRecoveryCodes: Prisma.JsonNull,
      } });
      await tx.authSession.updateMany({ where: { userId: user.sub, id: { not: user.sid }, revokedAt: null }, data: { revokedAt: now, revokeReason: 'TWO_FACTOR_DISABLED' } });
      await tx.auditLog.create({ data: { companyId: user.companyId ?? undefined, userId: user.sub, action: 'TWO_FACTOR_DISABLED', entityType: 'User', entityId: user.sub, payload: { branchId: user.branchId } } });
    });
    return { ok: true };
  }

  async sessions(user: AuthUser) {
    const rows = await this.prisma.authSession.findMany({
      where: { userId: user.sub, expiresAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, activeBranchId: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, revokeReason: true },
    });
    return rows.map((row) => ({ ...row, current: row.id === user.sid }));
  }
}
