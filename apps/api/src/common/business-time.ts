import { BadRequestException } from '@nestjs/common';

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new BadRequestException('Timezone company tidak valid.');
  }
}

export function zonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  assertTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
  second = 0,
  millisecond = 0,
): Date {
  assertTimeZone(timeZone);
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let guess = new Date(localEpoch);
  for (let i = 0; i < 4; i += 1) {
    const actual = zonedDateParts(guess, timeZone);
    const actualEpoch = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, second, millisecond);
    const delta = actualEpoch - localEpoch;
    if (delta === 0) return guess;
    guess = new Date(guess.getTime() - delta);
  }
  return guess;
}

function nextLocalDay(parts: ZonedDateParts): { year: number; month: number; day: number } {
  const local = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  local.setUTCDate(local.getUTCDate() + 1);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

export function businessDateKey(date: Date, timeZone: string): string {
  const parts = zonedDateParts(date, timeZone);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

export function businessHour(date: Date, timeZone: string): number {
  return zonedDateParts(date, timeZone).hour;
}

export function businessDayBounds(at: Date, timeZone: string): { start: Date; end: Date; dateKey: string } {
  const parts = zonedDateParts(at, timeZone);
  const start = zonedLocalToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone);
  const next = nextLocalDay(parts);
  const nextStart = zonedLocalToUtc(next.year, next.month, next.day, 0, 0, timeZone);
  return { start, end: new Date(nextStart.getTime() - 1), dateKey: businessDateKey(at, timeZone) };
}

export function businessMonthStart(at: Date, timeZone: string): Date {
  const parts = zonedDateParts(at, timeZone);
  return zonedLocalToUtc(parts.year, parts.month, 1, 0, 0, timeZone);
}

export function startOfBusinessDaysAgo(at: Date, timeZone: string, daysAgo: number): Date {
  if (!Number.isInteger(daysAgo) || daysAgo < 0) throw new BadRequestException('Rentang hari tidak valid.');
  const parts = zonedDateParts(at, timeZone);
  const local = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  local.setUTCDate(local.getUTCDate() - daysAgo);
  return zonedLocalToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), 0, 0, timeZone);
}

export function parseBusinessDateBoundary(
  value: string | undefined,
  fallback: Date,
  timeZone: string,
  endOfDay = false,
): Date {
  if (!value) return fallback;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateOnly) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Format tanggal tidak valid.');
    return parsed;
  }
  const year = Number(dateOnly[1]);
  const month = Number(dateOnly[2]);
  const day = Number(dateOnly[3]);
  const validity = new Date(Date.UTC(year, month - 1, day));
  if (validity.getUTCFullYear() !== year || validity.getUTCMonth() + 1 !== month || validity.getUTCDate() !== day) {
    throw new BadRequestException('Format tanggal tidak valid.');
  }
  if (!endOfDay) return zonedLocalToUtc(year, month, day, 0, 0, timeZone);
  validity.setUTCDate(validity.getUTCDate() + 1);
  const nextStart = zonedLocalToUtc(validity.getUTCFullYear(), validity.getUTCMonth() + 1, validity.getUTCDate(), 0, 0, timeZone);
  return new Date(nextStart.getTime() - 1);
}
