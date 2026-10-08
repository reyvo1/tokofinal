'use client';
import { authFetch } from '../auth-fetch';
// Modul Akuntansi & Kas — W3 functional surface: operational finance, period close, bank reconciliation.
import { useEffect, useRef, useState } from 'react';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { Panel, Table, StatusChip, rupiah, tanggal } from '../ui';
import TaxWorkspace from './tax-workspace';
import ReportingWorkspace from './reporting-workspace';
import FinanceDepthWorkspace from './finance-depth-workspace';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type JournalEvent = { id: string; eventType: string; status: string; sourceType?: string; sourceId?: string; businessDate?: string; grossAmount?: string | number; createdAt: string };
type PostingRuleLine = { accountCode?: string; accountCodeKey?: string; side: 'DEBIT'|'CREDIT'; amountKey: string; description?: string; skipIfZero?: boolean };
type PostingRule = { id: string; code: string; version: number; name: string; eventType: string; priority: number; status: 'DRAFT'|'ACTIVE'|'INACTIVE'; effectiveFrom?: string | null; effectiveTo?: string | null; journalLines: PostingRuleLine[] };
type AccountingEventDetail = { event: JournalEvent & { lines: Array<{ id: string; lineNumber: number; description?: string | null; netAmount: string | number; taxAmount: string | number; grossAmount: string | number }>; postings: Array<{ id: string; ruleId?: string | null; journalEntryId: string; status: string; postedAt: string; postingTrace?: unknown }>; taxTransactions: Array<{ id: string; direction: string; taxableBase: string | number; taxAmount: string | number; taxCodeId: string }> }; rules: PostingRule[]; journalEntry: null | { id: string; number: string; date: string; referenceType: string; referenceId: string; description: string; lines: Array<{ id: string; debit: string | number; credit: string | number; account: { id: string; code: string; name: string; type: string } }> }; source: { type: string; id: string } };
type TaxCode = { id: string; code: string; name: string; rate: string | number; scope: string; status: string };
type Account = { id: string; code: string; name: string; type: string; isActive: boolean };
type FinanceTx = {
  id: string; number: string; type: string; description?: string; grossAmount: string | number;
  debitAccountCode: string; creditAccountCode: string; status: string; transactionDate?: string; createdAt: string;
};
type SupplierPayable = {
  referenceType: 'GoodsReceipt' | 'Asset' | 'MaintenanceWorkOrder' | 'FuelTransaction'; referenceId: string; documentNumber: string;
  goodsReceiptId?: string; goodsReceiptNumber?: string; purchaseOrderNumber?: string; assetId?: string; assetCode?: string;
  assetName?: string; sourceName?: string; supplierId: string; supplierName: string; transactionDate?: string; receivedAt?: string;
  grossAmount: string | number; returnedAmount: string | number; paidAmount: string | number; pendingPaymentAmount: string | number;
  outstandingAmount: string | number; availableToPay: string | number;
};
type SupplierRefund = { purchaseReturnId: string; purchaseReturnNumber: string; supplierId: string; supplierName: string; creditNoteNumber?: string | null; receivableAmount: string | number; receivedAmount: string | number; pendingAmount: string | number; outstandingAmount: string | number; availableToReceive: string | number };
type CustomerReceivable = { referenceType: 'Order' | 'Sale'; referenceId: string; documentNumber: string; orderId?: string; orderNumber?: string; saleId?: string; saleNumber?: string; customerName: string; customerPhone?: string | null; paymentMethod: string; receivableAccountCode: string; grossAmount: string | number; receivedAmount: string | number; pendingAmount: string | number; outstandingAmount: string | number; availableToReceive: string | number; sourceStatus: string };
type FinanceType = 'OPERATING_EXPENSE' | 'OTHER_INCOME' | 'TAX_PAYMENT' | 'SUPPLIER_PAYMENT' | 'SUPPLIER_REFUND' | 'CUSTOMER_RECEIPT' | 'CASH_TRANSFER';
type FiscalPeriod = { id: string; name: string; startDate: string; endDate: string; status: 'OPEN' | 'SOFT_CLOSED' | 'CLOSED'; closedAt?: string | null };
/**
 * Server-side allow-lists, mirrored here so the UI cannot offer an option the server will reject.
 * Source of truth: `finance-operations.service.ts` — tax payment only accepts these payable codes,
 * and a supplier refund must credit exactly the refund-receivable account. Offering a wider list is
 * not "more flexible", it is offering a 400.
 */
const TAX_PAYABLE_ALLOWED = ['2103', '2201', '2202'] as const;
const SUPPLIER_REFUND_RECEIVABLE = '1202';

type AccountingCloseControl = { id: string; module: string; periodStart: string; periodEnd: string; status: 'OPEN'|'CLOSED'; closedAt?: string | null; reopenReason?: string | null };
type StatementLine = { id: string; transactionDate: string; description: string; reference?: string | null; debit: string | number; credit: string | number; balance?: string | number | null; matched: boolean; matchedType?: string | null; matchedId?: string | null };
type BankStatement = { id: string; bankAccountId?: string | null; source: string; fileName?: string | null; periodStart?: string | null; periodEnd?: string | null; openingBalance?: string | number | null; closingBalance?: string | number | null; lines: StatementLine[] };
type BankReconciliation = { id: string; bankAccountId?: string | null; statementId?: string | null; status: string; startDate: string; endDate: string; bookBalance: string | number; bankBalance: string | number; difference: string | number; matchedCount: number };
type JournalLine = { id: string; debit: string | number; credit: string | number; journalEntry: { id: string; number: string; date: string; referenceType: string; referenceId: string; description: string } };
type ReconciliationDetails = { reconciliation: BankReconciliation; statementLines: StatementLine[]; journalLines: JournalLine[] };

// The permission each finance action requires, mirroring finance-operations.controller.ts.
const FINANCE_ACTION_PERMISSION: Record<string, string> = {
  approve: 'finance.approve',
  reject: 'finance.approve',
  cancel: 'finance.approve',
  post: 'finance.post',
};

const FINANCE_ACTION_LABEL: Record<string, string> = {
  approve: 'Setujui',
  reject: 'Tolak',
  cancel: 'Batalkan',
  post: 'Posting',
};

// post writes to the general ledger through accounting core with no undo path from this
// screen, so it is confirmed explicitly rather than firing on a single click.
const FINANCE_ACTION_REQUIRES_REASON: Record<string, boolean> = { approve: false, post: false, reject: true, cancel: true };

const FINANCE_ACTION_HELP: Record<string, string> = {
  approve: 'Menyetujui transaksi keuangan. Tindakan ini menulis status baru dan tercatat pada audit trail.',
  post: 'Posting menulis jurnal ke buku besar melalui accounting core dan tidak dapat dibatalkan dari layar ini. Pastikan rekonsiliasi sudah benar.',
  reject: 'Alasan wajib diisi sebagai evidence operasional.',
  cancel: 'Alasan wajib diisi sebagai evidence operasional.',
};

const PERIOD_ACTION_LABEL: Record<string, string> = {
  'soft-close': 'Soft close',
  reopen: 'Reopen',
  close: 'Final close',
};

const PERIOD_ACTION_HELP: Record<string, string> = {
  'soft-close': 'Soft close mencegah posting baru pada periode ini tetapi masih dapat dibuka kembali.',
  reopen: 'Membuka kembali periode soft-closed agar posting dapat dilanjutkan.',
  close: 'Final close mengunci periode secara permanen dari workflow ini dan memblokir seluruh posting berikutnya. Alasan wajib diisi dan tersimpan pada audit trail.',
};
type CursorResponse<T> = T[] | { items?: T[] };

function newRequestKey() { return `finance:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
function isoDate(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
function parseMoney(value: string) {
  const normalized = value.trim().replace(/\s+/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const result = Number(normalized || 0);
  if (!Number.isFinite(result)) throw new Error(`Nominal tidak valid: ${value}`);
  return result;
}
function parseStatementText(text: string) {
  const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const result: Array<{ transactionDate: string; description: string; reference?: string; debit?: number; credit?: number; balance?: number }> = [];
  for (const [index, row] of rows.entries()) {
    const separator = row.includes('|') ? '|' : ',';
    const cells = row.split(separator).map((cell) => cell.trim());
    if (index === 0 && !/^\d{4}-\d{2}-\d{2}/.test(cells[0] ?? '')) continue;
    if (cells.length < 5) throw new Error(`Baris ${index + 1}: format harus tanggal|deskripsi|referensi|debit|credit|balance.`);
    const debit = parseMoney(cells[3] ?? '0');
    const credit = parseMoney(cells[4] ?? '0');
    const balanceText = cells[5]?.trim();
    result.push({
      transactionDate: cells[0], description: cells[1], reference: cells[2] || undefined,
      debit: debit || undefined, credit: credit || undefined,
      balance: balanceText ? parseMoney(balanceText) : undefined,
    });
  }
  if (!result.length) throw new Error('Bank statement belum memiliki baris transaksi.');
  return result;
}

export default function AccountingView({ token, mode }: { token: string; mode?: string | null }) {
  // D-3: the API splits finance mutations across two permissions — approve/reject/cancel
  // need finance.approve, posting to the ledger needs finance.post. Rendering both sets
  // unconditionally meant a finance.view-only operator saw buttons that could only 403.
  const { canAll, identity } = usePermissions(token);
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [postingRules, setPostingRules] = useState<PostingRule[]>([]);
  const [eventDetail, setEventDetail] = useState<AccountingEventDetail | null>(null);
  const [finances, setFinances] = useState<FinanceTx[]>([]);
  const [payables, setPayables] = useState<SupplierPayable[]>([]);
  const [supplierRefunds, setSupplierRefunds] = useState<SupplierRefund[]>([]);
  const [customerReceivables, setCustomerReceivables] = useState<CustomerReceivable[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [closeControls, setCloseControls] = useState<AccountingCloseControl[]>([]);
  const [closeControlForm, setCloseControlForm] = useState({ module: 'ACCOUNTING', periodStart: '', periodEnd: '' });
  const [reopenReasons, setReopenReasons] = useState<Record<string, string>>({});
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [reconciliations, setReconciliations] = useState<BankReconciliation[]>([]);
  const [reconDetails, setReconDetails] = useState<ReconciliationDetails | null>(null);
  const [manualMatches, setManualMatches] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [financeDialog, setFinanceDialog] = useState<{ transaction: FinanceTx; action: 'approve' | 'reject' | 'cancel' | 'post'; notes: string } | null>(null);
  // Final close is the terminal state of the fiscal period lifecycle: after it the period
  // cannot be reopened from this workflow, so it requires an explicit typed confirmation
  // with a reason — the same bar the less destructive accounting close-control reopen has.
  const [periodDialog, setPeriodDialog] = useState<{ period: FiscalPeriod; action: 'soft-close' | 'close' | 'reopen'; notes: string } | null>(null);
  const [accountEditDialog, setAccountEditDialog] = useState<{ account: Account; name: string } | null>(null);
  const requestKey = useRef(newRequestKey());
  const [form, setForm] = useState({
    type: 'OPERATING_EXPENSE' as FinanceType, description: '', amount: 0, settlementAccount: '', transferTargetAccount: '',
    taxPayableAccount: '', supplierPayableKey: '', purchaseReturnId: '', customerOrderId: '', requireApproval: false,
    // Enam peran akun ini dulunya KODE AKUN TERTANAM ('6101', '4103', '2101', '1202', ...). Itu
    // berarti jurnal kas/bank masuk ke akun yang mungkin tidak ada di chart of accounts perusahaan
    // ini — kode itu milik template, bukan milik DB. Sekarang kasir memilih sendiri dari daftar akun
    // yang benar-benar ada, dan akun terbaik (mis. 'Beban operasional') hanya dipakai sebagai
    // fallback kalau perusahaan belum punya akun untuk peran itu.
    operatingExpenseAccount: '', otherIncomeAccount: '', supplierPayableAccount: '', supplierRefundAccount: '',
    bankSettlementAccount: '',
  });
  const [periodForm, setPeriodForm] = useState({ name: '', startDate: '', endDate: '' });
  const [accountForm, setAccountForm] = useState({ code: '', name: '', type: 'ASSET' });
  const [ruleForm, setRuleForm] = useState({ code: '', version: 1, name: '', eventType: '', priority: 100, status: 'DRAFT', effectiveFrom: '', effectiveTo: '', journalLinesText: 'DEBIT|1101|gross|Kas/Bank\nCREDIT|4101|net|Pendapatan' });
  const [manualEventForm, setManualEventForm] = useState({ eventType: '', sourceType: 'MANUAL', sourceId: '', businessDate: new Date().toISOString().slice(0,10), currency: 'IDR', amountsText: 'gross=0', accountCodesText: '' });
  const [statementForm, setStatementForm] = useState({ bankAccountId: '', source: 'MANUAL', fileName: '', periodStart: '', periodEnd: '', openingBalance: '', closingBalance: '', linesText: '' });
  const [reconForm, setReconForm] = useState({ statementId: '', startDate: '', endDate: '' });

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data.message === 'string' ? data.message : Array.isArray(data.message) ? data.message.join(', ') : data?.message?.message ?? data?.error ?? 'Permintaan gagal.';
      throw new Error(detail);
    }
    return data as T;
  }

  async function refresh() {
    try {
      // The whole accounting surface is @Roles(FINANCE|AUDITOR|MANAGER|OWNER|ADMIN) behind
      // finance.view or tax.view. The finance workspace gate is finance|accounting|tax, which
      // PAYROLL passes on tax.view and accounting.event.view — so every one of these reads 403'd
      // for that role and blanked the workspace it was entitled to. readOptional degrades an
      // authorization failure to an empty slice; a real failure still propagates.
      const [ev, tx, ac, pr, fin, ap, sr, cr, fp, cc, bs, br] = await Promise.all([
        readOptional(identity, '/accounting-core/events?limit=20', [] as CursorResponse<JournalEvent>, (p) => api<CursorResponse<JournalEvent>>(p)),
        readOptional(identity, '/accounting-core/tax-codes', [] as CursorResponse<TaxCode>, (p) => api<CursorResponse<TaxCode>>(p)),
        readOptional(identity, '/accounting-core/accounts', [] as Account[], (p) => api<Account[]>(p)),
        readOptional(identity, '/accounting-core/posting-rules', [] as PostingRule[], (p) => api<PostingRule[]>(p)),
        readOptional(identity, '/finance-operations?limit=50', [] as CursorResponse<FinanceTx>, (p) => api<CursorResponse<FinanceTx>>(p)),
        readOptional(identity, '/finance-operations/supplier-payables', [] as SupplierPayable[], (p) => api<SupplierPayable[]>(p)),
        readOptional(identity, '/finance-operations/supplier-refunds', [] as SupplierRefund[], (p) => api<SupplierRefund[]>(p)),
        readOptional(identity, '/finance-operations/customer-receivables', [] as CustomerReceivable[], (p) => api<CustomerReceivable[]>(p)),
        readOptional(identity, '/finance/fiscal-periods', [] as FiscalPeriod[], (p) => api<FiscalPeriod[]>(p)),
        readOptional(identity, '/accounting-core/close-controls', [] as AccountingCloseControl[], (p) => api<AccountingCloseControl[]>(p)),
        readOptional(identity, '/finance/bank-statements', [] as BankStatement[], (p) => api<BankStatement[]>(p)),
        readOptional(identity, '/finance/reconciliations', [] as BankReconciliation[], (p) => api<BankReconciliation[]>(p)),
      ]);
      const accountRows = ac;
      const activeAccountRows = ac.filter((row) => row.isActive);
      const assetAccounts = activeAccountRows.filter((row) => row.type === 'ASSET');
      // Helper peran-akun: pilih akun yang SESUAI dengan perannya dari chart of accounts asli.
      // `preferred` hanya fallback supaya form tetap terisi pada DB yang belum punya akun untuk
      // peran itu — dan kalau preferred tidak ada, form dibiarkan kosong supaya kasir memilih,
      // bukan kita menebak akun.
      const byType = (type: string) => activeAccountRows.filter((row) => row.type === type);
      const pickAccount = (current: string, type: string, preferred: string) => {
        if (current && activeAccountRows.some((row) => row.code === current)) return current;
        const pool = byType(type);
        return pool.find((row) => row.code === preferred)?.code ?? pool[0]?.code ?? '';
      };
      setEvents(Array.isArray(ev) ? ev : ev.items ?? []); setTaxCodes(Array.isArray(tx) ? tx : tx.items ?? []); setAccounts(accountRows); setPostingRules(pr);
      setFinances(Array.isArray(fin) ? fin : fin.items ?? []); setPayables(ap); setSupplierRefunds(sr); setCustomerReceivables(cr);
      setPeriods(fp); setCloseControls(cc); setStatements(bs); setReconciliations(br);
      setForm((current) => ({
        ...current,
        settlementAccount: pickAccount(current.settlementAccount, 'ASSET', '1101'),
        transferTargetAccount: pickAccount(current.transferTargetAccount, 'ASSET', '1102'),
        taxPayableAccount: pickAccount(current.taxPayableAccount, 'LIABILITY', '2201'),
        operatingExpenseAccount: pickAccount(current.operatingExpenseAccount, 'EXPENSE', '6101'),
        otherIncomeAccount: pickAccount(current.otherIncomeAccount, 'REVENUE', '4103'),
        supplierPayableAccount: pickAccount(current.supplierPayableAccount, 'LIABILITY', '2101'),
        // Refund supplier bukan pilihan kasir: server hanya menerima 1202. Di-set, bukan dipilih.
        supplierRefundAccount: SUPPLIER_REFUND_RECEIVABLE,
        bankSettlementAccount: pickAccount(current.bankSettlementAccount, 'ASSET', '1102'),
        supplierPayableKey: current.supplierPayableKey || (() => { const row = ap.find((item) => Number(item.availableToPay) > 0); return row ? `${row.referenceType}:${row.referenceId}` : ''; })(),
        purchaseReturnId: current.purchaseReturnId || sr.find((row) => Number(row.availableToReceive) > 0)?.purchaseReturnId || '',
        customerOrderId: current.customerOrderId || (() => { const row=cr.find((item) => Number(item.availableToReceive) > 0); return row ? `${row.referenceType}:${row.referenceId}` : ''; })(),
      }));
      // Bank mutasStatements: pilih dari akun kas/bank yang benar-benar ada. Template lama mengunci
      // '1102' — perusahaan tanpa akun itu akan mendapat rekening pertama secara diam-diam.
      const bankLike = activeAccountRows.filter((row) => row.type === 'ASSET' && /bank|kas|cash/i.test(`${row.code} ${row.name}`));
      setStatementForm((current) => ({ ...current, bankAccountId: current.bankAccountId || bankLike[0]?.id || assetAccounts[0]?.id || '' }));
      setReconForm((current) => {
        if (current.statementId || !bs.length) return current;
        const first = bs[0];
        return { statementId: first.id, startDate: isoDate(first.periodStart ?? first.lines[0]?.transactionDate), endDate: isoDate(first.periodEnd ?? first.lines.at(-1)?.transactionDate) };
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memuat data akuntansi.'); }
  }

  useEffect(() => { void refresh(); }, [token]);

  async function addFinance(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const payable = payables.find((row) => `${row.referenceType}:${row.referenceId}` === form.supplierPayableKey);
      const supplierRefund = supplierRefunds.find((row) => row.purchaseReturnId === form.purchaseReturnId);
      const customerReceivable = customerReceivables.find((row) => `${row.referenceType}:${row.referenceId}` === form.customerOrderId);
      if (form.type === 'SUPPLIER_PAYMENT' && !payable) throw new Error('Pilih utang supplier yang akan dibayar.');
      if (form.type === 'SUPPLIER_REFUND' && !supplierRefund) throw new Error('Pilih piutang refund supplier yang akan diterima.');
      if (form.type === 'CUSTOMER_RECEIPT' && !customerReceivable) throw new Error('Pilih piutang pelanggan yang akan diterima.');
      // Gagal JELAS, bukan diam-diam menulis ke akun tebakan. Ini yang terjadi sebelum kolom-kolom
      // peran ini ada: kode '6101' dikirimkan ke server apa pun isi chart of accounts-nya.
      const roleAccount = (code: string, label: string, type: string) => {
        const row = accounts.find((item) => item.code === code && item.isActive);
        if (row && row.type !== type) throw new Error(`Akun ${code} bukan akun ${type}. Pilih ulang ${label}.`);
        return row?.code;
      };
      if (form.type === 'CASH_TRANSFER' && form.settlementAccount === form.transferTargetAccount) throw new Error('Akun sumber dan tujuan transfer harus berbeda.');
      const common = { amount: Number(form.amount), idempotencyKey: requestKey.current, requireApproval: form.requireApproval };
      const payload = form.type === 'OPERATING_EXPENSE'
        ? { ...common, type: form.type, description: form.description, debitAccountCode: roleAccount(form.operatingExpenseAccount, 'akun beban operasional', 'EXPENSE')!, creditAccountCode: form.settlementAccount, paymentMethod: form.settlementAccount === form.bankSettlementAccount ? 'BANK_TRANSFER' : 'CASH' }
        : form.type === 'OTHER_INCOME'
          ? { ...common, type: form.type, description: form.description, debitAccountCode: form.settlementAccount, creditAccountCode: roleAccount(form.otherIncomeAccount, 'akun pendapatan lain', 'REVENUE')!, paymentMethod: form.settlementAccount === form.bankSettlementAccount ? 'BANK_TRANSFER' : 'CASH' }
          : form.type === 'TAX_PAYMENT'
            ? { ...common, type: form.type, description: `Pembayaran pajak ${form.taxPayableAccount}`, debitAccountCode: roleAccount(form.taxPayableAccount, 'akun utang pajak', 'LIABILITY')!, creditAccountCode: form.settlementAccount, paymentMethod: form.settlementAccount === form.bankSettlementAccount ? 'BANK_TRANSFER' : 'CASH' }
            : form.type === 'SUPPLIER_PAYMENT'
              ? { ...common, type: form.type, description: form.description || `Pembayaran ${payable!.supplierName} ${payable!.documentNumber}`, debitAccountCode: roleAccount(form.supplierPayableAccount, 'akun utang supplier', 'LIABILITY')!, creditAccountCode: form.settlementAccount, counterpartyType: 'Supplier', counterpartyId: payable!.supplierId, counterpartyName: payable!.supplierName, paymentMethod: form.settlementAccount === '1102' ? 'BANK_TRANSFER' : 'CASH', referenceType: payable!.referenceType, referenceId: payable!.referenceId }
              : form.type === 'SUPPLIER_REFUND'
                ? { ...common, type: form.type, description: form.description || `Refund ${supplierRefund!.supplierName} ${supplierRefund!.purchaseReturnNumber}`, debitAccountCode: form.settlementAccount, creditAccountCode: roleAccount(form.supplierRefundAccount, 'akun pembelian/retur', 'ASSET')!, counterpartyType: 'Supplier', counterpartyId: supplierRefund!.supplierId, counterpartyName: supplierRefund!.supplierName, paymentMethod: form.settlementAccount === '1102' ? 'BANK_TRANSFER' : 'CASH', referenceType: 'PurchaseReturn', referenceId: supplierRefund!.purchaseReturnId }
                : form.type === 'CUSTOMER_RECEIPT'
                  ? { ...common, type: form.type, description: form.description || `Penerimaan ${customerReceivable!.documentNumber} ${customerReceivable!.customerName}`, debitAccountCode: form.settlementAccount, creditAccountCode: customerReceivable!.receivableAccountCode, counterpartyType: 'Customer', counterpartyName: customerReceivable!.customerName, paymentMethod: form.settlementAccount === '1102' ? 'BANK_TRANSFER' : 'CASH', referenceType: customerReceivable!.referenceType, referenceId: customerReceivable!.referenceId }
                  : { ...common, type: form.type, description: form.description || 'Transfer internal kas/bank', debitAccountCode: form.transferTargetAccount, creditAccountCode: form.settlementAccount, paymentMethod: 'INTERNAL_TRANSFER' };
      await api('/finance-operations', { method: 'POST', body: JSON.stringify(payload) });
      requestKey.current = newRequestKey(); setMessage(form.requireApproval ? 'Transaksi keuangan menunggu approval. Setelah disetujui, posting diperlukan agar jurnal terbentuk.' : 'Transaksi keuangan tersimpan sebagai draft. Posting diperlukan agar jurnal terbentuk.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan transaksi.'); }
  }

  async function financeAction(transaction: FinanceTx, action: 'approve' | 'reject' | 'cancel' | 'post', notes = '') {
    setMessage('');
    try {
      if ((action === 'reject' || action === 'cancel') && !notes.trim()) throw new Error('Alasan wajib diisi.');
      const endpoint = action === 'post'
        ? `/finance-operations/${transaction.id}/post`
        : `/finance-operations/${transaction.id}/${action}`;
      await api(endpoint, { method: 'POST', body: JSON.stringify({ notes }) });
      setFinanceDialog(null);
      setMessage(`${transaction.number}: ${action} berhasil.`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : `Gagal ${action} transaksi.`); }
  }

  function requestFinanceAction(transaction: FinanceTx, action: 'approve' | 'reject' | 'cancel' | 'post') {
    // Every finance mutation is confirmed. approve and post write operational/ledger
    // state with no undo path from this screen; reject/cancel additionally require a reason.
    setFinanceDialog({ transaction, action, notes: '' });
  }

  async function createPeriod(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try { await api('/finance/fiscal-periods', { method: 'POST', body: JSON.stringify(periodForm) }); setPeriodForm({ name: '', startDate: '', endDate: '' }); setMessage('Periode fiskal dibuat.'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuat periode fiskal.'); }
  }
  async function periodAction(period: FiscalPeriod, action: 'soft-close' | 'close' | 'reopen', notes = '') {
    setMessage('');
    // Final close blocks every later posting in the period and cannot be undone from this
    // workflow, so it demands a recorded reason. soft-close/reopen stay reversible.
    if (action === 'close' && !notes.trim()) { setMessage('Alasan final close wajib diisi.'); return; }
    try {
      await api(`/finance/fiscal-periods/${period.id}/${action}`, { method: 'PATCH', body: JSON.stringify(notes.trim() ? { notes: notes.trim() } : {}) });
      setPeriodDialog(null);
      setMessage(`${period.name}: ${action} berhasil.`); await refresh();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : `Gagal ${action} periode.`); }
  }

  async function createCloseControl(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      await api('/accounting-core/close-controls', { method: 'POST', body: JSON.stringify(closeControlForm) });
      setCloseControlForm({ module: 'ACCOUNTING', periodStart: '', periodEnd: '' });
      setMessage('Accounting close control dibuat dalam status OPEN. Tutup untuk memblok posting.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuat accounting close control.'); }
  }

  async function closeControlAction(control: AccountingCloseControl, action: 'close'|'reopen') {
    setMessage('');
    try {
      const reason = reopenReasons[control.id]?.trim();
      if (action === 'reopen' && !reason) { setMessage('Alasan reopen accounting close control wajib diisi.'); return; }
      const body = action === 'reopen' ? { reopenReason: reason } : undefined;
      await api(`/accounting-core/close-controls/${control.id}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      if (action === 'reopen') setReopenReasons((current) => ({ ...current, [control.id]: '' }));
      setMessage(`${control.module}: ${action} berhasil.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : `Gagal ${action} accounting close control.`); }
  }

  async function loadStatementFile(file?: File) {
    if (!file) return;
    try { const text = await file.text(); setStatementForm((current) => ({ ...current, fileName: current.fileName || file.name, linesText: text })); }
    catch { setMessage('Gagal membaca file bank statement.'); }
  }
  async function importStatement(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const lines = parseStatementText(statementForm.linesText);
      await api('/finance/bank-statements/import', { method: 'POST', body: JSON.stringify({
        bankAccountId: statementForm.bankAccountId, source: statementForm.source, fileName: statementForm.fileName,
        periodStart: statementForm.periodStart || undefined, periodEnd: statementForm.periodEnd || undefined,
        openingBalance: statementForm.openingBalance ? parseMoney(statementForm.openingBalance) : undefined,
        closingBalance: statementForm.closingBalance ? parseMoney(statementForm.closingBalance) : undefined, lines,
      }) });
      setStatementForm((current) => ({ ...current, fileName: '', periodStart: '', periodEnd: '', openingBalance: '', closingBalance: '', linesText: '' }));
      setMessage('Bank statement berhasil diimpor dan siap direkonsiliasi.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal import bank statement.'); }
  }

  function chooseStatement(statementId: string) {
    const statement = statements.find((row) => row.id === statementId);
    setReconForm({ statementId, startDate: isoDate(statement?.periodStart ?? statement?.lines[0]?.transactionDate), endDate: isoDate(statement?.periodEnd ?? statement?.lines.at(-1)?.transactionDate) });
  }
  async function createReconciliation(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try { await api('/finance/reconciliations', { method: 'POST', body: JSON.stringify(reconForm) }); setMessage('Snapshot rekonsiliasi dibuat dari journal + bank statement.'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuat rekonsiliasi.'); }
  }
  async function loadReconciliation(id: string) {
    try { const details = await api<ReconciliationDetails>(`/finance/reconciliations/${id}/details`); setReconDetails(details); setManualMatches({}); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuka detail rekonsiliasi.'); }
  }
  async function autoMatch(reconciliation: BankReconciliation) {
    try { const result = await api<{ reconciliation: BankReconciliation; matchedThisRun: number }>(`/finance/reconciliations/${reconciliation.id}/auto-match`, { method: 'POST' }); setMessage(`Auto-match: ${result.matchedThisRun} baris baru cocok.`); await refresh(); await loadReconciliation(reconciliation.id); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Auto-match gagal.'); }
  }
  async function matchLine(statementLineId: string) {
    if (!reconDetails) return;
    const journalLineId = manualMatches[statementLineId]; if (!journalLineId) return;
    try { await api(`/finance/reconciliations/${reconDetails.reconciliation.id}/match`, { method: 'POST', body: JSON.stringify({ statementLineId, journalLineId }) }); await refresh(); await loadReconciliation(reconDetails.reconciliation.id); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Match manual gagal.'); }
  }
  async function unmatchLine(statementLineId: string) {
    if (!reconDetails) return;
    try { await api(`/finance/reconciliations/${reconDetails.reconciliation.id}/unmatch`, { method: 'POST', body: JSON.stringify({ statementLineId }) }); await refresh(); await loadReconciliation(reconDetails.reconciliation.id); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unmatch gagal.'); }
  }

  function parsePostingRuleLines(text: string): PostingRuleLine[] {
    const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    return rows.map((row, index) => {
      const [sideRaw, accountRaw, amountKeyRaw, descriptionRaw] = row.split('|').map((value) => value.trim());
      const side = sideRaw?.toUpperCase();
      if (side !== 'DEBIT' && side !== 'CREDIT') throw new Error(`Baris ${index + 1}: side harus DEBIT atau CREDIT.`);
      if (!accountRaw || !amountKeyRaw) throw new Error(`Baris ${index + 1}: akun dan amountKey wajib diisi.`);
      return { side, accountCode: accountRaw.toUpperCase(), amountKey: amountKeyRaw, description: descriptionRaw || undefined, skipIfZero: true };
    });
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      await api('/accounting-core/accounts', { method: 'POST', body: JSON.stringify(accountForm) });
      setAccountForm({ code: '', name: '', type: 'ASSET' });
      setMessage('Akun baru dibuat pada branch aktif.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuat akun.'); }
  }

  async function updateAccount(account: Account, patch: Partial<Pick<Account, 'name'|'type'|'isActive'>>) {
    setMessage('');
    try { await api(`/accounting-core/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); setMessage(`Akun ${account.code} diperbarui.`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memperbarui akun.'); }
  }

  function parseKeyValueNumbers(text: string) {
    const result: Record<string, number> = {};
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      const row = raw.trim(); if (!row) continue;
      const at = row.indexOf('=');
      if (at <= 0) throw new Error(`Amounts baris ${index + 1}: gunakan format key=nominal.`);
      const key = row.slice(0, at).trim(); const value = parseMoney(row.slice(at + 1));
      if (!key) throw new Error(`Amounts baris ${index + 1}: key wajib diisi.`);
      result[key] = value;
    }
    if (!Object.keys(result).length) throw new Error('Minimal satu amount wajib diisi.');
    return result;
  }

  function parseKeyValueStrings(text: string) {
    const result: Record<string, string> = {};
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      const row = raw.trim(); if (!row) continue;
      const at = row.indexOf('=');
      if (at <= 0) throw new Error(`Account mapping baris ${index + 1}: gunakan format key=ACCOUNT_CODE.`);
      const key = row.slice(0, at).trim(); const value = row.slice(at + 1).trim().toUpperCase();
      if (!key || !value) throw new Error(`Account mapping baris ${index + 1}: key dan account code wajib diisi.`);
      result[key] = value;
    }
    return result;
  }

  async function postManualEvent(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      if (!manualEventForm.eventType.trim() || !manualEventForm.sourceType.trim() || !manualEventForm.sourceId.trim()) throw new Error('Event type, source type, dan source ID wajib diisi.');
      const amounts = parseKeyValueNumbers(manualEventForm.amountsText);
      const accountCodes = parseKeyValueStrings(manualEventForm.accountCodesText);
      await api('/accounting-core/events/post', { method: 'POST', body: JSON.stringify({
        eventType: manualEventForm.eventType.trim().toUpperCase(),
        sourceType: manualEventForm.sourceType.trim().toUpperCase(),
        sourceId: manualEventForm.sourceId.trim(),
        idempotencyKey: `manual-accounting:${manualEventForm.sourceType.trim().toLowerCase()}:${manualEventForm.sourceId.trim()}:${manualEventForm.eventType.trim().toLowerCase()}`,
        currency: manualEventForm.currency.trim().toUpperCase() || 'IDR',
        businessDate: manualEventForm.businessDate || undefined,
        amounts,
        accountCodes: Object.keys(accountCodes).length ? accountCodes : undefined,
        context: { origin: 'ADMIN_MANUAL_ACCOUNTING_EVENT' },
      }) });
      setManualEventForm((current) => ({ ...current, eventType: '', sourceId: '', amountsText: 'gross=0', accountCodesText: '' }));
      setMessage('Manual accounting event dipost melalui accounting core dan idempotency authority.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal posting manual accounting event.'); }
  }

  async function createPostingRule(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const journalLines = parsePostingRuleLines(ruleForm.journalLinesText);
      await api('/accounting-core/posting-rules', { method: 'POST', body: JSON.stringify({ ...ruleForm, version: Number(ruleForm.version), priority: Number(ruleForm.priority), effectiveFrom: ruleForm.effectiveFrom || undefined, effectiveTo: ruleForm.effectiveTo || undefined, journalLines }) });
      setMessage(`Posting rule ${ruleForm.code} v${ruleForm.version} tersimpan.`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan posting rule.'); }
  }

  function cloneRuleVersion(rule: PostingRule) {
    const rows = rule.journalLines.map((line) => `${line.side}|${line.accountCode ?? line.accountCodeKey ?? ''}|${line.amountKey}|${line.description ?? ''}`).join('\n');
    setRuleForm({ code: rule.code, version: rule.version + 1, name: rule.name, eventType: rule.eventType, priority: rule.priority, status: 'DRAFT', effectiveFrom: '', effectiveTo: '', journalLinesText: rows });
  }

  async function updatePostingRuleStatus(rule: PostingRule, status: 'ACTIVE'|'INACTIVE') {
    setMessage('');
    try { await api(`/accounting-core/posting-rules/${rule.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setMessage(`${rule.code} v${rule.version} → ${status}.`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengubah status posting rule.'); }
  }

  async function loadEventDetail(id: string) {
    setMessage('');
    try { setEventDetail(await api<AccountingEventDetail>(`/accounting-core/events/${id}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuka drill-down accounting event.'); }
  }

  const payableOptions = payables.filter((row) => Number(row.availableToPay) > 0);
  const selectedPayable = payables.find((row) => `${row.referenceType}:${row.referenceId}` === form.supplierPayableKey);
  const refundOptions = supplierRefunds.filter((row) => Number(row.availableToReceive) > 0);
  const selectedRefund = supplierRefunds.find((row) => row.purchaseReturnId === form.purchaseReturnId);
  const customerOptions = customerReceivables.filter((row) => Number(row.availableToReceive) > 0);
  const selectedCustomer = customerReceivables.find((row) => `${row.referenceType}:${row.referenceId}` === form.customerOrderId);
  const assetAccounts = accounts.filter((row) => row.type === 'ASSET' && row.isActive);
  // Dropdown peran akun harus menampilkan akun yang BENAR-BENAR ada di branch aktif. Tiga akun
  // pajak yang dulu tertanam sebagai <option value="2201|2202|2103"> membuat kasir tidak bisa
  // memilih akun utang lain, dan mengirim 400 kalau perusahaan tidak punya kode itu.
  const activeAccounts = accounts.filter((row) => row.isActive);
  const liabilityAccounts = activeAccounts.filter((row) => row.type === 'LIABILITY');
  const expenseAccounts = activeAccounts.filter((row) => row.type === 'EXPENSE');
  const revenueAccounts = activeAccounts.filter((row) => row.type === 'REVENUE');
  const bankAccounts = assetAccounts.filter((row) => /bank|kas|cash/i.test(`${row.code} ${row.name}`));
  const accountOptions = (rows: Account[], emptyLabel: string) => rows.length === 0
    ? <option value="">{emptyLabel}</option>
    : rows.map((row) => <option key={row.id} value={row.code}>{row.name} ({row.code})</option>);
  const show = (...modes: string[]) => !mode || modes.includes(mode);

  return (
    <>
      <FinanceDepthWorkspace token={token} mode={mode} />
      <section className="grid2">
        {show('ledger') && <Panel eyebrow="ACCOUNTING CORE" title="Accounting Events (Jurnal)" badge={`${events.length} event`}>
          <Table head={['Event / Source', 'Status', 'Tanggal', 'Aksi']} rows={events.slice(0, 20).map((e) => [<><strong>{e.eventType}</strong><small className="mutedText">{e.sourceType ?? '-'} · {e.sourceId ?? '-'}</small></>, <StatusChip status={e.status} />, tanggal(e.businessDate ?? e.createdAt), <button type="button" className="secondary" onClick={() => void loadEventDetail(e.id)}>Drill-down</button>])} empty="Belum ada jurnal." />
        </Panel>}
        {show('ledger') && <Panel eyebrow="CHART OF ACCOUNTS" title="Akun Branch" badge={`${accounts.length} akun`}>
          <form className="accountCreateGrid" onSubmit={createAccount}>
            <label>Kode<input required value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value.toUpperCase() })} /></label>
            <label>Nama<input required value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} /></label>
            <label>Tipe<select value={accountForm.type} onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value })}><option>ASSET</option><option>LIABILITY</option><option>EQUITY</option><option>REVENUE</option><option>EXPENSE</option></select></label>
            <button>Tambah akun</button>
          </form>
          <Table head={['Kode', 'Nama', 'Tipe', 'Status', 'Aksi']} rows={accounts.slice(0, 80).map((a) => [<strong>{a.code}</strong>, a.name, a.type, <StatusChip status={a.isActive ? 'ACTIVE' : 'INACTIVE'} />, <span className="inlineActions"><button type="button" className="secondary" onClick={() => setAccountEditDialog({ account: a, name: a.name })}>Edit nama</button><button type="button" className="secondary" onClick={() => void updateAccount(a, { isActive: !a.isActive })}>{a.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></span>])} empty="Belum ada chart of accounts." />
        </Panel>}
      </section>

      {show('tax') && <TaxWorkspace token={token} onOpenAccountingEvent={(id) => void loadEventDetail(id)} />}

      {show('ledger') && <Panel eyebrow="MANUAL ACCOUNTING EVENT" title="Post melalui Accounting Core" badge="finance.journal">
        <form className="formStack" onSubmit={postManualEvent}>
          <section className="grid2">
            <label>Event type<input required value={manualEventForm.eventType} onChange={(e)=>setManualEventForm({...manualEventForm,eventType:e.target.value.toUpperCase()})} placeholder="MANUAL_ADJUSTMENT"/></label>
            <label>Source type<input required value={manualEventForm.sourceType} onChange={(e)=>setManualEventForm({...manualEventForm,sourceType:e.target.value.toUpperCase()})} placeholder="MANUAL"/></label>
            <label>Source ID<input required value={manualEventForm.sourceId} onChange={(e)=>setManualEventForm({...manualEventForm,sourceId:e.target.value})} placeholder="Dokumen/referensi unik"/></label>
            <label>Business date<input type="date" value={manualEventForm.businessDate} onChange={(e)=>setManualEventForm({...manualEventForm,businessDate:e.target.value})}/></label>
            <label>Currency<input value={manualEventForm.currency} onChange={(e)=>setManualEventForm({...manualEventForm,currency:e.target.value.toUpperCase()})}/></label>
          </section>
          <section className="grid2">
            <label>Amounts <small>satu key=nominal per baris</small><textarea rows={5} required value={manualEventForm.amountsText} onChange={(e)=>setManualEventForm({...manualEventForm,amountsText:e.target.value})} placeholder={'net=100000\ntax=11000\ngross=111000'}/></label>
            <label>Account-code mapping <small>opsional, key=ACCOUNT_CODE</small><textarea rows={5} value={manualEventForm.accountCodesText} onChange={(e)=>setManualEventForm({...manualEventForm,accountCodesText:e.target.value})} placeholder={'cash=1101\nrevenue=4101'}/></label>
          </section>
          <div className="rowActions"><button>Post accounting event</button></div>
        </form>
        <p className="sectionHelp">Tenant dan branch tidak dapat dipilih bebas dari UI; keduanya tetap berasal dari token. Posting rule aktif, period lock, balance journal, tax ownership, dan idempotency tetap divalidasi oleh accounting core.</p>
      </Panel>}

      {show('ledger') && <Panel eyebrow="POSTING RULES" title="Versioned Account Mapping" badge={`${postingRules.length} rule`}>
        <form className="formSingle" onSubmit={createPostingRule}>
          <section className="grid2">
            <label>Kode rule<input required value={ruleForm.code} onChange={(e) => setRuleForm({ ...ruleForm, code: e.target.value.toUpperCase() })} placeholder="SALE-CASH" /></label>
            <label>Nama<input required value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></label>
            <label>Event type<input required value={ruleForm.eventType} onChange={(e) => setRuleForm({ ...ruleForm, eventType: e.target.value.toUpperCase() })} placeholder="SALE_CASH" /></label>
            <label>Version<input type="number" min="1" required value={ruleForm.version} onChange={(e) => setRuleForm({ ...ruleForm, version: Number(e.target.value) })} /></label>
            <label>Priority<input type="number" required value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })} /></label>
            <label>Status<select value={ruleForm.status} onChange={(e) => setRuleForm({ ...ruleForm, status: e.target.value })}><option>DRAFT</option><option>ACTIVE</option></select></label>
            <label>Efektif dari<input type="date" value={ruleForm.effectiveFrom} onChange={(e) => setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })} /></label>
            <label>Efektif sampai<input type="date" value={ruleForm.effectiveTo} onChange={(e) => setRuleForm({ ...ruleForm, effectiveTo: e.target.value })} /></label>
          </section>
          <label>Journal mapping <small>(SIDE|ACCOUNT_CODE|AMOUNT_KEY|DESCRIPTION)</small><textarea rows={5} required value={ruleForm.journalLinesText} onChange={(e) => setRuleForm({ ...ruleForm, journalLinesText: e.target.value })} /></label>
          <div><button>Simpan version</button></div>
        </form>
        <Table head={['Rule', 'Event', 'Version', 'Priority', 'Efektif', 'Status', 'Aksi']} rows={postingRules.map((rule) => [<><strong>{rule.code}</strong><small className="mutedText">{rule.name}</small></>, rule.eventType, `v${rule.version}`, String(rule.priority), `${isoDate(rule.effectiveFrom) || '∞'} → ${isoDate(rule.effectiveTo) || '∞'}`, <StatusChip status={rule.status} />, <span className="inlineActions"><button type="button" className="secondary" onClick={() => cloneRuleVersion(rule)}>Buat v{rule.version + 1}</button>{rule.status !== 'ACTIVE' && <button type="button" onClick={() => void updatePostingRuleStatus(rule, 'ACTIVE')}>Aktifkan</button>}{rule.status === 'ACTIVE' && <button type="button" className="secondary" onClick={() => void updatePostingRuleStatus(rule, 'INACTIVE')}>Nonaktifkan</button>}</span>])} empty="Belum ada posting rule." />
        <p className="sectionHelp">Rule yang pernah ACTIVE atau sudah dipakai posting tidak dapat ditimpa. Koreksi mapping dilakukan dengan version baru agar histori journal tetap reproducible.</p>
      </Panel>}

      {show('ledger') && eventDetail && <Panel eyebrow="ACCOUNTING DRILL-DOWN" title={`${eventDetail.event.eventType} · ${eventDetail.source.type}:${eventDetail.source.id}`} badge={eventDetail.event.status}>
        <section className="grid2">
          <div><strong>Rule</strong><p>{eventDetail.rules.map((rule) => `${rule.code} v${rule.version}`).join(', ') || '-'}</p></div>
          <div><strong>Journal</strong><p>{eventDetail.journalEntry ? `${eventDetail.journalEntry.number} · ${tanggal(eventDetail.journalEntry.date)}` : '-'}</p></div>
        </section>
        <Table head={['Akun', 'Nama', 'Debit', 'Kredit']} rows={(eventDetail.journalEntry?.lines ?? []).map((line) => [<strong>{line.account.code}</strong>, line.account.name, rupiah(Number(line.debit)), rupiah(Number(line.credit))])} empty="Journal line belum tersedia." />
        <Table head={['Event line', 'Net', 'Tax', 'Gross']} rows={eventDetail.event.lines.map((line) => [line.description ?? `Line ${line.lineNumber}`, rupiah(Number(line.netAmount)), rupiah(Number(line.taxAmount)), rupiah(Number(line.grossAmount))])} empty="Event line belum tersedia." />
        <button type="button" className="secondary" onClick={() => setEventDetail(null)}>Tutup detail</button>
      </Panel>}

      {show('fiscal') && <Panel eyebrow="PERIODE FISKAL" title="Open → Soft Close → Final Close" badge={`${periods.length} periode`}>
        <form className="responsiveFormGrid" onSubmit={createPeriod}>
          <label>Nama<input required value={periodForm.name} onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} placeholder="September 2026" /></label>
          <label>Mulai<input required type="date" value={periodForm.startDate} onChange={(e) => setPeriodForm({ ...periodForm, startDate: e.target.value })} /></label>
          <label>Selesai<input required type="date" value={periodForm.endDate} onChange={(e) => setPeriodForm({ ...periodForm, endDate: e.target.value })} /></label>
          <button>Buat periode</button>
        </form>
        <Table head={['Periode', 'Rentang', 'Status', 'Aksi']} rows={periods.map((period) => [
          <strong>{period.name}</strong>, `${tanggal(period.startDate)} – ${tanggal(period.endDate)}`, <StatusChip status={period.status} />,
          <span className="inlineActions">
            {period.status === 'OPEN' && <button type="button" className="secondary" onClick={() => setPeriodDialog({ period, action: 'soft-close', notes: '' })}>Soft close</button>}
            {period.status === 'SOFT_CLOSED' && <><button type="button" className="secondary" onClick={() => setPeriodDialog({ period, action: 'reopen', notes: '' })}>Reopen</button>{canAll('finance.close_period') && <button type="button" onClick={() => setPeriodDialog({ period, action: 'close', notes: '' })}>Final close</button>}</>}
            {period.status === 'CLOSED' && <small>Final</small>}
          </span>,
        ])} empty="Belum ada periode fiskal." />
      </Panel>}

      {show('fiscal') && <Panel eyebrow="ACCOUNTING CLOSE CONTROL" title="Runtime posting lock" badge={`${closeControls.filter((row) => row.status === 'CLOSED').length} closed`}>
        <form className="responsiveFormGrid" onSubmit={createCloseControl}>
          <label>Module<input required value={closeControlForm.module} onChange={(e) => setCloseControlForm({ ...closeControlForm, module: e.target.value.toUpperCase() })} /></label>
          <label>Mulai<input required type="date" value={closeControlForm.periodStart} onChange={(e) => setCloseControlForm({ ...closeControlForm, periodStart: e.target.value })} /></label>
          <label>Selesai<input required type="date" value={closeControlForm.periodEnd} onChange={(e) => setCloseControlForm({ ...closeControlForm, periodEnd: e.target.value })} /></label>
          <button>Buat control</button>
        </form>
        <Table head={['Module','Periode','Status','Aksi']} rows={closeControls.map((row) => [row.module, `${tanggal(row.periodStart)} – ${tanggal(row.periodEnd)}`, <StatusChip status={row.status} />, row.status === 'OPEN' ? <button type="button" onClick={() => void closeControlAction(row, 'close')}>Close posting</button> : <span className="inlineActions"><input aria-label={`Alasan reopen ${row.module}`} placeholder="Alasan reopen" value={reopenReasons[row.id] ?? ''} onChange={(event) => setReopenReasons((current) => ({ ...current, [row.id]: event.target.value }))} /><button type="button" className="secondary" onClick={() => void closeControlAction(row, 'reopen')}>Reopen</button></span>])} empty="Belum ada accounting close control." />
        <p className="sectionHelp">Close control CLOSED memblokir posting accounting event pada rentang tanggal tersebut, termasuk posting operasional yang masuk melalui accounting core.</p>
      </Panel>}

      {show('payables') && <Panel eyebrow="UTANG USAHA" title="Utang Supplier per Dokumen" badge={`${payables.filter((row) => Number(row.outstandingAmount) > 0).length} terbuka`}>
        <Table head={['Supplier / Dokumen', 'Sumber', 'Tagihan', 'Retur', 'Sudah Dibayar', 'Pending', 'Sisa']} rows={payables.filter((row) => Number(row.outstandingAmount) > 0).map((row) => [
          <><strong>{row.supplierName}</strong><small className="mutedText">{row.documentNumber}</small></>,
          row.referenceType === 'Asset' ? `Aset · ${row.assetName ?? row.assetCode ?? '-'}` : row.referenceType === 'MaintenanceWorkOrder' ? `Maintenance · ${row.sourceName ?? row.documentNumber}` : row.referenceType === 'FuelTransaction' ? `BBM · ${row.sourceName ?? row.documentNumber}` : `GR · ${row.purchaseOrderNumber ?? '-'}`,
          rupiah(Number(row.grossAmount)), rupiah(Number(row.returnedAmount)), rupiah(Number(row.paidAmount)), rupiah(Number(row.pendingPaymentAmount)), <strong>{rupiah(Number(row.outstandingAmount))}</strong>,
        ])} empty="Tidak ada utang supplier terbuka." />
      </Panel>}

      {show('receivables') && <section className="grid2">
        <Panel eyebrow="REFUND SUPPLIER" title="Piutang Refund Supplier" badge={`${supplierRefunds.filter((row) => Number(row.outstandingAmount) > 0).length} terbuka`}>
          <Table head={['Supplier / Retur', 'Credit Note', 'Piutang', 'Diterima', 'Pending', 'Sisa']} rows={supplierRefunds.filter((row) => Number(row.outstandingAmount) > 0).map((row) => [<><strong>{row.supplierName}</strong><small className="mutedText">{row.purchaseReturnNumber}</small></>, row.creditNoteNumber ?? '-', rupiah(Number(row.receivableAmount)), rupiah(Number(row.receivedAmount)), rupiah(Number(row.pendingAmount)), <strong>{rupiah(Number(row.outstandingAmount))}</strong>])} empty="Tidak ada refund supplier terbuka." />
        </Panel>
        <Panel eyebrow="PIUTANG PELANGGAN" title="Order / POS On-Account" badge={`${customerReceivables.filter((row) => Number(row.outstandingAmount) > 0).length} terbuka`}>
          <Table head={['Dokumen', 'Pelanggan', 'Metode', 'Piutang', 'Diterima', 'Sisa']} rows={customerReceivables.filter((row) => Number(row.outstandingAmount) > 0).map((row) => [<><strong>{row.documentNumber}</strong><small className="mutedText">{row.referenceType}</small></>, row.customerName, row.paymentMethod, rupiah(Number(row.grossAmount)), rupiah(Number(row.receivedAmount)), <strong>{rupiah(Number(row.outstandingAmount))}</strong>])} empty="Tidak ada piutang pelanggan terbuka." />
        </Panel>
      </section>}

      {show('banking') && <Panel eyebrow="KAS & BANK" title="Transaksi Keuangan Operasional" badge={`${finances.length} transaksi`}>
        <form className="responsiveFormGrid" onSubmit={addFinance}>
          <label>Jenis<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FinanceType })}><option value="OPERATING_EXPENSE">Beban operasional</option><option value="OTHER_INCOME">Pendapatan lain</option><option value="TAX_PAYMENT">Bayar pajak</option><option value="SUPPLIER_PAYMENT">Bayar supplier</option><option value="SUPPLIER_REFUND">Terima refund supplier</option><option value="CUSTOMER_RECEIPT">Terima piutang pelanggan</option><option value="CASH_TRANSFER">Transfer kas/bank</option></select></label>
          {form.type === 'TAX_PAYMENT' ? <label>Utang pajak<select required value={form.taxPayableAccount} onChange={(e) => setForm({ ...form, taxPayableAccount: e.target.value })}>
              {/* Server MEMBATASI akun pajak pada 2103/2201/2202 (`finance-operations.service.ts`).
                  UI harus menawarkan persis itu: menampilkan seluruh akun LIABILITY akan membuat
                  kasir memilih opsi yang pasti ditolak server dengan 400. Yang bisa berubah adalah
                  label/kode, bukan daftar putih itu. */}
              {TAX_PAYABLE_ALLOWED.map((code) => { const row = liabilityAccounts.find((item) => item.code === code); return <option key={code} value={code}>{row ? `${row.name} (${code})` : `${code} (belum ada di chart of accounts)`}</option>; })}
            </select></label>
            : form.type === 'SUPPLIER_PAYMENT' ? <label>Utang / Dokumen<select required value={form.supplierPayableKey} onChange={(e) => { const row = payables.find((x) => `${x.referenceType}:${x.referenceId}` === e.target.value); setForm({ ...form, supplierPayableKey: e.target.value, amount: Number(row?.availableToPay ?? 0), description: row ? `Pembayaran ${row.supplierName} ${row.documentNumber}` : '' }); }}><option value="">Pilih utang supplier</option>{payableOptions.map((row) => <option key={`${row.referenceType}:${row.referenceId}`} value={`${row.referenceType}:${row.referenceId}`}>{row.supplierName} · {row.documentNumber} · {rupiah(Number(row.availableToPay))}</option>)}</select></label>
              : form.type === 'SUPPLIER_REFUND' ? <label>Refund / Purchase Return<select required value={form.purchaseReturnId} onChange={(e) => { const row = supplierRefunds.find((x) => x.purchaseReturnId === e.target.value); setForm({ ...form, purchaseReturnId: e.target.value, amount: Number(row?.availableToReceive ?? 0), description: row ? `Refund ${row.supplierName} ${row.purchaseReturnNumber}` : '' }); }}><option value="">Pilih refund supplier</option>{refundOptions.map((row) => <option key={row.purchaseReturnId} value={row.purchaseReturnId}>{row.supplierName} · {row.purchaseReturnNumber} · {rupiah(Number(row.availableToReceive))}</option>)}</select></label>
                : form.type === 'CUSTOMER_RECEIPT' ? <label>Piutang / Dokumen<select required value={form.customerOrderId} onChange={(e) => { const row = customerReceivables.find((x) => `${x.referenceType}:${x.referenceId}` === e.target.value); setForm({ ...form, customerOrderId: e.target.value, amount: Number(row?.availableToReceive ?? 0), description: row ? `Penerimaan ${row.documentNumber} ${row.customerName}` : '' }); }}><option value="">Pilih piutang pelanggan</option>{customerOptions.map((row) => <option key={`${row.referenceType}:${row.referenceId}`} value={`${row.referenceType}:${row.referenceId}`}>{row.referenceType} · {row.documentNumber} · {row.customerName} · {rupiah(Number(row.availableToReceive))}</option>)}</select></label>
                  : <label>Keterangan<input required={form.type !== 'CASH_TRANSFER'} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>}
          {/* Akun-akun lawas jurnal. Sebelum ini dikodekan di source sebagai '6101'/'4103'/'2101'/
              '1202', jadi kasir tidak pernah bisa memilih dan jurnal masuk ke akun milik template,
              bukan milik perusahaan ini. */}
          {form.type === 'OPERATING_EXPENSE' && <label>Akun beban<select required value={form.operatingExpenseAccount} onChange={(e) => setForm({ ...form, operatingExpenseAccount: e.target.value })}>{accountOptions(expenseAccounts, 'Belum ada akun beban pada branch ini')}</select></label>}
          {form.type === 'OTHER_INCOME' && <label>Akun pendapatan<select required value={form.otherIncomeAccount} onChange={(e) => setForm({ ...form, otherIncomeAccount: e.target.value })}>{accountOptions(revenueAccounts, 'Belum ada akun pendapatan pada branch ini')}</select></label>}
          {form.type === 'SUPPLIER_PAYMENT' && <label>Akun utang<select required value={form.supplierPayableAccount} onChange={(e) => setForm({ ...form, supplierPayableAccount: e.target.value })}>{accountOptions(liabilityAccounts, 'Belum ada akun utang pada branch ini')}</select></label>}
          {form.type === 'SUPPLIER_REFUND' && <label>Akun piutang refund supplier<select required value={form.supplierRefundAccount} onChange={(e) => setForm({ ...form, supplierRefundAccount: e.target.value })}>{/* Server HANYA menerima 1202 untuk refund supplier (over-collection guard). Bukan pilihan bebas: dropdown yang lebih luas hanya menawarkan error. */}<option value={SUPPLIER_REFUND_RECEIVABLE}>{assetAccounts.find((row) => row.code === SUPPLIER_REFUND_RECEIVABLE)?.name ?? 'Piutang Refund Supplier'} ({SUPPLIER_REFUND_RECEIVABLE})</option></select></label>}
          <label>Akun bank (untuk transfer){' '}<select value={form.bankSettlementAccount} onChange={(e) => setForm({ ...form, bankSettlementAccount: e.target.value })}>{accountOptions(bankAccounts, 'Pilih rekening bank')}</select></label>
          <label>Nominal<input required type="number" min="1" max={form.type === 'SUPPLIER_PAYMENT' ? Number(selectedPayable?.availableToPay ?? 0) || undefined : form.type === 'SUPPLIER_REFUND' ? Number(selectedRefund?.availableToReceive ?? 0) || undefined : form.type === 'CUSTOMER_RECEIPT' ? Number(selectedCustomer?.availableToReceive ?? 0) || undefined : undefined} value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></label>
          <label>{form.type === 'CASH_TRANSFER' ? 'Sumber' : 'Kas/Bank'}<select value={form.settlementAccount} onChange={(e) => setForm({ ...form, settlementAccount: e.target.value })}>{assetAccounts.map((account) => <option key={account.id} value={account.code}>{account.code} · {account.name}</option>)}</select></label>
          <button>Simpan</button>
          {form.type === 'CASH_TRANSFER' && <label>Tujuan<select value={form.transferTargetAccount} onChange={(e) => setForm({ ...form, transferTargetAccount: e.target.value })}>{assetAccounts.map((account) => <option key={account.id} value={account.code}>{account.code} · {account.name}</option>)}</select></label>}
          <label className="checkboxRow"><input type="checkbox" checked={form.requireApproval} onChange={(e) => setForm({ ...form, requireApproval: e.target.checked })} /> Wajib approval</label>
        </form>
        <Table head={['Nomor', 'Jenis', 'Keterangan', 'Nominal', 'Debit→Kredit', 'Status', 'Aksi']} rows={finances.map((f) => [<strong>{f.number}</strong>, f.type, f.description ?? '-', rupiah(Number(f.grossAmount)), <small className="mutedText">{f.debitAccountCode} → {f.creditAccountCode}</small>, <StatusChip status={f.status} />, <span className="inlineActions">
          {f.status === 'WAITING_APPROVAL' && canAll(FINANCE_ACTION_PERMISSION.approve) && <><button type="button" onClick={() => requestFinanceAction(f, 'approve')}>Approve</button><button type="button" className="secondary" onClick={() => requestFinanceAction(f, 'reject')}>Reject</button></>}
          {['DRAFT', 'APPROVED'].includes(f.status) && canAll(FINANCE_ACTION_PERMISSION.post) && <button type="button" className="secondary" onClick={() => requestFinanceAction(f, 'post')}>Posting</button>}
          {['DRAFT', 'WAITING_APPROVAL', 'APPROVED'].includes(f.status) && canAll(FINANCE_ACTION_PERMISSION.cancel) && <button type="button" className="secondary" onClick={() => requestFinanceAction(f, 'cancel')}>Batal</button>}
        </span>])} empty="Belum ada transaksi kas." />
      </Panel>}

      {show('banking') && <Panel eyebrow="BANK STATEMENT" title="Import Statement untuk Rekonsiliasi" badge={`${statements.length} file`}>
        <form className="formSingle" onSubmit={importStatement}>
          <section className="grid2">
            <label>Akun bank<select required value={statementForm.bankAccountId} onChange={(e) => setStatementForm({ ...statementForm, bankAccountId: e.target.value })}><option value="">Pilih akun bank</option>{assetAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
            <label>Sumber<input required value={statementForm.source} onChange={(e) => setStatementForm({ ...statementForm, source: e.target.value })} placeholder="BCA / Mandiri / CSV" /></label>
            <label>Nama file<input required value={statementForm.fileName} onChange={(e) => setStatementForm({ ...statementForm, fileName: e.target.value })} placeholder="statement-2026-09.csv" /></label>
            <label>Baca CSV/TXT<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void loadStatementFile(e.target.files?.[0])} /></label>
            <label>Periode mulai<input type="date" value={statementForm.periodStart} onChange={(e) => setStatementForm({ ...statementForm, periodStart: e.target.value })} /></label>
            <label>Periode selesai<input type="date" value={statementForm.periodEnd} onChange={(e) => setStatementForm({ ...statementForm, periodEnd: e.target.value })} /></label>
            <label>Saldo awal<input value={statementForm.openingBalance} onChange={(e) => setStatementForm({ ...statementForm, openingBalance: e.target.value })} /></label>
            <label>Saldo akhir<input value={statementForm.closingBalance} onChange={(e) => setStatementForm({ ...statementForm, closingBalance: e.target.value })} /></label>
          </section>
          <label>Baris statement (tanggal|deskripsi|referensi|debit|credit|balance)<textarea required rows={6} value={statementForm.linesText} onChange={(e) => setStatementForm({ ...statementForm, linesText: e.target.value })} placeholder={'2026-09-01|SETORAN POS|POS-001|0|150000|150000\n2026-09-02|BIAYA BANK|ADM|10000|0|140000'} /></label>
          <button>Import bank statement</button>
        </form>
        <Table head={['File', 'Sumber', 'Periode', 'Baris']} rows={statements.map((row) => [<strong>{row.fileName ?? row.id}</strong>, row.source, `${isoDate(row.periodStart)} – ${isoDate(row.periodEnd)}`, String(row.lines.length)])} empty="Belum ada bank statement." />
      </Panel>}

      {show('banking') && <Panel eyebrow="REKONSILIASI BANK" title="Statement ↔ Journal" badge={`${reconciliations.length} rekonsiliasi`}>
        <form className="responsiveFormGrid" onSubmit={createReconciliation}>
          <label>Statement<select required value={reconForm.statementId} onChange={(e) => chooseStatement(e.target.value)}><option value="">Pilih statement</option>{statements.map((row) => <option key={row.id} value={row.id}>{row.fileName ?? row.id} · {row.source}</option>)}</select></label>
          <label>Mulai<input required type="date" value={reconForm.startDate} onChange={(e) => setReconForm({ ...reconForm, startDate: e.target.value })} /></label>
          <label>Selesai<input required type="date" value={reconForm.endDate} onChange={(e) => setReconForm({ ...reconForm, endDate: e.target.value })} /></label>
          <button>Buat snapshot</button>
        </form>
        <Table head={['Periode', 'Saldo Buku', 'Saldo Bank', 'Selisih', 'Matched', 'Status', 'Aksi']} rows={reconciliations.map((row) => [
          `${tanggal(row.startDate)} – ${tanggal(row.endDate)}`, rupiah(Number(row.bookBalance)), rupiah(Number(row.bankBalance)), <strong>{rupiah(Number(row.difference))}</strong>, String(row.matchedCount), <StatusChip status={row.status} />,
          <span className="inlineActions"><button type="button" className="secondary" onClick={() => void autoMatch(row)}>Auto-match</button><button type="button" className="secondary" onClick={() => void loadReconciliation(row.id)}>Detail</button></span>,
        ])} empty="Belum ada rekonsiliasi." />
        {reconDetails && <div className="sectionBlockLg">
          <h3>Detail rekonsiliasi · {reconDetails.reconciliation.status}</h3>
          <Table head={['Tanggal', 'Statement', 'Debit/Credit', 'Match', 'Aksi']} rows={reconDetails.statementLines.map((line) => {
            const amount = Number(line.credit) > 0 ? `+${rupiah(Number(line.credit))}` : `-${rupiah(Number(line.debit))}`;
            const candidates = reconDetails.journalLines.filter((journal) => Number(line.credit) > 0 ? Number(journal.debit) === Number(line.credit) && Number(journal.credit) === 0 : Number(journal.credit) === Number(line.debit) && Number(journal.debit) === 0);
            return [tanggal(line.transactionDate), <><strong>{line.description}</strong><small className="mutedText">{line.reference ?? '-'}</small></>, amount, line.matched ? <StatusChip status="COMPLETED" /> : <StatusChip status="PENDING" />, line.matched ? <button type="button" className="secondary" onClick={() => void unmatchLine(line.id)}>Unmatch</button> : <span className="inlineActions"><select value={manualMatches[line.id] ?? ''} onChange={(e) => setManualMatches({ ...manualMatches, [line.id]: e.target.value })}><option value="">Pilih journal</option>{candidates.map((journal) => <option key={journal.id} value={journal.id}>{journal.journalEntry.number} · {tanggal(journal.journalEntry.date)} · {journal.journalEntry.description}</option>)}</select><button type="button" onClick={() => void matchLine(line.id)}>Match</button></span>];
          })} empty="Tidak ada baris statement pada rentang ini." />
        </div>}
      </Panel>}

      {show('reports') && <ReportingWorkspace token={token} />}

      {financeDialog && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="finance-action-title">
        <div className="modalCard">
          <span className="eyebrow">FINANCE CONTROL</span>
          <h2 id="finance-action-title">{FINANCE_ACTION_LABEL[financeDialog.action]} {financeDialog.transaction.number}</h2>
          <p className="sectionHelp">{FINANCE_ACTION_HELP[financeDialog.action]}</p>
          <label>Alasan<textarea autoFocus value={financeDialog.notes} onChange={(event) => setFinanceDialog({ ...financeDialog, notes: event.target.value })} /></label>
          <div className="modalActions"><button type="button" className="secondary" onClick={() => setFinanceDialog(null)}>Kembali</button><button type="button" className={financeDialog.action === 'post' ? '' : 'dangerButton'} disabled={FINANCE_ACTION_REQUIRES_REASON[financeDialog.action] && !financeDialog.notes.trim()} onClick={() => void financeAction(financeDialog.transaction, financeDialog.action, financeDialog.notes)}>Konfirmasi</button></div>
        </div>
      </div>}

      {periodDialog && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="period-action-title">
        <div className="modalCard">
          <span className="eyebrow">FISCAL PERIOD</span>
          <h2 id="period-action-title">{PERIOD_ACTION_LABEL[periodDialog.action]} {periodDialog.period.name}</h2>
          <p className="sectionHelp">{PERIOD_ACTION_HELP[periodDialog.action]}</p>
          <label>Alasan<textarea autoFocus value={periodDialog.notes} onChange={(event) => setPeriodDialog({ ...periodDialog, notes: event.target.value })} /></label>
          <div className="modalActions"><button type="button" className="secondary" onClick={() => setPeriodDialog(null)}>Kembali</button><button type="button" className={periodDialog.action === 'close' ? 'dangerButton' : ''} disabled={periodDialog.action === 'close' && !periodDialog.notes.trim()} onClick={() => void periodAction(periodDialog.period, periodDialog.action, periodDialog.notes)}>Konfirmasi</button></div>
        </div>
      </div>}

      {accountEditDialog && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="account-edit-title">
        <div className="modalCard">
          <span className="eyebrow">CHART OF ACCOUNTS</span>
          <h2 id="account-edit-title">Edit nama akun {accountEditDialog.account.code}</h2>
          <label>Nama akun<input autoFocus value={accountEditDialog.name} onChange={(event) => setAccountEditDialog({ ...accountEditDialog, name: event.target.value })} /></label>
          <div className="modalActions"><button type="button" className="secondary" onClick={() => setAccountEditDialog(null)}>Batal</button><button type="button" disabled={!accountEditDialog.name.trim()} onClick={() => { void updateAccount(accountEditDialog.account, { name: accountEditDialog.name.trim() }); setAccountEditDialog(null); }}>Simpan</button></div>
        </div>
      </div>}

      {message && <div className="notice sectionBlock">{message}</div>}
    </>
  );
}
