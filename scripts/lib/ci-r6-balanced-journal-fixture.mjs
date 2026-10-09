/** CI-only R6 analytical materialization fixture, never used in business posting. */
export function balancedR6JournalLines(debitAccountId, creditAccountId, amount = 50000) {
  if (typeof debitAccountId !== 'string' || !debitAccountId.trim()
    || typeof creditAccountId !== 'string' || !creditAccountId.trim()
    || debitAccountId === creditAccountId) {
    throw new Error('R6 fixture memerlukan dua akun GL aktif berbeda pada tenant/cabang yang sama.');
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('R6 fixture amount harus integer positif.');
  return [
    { accountId: debitAccountId, debit: amount, credit: 0 },
    { accountId: creditAccountId, debit: 0, credit: amount },
  ];
}
