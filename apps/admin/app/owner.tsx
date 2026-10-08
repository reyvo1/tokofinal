'use client';
import { authFetch } from './auth-fetch';
// Halaman OWNER — ringkasan eksekutif bisnis dari jurnal dan reporting core.
import { useEffect, useState } from 'react';
import { CircleDollarSign, Landmark, Package, TrendingDown } from 'lucide-react';
import { ErrorState, Skeleton } from './ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type PL = { from: string; to: string; revenue: number; expenses: number; netProfit: number };
type BalanceSheet = { totalAssets: number; totalLiabilities: number; totalEquity: number; currentEarnings: number; difference: number; balanced: boolean };
type Integrity = { status: 'PASS' | 'WARN' | 'FAIL'; blockers: number; warnings: number; trialBalance: { difference: number; balanced: boolean }; balanceSheet: { difference: number; balanced: boolean }; pendingFinanceTransactions: number; unresolvedEvents: number };
type Valuation = { summary?: { inventoryValue?: number }; items?: Array<{ productName?: string; warehouseName?: string; quantity?: number; value?: number }> } | Array<{ productId?: string; warehouseId?: string }> | Record<string, unknown>;

function inventoryValueOf(value: Valuation): number {
  if (Array.isArray(value) || !value || typeof value !== 'object' || !('summary' in value)) return 0;
  const summary = value.summary;
  if (!summary || typeof summary !== 'object' || !('inventoryValue' in summary)) return 0;
  const amount = Number((summary as { inventoryValue?: unknown }).inventoryValue ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function rupiah(v: number) {
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2)} M`;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1)} jt`;
  if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)} rb`;
  return `Rp ${v}`;
}

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function readJson<T>(url: string, token: string): Promise<T> {
  const response = await authFetch(url, token);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function OwnerView({ token }: { token: string }) {
  const [pl, setPl] = useState<PL | null>(null);
  const [valuation, setValuation] = useState<number | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodDays, setPeriodDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - periodDays);
    const fromText = localDate(from);
    const toText = localDate(to);
    setLoading(true);
    setError('');
    Promise.all([
      readJson<PL>(`${API}/reports/profit-loss?from=${fromText}&to=${toText}`, token),
      readJson<Valuation>(`${API}/reports/inventory-valuation`, token),
      readJson<BalanceSheet>(`${API}/reports/balance-sheet?asOf=${toText}`, token),
      readJson<Integrity>(`${API}/reports/financial-integrity?asOf=${toText}`, token),
    ])
      .then(([plData, valData, balanceData, integrityData]) => {
        if (!active) return;
        setPl(plData);
        setBalanceSheet(balanceData);
        setIntegrity(integrityData);
        const total = inventoryValueOf(valData);
        setValuation(total);
        setPeriodLabel(`${fromText} → ${toText}`);
      })
      .catch((err: Error) => {
        if (active) setError(err.message || 'Laporan owner gagal dimuat.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token, periodDays]);

  const margin = pl && pl.revenue > 0 ? ((pl.netProfit / pl.revenue) * 100).toFixed(1) : '0';

  return (
    <>
      <div className="ownerToolbar">
        <span className="eyebrow">OWNER SUITE</span>
        <select className="ownerPeriodSelect" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} aria-label="Periode laporan owner">
          <option value={7}>7 hari</option>
          <option value={30}>30 hari</option>
          <option value={90}>90 hari</option>
          <option value={365}>1 tahun</option>
        </select>
        {!loading && !error && <small className="ownerMeta">Periode {periodLabel} · integrity {integrity?.status ?? 'UNKNOWN'}</small>}
      </div>

      {error && <ErrorState message={`Laporan Owner Suite tidak dapat dimuat: ${error}`} />}

      {!error && <>
        <section className="stats">
          <article className="statCard">
            <span className="ico" aria-hidden="true"><CircleDollarSign size={20} /></span><small>Pendapatan</small>
            <strong>{loading ? '—' : rupiah(pl?.revenue ?? 0)}</strong>
            <span className="delta">periode {periodDays} hari</span>
          </article>
          <article className="statCard">
            <span className="ico" aria-hidden="true"><TrendingDown size={20} /></span><small>Beban</small>
            <strong>{loading ? '—' : rupiah(pl?.expenses ?? 0)}</strong>
            <span className="delta">operasional</span>
          </article>
          <article className="statCard">
            <span className="ico" aria-hidden="true"><Landmark size={20} /></span><small>Laba Bersih</small>
            <strong>{loading ? '—' : rupiah(pl?.netProfit ?? 0)}</strong>
            <span className="delta">margin {loading ? '—' : `${margin}%`}</span>
          </article>
          <article className="statCard">
            <span className="ico" aria-hidden="true"><Package size={20} /></span><small>Nilai Persediaan</small>
            <strong>{loading ? '—' : valuation !== null ? rupiah(valuation) : '—'}</strong>
            <span className="delta">aset stok saat ini</span>
          </article>
        </section>

        <section className="panel">
          <div className="panelTitle"><div><span className="eyebrow">LAPORAN LABA RUGI</span><h2>Ringkasan Keuangan Owner</h2></div><span>{loading ? 'Memuat…' : 'Dari jurnal posted'}</span></div>
          {loading ? <Skeleton rows={4} /> : <div className="table">
            <div className="tr th"><span>Komponen</span><span>Nominal</span><span>Rasio</span></div>
            <div className="tr"><span><strong>Pendapatan (Revenue)</strong></span><span className="okText">{rupiah(pl?.revenue ?? 0)}</span><span>100%</span></div>
            <div className="tr"><span><strong>Beban (Expenses)</strong></span><span className="danger">{rupiah(pl?.expenses ?? 0)}</span><span>{pl && pl.revenue > 0 ? `${((pl.expenses / pl.revenue) * 100).toFixed(1)}%` : '—'}</span></div>
            <div className="tr"><span><strong>Laba Bersih (Net Profit)</strong></span><span className="okText"><b>{rupiah(pl?.netProfit ?? 0)}</b></span><span>{margin}%</span></div>
          </div>}
          <p className="ownerNote">
            Laporan dihitung dari jurnal double-entry yang sudah POSTED. Transaksi yang masih draft/pending tidak dinyatakan sebagai hasil final.
          </p>
        </section>

        <section className="panel">
          <div className="panelTitle"><div><span className="eyebrow">POSISI & INTEGRITAS</span><h2>Neraca dan Rekonsiliasi</h2></div><span>{loading ? 'Memuat…' : integrity?.status ?? '—'}</span></div>
          {loading ? <Skeleton rows={5} /> : <div className="table">
            <div className="tr th"><span>Komponen</span><span>Nominal / Status</span><span>Kontrol</span></div>
            <div className="tr"><span><strong>Total Aset</strong></span><span>{rupiah(balanceSheet?.totalAssets ?? 0)}</span><span>Jurnal posted</span></div>
            <div className="tr"><span><strong>Total Liabilitas</strong></span><span>{rupiah(balanceSheet?.totalLiabilities ?? 0)}</span><span>Jurnal posted</span></div>
            <div className="tr"><span><strong>Total Ekuitas + Laba Berjalan</strong></span><span>{rupiah(balanceSheet?.totalEquity ?? 0)}</span><span>{balanceSheet?.balanced ? 'BALANCED' : `Selisih ${rupiah(Math.abs(balanceSheet?.difference ?? 0))}`}</span></div>
            <div className="tr"><span><strong>Double-entry Integrity</strong></span><span>{integrity?.status ?? '—'}</span><span>{integrity ? `${integrity.blockers} blocker · ${integrity.warnings} warning` : '—'}</span></div>
          </div>}
          <p className="ownerNote">
            Status integrity berasal dari keseimbangan debit/kredit, neraca, accounting event, transaksi keuangan pending, dan status pajak.
          </p>
        </section>
      </>}
    </>
  );
}
