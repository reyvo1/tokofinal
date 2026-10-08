import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  Boxes,
  BrainCircuit,
  Building2,
  CircleGauge,
  Landmark,
  PackageSearch,
  PlugZap,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';

export type AdminIdentity = { sub?: string; roles: string[]; permissions: string[] };
export type RuntimeModule = { code: string; name: string; category: string; featureKey?: string | null; isCore: boolean; description?: string | null; capabilities?: unknown };
export type RuntimeFeatureConfig = { maturity?: string; maturityClass?: 'OPERATIONAL'|'LIMITED'|'FOUNDATION'|'ADAPTER_REQUIRED'; operatorVisibility?: string; ownership?: string; helpText?: string; configurable?: boolean; [key: string]: unknown };
export type RuntimeUiSchema = { code: string; surface: string; version: number; schema: unknown };
export type AdminRuntimeManifest = {
  version?: string;
  company?: { id: string; name: string };
  branch?: { id: string; code?: string; name: string };
  features: Record<string, { enabled: boolean; configuredEnabled?: boolean; config?: RuntimeFeatureConfig }>;
  modules: RuntimeModule[];
  navigation?: unknown[];
  uiSchemas?: RuntimeUiSchema[];
};

type NavIcon = ComponentType<{ size?: number | string }>;
export type AdminWorkspace = {
  key: string;
  route: string;
  label: string;
  group: 'Ringkasan' | 'Operasional' | 'Keuangan & SDM' | 'Intelligence' | 'Platform';
  Icon: NavIcon;
  eyebrow: string;
  title: string;
  description: string;
  moduleCodes: string[];
  permissionPrefixes?: string[];
  roles?: string[];
};

export const ADMIN_WORKSPACES: AdminWorkspace[] = [
  // The dashboard workspace is fed entirely by /reports/dashboard and /reports/analytics, and
  // ReportsController is class-level @Roles(SUPER_ADMIN, OWNER, ADMIN, FINANCE, MANAGER, AUDITOR,
  // HR, PAYROLL). The menu entry used to be ungated, so a CASHIER was shown "Dashboard", walked
  // into it, and got 403 on all eight feeds it loads — a blank page. The role list below mirrors
  // the controller exactly. The list is duplicated rather than imported because navigation.ts is
  // a plain data module and the test below fails if the two ever drift apart.
  { key: 'dashboard', route: '/dashboard', label: 'Dashboard', group: 'Ringkasan', Icon: CircleGauge, eyebrow: 'OVERVIEW', title: 'Pusat kendali operasional', description: 'Status bisnis hari ini, exception penting, dan pintasan tindakan operator.', moduleCodes: ['catalog','orders','inventory'], roles: ['SUPER_ADMIN','OWNER','ADMIN','FINANCE','MANAGER','AUDITOR','HR','PAYROLL'] },
  { key: 'commerce', route: '/commerce', label: 'Penjualan & Order', group: 'Operasional', Icon: ShoppingCart, eyebrow: 'COMMERCE', title: 'Penjualan, order, pembayaran & fulfillment', description: 'Order website, pembayaran, packing, shipment, delivery, dan retur pelanggan.', moduleCodes: ['storefront','orders','shipping','marketplace'], permissionPrefixes: ['order','sale','shipment','payment'] },
  { key: 'procurement', route: '/procurement', label: 'Pembelian', group: 'Operasional', Icon: PackageSearch, eyebrow: 'PROCUREMENT', title: 'Pembelian & penerimaan', description: 'Purchase request, approval, purchase order, supplier, dan penerimaan barang.', moduleCodes: ['suppliers','goods-receipts','reorder'], permissionPrefixes: ['purchase','goods_receipt','supplier'] },
  { key: 'manufacturing', route: '/manufacturing', label: 'Produksi', group: 'Operasional', Icon: Boxes, eyebrow: 'MANUFACTURING', title: 'Resep, BOM & production order', description: 'Versioned recipe/BOM, rencana produksi, konsumsi bahan baku, output, WIP, HPP, dan audit.', moduleCodes: ['manufacturing'], permissionPrefixes: ['manufacturing'] },
  { key: 'inventory-control', route: '/inventory-control', label: 'Persediaan', group: 'Operasional', Icon: Warehouse, eyebrow: 'INVENTORY', title: 'Persediaan & kontrol gudang', description: 'Saldo stok, batch/serial, transfer, stock opname, kondisi, dan traceability.', moduleCodes: ['inventory','stock-transfer','stock-opname','batch-expiry','serial-number'], permissionPrefixes: ['inventory','product','supplier'] },
  { key: 'operations-control', route: '/operations-control', label: 'Kontrol Operasional', group: 'Operasional', Icon: ShieldCheck, eyebrow: 'CONTROL', title: 'Inspeksi, gate & delivery control', description: 'Evidence, quality inspection, gate pass, trip, POD/COD, dan kontrol lifecycle.', moduleCodes: ['quality-inspection','gate-pass','fleet','shipping'], permissionPrefixes: ['operations','inspection','gate','fleet','shipment'] },
  // Without a permission gate this workspace was visible to every role, while the controls
  // inside it are permission-aware (master_data.manage / product.update / customer.manage).
  // A user with none of those saw an empty menu entry that led to a dead page — the "UI is not
  // synchronised between roles" symptom. The prefixes below mirror the controller's
  // @Permissions values so the menu and its contents are decided by the same rules.
  { key: 'master-data', route: '/master-data', label: 'Produk & Master Data', group: 'Operasional', Icon: Boxes, eyebrow: 'MASTER DATA', title: 'Produk, customer, pricing & reference', description: 'Produk, variant, multi-UOM, barcode, pricing, kategori, customer, dan reference master.', moduleCodes: ['catalog','suppliers','inventory'], permissionPrefixes: ['master_data','product','customer'] },
  { key: 'finance', route: '/finance', label: 'Keuangan', group: 'Keuangan & SDM', Icon: Landmark, eyebrow: 'FINANCE', title: 'Accounting, pajak, AP/AR, kas & bank', description: 'Jurnal, chart of accounts, pajak, fiscal period, settlement, reconciliation, dan kontrol integritas.', moduleCodes: ['accounting','accounting-core','finance-operations','bank-reconciliation','system-tax'], permissionPrefixes: ['finance','accounting','tax'] },
  { key: 'reports', route: '/reports', label: 'Laporan & Analitik', group: 'Keuangan & SDM', Icon: BarChart3, eyebrow: 'REPORTING', title: 'Laporan & analitik', description: 'Financial report, inventory report, operational export, scheduled report, dan owner reporting.', moduleCodes: ['accounting','finance-operations','inventory','orders'], permissionPrefixes: ['report','finance','accounting'] },
  { key: 'people', route: '/people', label: 'HRIS & Payroll', group: 'Keuangan & SDM', Icon: Users, eyebrow: 'PEOPLE', title: 'Karyawan, absensi & payroll', description: 'Employee master, attendance, leave/overtime, payroll, settlement, compliance, dan payslip.', moduleCodes: ['hris','attendance','payroll','tax-payroll'], permissionPrefixes: ['employee','attendance','payroll','leave','overtime'] },
  { key: 'assets-fleet', route: '/assets-fleet', label: 'Aset & Armada', group: 'Keuangan & SDM', Icon: Truck, eyebrow: 'ASSET & FLEET', title: 'Aset, maintenance & armada', description: 'Fixed asset, depreciation, maintenance, kendaraan, trip, BBM, dan biaya operasional.', moduleCodes: ['fixed-assets','fleet'], permissionPrefixes: ['asset','fleet'] },
  { key: 'intelligence', route: '/intelligence', label: 'Forecast & Otomasi', group: 'Intelligence', Icon: BrainCircuit, eyebrow: 'INTELLIGENCE', title: 'Forecast, insight & automation', description: 'Forecast deterministik, insight operator berbasis rule, assistant tanpa LLM/provider AI, business rules, scheduled report, dan execution history.', moduleCodes: ['forecasting','operations-automation'], permissionPrefixes: ['assistant','forecast','automation','report'] },
  { key: 'integrations', route: '/integrations', label: 'Integrasi & Notifikasi', group: 'Platform', Icon: PlugZap, eyebrow: 'INTEGRATIONS', title: 'Telegram, WhatsApp, provider & devices', description: 'Provider notification, template, delivery history, external connection, device, dan offline sync.', moduleCodes: ['notifications','integrations','offline-pos','biometric-attendance','loyalty','digital-services'], permissionPrefixes: ['notification','integration','attendance','loyalty','promotion','digital_service'] },
  { key: 'organization', route: '/organization', label: 'Tenant & Organisasi', group: 'Platform', Icon: Building2, eyebrow: 'ORGANIZATION', title: 'Company, cabang, gudang & lokasi', description: 'Konteks tenant aktif, cabang, warehouse, lokasi gudang, dan reference organisasi.', moduleCodes: ['catalog','inventory'], roles: ['SUPER_ADMIN','OWNER','ADMIN'] },
  { key: 'settings', route: '/settings', label: 'Pengaturan & Akses', group: 'Platform', Icon: Settings, eyebrow: 'SETTINGS', title: 'Pengaturan sistem, user & security', description: 'Feature runtime, users, roles, security, API key, dan konfigurasi platform.', moduleCodes: ['approval','integrations','operations-automation'], roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['user','role','api_key','platform','integration'] },
];

const GROUP_ORDER: AdminWorkspace['group'][] = ['Ringkasan','Operasional','Keuangan & SDM','Intelligence','Platform'];
export type ResolvedAdminNavigation = Array<{ group: AdminWorkspace['group']; items: AdminWorkspace[] }>;
type NavigationOverride = { route?: unknown; label?: unknown; hidden?: unknown; order?: unknown };

function hasPermission(identity: AdminIdentity | null, workspace: AdminWorkspace): boolean {
  if (!identity) return false;
  if (workspace.roles?.length && !workspace.permissionPrefixes?.length) return workspace.roles.some((role) => identity.roles.includes(role));
  if (identity.roles.some((role) => ['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(role))) return true;
  if (workspace.roles?.some((role) => identity.roles.includes(role))) return true;
  if (!workspace.permissionPrefixes?.length) return true;
  if (!identity.permissions.length) return false;
  return identity.permissions.some((permission) => workspace.permissionPrefixes!.some((prefix) => permission === prefix || permission.startsWith(`${prefix}.`) || permission.startsWith(`${prefix}_`)));
}

function readOverrides(manifest: AdminRuntimeManifest | null): Map<string, NavigationOverride> {
  const result = new Map<string, NavigationOverride>();
  const candidates = (manifest?.uiSchemas ?? []).filter((item) => item.surface.toLowerCase() === 'admin').sort((a,b) => b.version - a.version);
  for (const candidate of candidates) {
    if (!candidate.schema || typeof candidate.schema !== 'object' || Array.isArray(candidate.schema)) continue;
    const navigation = (candidate.schema as Record<string, unknown>).navigation;
    if (!Array.isArray(navigation)) continue;
    for (const raw of navigation) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const override = raw as NavigationOverride;
      if (typeof override.route !== 'string' || !override.route.startsWith('/')) continue;
      if (!result.has(override.route)) result.set(override.route, override);
    }
  }
  return result;
}

export function resolveAdminNavigation(manifest: AdminRuntimeManifest | null, identity: AdminIdentity | null): ResolvedAdminNavigation {
  const overrides = readOverrides(manifest);
  const visible = ADMIN_WORKSPACES.filter((workspace) => {
    const override = overrides.get(workspace.route);
    return override?.hidden !== true && hasPermission(identity, workspace);
  }).map((workspace) => {
    const override = overrides.get(workspace.route);
    return typeof override?.label === 'string' && override.label.trim() ? { ...workspace, label: override.label.trim() } : workspace;
  });
  return GROUP_ORDER.map((group) => ({ group, items: visible.filter((item) => item.group === group).sort((a,b) => {
    const ao = overrides.get(a.route)?.order; const bo = overrides.get(b.route)?.order;
    return (typeof ao === 'number' ? ao : ADMIN_WORKSPACES.findIndex((w) => w.route === a.route)) - (typeof bo === 'number' ? bo : ADMIN_WORKSPACES.findIndex((w) => w.route === b.route));
  }) })).filter((group) => group.items.length > 0);
}

export function workspaceFromPath(pathname: string): AdminWorkspace {
  const first = `/${pathname.split('/').filter(Boolean)[0] ?? 'dashboard'}`;
  return ADMIN_WORKSPACES.find((workspace) => workspace.route === first) ?? ADMIN_WORKSPACES[0];
}

export function identityFromAccessToken(token: string | null | undefined): AdminIdentity | null {
  if (!token) return null;
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(normalized)) as Record<string, unknown>;
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
      roles: Array.isArray(payload.roles) ? payload.roles.filter((value): value is string => typeof value === 'string') : [],
      permissions: Array.isArray(payload.permissions) ? payload.permissions.filter((value): value is string => typeof value === 'string') : [],
    };
  } catch {
    return null;
  }
}
