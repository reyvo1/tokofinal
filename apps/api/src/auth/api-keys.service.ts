import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser) {
    if (!user.companyId || !user.branchId) throw new ForbiddenException('Company/branch pengguna belum valid.');
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private hash(secret: string) { return createHash('sha256').update(secret).digest('hex'); }

  async list(user: AuthUser) {
    const { companyId } = this.scope(user);
    const rows = await this.prisma.apiKey.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(({ secretHash: _secretHash, ...row }) => ({ ...row, scopes: Array.isArray(row.scopes) ? row.scopes : [] }));
  }

  async create(dto: CreateApiKeyDto, user: AuthUser) {
    const { companyId, branchId } = this.scope(user);
    const scopes = [...new Set(dto.scopes.map((scope) => scope.trim()).filter(Boolean))];
    if (!scopes.length) throw new BadRequestException('Minimal satu scope API key wajib diisi.');
    const known = await this.prisma.permission.findMany({ where: { code: { in: scopes } }, select: { code: true } });
    const knownSet = new Set(known.map((row) => row.code));
    const unknown = scopes.filter((scope) => !knownSet.has(scope));
    if (unknown.length) throw new BadRequestException(`Scope tidak dikenal: ${unknown.join(', ')}`);
    // A pin to a branch outside this company would hand out a key for a tenant the caller cannot even
    // see, so the branch is checked rather than trusted from the request body.
    let pinnedBranchId: string | undefined;
    if (dto.branchId) {
      const target = await this.prisma.branch.findFirst({ where: { id: dto.branchId, companyId }, select: { id: true } });
      if (!target) throw new BadRequestException('Cabang tidak ditemukan pada perusahaan ini.');
      pinnedBranchId = target.id;
    }
    const prefix = randomBytes(6).toString('hex');
    const token = `tk360_${prefix}_${randomBytes(32).toString('base64url')}`;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException('Expiry API key harus di masa depan.');
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({ data: { companyId, name: dto.name.trim(), keyPrefix: prefix, secretHash: this.hash(token), scopes: scopes as Prisma.InputJsonValue, expiresAt, branchId: pinnedBranchId ?? null, locationLabel: dto.locationLabel?.trim() || null } });
      await tx.auditLog.create({ data: { companyId, userId: user.sub, action: 'CREATE_API_KEY', entityType: 'ApiKey', entityId: created.id, payload: { branchId, pinnedBranchId: pinnedBranchId ?? null, locationLabel: dto.locationLabel?.trim() || null, keyPrefix: prefix, scopes, expiresAt: expiresAt?.toISOString() ?? null } } });
      return created;
    });
    const { secretHash: _secretHash, ...safe } = row;
    return { ...safe, scopes, apiKey: token, warning: 'Simpan API key sekarang. Nilai penuh tidak dapat dilihat kembali setelah respons ini.' };
  }

  async revoke(id: string, user: AuthUser) {
    const { companyId, branchId } = this.scope(user);
    const row = await this.prisma.apiKey.findFirst({ where: { id, companyId } });
    if (!row) throw new BadRequestException('API key tidak ditemukan.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiKey.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({ data: { companyId, userId: user.sub, action: 'REVOKE_API_KEY', entityType: 'ApiKey', entityId: id, payload: { branchId, keyPrefix: row.keyPrefix } } });
      return { id: updated.id, isActive: updated.isActive };
    });
  }

  async rotate(id: string, user: AuthUser) {
    const { companyId, branchId } = this.scope(user);
    const row = await this.prisma.apiKey.findFirst({ where: { id, companyId, isActive: true } });
    if (!row) throw new BadRequestException('API key aktif tidak ditemukan.');
    const prefix = randomBytes(6).toString('hex');
    const token = `tk360_${prefix}_${randomBytes(32).toString('base64url')}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.apiKey.update({ where: { id }, data: { keyPrefix: prefix, secretHash: this.hash(token), lastUsedAt: null } });
      await tx.auditLog.create({ data: { companyId, userId: user.sub, action: 'ROTATE_API_KEY', entityType: 'ApiKey', entityId: id, payload: { branchId, keyPrefix: prefix } } });
    });
    return { id, keyPrefix: prefix, apiKey: token, warning: 'Simpan API key baru sekarang. Key lama langsung tidak berlaku.' };
  }

  async authenticate(rawToken: string, requestedBranchId?: string): Promise<AuthUser> {
    const token = rawToken.trim();
    const match = /^tk360_([0-9a-f]{12})_/.exec(token);
    if (!match) throw new UnauthorizedException('Format API key tidak valid.');
    const row = await this.prisma.apiKey.findFirst({ where: { keyPrefix: match[1], isActive: true }, orderBy: { createdAt: 'desc' } });
    if (!row || (row.expiresAt && row.expiresAt <= new Date())) throw new UnauthorizedException('API key tidak valid atau kedaluwarsa.');
    const expected = Buffer.from(row.secretHash, 'hex');
    const actual = Buffer.from(this.hash(token), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new UnauthorizedException('API key tidak valid.');
    // POST-1D. A pinned key serves exactly one branch, so it does not consult the header at all.
    //
    // The tempting implementation is `branchId = row.branchId ?? requestedBranchId`, which looks right
    // and is not: it would silently ignore a header naming a different branch, so a mistyped or
    // tampered header would look like it worked while the operator believed the device was pointed
    // somewhere it was not. A conflict is stated, not absorbed.
    if (row.branchId) {
      if (requestedBranchId && requestedBranchId !== row.branchId) {
        throw new UnauthorizedException('API key ini terikat ke cabang lain dan tidak dapat diarahkan ulang.');
      }
      const pinned = await this.prisma.branch.findFirst({ where: { id: row.branchId, companyId: row.companyId, isActive: true }, select: { id: true } });
      if (!pinned) throw new UnauthorizedException('Cabang pada API key ini tidak aktif atau tidak valid.');
      requestedBranchId = pinned.id;
    }
    const branches = await this.prisma.branch.findMany({ where: { companyId: row.companyId, isActive: true, ...(requestedBranchId ? { id: requestedBranchId } : {}) }, select: { id: true }, take: 2 });
    if (requestedBranchId && branches.length !== 1) throw new UnauthorizedException('Branch API key tidak valid untuk perusahaan ini.');
    if (!requestedBranchId && branches.length !== 1) throw new UnauthorizedException('Header x-toko360-branch-id wajib untuk perusahaan multi-cabang.');
    const branchId = requestedBranchId ?? branches[0].id;
    await this.prisma.apiKey.updateMany({ where: { id: row.id, isActive: true }, data: { lastUsedAt: new Date() } });
    const scopes = Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === 'string') : [];
    return { sub: `api-key:${row.id}`, email: `api-key:${row.keyPrefix}@integration.local`, name: row.name, companyId: row.companyId, branchId, roles: ['API_KEY'], permissions: scopes, authType: 'API_KEY', apiKeyId: row.id };
  }
}
