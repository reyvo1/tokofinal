'use client';

import { ArrowUpRight, Boxes, CircleDollarSign, TrendingUp, TriangleAlert } from 'lucide-react';
import { BarSeriesChart, LineSeriesChart, ShareBars } from './charts';

type Analytics = {
  salesTrend: Array<{ date: string; revenue: number; profit: number; transactions: number }>;
  channels: Array<{ channel: string; revenue: number }>;
  cashFlow: Array<{ date: string; cashIn: number }>;
  topProducts: Array<{ name: string; sku: string; quantity: number; revenue: number }>;
  lowStock: Array<{ name: string; warehouse: string; available: number; minStock: number }>;
};

function rupiah(value: number) {
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(2)} M`;
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)} jt`;
  if (value >= 1_000) return `Rp ${(value / 1_000).toFixed(0)} rb`;
  return `Rp ${value}`;
}

const card = 'min-w-0 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_36px_rgba(15,23,42,0.055)] sm:p-6';

export default function AnalyticsWidgets({ data }: { data: Analytics | null }) {
  if (!data) return null;
  const trend = data.salesTrend;
  const totalRevenue = trend.reduce((sum, point) => sum + point.revenue, 0);
  const totalProfit = trend.reduce((sum, point) => sum + point.profit, 0);
  const totalTransactions = trend.reduce((sum, point) => sum + point.transactions, 0);
  const cashFlow = data.cashFlow.slice(-15);
  const criticalStock = data.lowStock.filter((row) => row.available <= row.minStock).length;

  return (
    <div className="space-y-4">
      <section className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,.045)]"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-700"><CircleDollarSign size={17}/></span><ArrowUpRight size={15} className="text-slate-300"/></div><small className="mt-4 block text-[9px] font-bold uppercase tracking-[.12em] text-slate-400">Revenue 30 hari</small><strong className="mt-1 block text-xl font-bold tracking-[-.04em] text-slate-950">{rupiah(totalRevenue)}</strong></article>
        <article className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,.045)]"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><TrendingUp size={17}/></span><ArrowUpRight size={15} className="text-slate-300"/></div><small className="mt-4 block text-[9px] font-bold uppercase tracking-[.12em] text-slate-400">Laba kotor</small><strong className="mt-1 block text-xl font-bold tracking-[-.04em] text-slate-950">{rupiah(totalProfit)}</strong></article>
        <article className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,.045)]"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Boxes size={17}/></span><ArrowUpRight size={15} className="text-slate-300"/></div><small className="mt-4 block text-[9px] font-bold uppercase tracking-[.12em] text-slate-400">Transaksi</small><strong className="mt-1 block text-xl font-bold tracking-[-.04em] text-slate-950">{totalTransactions.toLocaleString('id-ID')}</strong></article>
        <article className="rounded-[20px] border border-rose-200 bg-rose-50/60 p-4 shadow-[0_10px_26px_rgba(225,29,72,.045)]"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-rose-600 shadow-sm"><TriangleAlert size={17}/></span></div><small className="mt-4 block text-[9px] font-bold uppercase tracking-[.12em] text-rose-500">Stok kritis</small><strong className="mt-1 block text-xl font-bold tracking-[-.04em] text-rose-950">{criticalStock} item</strong></article>
      </section>

      <section className={card}>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4"><div><span className="text-[9px] font-bold uppercase tracking-[.16em] text-sky-600">ANALYTICS · 30 HARI</span><h2 className="mt-1 text-base font-semibold tracking-[-.02em] text-slate-900">Penjualan &amp; laba kotor</h2><p className="mt-1 text-xs text-slate-500">Tren harian membantu owner membaca pertumbuhan dan margin tanpa membuka laporan terpisah.</p></div><span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-600">Total {rupiah(totalRevenue)}</span></div>
        <LineSeriesChart data={trend.map((point) => ({ label: point.date, primary: point.revenue, secondary: point.profit }))} primaryLabel="Penjualan" secondaryLabel="Laba kotor" valueLabel={rupiah} />
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={card}><div className="mb-5 border-b border-slate-100 pb-4"><span className="text-[9px] font-bold uppercase tracking-[.16em] text-indigo-600">CHANNEL</span><h2 className="mt-1 text-base font-semibold tracking-[-.02em] text-slate-900">Penjualan per channel</h2></div><ShareBars items={data.channels.map((channel) => ({ label: channel.channel, value: channel.revenue }))} valueLabel={rupiah} /></div>
        <div className={card}><div className="mb-5 border-b border-slate-100 pb-4"><span className="text-[9px] font-bold uppercase tracking-[.16em] text-emerald-600">ARUS KAS</span><h2 className="mt-1 text-base font-semibold tracking-[-.02em] text-slate-900">Kas masuk 30 hari</h2></div><BarSeriesChart data={cashFlow.map((point) => ({ label: point.date.slice(5), value: point.cashIn }))} totalLabel={`Total kas masuk ${rupiah(data.cashFlow.reduce((sum, point) => sum + point.cashIn, 0))}`} /></div>
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={card}><div className="mb-4 flex items-end justify-between gap-3"><div><span className="text-[9px] font-bold uppercase tracking-[.16em] text-sky-600">PRODUK</span><h2 className="mt-1 text-base font-semibold tracking-[-.02em] text-slate-900">Top produk terlaris</h2></div></div><div className="table"><div className="tr th grid-cols-3"><span>Produk</span><span>Qty</span><span>Pendapatan</span></div>{data.topProducts.map((product) => <div className="tr grid-cols-3" key={product.sku}><span><strong>{product.name}</strong><small>{product.sku}</small></span><span>{product.quantity}</span><span className="font-semibold text-slate-800">{rupiah(product.revenue)}</span></div>)}</div></div>
        <div className={card}><div className="mb-4 flex items-end justify-between gap-3"><div><span className="text-[9px] font-bold uppercase tracking-[.16em] text-rose-600">PERHATIAN</span><h2 className="mt-1 text-base font-semibold tracking-[-.02em] text-slate-900">Stok menipis</h2></div><span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700">{criticalStock} kritis</span></div><div className="table"><div className="tr th grid-cols-3"><span>Produk</span><span>Gudang</span><span>Tersedia</span></div>{data.lowStock.map((row, index) => <div className="tr grid-cols-3" key={`${row.name}-${index}`}><span><strong>{row.name}</strong></span><span>{row.warehouse}</span><span className={row.available <= row.minStock ? 'danger font-semibold text-rose-600' : 'font-semibold text-slate-700'}>{row.available}</span></div>)}</div></div>
      </section>
    </div>
  );
}
