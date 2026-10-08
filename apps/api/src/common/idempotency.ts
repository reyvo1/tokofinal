// Idempotency helper (w0-idempotency-all-mutations).
// Gunakan IdempotencyReceipt: key per company+scope; requestHash mendeteksi replay dengan payload berbeda.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

type DbClient = Prisma.TransactionClient | PrismaClient;

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

/**
 * Buka "receipt" idempotency sebelum memproses mutasi.
 * - Key baru           -> receipt PROCESSING dibuat; lanjutkan eksekusi.
 * - Key sama, payload sama, status COMPLETED -> kembalikan response tersimpan (replay aman).
 * - Key sama, payload berbeda            -> tolak 400 (altered replay).
 * - Key sama, masih PROCESSING           -> tolak 409 (sedang diproses / crash sebelumnya;
 *   pemanggil boleh retry setelah expiresAt atau gunakan key lain).
 */
export async function beginIdempotent<T = unknown>(
  tx: DbClient,
  opts: { companyId: string; scope: string; key: string; payload: unknown },
): Promise<{ replay: false } | { replay: true; status: 'COMPLETED' | 'PROCESSING'; response?: T | null }> {
  const requestHash = hashPayload(opts.payload);
  const processingTtlMs = 10 * 60 * 1000;
  const existing = await tx.idempotencyReceipt.findUnique({
    where: { companyId_scope_key: { companyId: opts.companyId, scope: opts.scope, key: opts.key } },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
    if (existing.status === 'COMPLETED') return { replay: true, status: 'COMPLETED', response: (existing.response as T) ?? null };
    const expiresAt = existing.expiresAt ?? new Date(existing.createdAt.getTime() + processingTtlMs);
    if (expiresAt.getTime() <= Date.now()) {
      const reclaimed = await tx.idempotencyReceipt.updateMany({
        where: { id: existing.id, status: 'PROCESSING', requestHash },
        data: { expiresAt: new Date(Date.now() + processingTtlMs), updatedAt: new Date() },
      });
      if (reclaimed.count === 1) return { replay: false };
    }
    throw new IdempotencyInProgressError();
  }
  try {
    await tx.idempotencyReceipt.create({
      data: {
        companyId: opts.companyId, scope: opts.scope, key: opts.key, requestHash, status: 'PROCESSING',
        expiresAt: new Date(Date.now() + processingTtlMs),
      },
    });
    return { replay: false };
  } catch (error) {
    // race: row dibuat transaksi lain — perlakukan sebagai replay
    const dup = await tx.idempotencyReceipt.findUnique({ where: { companyId_scope_key: { companyId: opts.companyId, scope: opts.scope, key: opts.key } } });
    if (!dup) throw error;
    if (dup.requestHash !== requestHash) throw new IdempotencyConflictError();
    if (dup.status === 'COMPLETED') return { replay: true, status: 'COMPLETED', response: (dup.response as T) ?? null };
    throw new IdempotencyInProgressError();
  }
}

/** Simpan hasil sukses ke receipt. */
export async function completeIdempotent(
  tx: DbClient,
  opts: { companyId: string; scope: string; key: string; resourceType?: string; resourceId?: string; response: unknown },
): Promise<void> {
  await tx.idempotencyReceipt.updateMany({
    where: { companyId: opts.companyId, scope: opts.scope, key: opts.key, status: 'PROCESSING' },
    data: { status: 'COMPLETED', resourceType: opts.resourceType, resourceId: opts.resourceId, response: (opts.response as Prisma.InputJsonValue) ?? Prisma.JsonNull },
  });
}

/** Hapus receipt gagal supaya retry dengan key sama bisa diproses ulang. */
export async function releaseIdempotent(tx: DbClient, opts: { companyId: string; scope: string; key: string }): Promise<void> {
  await tx.idempotencyReceipt.deleteMany({ where: { companyId: opts.companyId, scope: opts.scope, key: opts.key, status: 'PROCESSING' } });
}

export class IdempotencyConflictError extends BadRequestException {
  constructor() {
    super('Idempotency key dipakai ulang dengan payload berbeda.');
  }
}

export class IdempotencyInProgressError extends ConflictException {
  constructor() {
    super('Permintaan dengan idempotency key ini masih diproses; ulangi dengan key yang sama setelah proses selesai.');
  }
}
