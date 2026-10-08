'use client';

import type { ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  Boxes,
  ClipboardList,
  PackagePlus,
  ShoppingCart,
  TriangleAlert,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { CountUp, EmptyState } from './ui';
import { LineSeriesChart } from './charts';

type DashboardData = {
  today: {
    revenue: number;
    transactions: number;
    recognizedRevenue: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    netProfit: number;
    source: string;
  };
  inventory: { items: number; lowStock: number; value: number };
  pendingOrders: number;
};

type AnalyticsData = {
  salesTrend: Array<{ date: string; revenue: number; profit: number; transactions: number }>;
  channels: Array<{ channel: string; revenue: number }>;
  cashFlow: Array<{ date: string; cashIn: number }>;
  topProducts: Array<{ name: string; sku: string; quantity: number; revenue: number }>;
  lowStock: Array<{ name: string; warehouse: string; available: number; minStock: number }>;
};

type InventoryMovementData = {
  id: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
  product: { name: string; sku?: string | null };
  warehouse: { name: string };
};

type Props = {
  dashboard: DashboardData | null;
  analytics: AnalyticsData | null;
  inventoryMovements: InventoryMovementData[];
  onNavigate: (route: string) => void;
};

type DonutSegment = { label: string; value: number; note: string };

function money(value: number) {
  // A single non-numeric field must never reach the operator as "Rp NaN". The dashboard
  // aggregates several analytics endpoints, and a missing or malformed value in any of them
  // previously propagated straight into the currency formatter.
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(safe);
}

function compactMoney(value: number) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (safe >= 1_000_000_000) return `Rp ${(safe / 1_000_000_000).toFixed(2)} M`;
  if (safe >= 1_000_000) return `Rp ${(safe / 1_000_000).toFixed(1)} jt`;
  if (safe >= 1_000) return `Rp ${(safe / 1_000).toFixed(0)} rb`;
  return money(safe);
}

function percent(value: number, total: number) {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function formatActivityLabel(type: string) {
  return type
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutArc(cx: number, cy: number, r: number, start: number, end: number) {
  const startPoint = polar(cx, cy, r, end);
  const endPoint = polar(cx, cy, r, start);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${startPoint.x} ${startPoint.y} A ${r} ${r} 0 ${largeArc} 0 ${endPoint.x} ${endPoint.y}`;
}

function DashboardDonut({ items }: { items: DonutSegment[] }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0));
  const colors = ['var(--dashboard-accent-1)', 'var(--dashboard-accent-2)', 'var(--dashboard-accent-3)', 'var(--dashboard-accent-4)', 'var(--dashboard-accent-5)'];
  let angle = 0;

  return (
    <div className="dashboardDonutWrap">
      <div className="dashboardDonutVisual" aria-hidden="true">
        <svg viewBox="0 0 160 160" className="dashboardDonutSvg" data-chart-kind="donut">
          <circle cx="80" cy="80" r="48" className="dashboardDonutTrack" />
          {items.map((item, index) => {
            const slice = (item.value / total) * 360;
            const path = donutArc(80, 80, 48, angle, angle + slice);
            const result = (
              <path
                key={item.label}
                d={path}
                stroke={colors[index % colors.length]}
                strokeWidth="20"
                fill="none"
                strokeLinecap="round"
              />
            );
            angle += slice;
            return result;
          })}
          <circle cx="80" cy="80" r="29" className="dashboardDonutCenter" />
          <text x="80" y="76" textAnchor="middle" className="dashboardDonutValue">{items.length}</text>
          <text x="80" y="94" textAnchor="middle" className="dashboardDonutText">kategori</text>
        </svg>
      </div>
      <div className="dashboardDonutLegend">
        {items.map((item, index) => (
          <div key={item.label} className="dashboardLegendRow">
            <div className="dashboardLegendTitle">
              <span className="dashboardLegendDot" style={{ background: colors[index % colors.length] }} />
              <span>{item.label}</span>
            </div>
            <div className="dashboardLegendMeta">
              <strong>{percent(item.value, total)}</strong>
              <span>{item.note}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  accent,
  icon,
  label,
  value,
  detail,
}: {
  accent: 'emerald' | 'violet' | 'blue' | 'orange' | 'cyan' | 'pink';
  icon: ReactNode;
  label: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <article className={`dashboardMetric dashboardMetric--${accent}`} data-dashboard-metric={accent}>
      <div className="dashboardMetricHead">
        <span className="dashboardMetricIcon">{icon}</span>
        <span className="dashboardMetricChip">Live</span>
      </div>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

export default function DashboardOverview({ dashboard, analytics, inventoryMovements, onNavigate }: Props) {
  // A truthy `analytics` is not enough. ReportsController is role-gated, so a role outside that
  // list gets a 403, and a partially-served response can arrive as an object whose collections
  // are missing. The previous null-only check let analytics.salesTrend.reduce() throw, which
  // took the whole dashboard to a blank page — the "layout is broken for my role" report.
  const salesTrend = Array.isArray(analytics?.salesTrend) ? analytics.salesTrend : [];
  const cashFlow = Array.isArray(analytics?.cashFlow) ? analytics.cashFlow : [];
  const topProducts = Array.isArray(analytics?.topProducts) ? analytics.topProducts : [];
  const lowStock = Array.isArray(analytics?.lowStock) ? analytics.lowStock : [];
  const movements = Array.isArray(inventoryMovements) ? inventoryMovements : [];
  const today = dashboard?.today;

  if (!dashboard || !today) {
    return (
      <section className="dashboardShell">
        <EmptyState
          title="Dashboard sedang disiapkan"
          description="Data ringkasan akan muncul setelah runtime manifest, dashboard, dan analitik berhasil dimuat."
        />
      </section>
    );
  }

  // Each total degrades to 0 rather than NaN when the underlying series is empty or partial.
  const totalRevenue = salesTrend.reduce((sum, point) => sum + (Number(point?.revenue) || 0), 0);
  const totalTransactions = salesTrend.reduce((sum, point) => sum + (Number(point?.transactions) || 0), 0);
  const grossProfit = salesTrend.reduce((sum, point) => sum + (Number(point?.profit) || 0), 0);
  const cashIn = cashFlow.reduce((sum, point) => sum + (Number(point?.cashIn) || 0), 0);
  const productMix = topProducts
    .slice(0, 5)
    .map((item) => ({ label: item.name, value: Math.max(Number(item?.revenue) || 0, 0), note: compactMoney(Number(item?.revenue) || 0) }));
  const driverTotal = Math.max(1, topProducts.reduce((sum, item) => sum + (Number(item?.revenue) || 0), 0));
  const recentActivity = movements.slice(0, 5);

  return (
    <div className="dashboardShell space-y-5">
      <section className="dashboardMetricGrid">
        <MetricCard
          accent="emerald"
          icon={<Wallet size={18} />}
          label="Total Revenue"
          value={<CountUp value={totalRevenue} format={money} />}
          detail="Akumulasi 30 hari terakhir"
        />
        <MetricCard
          accent="violet"
          icon={<ShoppingCart size={18} />}
          label="Total Sales"
          value={<CountUp value={totalTransactions} />}
          detail={`${today.transactions} transaksi hari ini`}
        />
        <MetricCard
          accent="blue"
          icon={<Boxes size={18} />}
          label="Total Products"
          value={<CountUp value={dashboard.inventory.items} />}
          detail="Produk dengan saldo atau pergerakan aktif"
        />
        <MetricCard
          accent="orange"
          icon={<ClipboardList size={18} />}
          label="Pending Orders"
          value={<CountUp value={dashboard.pendingOrders} />}
          detail="Butuh tindak lanjut fulfillment"
        />
        <MetricCard
          accent="cyan"
          icon={<TriangleAlert size={18} />}
          label="Low Stock Alerts"
          value={<CountUp value={dashboard.inventory.lowStock} />}
          detail="Item perlu reorder atau transfer"
        />
        <MetricCard
          accent="pink"
          icon={<Activity size={18} />}
          label="Gross Profit"
          value={<CountUp value={Number.isFinite(grossProfit) ? grossProfit : today.grossProfit} format={money} />}
          detail={`${compactMoney(cashIn)} kas masuk 30 hari`}
        />
      </section>

      <section className="dashboardGrid dashboardGrid--primary">
        <article className="dashboardPanel dashboardPanel--wide" data-dashboard-panel="sales-performance">
          <div className="dashboardPanelHeader">
            <div>
              <span className="dashboardPanelEyebrow">Sales Performance</span>
              <h3>Performa penjualan vs laba</h3>
            </div>
            <span className="dashboardPanelMeta">30 hari</span>
          </div>
          <LineSeriesChart
            data={salesTrend.map((point) => ({
              label: point.date.slice(5),
              primary: point.revenue,
              secondary: point.profit,
            }))}
            primaryLabel="Revenue"
            secondaryLabel="Gross profit"
            valueLabel={money}
          />
        </article>

        <article className="dashboardPanel" data-dashboard-panel="top-revenue-drivers">
          <div className="dashboardPanelHeader">
            <div>
              <span className="dashboardPanelEyebrow">Top Revenue Drivers</span>
              <h3>Produk paling berkontribusi</h3>
            </div>
            <span className="dashboardPanelMeta">Top 5</span>
          </div>
          <div className="dashboardRankList">
            {topProducts.slice(0, 5).map((product, index) => {
              const ratio = Math.max(8, Math.round((product.revenue / driverTotal) * 100));
              return (
                <div key={product.sku} className="dashboardRankItem">
                  <div className="dashboardRankHead">
                    <span className="dashboardRankBadge">P{index + 1}</span>
                    <div className="dashboardRankTitle">
                      <strong>{product.name}</strong>
                      <span>{product.quantity} unit · {compactMoney(product.revenue)}</span>
                    </div>
                  </div>
                  <div className="dashboardProgress"><span style={{ width: `${ratio}%` }} /></div>
                </div>
              );
            })}
          </div>
          <div className="dashboardPanelFooter">
            <span>Revenue produk unggulan</span>
            <strong>{money(topProducts.slice(0, 5).reduce((sum, item) => sum + item.revenue, 0))}</strong>
          </div>
        </article>

        <article className="dashboardPanel" data-dashboard-panel="product-performance">
          <div className="dashboardPanelHeader">
            <div>
              <span className="dashboardPanelEyebrow">Product Performance</span>
              <h3>Komposisi revenue produk</h3>
            </div>
            <span className="dashboardPanelMeta">Distribusi</span>
          </div>
          {productMix.length ? (
            <DashboardDonut items={productMix} />
          ) : (
            <EmptyState title="Belum ada data komposisi" description="Kategori performa produk akan muncul ketika penjualan produk sudah tersedia." />
          )}
        </article>
      </section>

      <section className="dashboardGrid dashboardGrid--secondary">
        <article className="dashboardPanel" data-dashboard-panel="recent-activity">
          <div className="dashboardPanelHeader">
            <div>
              <span className="dashboardPanelEyebrow">Recent Activity</span>
              <h3>Ledger & movement terbaru</h3>
            </div>
            <span className="dashboardPanelMeta">{recentActivity.length} event</span>
          </div>
          <div className="dashboardList">
            {recentActivity.length ? recentActivity.map((movement) => (
              <div key={movement.id} className="dashboardListItem">
                <span className="dashboardListIcon"><Activity size={16} /></span>
                <div className="dashboardListContent">
                  <strong>{movement.product.name}</strong>
                  <span>{formatActivityLabel(movement.type)} · {movement.warehouse.name}</span>
                  <small>{new Date(movement.createdAt).toLocaleString('id-ID')} · saldo {movement.balanceAfter}</small>
                </div>
                <div className="dashboardListAside">
                  <strong>{movement.quantity > 0 ? '+' : ''}{movement.quantity}</strong>
                  <span>{movement.referenceType ?? 'MOVEMENT'}</span>
                </div>
              </div>
            )) : <EmptyState title="Belum ada aktivitas" description="Pergerakan stok dan ledger terbaru akan muncul di sini." />}
          </div>
        </article>

        <article className="dashboardPanel" data-dashboard-panel="stock-watchlist">
          <div className="dashboardPanelHeader">
            <div>
              <span className="dashboardPanelEyebrow">Stock Watchlist</span>
              <h3>Stok kritis yang perlu perhatian</h3>
            </div>
            <span className="dashboardPanelMeta">{lowStock.length} item</span>
          </div>
          <div className="dashboardSimpleList">
            {lowStock.slice(0, 5).map((row) => (
              <div key={`${row.name}-${row.warehouse}`} className="dashboardSimpleRow">
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.warehouse}</span>
                </div>
                <div className="dashboardSimpleAside danger">
                  <strong>{row.available}</strong>
                  <span>Min {row.minStock}</span>
                </div>
              </div>
            ))}
            {!lowStock.length && <EmptyState title="Tidak ada stok kritis" description="Daftar ini akan terisi otomatis bila stok mendekati batas minimum." />}
          </div>
        </article>

        <article className="dashboardPanel" data-dashboard-panel="quick-actions">
          <div className="dashboardPanelHeader">
            <div>
              <span className="dashboardPanelEyebrow">Quick Actions</span>
              <h3>Tindakan cepat operator</h3>
            </div>
            <span className="dashboardPanelMeta">Shortcut</span>
          </div>
          <div className="dashboardActionStack">
            <button type="button" className="dashboardActionButton" onClick={() => onNavigate('/master-data')}>
              <span className="dashboardActionIcon"><PackagePlus size={18} /></span>
              <span>
                <strong>Kelola produk</strong>
                <small>Buka katalog, harga, dan multi-UOM.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            <button type="button" className="dashboardActionButton" onClick={() => onNavigate('/commerce')}>
              <span className="dashboardActionIcon sale"><ShoppingCart size={18} /></span>
              <span>
                <strong>Tinjau order</strong>
                <small>Proses penjualan, pembayaran, dan fulfillment.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            <button type="button" className="dashboardActionButton" onClick={() => onNavigate('/people')}>
              <span className="dashboardActionIcon people"><UserPlus size={18} /></span>
              <span>
                <strong>Kelola karyawan</strong>
                <small>Absensi, payroll, dan master employee.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
