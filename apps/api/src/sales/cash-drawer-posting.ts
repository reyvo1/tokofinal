import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * The till's 1101 balance is a GL asset. Cash moved to/from a different asset is a transfer,
 * NOT new revenue or an expense. Only Finance may configure the opposite account through a
 * versioned AccountingPostingRule. A cashier never supplies an account code.
 */
export const DRAWER_ACCOUNT_CODE = '1101';

export type CashDrawerPostingEvent =
  | 'CASH_DRAWER_TRANSFER_IN'
  | 'CASH_DRAWER_TRANSFER_OUT'
  | 'CASHIER_SHIFT_SHORT'
  | 'CASHIER_SHIFT_OVER';

const CONTRACTS: Record<CashDrawerPostingEvent, {
  drawerSide: 'DEBIT' | 'CREDIT';
  oppositeSide: 'DEBIT' | 'CREDIT';
  oppositeType: 'ASSET' | 'EXPENSE' | 'REVENUE';
}> = {
  CASH_DRAWER_TRANSFER_IN: { drawerSide: 'DEBIT', oppositeSide: 'CREDIT', oppositeType: 'ASSET' },
  CASH_DRAWER_TRANSFER_OUT: { drawerSide: 'CREDIT', oppositeSide: 'DEBIT', oppositeType: 'ASSET' },
  CASHIER_SHIFT_SHORT: { drawerSide: 'CREDIT', oppositeSide: 'DEBIT', oppositeType: 'EXPENSE' },
  CASHIER_SHIFT_OVER: { drawerSide: 'DEBIT', oppositeSide: 'CREDIT', oppositeType: 'REVENUE' },
};

export function inspectCashDrawerPostingRule(eventType: CashDrawerPostingEvent, value: unknown): string {
  const contract = CONTRACTS[eventType];
  if (!Array.isArray(value) || value.length !== 2) {
    throw new BadRequestException(`Aturan ${eventType} wajib memiliki tepat dua baris jurnal.`);
  }
  const rows = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException(`Baris aturan ${eventType} tidak valid.`);
    }
    return item as Record<string, unknown>;
  });
  // Finance's existing Admin editor emits literal accountCode, not accountCodeKey.
  // Accept both representations while keeping the exact cash account/type invariant.
  const drawer = rows.filter((line) => (line.accountCodeKey === 'drawerCash' && !line.accountCode)
    || (typeof line.accountCode === 'string' && line.accountCode.trim().toUpperCase() === DRAWER_ACCOUNT_CODE && !line.accountCodeKey));
  const opposite = rows.filter((line) => typeof line.accountCode === 'string'
    && line.accountCode.trim().toUpperCase() !== DRAWER_ACCOUNT_CODE && !line.accountCodeKey);
  if (drawer.length !== 1 || opposite.length !== 1
      || drawer[0].side !== contract.drawerSide || drawer[0].amountKey !== 'gross'
      || (drawer[0].accountCodeKey && drawer[0].accountCodeKey !== 'drawerCash')
      || opposite[0].side !== contract.oppositeSide || opposite[0].amountKey !== 'gross') {
    throw new BadRequestException(`Aturan ${eventType} harus memasangkan akun kas laci dan akun lawan pada nominal yang sama.`);
  }
  const code = String(opposite[0].accountCode).trim().toUpperCase();
  if (!code || code === DRAWER_ACCOUNT_CODE) {
    throw new BadRequestException(`Akun lawan ${eventType} wajib berbeda dari kas laci.`);
  }
  return code;
}

/** Check the EXACT active rule AccountingCore will resolve for this business date, inside the
 * caller's SERIALIZABLE transaction. This is a semantic guard in addition to Core's balancing,
 * period-close, tenant-account and idempotent posting enforcement.
 */
export async function assertCashDrawerPostingRule(
  tx: Prisma.TransactionClient,
  scope: { companyId: string; branchId: string },
  eventType: CashDrawerPostingEvent,
  businessDate: Date,
): Promise<void> {
  const rule = await tx.accountingPostingRule.findFirst({
    where: {
      companyId: scope.companyId, eventType, status: 'ACTIVE',
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: businessDate } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDate } }] },
      ],
    },
    orderBy: [{ priority: 'asc' }, { version: 'desc' }],
  });
  if (!rule) throw new BadRequestException(`Aturan Accounting Core ${eventType} belum diaktifkan Finance. Mutasi kas diblokir.`);
  const oppositeCode = inspectCashDrawerPostingRule(eventType, rule.journalLines);
  const accounts = await tx.account.findMany({
    where: { branchId: scope.branchId, code: { in: [DRAWER_ACCOUNT_CODE, oppositeCode] }, isActive: true, branch: { companyId: scope.companyId } },
    select: { code: true, type: true },
  });
  const drawerAccount = accounts.find((row) => row.code === DRAWER_ACCOUNT_CODE);
  const oppositeAccount = accounts.find((row) => row.code === oppositeCode);
  if (!drawerAccount || drawerAccount.type !== 'ASSET') {
    throw new BadRequestException('Akun kas laci 1101 ASSET tidak aktif atau bukan milik cabang ini.');
  }
  if (!oppositeAccount || oppositeAccount.type !== CONTRACTS[eventType].oppositeType) {
    throw new BadRequestException(`Akun lawan ${eventType} harus ${CONTRACTS[eventType].oppositeType} aktif pada cabang.`);
  }
}
