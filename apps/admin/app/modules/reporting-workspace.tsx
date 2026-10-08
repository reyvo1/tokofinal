'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table, rupiah, tanggal } from '../ui';
import { REPORT_TYPES, reportTypeLabel } from '../report-catalog';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type AccountRow = { accountId?: string; code: string; name: string; type?: string; debit?: number; credit?: number; normalBalance?: number; amount?: number };
type ProfitLoss = { from: string; to: string; revenue: number; expenses: number; netProfit: number; revenueAccounts: AccountRow[]; expenseAccounts: AccountRow[] };
type TrialBalance = { rows: AccountRow[]; totalDebit: number; totalCredit: number; difference: number; balanced: boolean };
type BalanceSheet = { totalAssets: number; totalLiabilities: number; totalEquity: number; totalLiabilitiesAndEquity: number; difference: number; balanced: boolean; assets: AccountRow[]; liabilities: AccountRow[]; equity: AccountRow[]; currentEarnings: number };
type CashFlow = { cashIn: number; cashOut: number; netCashFlow: number; rows: Array<{ journalNumber: string; date: string; description: string; accountCode: string; cashIn: number; cashOut: number; net: number }> };
type Margin = { revenueExTax: number; cost: number; grossMargin: number; rows: Array<{ id: string; number: string; date: string; channel: string; revenueExTax: number; cost: number; margin: number; marginPercent: number }> };
type Valuation = { summary: { skuCount: number; quantity: number; available: number; inventoryValue: number }; items: Array<{ id: string; quantity: number; available: number; inventoryValue: number | string; product: { sku: string; name: string; costPrice: number | string }; warehouse: { name: string } }> };
type TaxSummary = { outputTax: number; recoverableInputTax: number; nonRecoverableInputTax: number; withholdingTax: number; netIndirectTaxPayable: number; indirectTaxCredit: number; rows: Array<{ code: string; name: string; direction: string; taxableBase: number; taxAmount: number }> };
type Comparison = { current: { from: string; to: string; revenue: number; expenses: number; netProfit: number }; previous: { from: string; to: string; revenue: number; expenses: number; netProfit: number }; changePercent: { revenue: number | null; expenses: number | null; netProfit: number | null } };
type DimensionComparison = { branchScope: string; branches: Array<{ id: string; code: string; name: string; revenue: number; expenses: number; netProfit: number }>; costCenters: Array<{ costCenterId: string; label: string; amount: number }> };
type Integrity = { status: string; blockers: number; warnings: number; trialBalance: { difference: number; balanced: boolean }; balanceSheet: { difference: number; balanced: boolean }; postedEventsMissingJournal: number; failedEvents: number; queuedEvents: number };
type DrillDown = { account: { code: string; name: string; type: string }; rows: Array<{ journalLineId: string; journalNumber: string; date: string; debit: number; credit: number; runningBalance: number; referenceType: string; referenceId: string; description: string; accountingEvent: null | { id: string; eventType: string; sourceType: string; sourceId: string; status: string } }> };
type GeneralLedger = { accountCode: string | null; from: string; to: string; entries: Array<{ id: string; number: string; date: string; referenceType: string; referenceId: string; description: string; lines: Array<{ accountCode: string; accountName: string; accountType: string; debit: number; credit: number }> }> };
type ReportJob = { id: string; reportType: string; format: string; status: string; progress: number; outputUrl?: string | null; errorMessage?: string | null; createdAt: string };
type PeakHours = { days: number; peakHour: number; buckets: Array<{ hour: number; transactions: number; revenue: number }> };
type DeadStock = { days: number; items: Array<{ productId: string; sku: string; name: string; warehouse: string; quantity: number; tiedUpValue: string | number }> };
type CustomerRfm = { days: number; items: Array<{ customerId: string; name: string; phone?: string | null; recencyDays: number; frequency: number; monetary: number; segment: string }> };
type CursorResponse<T> = T[] | { items?: T[] };

function pct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

type ReportingMode = 'financial' | 'operations' | 'scheduled';

export default function ReportingWorkspace({ token, mode = 'financial' }: { token: string; mode?: ReportingMode }) {
  // D-3: POST /reports/jobs requires report.export. A view-only report operator could see the
  // export form but every submission would 403.
  const { canAll } = usePermissions(token);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [profitLoss, setProfitLoss] = useState<ProfitLoss | null>(null);
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  const [margin, setMargin] = useState<Margin | null>(null);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [taxSummary, setTaxSummary] = useState<TaxSummary | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [dimensions, setDimensions] = useState<DimensionComparison | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  const [generalLedger, setGeneralLedger] = useState<GeneralLedger | null>(null);
  const [accountCode, setAccountCode] = useState('');
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHours | null>(null);
  const [deadStock, setDeadStock] = useState<DeadStock | null>(null);
  const [customerRfm, setCustomerRfm] = useState<CustomerRfm | null>(null);
  const [reportType, setReportType] = useState<string>('PROFIT_LOSS');
  const [format, setFormat] = useState('XLSX');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? `HTTP ${response.status}`);
    return payload as T;
  }

  // S-4: the backend accepts companyId/branchId and validates them with
  // assertRequestedScope; the UI previously never sent either, so a multi-branch owner had
  // no way to produce a period report across branches.
  const [scopeCompanyId, setScopeCompanyId] = useState('');
  const [scopeBranchId, setScopeBranchId] = useState('');

  // S-2: each panel is fetched independently so one failing endpoint no longer blanks the
  // whole workspace, and a mode only fetches what it actually renders.
  async function loadSection<T>(label: string, run: () => Promise<T>, apply: (value: T) => void): Promise<void> {
    try {
      apply(await run());
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Gagal dimuat';
      setSectionErrors((current) => ({ ...current, [label]: reason }));
    }
  }

  async function loadReports() {
    setLoading(true); setMessage(''); setSectionErrors({});
    const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    // Cross-branch scope is opt-in and server-validated; empty means the token's own scope.
    const scope = `${scopeCompanyId ? `&companyId=${encodeURIComponent(scopeCompanyId)}` : ''}${scopeBranchId ? `&branchId=${encodeURIComponent(scopeBranchId)}` : ''}`;

    const loads: Array<Promise<void>> = [];

    if (mode === 'financial') {
      loads.push(
        loadSection('profit-loss', () => api<ProfitLoss>(`/reports/profit-loss?${range}${scope}`), setProfitLoss),
        loadSection('trial-balance', () => api<TrialBalance>(`/reports/trial-balance?${range}${scope}`), (tb) => {
          setTrialBalance(tb);
          setAccountCode((current) => current || tb.rows[0]?.code || '');
        }),
        loadSection('balance-sheet', () => api<BalanceSheet>(`/reports/balance-sheet?asOf=${encodeURIComponent(to)}${scope}`), setBalanceSheet),
        loadSection('cash-flow', () => api<CashFlow>(`/reports/cash-flow?${range}${scope}`), setCashFlow),
        loadSection('tax-summary', () => api<TaxSummary>(`/reports/tax-summary?${range}${scope}`), setTaxSummary),
        loadSection('period-comparison', () => api<Comparison>(`/reports/period-comparison?${range}${scope}`), setComparison),
        loadSection('financial-integrity', () => api<Integrity>(`/reports/financial-integrity?asOf=${encodeURIComponent(to)}${scope}`), setIntegrity),
      );
    }

    if (mode === 'operations') {
      loads.push(
        loadSection('margin', () => api<Margin>(`/reports/margin?${range}&limit=100${scope}`), setMargin),
        loadSection('inventory-valuation', () => api<Valuation>(`/reports/inventory-valuation?limit=100${scope}`), setValuation),
        loadSection('dimension-comparison', () => api<DimensionComparison>(`/reports/dimension-comparison?${range}${scope}`), setDimensions),
        loadSection('peak-hours', () => api<PeakHours>('/reports/peak-hours?days=30'), setPeakHours),
        loadSection('dead-stock', () => api<DeadStock>('/reports/dead-stock?days=30&limit=50'), setDeadStock),
        loadSection('customer-rfm', () => api<CustomerRfm>('/reports/customer-rfm?days=90&limit=50'), setCustomerRfm),
      );
    }

    if (mode === 'scheduled') {
      loads.push(loadSection('jobs', () => api<CursorResponse<ReportJob>>('/reports/jobs?limit=50'), (page) => {
        setJobs(Array.isArray(page) ? page : page.items ?? []);
      }));
    }

    await Promise.all(loads);
    setLoading(false);
  }

  // S-3: the date range and the scope now apply in every mode, and a token change
  // (branch switch) re-runs the load.
  useEffect(() => { void loadReports(); }, [token, mode, from, to, scopeCompanyId, scopeBranchId]);

  const accountOptions = useMemo(() => trialBalance?.rows ?? [], [trialBalance]);

  async function loadDrillDown(code?: string) {
    const target = (code ?? accountCode).trim();
    if (!target) return;
    try {
      setAccountCode(target);
      setDrillDown(await api<DrillDown>(`/reports/drill-down?accountCode=${encodeURIComponent(target)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuka drill-down.'); }
  }

  async function loadGeneralLedger() {
    const query = new URLSearchParams({ from, to, limit: '200' });
    if (accountCode) query.set('accountCode', accountCode);
    try {
      setGeneralLedger(await api<GeneralLedger>(`/reports/general-ledger?${query.toString()}`));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuka General Ledger.'); }
  }

  async function createExport(event: React.FormEvent) {
    event.preventDefault();
    try {
      const filters: Record<string, unknown> = { from, to, asOf: to };
      if (reportType === 'GENERAL_LEDGER' && accountCode) filters.accountCode = accountCode;
      const row = await api<ReportJob>('/reports/jobs', { method: 'POST', body: JSON.stringify({ reportType, format, filters }) });
      setJobs((current) => [row, ...current]);
      setMessage(`Export ${row.reportType} ${row.format} masuk antrean worker.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuat export.'); }
  }

  async function download(row: ReportJob) {
    const response = await authFetch(`${API}/reports/jobs/${row.id}/download`, token);
    if (!response.ok) { setMessage(`Download gagal (${response.status}).`); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${row.reportType.toLowerCase()}-${row.id}.${row.format.toLowerCase()}`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <>
    <div className="responsiveFormGrid sectionBlock">
      <label>Dari<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Sampai<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label>Company ID (opsional)<input value={scopeCompanyId} placeholder="kosong = company dari token" onChange={(event) => setScopeCompanyId(event.target.value.trim())} /></label>
      <label>Branch ID (opsional)<input value={scopeBranchId} placeholder="kosong = branch dari token" onChange={(event) => setScopeBranchId(event.target.value.trim())} /></label>
      <button type="button" disabled={loading} onClick={() => void loadReports()}>{loading ? 'Memuat…' : 'Muat ulang'}</button>
    </div>
    {Object.keys(sectionErrors).length > 0 && <div className="notice sectionBlock">Sebagian laporan gagal dimuat: {Object.entries(sectionErrors).map(([key, value]) => `${key} (${value})`).join(' · ')}</div>}
    {mode === 'financial' && <>
    <Panel eyebrow="FINANCIAL REPORTING" title="Laporan Keuangan & Perbandingan" badge={loading ? 'Memuat…' : integrity?.status ?? 'READY'}>
      <form className="responsiveFormGrid" onSubmit={(event) => { event.preventDefault(); void loadReports(); }}>
        <p className="sectionHelp">Rentang periode dan cakupan company/branch diatur pada baris kontrol di atas laporan.</p>
        <button>Refresh laporan</button>
      </form>
      <div className="grid4">
        <article className="stat"><span>Pendapatan</span><strong>{rupiah(profitLoss?.revenue ?? 0)}</strong><small>{comparison ? pct(comparison.changePercent.revenue) : 'vs periode sebelumnya'}</small></article>
        <article className="stat"><span>Beban</span><strong>{rupiah(profitLoss?.expenses ?? 0)}</strong><small>{comparison ? pct(comparison.changePercent.expenses) : 'vs periode sebelumnya'}</small></article>
        <article className="stat"><span>Laba Bersih</span><strong>{rupiah(profitLoss?.netProfit ?? 0)}</strong><small>{comparison ? pct(comparison.changePercent.netProfit) : 'vs periode sebelumnya'}</small></article>
        <article className="stat"><span>Arus Kas Bersih</span><strong>{rupiah(cashFlow?.netCashFlow ?? 0)}</strong><small>Kas masuk {rupiah(cashFlow?.cashIn ?? 0)}</small></article>
      </div>
      {integrity && <div className="sectionHelp">
        <p>Integrity <strong>{integrity.status}</strong> · blockers {integrity.blockers} · warnings {integrity.warnings} · trial difference {rupiah(integrity.trialBalance.difference)} · balance sheet difference {rupiah(integrity.balanceSheet.difference)}</p>
        <p>Posting bermasalah: <strong>{integrity.postedEventsMissingJournal}</strong> event posted tanpa jurnal · <strong>{integrity.failedEvents}</strong> event gagal · <strong>{integrity.queuedEvents}</strong> event masih antre. Nilai di atas 0 berarti ada posting rusak yang harus diperiksa di Accounting Event dan antrean worker.</p>
      </div>}
    </Panel>

    <section className="grid2">
      <Panel eyebrow="TRIAL BALANCE" title="Neraca Saldo" badge={trialBalance?.balanced ? 'BALANCED' : 'REVIEW'}>
        <Table head={['Akun','Debit','Credit','Saldo']} rows={(trialBalance?.rows ?? []).map((row) => [<button type="button" className="secondary" onClick={() => void loadDrillDown(row.code)}>{row.code} · {row.name}</button>, rupiah(row.debit ?? 0), rupiah(row.credit ?? 0), rupiah(row.normalBalance ?? 0)])} empty="Belum ada aktivitas jurnal." />
      </Panel>
      <Panel eyebrow="BALANCE SHEET" title="Posisi Keuangan" badge={balanceSheet?.balanced ? 'BALANCED' : 'REVIEW'}>
        <Table head={['Kelompok','Nilai']} rows={[
          ['Aset', rupiah(balanceSheet?.totalAssets ?? 0)],
          ['Liabilitas', rupiah(balanceSheet?.totalLiabilities ?? 0)],
          ['Ekuitas + laba berjalan', rupiah(balanceSheet?.totalEquity ?? 0)],
          ['Selisih', rupiah(balanceSheet?.difference ?? 0)],
        ]} />
      </Panel>
    </section>

    </>}

    {mode === 'operations' && <section className="grid2">
      <Panel eyebrow="INVENTORY" title="Valuasi Persediaan" badge={`${valuation?.summary.skuCount ?? 0} SKU`}>
        <Table head={['Produk','Gudang','Qty','Available','Nilai']} rows={(valuation?.items ?? []).slice(0, 30).map((row) => [`${row.product.sku} · ${row.product.name}`, row.warehouse.name, String(row.quantity), String(row.available), rupiah(Number(row.inventoryValue))])} empty="Belum ada stok." />
        <p className="sectionHelp">Total live inventory: <strong>{rupiah(valuation?.summary.inventoryValue ?? 0)}</strong></p>
      </Panel>
      <Panel eyebrow="MARGIN" title="Margin Penjualan" badge={rupiah(margin?.grossMargin ?? 0)}>
        <Table head={['Transaksi','Channel','Revenue ex-tax','Cost','Margin']} rows={(margin?.rows ?? []).slice(0, 30).map((row) => [row.number, row.channel, rupiah(row.revenueExTax), rupiah(row.cost), `${rupiah(row.margin)} · ${row.marginPercent.toFixed(1)}%`])} empty="Belum ada penjualan pada periode." />
      </Panel>
    </section>}

    {mode === 'operations' && <section className="grid2">
      <Panel eyebrow="DIMENSION" title="Perbandingan Cabang" badge={dimensions?.branchScope ?? 'CURRENT_BRANCH'}>
        <Table head={['Cabang','Pendapatan','Beban','Laba']} rows={(dimensions?.branches ?? []).map((row) => [`${row.code} · ${row.name}`, rupiah(row.revenue), rupiah(row.expenses), rupiah(row.netProfit)])} empty="Belum ada journal dimension." />
      </Panel>
      <Panel eyebrow="COST CENTER" title="Accounting Event Dimension" badge={`${dimensions?.costCenters.length ?? 0} bucket`}>
        <Table head={['Cost Center','Net Amount']} rows={(dimensions?.costCenters ?? []).map((row) => [row.label, rupiah(row.amount)])} empty="Belum ada dimensions.costCenterId pada accounting event line." />
      </Panel>
    </section>}

    {mode === 'operations' && <section className="grid2">
      <Panel eyebrow="OPERATIONS ANALYTICS" title="Peak Hours" badge={peakHours ? `${peakHours.days} hari` : '30 hari'}>
        <Table head={['Jam','Transaksi','Revenue']} rows={(peakHours?.buckets ?? []).filter((row) => row.transactions > 0).sort((a,b) => b.transactions - a.transactions).slice(0,12).map((row) => [`${String(row.hour).padStart(2,'0')}:00`, String(row.transactions), rupiah(row.revenue)])} empty="Belum ada transaksi untuk analisis jam sibuk." />
        {peakHours && <p className="sectionHelp">Jam puncak: <strong>{String(peakHours.peakHour).padStart(2,'0')}:00</strong>.</p>}
      </Panel>
      <Panel eyebrow="INVENTORY ANALYTICS" title="Dead Stock" badge={`${deadStock?.items.length ?? 0} item`}>
        <Table head={['Produk','Gudang','Qty','Nilai tertahan']} rows={(deadStock?.items ?? []).map((row) => [`${row.sku} · ${row.name}`, row.warehouse, String(row.quantity), rupiah(Number(row.tiedUpValue))])} empty="Tidak ada dead stock pada periode ini." />
        <p className="sectionHelp">Produk bersaldo yang tidak terjual selama {deadStock?.days ?? 30} hari.</p>
      </Panel>
    </section>}

    {mode === 'operations' && <Panel eyebrow="CUSTOMER ANALYTICS" title="Customer RFM" badge={`${customerRfm?.items.length ?? 0} customer`}>
      <Table head={['Customer','Segment','Recency','Frequency','Monetary']} rows={(customerRfm?.items ?? []).map((row) => [<span key={row.customerId}><strong>{row.name}</strong><small>{row.phone ?? '-'}</small></span>, <StatusChip key={`${row.customerId}-segment`} status={row.segment} />, `${row.recencyDays} hari`, String(row.frequency), rupiah(row.monetary)])} empty="Belum ada customer dengan transaksi pada periode RFM." />
      <p className="sectionHelp">RFM menggunakan periode {customerRfm?.days ?? 90} hari dan hanya transaksi COMPLETED pada tenant/cabang aktif.</p>
    </Panel>}

    {mode === 'financial' && <>
    <Panel eyebrow="REPORT DRILL-DOWN" title="Akun → Jurnal → Accounting Event → Source" badge={(drillDown?.account.code ?? accountCode) || undefined}>
      <div className="controlRow">
        <label className="fieldWide">Akun<select value={accountCode} onChange={(event) => setAccountCode(event.target.value)}><option value="">Pilih akun</option>{accountOptions.map((row) => <option key={row.code} value={row.code}>{row.code} · {row.name}</option>)}</select></label>
        <button type="button" onClick={() => void loadDrillDown()}>Buka drill-down</button>
      </div>
      <Table head={['Tanggal','Jurnal','Debit/Credit','Running','Source']} rows={(drillDown?.rows ?? []).map((row) => [tanggal(row.date), `${row.journalNumber} · ${row.description}`, `${rupiah(row.debit)} / ${rupiah(row.credit)}`, rupiah(row.runningBalance), row.accountingEvent ? `${row.accountingEvent.eventType} → ${row.accountingEvent.sourceType}:${row.accountingEvent.sourceId}` : `${row.referenceType}:${row.referenceId}`])} empty="Pilih akun untuk membuka drill-down." />
    </Panel>

    <Panel eyebrow="GENERAL LEDGER" title="Buku Besar" badge={generalLedger ? `${generalLedger.entries.length} jurnal` : 'READY'}>
      <div className="controlRow">
        <label className="fieldWide">Akun<select value={accountCode} onChange={(event) => setAccountCode(event.target.value)}><option value="">Semua akun</option>{accountOptions.map((row) => <option key={row.code} value={row.code}>{row.code} · {row.name}</option>)}</select></label>
        <button type="button" onClick={() => void loadGeneralLedger()}>Tampilkan buku besar</button>
      </div>
      <Table head={['Tanggal','Jurnal / Source','Akun','Debit','Credit']} rows={(generalLedger?.entries ?? []).flatMap((entry) => entry.lines.map((line) => [tanggal(entry.date), <><strong>{entry.number}</strong><small>{entry.referenceType}:{entry.referenceId}</small></>, `${line.accountCode} · ${line.accountName}`, rupiah(line.debit), rupiah(line.credit)]))} empty="Klik Tampilkan buku besar untuk memuat jurnal canonical." />
    </Panel>

    <Panel eyebrow="TAX REPORT" title="Tax Summary" badge={rupiah(taxSummary?.netIndirectTaxPayable ?? 0)}>
      <Table head={['Kode','Direction','Taxable Base','Tax']} rows={(taxSummary?.rows ?? []).map((row) => [`${row.code} · ${row.name}`, row.direction, rupiah(row.taxableBase), rupiah(row.taxAmount)])} empty="Belum ada tax transaction POSTED." />
    </Panel>
    </>}



    {mode === 'scheduled' && <Panel eyebrow="ASYNC REPORT JOB" title="PDF / XLSX / CSV" badge={`${jobs.length} job`}>
      <form className="responsiveFormGrid" onSubmit={createExport}>
        <label>Jenis laporan<select value={reportType} onChange={(event) => setReportType(event.target.value)}>{REPORT_TYPES.map((type) => <option key={type} value={type}>{reportTypeLabel(type)}</option>)}</select></label>
        <label>Format<select value={format} onChange={(event) => setFormat(event.target.value)}><option>CSV</option><option>XLSX</option><option>PDF</option></select></label>
        <button disabled={!canAll('report.export')}>Buat export</button>
      </form>
      <Table head={['Dibuat','Laporan','Format','Progress','Status','Aksi']} rows={jobs.map((row) => [tanggal(row.createdAt), row.reportType, row.format, `${row.progress ?? 0}%`, <StatusChip status={row.status} />, row.status === 'DONE' ? <button type="button" className="secondary" onClick={() => void download(row)}>Download</button> : row.status === 'FAILED' ? <small>{row.errorMessage ?? 'Worker gagal.'}</small> : <span>Worker queue</span>])} empty="Belum ada report job." />
    </Panel>}

    {message && <div className="notice sectionBlock">{message}</div>}
  </>;
}
