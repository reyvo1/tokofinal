import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PUBLIC_PAGE_LIMIT = 100;

export interface CursorPageInfo {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CursorPage<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}

export function parsePageLimit(value?: string, maximum = MAX_PUBLIC_PAGE_LIMIT): number {
  if (value === undefined || value === '') return DEFAULT_PAGE_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException('limit harus berupa bilangan bulat positif.');
  return Math.min(parsed, maximum);
}

export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends object>(cursor?: string): T | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('invalid cursor');
    return decoded;
  } catch {
    throw new BadRequestException('cursor tidak valid.');
  }
}

export function toCursorPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (item: T) => Record<string, string | number>,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    pageInfo: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
    },
  };
}
