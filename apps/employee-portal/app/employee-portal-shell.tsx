'use client';

import Link from 'next/link';
import { CalendarDays, History, Home, LogOut, MapPinCheckInside, ReceiptText, TimerReset, UserRound, Sparkles, Building2, MoonStar, SunMedium } from 'lucide-react';
import { useT360Theme } from './theme-client';

export type { EmployeePortalView } from './employee-portal-views';
import type { EmployeePortalView } from './employee-portal-views';

type NavItem = { id: EmployeePortalView; label: string; description: string; href: string; Icon: typeof Home; };

const NAV: NavItem[] = [
  { id: 'home', label: 'Beranda', description: 'Ringkasan hari kerja dan akses cepat', href: '/', Icon: Home },
  { id: 'attendance', label: 'Absensi', description: 'Presensi GPS, selfie, dan geofence', href: '/attendance', Icon: MapPinCheckInside },
  { id: 'leave', label: 'Cuti & Izin', description: 'Pengajuan dan status persetujuan', href: '/leave', Icon: CalendarDays },
  { id: 'overtime', label: 'Lembur', description: 'Pengajuan lembur dan hasil approval', href: '/overtime', Icon: TimerReset },
  { id: 'payslips', label: 'Slip Gaji', description: 'Riwayat slip yang sudah dipublikasikan', href: '/payslips', Icon: ReceiptText },
  { id: 'history', label: 'Riwayat', description: 'Riwayat presensi dan status kehadiran', href: '/history', Icon: History },
  { id: 'profile', label: 'Profil', description: 'Identitas employee dan konteks cabang', href: '/profile', Icon: UserRound },
];

export { isEmployeePortalView } from './employee-portal-views';
export function employeePortalMeta(view: EmployeePortalView) { return NAV.find((item) => item.id === view) ?? NAV[0]; }

export function EmployeePortalShell({ activeView, employeeName, employeeNumber, companyName, branchName, loading, onLogout, children }: { activeView: EmployeePortalView; employeeName?: string; employeeNumber?: string; companyName: string; branchName: string; loading: boolean; onLogout: () => void; children: React.ReactNode; }) {
  const { theme, toggleTheme } = useT360Theme();
  const meta = employeePortalMeta(activeView);

  return (
    <main className="employeeV4 min-h-screen lg:grid lg:grid-cols-[250px_minmax(0,1fr)]" data-visual-product="employee-portal" data-visual-version="p5-v4" data-visual-generation="p5-v4" data-ui-foundation="p5-v4.11" data-theme={theme} data-visual-view={activeView}>
      <a className="skipLink" href="#employee-main">Lewati ke konten utama</a>

      <aside className="hidden employeeSidebar border-r border-slate-200/80 bg-white/95 p-4 text-slate-900 shadow-[8px_0_30px_rgba(15,23,42,.04)] backdrop-blur-xl lg:flex lg:h-screen lg:flex-col">
        <div className="relative overflow-hidden rounded-[24px] border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50 p-4 shadow-sm">
          <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-violet-200/50 blur-2xl"/>
          <span className="relative inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.17em] text-violet-700"><Sparkles size={12}/>TOKO360 HR</span>
          <strong className="relative mt-2 block text-lg font-bold tracking-[-.035em] text-slate-950">Portal Karyawan</strong>
          <small className="relative mt-1 block truncate text-[10px] text-slate-500">{companyName} · {branchName}</small>
        </div>

        <nav className="employeeNav mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label="Navigasi Portal Karyawan">
          {NAV.map((item) => {
            const Icon = item.Icon;
            const active = item.id === activeView;
            return (
              <Link key={item.id} className={`group grid min-h-[52px] grid-cols-[40px_minmax(0,1fr)] items-center gap-2 rounded-2xl border px-2.5 py-2 transition ${active ? 'border-violet-200 bg-violet-50 text-violet-950 shadow-sm' : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950'}`} href={item.href} aria-current={active ? 'page' : undefined}>
                <span className={`grid h-10 w-10 place-items-center rounded-xl border ${active ? 'border-violet-200 bg-white text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-500 group-hover:text-slate-700'}`}><Icon size={17}/></span>
                <span className="min-w-0"><strong className="block truncate text-[12px] font-semibold">{item.label}</strong><small className="mt-0.5 block truncate text-[9px] text-slate-500">{item.description}</small></span>
              </Link>
            );
          })}
        </nav>

        <div className="employeeIdentityCard mt-4 rounded-[20px] border border-slate-200 bg-slate-50 p-3 shadow-sm">
          <div className="flex items-start gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-100 text-violet-700"><Building2 size={15}/></span><div className="min-w-0"><small className="block text-[9px] font-bold uppercase tracking-[.13em] text-slate-400">Akun aktif</small><strong className="mt-1 block truncate text-xs font-semibold text-slate-900">{employeeName ?? 'Karyawan'}</strong><span className="mt-0.5 block truncate text-[10px] text-slate-500">{employeeNumber ?? (loading ? 'Memuat profil…' : 'Profil belum tersedia')}</span></div></div>
        </div>
      </aside>

      <section id="employee-main" className="min-w-0 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.09),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]" tabIndex={-1}>
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/88 backdrop-blur-2xl">
          <div className="flex min-h-[72px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-[.17em] text-violet-600">{companyName} · {branchName}</span><h1 className="mt-0.5 truncate text-sm font-semibold tracking-[-.02em] text-slate-900">Halo, {employeeName ?? 'Karyawan'}</h1><p className="truncate text-[10px] text-slate-400">{employeeNumber ?? (loading ? 'Memuat profil…' : 'Profil belum tersedia')}</p></div>
            <div className="employeeTopActions"><button type="button" className="employeeThemeToggle" aria-label={theme === 'light' ? 'Aktifkan mode gelap' : 'Aktifkan mode terang'} onClick={toggleTheme}>{theme === 'light' ? <MoonStar size={16}/> : <SunMedium size={16}/>}</button><button className="employeeLogoutButton inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:-translate-y-px hover:shadow-md" onClick={onLogout}><LogOut size={15}/>Keluar</button></div>
          </div>
        </header>

        <nav className="employeeMobileNav" aria-label="Navigasi mobile Portal Karyawan">
          {NAV.map((item) => { const Icon = item.Icon; return <Link key={item.id} className={item.id === activeView ? 'active' : ''} href={item.href} aria-current={item.id === activeView ? 'page' : undefined}><Icon size={16}/><span>{item.label}</span></Link>; })}
        </nav>

        <div className="mx-auto w-full max-w-[1500px] px-4 pb-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          <div className="employeeWorkspaceHeading relative overflow-hidden rounded-[30px] border border-white/80 bg-white/90 p-5 shadow-[0_22px_60px_rgba(15,23,42,.08)] backdrop-blur-xl sm:p-6">
            <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-violet-200/55 blur-3xl"/>
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div><small className="text-[9px] font-bold uppercase tracking-[.17em] text-violet-600">PORTAL KARYAWAN / {meta.label.toUpperCase()}</small><h2 className="mt-1.5 text-2xl font-bold tracking-[-.045em] text-slate-950 sm:text-3xl">{meta.label}</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{meta.description}</p></div>
              <div className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700">{loading ? 'Memuat data' : 'Self-service aktif'}</div>
            </div>
          </div>
        </div>

        <div className="employeeViewBody">{children}</div>
      </section>
    </main>
  );
}
