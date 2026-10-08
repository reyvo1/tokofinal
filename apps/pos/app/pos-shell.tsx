'use client';

import type { ReactNode } from 'react';
import { CreditCard, History, RefreshCw, Store, Wifi, WifiOff, CircleGauge, MoonStar, SunMedium } from 'lucide-react';
import { useT360Theme } from './theme-client';

export type PosWorkspace = 'SALE' | 'SHIFT' | 'RETURNS' | 'SYNC';

const WORKSPACES: Array<{ id: PosWorkspace; label: string; description: string; icon: typeof CreditCard }> = [
  { id: 'SALE', label: 'Penjualan', description: 'Scan produk, susun keranjang, quote server, dan selesaikan pembayaran.', icon: CreditCard },
  { id: 'SHIFT', label: 'Shift & Kas', description: 'Kontrol shift kasir, expected cash, kas masuk/keluar, dan penutupan.', icon: Store },
  { id: 'RETURNS', label: 'Retur', description: 'Cari transaksi asli dan buat retur auditable melalui jalur canonical.', icon: History },
  { id: 'SYNC', label: 'Sinkronisasi', description: 'Pantau antrean offline, konflik, retry, dan pemulihan koneksi.', icon: RefreshCw },
];

export function PosShell({ workspace, onWorkspaceChange, apiOnline, queueCount, conflictCount, companyName, branchName, warehouseControl, children }: { workspace: PosWorkspace; onWorkspaceChange: (workspace: PosWorkspace) => void; apiOnline: boolean; queueCount: number; conflictCount: number; companyName: string; branchName: string; warehouseControl: ReactNode; children: ReactNode; }) {
  const { theme, toggleTheme } = useT360Theme();
  const activeMeta = WORKSPACES.find((item) => item.id === workspace) ?? WORKSPACES[0];
  return (
    <main className="posV4 min-h-screen min-w-0" data-visual-product="pos" data-visual-version="p5-v4" data-visual-generation="p5-v4" data-ui-foundation="p5-v4.11" data-theme={theme} data-pos-theme={theme} data-visual-view={workspace.toLowerCase()}>
      <a className="skipLink" href="#pos-workspace">Lewati ke workspace POS</a>

      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 shadow-[0_8px_30px_rgba(15,23,42,.06)] backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-3 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-[10px] font-black tracking-[.08em] text-white shadow-lg shadow-teal-700/20">T3</span>
            <div className="min-w-0"><span className="posBrandEyebrow block text-[9px] font-bold uppercase tracking-[.18em]">TOKO360 POS · {companyName}</span><h1 className="posBrandTitle text-sm font-bold tracking-[-.025em]">Kasir · Terminal penjualan · {branchName}</h1><small className={`posConnectivity mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold ${apiOnline ? 'text-emerald-700' : 'text-amber-700'}`} role="status" aria-live="polite">{apiOnline ? <Wifi size={12}/> : <WifiOff size={12}/>} {apiOnline ? 'Server online' : 'Mode offline'}{queueCount ? ` · ${queueCount} antrean` : ''}</small></div>
          </div>
          <div className="posTopbarActions flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-inner shadow-slate-200/50 lg:justify-end">{warehouseControl}<button type="button" className="posThemeToggle" aria-label={theme === 'light' ? 'Aktifkan mode gelap' : 'Aktifkan mode terang'} onClick={toggleTheme}>{theme === 'light' ? <MoonStar size={16}/> : <SunMedium size={16}/>}</button></div>
        </div>

        <div className="mx-auto w-full max-w-[1720px] px-3 pb-3 sm:px-5 lg:px-6">
          <nav className="posWorkspaceNav" aria-label="Workspace POS">
            {WORKSPACES.map(({ id, label, icon: Icon }) => {
              const badge = id === 'SYNC' ? queueCount : id === 'RETURNS' ? conflictCount : 0;
              const active = workspace === id;
              return (
                <button key={id} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onWorkspaceChange(id)}>
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-current/5"><Icon size={16}/></span>
                  <span className="min-w-0 truncate">{label}</span>
                  {badge > 0 && <b>{badge}</b>}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1720px] min-w-0 px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
        <section id="pos-workspace" className="posWorkspaceSurface" tabIndex={-1}>
          <header className="posWorkspaceHeader">
            <div className="min-w-0"><span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.17em] text-teal-700"><CircleGauge size={13}/>WORKSPACE KASIR</span><h2 className="mt-1 text-2xl font-bold tracking-[-.04em] text-slate-950">{activeMeta.label}</h2><p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500 sm:text-[13px]">{activeMeta.description}</p></div>
            <div className={`posWorkspaceStatus ${apiOnline ? 'ok' : 'warn'}`}>{apiOnline ? 'Transaksi online' : 'Offline terbatas'}</div>
          </header>
          <div className="posWorkspaceBody">{children}</div>
        </section>
      </div>
    </main>
  );
}
