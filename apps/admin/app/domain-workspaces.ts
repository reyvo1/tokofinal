import type { ComponentType } from 'react';
import {
  Activity, Archive, BadgeDollarSign, Banknote, BellRing, Boxes, BrainCircuit, Building2, ClipboardCheck, ClipboardList,
  CreditCard, FileBarChart, FileCheck2, Gauge, KeyRound, Landmark, MessageCircleMore, PackageCheck, PackageSearch,
  ReceiptText, RefreshCcw, Route, ScanLine, Settings2, ShieldCheck, ShoppingBag, Sparkles, Truck, UserCog,
  Users, Warehouse, Wrench, Network, Smartphone } from 'lucide-react';
import type { AdminIdentity, AdminRuntimeManifest, AdminWorkspace } from './navigation';

type DomainIcon = ComponentType<{ size?: number | string }>;
export type AdminDomainView = {
  key: string; label: string; title: string; description: string; Icon: DomainIcon;
  moduleCodes?: string[]; permissionPrefixes?: string[]; roles?: string[];
};
export type AdminDomainWorkspace = { workspaceKey: string; views: AdminDomainView[] };

export const ADMIN_DOMAIN_WORKSPACES: AdminDomainWorkspace[] = [
  { workspaceKey: 'master-data', views: [
    { key: 'catalog', label: 'Kategori & Subkategori', title: 'Struktur kategori produk', description: 'Kategori utama, subkategori, hierarchy, urutan, lifecycle, dan jumlah produk.', Icon:ShoppingBag },
    { key: 'customers', label: 'Customer', title: 'Customer master', description: 'Data pelanggan, kontak, dan segmentasi tanpa mencampur workflow kategori.', Icon:Users },
    { key: 'products', label: 'Produk & Multi-UOM', title: 'Produk, variant, barcode & multi-UOM', description: 'Produk, variant, base unit, kemasan, barcode alternatif, batch/expiry/serial.', Icon:Boxes },
    { key: 'pricing', label: 'Pricing', title: 'Harga retail, grosir & unit', description: 'Harga per cabang, segmen, kemasan, dan minimum quantity.', Icon:BadgeDollarSign },
    { key: 'references', label: 'Reference Master', title: 'Brand, unit, bank, courier & payment', description: 'Reference master yang dipakai lintas modul.', Icon:Settings2 },
    { key: 'bulk-labels', moduleCodes: ['catalog'], permissionPrefixes: ['product'], label: 'Import & Label', title: 'Bulk master & label barcode', description: 'Dry-run import CSV Excel-compatible, export master, dan label Code128 A4/thermal.', Icon:ScanLine },
  ]},
  { workspaceKey: 'organization', views:[
    { key: 'organization', label: 'Cabang & Gudang', title: 'Cabang dan gudang tenant', description: 'Konteks tenant aktif, branch, warehouse, default warehouse, dan lifecycle gudang.', Icon:Building2 },
    { key: 'locations', label: 'Lokasi Gudang', title: 'Zone, rack & bin', description: 'Struktur lokasi gudang, barcode lokasi, dan kapasitas.', Icon:Warehouse },
    { key: 'references', label: 'Reference Organisasi', title: 'Reference operasional', description: 'Reference master organisasi yang dipakai lintas cabang.', Icon:Settings2 },
  ]},
  { workspaceKey: 'procurement', views:[
    { key: 'requests', moduleCodes: ['suppliers'], permissionPrefixes: ['purchase'], label: 'Purchase Request', title: 'Purchase requests', description: 'Ajukan kebutuhan, approval, separation of duties, dan conversion ke PO.', Icon:ClipboardList },
    { key: 'orders', moduleCodes: ['suppliers'], permissionPrefixes: ['purchase'], label: 'Purchase Order', title: 'Purchase orders', description: 'Supplier, gudang, produk, UOM, quantity, dan authoritative unit cost.', Icon:PackageSearch },
    { key: 'receipts', moduleCodes: ['goods-receipts'], permissionPrefixes: ['goods_receipt','inventory'], label: 'Penerimaan', title: 'Goods receipt', description: 'Inbound receiving, inspection, batch/serial, confirmation, stock, dan journal posting.', Icon:PackageCheck },
    { key: 'supplier', moduleCodes: ['suppliers'], permissionPrefixes: ['supplier','purchase'], label: 'Supplier', title: 'Supplier master & settlement context', description: 'Supplier operasional yang menjadi sumber purchase dan payable.', Icon:Users },
  ]},
  { workspaceKey: 'commerce', views:[
    { key: 'orders', label: 'Order', title: 'Sales & storefront orders', description: 'Order website, status transaksi, dan pembayaran.', Icon:ShoppingBag },
    { key: 'fulfillment', label: 'Fulfillment', title: 'Packing, shipment & delivery', description: 'Packing, outbound inspection, shipment, delivery, dan status lifecycle.', Icon:Truck },
    { key: 'returns', label: 'Retur Customer', title: 'Customer returns', description: 'Return request, inspection, refund, inventory reversal, dan audit.', Icon:RefreshCcw },
    { key: 'channels', label: 'Channel', title: 'Sales channels', description: 'Storefront, marketplace, integration mapping, dan payment provider flow.', Icon:Activity },
  ]},
  { workspaceKey: 'manufacturing', views:[
    { key: 'recipes', moduleCodes: ['manufacturing'], permissionPrefixes: ['manufacturing'], label: 'Resep / BOM', title: 'Versioned production recipes', description: 'Produk hasil, bahan baku, waste allowance, dan versioned BOM.', Icon:ClipboardList },
    { key: 'orders', moduleCodes: ['manufacturing'], permissionPrefixes: ['manufacturing'], label: 'Production Order', title: 'Production lifecycle', description: 'Draft, release, start, consume components, output stock, WIP/HPP, dan completion.', Icon:Wrench },
  ]},
  { workspaceKey: 'inventory-control', views:[
    { key: 'overview', label: 'Saldo Stok', title: 'Inventory overview', description: 'Saldo gudang, available stock, minimum stock, dan exception utama.', Icon:Boxes },
    { key: 'traceability', label: 'Batch & Serial', title: 'Batch, expiry & serial traceability', description: 'Jejak batch/expiry dan serial number lintas movement.', Icon:ScanLine },
    { key: 'transfers', label: 'Transfer', title: 'Stock transfers', description: 'Transfer antar gudang, relokasi, dan in-transit visibility.', Icon:Route },
    { key: 'stocktake', label: 'Stock Opname', title: 'Physical inventory', description: 'Sesi hitung fisik, variance, approval, dan posting.', Icon:ClipboardCheck },
    { key: 'returns', label: 'Retur Supplier/Sales', title: 'Inventory returns', description: 'Retur supplier/penjualan dengan inspection dan reversal authoritative.', Icon:RefreshCcw },
  ]},
  { workspaceKey: 'operations-control', views:[
    { key: 'inspections', label: 'Inspeksi', title: 'Quality inspections', description: 'Inbound/outbound inspection dan structured result.', Icon:ClipboardCheck },
    { key: 'evidence', label: 'Evidence', title: 'Operational evidence', description: 'Foto, barcode, confirmation, dan audit evidence.', Icon:FileCheck2 },
    { key: 'gate-pass', label: 'Gate Pass', title: 'Gate control', description: 'Gate pass masuk/keluar dan validation lifecycle.', Icon:ShieldCheck },
    { key: 'delivery', label: 'Delivery', title: 'Delivery lifecycle', description: 'Trip, manifest, loading, dispatch, POD/COD, return, dan close trip.', Icon:Truck },
  ]},
  { workspaceKey: 'finance', views:[
    { key: 'ledger', moduleCodes: ['accounting','accounting-core'], permissionPrefixes: ['accounting','finance'], label: 'Ledger', title: 'Jurnal & accounting ledger', description: 'Accounting event, jurnal authoritative, chart of accounts, dan drill-down.', Icon:Landmark },
    { key: 'tax', moduleCodes: ['system-tax','accounting'], permissionPrefixes: ['tax','accounting','finance'], label: 'Pajak', title: 'Tax workspace', description: 'Tax code versioning, tax ledger, reconciliation, dan evidence.', Icon:FileCheck2 },
    { key: 'fiscal', moduleCodes: ['accounting','accounting-core'], permissionPrefixes: ['accounting','finance'], label: 'Periode Fiskal', title: 'Fiscal period & close', description: 'Open, soft close, reopen, final close, dan kontrol periode.', Icon:ClipboardCheck },
    { key: 'payables', moduleCodes: ['finance-operations','accounting'], permissionPrefixes: ['finance','accounting'], label: 'Hutang / AP', title: 'Accounts payable', description: 'Supplier payable, return offset, payment, dan settlement.', Icon:ReceiptText },
    { key: 'receivables', moduleCodes: ['finance-operations','accounting'], permissionPrefixes: ['finance','accounting'], label: 'Piutang / AR', title: 'Accounts receivable', description: 'COD/invoice receivable, refund receivable, dan collection.', Icon:BadgeDollarSign },
    { key: 'banking', moduleCodes: ['bank-reconciliation','finance-operations'], permissionPrefixes: ['finance','accounting'], label: 'Kas & Bank', title: 'Cash, bank & reconciliation', description: 'Kas/bank, statement import, matching, dan reconciliation.', Icon:Banknote },
  ]},
  { workspaceKey: 'reports', views:[
    { key: 'financial', label: 'Keuangan', title: 'Financial reports', description: 'P&L, balance sheet, cash flow, trial balance, general ledger, dan tax summary.', Icon:FileBarChart },
    { key: 'operations', label: 'Operasional', title: 'Operational reports', description: 'Sales, purchase, inventory, delivery, payroll, dan audit export.', Icon:Activity },
    { key: 'scheduled', label: 'Terjadwal', title: 'Scheduled reports', description: 'Jadwal report worker, recipient, health, history, dan retry.', Icon:BellRing },
    { key: 'owner', label: 'Owner Reporting', title: 'Owner reporting', description: 'Ringkasan owner dan distribusi report melalui channel yang dikonfigurasi.', Icon:MessageCircleMore },
  ]},
  { workspaceKey: 'people', views:[
    { key: 'employees', moduleCodes: ['hris'], permissionPrefixes: ['hr','employee'], label: 'Karyawan', title: 'Employee master', description: 'Identity, organization, status, dan self-service linkage.', Icon:Users },
    { key: 'attendance', moduleCodes: ['attendance'], permissionPrefixes: ['attendance','hr'], label: 'Absensi', title: 'Attendance operations', description: 'Attendance evidence, location policy, approval, dan history.', Icon:ClipboardCheck },
    { key: 'payroll', moduleCodes: ['payroll'], permissionPrefixes: ['payroll','hr'], label: 'Payroll', title: 'Payroll runs', description: 'Preparation, calculation, approval, posting, settlement, dan payslip.', Icon:CreditCard },
    { key: 'compliance', moduleCodes: ['tax-payroll','payroll'], permissionPrefixes: ['payroll','hr'], label: 'Compliance', title: 'Payroll compliance', description: 'Tax profile, BPJS, adjustment/recovery, dan audit lineage.', Icon:ShieldCheck },
  ]},
  { workspaceKey: 'assets-fleet', views:[
    { key: 'assets', label: 'Aset', title: 'Fixed assets', description: 'Asset category, acquisition, book value, depreciation, dan disposal.', Icon:Building2 },
    { key: 'maintenance', label: 'Maintenance', title: 'Maintenance operations', description: 'Work order, schedule, parts, cost, dan completion.', Icon:Wrench },
    { key: 'vehicles', label: 'Kendaraan', title: 'Fleet vehicles', description: 'Vehicle master, availability, maintenance state, dan assignment.', Icon:Truck },
    { key: 'trips', label: 'Trip & BBM', title: 'Fleet trips & fuel', description: 'Driver, trip, fuel, odometer, cost, dan delivery linkage.', Icon:Route },
  ]},
  { workspaceKey: 'intelligence', views:[
    { key: 'ai', moduleCodes: ['forecasting'], permissionPrefixes: ['assistant','forecast'], label: 'AI Assistant', title: 'Operator assistant', description: 'Assistant read-only berbasis sumber tenant yang diizinkan.', Icon:BrainCircuit },
    { key: 'forecast', moduleCodes: ['forecasting'], permissionPrefixes: ['forecast'], label: 'Forecast', title: 'Forecast & insights', description: 'Forecast explainable, confidence, source evidence, dan reorder insight.', Icon:Sparkles },
    { key: 'automation', moduleCodes: ['operations-automation'], permissionPrefixes: ['automation'], label: 'Automation', title: 'Business rules & automation', description: 'Rule lifecycle, execution history, retry/replay, dan asynchronous action.', Icon:Activity },
    { key: 'schedules', moduleCodes: ['operations-automation'], permissionPrefixes: ['report','automation'], label: 'Jadwal Report', title: 'Report schedules', description: 'Jadwal report periodik yang menggunakan worker/report canonical.', Icon:BellRing },
  ]},
  { workspaceKey: 'integrations', views:[
    { key: 'providers', label: 'Telegram & WhatsApp', title: 'Notification providers', description: 'Konfigurasi Telegram/WhatsApp, encrypted secret, health, aktif/nonaktif.', Icon:MessageCircleMore },
    { key: 'notifications', label: 'Notification Center', title: 'Notification queue & history', description: 'Template, queue, delivery status, cancel, replay, dan error.', Icon:BellRing },
    { key: 'connections', label: 'Integrasi Eksternal', title: 'Integration connections', description: 'Provider connection, capability, external mapping, dan status adapter.', Icon:RefreshCcw },
    { key: 'devices', label: 'Devices & Sync', title: 'Devices, edge & offline sync', description: 'Device registration, credential, health, sync receipts, dan dead-letter.', Icon:Gauge },
    { key: 'loyalty', label: 'Loyalty', title: 'Customer loyalty', description: 'Program loyalty, points, expiry, tier, dan engagement.', Icon:BadgeDollarSign },
    { key: 'ppob', moduleCodes: ['digital-services'], permissionPrefixes: ['digital_service'], label: 'PPOB', title: 'Produk digital & PPOB', description: 'Digiflazz connection, cached catalog, prepaid transaction, idempotency, dan recheck.', Icon:CreditCard },
  ]},
  { workspaceKey: 'settings', views:[
    { key: 'features', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['platform'], label: 'Fitur Runtime', title: 'Runtime features', description: 'Module catalog dan feature flags untuk company aktif.', Icon:Settings2 },
    { key: 'users', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['user','role'], label: 'User & Role', title: 'Users, roles & permissions', description: 'User lifecycle, role assignment, permission matrix, status akun, dan branch access.', Icon:UserCog },
    { key: 'setup', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['platform'], label: 'Setup Readiness', title: 'Business setup readiness', description: 'Checklist company, branch, warehouse, users, products, finance, payment reference, dan integration readiness.', Icon:ClipboardCheck },
    { key: 'platform', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['platform'], label: 'System Settings', title: 'System settings', description: 'Konfigurasi runtime company/branch yang diaudit dan tenant-safe.', Icon:Settings2 },
    { key: 'custom-fields', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['custom_field'], label: 'Custom Fields', title: 'Custom field definitions', description: 'Definisi field tambahan untuk entity bisnis tanpa perubahan schema ad-hoc.', Icon:FileCheck2 },
    { key: 'approvals', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['approval'], label: 'Approval Control', title: 'Approval policies & queue', description: 'Policy approval, queue keputusan, delegation context, dan separation of duties.', Icon:ClipboardCheck },
    { key: 'webhooks', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['webhook'], label: 'Webhooks', title: 'Webhook endpoints', description: 'Endpoint outbound, event subscriptions, health, retry, dan replay.', Icon:RefreshCcw },
    { key: 'ui-config', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['ui_schema'], label: 'UI Runtime', title: 'Runtime UI schema', description: 'UI schema versioned untuk navigation dan surface runtime yang dikendalikan server.', Icon:Settings2 },
    { key: 'audit-ops', roles: ['SUPER_ADMIN','OWNER','ADMIN','AUDITOR'], permissionPrefixes: ['audit'], label: 'Audit & Ops', title: 'Audit log, outbox & ops health', description: 'Audit trail, event outbox, operational health, dan recovery queue.', Icon:Activity },
    { key: 'security', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['user','platform'], label: 'Security', title: 'Account security', description: '2FA, recovery, session security, throttle, dan protected account controls.', Icon:ShieldCheck },
    { key: 'api-keys', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['api_key','integration'], label: 'API Key', title: 'Integration API keys', description: 'Scoped API key, one-time secret, rotation, dan revoke.', Icon:KeyRound },
    // POST-1A: observability is only real if an operator can see lag, dead letters and peer health.
    { key: 'branch-sync', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['integration'], label: 'Branch Sync', title: 'Edge topology & sync health', description: 'Node central/branch, peer registry, lag, dead letter, dan requeue idempoten.', Icon:Network },
    // POST-1C: Telegram identity binding. Sits in settings because binding is tenant administration;
    // the gate below must keep granting user.manage for these reads to succeed.
    { key: 'mobile-ops', roles: ['SUPER_ADMIN','OWNER','ADMIN'], permissionPrefixes: ['user'], label: 'Mobile Ops', title: 'Telegram identity & mobile stock count', description: 'Binding identitas Telegram ke employee aktif, dan draft hitung stok perangkat.', Icon:Smartphone },
    { key: 'data-governance', roles: ['SUPER_ADMIN','OWNER','ADMIN','AUDITOR'], permissionPrefixes: ['report','audit'], label: 'Data Governance', title: 'Retention, archive & daily summaries', description: 'Retention policy, archive execution/history, checksum/artifact, dan explicit Admin-owned daily summary materialization.', Icon:Archive },
  ]},
];

export function domainViewsForWorkspace(workspace: AdminWorkspace): AdminDomainView[] { return ADMIN_DOMAIN_WORKSPACES.find((entry) => entry.workspaceKey === workspace.key)?.views ?? []; }
export function domainViewFromPath(pathname: string, workspace: AdminWorkspace): AdminDomainView | null { const key = pathname.split('/').filter(Boolean)[1]; return key ? domainViewsForWorkspace(workspace).find((view) => view.key === key) ?? null : null; }
export function domainRoute(workspace: AdminWorkspace, view: AdminDomainView): string { return `${workspace.route}/${view.key}`; }
export function isValidAdminPath(pathname: string, workspace: AdminWorkspace): boolean { const parts = pathname.split('/').filter(Boolean); if (!parts.length) return pathname === '/'; if (`/${parts[0]}` !== workspace.route) return false; if (parts.length === 1) return true; return parts.length === 2 && domainViewsForWorkspace(workspace).some((view) => view.key === parts[1]); }

type DomainViewOverride = { workspace?: unknown; key?: unknown; hidden?: unknown; order?: unknown; label?: unknown; title?: unknown; description?: unknown };
function enabledModuleCodes(manifest: AdminRuntimeManifest | null): Set<string> | null { if (!manifest?.modules?.length) return null; return new Set(manifest.modules.filter((module) => module.isCore || !module.featureKey || manifest.features?.[module.featureKey]?.enabled === true).map((module) => module.code)); }
function identityCanSeeView(identity: AdminIdentity | null, view: AdminDomainView): boolean { if (!identity) return false; if (identity.roles.includes('SUPER_ADMIN')) return true; if (view.roles?.length && !view.permissionPrefixes?.length) return view.roles.some((role) => identity.roles.includes(role)); if (view.roles?.some((role) => identity.roles.includes(role))) return true; if (!view.permissionPrefixes?.length) return true; if (!identity.permissions.length) return false; return identity.permissions.some((permission) => view.permissionPrefixes!.some((prefix) => permission === prefix || permission.startsWith(`${prefix}.`) || permission.startsWith(`${prefix}_`))); }
function readDomainOverrides(manifest: AdminRuntimeManifest | null, workspace: AdminWorkspace): Map<string,DomainViewOverride> {
  const overrides = new Map<string,DomainViewOverride>();
  const candidates = (manifest?.uiSchemas ?? []).filter((item) => item.surface.toLowerCase() === 'admin').sort((a,b) => b.version - a.version);
  for (const candidate of candidates) {
    if (!candidate.schema || typeof candidate.schema !== 'object' || Array.isArray(candidate.schema)) continue;
    const domainViews = (candidate.schema as Record<string,unknown>).domainViews;
    if (!Array.isArray(domainViews)) continue;
    for (const raw of domainViews) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const override = raw as DomainViewOverride;
      if (override.workspace !== workspace.key || typeof override.key !== 'string' || overrides.has(override.key)) continue;
      overrides.set(override.key, override);
    }
  }
  return overrides;
}
export function resolveDomainViews(workspace:AdminWorkspace, manifest:AdminRuntimeManifest|null, identity:AdminIdentity|null):AdminDomainView[] {
  const canonical=domainViewsForWorkspace(workspace), activeModules=enabledModuleCodes(manifest), overrides=readDomainOverrides(manifest,workspace);
  return canonical.filter((view)=>{const o=overrides.get(view.key); if(o?.hidden===true||!identityCanSeeView(identity,view))return false; if(!activeModules||!view.moduleCodes?.length)return true; return view.moduleCodes.some((code)=>activeModules.has(code));})
    .map((view)=>{const o=overrides.get(view.key); return {...view,label:typeof o?.label==='string'&&o.label.trim()?o.label.trim():view.label,title:typeof o?.title==='string'&&o.title.trim()?o.title.trim():view.title,description:typeof o?.description==='string'&&o.description.trim()?o.description.trim():view.description};})
    .sort((a,b)=>{const ao=overrides.get(a.key)?.order,bo=overrides.get(b.key)?.order; return (typeof ao==='number'?ao:canonical.findIndex((v)=>v.key===a.key))-(typeof bo==='number'?bo:canonical.findIndex((v)=>v.key===b.key));});
}
export function resolvedDomainViewFromPath(pathname:string, workspace:AdminWorkspace, manifest:AdminRuntimeManifest|null, identity:AdminIdentity|null):AdminDomainView|null { const key=pathname.split('/').filter(Boolean)[1]; const views = resolveDomainViews(workspace,manifest,identity); return key ? views.find((view)=>view.key===key) ?? null : views[0] ?? null; }
