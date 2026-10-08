'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { Panel, Table, StatusChip, rupiah, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type AgingRow = {
  outstandingAmount: string | number;
  agingBucket: string;
  ageDays: number;
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  referenceType?: string;
  referenceId?: string;
  documentNumber?: string;
  supplierName?: string;
  dueDate?: string;
};
type AgingResponse = {
  asOf: string;
  totalOutstanding: string;
  openDocuments: number;
  asOfBuckets: Record<string, { count: number; amount: string }>;
  rows: AgingRow[];
};
type CashBankPosition = {
  accountId: string;
  code: string;
  name: string;
  bookBalance: string;
  latestStatementBalance?: string | null;
  latestStatementAt?: string | null;
  statementDelta?: string | null;
};
type SettlementTrace = {
  reference: { type: string; id: string };
  transactions: Array<{ id: string; number: string; type: string; status: string; grossAmount: string | number; accountingEventId?: string | null; transactionDate: string }>;
  accountingEvents: Array<{ id: string; eventType: string; status: string; businessDate: string; postings: Array<{ journalEntryId: string; status: string }> }>;
  journals: Array<{ id: string; number: string; date: string; description: string; lines: Array<{ id: string; debit: string | number; credit: string | number; account: { code: string; name: string } }> }>;
};

const bucketLabel: Record<string, string> = { CURRENT: 'Current', '1_30': '1–30', '31_60': '31–60', '61_90': '61–90', '90_PLUS': '>90' };

export default function FinanceDepthWorkspace({ token, mode }: { token: string; mode?: string | null }) {
  const [ar, setAr] = useState<AgingResponse | null>(null);
  const [ap, setAp] = useState<AgingResponse | null>(null);
  const [cashBank, setCashBank] = useState<CashBankPosition[]>([]);
  const [trace, setTrace] = useState<SettlementTrace | null>(null);
  const [message, setMessage] = useState('');

  async function api<T>(path: string): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  async function refresh() {
    try {
      const [arData, apData, cashData] = await Promise.all([
        api<AgingResponse>('/finance-operations/ar-aging'),
        api<AgingResponse>('/finance-operations/ap-aging'),
        api<CashBankPosition[]>('/finance-operations/cash-bank-position'),
      ]);
      setAr(arData); setAp(apData); setCashBank(cashData); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memuat finance depth.'); }
  }

  useEffect(() => { void refresh(); }, [token]);

  async function loadTrace(referenceType?: string, referenceId?: string) {
    if (!referenceType || !referenceId) return;
    try {
      setTrace(await api<SettlementTrace>(`/finance-operations/settlement-trace?referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}`));
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memuat settlement trace.'); }
  }

  const showAr = !mode || mode === 'receivables';
  const showAp = !mode || mode === 'payables';
  const showBank = !mode || mode === 'banking';
  const buckets = (aging: AgingResponse | null) => ['CURRENT','1_30','31_60','61_90','90_PLUS'].map((key) => [bucketLabel[key], aging?.asOfBuckets[key]?.count ?? 0, rupiah(Number(aging?.asOfBuckets[key]?.amount ?? 0))]);

  return <>
    {showAr && <Panel eyebrow="AR AGING" title="Piutang Pelanggan per Umur" badge={`${ar?.openDocuments ?? 0} dokumen`}>
      <Table head={['Bucket','Dokumen','Outstanding']} rows={buckets(ar)} empty="Belum ada aging piutang." />
      <Table head={['Order','Pelanggan','Umur','Bucket','Sisa','Trace']} rows={(ar?.rows ?? []).map((row) => [
        <strong>{row.orderNumber ?? row.orderId}</strong>, row.customerName ?? '-', `${row.ageDays} hari`, bucketLabel[row.agingBucket] ?? row.agingBucket,
        <strong>{rupiah(Number(row.outstandingAmount))}</strong>, <button type="button" className="secondary" onClick={() => void loadTrace('Order', row.orderId)}>Settlement</button>,
      ])} empty="Tidak ada piutang terbuka." />
    </Panel>}

    {showAp && <Panel eyebrow="AP AGING" title="Utang Supplier per Jatuh Tempo" badge={`${ap?.openDocuments ?? 0} dokumen`}>
      <Table head={['Bucket','Dokumen','Outstanding']} rows={buckets(ap)} empty="Belum ada aging utang." />
      <Table head={['Dokumen','Supplier','Jatuh tempo','Lewat','Bucket','Sisa','Trace']} rows={(ap?.rows ?? []).map((row) => [
        <strong>{row.documentNumber ?? row.referenceId}</strong>, row.supplierName ?? '-', row.dueDate ? tanggal(row.dueDate) : '-', `${row.ageDays} hari`, bucketLabel[row.agingBucket] ?? row.agingBucket,
        <strong>{rupiah(Number(row.outstandingAmount))}</strong>, <button type="button" className="secondary" onClick={() => void loadTrace(row.referenceType, row.referenceId)}>Settlement</button>,
      ])} empty="Tidak ada utang terbuka." />
    </Panel>}

    {showBank && <Panel eyebrow="CASH / BANK POSITION" title="Saldo Buku dan Statement Terakhir" badge={`${cashBank.length} akun`}>
      <Table head={['Akun','Saldo buku','Statement terakhir','Tanggal statement','Delta']} rows={cashBank.map((row) => [
        <><strong>{row.code}</strong><small className="blockMeta">{row.name}</small></>, rupiah(Number(row.bookBalance)), row.latestStatementBalance == null ? '-' : rupiah(Number(row.latestStatementBalance)), row.latestStatementAt ? tanggal(row.latestStatementAt) : '-', row.statementDelta == null ? '-' : rupiah(Number(row.statementDelta)),
      ])} empty="Belum ada akun kas/bank teridentifikasi." />
    </Panel>}

    {trace && <Panel eyebrow="SETTLEMENT TRACE" title={`${trace.reference.type} · ${trace.reference.id}`} badge={`${trace.transactions.length} settlement`}>
      <Table head={['Transaksi','Jenis','Tanggal','Nominal','Status','Event']} rows={trace.transactions.map((row) => [row.number, row.type, tanggal(row.transactionDate), rupiah(Number(row.grossAmount)), <StatusChip status={row.status} />, row.accountingEventId ?? '-'])} empty="Belum ada settlement untuk sumber ini." />
      <Table head={['Journal','Tanggal','Keterangan','Lines']} rows={trace.journals.map((journal) => [journal.number, tanggal(journal.date), journal.description, journal.lines.map((line) => `${line.account.code} ${line.account.name}: D ${Number(line.debit)} / C ${Number(line.credit)}`).join(' · ')])} empty="Belum ada journal settlement." />
      <button type="button" className="secondary" onClick={() => setTrace(null)}>Tutup trace</button>
    </Panel>}
    {message && <div className="notice">{message}</div>}
  </>;
}
