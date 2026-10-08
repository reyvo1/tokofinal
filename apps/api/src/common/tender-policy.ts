import { Prisma } from '@prisma/client';

export type TenderKind = 'CASH' | 'SETTLEMENT';
export type TenderSettlementBehavior = 'IMMEDIATE' | 'CLEARING';
export type TenderRefundBehavior = 'ORIGINAL' | 'CASH' | 'SETTLEMENT' | 'RECEIVABLE' | 'DISABLED';

export type TenderPolicy = {
  kind: TenderKind;
  settlementAccountCode: string;
  settlementBehavior: TenderSettlementBehavior;
  requiresProvider: boolean;
  requiresReference: boolean;
  refundBehavior: TenderRefundBehavior;
  refundAccountCode?: string;
  allowOffline: boolean;
  allowCashChange: boolean;
  feeAccountCode?: string;
  feeRatePercent: number;
};

type JsonObject = Record<string, unknown>;

const ACCOUNT_CODE = /^[A-Z0-9._-]{1,40}$/i;

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function legacyTenderPolicy(code: string): TenderPolicy {
  const normalized = code.trim().toUpperCase();
  const cash = normalized === 'CASH';
  return {
    kind: cash ? 'CASH' : 'SETTLEMENT',
    settlementAccountCode: cash ? '1101' : '1102',
    settlementBehavior: 'IMMEDIATE',
    requiresProvider: false,
    requiresReference: false,
    refundBehavior: cash ? 'CASH' : 'SETTLEMENT',
    ...(cash ? { refundAccountCode: '1101' } : {}),
    allowOffline: cash,
    allowCashChange: cash,
    feeRatePercent: 0,
  };
}

export function normalizeTenderPolicy(code: string, metadata: Prisma.JsonValue | JsonObject | null | undefined): TenderPolicy {
  const fallback = legacyTenderPolicy(code);
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as JsonObject : {};
  const kind = text(source.kind) || fallback.kind;
  const settlementBehavior = text(source.settlementBehavior) || fallback.settlementBehavior;
  const refundBehavior = text(source.refundBehavior) || fallback.refundBehavior;
  const settlementAccountCode = text(source.settlementAccountCode) || fallback.settlementAccountCode;
  const feeAccountCode = text(source.feeAccountCode) || undefined;
  const refundAccountCode = text(source.refundAccountCode) || fallback.refundAccountCode;
  const rawRate = source.feeRatePercent;
  const feeRatePercent = rawRate === undefined || rawRate === null || rawRate === '' ? fallback.feeRatePercent : Number(rawRate);

  if (!['CASH', 'SETTLEMENT'].includes(kind)) throw new Error('kind tender harus CASH atau SETTLEMENT.');
  if (!['IMMEDIATE', 'CLEARING'].includes(settlementBehavior)) throw new Error('settlementBehavior tender harus IMMEDIATE atau CLEARING.');
  if (!['ORIGINAL', 'CASH', 'SETTLEMENT', 'RECEIVABLE', 'DISABLED'].includes(refundBehavior)) throw new Error('refundBehavior tender tidak valid.');
  if (!ACCOUNT_CODE.test(settlementAccountCode)) throw new Error('settlementAccountCode tender wajib berupa kode akun yang valid.');
  if (feeAccountCode && !ACCOUNT_CODE.test(feeAccountCode)) throw new Error('feeAccountCode tender tidak valid.');
  if (refundAccountCode && !ACCOUNT_CODE.test(refundAccountCode)) throw new Error('refundAccountCode tender tidak valid.');
  if (!Number.isFinite(feeRatePercent) || feeRatePercent < 0 || feeRatePercent > 100) throw new Error('feeRatePercent tender harus 0 sampai 100.');
  if (feeRatePercent > 0 && !feeAccountCode) throw new Error('feeAccountCode wajib saat feeRatePercent lebih dari 0.');

  const policy: TenderPolicy = {
    kind: kind as TenderKind,
    settlementAccountCode,
    settlementBehavior: settlementBehavior as TenderSettlementBehavior,
    requiresProvider: bool(source.requiresProvider, fallback.requiresProvider),
    requiresReference: bool(source.requiresReference, fallback.requiresReference),
    refundBehavior: refundBehavior as TenderRefundBehavior,
    ...(refundAccountCode ? { refundAccountCode } : {}),
    allowOffline: bool(source.allowOffline, fallback.allowOffline),
    allowCashChange: bool(source.allowCashChange, fallback.allowCashChange),
    feeRatePercent,
    ...(feeAccountCode ? { feeAccountCode } : {}),
  };
  if (policy.kind !== 'CASH' && policy.allowCashChange) throw new Error('allowCashChange hanya boleh aktif untuk tender kind CASH.');
  if (policy.refundBehavior === 'CASH' && !policy.refundAccountCode) throw new Error('refundAccountCode wajib untuk refundBehavior CASH.');
  return policy;
}

export function tenderPolicyMetadata(policy: TenderPolicy): Prisma.InputJsonValue {
  return {
    kind: policy.kind,
    settlementAccountCode: policy.settlementAccountCode,
    settlementBehavior: policy.settlementBehavior,
    requiresProvider: policy.requiresProvider,
    requiresReference: policy.requiresReference,
    refundBehavior: policy.refundBehavior,
    ...(policy.refundAccountCode ? { refundAccountCode: policy.refundAccountCode } : {}),
    allowOffline: policy.allowOffline,
    allowCashChange: policy.allowCashChange,
    feeRatePercent: policy.feeRatePercent,
    ...(policy.feeAccountCode ? { feeAccountCode: policy.feeAccountCode } : {}),
  };
}
