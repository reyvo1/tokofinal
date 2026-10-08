'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  UserCircle2,
  X,
} from 'lucide-react';
import type { AdminIdentity, AdminRuntimeManifest, AdminWorkspace, ResolvedAdminNavigation } from './navigation';
import { domainRoute, resolveDomainViews, type AdminDomainView } from './domain-workspaces';
import { useT360Theme } from './theme-client';

type BranchContext = {
  activeBranchId: string;
  homeBranchId: string;
  canSwitch: boolean;
  branches: Array<{ id: string; code: string; name: string; isActive: boolean }>;
};

type Props = {
  manifest: AdminRuntimeManifest | null;
  identity: AdminIdentity | null;
  navigation: ResolvedAdminNavigation;
  activeWorkspace: AdminWorkspace;
  activeDomainView: AdminDomainView | null;
  apiConnected: boolean;
  branchContext: BranchContext | null;
  /** Number of failed notifications, resolved by the data layer; the shell stays presentation-only. */
  attentionCount?: number;
  onBranchChange: (branchId: string) => void;
  onNavigate: (route: string) => void;
  onReload: () => void;
  onLogout: () => void;
  headerAction?: ReactNode;
  children: ReactNode;
};

type NavigationEntry = {
  item: AdminWorkspace;
  views: AdminDomainView[];
  visibleViews: AdminDomainView[];
  matchesRoot: boolean;
};


function searchableText(workspace: AdminWorkspace, views: AdminDomainView[]) {
  return [
    workspace.label,
    workspace.title,
    workspace.description,
    ...views.flatMap((view) => [view.label, view.title, view.description]),
  ].join(' ').toLocaleLowerCase('id-ID');
}

export default function AdminAppShell({
  manifest,
  identity,
  navigation,
  activeWorkspace,
  activeDomainView,
  apiConnected,
  branchContext,
  attentionCount = 0,
  onBranchChange,
  onNavigate,
  onReload,
  onLogout,
  headerAction,
  children,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [query, setQuery] = useState('');
  const { theme, toggleTheme } = useT360Theme();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(media.matches);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    update();
    media.addEventListener('change', update);
    window.addEventListener('keydown', closeOnEscape);
    return () => { media.removeEventListener('change', update); window.removeEventListener('keydown', closeOnEscape); };
  }, []);

  const domainViews = useMemo(
    () => resolveDomainViews(activeWorkspace, manifest, identity),
    [activeWorkspace, manifest, identity],
  );
  const effectiveDomainView = activeDomainView ?? domainViews[0] ?? null;


  useEffect(() => {
    setExpanded((current) => ({ ...current, [activeWorkspace.key]: true }));
  }, [activeWorkspace.key]);

  const navigationTree = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID');
    return navigation
      .map((group) => {
        const items: NavigationEntry[] = group.items
          .map((item) => {
            const views = resolveDomainViews(item, manifest, identity);
            const rootText = `${item.label} ${item.title} ${item.description}`.toLocaleLowerCase('id-ID');
            const matchesRoot = !needle || rootText.includes(needle);
            const visibleViews = !needle
              ? views
              : views.filter((view) => `${view.label} ${view.title} ${view.description}`.toLocaleLowerCase('id-ID').includes(needle));
            const matchesAnything = !needle || matchesRoot || visibleViews.length > 0 || searchableText(item, views).includes(needle);
            return matchesAnything ? { item, views, visibleViews, matchesRoot } : null;
          })
          .filter((entry): entry is NavigationEntry => Boolean(entry));
        return { ...group, items };
      })
      .filter((group) => group.items.length > 0);
  }, [navigation, manifest, identity, query]);

  const navigate = (route: string) => {
    setMobileOpen(false);
    onNavigate(route);
  };

  const toggleExpanded = (key: string) => {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  };

  const branchLabel = manifest?.branch?.name ?? 'Cabang aktif';
  const companyLabel = manifest?.company?.name ?? 'Toko360';
  const activeRole = identity?.roles[0]?.replace(/_/g, ' ') ?? 'Administrator';
  const pageTitle = activeWorkspace.key === 'dashboard' && !activeDomainView
    ? 'Dashboard Overview'
    : effectiveDomainView?.title ?? activeWorkspace.title;
  const pageDescription = activeWorkspace.key === 'dashboard' && !activeDomainView
    ? 'Ringkasan KPI, performa, exception operasional, dan tindakan cepat hari ini.'
    : effectiveDomainView?.description ?? activeWorkspace.description;

  return (
    <div
      className="adminV4"
      data-theme={theme}
      data-visual-product="admin"
      data-visual-version="p5-v4"
      data-visual-generation="p5-v4"
      data-ui-foundation="p5-v4.11"
      data-visual-workspace={activeWorkspace.key}
      data-visual-view={effectiveDomainView?.key ?? 'overview'}
    >
      <a className="skipLink" href="#admin-main">Lewati ke konten utama</a>

      <div className="adminV4Layout" data-admin-layout="primary">
        <aside className={`adminV4Sidebar ${mobileOpen ? 'mobileOpen' : ''}`} aria-label="Navigasi Admin" inert={isMobile && !mobileOpen} aria-hidden={isMobile && !mobileOpen}>
          <div className="adminV4Brand">
            <div className="adminBrandMark">T3</div>
            <div className="adminBrandCopy">
              <strong>{companyLabel}</strong>
              <span>Business command center</span>
            </div>
            <button type="button" className="adminIconButton adminMobileOnly" aria-label="Tutup menu" onClick={() => setMobileOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <nav className="adminPrimaryNavigation" aria-label="Domain Admin">
            {navigationTree.map((group) => (
              <section key={group.group} className="adminNavSection">
                <div className="adminNavGroup">{group.group}</div>
                <div className="adminNavList">
                  {group.items.map(({ item, views, visibleViews, matchesRoot }) => {
                    const active = activeWorkspace.route === item.route;
                    const queryActive = Boolean(query.trim());
                    const showViews = views.length > 0 && (active || expanded[item.key] || (queryActive && visibleViews.length > 0));
                    const renderedViews = queryActive && !matchesRoot ? visibleViews : views;
                    return (
                      <div key={item.route} className={`adminNavCluster ${active ? 'isActive' : ''}`}>
                        <div className="adminNavRootRow">
                          <button
                            type="button"
                            className={`navItem adminNavItem ${active ? 'isActive' : ''}`}
                            data-admin-route={item.route}
                            aria-current={active && !activeDomainView ? 'page' : undefined}
                            onClick={() => navigate(item.route)}
                          >
                            <span className="adminNavIcon"><item.Icon size={17} /></span>
                            <span className="navLabel">{item.label}</span>
                          </button>
                          {views.length > 0 && (
                            <button
                              type="button"
                              className="adminNavToggle"
                              aria-label={`${showViews ? 'Tutup' : 'Buka'} submenu ${item.label}`}
                              aria-expanded={showViews}
                              onClick={() => toggleExpanded(item.key)}
                            >
                              {showViews ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                          )}
                        </div>

                        {showViews && renderedViews.length > 0 && (
                          <div className="adminSidebarSubdomains" aria-label={`Subdomain ${item.label}`}>
                            {renderedViews.map((view) => {
                              const selected = active && effectiveDomainView?.key === view.key;
                              return (
                                <button
                                  type="button"
                                  key={view.key}
                                  className={selected ? 'isActive' : ''}
                                  data-admin-route={domainRoute(item, view)}
                                  aria-current={selected ? 'page' : undefined}
                                  onClick={() => navigate(domainRoute(item, view))}
                                >
                                  <view.Icon size={13} />
                                  <span>{view.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {!navigationTree.length && <div className="adminEmptyFilter">Tidak ada domain atau subdomain yang cocok.</div>}
          </nav>

          <div className="adminTenantCardWrap">
            <div className="adminTenantCard">
              <div className="adminTenantHead">
                <span className="adminTenantIcon"><Building2 size={15} /></span>
                <div>
                  <small>Tenant aktif</small>
                  <strong>{companyLabel}</strong>
                </div>
              </div>
              {branchContext?.canSwitch && branchContext.branches.length > 1 ? (
                <label className="adminBranchField">
                  <span>Cabang aktif</span>
                  <select aria-label="Ganti cabang aktif" value={branchContext.activeBranchId} onChange={(event) => onBranchChange(event.target.value)}>
                    {branchContext.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.code} · {branch.name}{branch.id === branchContext.homeBranchId ? ' · HOME' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : <span className="adminTenantBranch">{branchLabel}</span>}
            </div>
            <button type="button" className="adminLogoutButton" onClick={onLogout}><LogOut size={15} />Keluar</button>
          </div>
        </aside>

        {mobileOpen && <button className="adminSidebarBackdrop" type="button" aria-label="Tutup menu" onClick={() => setMobileOpen(false)} />}

        <div className="adminV4Main">
          <header className="adminTopbar">
            <div className="adminTopbarInner">
              <div className="adminTopbarStart">
                <button type="button" className="adminIconButton adminMobileOnly" aria-label="Buka menu" onClick={() => setMobileOpen(true)}>
                  <Menu size={19} />
                </button>
                <label className="adminHeaderSearch">
                  <Search size={16} />
                  <input
                    aria-label="Cari domain atau subdomain"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Cari domain atau subdomain..."
                  />
                </label>
              </div>

              <div className="adminTopbarActions">
                <div className={`adminSystemStatus ${apiConnected ? 'isOnline' : 'isPending'}`} role="status" aria-live="polite">
                  <span />{apiConnected ? 'Sistem online' : 'Menghubungkan'}
                </div>
                <button type="button" className="adminIconButton" aria-label="Muat ulang" onClick={onReload}><RefreshCw size={17} /></button>
                <button
                  type="button"
                  className="adminIconButton"
                  aria-label={theme === 'light' ? 'Aktifkan mode gelap' : 'Aktifkan mode terang'}
                  onClick={toggleTheme}
                >
                  {theme === 'light' ? '◐' : '☀'}
                </button>
                <button type="button" className="adminIconButton adminNotificationButton" aria-label={attentionCount > 0 ? `Pusat notifikasi, ${attentionCount} notifikasi gagal` : 'Pusat notifikasi'} title={attentionCount > 0 ? `${attentionCount} notifikasi gagal dikirim` : 'Tidak ada notifikasi gagal'} onClick={() => navigate('/integrations/notifications')}>
                  <Bell size={17} />{attentionCount > 0 && <span className="adminNotificationDot" aria-hidden="true" />}
                </button>
                <div className="adminProfileChip">
                  <span className="adminProfileAvatar"><UserCircle2 size={18} /></span>
                  <span>
                    <strong>{activeRole}</strong>
                    <small>{branchLabel}</small>
                  </span>
                </div>
              </div>
            </div>
          </header>

          <main
            id="admin-main"
            className="adminMainContent"
            tabIndex={-1}
            data-admin-workspace={activeWorkspace.key}
            data-admin-view={effectiveDomainView?.key ?? ''}
          >
            <header className="adminPageHeader" data-visual-role="page-header">
              <div className="adminPageHeading">
                <div className="adminBreadcrumbs">
                  <span>{activeWorkspace.group}</span>
                  <ChevronRight size={12} />
                  <span>{activeWorkspace.label}</span>
                  {effectiveDomainView && <><ChevronRight size={12} /><strong>{effectiveDomainView.label}</strong></>}
                </div>
                <div className="adminPageTitleLine">
                  <h1>{pageTitle}</h1>
                  {activeWorkspace.key === 'dashboard' && <span className="miniBadge">Live data</span>}
                </div>
                <p>{pageDescription}</p>
              </div>
              {headerAction && <div className="adminPageActions">{headerAction}</div>}
            </header>

            <div className="workspaceSurface">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
