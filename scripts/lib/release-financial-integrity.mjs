/**
 * Release-time, read-only validation of the canonical /reports/financial-integrity response.
 * HTTP 200 is only transport success. Never promote a failing/partial accounting report.
 */
function fail(reason, report) {
  const status = typeof report?.status === 'string' ? report.status : '<missing>';
  const blockers = report?.blockers ?? '<missing>';
  const trial = report?.trialBalance?.difference ?? '<missing>';
  const balance = report?.balanceSheet?.difference ?? '<missing>';
  const journals = Array.isArray(report?.unbalancedJournalIds) ? report.unbalancedJournalIds.length : '<missing>';
  throw new Error(`Financial integrity release gate FAIL: ${reason}; status=${status}; blockers=${blockers}; trialDifference=${trial}; balanceDifference=${balance}; unbalancedJournals=${journals}`);
}

function zeroCount(report, name) {
  const value = report[name];
  if (!Number.isSafeInteger(value) || value !== 0) fail(`${name} harus integer 0`, report);
}

function finiteMoney(report, obj, field, label) {
  const value = obj?.[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label}.${field} harus angka finite`, report);
  return value;
}

export function assertReleaseFinancialIntegrity(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('respons JSON object wajib', report);
  if (report.status !== 'PASS') fail('status akuntansi bukan PASS', report);
  if (!report.trialBalance || report.trialBalance.balanced !== true) fail('trial balance tidak seimbang', report);
  if (!report.balanceSheet || report.balanceSheet.balanced !== true) fail('neraca tidak seimbang', report);
  const debit = finiteMoney(report, report.trialBalance, 'debit', 'trialBalance');
  const credit = finiteMoney(report, report.trialBalance, 'credit', 'trialBalance');
  if (debit !== credit || finiteMoney(report, report.trialBalance, 'difference', 'trialBalance') !== 0) {
    fail('debit/kredit/difference trial balance tidak sama dengan nol', report);
  }
  if (finiteMoney(report, report.balanceSheet, 'difference', 'balanceSheet') !== 0) fail('balanceSheet.difference bukan nol', report);
  if (!Array.isArray(report.unbalancedJournalIds) || report.unbalancedJournalIds.length !== 0) {
    fail('jurnal tidak seimbang/daftar jurnal invalid', report);
  }
  for (const field of [
    'postedEventsMissingJournal', 'failedEvents', 'queuedEvents', 'unresolvedEvents',
    'pendingFinanceTransactions', 'nonPostedTaxTransactions', 'blockers', 'warnings',
  ]) zeroCount(report, field);
  return { status: 'PASS', blockers: 0, unbalancedJournals: 0, trialBalanceDifference: 0, balanceSheetDifference: 0 };
}
