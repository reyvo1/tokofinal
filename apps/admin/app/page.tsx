'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import OwnerView from './owner';
import AccountingView from './modules/accounting';
import HrPayrollView from './modules/hr-payroll';
import EmployeeMasterView from './modules/employee-master';
import OperationsView from './modules/operations';
import AssetsFleetView from './modules/assets-fleet';
import ExtensionsView from './modules/extensions';
import R3OperationsView from './modules/r3-operations';
import OperationsControlView from './modules/operations-control';
import DeliveryLifecycle from './modules/delivery-lifecycle';
import MasterDataView from './modules/master-data';
import ProductBulkLabelsView from './modules/product-bulk-labels';
import ManufacturingView from './modules/manufacturing';
import DigitalServicesView from './modules/digital-services';
import SetupReadinessView from './modules/setup-readiness';
import ApiKeysView from './modules/api-keys';
import BranchSyncView from './modules/branch-sync';
import MobileOpsView from './modules/mobile-ops';
import SecurityView from './modules/security';
import DataGovernanceView from './modules/data-governance';
import AutomationWorkspace from './modules/automation-workspace';
import AiWorkspace from './modules/ai-workspace';
import ReportingWorkspace from './modules/reporting-workspace';
import OrganizationAdminView from './modules/organization-admin';
import AccessControlView from './modules/access-control';
import PlatformControlView from './modules/platform-control';
import DashboardOverview from './dashboard-overview';
import AdminAppShell from './app-shell';
import { canReadAdminFeed, settleAdminFeed } from './bootstrap-data';
import { usePermissions } from './permissions';
import { T360ThemeToggle } from './theme-client';
import { authFetch, clearLoginTokens, storeLoginTokens } from './auth-fetch';
import StaffMemoWidget from './staff-memo';
import {
  ADMIN_WORKSPACES, type AdminRuntimeManifest, identityFromAccessToken, resolveAdminNavigation, workspaceFromPath,
} from './navigation';
import { isValidAdminPath, resolvedDomainViewFromPath, resolveDomainViews, domainViewsForWorkspace } from './domain-workspaces';

type ToastItem = { id: number; text: string; tone: 'success' | 'error' };
function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  function push(text: string, tone: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }
  return { toasts, push };
}
function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toastStack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="toastIcon">{t.tone === 'success' ? <CheckCircle2 size={17} /> : <XCircle size={17} />}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type Product = { id: string; sku: string; name: string; unit: string; costPrice: string | number; salePrice: string | number; trackBatch?: boolean; trackExpiry?: boolean; trackSerial?: boolean; variants?: Array<{ id: string; code: string; name: string; isDefault?: boolean }>; units?: Array<{ id: string; variantId?: string | null; unitCode: string; quantityFactor: number; isDefaultPurchase?: boolean }> };
type Supplier = { id: string; code: string; name: string; phone?: string | null; email?: string | null; address?: string | null; paymentTermDays?: number; isActive: boolean };
type Warehouse = { id: string; code: string; name: string; branch: { name: string } };
type POItem = { id: string; productId: string; variantId?: string | null; productUnitId?: string | null; unitCode?: string | null; unitQuantity?: number | null; quantityFactor: number; orderedQty: number; receivedQty: number; unitCost: string | number; purchaseUnitCost?: string | number | null; product: Product };
type PurchaseOrder = { id: string; number: string; status: string; supplier: Supplier; warehouse: Warehouse; total: string | number; items: POItem[] };
type PurchaseRequest = { id: string; number: string; status: string; reason?: string | null; neededBy?: string | null; supplier?: Supplier | null; warehouse: Warehouse; purchaseOrderId?: string | null; items: Array<{ id: string; quantity: number; estimatedUnitCost: string | number; product: Product }> };
type Receipt = { id: string; number: string; receivedAt: string; operationalStatus: string; inspectionId?: string | null; supplier: Supplier; purchaseOrder: { number: string }; items: Array<{ acceptedQty: number; quantityDamaged: number; product: Product }> };
type Inventory = { id: string; quantity: number; reserved: number; available: number; product: Product & { minStock: number }; warehouse: Warehouse };
type InventoryMovement = { id: string; type: string; quantity: number; balanceAfter: number; referenceType?: string | null; referenceId?: string | null; notes?: string | null; createdAt: string; product: Product; warehouse: Warehouse };
type BranchContext = { company: { id:string; name:string }; activeBranchId:string; homeBranchId:string; canSwitch:boolean; branches:Array<{ id:string; code:string; name:string; isActive:boolean }> };
type RuntimeManifest = AdminRuntimeManifest;
type CursorPage<T> = { items: T[]; pageInfo: { limit: number; nextCursor: string | null; hasMore: boolean } };
type Dashboard = { today: { revenue: number; recognizedRevenue: number; transactions: number; cogs: number; grossProfit: number; expenses: number; netProfit: number; source: string }; inventory: { items: number; lowStock: number; value: number; quantity?: number; reserved?: number }; pendingOrders: number } & Record<string, unknown>;
type AnalyticsData = {
  salesTrend: Array<{ date: string; revenue: number; profit: number; transactions: number }>;
  channels: Array<{ channel: string; revenue: number }>;
  cashFlow: Array<{ date: string; cashIn: number }>;
  topProducts: Array<{ name: string; sku: string; quantity: number; revenue: number }>;
  lowStock: Array<{ name: string; warehouse: string; available: number; minStock: number }>;
};

function requestKey(prefix: string) { return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }

export default function AdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [token, setToken] = useState<string | null>(null);
  const currentToken = useRef(token);
  currentToken.current = token;
  const loadSequence = useRef(0);
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const { canAll } = usePermissions(token);
  const [login, setLogin] = useState({ email: '', password: '', twoFactorCode: '' });
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [message, setMessage] = useState('');
  const { toasts, push } = useToasts();
  function notify(text: string, tone: 'success' | 'error' = 'success') { setMessage(text); push(text, tone); }
  const [activeNav, setActiveNav] = useState(() => workspaceFromPath(pathname).label);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [manifest, setManifest] = useState<RuntimeManifest | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [branchContext, setBranchContext] = useState<BranchContext | null>(null);
  const [supplierForm, setSupplierForm] = useState({ code: '', name: '', phone: '' });
  const [supplierEdit, setSupplierEdit] = useState<{ id: string; code: string; name: string; phone: string } | null>(null);
  const [receiptReject, setReceiptReject] = useState<{ id: string; number: string; reason: string } | null>(null);
  const [purchaseRequestForm, setPurchaseRequestForm] = useState({ supplierId: '', warehouseId: '', productId: '', quantity: 1, estimatedUnitCost: 0, reason: '' });
  const [poForm, setPoForm] = useState({ supplierId: '', warehouseId: '', productId: '', variantId: '', productUnitId: '', orderedQty: 1, unitCost: 0 });
  const [receiptForm, setReceiptForm] = useState({ purchaseOrderId: '', purchaseOrderItemId: '', quantityReceived: 1, quantityDamaged: 0, supplierInvoice: '', deliveryNote: '', batchNumber: '', expiryDate: '', serialNumbers: '' });
  const poRequestKey = useRef(requestKey('po'));
  const receiptRequestKey = useRef(requestKey('gr'));
  const [featureChange, setFeatureChange] = useState<{ key: string; enabled: boolean } | null>(null);

  useEffect(() => { const saved = window.localStorage.getItem('toko360_token'); if (saved) setToken(saved); }, []);
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('resetToken'); if (value) { setResetToken(value); setResetMode(true); } }, []);
  useEffect(() => { const refreshed = (event: Event) => setToken((event as CustomEvent<{ accessToken: string }>).detail.accessToken); const expired = () => setToken(null); window.addEventListener('toko360:auth-refreshed', refreshed); window.addEventListener('toko360:auth-expired', expired); return () => { window.removeEventListener('toko360:auth-refreshed', refreshed); window.removeEventListener('toko360:auth-expired', expired); }; }, []);
  useEffect(() => { if (token) void loadAll(token); }, [token]);
  // A5: resolves the notification bell's attention count in the data layer. app-shell.tsx is
  // presentation-only by architectural contract (enforced by tests/p5-v49-admin-root-system),
  // so the count is fetched here and passed down as a prop. A failure is non-fatal: the bell
  // simply stays neutral rather than claiming an alert that may not exist.
  useEffect(() => {
    if (!token) { setAttentionCount(0); return; }
    setAttentionCount(0);
    let cancelled = false;
    void (async () => {
      try {
        const response = await authFetch(`${API}/notifications?status=FAILED&limit=50`, token);
        if (cancelled || !response.ok) return;
        const rows: unknown = await response.json();
        if (!cancelled) setAttentionCount(Array.isArray(rows) ? rows.length : 0);
      } catch { /* informational badge: never surface a failure to the operator */ }
    })();
    return () => { cancelled = true; };
  }, [token, branchContext?.activeBranchId]);
  useEffect(() => { setActiveNav(workspaceFromPath(pathname).label); }, [pathname]);
  useEffect(() => {
    if (!token) return;
    if (pathname === '/') router.replace('/dashboard');
    else {
      const workspace = workspaceFromPath(pathname);
      if (!isValidAdminPath(pathname, workspace)) router.replace(workspace.route);
    }
  }, [token, pathname, router]);

  const identity = useMemo(() => identityFromAccessToken(token), [token]);
  // A5: the notification bell used to render an unconditional red dot, telling the operator
  // something was wrong even when the queue was empty. The count is resolved here, in the
  // data layer, because app-shell.tsx is presentation-only by architectural contract.
  const [attentionCount, setAttentionCount] = useState(0);
  const navigation = useMemo(() => resolveAdminNavigation(manifest, identity), [manifest, identity]);
  const navItems = useMemo(() => navigation.flatMap((group) => group.items), [navigation]);
  const activeWorkspace = useMemo(() => ADMIN_WORKSPACES.find((item) => item.label === activeNav) ?? workspaceFromPath(pathname), [activeNav, pathname]);
  const activeDomainView = useMemo(() => resolvedDomainViewFromPath(pathname, activeWorkspace, manifest, identity), [pathname, activeWorkspace, manifest, identity]);

  function canRootAction(permission: string, roles: string[]) {
    return Boolean(identity?.roles.some((role) => roles.includes(role))) && canAll(permission);
  }
  const purchasingRoles = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING'];
  const receivingRoles = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE'];

  function navigateTo(route: string) {
    const target = workspaceFromPath(route);
    setActiveNav(target.label);
    if (pathname !== route) router.push(route);
  }

  useEffect(() => {
    if (!token || !manifest || !navItems.length) return;
    if (!navItems.some((item) => item.key === activeWorkspace.key)) navigateTo(navItems[0].route);
  }, [token, manifest, navItems, activeNav]);

  useEffect(() => {
    if (!token || !manifest) return;
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return;
    const visibleViews = resolveDomainViews(activeWorkspace, manifest, identity);
    if (!visibleViews.some((view) => view.key === parts[1])) router.replace(activeWorkspace.route);
  }, [token, manifest, identity, pathname, activeWorkspace, router]);

  async function request<T>(path: string, init?: RequestInit, overrideToken?: string): Promise<T> {
    const response = await authFetch(`${API}${path}`, overrideToken ?? token, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Terjadi kesalahan.');
    return data as T;
  }

  async function loadAll(activeToken: string) {
    const sequence = ++loadSequence.current;
    const actor = identityFromAccessToken(activeToken);
    const allowed = (feed: string) => canReadAdminFeed(actor, feed);
    const emptyPage = <T,>(): CursorPage<T> => ({ items: [], pageInfo: { limit: 100, nextCursor: null, hasMore: false } });
    const read = <T,>(path: string, fallback: T, enabled = true) => settleAdminFeed(() => request<T>(path, undefined, activeToken), fallback, enabled);
    const [d, p, s, w, pr, po, r, i, im, m, an, bc] = await Promise.all([
      read<Dashboard | null>('/reports/dashboard', null, allowed('reports')),
      read('/products?limit=100', emptyPage<Product>()),
      read('/suppliers?limit=100&includeInactive=true', emptyPage<Supplier>(), allowed('suppliers')),
      read<Warehouse[]>('/inventory/warehouses', [], allowed('warehouses')),
      read<PurchaseRequest[]>('/purchase-requests', [], allowed('purchasing') && Boolean(actor?.roles.includes('SUPER_ADMIN') || actor?.permissions.includes('purchase.view'))),
      read('/purchase-orders?limit=100', emptyPage<PurchaseOrder>(), allowed('purchasing')),
      read('/goods-receipts?limit=100', emptyPage<Receipt>(), allowed('purchasing')),
      read('/inventory?limit=100', emptyPage<Inventory>(), allowed('inventory')),
      read('/inventory/movements?limit=100', emptyPage<InventoryMovement>(), allowed('movements')),
      read<RuntimeManifest | null>('/platform/manifest', null),
      read<AnalyticsData | null>('/reports/analytics', null, allowed('reports')),
      read<BranchContext | null>('/auth/branch-context', null),
    ]);
    // Ignore late replies from a previous branch, session, or superseded refresh.
    if (currentToken.current !== activeToken || sequence !== loadSequence.current) return;
    setDashboard(d.value); setAnalytics(an.value); setProducts(p.value.items); setSuppliers(s.value.items);
    setWarehouses(w.value); setPurchaseRequests(pr.value); setOrders(po.value.items); setReceipts(r.value.items);
    setInventories(i.value.items); setInventoryMovements(im.value.items); setManifest(m.value); setBranchContext(bc.value);
    setLoadErrors([
      [d, 'Ringkasan'], [p, 'Produk'], [s, 'Supplier'], [w, 'Gudang'], [pr, 'Purchase request'],
      [po, 'Purchase order'], [r, 'Penerimaan'], [i, 'Persediaan'], [im, 'Mutasi stok'],
      [m, 'Konfigurasi aplikasi'], [an, 'Analitik'], [bc, 'Konteks cabang'],
    ].filter(([result]) => (result as { failed: boolean }).failed).map(([, label]) => label as string));
    setLoadedToken(activeToken);
    const defaults = { supplierId: s.value.items.find((supplier) => supplier.isActive)?.id ?? '', warehouseId: w.value[0]?.id ?? '', productId: p.value.items[0]?.id ?? '', cost: Number(p.value.items[0]?.costPrice ?? 0) };
    setPurchaseRequestForm((current) => ({ ...current, supplierId: s.value.items.some((row) => row.id === current.supplierId && row.isActive) ? current.supplierId : defaults.supplierId, warehouseId: w.value.some((row) => row.id === current.warehouseId) ? current.warehouseId : defaults.warehouseId, productId: p.value.items.some((row) => row.id === current.productId) ? current.productId : defaults.productId, estimatedUnitCost: current.estimatedUnitCost || defaults.cost }));
    setPoForm((current) => ({ ...current, supplierId: s.value.items.some((row) => row.id === current.supplierId && row.isActive) ? current.supplierId : defaults.supplierId, warehouseId: w.value.some((row) => row.id === current.warehouseId) ? current.warehouseId : defaults.warehouseId, productId: p.value.items.some((row) => row.id === current.productId) ? current.productId : defaults.productId, unitCost: current.unitCost || defaults.cost }));
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const result = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...login, twoFactorCode: login.twoFactorCode || undefined }) });
      const data = await result.json();
      if (!result.ok) {
        if (data.code === 'TWO_FACTOR_REQUIRED' || data.code === 'TWO_FACTOR_INVALID') setShowTwoFactor(true);
        throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Login gagal.');
      }
      storeLoginTokens(data.accessToken, data.refreshToken); setToken(data.accessToken); setShowTwoFactor(false); setLogin((current) => ({ ...current, password: '', twoFactorCode: '' }));
    } catch (error) { notify(error instanceof Error ? error.message : 'Login gagal.', 'error'); }
  }

  async function requestPasswordReset(event: FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const result = await fetch(`${API}/auth/password-reset/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: resetEmail }) });
      const data = await result.json(); if (!result.ok) throw new Error(data.message ?? 'Permintaan reset gagal.');
      if (data.developmentResetToken) setResetToken(data.developmentResetToken);
      notify(data.message ?? 'Jika akun ditemukan, instruksi reset akan dikirim.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Permintaan reset gagal.', 'error'); }
  }

  async function confirmPasswordReset(event: FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const result = await fetch(`${API}/auth/password-reset/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, newPassword: resetPassword }) });
      const data = await result.json(); if (!result.ok) throw new Error(data.message ?? 'Reset password gagal.');
      setResetPassword(''); setResetToken(''); setResetMode(false); notify(data.message ?? 'Password berhasil diubah.');
      window.history.replaceState({}, '', window.location.pathname);
    } catch (error) { notify(error instanceof Error ? error.message : 'Reset password gagal.', 'error'); }
  }

  async function logout() {
    try { if (token) await request('/auth/logout', { method: 'POST' }, token); } catch { /* local logout must still complete */ }
    currentToken.current = null;
    loadSequence.current += 1;
    clearLoginTokens();
    setToken(null);
    setManifest(null);
    setDashboard(null);
  }

  async function toggleFeature(key: string, enabled: boolean) {
    if (!manifest?.company?.id) { notify('Perusahaan belum tersedia pada runtime manifest.', 'error'); return; }
    try {
      await request('/platform/features', { method: 'POST', body: JSON.stringify({ companyId: manifest.company.id, key, enabled }) });
      notify(`Feature ${key} ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.`);
      setFeatureChange(null);
      await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Gagal mengubah feature flag.', 'error'); }
  }

  async function addSupplier(event: FormEvent) {
    event.preventDefault();
    try { await request('/suppliers', { method: 'POST', body: JSON.stringify({ ...supplierForm, phone: supplierForm.phone || undefined }) }); setSupplierForm({ code: '', name: '', phone: '' }); notify('Supplier berhasil ditambahkan.'); await loadAll(token!); }
    catch (error) { notify(error instanceof Error ? error.message : 'Gagal menambah supplier.', 'error'); }
  }

  async function updateSupplier(supplier: Supplier, patch: Partial<Pick<Supplier, 'name'|'phone'|'isActive'>>) {
    try {
      await request(`/suppliers/${supplier.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      notify(`Supplier ${supplier.code} diperbarui.`);
      await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Gagal memperbarui supplier.', 'error'); }
  }

  async function submitSupplierEdit(event: FormEvent) {
    event.preventDefault();
    if (!supplierEdit) return;
    const supplier = suppliers.find((row) => row.id === supplierEdit.id);
    if (!supplier) { setSupplierEdit(null); return; }
    if (!supplierEdit.name.trim()) { notify('Nama supplier wajib diisi.', 'error'); return; }
    await updateSupplier(supplier, { name: supplierEdit.name.trim(), phone: supplierEdit.phone.trim() || undefined });
    setSupplierEdit(null);
  }


  async function addPurchaseRequest(event: FormEvent) {
    event.preventDefault();
    try {
      await request('/purchase-requests', { method: 'POST', body: JSON.stringify({
        supplierId: purchaseRequestForm.supplierId || undefined,
        warehouseId: purchaseRequestForm.warehouseId,
        reason: purchaseRequestForm.reason || undefined,
        items: [{ productId: purchaseRequestForm.productId, quantity: Number(purchaseRequestForm.quantity), estimatedUnitCost: Number(purchaseRequestForm.estimatedUnitCost) }],
      }) });
      setPurchaseRequestForm((current) => ({ ...current, quantity: 1, reason: '' }));
      notify('Purchase request draft berhasil dibuat. Ajukan approval sebelum dikonversi menjadi PO.');
      await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Gagal membuat purchase request.', 'error'); }
  }

  async function purchaseRequestAction(requestRow: PurchaseRequest, action: 'submit' | 'approve' | 'reject' | 'convert' | 'cancel') {
    try {
      if (action === 'submit') await request(`/purchase-requests/${requestRow.id}/submit`, { method: 'POST', body: '{}' });
      if (action === 'approve') await request(`/purchase-requests/${requestRow.id}/decision`, { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) });
      if (action === 'reject') await request(`/purchase-requests/${requestRow.id}/decision`, { method: 'POST', body: JSON.stringify({ status: 'REJECTED' }) });
      if (action === 'convert') await request(`/purchase-requests/${requestRow.id}/convert`, { method: 'POST', body: JSON.stringify({ supplierId: requestRow.supplier?.id }) });
      if (action === 'cancel') await request(`/purchase-requests/${requestRow.id}/cancel`, { method: 'POST', body: '{}' });
      notify(action === 'convert' ? 'Purchase request dikonversi menjadi PO tanpa duplikasi.' : `Purchase request ${action} berhasil diproses.`);
      await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Workflow purchase request gagal.', 'error'); }
  }

  async function addPO(event: FormEvent) {
    event.preventDefault();
    try {
      await request('/purchase-orders', { method: 'POST', body: JSON.stringify({ idempotencyKey: poRequestKey.current, supplierId: poForm.supplierId, warehouseId: poForm.warehouseId, items: [{ productId: poForm.productId, variantId: poForm.variantId || undefined, productUnitId: poForm.productUnitId || undefined, orderedQty: Number(poForm.orderedQty), unitCost: Number(poForm.unitCost) }] }) });
      poRequestKey.current = requestKey('po');
      notify('Purchase order berhasil dibuat dan berstatus APPROVED.'); await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Gagal membuat PO.', 'error'); }
  }

  async function addReceipt(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await request<Receipt>('/goods-receipts', { method: 'POST', body: JSON.stringify({
        idempotencyKey: receiptRequestKey.current,
        purchaseOrderId: receiptForm.purchaseOrderId, supplierInvoice: receiptForm.supplierInvoice || undefined,
        deliveryNote: receiptForm.deliveryNote || undefined,
        items: [{
          purchaseOrderItemId: receiptForm.purchaseOrderItemId,
          quantityReceived: Number(receiptForm.quantityReceived),
          quantityDamaged: Number(receiptForm.quantityDamaged),
          batchNumber: receiptForm.batchNumber.trim() || undefined,
          expiryDate: receiptForm.expiryDate || undefined,
          serialNumbers: receiptForm.serialNumbers.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
        }],
      }) });
      receiptRequestKey.current = requestKey('gr');
      notify(created.operationalStatus === 'CONFIRMED' || created.operationalStatus === 'PARTIALLY_ACCEPTED'
        ? 'Penerimaan sudah diposting ke stok dan jurnal.'
        : 'Draft penerimaan dibuat. Selesaikan inspeksi lalu konfirmasi posting stok/jurnal.');
      await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Gagal menerima barang.', 'error'); }
  }

  async function confirmReceipt(receipt: Receipt) {
    try {
      const posted = await request<Receipt>(`/goods-receipts/${receipt.id}/confirm`, { method: 'POST', body: JSON.stringify({ inspectionId: receipt.inspectionId ?? undefined }) });
      notify(posted.operationalStatus === 'PARTIALLY_ACCEPTED' ? 'Penerimaan parsial berhasil diposting ke stok dan jurnal.' : 'Penerimaan berhasil diposting ke stok dan jurnal.');
      await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Penerimaan belum dapat dikonfirmasi.', 'error'); }
  }

  async function submitReceiptReject(event: FormEvent) {
    event.preventDefault();
    if (!receiptReject?.reason.trim()) { notify('Alasan penolakan wajib diisi.', 'error'); return; }
    try {
      await request(`/goods-receipts/${receiptReject.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: receiptReject.reason.trim() }) });
      notify(`${receiptReject.number} ditolak tanpa posting stok/jurnal.`);
      setReceiptReject(null);
      await loadAll(token!);
    } catch (error) { notify(error instanceof Error ? error.message : 'Penerimaan gagal ditolak.', 'error'); }
  }


  async function switchBranch(branchId: string) {
    if (!token || branchId === branchContext?.activeBranchId) return;
    try {
      const result = await request<{ accessToken:string; activeBranch:{id:string;code:string;name:string} }>('/auth/branch-context', { method:'POST', body:JSON.stringify({ branchId }) });
      storeLoginTokens(result.accessToken);
      currentToken.current = result.accessToken;
      setManifest(null); setBranchContext(null); setDashboard(null); setAnalytics(null);
      setSupplierEdit(null); setReceiptReject(null); setFeatureChange(null);
      setPurchaseRequestForm({ supplierId: '', warehouseId: '', productId: '', quantity: 1, estimatedUnitCost: 0, reason: '' });
      setPoForm({ supplierId: '', warehouseId: '', productId: '', variantId: '', productUnitId: '', orderedQty: 1, unitCost: 0 });
      setReceiptForm({ purchaseOrderId: '', purchaseOrderItemId: '', quantityReceived: 1, quantityDamaged: 0, supplierInvoice: '', deliveryNote: '', batchNumber: '', expiryDate: '', serialNumbers: '' });
      poRequestKey.current = requestKey('po'); receiptRequestKey.current = requestKey('gr');
      setToken(result.accessToken);
      notify(`Context cabang dipindahkan ke ${result.activeBranch.name}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Gagal mengganti cabang.', 'error'); }
  }


  const selectedPO = useMemo(() => orders.find((order) => order.id === receiptForm.purchaseOrderId), [orders, receiptForm.purchaseOrderId]);
  const selectedPOItem = useMemo(() => selectedPO?.items.find((item) => item.id === receiptForm.purchaseOrderItemId), [selectedPO, receiptForm.purchaseOrderItemId]);
  useEffect(() => {
    if (selectedPO && !selectedPO.items.some((item) => item.id === receiptForm.purchaseOrderItemId)) {
      setReceiptForm((current) => ({ ...current, purchaseOrderItemId: selectedPO.items[0]?.id ?? '', batchNumber: '', expiryDate: '', serialNumbers: '' }));
    }
  }, [selectedPO, receiptForm.purchaseOrderItemId]);

  if (!token) return (
    <main className="loginShell">
      <T360ThemeToggle className="loginThemeToggle" />
      <div className="loginCard">
        <div className="logo loginLogo"><span className="logoMark">T3</span><span><strong>Toko360</strong><small>Enterprise Workflow</small></span></div>
        {!resetMode ? <form onSubmit={submitLogin}>
          <h1>Masuk ke pusat operasional</h1>
          <p>Gunakan akun yang memiliki akses sesuai peran. Sesi akan dicabut di server ketika Anda keluar.</p>
          {message && <div className="notice">{message}</div>}
          <label>Email<input type="email" autoComplete="username" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></label>
          <label>Password<input type="password" autoComplete="current-password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label>
          {showTwoFactor && <label>Kode 2FA / recovery<input autoComplete="one-time-code" value={login.twoFactorCode} onChange={(e) => setLogin({ ...login, twoFactorCode: e.target.value })} placeholder="6 digit atau recovery code" /></label>}
          <button>Masuk</button>
          <button type="button" className="secondary" onClick={() => { setResetMode(true); setResetEmail(login.email); setMessage(''); }}>Lupa password</button>
        </form> : <>
          <h1>Reset password</h1>
          <p>Permintaan tidak mengungkap apakah email terdaftar. Token hanya berlaku singkat dan hanya dapat digunakan sekali.</p>
          {message && <div className="notice">{message}</div>}
          {!resetToken ? <form onSubmit={requestPasswordReset}>
            <label>Email<input type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required /></label>
            <button>Kirim instruksi reset</button>
          </form> : <form onSubmit={confirmPasswordReset}>
            <label>Reset token<input value={resetToken} onChange={(e) => setResetToken(e.target.value)} required /></label>
            <label>Password baru<input type="password" minLength={8} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} required /></label>
            <button>Ubah password</button>
          </form>}
          <button type="button" className="secondary" onClick={() => { setResetMode(false); setResetToken(''); setMessage(''); }}>Kembali ke login</button>
        </>}
      </div>
    </main>
  );

  const pageMeta = activeWorkspace;
  const apiConnected = Boolean(manifest && branchContext);
  if (loadedToken !== token) return <main className="loginShell"><section className="loginCard" role="status"><h1>Memuat ruang kerja</h1><p>Menyiapkan menu dan data untuk cabang aktif.</p></section></main>;
  const canAccessWorkspace = navItems.some((item) => item.key === activeWorkspace.key) && (!domainViewsForWorkspace(activeWorkspace).length || Boolean(activeDomainView));

  return (
    <AdminAppShell
      manifest={manifest}
      identity={identity}
      navigation={navigation}
      activeWorkspace={activeWorkspace}
      activeDomainView={activeDomainView}
      apiConnected={apiConnected}
      branchContext={branchContext}
      attentionCount={attentionCount}
      onBranchChange={(branchId) => void switchBranch(branchId)}
      onNavigate={navigateTo}
      onReload={() => void loadAll(token)}
      onLogout={() => void logout()}
      headerAction={activeWorkspace.key === 'dashboard' ? <button type="button" className="btnGhost" onClick={() => window.print()}>Cetak ringkasan</button> : undefined}
    >
          <StaffMemoWidget token={token} />
          {loadErrors.length > 0 && <section className="notice" role="alert"><strong>Sebagian data belum tersedia</strong><p>Gagal memuat: {loadErrors.join(', ')}. Data ini tidak boleh dianggap sebagai saldo nol.</p><button type="button" className="secondary" onClick={() => void loadAll(token)}>Coba lagi</button></section>}
          {!canAccessWorkspace && <section className="emptyState"><h2>Ruang kerja tidak tersedia</h2><p>Pilih menu yang tersedia untuk hak akses akun Anda.</p></section>}
          {canAccessWorkspace && <>
          {activeWorkspace.key === 'dashboard' && (
            <DashboardOverview
              dashboard={dashboard}
              analytics={analytics}
              inventoryMovements={inventoryMovements}
              onNavigate={navigateTo}
            />
          )}

          {activeWorkspace.key === 'commerce' && <>
            {(!activeDomainView || activeDomainView.key === 'orders') && <ExtensionsView token={token} mode="commerce" commerceSection="orders" />}
            {activeDomainView?.key === 'fulfillment' && <ExtensionsView token={token} mode="commerce" commerceSection="fulfillment" />}
            {activeDomainView?.key === 'returns' && <OperationsView token={token} mode="returns" />}
            {activeDomainView?.key === 'channels' && <><ExtensionsView token={token} mode="commerce" commerceSection="channels" /><R3OperationsView token={token} mode="connections" /></>}
          </>}
          {activeWorkspace.key === 'procurement' && <>
            {(!activeDomainView || activeDomainView.key === 'requests') && <section className="grid2">
              <form className="panel" onSubmit={addPurchaseRequest}>
                <div className="panelTitle"><div><span className="eyebrow">PURCHASE REQUEST</span><h2>Ajukan kebutuhan pembelian</h2></div><span>Approval sebelum PO</span></div>
                <label>Gudang<select required value={purchaseRequestForm.warehouseId} onChange={(e) => setPurchaseRequestForm({ ...purchaseRequestForm, warehouseId: e.target.value })}>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>Supplier opsional<select value={purchaseRequestForm.supplierId} onChange={(e) => setPurchaseRequestForm({ ...purchaseRequestForm, supplierId: e.target.value })}><option value="">Tentukan saat convert PO</option>{suppliers.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>Produk<select required value={purchaseRequestForm.productId} onChange={(e) => { const product = products.find((p) => p.id === e.target.value); setPurchaseRequestForm({ ...purchaseRequestForm, productId: e.target.value, estimatedUnitCost: Number(product?.costPrice ?? 0) }); }}>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <div className="inline"><label>Jumlah<input type="number" min="1" value={purchaseRequestForm.quantity} onChange={(e) => setPurchaseRequestForm({ ...purchaseRequestForm, quantity: Number(e.target.value) })} /></label><label>Estimasi biaya<input type="number" min="0" value={purchaseRequestForm.estimatedUnitCost} onChange={(e) => setPurchaseRequestForm({ ...purchaseRequestForm, estimatedUnitCost: Number(e.target.value) })} /></label></div>
                <label>Alasan kebutuhan<input value={purchaseRequestForm.reason} onChange={(e) => setPurchaseRequestForm({ ...purchaseRequestForm, reason: e.target.value })} /></label>
                <button disabled={!canRootAction('purchase.create', purchasingRoles)}>Buat draft PR</button>
              </form>
              <div className="panel">
                <div className="panelTitle"><div><span className="eyebrow">APPROVAL</span><h2>Purchase request</h2></div><span>{purchaseRequests.length} dokumen</span></div>
                <p className="sectionHelp">Requester tidak boleh menyetujui permintaannya sendiri. Gunakan akun approver berbeda untuk separation of duties.</p>
                {purchaseRequests.length ? <div className="table">{purchaseRequests.slice(0, 12).map((pr) => <div className="receipt" key={pr.id}><div><strong>{pr.number}</strong><small>{pr.warehouse.name} · {pr.supplier?.name ?? 'Supplier belum ditentukan'} · {pr.status}</small><small>{pr.items.map((item) => `${item.product.name} × ${item.quantity}`).join(', ')}</small></div><div className="rowActions">{pr.status === 'DRAFT' && <><button type="button" className="secondary" disabled={!canRootAction('purchase.create', purchasingRoles)} onClick={() => void purchaseRequestAction(pr, 'cancel')}>Batal</button><button type="button" disabled={!canRootAction('purchase.create', purchasingRoles)} onClick={() => void purchaseRequestAction(pr, 'submit')}>Ajukan</button></>}{pr.status === 'PENDING_APPROVAL' && <><button type="button" className="secondary" disabled={!canRootAction('purchase.approve', purchasingRoles)} onClick={() => void purchaseRequestAction(pr, 'reject')}>Tolak</button><button type="button" disabled={!canRootAction('purchase.approve', purchasingRoles)} onClick={() => void purchaseRequestAction(pr, 'approve')}>Setujui</button></>}{pr.status === 'APPROVED' && <><button type="button" className="secondary" disabled={!canRootAction('purchase.create', purchasingRoles)} onClick={() => void purchaseRequestAction(pr, 'cancel')}>Batal</button><button type="button" disabled={!canRootAction('purchase.create', purchasingRoles)} onClick={() => void purchaseRequestAction(pr, 'convert')}>Buat PO</button></>}{pr.status === 'CONVERTED' && <span className="okText">PO dibuat</span>}</div></div>)}</div> : <div className="emptyState"><h4>Belum ada purchase request</h4><p>Buat kebutuhan pembelian terlebih dahulu; PO hanya dibuat setelah approval.</p></div>}
              </div>
            </section>}
            {(activeDomainView?.key === 'supplier' || activeDomainView?.key === 'orders') && <section className="grid2">
              {activeDomainView?.key === 'supplier' && <div className="panel"><form onSubmit={addSupplier}><div className="panelTitle"><div><span className="eyebrow">MASTER DATA</span><h2>Supplier lifecycle</h2></div><span>{suppliers.filter((row) => row.isActive).length} aktif</span></div><label>Kode<input required value={supplierForm.code} onChange={(e) => setSupplierForm({ ...supplierForm, code: e.target.value })} /></label><label>Nama<input required value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} /></label><label>Telepon<input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} /></label><button disabled={!canRootAction('supplier.create', purchasingRoles)}>Simpan supplier</button></form><div className="table sectionBlock">{suppliers.slice(0,20).map((supplier) => <div className="receipt" key={supplier.id}><div><strong>{supplier.code} · {supplier.name}</strong><small>{supplier.phone || '-'} · {supplier.isActive ? 'ACTIVE' : 'INACTIVE'}</small></div><div className="rowActions"><button type="button" className="secondary" disabled={!canRootAction('supplier.update', purchasingRoles)} onClick={() => setSupplierEdit({ id: supplier.id, code: supplier.code, name: supplier.name, phone: supplier.phone ?? '' })}>Edit</button><button type="button" className="secondary" disabled={!canRootAction('supplier.update', purchasingRoles)} onClick={() => void updateSupplier(supplier, { isActive: !supplier.isActive })}>{supplier.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></div>)}</div>{supplierEdit && <form className="inlineEditor" onSubmit={submitSupplierEdit}><strong>Edit {supplierEdit.code}</strong><label>Nama<input required value={supplierEdit.name} onChange={(e) => setSupplierEdit({ ...supplierEdit, name: e.target.value })} /></label><label>Telepon<input value={supplierEdit.phone} onChange={(e) => setSupplierEdit({ ...supplierEdit, phone: e.target.value })} /></label><div className="rowActions"><button type="button" className="secondary" disabled={!canRootAction('supplier.update', purchasingRoles)} onClick={() => setSupplierEdit(null)}>Batal</button><button disabled={!canRootAction('supplier.update', purchasingRoles)}>Simpan perubahan</button></div></form>}</div>}
              {activeDomainView?.key === 'orders' && <form className="panel" onSubmit={addPO}><div className="panelTitle"><div><span className="eyebrow">PEMBELIAN</span><h2>Buat purchase order</h2></div></div><label>Supplier<select required value={poForm.supplierId} onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}>{suppliers.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Gudang<select required value={poForm.warehouseId} onChange={(e) => setPoForm({ ...poForm, warehouseId: e.target.value })}>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Produk<select required value={poForm.productId} onChange={(e) => { const product = products.find((p) => p.id === e.target.value); const defaultUnit = product?.units?.find((u) => u.isDefaultPurchase) ?? product?.units?.[0]; setPoForm({ ...poForm, productId: e.target.value, variantId: defaultUnit?.variantId ?? '', productUnitId: defaultUnit?.id ?? '', unitCost: Number(product?.costPrice ?? 0) * Number(defaultUnit?.quantityFactor ?? 1) }); }}>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · base {item.unit}</option>)}</select></label><div className="inline"><label>Variant<select value={poForm.variantId} onChange={(e) => setPoForm({ ...poForm, variantId: e.target.value, productUnitId: '' })}><option value="">Produk dasar</option>{(products.find((p) => p.id === poForm.productId)?.variants ?? []).map((variant) => <option key={variant.id} value={variant.id}>{variant.code} · {variant.name}</option>)}</select></label><label>Unit pembelian<select value={poForm.productUnitId} onChange={(e) => { const product = products.find((p) => p.id === poForm.productId); const unit = product?.units?.find((u) => u.id === e.target.value); setPoForm({ ...poForm, productUnitId: e.target.value, variantId: unit?.variantId ?? poForm.variantId, unitCost: Number(product?.costPrice ?? 0) * Number(unit?.quantityFactor ?? 1) }); }}><option value="">{products.find((p) => p.id === poForm.productId)?.unit ?? 'BASE'} · base unit</option>{(products.find((p) => p.id === poForm.productId)?.units ?? []).filter((u) => !poForm.variantId || u.variantId === poForm.variantId).map((unit) => <option key={unit.id} value={unit.id}>{unit.unitCode} · isi {unit.quantityFactor}</option>)}</select></label></div><div className="inline"><label>Jumlah unit beli<input type="number" min="1" value={poForm.orderedQty} onChange={(e) => setPoForm({ ...poForm, orderedQty: Number(e.target.value) })} /></label><label>Harga per unit beli<input type="number" min="0" value={poForm.unitCost} onChange={(e) => setPoForm({ ...poForm, unitCost: Number(e.target.value) })} /></label></div><button disabled={!canRootAction('purchase.create', purchasingRoles)}>Buat PO</button></form>}
            </section>}

            {activeDomainView?.key === 'receipts' && <section className="panel highlight">
              <div className="panelTitle"><div><span className="eyebrow">GUDANG</span><h2>Terima barang dari supplier</h2></div><span>Posting mengikuti inspeksi server</span></div>
              <form className="receiptForm" onSubmit={addReceipt}>
                <label>Purchase order<select required value={receiptForm.purchaseOrderId} onChange={(e) => setReceiptForm({ ...receiptForm, purchaseOrderId: e.target.value, purchaseOrderItemId: orders.find((po) => po.id === e.target.value)?.items[0]?.id ?? '' })}><option value="">Pilih PO</option>{orders.filter((po) => !['RECEIVED','CANCELLED'].includes(po.status)).map((po) => <option key={po.id} value={po.id}>{po.number} · {po.supplier.name} · {po.status}</option>)}</select></label>
                <label>Barang<select required value={receiptForm.purchaseOrderItemId} onChange={(e) => setReceiptForm({ ...receiptForm, purchaseOrderItemId: e.target.value, batchNumber: '', expiryDate: '', serialNumbers: '' })}><option value="">Pilih barang</option>{selectedPO?.items.map((item) => <option key={item.id} value={item.id}>{item.product.name} · sisa {Math.floor((item.orderedQty - item.receivedQty) / Math.max(1, item.quantityFactor || 1))} {item.unitCode ?? item.product.unit}</option>)}</select></label>
                <div className="inline"><label>Jumlah datang<input type="number" min="1" value={receiptForm.quantityReceived} onChange={(e) => setReceiptForm({ ...receiptForm, quantityReceived: Number(e.target.value) })} /></label><label>Rusak<input type="number" min="0" max={receiptForm.quantityReceived} value={receiptForm.quantityDamaged} onChange={(e) => setReceiptForm({ ...receiptForm, quantityDamaged: Number(e.target.value) })} /></label></div>
                {selectedPOItem?.product.trackBatch && <div className="inline"><label>Nomor batch<input required value={receiptForm.batchNumber} onChange={(e) => setReceiptForm({ ...receiptForm, batchNumber: e.target.value })} /></label><label>Kedaluwarsa{selectedPOItem.product.trackExpiry ? ' (wajib)' : ''}<input type="date" required={Boolean(selectedPOItem.product.trackExpiry)} value={receiptForm.expiryDate} onChange={(e) => setReceiptForm({ ...receiptForm, expiryDate: e.target.value })} /></label></div>}
                {selectedPOItem?.product.trackSerial && <label>Serial accepted unit<textarea required value={receiptForm.serialNumbers} onChange={(e) => setReceiptForm({ ...receiptForm, serialNumbers: e.target.value })} placeholder="Satu serial per baris atau pisahkan dengan koma" /><small>Jumlah serial harus sama dengan jumlah diterima dikurangi rusak, lalu dikalikan faktor UOM karena serial mengikuti base unit.</small></label>}
                <div className="inline"><label>Faktur supplier<input value={receiptForm.supplierInvoice} onChange={(e) => setReceiptForm({ ...receiptForm, supplierInvoice: e.target.value })} /></label><label>Surat jalan<input value={receiptForm.deliveryNote} onChange={(e) => setReceiptForm({ ...receiptForm, deliveryNote: e.target.value })} /></label></div>
                <button disabled={!canRootAction('purchase.receive', receivingRoles)}>Proses barang masuk</button>
              </form>
            </section>}

            {activeDomainView?.key === 'receipts' && <section className="grid2">
              <div className="panel"><div className="panelTitle"><div><span className="eyebrow">STOK</span><h2>Persediaan gudang</h2></div></div>{inventories.length ? <div className="table"><div className="tr th"><span>Produk</span><span>Gudang</span><span>Tersedia</span></div>{inventories.map((item) => <div className="tr" key={item.id}><span><strong>{item.product.name}</strong><small>{item.product.sku}</small></span><span>{item.warehouse.name}</span><span className={item.available <= item.product.minStock ? 'danger' : 'okText'}>{item.available}</span></div>)}</div> : <div className="emptyState"><h4>Belum ada saldo persediaan</h4><p>Saldo gudang akan tampil setelah penerimaan atau transaksi stok tercatat.</p></div>}</div>
              <div className="panel"><div className="panelTitle"><div><span className="eyebrow">PENERIMAAN</span><h2>Barang masuk terakhir</h2></div></div>{receipts.length ? <div className="table">{receipts.slice(0,8).map((receipt) => <div className="receipt" key={receipt.id}><div><strong>{receipt.number}</strong><small>{receipt.purchaseOrder.number} · {receipt.supplier.name} · {receipt.operationalStatus}</small></div><div className="rowActions"><span>{receipt.items.reduce((sum,item) => sum + item.acceptedQty,0)} diterima</span>{!['CONFIRMED','PARTIALLY_ACCEPTED','REJECTED','CANCELLED'].includes(receipt.operationalStatus) && <><button type="button" className="secondary" disabled={!canRootAction('goods_receipt.reject', receivingRoles)} onClick={() => setReceiptReject({ id: receipt.id, number: receipt.number, reason: '' })}>Tolak</button><button type="button" disabled={!canRootAction('goods_receipt.confirm', receivingRoles)} onClick={() => void confirmReceipt(receipt)}>Konfirmasi posting</button></>}</div></div>)}</div> : <div className="emptyState"><h4>Belum ada penerimaan</h4><p>Penerimaan supplier yang dibuat akan tampil di sini.</p></div>}{receiptReject && <form className="inlineEditor" onSubmit={submitReceiptReject}><strong>Tolak {receiptReject.number}</strong><label>Alasan<textarea required value={receiptReject.reason} onChange={(e) => setReceiptReject({ ...receiptReject, reason: e.target.value })} /></label><div className="rowActions"><button type="button" className="secondary" onClick={() => setReceiptReject(null)}>Batal</button><button disabled={!canRootAction('goods_receipt.reject', receivingRoles)}>Tolak penerimaan</button></div></form>}</div>
            </section>}
            {activeDomainView?.key === 'receipts' && <section className="panel">
              <div className="panelTitle"><div><span className="eyebrow">INVENTORY LEDGER</span><h2>Canonical inventory movements</h2></div><span>{inventoryMovements.length} movement</span></div>
              <div className="table"><div className="tr th"><span>Waktu / Referensi</span><span>Produk / Gudang</span><span>Movement / Saldo</span></div>{inventoryMovements.slice(0,30).map((movement) => <div className="tr" key={movement.id}><span><strong>{new Date(movement.createdAt).toLocaleString('id-ID')}</strong><small>{movement.referenceType ?? '-'}:{movement.referenceId ?? '-'}</small></span><span><strong>{movement.product.name}</strong><small>{movement.warehouse.name}</small></span><span><strong>{movement.type} · {movement.quantity > 0 ? '+' : ''}{movement.quantity}</strong><small>balance {movement.balanceAfter}</small></span></div>)}</div>
            </section>}
          </>}

          {activeWorkspace.key === 'inventory-control' && <><OperationsView token={token} mode={(activeDomainView?.key ?? 'overview') as 'overview'|'traceability'|'transfers'|'stocktake'|'returns'} />{(!activeDomainView || activeDomainView.key === 'overview') && <section className="panel"><div className="panelTitle"><div><span className="eyebrow">INVENTORY LEDGER</span><h2>Canonical inventory movements</h2></div><span>{inventoryMovements.length} movement</span></div><div className="table"><div className="tr th"><span>Waktu / Referensi</span><span>Produk / Gudang</span><span>Movement / Saldo</span></div>{inventoryMovements.slice(0,50).map((movement) => <div className="tr" key={movement.id}><span><strong>{new Date(movement.createdAt).toLocaleString('id-ID')}</strong><small>{movement.referenceType ?? '-'}:{movement.referenceId ?? '-'}</small></span><span><strong>{movement.product.name}</strong><small>{movement.warehouse.name}</small></span><span><strong>{movement.type} · {movement.quantity > 0 ? '+' : ''}{movement.quantity}</strong><small>balance {movement.balanceAfter}</small></span></div>)}</div></section>} </>}
          {activeWorkspace.key === 'operations-control' && (activeDomainView?.key === 'delivery' ? <DeliveryLifecycle token={token} /> : <OperationsControlView token={token} mode={(activeDomainView?.key ?? 'inspections') as 'inspections'|'evidence'|'gate-pass'} />)}
          {activeWorkspace.key === 'master-data' && (activeDomainView?.key === 'bulk-labels' ? <ProductBulkLabelsView token={token} /> : <MasterDataView token={token} mode={activeDomainView?.key ?? 'products'} />)}
          {activeWorkspace.key === 'manufacturing' && <ManufacturingView token={token} />}
          {activeWorkspace.key === 'organization' && (activeDomainView?.key === 'organization' || !activeDomainView ? <OrganizationAdminView token={token} /> : <MasterDataView token={token} mode={activeDomainView.key} />)}
          {activeWorkspace.key === 'finance' && <AccountingView token={token} mode={activeDomainView?.key ?? 'ledger'} />}
          {activeWorkspace.key === 'reports' && <>
            {activeDomainView?.key === 'owner' && <OwnerView token={token} />}
            {(!activeDomainView || activeDomainView.key === 'financial') && <ReportingWorkspace token={token} mode="financial" />}
            {activeDomainView?.key === 'operations' && <><ReportingWorkspace token={token} mode="operations" /><R3OperationsView token={token} mode="reporting" /></>}
            {activeDomainView?.key === 'scheduled' && <ReportingWorkspace token={token} mode="scheduled" />}
          </>}
          {activeWorkspace.key === 'people' && (activeDomainView?.key === 'employees' || !activeDomainView ? <EmployeeMasterView token={token} /> : <HrPayrollView token={token} mode={activeDomainView?.key ?? 'payroll'} />)}
          {activeWorkspace.key === 'assets-fleet' && <AssetsFleetView token={token} mode={(activeDomainView?.key ?? 'assets') as 'assets'|'maintenance'|'vehicles'|'trips'} />}
          {activeWorkspace.key === 'intelligence' && <>
            {(!activeDomainView || activeDomainView.key === 'ai') && <AiWorkspace token={token} mode="ai" />}
            {activeDomainView?.key === 'forecast' && <AiWorkspace token={token} mode="forecast" />}
            {activeDomainView?.key === 'automation' && <AutomationWorkspace token={token} mode="automation" />}
            {activeDomainView?.key === 'schedules' && <AutomationWorkspace token={token} mode="schedules" />}
          </>}
          {activeWorkspace.key === 'integrations' && <>
            {(!activeDomainView || activeDomainView.key === 'providers') && <ExtensionsView token={token} mode="providers" />}
            {activeDomainView?.key === 'notifications' && <ExtensionsView token={token} mode="notifications" />}
            {activeDomainView?.key === 'connections' && <><ExtensionsView token={token} mode="connections" /><R3OperationsView token={token} mode="connections" /></>}
            {activeDomainView?.key === 'devices' && <><ExtensionsView token={token} mode="devices" /><R3OperationsView token={token} mode="devices" /></>}
            {activeDomainView?.key === 'loyalty' && <ExtensionsView token={token} mode="loyalty" />}
            {activeDomainView?.key === 'ppob' && <DigitalServicesView token={token} />}
          </>}
          {activeWorkspace.key === 'settings' && <>

            {(!activeDomainView || activeDomainView.key === 'features') && <section className="panel">
              <div className="panelTitle"><div><span className="eyebrow">RUNTIME MODULES</span><h2>Feature flags</h2></div><span>{Object.values(manifest?.features ?? {}).filter((feature) => feature.enabled).length} aktif</span></div>
              <p className="sectionHelp">Flag runtime bukan bukti product-completeness. Maturity dan ownership di bawah menjelaskan capability sebenarnya; FOUNDATION/ADAPTER_REQUIRED tidak boleh dibaca sebagai modul produksi selesai.</p>
              <div className="table">{manifest?.modules.map((module) => { const feature = module.featureKey ? manifest.features[module.featureKey] : undefined; const enabled = module.isCore || !module.featureKey || feature?.enabled; const maturity = feature?.config?.maturityClass ?? (module.isCore ? 'OPERATIONAL' : 'UNKNOWN'); const help = feature?.config?.helpText ?? module.description ?? 'Capability core runtime.'; const configurable = feature?.config?.configurable !== false; return <div className="receipt" key={module.code}><div><strong>{module.name}</strong><small>{module.category} · {module.code}</small><small>Maturity: {maturity} · Ownership: {feature?.config?.ownership ?? (module.isCore ? 'TOKO360_RUNTIME' : 'UNDECLARED')}</small><small>{help}</small></div>{module.featureKey ? <div className="actionRow"><span className={enabled?'okText':''}>{enabled?'ENABLED':'DISABLED'}</span><button type="button" className="secondary" disabled={!configurable || !canRootAction('platform.configure', ['SUPER_ADMIN', 'OWNER', 'ADMIN'])} onClick={() => setFeatureChange({ key: module.featureKey!, enabled: !enabled })}>{enabled ? 'Nonaktifkan' : 'Aktifkan'}</button></div> : <span className="okText">CORE</span>}</div>; })}</div>
            </section>}
            {activeDomainView?.key === 'setup' && <SetupReadinessView token={token} />}
            {activeDomainView?.key === 'users' && <AccessControlView token={token} canManageRoles={Boolean(identity?.roles.includes('SUPER_ADMIN'))} actorId={identity?.sub} />}
            {(['platform','custom-fields','approvals','webhooks','ui-config','audit-ops'] as const).includes(activeDomainView?.key as never) && activeDomainView && <PlatformControlView token={token} mode={activeDomainView.key as 'platform'|'custom-fields'|'approvals'|'webhooks'|'ui-config'|'audit-ops'} />}
            {activeDomainView?.key === 'security' && <SecurityView token={token} />}
            {activeDomainView?.key === 'api-keys' && <ApiKeysView token={token} />}
            {activeDomainView?.key === 'branch-sync' && <BranchSyncView token={token} />}
            {activeDomainView?.key === 'mobile-ops' && <MobileOpsView token={token} />}
            {activeDomainView?.key === 'data-governance' && <DataGovernanceView token={token} />}
          </>}

        </>}
        {featureChange && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="feature-change-title">
          <div className="modalCard">
            <span className="eyebrow">FEATURE FLAG</span>
            <h2 id="feature-change-title">{featureChange.enabled ? 'Aktifkan' : 'Nonaktifkan'} {featureChange.key}?</h2>
            <p className="sectionHelp">Perubahan ini memengaruhi kemampuan runtime untuk perusahaan aktif. Pastikan dampaknya sudah dipahami sebelum melanjutkan.</p>
            <div className="modalActions"><button type="button" className="secondary" onClick={() => setFeatureChange(null)}>Batal</button><button type="button" className={!featureChange.enabled ? 'dangerButton' : ''} onClick={() => void toggleFeature(featureChange.key, featureChange.enabled)}>{featureChange.enabled ? 'Aktifkan feature' : 'Nonaktifkan feature'}</button></div>
          </div>
        </div>}
        {token && <ToastStack toasts={toasts} />}
    </AdminAppShell>
  );
}
