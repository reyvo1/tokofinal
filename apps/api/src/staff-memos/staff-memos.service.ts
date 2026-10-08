import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthUser } from '../auth/auth.types';
import { parsePageLimit } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffMemoDto, UpdateStaffMemoDto } from './dto/staff-memo.dto';

type MemoScope = { companyId: string; branchId: string; userId: string };

@Injectable()
export class StaffMemosService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser): MemoScope {
    if (user.authType === 'API_KEY') {
      throw new ForbiddenException('Memo staf hanya tersedia untuk sesi pengguna, bukan API key.');
    }
    if (!user.companyId || !user.branchId || !user.sub) {
      throw new ForbiddenException('Company/branch pengguna belum valid untuk memo.');
    }
    return { companyId: user.companyId, branchId: user.branchId, userId: user.sub };
  }

  private operationKey(value?: string) {
    const key = value?.trim();
    if (!key) throw new BadRequestException('Idempotency-Key wajib diisi untuk membuat memo.');
    if (key.length > 160) throw new BadRequestException('Idempotency-Key maksimal 160 karakter.');
    return key;
  }

  private normalizeCreate(dto: CreateStaffMemoDto) {
    const title = dto.title.trim();
    const body = dto.body?.trim() ?? '';
    if (!title) throw new BadRequestException('Judul memo wajib diisi.');
    return { title, body, isPinned: dto.isPinned ?? false };
  }

  private requestHash(payload: { title: string; body: string; isPinned: boolean }) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private assertSameRequest(existingHash: string, requestHash: string) {
    if (existingHash !== requestHash) {
      throw new ConflictException('Idempotency-Key memo sudah pernah dipakai dengan payload berbeda.');
    }
  }

  async list(user: AuthUser, includeArchivedValue?: string, searchValue?: string, limitValue?: string, cursor?: string) {
    const scope = this.scope(user);
    const limit = parsePageLimit(limitValue);
    const search = searchValue?.trim();
    const includeArchived = includeArchivedValue === 'true';
    const rows = await this.prisma.staffMemo.findMany({
      where: {
        ...scope,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(search ? { OR: [{ title: { contains: search } }, { body: { contains: search } }] } : {}),
      },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      pageInfo: {
        limit,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      },
    };
  }

  async create(dto: CreateStaffMemoDto, idempotencyKey: string | undefined, user: AuthUser) {
    const scope = this.scope(user);
    const operationKey = this.operationKey(idempotencyKey);
    const payload = this.normalizeCreate(dto);
    const requestHash = this.requestHash(payload);
    const where = { userId_branchId_operationKey: { userId: scope.userId, branchId: scope.branchId, operationKey } } as const;
    const existing = await this.prisma.staffMemo.findUnique({ where });
    if (existing) {
      this.assertSameRequest(existing.requestHash, requestHash);
      return existing;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const memo = await tx.staffMemo.create({ data: { ...scope, operationKey, requestHash, ...payload } });
        await tx.auditLog.create({
          data: {
            companyId: scope.companyId,
            userId: scope.userId,
            action: 'CREATE_STAFF_MEMO',
            entityType: 'StaffMemo',
            entityId: memo.id,
            payload: { branchId: scope.branchId, isPinned: memo.isPinned },
          },
        });
        return memo;
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const raced = await this.prisma.staffMemo.findUnique({ where });
      if (!raced) throw error;
      this.assertSameRequest(raced.requestHash, requestHash);
      return raced;
    }
  }

  async update(id: string, dto: UpdateStaffMemoDto, user: AuthUser) {
    const scope = this.scope(user);
    if (dto.title === undefined && dto.body === undefined && dto.isPinned === undefined && dto.archived === undefined) {
      throw new BadRequestException('Tidak ada perubahan memo yang dikirim.');
    }
    const existing = await this.prisma.staffMemo.findFirst({ where: { id, ...scope } });
    if (!existing) throw new NotFoundException('Memo tidak ditemukan.');

    const title = dto.title === undefined ? undefined : dto.title.trim();
    if (title !== undefined && !title) throw new BadRequestException('Judul memo wajib diisi.');
    const archivedAt = dto.archived === undefined ? undefined : dto.archived ? new Date() : null;
    const action = dto.archived === true
      ? 'ARCHIVE_STAFF_MEMO'
      : dto.archived === false
        ? 'RESTORE_STAFF_MEMO'
        : dto.isPinned !== undefined
          ? 'PIN_STAFF_MEMO'
          : 'UPDATE_STAFF_MEMO';

    return this.prisma.$transaction(async (tx) => {
      const memo = await tx.staffMemo.update({
        where: { id: existing.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
          ...(dto.isPinned !== undefined ? { isPinned: dto.isPinned } : {}),
          ...(archivedAt !== undefined ? { archivedAt } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: scope.userId,
          action,
          entityType: 'StaffMemo',
          entityId: memo.id,
          payload: {
            branchId: scope.branchId,
            ...(dto.isPinned !== undefined ? { isPinned: memo.isPinned } : {}),
            ...(dto.archived !== undefined ? { archived: memo.archivedAt != null } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return memo;
    });
  }
}
