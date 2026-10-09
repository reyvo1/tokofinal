'use client';

import { Home, Search, ShoppingBag, UserRound, LogIn, Store, MapPin, ShieldCheck, MoonStar, SunMedium } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT360Theme } from './theme-client';

export type StorefrontView = 'home' | 'catalog' | 'product' | 'cart' | 'account';

const NAV_ITEMS: Array<{ id: StorefrontView; label: string; description: string; icon: typeof Home }> = [
  { id: 'home', label: 'Beranda', description: 'Belanja langsung dari toko dengan stok dan harga cabang yang aktif.', icon: Home },
  { id: 'catalog', label: 'Katalog', description: 'Cari produk, bandingkan harga, dan lihat ketersediaan aktual.', icon: Search },
  { id: 'cart', label: 'Keranjang', description: 'Tinjau barang, kuantitas, pembayaran, dan checkout sebelum membuat order.', icon: ShoppingBag },
  { id: 'account', label: 'Akun & Pesanan', description: 'Kelola identitas pelanggan, pesanan, favorit, ulasan, dan retur.', icon: UserRound },
];

export function StorefrontShell({ companyName, activeView, cartCount, signedIn, onNavigate, branchCode, branches, onBranchChange, children }: { companyName: string; branchCode: string; branches: Array<{ code: string; name: string }>; onBranchChange: (branchCode: string) => void; activeView: StorefrontView; cartCount: number; signedIn: boolean; onNavigate: (view: StorefrontView) => void; children: ReactNode; }) {
  const { theme, toggleTheme } = useT360Theme();
  const activeMeta = activeView === 'product'
    ? { label: 'Detail produk', description: 'Periksa varian, unit, harga, stok, dan pilihan pembelian sebelum menambah ke keranjang.' }
    : (NAV_ITEMS.find((item) => item.id === activeView) ?? NAV_ITEMS[0]);

  return (
    <div className="storefrontV4 min-h-screen" data-visual-product="storefront" data-visual-version="p5-v4" data-visual-generation="p5-v4" data-ui-foundation="p5-v4.11" data-theme={theme} data-visual-view={activeView}>
      <a className="skipLink" href="#storefront-main">Lewati ke konten utama</a>

      <div className="bg-slate-950 px-4 py-2 text-center text-[10px] font-semibold tracking-[.04em] text-white"><span className="inline-flex items-center gap-2"><ShieldCheck size={13} className="text-emerald-400"/>Harga, stok, dan promo mengikuti cabang aktif secara real-time</span></div>

      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur-2xl">
        <div className="mx-auto flex min-h-[76px] w-full max-w-[1500px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <button className="flex shrink-0 items-center gap-3 rounded-2xl border-0 bg-transparent p-0 text-left" type="button" onClick={() => onNavigate('home')} aria-label="Buka beranda">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-900 text-[11px] font-black tracking-[.08em] text-white shadow-lg shadow-emerald-900/15">T3</span>
            <span className="hidden min-w-0 sm:block"><strong className="block max-w-52 truncate text-[15px] font-bold tracking-[-.025em] text-slate-950">{companyName}</strong><small className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[.16em] text-stone-400">Official Store</small></span>
          </button>

          <nav className="desktopNav hidden flex-1 items-center justify-center gap-1 md:flex" aria-label="Navigasi storefront">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeView || (item.id === 'catalog' && activeView === 'product');
              return <button key={item.id} className={`relative inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-semibold transition ${active ? 'bg-slate-950 text-white shadow-md shadow-slate-950/15' : 'text-slate-500 hover:bg-white hover:text-slate-950 hover:shadow-sm'}`} type="button" aria-current={active ? 'page' : undefined} onClick={() => onNavigate(item.id)}><Icon size={15}/>{item.label}{item.id === 'cart' && cartCount > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-500 px-1 text-[9px] text-white">{cartCount}</span> : null}</button>;
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {branches.length > 1 ? <label className="relative flex max-w-[124px] min-w-0 items-center sm:max-w-none"><MapPin size={14} className="pointer-events-none absolute left-3 text-stone-400"/><span className="srOnly">Pilih cabang storefront</span><select className="h-10 w-full min-w-0 rounded-full border border-stone-200 bg-white pl-8 pr-6 text-[10px] font-semibold text-slate-600 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" aria-label="Pilih cabang storefront" value={branchCode} onChange={(event) => onBranchChange(event.target.value)}>{branches.map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label> : null}
            <button className="storefrontThemeToggle" type="button" aria-label={theme === 'light' ? 'Aktifkan mode gelap' : 'Aktifkan mode terang'} onClick={toggleTheme}>{theme === 'light' ? <MoonStar size={16}/> : <SunMedium size={16}/>}</button>
            <button aria-label={signedIn ? 'Buka akun dan pesanan' : 'Masuk ke akun'} className="storefrontAccountButton inline-flex h-10 items-center gap-2 rounded-full border border-stone-200 bg-white px-3 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:-translate-y-px hover:text-slate-950 hover:shadow-md" type="button" onClick={() => onNavigate('account')}>{signedIn ? <UserRound size={16}/> : <LogIn size={16}/>}<span className="hidden lg:inline">{signedIn ? 'Akun saya' : 'Masuk'}</span></button>
          </div>
        </div>
      </header>

      <main id="storefront-main" className="storefrontMain" tabIndex={-1}>
        <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[.15em] text-stone-400"><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-emerald-700"><Store size={12}/>TOKO360 STOREFRONT</span><span>{activeView === 'product' ? 'Katalog / Detail produk' : activeMeta.label}</span></div>
        {activeView !== 'home' && (
          <header className="mt-4 flex flex-col gap-4 rounded-[28px] border border-white bg-white/85 p-5 shadow-[0_18px_48px_rgba(15,23,42,.07)] backdrop-blur-xl sm:flex-row sm:items-end sm:justify-between sm:p-6">
            <div><h1 className="text-2xl font-bold tracking-[-.045em] text-slate-950 sm:text-3xl">{activeMeta.label}</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{activeMeta.description}</p></div>
            <span className="inline-flex w-fit items-center rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-[10px] font-semibold text-slate-600">{branches.find((branch) => branch.code === branchCode)?.name ?? branchCode}</span>
          </header>
        )}
        <div className="storefrontViewBody mt-5 min-w-0">{children}</div>
      </main>

      <nav className="mobileNav" aria-label="Navigasi storefront mobile">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeView || (item.id === 'catalog' && activeView === 'product');
          return <button key={item.id} className={active ? 'active' : ''} type="button" aria-current={active ? 'page' : undefined} onClick={() => onNavigate(item.id)}><span className="relative"><Icon size={18}/>{item.id === 'cart' && cartCount > 0 ? <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-emerald-500 px-1 text-[8px] text-white">{cartCount}</span> : null}</span><small>{item.label === 'Akun & Pesanan' ? 'Akun' : item.label}</small></button>;
        })}
      </nav>
    </div>
  );
}
