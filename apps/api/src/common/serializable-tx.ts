// Retry helper untuk transaksi serializable yang gagal karena konflik concurrency (P2034 / P2002).
// Dipakai modul stok agar retry concurrency standar di satu tempat (w1-atomic-stock-mutation).
import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

const RETRYABLE = new Set(['P2034', 'P2002', 'P2024', 'P2028']); // conflict, unique, timeout // write conflict / unique constraint
const MAX_RETRY = 3;

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return RETRYABLE.has(error.code) || /timeout/i.test(error.message ?? '');
}

/**
 * Jalankan fn dalam transaksi serializable dengan retry otomatis pada konflik tulis.
 * backoff: 50ms, 150ms, 450ms (eksponensial + jitter).
 */
export async function serializableTx<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { maxRetry?: number },
): Promise<T> {
  const maxRetry = opts?.maxRetry ?? MAX_RETRY;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetry || !isRetryable(error)) {
        if (isRetryable(error)) throw new HttpException('Transaksi sibuk karena permintaan bersamaan; ulangi sesaat lagi.', HttpStatus.CONFLICT);
        throw error;
      }
      const jitter = Math.floor(Math.random() * 40);
      await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(3, attempt - 1) + jitter));
    }
  }
}
