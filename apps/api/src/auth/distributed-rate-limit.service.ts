import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Rule = { limit: number; windowMs: number; blockMs: number };

@Injectable()
export class DistributedRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(identity: string): string {
    return createHash('sha256').update(identity.trim().toLowerCase()).digest('hex');
  }

  async assertAllowed(scope: string, identity: string): Promise<void> {
    const keyHash = this.hash(identity);
    const row = await this.prisma.rateLimitBucket.findUnique({ where: { scope_keyHash: { scope, keyHash } } });
    if (row?.blockedUntil && row.blockedUntil > new Date()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((row.blockedUntil.getTime() - Date.now()) / 1000));
      throw new HttpException({ code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan. Coba lagi nanti.', retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async registerFailure(scope: string, identity: string, rule: Rule): Promise<void> {
    const keyHash = this.hash(identity);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const row = await tx.rateLimitBucket.findUnique({ where: { scope_keyHash: { scope, keyHash } } });
          if (!row) {
            await tx.rateLimitBucket.create({ data: { scope, keyHash, windowStart: now, count: 1 } });
            return;
          }
          if (row.blockedUntil && row.blockedUntil > now) return;
          const expiredWindow = now.getTime() - row.windowStart.getTime() >= rule.windowMs;
          const nextCount = expiredWindow ? 1 : row.count + 1;
          const blockedUntil = nextCount >= rule.limit ? new Date(now.getTime() + rule.blockMs) : null;
          const updated = await tx.rateLimitBucket.updateMany({
            where: { id: row.id, count: row.count, windowStart: row.windowStart, updatedAt: row.updatedAt },
            data: { windowStart: expiredWindow ? now : row.windowStart, count: nextCount, blockedUntil },
          });
          if (updated.count !== 1) throw new Error('RATE_LIMIT_CONFLICT');
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return;
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const message = error instanceof Error ? error.message : '';
        if ((code === 'P2002' || code === 'P2034' || message === 'RATE_LIMIT_CONFLICT') && attempt < 4) continue;
        throw error;
      }
    }
  }

  async clear(scope: string, identity: string): Promise<void> {
    await this.prisma.rateLimitBucket.deleteMany({ where: { scope, keyHash: this.hash(identity) } });
  }

  async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    await this.prisma.rateLimitBucket.deleteMany({ where: { updatedAt: { lt: cutoff }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] } });
  }
}
