'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { clearPosTokens, posAuthFetch, storePosTokens } from './auth-fetch';
import { Search, ScanBarcode, ShoppingCart, Trash2, Minus, Plus, CreditCard, UserRound, Coins, PackageSearch, Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Store, X, Package, WalletCards } from 'lucide-react';
import { PosShell, PosWorkspace } from './pos-shell';
import { ModalPortal, useEscapeToClose, useModalFocus } from './modal-portal';
import { T360ThemeToggle } from './theme-client';
import { calculateOfflineQuote, getOrCreateDeviceCode, loadOfflineQueue, loadOfflineSnapshot, nextOfflineSequence, OfflineQueueItem, OfflineTaxCode, OfflineTenderMethod, reservedOfflineQuantity, persistOfflineSnapshot, saveOfflineQueue } from '../lib/offline';
import { asCatalogFetcher, loadCatalog, loadCatalogPage, searchCatalog } from '../lib/catalog';
import { isOfflineStoreAvailable } from '../lib/offline-store';
import { createBarcodeListener, fuzzyRank } from '../lib/barcode';
import { planPickup, pickupVoucherLines, type CrossBranchStock, type PickupQuote } from '../lib/click-collect';
import { useSupervisorApproval } from '../lib/supervisor';
import { openRawBtReceipt } from '../lib/printing';
import StaffMemoWidget from './staff-memo';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type ProductVariant = { id: string; code: string; name: string; sku?: string | null; salePrice?: string | number | null; costPrice?: string | number | null; isDefault: boolean; isActive: boolean };
type Product = { id: string; sku: string; barcode?: string | null; variants?: ProductVariant[]; units?: Array<{ id: string; variantId?: string | null; unitCode: string; quantityFactor: number; isDefaultSale: boolean; variant?: { id: string; code: string; name: string } | null }>; barcodes?: Array<{ code: string; variantId?: string | null; productUnitId?: string | null; unitCode?: string | null; quantityFactor?: string | number }>; name: string; unit: string; salePrice: string | number; effectiveSalePrice?: string | number; salesTaxCodeId?: string | null; categoryName?: string; inventories: Array<{ warehouseId: string; available: number }> };
type Warehouse = { id: string; name: string; code: string };
type CursorPage<T> = { items: T[]; pageInfo: { limit: number; nextCursor: string | null; hasMore: boolean } };
type RuntimeManifest = { company?: { id: string; name: string }; branch?: { id: string; code?: string; name: string }; features: Record<string, { enabled: boolean }> };
type CartItem = { product: Product; quantity: number; unitCode: string; quantityFactor: number; productUnitId?: string; variantId?: string; barcodeCode?: string };
type CustomerOption = { id: string; name: string; phone?: string | null };
type CashierShift = { id: string; openingCash: string | number; openedAt: string; status: 'OPEN' | 'CLOSED'; expectedCash?: string | number; closingCash?: string | number | null; difference?: string | number | null };
type CashMovement = { id: string; cashierShiftId: string; type: 'CASH_IN' | 'CASH_OUT' | string; amount: string | number; reason: string; createdAt: string };
type ShiftRecap = { shift: { id: string; openedAt: string; closedAt?: string | null; status: string; cashier: string }; openingCash: number; closingCash: number | null; expectedCash: number | null; difference: number | null; sales: { count: number; total: number; tax: number; cogs: number }; payments: Record<string, number>; paymentBreakdown?: Array<{ method: string; methodName: string; settlementAccountCode: string; settlementBehavior: string; grossAmount: number; feeAmount: number; netSettlementAmount: number; feeAccountCode: string | null }>; refunds: { count: number; cashTotal: number }; cashMovements: { cashIn: number; cashOut: number } };
type SaleQuote = { subtotal: string | number; discount: string | number; promoDiscount?: string | number; appliedPromo?: { id: string; code: string; name: string; type: string } | null; loyaltyDiscount: string | number; totalDiscount: string | number; net: string | number; tax: string | number; total: string | number; redeemPoints: number; items?: Array<{ productId: string; barcodeCode?: string | null; variantId?: string | null; unitCode: string; unitQuantity: number; quantityFactor: number; baseQuantity: number; sellingUnitPrice: string | number; baseUnitPrice: string | number; lineSubtotal: string | number }> };
type SplitPayment = { method: string; amount: number; provider?: string; externalRef?: string };
type RecentSale = { id: string; number: string; warehouseId: string; subtotal: string | number; discount: string | number; tax: string | number; total: string | number; createdAt: string; items: Array<{ id: string; productId: string; quantity: number; unitPrice: string | number; netSubtotal: string | number; product: { name: string; sku?: string } }> };
type SaleReturnRow = { id: string; number: string; saleId: string; status: string; refundMethod?: string | null; refundAmount: string | number; inspectionId?: string | null; createdAt: string };
type HeldSale = { id: string; cashierSub: string; label: string; createdAt: string; warehouseId: string; customerId: string; discount: number; serviceFee?: number; redeemPoints: number; promoCode: string; paymentMethod: string; paymentProvider?: string; paymentReference?: string; splitEnabled?: boolean; splitPayments?: SplitPayment[]; onAccountAmount?: number; items: Array<{ productId: string; quantity: number; productUnitId?: string; variantId?: string; barcodeCode?: string }> };
type OfflineConfig = { serverTime: string; branchId: string; shift: CashierShift | null; taxCodes: OfflineTaxCode[]; tenderMethods: OfflineTenderMethod[]; policy: { paymentMethods: string[]; loyaltyRedeemAllowed: boolean; maxOfflineAgeMinutes: number; note: string } };
type OfflineReplayResult = { localId: string; sequence: number; status: 'APPLIED' | 'CONFLICT' | 'FAILED' | 'PENDING'; reason?: string; number?: string; saleId?: string };
type OfflineReplayResponse = { deviceId: string | null; applied: number; conflicts: number; failed: number; remaining: number; results: OfflineReplayResult[] };

class PosApiError extends Error {
  constructor(message: string, readonly status?: number, readonly network = false) { super(message); }
}

function money(value: string | number) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value)); }
function productPrice(product: Product) { return Number(product.effectiveSalePrice ?? product.salePrice); }
/**
 * Varian aktif untuk produk ini. Server sudah mengirim array `variants` lengkap (products.service.ts
 * mengambilnya dengan `orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]`), jadi layar kasir tidak
 * perlu menebak jenis dari satuan — dan tidak perlu request tambahan.
 */
function activeVariants(product: Product): ProductVariant[] { return (product.variants ?? []).filter((variant) => variant.isActive); }
/** Varian yang sedang tampil di kartu produk. Tanpa pemilih jenis, ini selalu varian default. */
function shownVariant(product: Product, variantId?: string | null): ProductVariant | undefined {
  const list = activeVariants(product);
  if (!list.length) return undefined;
  return variantId ? list.find((variant) => variant.id === variantId) : list.find((variant) => variant.isDefault) ?? list[0];
}
/**
 * Harga yang ditampilkan untuk satu (produk, varian). Varian yang punya `salePrice` sendiri
 * menang di atas harga produk — persis seperti resolver harga kanonik di server, jadi angka di layar
 * tidak boleh berbeda dari yang akan ditagih.
 */
function variantPrice(product: Product, variant?: ProductVariant): number {
  if (!variant) return productPrice(product);
  const variantOwn = variant.salePrice === null || variant.salePrice === undefined ? undefined : Number(variant.salePrice);
  return variantOwn ?? productPrice(product);
}
/** Satuan milik varian yang sedang tampil. Satuan varian lain tidak ditampilkan karena tidak terjangkau kasir. */
function variantUnits(product: Product, variant?: ProductVariant) {
  const units = product.units ?? [];
  if (!variant) return units.filter((unit) => !unit.variantId);
  return units.filter((unit) => !unit.variantId || unit.variantId === variant.id);
}
function newIdempotencyKey() { return globalThis.crypto?.randomUUID?.() ?? `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function jwtSubject(value: string | null): string {
  if (!value) return '';
  try {
    const part = value.split('.')[1];
    if (!part) return '';
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64)) as { sub?: unknown };
    return typeof payload.sub === 'string' ? payload.sub : '';
  } catch { return ''; }
}

const HELD_SALES_KEY = 'toko360_pos_held_sales_v1';
function loadHeldSales(): HeldSale[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HELD_SALES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && Array.isArray(item.items)) : [];
  } catch { return []; }
}
function saveHeldSales(items: HeldSale[]) { localStorage.setItem(HELD_SALES_KEY, JSON.stringify(items.slice(0, 50))); }

export default function PosPage() {
  const [token, setToken] = useState<string | null>(null);
  const [login, setLogin] = useState({ email: '', password: '', twoFactorCode: '' });
  const [products, setProducts] = useState<Product[]>([]);
  const [manifest, setManifest] = useState<RuntimeManifest | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  // Catalog paging state. Without it the grid silently showed only the first 100 products.
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [serverMatches, setServerMatches] = useState<Product[] | null>(null);
  const [serverSearchBusy, setServerSearchBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentProvider, setPaymentProvider] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [tenderMethods, setTenderMethods] = useState<OfflineTenderMethod[]>([]);
  const [onAccountAmount, setOnAccountAmount] = useState(0);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([{ method: 'CASH', amount: 0 }, { method: 'QRIS', amount: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [serviceFee, setServiceFee] = useState(0);
  // Click & Collect: pay here, collect at a branch that actually has the stock.
  const [collectFor, setCollectFor] = useState<{ productId: string; name: string; quantity: number } | null>(null);
  const [branchStock, setBranchStock] = useState<CrossBranchStock[]>([]);
  const [pickupBranch, setPickupBranch] = useState('');
  const [pickupCustomer, setPickupCustomer] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');
  const [pickupQuote, setPickupQuote] = useState<PickupQuote | null>(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const pickupOperationRef = useRef<{ fingerprint: string; key: string } | null>(null);

  async function openCollectFor(productId: string, name: string, quantity: number) {
    if (!token) return;
    setCollectFor({ productId, name, quantity });
    setPickupQuote(null); setPickupError(''); setPickupBranch(''); setBranchStock([]); setPickupCustomer(''); setPickupPhone(''); pickupOperationRef.current = null;
    try {
      const data = await api<{ branches: CrossBranchStock[] }>(`/inventory/cross-branch-stock/${encodeURIComponent(productId)}`, undefined, token);
      setBranchStock(data.branches ?? []);
    } catch (error) {
      setPickupError(error instanceof Error ? error.message : 'Gagal memuat stok antar cabang.');
    }
  }

  /**
   * Reserve at the pickup branch and print a collection voucher.
   *
   * Routed through POST /orders with fulfillmentType PICKUP, NOT /sales: a POS sale would move
   * inventory at the paying branch, which does not hold the goods. The reservation is what makes
   * collection possible; the sale is not.
   */
  async function submitPickup() {
    if (!token || !collectFor || !pickupBranch) return;
    if (!pickupCustomer.trim()) { setPickupError('Nama pelanggan wajib diisi untuk voucher ambil.'); return; }
    setPickupBusy(true); setPickupError('');
    try {
      const payload = {
        branchCode: pickupBranch, customerName: pickupCustomer.trim(), customerPhone: pickupPhone.trim() || undefined,
        fulfillmentType: 'PICKUP' as const, items: [{ productId: collectFor.productId, quantity: collectFor.quantity }],
      };
      const fingerprint = JSON.stringify(payload);
      const pending = pickupOperationRef.current;
      const idempotencyKey = pending?.fingerprint === fingerprint ? pending.key : `pos-pickup:${crypto.randomUUID()}`;
      pickupOperationRef.current = { fingerprint, key: idempotencyKey };
      const quote = await api<PickupQuote>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      }, token);
      pickupOperationRef.current = null;
      setPickupQuote(quote);
    } catch (error) {
      setPickupError(error instanceof Error ? error.message : 'Gagal membuat voucher ambil di cabang lain.');
    } finally { setPickupBusy(false); }
  }
  const [promoCode, setPromoCode] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('Semua');
  // Varian yang dipilih kasir per produk. Key = productId. Kasir memilih JENIS dari layar, bukan
  // hanya lewat scan barcode per varian — itulah batas POS yang ditutup di wave ini.
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerWarning, setCustomerWarning] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [shift, setShift] = useState<CashierShift | null>(null);
  const [openingCash, setOpeningCash] = useState(0);
  const [closingCash, setClosingCash] = useState(0);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [cashMovementAmount, setCashMovementAmount] = useState(0);
  const [cashMovementReason, setCashMovementReason] = useState('');
  const [cashMovementBusy, setCashMovementBusy] = useState(false);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [shiftRecap, setShiftRecap] = useState<ShiftRecap | null>(null);
  const [shiftControlLoading, setShiftControlLoading] = useState(false);
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [pendingHeldRecall, setPendingHeldRecall] = useState<string | null>(null);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [saleReturns, setSaleReturns] = useState<SaleReturnRow[]>([]);
  const [returnSaleId, setReturnSaleId] = useState('');
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnRefundMethod, setReturnRefundMethod] = useState('ORIGINAL');
  const [returnBusy, setReturnBusy] = useState(false);
  const [quote, setQuote] = useState<SaleQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [taxCodes, setTaxCodes] = useState<OfflineTaxCode[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [apiOnline, setApiOnline] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [deviceCode, setDeviceCode] = useState('');
  const [catalogReady, setCatalogReady] = useState(false);
  const [offlineConfigSyncedAt, setOfflineConfigSyncedAt] = useState('');
  const [offlineMaxAgeMinutes, setOfflineMaxAgeMinutes] = useState(1440);
  const [offlineClockOffsetMs, setOfflineClockOffsetMs] = useState(0);
  const pendingPaymentRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [workspace, setWorkspace] = useState<PosWorkspace>('SALE');
  const [lastReceipt, setLastReceipt] = useState<{ number: string; total: number } | null>(null);

  /**
   * Global barcode scanner.
   *
   * Without this, a scan only worked when the search box happened to be focused — so scanning while
   * the cart had focus (the normal flow) did nothing, because the keystrokes fired the focused
   * button instead. A recognised scan is routed into the same search state a human would type, so
   * there is exactly one product-lookup path to reason about.
   */
  useEffect(() => {
    const listener = createBarcodeListener({
      onScan: (barcode) => {
        setSearch(barcode);
        // Drop any previous server answer so the effect re-queries: a scanned code may belong to a
        // product this device never downloaded, which is the same silent gap as the un-walked cursor.
        setServerMatches(null);
        setMessage(`Kode dipindai: ${barcode}`);
      },
    });
    return listener.start(window);
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('toko360_pos_token'); }
    catch { setMessage('Penyimpanan lokal browser tidak tersedia. POS tetap dapat dipakai online, tetapi mode offline dinonaktifkan.'); }
    setDeviceCode(getOrCreateDeviceCode());
    setOfflineQueue(loadOfflineQueue());
    setHeldSales(loadHeldSales());
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    if (saved) {
      // Async now: IndexedDB first, legacy localStorage as fallback. Kept inside the effect so the
      // cached catalog can arrive after the first paint instead of blocking it.
      void (async () => {
      const snapshot = await loadOfflineSnapshot<Product, Warehouse, CustomerOption, CashierShift, RuntimeManifest>();
      if (snapshot) {
        setProducts(snapshot.products); setWarehouses(snapshot.warehouses); setCustomers(snapshot.customers); setShift(snapshot.shift); setManifest(snapshot.manifest); setTaxCodes(snapshot.taxCodes); setTenderMethods(snapshot.tenderMethods ?? []); setPaymentMethod((current) => snapshot.tenderMethods?.some((item) => item.code === current) ? current : snapshot.tenderMethods?.[0]?.code ?? ''); setOfflineConfigSyncedAt(snapshot.savedAt); setOfflineMaxAgeMinutes(snapshot.offlineMaxAgeMinutes ?? 1440); setOfflineClockOffsetMs(snapshot.clockOffsetMs ?? 0); setCatalogReady(true);
        setWarehouseId((current) => current || snapshot.warehouses[0]?.id || '');
      }
      })();
      setToken(saved);
    }
  }, []);
  useEffect(() => { if (token) void loadData(token); }, [token]);
  useEffect(() => { const refreshed = (event: Event) => setToken((event as CustomEvent<{ accessToken: string }>).detail.accessToken); const expired = () => setToken(''); window.addEventListener('toko360:pos-auth-refreshed', refreshed); window.addEventListener('toko360:pos-auth-expired', expired); return () => { window.removeEventListener('toko360:pos-auth-refreshed', refreshed); window.removeEventListener('toko360:pos-auth-expired', expired); }; }, []);

  async function api<T>(path: string, init?: RequestInit, activeToken?: string): Promise<T> {
    let response: Response;
    try {
      response = await posAuthFetch(`${API}${path}`, activeToken ?? token, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
      setApiOnline(true);
    } catch {
      setApiOnline(false);
      throw new PosApiError('API tidak terjangkau. POS beralih ke antrean offline.', undefined, true);
    }
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text || 'Respons server tidak valid.' }; }
    if (!response.ok) throw new PosApiError(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Terjadi kesalahan.', response.status, false);
    return data as T;
  }

  async function loadMoreCatalog() {
    if (!token || !catalogHasMore || !catalogCursor || catalogLoadingMore) return;
    setCatalogLoadingMore(true);
    try {
      const next = await loadCatalogPage<Product>(asCatalogFetcher(api), token, catalogCursor);
      if (next.products.length) {
        // Merge by id: a product edited between pages can appear twice, and a duplicate key in the
        // grid is a React warning the console reports but the cashier never sees.
        setProducts((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...next.products.filter((item) => !seen.has(item.id))];
        });
        setMessage(`${next.products.length} produk tambahan dimuat.`);
      } else if (!next.hasMore) {
        setMessage('Katalog sudah lengkap dimuat.');
      }
      setCatalogCursor(next.nextCursor);
      setCatalogHasMore(next.hasMore);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat halaman katalog berikutnya.');
    } finally {
      setCatalogLoadingMore(false);
    }
  }

  /**
   * Ask the SERVER what matches, not just what is already in memory.
   *
   * A client-side filter can only search products the POS has loaded, which is the same silent gap
   * as the un-walked cursor: a cashier typing an exact SKU gets "not found" for something that is
   * in stock on page 7. Offline this cannot work, and the fallback says so rather than pretending.
   */
  useEffect(() => {
    const term = search.trim();
    if (!token || term.length < 2) { setServerMatches(null); setServerSearchBusy(false); return; }
    let cancelled = false;
    setServerSearchBusy(true);
    const timer = setTimeout(() => {
      searchCatalog<Product>(asCatalogFetcher(api), token, term)
        .then((found) => { if (!cancelled) setServerMatches(found); })
        .catch(() => { if (!cancelled) setServerMatches(null); })
        .finally(() => { if (!cancelled) setServerSearchBusy(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, token]);

  /**
   * Supervisor approval for privileged actions.
   *
   * The discount input is not blocked here — the server is the authority, and a dialog that lies
   * about what will be accepted is worse than a refusal at submit. This exists so the cashier can get
   * a grant in one step instead of failing a checkout and hunting for a manager.
   */
  const supervisor = useSupervisorApproval(
    {
      status: (activeToken) => api<{ configured: boolean; approverName: string | null }>('/supervisor-approval/status', undefined, activeToken),
      approve: (activeToken, pin, action, reason) => api<{ grantId: string; approvedByName: string; approvedAt: string }>('/supervisor-approval/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, action, reason }),
      }, activeToken),
    },
    token,
    async () => (token ? api<{ configured: boolean; approverName: string | null }>('/supervisor-approval/status', undefined, token) : { configured: false, approverName: null }),
  );

  async function loadCustomerDirectory(activeToken: string): Promise<CustomerOption[]> {
    try {
      const data = await api<CustomerOption[]>('/customers?limit=100', undefined, activeToken);
      setCustomerWarning('');
      return data;
    } catch {
      setCustomerWarning('Direktori pelanggan tidak tersedia. Transaksi tanpa pelanggan tetap dapat dilakukan.');
      return [];
    }
  }

  async function loadReturnWorkspace(activeToken: string) {
    try {
      const [salesPage, returns] = await Promise.all([
        api<CursorPage<RecentSale>>('/sales?limit=20', undefined, activeToken),
        api<SaleReturnRow[]>('/returns/sales', undefined, activeToken),
      ]);
      setRecentSales(salesPage.items);
      setSaleReturns(returns);
      setReturnSaleId((current) => current && salesPage.items.some((sale) => sale.id === current) ? current : '');
    } catch {
      // Retur adalah workspace online tambahan; kegagalannya tidak boleh memblokir kasir utama.
      setRecentSales([]);
      setSaleReturns([]);
    }
  }

  async function loadData(activeToken: string) {
    try {
      const [catalog, warehouseData, runtime, customerData, offlineConfig] = await Promise.all([
        // Walk the cursor. A single limit=100 call left every product past the hundredth
        // unreachable, with no error — pageInfo was in the type and never read.
        loadCatalog<Product>(asCatalogFetcher(api), activeToken),
        api<Warehouse[]>('/inventory/warehouses', undefined, activeToken),
        api<RuntimeManifest>('/platform/manifest', undefined, activeToken),
        loadCustomerDirectory(activeToken),
        api<OfflineConfig>('/sales/offline/config', undefined, activeToken),
      ]);
      const productData = { items: catalog.products };
      if (catalog.hasMore) {
        // Never say "complete" when it is not. The cashier must know the grid is partial.
        setMessage(`Katalog menampilkan ${catalog.products.length} produk. Masih ada produk lain — tekan "Muat lagi katalog" atau cari dengan mengetik nama/SKU.`);
      }
      const serverTimeMs = new Date(offlineConfig.serverTime).getTime();
      const clockOffsetMs = Number.isFinite(serverTimeMs) ? serverTimeMs - Date.now() : 0;
      const syncedAt = Number.isFinite(serverTimeMs) ? new Date(serverTimeMs).toISOString() : new Date().toISOString();
      setProducts(productData.items); setCatalogCursor(catalog.nextCursor); setCatalogHasMore(catalog.hasMore); setWarehouses(warehouseData); setManifest(runtime); setCustomers(customerData); setShift(offlineConfig.shift); setTaxCodes(offlineConfig.taxCodes); setTenderMethods(offlineConfig.tenderMethods); setPaymentMethod((current) => offlineConfig.tenderMethods.some((item) => item.code === current) ? current : offlineConfig.tenderMethods[0]?.code ?? ''); setOfflineConfigSyncedAt(syncedAt); setOfflineMaxAgeMinutes(offlineConfig.policy.maxOfflineAgeMinutes); setOfflineClockOffsetMs(clockOffsetMs); setCatalogReady(true);
      setWarehouseId((current) => current || warehouseData[0]?.id || '');
      // IndexedDB replaces the old single-key localStorage blob. The outcome is REPORTED, never
      // thrown: a full disk must leave the till selling online, with the operator told that offline
      // is degraded — not a screen that failed to load.
      const stored = await persistOfflineSnapshot<Product, Warehouse, CustomerOption, CashierShift, RuntimeManifest>({
        savedAt: syncedAt, products: productData.items, warehouses: warehouseData, customers: customerData, shift: offlineConfig.shift, manifest: runtime, taxCodes: offlineConfig.taxCodes, tenderMethods: offlineConfig.tenderMethods, offlineMaxAgeMinutes: offlineConfig.policy.maxOfflineAgeMinutes, clockOffsetMs,
      });
      if (!stored.ok) {
        setMessage(`Data online berhasil dimuat, tetapi cache offline tidak tersimpan: ${stored.reason ?? 'penyimpanan browser tidak tersedia.'} Transaksi tetap bisa dilakukan selama online.`);
      }
      void loadReturnWorkspace(activeToken);
    } catch (error) {
      const snapshot = await loadOfflineSnapshot<Product, Warehouse, CustomerOption, CashierShift, RuntimeManifest>();
      if (snapshot && error instanceof PosApiError && error.network) {
        setProducts(snapshot.products); setWarehouses(snapshot.warehouses); setManifest(snapshot.manifest); setCustomers(snapshot.customers); setShift(snapshot.shift); setTaxCodes(snapshot.taxCodes); setTenderMethods(snapshot.tenderMethods ?? []); setPaymentMethod((current) => snapshot.tenderMethods?.some((item) => item.code === current) ? current : snapshot.tenderMethods?.[0]?.code ?? ''); setOfflineConfigSyncedAt(snapshot.savedAt); setOfflineMaxAgeMinutes(snapshot.offlineMaxAgeMinutes ?? 1440); setOfflineClockOffsetMs(snapshot.clockOffsetMs ?? 0);
        setWarehouseId((current) => current || snapshot.warehouses[0]?.id || '');
        setMessage('Server tidak terjangkau. Data cache lokal dipakai untuk operasi offline yang aman.');
      } else { setCatalogReady(true); setMessage(error instanceof Error ? error.message : 'Gagal memuat data.'); }
    }
  }

  useEffect(() => {
    if (!token || !customerId) { setLoyaltyPoints(0); setRedeemPoints(0); return; }
    void api<{ points: number }>(`/loyalty/accounts/${customerId}`, undefined, token)
      .then((data) => { setLoyaltyPoints(data.points ?? 0); setRedeemPoints(0); })
      .catch(() => setLoyaltyPoints(0));
  }, [token, customerId]);

  useEffect(() => {
    if (!token || !warehouseId || !cart.length || !apiOnline) {
      setQuote(null); setQuoteError(''); setQuoteLoading(false); return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setQuoteLoading(true); setQuoteError('');
      const payload = salePayload();
      void api<SaleQuote>('/sales/quote', { method: 'POST', body: JSON.stringify(payload) }, token)
        .then((result) => { if (!cancelled) setQuote(result); })
        .catch((error) => { if (!cancelled) { setQuote(null); setQuoteError(error instanceof Error ? error.message : 'Gagal menghitung total.'); } })
        .finally(() => { if (!cancelled) setQuoteLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [token, warehouseId, cart, discount, promoCode, customerId, redeemPoints, apiOnline]);

  // Escape must close a modal from ANY focus, so these sit at the component top level and
  // listen on document rather than on the (never-focused) overlay.
  useEscapeToClose(() => setCollectFor(null), Boolean(collectFor));
  useEscapeToClose(() => setPendingHeldRecall(null), Boolean(pendingHeldRecall));

  useEffect(() => {
    if (!token) return;
    let active = true;
    const probe = async () => {
      try {
        const response = await fetch(`${API}/health`, { cache: 'no-store' });
        if (active) setApiOnline(response.ok);
      } catch { if (active) setApiOnline(false); }
    };
    const onOnline = () => void probe();
    const onOffline = () => setApiOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    void probe();
    const interval = window.setInterval(probe, 10000);
return () => { active = false; window.clearInterval(interval); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [token]);

  useEffect(() => {
    const subject = jwtSubject(token);
    if (token && apiOnline && deviceCode && subject && offlineQueue.some((item) => item.cashierSub === subject && item.status !== 'CONFLICT')) void syncOfflineQueue(token);
  }, [token, apiOnline, deviceCode, offlineQueue.length]);

  async function submitLogin(event: FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const response = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(login) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Login gagal.');
      try { storePosTokens(data.accessToken, data.refreshToken); }
      catch { setMessage('Login berhasil, tetapi token tidak dapat disimpan di perangkat. Mode offline/reload sesi tidak tersedia.'); }
      setToken(data.accessToken);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Login gagal.'); }
  }

  const subtotalFallback = useMemo(() => cart.reduce((sum, item) => sum + cartItemUnitPrice(item) * item.quantity * item.quantityFactor, 0), [cart]);
  const categories = useMemo(() => ['Semua', ...Array.from(new Set(products.map((p) => p.categoryName ?? 'Umum')))], [products]);
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    // While online, the server's answer wins: it covers products this device never downloaded.
    // `serverMatches === null` means "no server answer yet or offline" — then fall back to the local
    // filter so browsing still works, which is the same behaviour as before this change.
    const pool = serverMatches ?? products;
    const inCategory = pool.filter((product) => category === 'Semua' || (product.categoryName ?? 'Umum') === category);
    // Rank rather than filter: a bare `includes()` returns catalog order, so "gula" surfaces
    // "Gula Aren 500g" wherever it happens to sit in storage. `fuzzyRank` puts the word-start match
    // first and, with no query at all, returns the list untouched.
    const local = q
      ? fuzzyRank(inCategory, q, (product) => [product.name, product.sku, product.barcode,
          ...(product.barcodes ?? []).map((barcode) => barcode.code)])
      : inCategory;
    // A server search can return items outside the active category; the cashier filtered on purpose.
    return local;
  }, [products, search, category, serverMatches]);
  const catalogTruncated = catalogHasMore || Boolean(search.trim().length >= 2 && serverSearchBusy);
  // 20% mirrors SUPERVISOR_DISCOUNT_RATIO in sales.service.ts. Duplicated deliberately: a cashier
  // should learn the rule before paying, not from a server rejection afterwards.
  const discountNeedApproval = subtotalFallback > 0 && discount / subtotalFallback > 0.2;
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);

  /**
   * Reprint a receipt for an earlier transaction.
   *
   * The common case is a customer who lost the slip at the till, minutes after paying. The receipt
   * endpoint already exists and renders an HTML page; what was missing was any way to reach it for a
   * sale other than the last one. Opened in a new tab so the operator's cart is not lost.
   */
  function reprintReceipt(saleNumber: string) {
    if (!saleNumber) { setMessage('Nomor struk tidak valid untuk dicetak ulang.'); return; }
    setReceiptBusy(saleNumber);
    const opened = window.open(`${API}/receipts/${encodeURIComponent(saleNumber)}`, '_blank', 'noopener,noreferrer');
    setMessage(opened ? `Struk ${saleNumber} dibuka di tab baru untuk dicetak.` : `Popup diblokir browser. Buka manual: ${API}/receipts/${encodeURIComponent(saleNumber)}`);
    setReceiptBusy(null);
  }

  function rawBtReceipt(saleNumber: string) {
    const sale = recentSales.find((item) => item.number === saleNumber);
    if (!sale) { setMessage('Data transaksi belum tersedia untuk RawBT. Refresh riwayat struk lalu coba lagi.'); return; }
    try {
      openRawBtReceipt({
        storeName: manifest?.branch?.name ?? manifest?.company?.name ?? 'Toko360',
        invoiceNumber: sale.number,
        dateLabel: new Date(sale.createdAt).toLocaleString('id-ID'),
        cashierName: 'Kasir POS',
        paperWidth: 58,
        columns: sale.items.map((item) => ({ left: `${item.product.name} x${item.quantity}`, right: money(item.netSubtotal) })),
        summary: [
          { label: 'Subtotal', value: money(sale.subtotal) },
          ...(Number(sale.discount) > 0 ? [{ label: 'Diskon', value: `-${money(sale.discount)}` }] : []),
          ...(Number(sale.tax) > 0 ? [{ label: 'Pajak', value: money(sale.tax) }] : []),
          { label: 'TOTAL', value: money(sale.total), bold: true },
        ],
        footer: ['Terima kasih telah berbelanja.'],
      });
      setMessage(`Struk ${sale.number} dikirim ke RawBT. Jika aplikasi belum terpasang, gunakan cetak browser.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'RawBT gagal dibuka.'); }
  }

  function salePayload() {
    return {
      warehouseId,
      discount,
      // The server clamps this to the settlement and posts it to its own income account, so the
      // cashier cannot turn it into a discount with a negative value.
      ...(serviceFee > 0 ? { serviceFee } : {}),
      promoCode: promoCode.trim() || undefined,
      customerId: customerId || undefined,
      redeemPoints: customerId && redeemPoints > 0 ? redeemPoints : undefined,
      items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, ...(item.variantId ? { variantId: item.variantId } : {}), ...(item.productUnitId ? { productUnitId: item.productUnitId } : {}), ...(item.barcodeCode ? { barcodeCode: item.barcodeCode } : {}) })),
    };
  }

  const offlineQuoteState = useMemo(() => {
    if (apiOnline || !cart.length) return { quote: null as SaleQuote | null, error: '' };
    const estimatedServerNow = Date.now() + offlineClockOffsetMs;
    const configAgeMinutes = offlineConfigSyncedAt ? (estimatedServerNow - new Date(offlineConfigSyncedAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(configAgeMinutes) || configAgeMinutes > offlineMaxAgeMinutes) return { quote: null as SaleQuote | null, error: `Cache harga/pajak sudah lebih dari ${offlineMaxAgeMinutes} menit. Hubungkan POS ke server sebelum menerima transaksi offline baru.` };
    const offlineTender = tenderMethods.find((item) => item.code === paymentMethod);
    if (splitEnabled || onAccountAmount > 0 || !offlineTender?.allowOffline) return { quote: null as SaleQuote | null, error: 'Mode offline hanya mengizinkan satu tender yang ditandai boleh offline pada konfigurasi server.' };
    if (offlineTender.requiresProvider && !paymentProvider.trim()) return { quote: null as SaleQuote | null, error: `Tender ${offlineTender.name} mewajibkan provider.` };
    if (offlineTender.requiresReference && !paymentReference.trim()) return { quote: null as SaleQuote | null, error: `Tender ${offlineTender.name} mewajibkan referensi eksternal.` };
    if (cart.some((item) => item.quantityFactor !== 1 || item.barcodeCode)) return { quote: null as SaleQuote | null, error: 'Penjualan unit/kemasan hasil scan membutuhkan server online agar konversi dan harga divalidasi authoritative.' };
    if (promoCode.trim()) return { quote: null as SaleQuote | null, error: 'Promo membutuhkan koneksi server.' };
    if (redeemPoints > 0) return { quote: null as SaleQuote | null, error: 'Penukaran poin membutuhkan koneksi server.' };
    try {
      const calculated = calculateOfflineQuote({
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, unitPrice: cartItemUnitPrice(item), salesTaxCodeId: item.product.salesTaxCodeId })),
        discount, taxCodes,
      });
      return { quote: calculated as SaleQuote, error: '' };
    } catch (error) {
      return { quote: null as SaleQuote | null, error: error instanceof Error ? error.message : 'Cache offline tidak cukup untuk menghitung transaksi.' };
    }
  }, [apiOnline, cart, discount, promoCode, splitEnabled, paymentMethod, paymentProvider, paymentReference, onAccountAmount, redeemPoints, taxCodes, tenderMethods, offlineConfigSyncedAt, offlineMaxAgeMinutes, offlineClockOffsetMs]);

  function persistOfflineQueue(next: OfflineQueueItem[]): boolean {
    try { saveOfflineQueue(next); setOfflineQueue(next); return true; }
    catch {
      setMessage('Penyimpanan lokal gagal. Transaksi BELUM masuk antrean offline; jangan kosongkan keranjang atau tutup halaman sampai penyimpanan perangkat diperbaiki.');
      return false;
    }
  }

  function queueSaleOffline(basePayload: ReturnType<typeof salePayload> & { cashierShiftId: string; idempotencyKey: string }, expectedTotal: number, note: string) {
    const cashierSub = jwtSubject(token);
    if (!cashierSub) { setMessage('Identitas sesi kasir tidak valid. Login ulang diperlukan sebelum transaksi offline baru dapat disimpan.'); return; }
    if (!deviceCode) { setMessage('Penyimpanan identitas perangkat tidak tersedia. Transaksi offline baru diblokir agar data tidak hilang.'); return; }
    try {
      const localId = newIdempotencyKey();
      const item: OfflineQueueItem = {
        localId,
        sequence: nextOfflineSequence(),
        capturedAt: new Date(Date.now() + offlineClockOffsetMs).toISOString(),
        configSyncedAt: offlineConfigSyncedAt,
        expectedTotal,
        cashierSub,
        payload: basePayload,
        status: 'PENDING',
      };
      if (!persistOfflineQueue([...offlineQueue, item])) return;
      pendingPaymentRef.current = null;
      setCart([]); setDiscount(0); setServiceFee(0); setRedeemPoints(0); setPromoCode(''); setSplitEnabled(false); setOnAccountAmount(0); setPaymentProvider(''); setPaymentReference(''); setQuote(null);
      setMessage(`${note} Antrean offline #${item.sequence} tersimpan sebesar ${money(expectedTotal)} dan akan disinkronkan otomatis.`);
    } catch {
      setMessage('Penyimpanan lokal gagal. Transaksi BELUM masuk antrean offline dan keranjang tetap dipertahankan.');
    }
  }

  async function syncOfflineQueue(activeToken = token, includeConflicts = false) {
    if (!activeToken || !deviceCode || syncBusy) return;
    const activeSub = jwtSubject(activeToken);
    if (!activeSub) { setMessage('Sesi kasir tidak valid. Login ulang untuk menyinkronkan antrean offline.'); return; }

    let workingQueue = offlineQueue;
    let totalApplied = 0;
    let totalConflicts = 0;
    let totalFailed = 0;
    setSyncBusy(true);
    try {
      while (true) {
        const candidates = workingQueue
          .filter((item) => item.cashierSub === activeSub && (includeConflicts || item.status !== 'CONFLICT'))
          .slice(0, 50);
        if (!candidates.length) break;

        const response = await api<OfflineReplayResponse>('/sales/offline/replay', {
          method: 'POST',
          body: JSON.stringify({
            deviceCode,
            deviceName: `POS Browser ${deviceCode.slice(-8)}`,
            appVersion: '0.5.3',
            transactions: candidates.map(({ status: _status, error: _error, cashierSub: _cashierSub, ...item }) => item),
          }),
        }, activeToken);
        const resultMap = new Map(response.results.map((item) => [item.localId, item]));
        workingQueue = workingQueue.flatMap((item) => {
          const result = resultMap.get(item.localId);
          if (!result) return [item];
          if (result.status === 'APPLIED') return [];
          if (result.status === 'CONFLICT') return [{ ...item, status: 'CONFLICT' as const, error: result.reason ?? 'Transaksi membutuhkan penyelesaian konflik.' }];
          if (result.status === 'FAILED') return [{ ...item, status: 'FAILED' as const, error: result.reason ?? 'Sinkronisasi gagal dan akan dicoba kembali.' }];
          return [{ ...item, status: 'PENDING' as const }];
        });
        saveOfflineQueue(workingQueue);
        setOfflineQueue(workingQueue);
        totalApplied += response.applied;
        totalConflicts += response.conflicts;
        totalFailed += response.failed;

        // Konflik/failure mempertahankan urutan transaksi. Hanya batch yang sepenuhnya
        // sukses dilanjutkan otomatis agar tidak membuat retry loop agresif.
        if (response.conflicts > 0 || response.failed > 0 || response.applied === 0 || candidates.length < 50) break;
      }

      if (totalApplied > 0) {
        setMessage(`${totalApplied} transaksi offline berhasil diterapkan ke server.${totalConflicts ? ` ${totalConflicts} konflik membutuhkan pemeriksaan.` : ''}`);
        await loadData(activeToken);
      } else if (totalConflicts > 0) {
        setMessage('Sinkronisasi berhenti karena ada konflik transaksi offline. Data tidak dibuang dan tidak diduplikasi.');
      } else if (totalFailed > 0) {
        setMessage('Sinkronisasi sementara gagal. Antrean tetap tersimpan dan dapat dicoba kembali.');
      }
    } catch (error) {
      if (!(error instanceof PosApiError && error.network)) setMessage(error instanceof Error ? error.message : 'Sinkronisasi offline gagal.');
    } finally { setSyncBusy(false); }
  }

  function cacheShiftState(nextShift: CashierShift | null): boolean {
    try {
      const snapshot = loadOfflineSnapshot<Product, Warehouse, CustomerOption, CashierShift, RuntimeManifest>();
      if (!snapshot) return false;
      persistOfflineSnapshot({ ...snapshot, shift: nextShift });
      return true;
    } catch { return false; }
  }

  function available(product: Product) {
    const serverAvailable = product.inventories.find((inventory) => inventory.warehouseId === warehouseId)?.available ?? 0;
    return Math.max(0, serverAvailable - reservedOfflineQuantity(offlineQueue, warehouseId, product.id));
  }
  /**
   * Harga dasar satu item keranjang, memperhitungkan jenis yang dipilih kasir. Dipakai di
   * subtotal, kalkulasi offline, dan fallback harga baris: kalau ketiganya memakai harga produk
   * saja, kasir melihat (dan sempat menjumlahkan) angka yang salah untuk jenis non-default.
   */
  function cartItemUnitPrice(item: CartItem) { return variantPrice(item.product, shownVariant(item.product, item.variantId)); }
  function cartLineKey(item: Pick<CartItem, 'product' | 'barcodeCode' | 'productUnitId' | 'variantId'>) { return `${item.product.id}:${item.productUnitId ?? item.barcodeCode ?? item.variantId ?? 'BASE'}`; }
  function add(product: Product, quantity = 1, conversion?: { unitCode?: string | null; quantityFactor?: string | number; productUnitId?: string; variantId?: string; barcodeCode?: string }) {
    const factor = Number(conversion?.quantityFactor ?? 1);
    if (!Number.isSafeInteger(factor) || factor < 1) { setMessage('Konversi unit produk tidak valid.'); return; }
    const unitCode = (conversion?.unitCode || product.unit).trim().toUpperCase();
    if (!unitCode) { setMessage('Base unit produk belum dikonfigurasi. Perbaiki master UNIT sebelum menjual produk ini.'); return; }
    const barcodeCode = conversion?.barcodeCode;
    const productUnitId = conversion?.productUnitId;
    const variantId = conversion?.variantId;
    const lineKey = `${product.id}:${productUnitId ?? barcodeCode ?? variantId ?? 'BASE'}`;
    const delta = Math.max(1, Math.trunc(quantity));
    const stock = available(product);
    setCart((current) => {
      const existing = current.find((item) => cartLineKey(item) === lineKey);
      const usedOtherBase = current.filter((item) => item.product.id === product.id && cartLineKey(item) !== lineKey).reduce((sum, item) => sum + item.quantity * item.quantityFactor, 0);
      const maxUnitQuantity = Math.max(0, Math.floor((stock - usedOtherBase) / factor));
      const nextQuantity = Math.min(maxUnitQuantity, (existing?.quantity ?? 0) + delta);
      if (nextQuantity <= 0 || nextQuantity === existing?.quantity) return current;
      return existing
        ? current.map((item) => cartLineKey(item) === lineKey ? { ...item, quantity: nextQuantity } : item)
        : [...current, { product, quantity: nextQuantity, unitCode, quantityFactor: factor, ...(productUnitId ? { productUnitId } : {}), ...(variantId ? { variantId } : {}), ...(barcodeCode ? { barcodeCode } : {}) }];
    });
  }
  function scanExactBarcode(raw: string) {
    const code = raw.trim();
    if (!code) return false;
    for (const product of products) {
      const alternate = product.barcodes?.find((item) => item.code === code);
      if (product.barcode !== code && !alternate) continue;
      const factor = Number(alternate?.quantityFactor ?? 1);
      if (!Number.isSafeInteger(factor) || factor <= 0) {
        setMessage(`Barcode ${code} memakai quantityFactor ${factor} yang tidak dapat diposting sebagai stok integer. Perbaiki konversi unit master data.`);
        return true;
      }
      if (!apiOnline && (factor !== 1 || Boolean(alternate))) {
        setMessage('Scan barcode unit/kemasan membutuhkan server online agar konversi dan harga diverifikasi. Gunakan produk base unit saat offline.');
        return true;
      }
      add(product, 1, { unitCode: alternate?.unitCode ?? product.unit, quantityFactor: factor, productUnitId: alternate?.productUnitId ?? undefined, variantId: alternate?.variantId ?? undefined, barcodeCode: code });
      setSearch('');
      setMessage(factor > 1 ? `${product.name}: 1 ${alternate?.unitCode ?? 'kemasan'} = ${factor} ${product.unit}. Harga dikonfirmasi server.` : '');
      return true;
    }
    setMessage(`Barcode ${code} tidak ditemukan pada katalog aktif.`);
    return true;
  }
  function change(lineKey: string, quantity: number) {
    setCart((current) => {
      const target = current.find((item) => cartLineKey(item) === lineKey);
      if (!target) return current;
      if (quantity <= 0) return current.filter((item) => cartLineKey(item) !== lineKey);
      const stock = available(target.product);
      const usedOtherBase = current.filter((item) => item.product.id === target.product.id && cartLineKey(item) !== lineKey).reduce((sum, item) => sum + item.quantity * item.quantityFactor, 0);
      const maxUnitQuantity = Math.max(0, Math.floor((stock - usedOtherBase) / target.quantityFactor));
      const next = Math.min(Math.max(1, Math.trunc(quantity)), maxUnitQuantity);
      return current.map((item) => cartLineKey(item) === lineKey ? { ...item, quantity: next } : item).filter((item) => item.quantity > 0);
    });
  }


  function persistHeldSales(next: HeldSale[]): boolean {
    try { saveHeldSales(next); setHeldSales(next); return true; }
    catch { setMessage('Gagal menyimpan transaksi hold pada perangkat ini.'); return false; }
  }

  function holdCart() {
    const cashierSub = jwtSubject(token);
    if (!cashierSub || !cart.length) return;
    const id = newIdempotencyKey();
    const next: HeldSale = {
      id, cashierSub, label: `Hold ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`, createdAt: new Date().toISOString(),
      warehouseId, customerId, discount, serviceFee, redeemPoints, promoCode, paymentMethod, paymentProvider, paymentReference, splitEnabled, splitPayments, onAccountAmount,
      items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, ...(item.variantId ? { variantId: item.variantId } : {}), ...(item.productUnitId ? { productUnitId: item.productUnitId } : {}), ...(item.barcodeCode ? { barcodeCode: item.barcodeCode } : {}) })),
    };
    if (!persistHeldSales([next, ...heldSales])) return;
    setCart([]); setCustomerId(''); setDiscount(0); setServiceFee(0); setRedeemPoints(0); setPromoCode(''); setSplitEnabled(false); setOnAccountAmount(0); setPaymentProvider(''); setPaymentReference('');
    setMessage(`${next.label} tersimpan. Keranjang siap untuk transaksi berikutnya.`);
  }

  function recallHeld(id: string) {
    if (cart.length) { setPendingHeldRecall(id); return; }
    performRecallHeld(id);
  }

  function performRecallHeld(id: string) {
    const held = heldSales.find((item) => item.id === id && item.cashierSub === jwtSubject(token));
    if (!held) return;
    const targetWarehouseId = held.warehouseId || warehouseId;
    const restored = held.items.flatMap((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product) return [];
      const serverAvailable = product.inventories.find((inventory) => inventory.warehouseId === targetWarehouseId)?.available ?? 0;
      const safeAvailable = Math.max(0, serverAvailable - reservedOfflineQuantity(offlineQueue, targetWarehouseId, product.id));
      const barcode = line.barcodeCode ? product.barcodes?.find((item) => item.code === line.barcodeCode) : undefined;
      const directUnit = line.productUnitId ? product.units?.find((item) => item.id === line.productUnitId) : undefined;
      const factor = Number(directUnit?.quantityFactor ?? barcode?.quantityFactor ?? 1);
      if (!Number.isSafeInteger(factor) || factor < 1) return [];
      const safeUnitQuantity = Math.min(line.quantity, Math.floor(safeAvailable / factor));
      return safeUnitQuantity > 0 ? [{ product, quantity: safeUnitQuantity, unitCode: (directUnit?.unitCode || barcode?.unitCode || product.unit).trim().toUpperCase(), quantityFactor: factor, ...(line.productUnitId ? { productUnitId: line.productUnitId } : {}), ...(line.variantId ? { variantId: line.variantId } : {}), ...(line.barcodeCode ? { barcodeCode: line.barcodeCode } : {}) }] : [];
    }).filter((item) => item.quantity > 0);
    setWarehouseId(targetWarehouseId); setCart(restored); setCustomerId(held.customerId); setDiscount(held.discount); setServiceFee(held.serviceFee ?? 0); setRedeemPoints(held.redeemPoints); setPromoCode(held.promoCode); setPaymentMethod(held.paymentMethod || tenderMethods[0]?.code || ''); setPaymentProvider(held.paymentProvider ?? ''); setPaymentReference(held.paymentReference ?? ''); setSplitEnabled(Boolean(held.splitEnabled)); setSplitPayments(held.splitPayments?.length ? held.splitPayments : [{ method: tenderMethods[0]?.code ?? '', amount: 0 }, { method: tenderMethods[1]?.code ?? tenderMethods[0]?.code ?? '', amount: 0 }]); setOnAccountAmount(held.onAccountAmount ?? 0);
    persistHeldSales(heldSales.filter((item) => item.id !== id));
    setMessage(`${held.label} dipanggil kembali${restored.length !== held.items.length ? '; beberapa produk tidak lagi tersedia' : ''}.`);
  }


  function confirmHeldRecall() {
    if (!pendingHeldRecall) return;
    const id = pendingHeldRecall;
    setPendingHeldRecall(null);
    performRecallHeld(id);
  }

  function deleteHeld(id: string) { persistHeldSales(heldSales.filter((item) => item.id !== id)); }

  async function loadShiftControl() {
    if (!token || !apiOnline || shiftControlLoading) return;
    setShiftControlLoading(true);
    try {
      const current = await api<CashierShift | null>('/sales/shifts/current', undefined, token);
      setShift(current);
      cacheShiftState(current);
      if (!current) { setCashMovements([]); return; }
      const [movements, recap] = await Promise.all([
        api<CashMovement[]>('/sales/shifts/cash-movements/current', undefined, token),
        api<ShiftRecap>(`/sales/shifts/${current.id}/recap`, undefined, token),
      ]);
      setCashMovements(movements ?? []);
      setShiftRecap(recap);
      setClosingCash(Number(current.expectedCash ?? current.openingCash ?? 0));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Kontrol shift gagal dimuat.'); }
    finally { setShiftControlLoading(false); }
  }

  async function recordCashMovement(type: 'CASH_IN' | 'CASH_OUT') {
    if (!token || !shift || cashMovementBusy || cashMovementAmount <= 0 || !cashMovementReason.trim()) return;
    if (!apiOnline) { setMessage('Kas masuk/keluar membutuhkan server online.'); return; }
    setCashMovementBusy(true); setMessage('');
    try {
      // A large withdrawal is refused by the server, so the cashier has to be able to ASK. Without
      // this the till shows "requires supervisor approval" and offers no way to satisfy it — a control
      // the operator cannot pass is a control that gets abandoned, or worked around in cash.
      const post = async (approvalId?: string) => {
        await api('/sales/shifts/cash-movements', {
          method: 'POST',
          body: JSON.stringify({ type, amount: cashMovementAmount, reason: cashMovementReason.trim(), ...(approvalId ? { supervisorApprovalId: approvalId } : {}) }),
        }, token);
      };
      // A grant may already be HELD from the PIN prompt the last time this button was pressed. It
      // has to be spent on this attempt, not left sitting in state: without this the first click is
      // refused, the dialog appears, the PIN is accepted, and the second click sends no grant at
      // all — so the till refuses forever. That is a control the cashier can never pass, which is
      // the same defect class as the original supervisor hole, just wearing a new hat.
      const heldGrant = supervisor.takeGrant();
      try {
        await post(heldGrant ?? undefined);
      } catch (error) {
        const needsApproval = error instanceof Error && /persetujuan supervisor/i.test(error.message);
        if (!needsApproval || type !== 'CASH_OUT') throw error;
        supervisor.open('SALE_CASH_MOVEMENT', `Kas keluar ${money(cashMovementAmount)} — ${cashMovementReason.trim()}`);
        setMessage('Pengambilan kas ini memerlukan persetujuan supervisor. Minta persetujuan, lalu tekan KAS KELUAR lagi.');
        return;
      }
      setMessage(`${type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'} ${money(cashMovementAmount)} berhasil dicatat.`);
      setCashMovementAmount(0); setCashMovementReason('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mencatat mutasi kas.'); }
    finally { setCashMovementBusy(false); }
  }

  async function submitSaleReturn() {
    if (!token || returnBusy || !apiOnline || !returnSaleId) return;
    const sale = recentSales.find((item) => item.id === returnSaleId);
    if (!sale) { setMessage('Transaksi asal retur tidak ditemukan pada daftar terbaru.'); return; }
    const items = sale.items
      .map((item) => ({ saleItemId: item.id, quantity: Math.min(item.quantity, Math.max(0, Math.floor(returnQty[item.id] ?? 0))), condition: 'GOOD', restock: true }))
      .filter((item) => item.quantity > 0);
    if (!items.length) { setMessage('Isi minimal satu kuantitas item yang akan diretur.'); return; }
    if (!returnReason.trim()) { setMessage('Alasan retur wajib diisi agar proses dapat diaudit.'); return; }
    setReturnBusy(true); setMessage('');
    try {
      const created = await api<SaleReturnRow>('/returns/sales', {
        method: 'POST', body: JSON.stringify({ saleId: sale.id, warehouseId: sale.warehouseId, reason: returnReason.trim(), refundMethod: returnRefundMethod, items }),
      }, token);
      setMessage(`Retur ${created.number} berhasil diajukan. Barang harus melewati inspeksi sebelum refund diposting.`);
      setReturnSaleId(''); setReturnQty({}); setReturnReason('');
      await loadReturnWorkspace(token);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengajukan retur penjualan.'); }
    finally { setReturnBusy(false); }
  }

  async function openShift() {
    if (!token || shiftBusy) return;
    setShiftBusy(true); setMessage('');
    try {
      const opened = await api<CashierShift>('/sales/shifts/open', { method: 'POST', body: JSON.stringify({ openingCash }) }, token);
      setShift(opened); setClosingCash(Number(opened.openingCash));
      const cached = cacheShiftState(opened);
      const [movements, recap] = await Promise.all([
        api<CashMovement[]>('/sales/shifts/cash-movements/current', undefined, token),
        api<ShiftRecap>(`/sales/shifts/${opened.id}/recap`, undefined, token),
      ]);
      setCashMovements(movements ?? []); setShiftRecap(recap);
      setMessage(`Shift berhasil dibuka dengan kas awal ${money(opened.openingCash)}.${cached ? '' : ' Cache offline shift belum dapat diperbarui; transaksi offline baru jangan dilakukan sebelum data berhasil dimuat ulang.'}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuka shift.'); }
    finally { setShiftBusy(false); }
  }

  async function closeShift() {
    if (!token || !shift || shiftBusy || cart.length) return;
    if (!apiOnline) { setMessage('Shift tidak boleh ditutup saat server tidak terjangkau. Sinkronkan transaksi offline terlebih dahulu.'); return; }
    if (offlineQueue.some((item) => item.cashierSub === jwtSubject(token))) { setMessage('Masih ada transaksi offline pada kasir ini yang belum selesai disinkronkan. Tutup shift diblokir untuk mencegah selisih kas.'); return; }
    setShiftBusy(true); setMessage('');
    try {
      // Same rule as a large cash withdrawal: ask when the server says the drawer is short, or the
      // cashier is left staring at a refusal. A drawer that comes up OVER is never blocked, so this
      // cannot be used to stop a till from closing.
      const approvalId = supervisor.takeGrant();
      const closed = await api<CashierShift>('/sales/shifts/close', {
        method: 'POST',
        body: JSON.stringify({ closingCash, ...(approvalId ? { supervisorApprovalId: approvalId } : {}) }),
      }, token);
      const difference = Number(closed.difference ?? 0);
      setShiftRecap(await api<ShiftRecap>(`/sales/shifts/${closed.id}/recap`, undefined, token));
      const cached = cacheShiftState(null);
      setMessage(`Shift berhasil ditutup. Selisih kas ${money(difference)}.${cached ? '' : ' Cache lokal tidak dapat diperbarui.'}`);
      setShift(null); setOpeningCash(0); setClosingCash(0);
    } catch (error) {
      if (error instanceof Error && /persetujuan supervisor/i.test(error.message)) {
        supervisor.open('SHIFT_CLOSE', `Tutup shift dengan kas ${money(closingCash)}`);
        setMessage('Selisih kas melebihi toleransi. Minta persetujuan supervisor untuk menutup shift.');
      } else { setMessage(error instanceof Error ? error.message : 'Gagal menutup shift.'); }
    }
    finally { setShiftBusy(false); }
  }

  async function pay() {
    const activeQuote = apiOnline ? quote : offlineQuoteState.quote;
    const activeQuoteError = apiOnline ? quoteError : offlineQuoteState.error;
    if (!token || !shift || !activeQuote || quoteLoading || activeQuoteError || paying || !cart.length) return;
    if (splitEnabled) {
      const splitTotalNow = splitPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const splitTargetNow = Math.max(0, Number(activeQuote.total) - Math.min(Math.max(0, Number(onAccountAmount) || 0), Number(activeQuote.total)));
      if (Math.abs(splitTotalNow - splitTargetNow) >= 0.01) { setMessage('Total split tender harus sama persis dengan bagian transaksi yang tidak menjadi piutang.'); return; }
      if (splitTargetNow > 0 && !splitPayments.some((item) => item.amount > 0)) { setMessage('Split payment belum memiliki nominal pembayaran.'); return; }
    }
    const offlineEnabled = manifest?.features.pos_offline?.enabled === true;
    const normalizedOnAccount = Math.min(Math.max(0, Number(onAccountAmount) || 0), Number(activeQuote.total));
    if (normalizedOnAccount > 0 && !customerId) { setMessage('Pilih pelanggan sebelum mencatat sebagian atau seluruh transaksi sebagai piutang.'); return; }
    const tenderDue = Math.max(0, Number((Number(activeQuote.total) - normalizedOnAccount).toFixed(2)));
    const settlement = splitEnabled
      ? { payments: splitPayments.filter((item) => item.amount > 0).map((item) => ({ method: item.method, amount: Number(item.amount.toFixed(2)), ...(item.provider?.trim() ? { provider: item.provider.trim() } : {}), ...(item.externalRef?.trim() ? { externalRef: item.externalRef.trim() } : {}) })) }
      : tenderDue > 0
        ? { payments: [{ method: paymentMethod, amount: tenderDue, ...(paymentProvider.trim() ? { provider: paymentProvider.trim() } : {}), ...(paymentReference.trim() ? { externalRef: paymentReference.trim() } : {}) }] }
        : {};
    const basePayload = { ...salePayload(), ...settlement, ...(normalizedOnAccount > 0 ? { onAccount: true, onAccountAmount: normalizedOnAccount } : {}), cashierShiftId: shift.id };
    const fingerprint = JSON.stringify(basePayload);
    const pending = pendingPaymentRef.current;
    const idempotencyKey = pending?.fingerprint === fingerprint ? pending.key : newIdempotencyKey();
    pendingPaymentRef.current = { fingerprint, key: idempotencyKey };
    // Attach a supervisor grant when one was just obtained. Spent on the way out, so a single
    // approval cannot authorise a second sale if the operator retries the button.
    const approvalId = supervisor.takeGrant();
    const replayPayload = approvalId ? { ...basePayload, idempotencyKey, supervisorApprovalId: approvalId } : { ...basePayload, idempotencyKey };

    if (!apiOnline) {
      if (!offlineEnabled) { setMessage('Mode offline belum diaktifkan untuk POS ini.'); return; }
      if (serviceFee > 0) { setMessage('Biaya layanan tidak dapat dicatat saat offline. Selesaikan transaksi saat online.'); return; }
      const activeTender = tenderMethods.find((item) => item.code === paymentMethod);
      if (splitEnabled || normalizedOnAccount > 0 || !activeTender?.allowOffline) { setMessage('Pembayaran offline hanya boleh memakai satu tender yang diizinkan konfigurasi server dan tidak boleh membentuk piutang.'); return; }
      if (redeemPoints > 0) { setMessage('Penukaran poin tidak boleh dilakukan saat offline.'); return; }
      queueSaleOffline(replayPayload, Number(activeQuote.total), 'Server sedang offline.');
      return;
    }

    setPaying(true); setMessage('');
    try {
      const sale = await api<{ number: string; total: string | number; loyaltyEarned?: number; loyaltyRedeemed?: number }>('/sales', {
        method: 'POST', body: JSON.stringify(replayPayload),
      }, token);
      pendingPaymentRef.current = null;
      const loyaltyNote = sale.loyaltyRedeemed ? ` Tukar ${sale.loyaltyRedeemed} poin.` : '';
      const earnNote = sale.loyaltyEarned ? ` Dapat ${sale.loyaltyEarned} poin baru.` : '';
      setLastReceipt({ number: sale.number, total: Number(sale.total) });
      setMessage(`Transaksi ${sale.number} berhasil sebesar ${money(sale.total)}.${loyaltyNote}${earnNote} Stok dan jurnal telah diperbarui.`);
      setCart([]); setDiscount(0); setServiceFee(0); setRedeemPoints(0); setPromoCode(''); setSplitEnabled(false); setOnAccountAmount(0); setPaymentProvider(''); setPaymentReference(''); setQuote(null);
      await loadData(token);
    } catch (error) {
      if (error instanceof PosApiError && error.network && offlineEnabled && !splitEnabled && normalizedOnAccount === 0 && tenderMethods.some((item) => item.code === paymentMethod && item.allowOffline) && redeemPoints === 0 && !promoCode.trim()) {
        // Hasil request bisa saja sudah commit sebelum koneksi putus. Idempotency key yang
        // sama disimpan ke antrean sehingga replay tidak pernah menggandakan sale.
        queueSaleOffline(replayPayload, Number(activeQuote.total), 'Koneksi terputus saat pembayaran; status server belum pasti.');
      } else {
        setMessage(error instanceof Error ? error.message : 'Transaksi gagal. Retry akan memakai idempotency key yang sama.');
      }
    } finally { setPaying(false); }
  }

  async function logout() {
    const owned = offlineQueue.filter((item) => item.cashierSub === jwtSubject(token)).length;
    try { if (token && apiOnline) await api('/auth/logout', { method: 'POST' }, token); } catch { /* local logout must still complete */ }
    try { clearPosTokens(); } catch { /* storage unavailable */ }
    setToken(null); setShift(null); setCart([]); setLastReceipt(null); pendingPaymentRef.current = null;
    setMessage(owned ? `${owned} transaksi offline tetap aman tersimpan. Login kembali dengan kasir yang sama untuk menyinkronkannya.` : '');
  }

  useEffect(() => {
    if (workspace === 'SHIFT' && token && apiOnline) void loadShiftControl();
  }, [workspace, token, apiOnline, shift?.id]);

  if (!token) return <main className="login"><T360ThemeToggle className="loginThemeToggle" /><form onSubmit={submitLogin}><span>KASIR TOKO360</span><h1>Masuk ke terminal kasir.</h1>{message && <p className="notice">{message}</p>}{offlineQueue.length > 0 && <p className="notice">Ada {offlineQueue.length} transaksi offline tersimpan pada perangkat ini. Login dengan kasir asal untuk menyinkronkan.</p>}<label>Email<input type="email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></label><label>Password<input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label><label>Kode 2FA / recovery (jika aktif)<input value={login.twoFactorCode} onChange={(e) => setLogin({ ...login, twoFactorCode: e.target.value })} autoComplete="one-time-code" /></label><button>Masuk</button></form></main>;

  const activeQuote = apiOnline ? quote : offlineQuoteState.quote;
  const activeQuoteError = apiOnline ? quoteError : offlineQuoteState.error;
  const displaySubtotal = activeQuote?.subtotal ?? subtotalFallback;
  const displayTax = activeQuote?.tax ?? 0;
  // The offline/quote-less fallback must include the fee too, or the on-screen total is short by
  // exactly the amount the server will charge when the sale is finally posted.
  const displayTotal = activeQuote?.total ?? Math.max(0, subtotalFallback - discount) + serviceFee;
  const currentCashierSub = jwtSubject(token);
  const ownedOfflineQueue = offlineQueue.filter((item) => item.cashierSub === currentCashierSub);
  const foreignOfflineCount = offlineQueue.length - ownedOfflineQueue.length;
  const hasOfflineConflict = ownedOfflineQueue.some((item) => item.status === 'CONFLICT');
  const ownedHeldSales = heldSales.filter((item) => item.cashierSub === currentCashierSub);
  const selectedTender = tenderMethods.find((item) => item.code === paymentMethod);
  const normalizedOnAccountDisplay = Math.min(Math.max(0, Number(onAccountAmount) || 0), Number(displayTotal));
  const tenderTarget = Math.max(0, Number(displayTotal) - normalizedOnAccountDisplay);
  const splitTotal = splitPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const splitReady = !splitEnabled || Math.abs(splitTotal - tenderTarget) < 0.01;
  const selectedReturnSale = recentSales.find((sale) => sale.id === returnSaleId);
  const pendingSaleReturns = saleReturns.filter((item) => ['REQUESTED','APPROVED'].includes(item.status));

  return <PosShell
    workspace={workspace}
    onWorkspaceChange={setWorkspace}
    apiOnline={apiOnline}
    queueCount={ownedOfflineQueue.length}
    conflictCount={pendingSaleReturns.length}
    companyName={manifest?.company?.name ?? 'Toko360'}
    branchName={manifest?.branch?.name ?? manifest?.branch?.code ?? 'Cabang aktif'}
    warehouseControl={<><label>Gudang/toko<select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setCart([]); }}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>{ownedOfflineQueue.length > 0 && <button className="syncButton" disabled={!apiOnline || syncBusy} onClick={() => void syncOfflineQueue(token, hasOfflineConflict)}><RefreshCw size={14} className={syncBusy ? 'spin' : ''} /> {syncBusy ? 'SYNC...' : 'SYNC'}</button>}<button className="logout" onClick={() => void logout()}>Keluar</button></>}
  >
    <StaffMemoWidget token={token} />
    {message && <div className={`notice ${(message.includes('berhasil') || message.includes('tersimpan')) ? 'toastLike success' : 'toastLike error'}`}>{(message.includes('berhasil') || message.includes('tersimpan')) ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {message}</div>}
    {/* Receipt history. Without this, a customer who lost the slip minutes after paying has no way
        to get it again: the only receipt control was for the sale just completed, and it disappears
        on the next transaction. */}
    {recentSales.length > 0 && <section className="receiptHistory" aria-label="Riwayat struk">
      <h3>Struk transaksi</h3>
      <p className="panelNote">Cetak ulang struk yang hilang. Struk dibuka di tab baru agar keranjang tidak hilang.</p>
      <ul>
        {recentSales.slice(0, 10).map((sale) => (
          <li key={sale.id}>
            <span><strong>{sale.number}</strong><small>{new Date(sale.createdAt).toLocaleString('id-ID')} · {money(sale.total)}</small></span>
            <button type="button" className="secondary" onClick={() => reprintReceipt(sale.number)} disabled={receiptBusy === sale.number}>
              {receiptBusy === sale.number ? 'MEMBUKA…' : 'Cetak ulang'}
            </button><button type="button" className="secondary" onClick={() => rawBtReceipt(sale.number)}>RawBT 58mm</button>
          </li>
        ))}
      </ul>
    </section>}
    {lastReceipt && <section className="receiptReady" aria-label="Struk transaksi terakhir"><div><strong>Struk {lastReceipt.number} siap</strong><small>{money(lastReceipt.total)} · dapat dibuka, dicetak, atau dibagikan dari halaman struk digital.</small></div><div className="rowActions"><button type="button" className="secondary" onClick={() => window.open(`${API}/receipts/${encodeURIComponent(lastReceipt.number)}`, '_blank', 'noopener,noreferrer')}>BUKA STRUK DIGITAL</button><button type="button" className="secondary" onClick={() => rawBtReceipt(lastReceipt.number)}>RAWBT 58MM</button><button type="button" className="clear" onClick={() => setLastReceipt(null)}>TUTUP</button></div></section>}

    {workspace === 'SALE' && <>
    {ownedHeldSales.length > 0 && <section className="heldPanel"><strong>Transaksi Hold ({ownedHeldSales.length})</strong><div className="heldList">{ownedHeldSales.map((held) => <div key={held.id} className="heldItem"><div><b>{held.label}</b><small>{new Date(held.createdAt).toLocaleString('id-ID')} · {held.items.reduce((sum, item) => sum + item.quantity, 0)} item</small></div><button onClick={() => recallHeld(held.id)}>PANGGIL</button><button className="clear" onClick={() => deleteHeld(held.id)}>HAPUS</button></div>)}</div></section>}


    <div className="layout">
      <section className="catalog"><div className="searchWrap"><Search size={15} className="searchIcon" /><input className="search" placeholder="Cari nama, SKU, atau scan barcode..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scanExactBarcode(search); } }} autoFocus /></div>
        <div className="chips">{categories.slice(0, 8).map((cat) => <button key={cat} className={cat === category ? 'chip active' : 'chip'} onClick={() => setCategory(cat)}>{cat}</button>)}</div>
        <div className="products">
          {!catalogReady && <div className="emptyState"><div className="emptyIcon"><PackageSearch size={28} strokeWidth={1.6} /></div><h4>Memuat katalog…</h4><p>Menyiapkan produk dan stok terminal.</p></div>}
          {catalogReady && !products.length && <div className="emptyState"><div className="emptyIcon"><PackageSearch size={28} strokeWidth={1.6} /></div><h4>Katalog belum tersedia</h4><p>Belum ada produk aktif untuk terminal ini atau data gagal dimuat.</p></div>}
          {products.length > 0 && !visibleProducts.length && <div className="emptyState"><div className="emptyIcon"><PackageSearch size={28} strokeWidth={1.6} /></div><h4>Tidak ada produk cocok</h4><p>Coba kata kunci lain atau ganti kategori.</p></div>}
          {(catalogHasMore || serverSearchBusy) && <div className="catalogFooter" role="status">{serverSearchBusy ? 'Mencari di server…' : `Menampilkan ${products.length} produk. Katalog belum lengkap.`}{catalogHasMore && <button type="button" className="secondary" onClick={() => void loadMoreCatalog()} disabled={catalogLoadingMore}>{catalogLoadingMore ? 'MEMUAT…' : 'Muat lagi katalog'}</button>}</div>}
          {visibleProducts.map((product) => { const variants = activeVariants(product); const variant = shownVariant(product, variantChoice[product.id]); const units = variantUnits(product, variant); return <div className="product" key={product.id}><button className="productMain" onClick={() => add(product, 1, variant ? { variantId: variant.id } : undefined)} disabled={available(product) <= 0}><div className="productIcon" aria-hidden="true"><Package size={24} strokeWidth={1.7} /></div><strong>{product.name}</strong><small>{product.sku} · stok {available(product)} {product.unit}</small><span>{money(variantPrice(product, variant))}</span></button>{variants.length > 1 && <label className="variantPick"><span className="srOnly">Jenis {product.name}</span><select aria-label={`Jenis ${product.name}`} value={variant?.id ?? ''} onChange={(event) => setVariantChoice((current) => ({ ...current, [product.id]: event.target.value }))}>{variants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{apiOnline && units.length > 0 && <div className="unitActions">{units.map((unit) => <button type="button" key={unit.id} onClick={() => add(product,1,{unitCode:unit.unitCode,quantityFactor:unit.quantityFactor,productUnitId:unit.id,variantId:(unit.variantId ?? variant?.id) ?? undefined})}>{unit.unitCode} × {unit.quantityFactor}</button>)}</div>}</div>; })}
        </div>
      </section>
      <aside className="cart"><div className="cartTitle"><div><span>TRANSAKSI</span><h2><ShoppingCart size={17} style={{verticalAlign:'-3px'}} /> Keranjang kasir</h2></div><div className="rowActions"><button className="clear" disabled={!cart.length} onClick={holdCart}>HOLD</button><button className="clear" onClick={() => setCart([])}><Trash2 size={14} /> Kosongkan</button></div></div>
        <div className="items">{!cart.length && <div className="emptyState"><div className="emptyIcon"><ScanBarcode size={26} strokeWidth={1.6} /></div><h4>Keranjang kosong</h4><p>Scan atau pilih produk untuk memulai transaksi.</p></div>}{cart.map((item) => { const key = cartLineKey(item); const serverLine = activeQuote?.items?.find((line) => line.productId === item.product.id && (line.barcodeCode ?? undefined) === item.barcodeCode && (line.variantId ?? undefined) === item.variantId); const linePrice = Number(serverLine?.sellingUnitPrice ?? cartItemUnitPrice(item) * item.quantityFactor); const cartVariant = item.variantId ? shownVariant(item.product, item.variantId) : undefined; return <div className="item" key={key}><div><strong>{item.product.name}{cartVariant && <span className="variantTag"> · {cartVariant.name}</span>}</strong><small>{item.quantityFactor > 1 ? `${item.unitCode} · 1 = ${item.quantityFactor} ${item.product.unit}` : item.unitCode} · {money(linePrice)}</small><button type="button" className="linkButton" onClick={() => void openCollectFor(item.product.id, item.product.name, item.quantity)}>Ambil di cabang lain</button></div><div className="qty"><button aria-label="Kurangi" onClick={() => change(key, item.quantity - 1)}><Minus size={13} /></button><span>{item.quantity}</span><button aria-label="Tambah" onClick={() => change(key, item.quantity + 1)}><Plus size={13} /></button></div><strong>{money(linePrice * item.quantity)}</strong></div>; })}</div>
        <div className="summary"><div><span><UserRound size={13} style={{verticalAlign:'-2px'}} /> Pelanggan</span><select value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Tanpa pelanggan</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}</select></div>
          {customerWarning && <small className="fieldWarning">{customerWarning}</small>}
          {customerId && loyaltyPoints > 0 && <label className="redeem"><Coins size={13} style={{verticalAlign:'-2px'}} /> Tukar poin (saldo {loyaltyPoints})<input type="number" min={0} max={loyaltyPoints} value={redeemPoints} disabled={!apiOnline} onChange={(e) => setRedeemPoints(Math.min(loyaltyPoints, Math.max(0, Math.floor(Number(e.target.value) || 0))))} /></label>}
          <div><span>Subtotal</span><strong>{money(displaySubtotal)}</strong></div>
          <label>Diskon manual<input type="number" min="0" max={subtotalFallback} value={discount} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))} /></label>
          {/* Service fee is entered by the cashier (MDR card, QRIS, delivery) rather than derived,
              because the rate is agreed per merchant and changes too often to hardcode. The server
              caps it at the basket total and posts it to a service-income account, not sales. */}
          <label>Biaya layanan<input type="number" min="0" max={subtotalFallback} disabled={!apiOnline} value={serviceFee} onChange={(e) => setServiceFee(Math.max(0, Number(e.target.value) || 0))} /></label>
          {/* Warn BEFORE the cashier presses pay. The server is still the authority — this exists so
              the failure is not a surprise at the moment of payment. */}
          {discountNeedApproval && <div className="approvalHint" role="status">{supervisor.unavailable ? 'Diskon di atas 20% tidak dapat disetujui: belum ada supervisor terdaftar di cabang ini.' : <><span>Diskon di atas 20% memerlukan persetujuan supervisor.</span> <button type="button" className="linkButton" onClick={() => supervisor.open('SALE_LINE_DISCOUNT', `Diskon manual ${money(discount)} dari ${money(subtotalFallback)}`)}>Minta persetujuan</button></>}</div>}
          <label>Kode promo<input value={promoCode} disabled={!apiOnline} maxLength={64} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Kode promo" /></label>
          {Number(activeQuote?.promoDiscount ?? 0) > 0 && <div><span>Promo {activeQuote?.appliedPromo?.code ?? ''}</span><strong>-{money(activeQuote!.promoDiscount!)}</strong></div>}
          <div><span>Pajak (aturan server)</span><strong>{quoteLoading && apiOnline ? 'Menghitung…' : money(displayTax)}</strong></div>
          {Number(activeQuote?.loyaltyDiscount ?? 0) > 0 && <div><span>Diskon poin</span><strong>-{money(activeQuote!.loyaltyDiscount)}</strong></div>}
          {activeQuoteError && <p className="quoteError">{activeQuoteError}</p>}
          {serviceFee > 0 && <div><span>Biaya layanan</span><strong>{money(serviceFee)}</strong></div>}
          <div className="grand"><span>TOTAL</span><strong style={{ fontSize: 22 }}>{money(displayTotal)}</strong></div>
          <div className="paymentModeHeader"><strong><CreditCard size={13} style={{verticalAlign:'-2px'}} /> Pembayaran</strong><button type="button" className="clear" disabled={!apiOnline || tenderTarget <= 0} onClick={() => { const next = !splitEnabled; setSplitEnabled(next); if (next) setSplitPayments([{ method: tenderMethods[0]?.code ?? '', amount: tenderTarget }, { method: tenderMethods[1]?.code ?? tenderMethods[0]?.code ?? '', amount: 0 }]); }}>{splitEnabled ? 'SATU METODE' : 'SPLIT PAYMENT'}</button></div>
          <label>Piutang pelanggan{!apiOnline ? ' · hanya online' : ''}<input type="number" min="0" max={Number(displayTotal)} disabled={!apiOnline || !customerId} value={onAccountAmount} onChange={(e) => setOnAccountAmount(Math.min(Number(displayTotal), Math.max(0, Number(e.target.value) || 0)))} /></label>
          {onAccountAmount > 0 && !customerId && <small className="fieldWarning">Pilih pelanggan untuk menggunakan piutang.</small>}
          {tenderTarget > 0 && (!splitEnabled ? <><label>Metode pembayaran{!apiOnline ? ' · sesuai kebijakan offline server' : ''}<select value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); setPaymentProvider(''); setPaymentReference(''); }}>{tenderMethods.map((item) => <option key={item.code} value={item.code} disabled={!apiOnline && !item.allowOffline}>{item.name} · {item.code}{!apiOnline && !item.allowOffline ? ' (online)' : ''}</option>)}</select></label>{selectedTender?.requiresProvider&&<label>Provider<input required value={paymentProvider} onChange={(e) => setPaymentProvider(e.target.value)} placeholder="Provider pembayaran" /></label>}{selectedTender?.requiresReference&&<label>Referensi eksternal<input required value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Nomor/reference provider" /></label>}{selectedTender&&<small>{selectedTender.kind==='CASH'?'Kas fisik':selectedTender.settlementBehavior==='CLEARING'?'Masuk akun clearing':'Settlement langsung'} · akun {selectedTender.settlementAccountCode}{selectedTender.feeRatePercent>0?` · fee ${selectedTender.feeRatePercent}%`:''}</small>}</>
            : <div className="splitPayments">{splitPayments.map((entry, index) => { const tender=tenderMethods.find((item)=>item.code===entry.method); return <div className="splitRow" key={`${index}-${entry.method}`}><select value={entry.method} onChange={(e) => setSplitPayments((current) => current.map((item, i) => i === index ? { method: e.target.value, amount:item.amount } : item))}>{tenderMethods.map((item)=><option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select><input type="number" min="0" value={entry.amount} onChange={(e) => setSplitPayments((current) => current.map((item, i) => i === index ? { ...item, amount: Math.max(0, Number(e.target.value) || 0) } : item))} />{tender?.requiresProvider&&<input value={entry.provider??''} onChange={(e)=>setSplitPayments((current)=>current.map((item,i)=>i===index?{...item,provider:e.target.value}:item))} placeholder="Provider"/>}{tender?.requiresReference&&<input value={entry.externalRef??''} onChange={(e)=>setSplitPayments((current)=>current.map((item,i)=>i===index?{...item,externalRef:e.target.value}:item))} placeholder="Referensi"/>}{splitPayments.length > 2 && <button className="clear iconOnly" aria-label="Hapus metode pembayaran" onClick={() => setSplitPayments((current) => current.filter((_, i) => i !== index))}><X size={16} /></button>}</div>;})}<button className="clear inlineIcon" onClick={() => setSplitPayments((current) => [...current, { method: tenderMethods[0]?.code ?? '', amount: 0 }])}><Plus size={15} />Metode</button><small className={splitReady ? '' : 'fieldWarning'}>Tender {money(splitTotal)} dari {money(tenderTarget)}{normalizedOnAccountDisplay>0?` · piutang ${money(normalizedOnAccountDisplay)}`:''}{splitReady ? '' : ' · harus sama persis'}</small></div>)}
          {tenderTarget <= 0 && <small>Seluruh total dicatat sebagai piutang pelanggan; tidak ada tender yang dibebankan sekarang.</small>}
          <button className="pay" disabled={!cart.length || !warehouseId || !shift || !activeQuote || quoteLoading || !!activeQuoteError || paying || !splitReady} onClick={pay}>{paying ? 'MEMPROSES...' : shift ? (apiOnline ? 'BAYAR' : 'SIMPAN TRANSAKSI OFFLINE') : 'BUKA SHIFT DULU'}</button>
        </div>
      </aside>
    </div>

    </>}
    {workspace === 'SHIFT' && <>
    <section className="shiftPanel">
      <div className="shiftIdentity"><Store size={18} /><div><strong>{shift ? 'Shift kasir aktif' : 'Shift belum dibuka'}</strong><small>{shift ? `Dibuka ${new Date(shift.openedAt).toLocaleString('id-ID')} · kas awal ${money(shift.openingCash)}` : 'Buka shift sebelum menerima transaksi.'}</small></div></div>
      {shift ? <div className="shiftActions"><label>Kas fisik saat tutup<input type="number" min="0" value={closingCash} onChange={(e) => setClosingCash(Math.max(0, Number(e.target.value) || 0))} /></label><button className="shiftClose" disabled={shiftBusy || cart.length > 0 || paying || !apiOnline || ownedOfflineQueue.length > 0} onClick={closeShift}>{shiftBusy ? 'MEMPROSES...' : 'TUTUP SHIFT'}</button></div>
        : <div className="shiftActions"><label>Kas awal<input type="number" min="0" value={openingCash} onChange={(e) => setOpeningCash(Math.max(0, Number(e.target.value) || 0))} /></label><button disabled={shiftBusy} onClick={openShift}>{shiftBusy ? 'MEMPROSES...' : 'BUKA SHIFT'}</button></div>}
      {shift && <div className="cashMovementBar"><label>Nominal kas<input type="number" min="0" value={cashMovementAmount} onChange={(e) => setCashMovementAmount(Math.max(0, Number(e.target.value) || 0))} /></label><label>Alasan<input value={cashMovementReason} maxLength={240} onChange={(e) => setCashMovementReason(e.target.value)} placeholder="Contoh: uang kecil / biaya parkir" /></label><button disabled={cashMovementBusy || cashMovementAmount <= 0 || !cashMovementReason.trim() || !apiOnline} onClick={() => void recordCashMovement('CASH_IN')}>KAS MASUK</button><button className="shiftClose" disabled={cashMovementBusy || cashMovementAmount <= 0 || !cashMovementReason.trim() || !apiOnline} onClick={() => void recordCashMovement('CASH_OUT')}>KAS KELUAR</button></div>}
    </section>
    <section className="shiftControlGrid">
      <article className="shiftPanel">
        <div className="cartTitle"><div><small>SHIFT RECAP</small><h2>{shiftRecap ? `${shiftRecap.shift.cashier} · ${shiftRecap.shift.status}` : 'Ringkasan shift'}</h2></div><button type="button" className="clear" disabled={!apiOnline || shiftControlLoading} onClick={() => void loadShiftControl()}>{shiftControlLoading ? 'MEMUAT…' : 'REFRESH'}</button></div>
        {shiftRecap ? <div className="shiftRecapGrid"><div><span>Penjualan</span><strong>{money(shiftRecap.sales.total)}</strong><small>{shiftRecap.sales.count} transaksi</small></div><div><span>Expected cash</span><strong>{money(shiftRecap.expectedCash ?? 0)}</strong><small>Opening {money(shiftRecap.openingCash)}</small></div><div><span>Kas masuk / keluar</span><strong>{money(shiftRecap.cashMovements.cashIn)} / {money(shiftRecap.cashMovements.cashOut)}</strong><small>Refund tunai {money(shiftRecap.refunds.cashTotal)}</small></div><div><span>Selisih</span><strong>{shiftRecap.difference == null ? '-' : money(shiftRecap.difference)}</strong><small>{(shiftRecap.paymentBreakdown?.length ? shiftRecap.paymentBreakdown.map((item) => `${item.methodName} ${money(item.grossAmount)} → ${item.settlementAccountCode}/${item.settlementBehavior}${item.feeAmount > 0 ? ` · MDR ${money(item.feeAmount)}` : ''}`).join(' · ') : Object.entries(shiftRecap.payments).map(([method,total]) => `${method} ${money(total)}`).join(' · ')) || 'Belum ada pembayaran'}</small></div></div> : <div className="syncEmpty"><Store size={20}/><span>Belum ada recap shift yang dapat ditampilkan.</span></div>}
      </article>
      <article className="shiftPanel">
        <div className="cartTitle"><div><small>CASH MOVEMENT</small><h2>Kas masuk / keluar shift aktif</h2></div><span>{cashMovements.length} movement</span></div>
        <div className="cashMovementList">{cashMovements.length ? cashMovements.map((movement) => <div key={movement.id} className="heldItem"><div><strong>{movement.type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'}</strong><small>{movement.reason} · {new Date(movement.createdAt).toLocaleString('id-ID')}</small></div><strong>{movement.type === 'CASH_IN' ? '+' : '-'}{money(movement.amount)}</strong></div>) : <div className="syncEmpty"><WalletCards size={20}/><span>Belum ada cash movement pada shift aktif.</span></div>}</div>
      </article>
    </section>

    </>}
    {workspace === 'RETURNS' && <>
    <details className="returnPanel">
      <summary>RETUR / REFUND PENJUALAN {pendingSaleReturns.length ? `· ${pendingSaleReturns.length} menunggu proses` : ''}</summary>
      {!apiOnline ? <small>Retur hanya tersedia saat server online.</small> : <div className="returnWorkspace">
        <label>Transaksi asal<select value={returnSaleId} onChange={(e) => { setReturnSaleId(e.target.value); setReturnQty({}); }}><option value="">Pilih transaksi terbaru</option>{recentSales.map((sale) => <option key={sale.id} value={sale.id}>{sale.number} · {new Date(sale.createdAt).toLocaleString('id-ID')} · {money(sale.total)}</option>)}</select></label>
        {selectedReturnSale && <div className="returnItems">{selectedReturnSale.items.map((item) => <label key={item.id}>{item.product.name} · dibeli {item.quantity}<input type="number" min="0" max={item.quantity} value={returnQty[item.id] ?? 0} onChange={(e) => setReturnQty((current) => ({ ...current, [item.id]: Math.min(item.quantity, Math.max(0, Math.floor(Number(e.target.value) || 0))) }))} /></label>)}</div>}
        <label>Alasan retur<input value={returnReason} maxLength={240} onChange={(e) => setReturnReason(e.target.value)} placeholder="Contoh: barang rusak / salah item" /></label>
        <label>Metode refund<select value={returnRefundMethod} onChange={(e) => setReturnRefundMethod(e.target.value)}><option value="ORIGINAL">Ikuti tender/piutang asal</option><option value="RECEIVABLE">Kurangi piutang</option>{tenderMethods.filter((item)=>item.refundBehavior!=='DISABLED').map((item)=><option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select></label>
        <button disabled={returnBusy || !returnSaleId || !returnReason.trim()} onClick={() => void submitSaleReturn()}>{returnBusy ? 'MEMPROSES...' : 'AJUKAN RETUR'}</button>
        {saleReturns.slice(0, 5).map((row) => <small key={row.id}>{row.number} · {money(row.refundAmount)} · {row.status}</small>)}
      </div>}
    </details>


    </>}
    {workspace === 'SYNC' && <>
    {offlineQueue.length > 0 && <section className={`offlinePanel ${hasOfflineConflict ? 'conflict' : ''}`}><div><AlertTriangle size={17} /><div><strong>{hasOfflineConflict ? 'Konflik sinkronisasi harus diselesaikan' : ownedOfflineQueue.length ? `${ownedOfflineQueue.length} transaksi kasir ini menunggu sinkronisasi` : `${foreignOfflineCount} transaksi offline milik kasir lain tersimpan`}</strong><small>{hasOfflineConflict ? ownedOfflineQueue.find((item) => item.status === 'CONFLICT')?.error : ownedOfflineQueue.length ? 'Stok lokal sudah direservasi. Data tidak akan dikirim dua kali.' : 'Login dengan kasir asal untuk menyinkronkan antrean tersebut.'}</small></div></div>{ownedOfflineQueue.length > 0 && <button disabled={!apiOnline || syncBusy} onClick={() => void syncOfflineQueue(token, hasOfflineConflict)}>{syncBusy ? 'MEMPROSES...' : hasOfflineConflict ? 'COBA ULANG KONFLIK' : 'SINKRONKAN SEKARANG'}</button>}</section>}


      {offlineQueue.length === 0 && <section className="syncEmpty"><CheckCircle2 size={22} /><div><strong>Tidak ada antrean sinkronisasi</strong><small>Semua transaksi perangkat sudah konsisten dengan server.</small></div></section>}
    </>}
    {pendingHeldRecall && <ModalPortal labelledBy="held-recall-title" onClose={() => setPendingHeldRecall(null)}>
      <div className="modalCard">
        <span className="modalKicker">TRANSAKSI HOLD</span>
        <h2 id="held-recall-title">Ganti keranjang aktif?</h2>
        <p>Keranjang sekarang akan diganti oleh transaksi hold yang dipilih. Transaksi aktif belum disimpan.</p>
        <div className="modalActions"><button type="button" className="clear" onClick={() => setPendingHeldRecall(null)}>Kembali</button><button type="button" onClick={confirmHeldRecall}>Panggil transaksi hold</button></div>
      </div>
    </ModalPortal>}
    {collectFor && <ModalPortal labelledBy="collect-title" onClose={() => setCollectFor(null)}>
      <div className="modalCard">
        <span className="modalKicker">CLICK &amp; COLLECT</span>
        <h2 id="collect-title">Ambil di cabang lain</h2>
        <p>{collectFor.name} · {collectFor.quantity} item. Barang tidak dipindahkan dari stok cabang ini.</p>
        {pickupQuote ? (
          <>
            <pre className="voucherBox">{pickupVoucherLines(pickupQuote, manifest?.branch?.name ?? 'Cabang ini').join('\n')}</pre>
            <div className="modalActions">
              <button type="button" onClick={() => window.print()}>Cetak voucher</button>
              <button type="button" className="clear" onClick={() => setCollectFor(null)}>Selesai</button>
            </div>
          </>
        ) : (
          <>
            <ul className="branchStockList">
              {branchStock.map((row) => <li key={row.branchId}>
                <span><strong>{row.branchName}</strong><small>{row.isCurrent ? 'Cabang ini' : `${row.available} tersedia`}</small></span>
                {!row.isCurrent && row.available >= collectFor.quantity
                  ? <button type="button" className="secondary" onClick={() => setPickupBranch(row.branchCode)}>{pickupBranch === row.branchCode ? 'Dipilih' : 'Pilih'}</button>
                  : !row.isCurrent && <span className="muted">stok tidak cukup</span>}
              </li>)}
            </ul>
            {pickupBranch && <>
              <label>Nama pelanggan<input value={pickupCustomer} onChange={(e) => setPickupCustomer(e.target.value)} maxLength={100} /></label>
              <label>Telepon (opsional)<input value={pickupPhone} onChange={(e) => setPickupPhone(e.target.value)} maxLength={30} inputMode="tel" /></label>
            </>}
            {pickupError && <p className="formError" role="alert">{pickupError}</p>}
            {planPickup(branchStock, collectFor.quantity).reason && !pickupError && <p className="muted">{planPickup(branchStock, collectFor.quantity).reason}</p>}
            <div className="modalActions">
              <button type="button" className="clear" onClick={() => setCollectFor(null)} disabled={pickupBusy}>Batal</button>
              <button type="button" onClick={() => void submitPickup()} disabled={pickupBusy || !pickupBranch || !pickupCustomer.trim()}>{pickupBusy ? 'MEMBUAT…' : 'Buat voucher'}</button>
            </div>
          </>
        )}
      </div>
    </ModalPortal>}
    {supervisor.pending && <SupervisorPinDialog gate={supervisor} />}
  </PosShell>;
}

/**
 * Supervisor PIN prompt.
 *
 * Rendered only while an approval is pending, so the normal selling path never shows it. The PIN
 * goes straight to the API and is never held here — this component receives a grant id back, not a
 * PIN, and clears itself once the grant is spent.
 */
function SupervisorPinDialog({ gate }: { gate: ReturnType<typeof useSupervisorApproval> }) {
  const [pin, setPin] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useModalFocus(true);
  useEscapeToClose(() => gate.cancel());
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <ModalPortal labelledBy="supervisor-pin-title" onClose={() => gate.cancel()}>
      <div className="modalCard">
        <span className="modalKicker">PERSETUJUAN SUPERVISOR</span>
        <h2 id="supervisor-pin-title">Masukkan PIN supervisor</h2>
        <p>{gate.pending?.reason}</p>
        <label>PIN supervisor
          <input ref={inputRef} type="password" inputMode="numeric" autoComplete="off" maxLength={8}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !gate.busy) { e.preventDefault(); void gate.submit(pin).then((r) => { if (r) setPin(''); }); } }} />
        </label>
        {gate.error && <p className="formError" role="alert">{gate.error}</p>}
        <div className="modalActions">
          <button type="button" className="clear" onClick={() => { setPin(''); gate.cancel(); }} disabled={gate.busy}>Batal</button>
          <button type="button" onClick={() => { void gate.submit(pin).then((r) => { if (r) setPin(''); }); }} disabled={gate.busy || pin.length < 4}>
            {gate.busy ? 'MEMERIKSA…' : 'Setujui'}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
