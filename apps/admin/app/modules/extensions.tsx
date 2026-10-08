'use client';
import { authFetch } from '../auth-fetch';
// Loyalty/devices/notifications dan storefront fulfillment.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { usePermissions } from '../permissions';
import { Panel, Table, StatusChip, TableSkeleton, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type LoyaltyProgram = { id: string; name: string; isActive?: boolean; pointsPerAmount?: number | string };
type LoyaltyCustomer = { id: string; name: string; phone?: string | null };
type LoyaltyAccount = { program: { id: string; earnRate?: number | string; redemptionRate?: number | string; minimumRedeem?: number } | null; points: number };
type LoyaltyTier = { tier: string; discountPct: number };
type DigestPreview = { text: string; summary: { revenue: number; grossProfit: number; transactions: number; pendingOrders: number; lowStockCount: number } };
type Device = { id: string; code: string; name: string; platform?: string; appVersion?: string | null; lastSeenAt?: string | null; isActive?: boolean };
type NotificationTemplate = { id: string; code: string; channel: string; subject?: string | null; body: string; variables?: string[] | null; isActive?: boolean };
type DeviceCredentialResult = { deviceId: string; keyId: string; secret: string; expiresAt?: string | null; note?: string };
type Notification = { id: string; channel: string; templateCode?: string; recipient: string; status: string; provider?: string | null; attempts: number; scheduledAt?: string; sentAt?: string | null; lastError?: string | null; createdAt: string };
type NotificationProvider = { id: string; type: string; provider: string; name: string; status: string; config?: Record<string, unknown> | null; hasSecrets?: boolean; branchId?: string | null; lastHealthCheckAt?: string | null; lastError?: string | null };
type DigestRecipient = { id: string; employeeId: string; externalUserId: string | null; verifiedAt: string | null; isPrimary: boolean; employeeNumber: string | null; employeeName: string };
type DailyDigestConfig = { enabled: boolean; hour: number; recipientBindingIds: string[]; availableRecipients: DigestRecipient[] };
type Shipment = { id: string; number: string; orderId?: string | null; status?: string; createdAt: string };
type StoreOrder = { id: string; number: string; status: string; customerName: string; total: string | number; fulfillmentType?: 'DELIVERY'|'PICKUP'|string; shippingMethodCode?: string|null; shippingMethodName?: string|null; payments: Array<{ method: string; status: string }> };
type PromoRule = { id:string; code:string; name:string; type:string; value:string|number; channel:string; memberTier?:string|null; minQuantity?:number|null; buyQuantity?:number|null; getQuantity?:number|null; usageLimit?:number|null; perCustomerLimit?:number|null; isActive:boolean; startsAt:string; endsAt?:string|null };
type PromoPreview = { subtotal:number; discount:number; appliedRule:{ id:string; code:string; name:string; type:string }|null; note?:string|null };
type Product = { id:string; sku:string; name:string };
type ProductPage = { items: Product[] };
type CursorResponse<T> = T[] | { items?: T[] };
type DialogState = { kind: 'confirm-payment' | 'cancel'; order: StoreOrder } | null;

async function readJson<T>(url: string, token: string): Promise<T> {
  const response = await authFetch(url, token);
  const data = await response.json();
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Gagal memuat data.');
  return data as T;
}

async function writeJson<T>(url: string, token: string, method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<T> {
  const response = await authFetch(url, token, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Operasi gagal.');
  return data as T;
}

function rows<T>(value: CursorResponse<T>): T[] { return Array.isArray(value) ? value : value.items ?? []; }

export default function ExtensionsView({ token, mode = 'extensions', commerceSection = 'orders' }: { token: string; mode?: 'extensions' | 'commerce' | 'loyalty' | 'devices' | 'notifications' | 'integrations' | 'providers' | 'connections'; commerceSection?: 'orders' | 'fulfillment' | 'channels' }) {
  // D-3: extensions.controller.ts, daily-digest.controller.ts and promotions.controller.ts each
  // gate their writes on a distinct permission (integration.manage, notification.manage,
  // loyalty.manage, promotion.manage). Rendering every control for every operator produced
  // buttons that could only 403.
  const { canAll, identity } = usePermissions(token);
  const hasAnyRole = (...roles: string[]) => Boolean(identity?.roles.some((role) => roles.includes(role)));
  const canManageLoyaltyPrograms = hasAnyRole('SUPER_ADMIN', 'OWNER', 'ADMIN') && canAll('loyalty.manage');
  const canManageIntegrations = hasAnyRole('SUPER_ADMIN', 'OWNER', 'ADMIN') && canAll('integration.manage');
  const canManageNotificationLifecycle = hasAnyRole('SUPER_ADMIN', 'OWNER', 'ADMIN') && canAll('notification.manage');
  const canQueueNotifications = canAll('notification.manage');
  const canManagePromotions = hasAnyRole('SUPER_ADMIN', 'OWNER', 'ADMIN') && canAll('promotion.manage');
  const canManagePayments = hasAnyRole('SUPER_ADMIN', 'OWNER', 'ADMIN', 'FINANCE') && canAll('payment.manage');
  const canManageShipments = hasAnyRole('SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE') && canAll('shipment.manage');
  const canCancelOrders = hasAnyRole('SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE') && canAll('order.cancel');
  const [programs, setPrograms] = useState<LoyaltyProgram[]>([]);
  const [loyaltyCustomers, setLoyaltyCustomers] = useState<LoyaltyCustomer[]>([]);
  const [loyaltyCustomerId, setLoyaltyCustomerId] = useState('');
  const [loyaltyAccount, setLoyaltyAccount] = useState<LoyaltyAccount | null>(null);
  const [loyaltyTier, setLoyaltyTier] = useState<LoyaltyTier | null>(null);
  const [loyaltyForm, setLoyaltyForm] = useState({ programId: '', customerId: '', type: 'ADJUSTMENT', points: 0, notes: '' });
  const [devices, setDevices] = useState<Device[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [providers, setProviders] = useState<NotificationProvider[]>([]);
  const [digestConfig, setDigestConfig] = useState<DailyDigestConfig>({ enabled: false, hour: 21, recipientBindingIds: [], availableRecipients: [] });
  const [digestPreview, setDigestPreview] = useState<DigestPreview | null>(null);
  const [deviceForm, setDeviceForm] = useState({ code: '', name: '', platform: 'POS_WEB', appVersion: '' });
  const [credential, setCredential] = useState<DeviceCredentialResult | null>(null);
  // editingId lets the form distinguish create from update. The backend upserts on
  // (companyId, code, channel), so submitting an edited code+channel updates in place
  // instead of creating a duplicate row — but the operator needs to see which they are doing.
  const [editingTemplateId, setEditingTemplateId] = useState('');
  const [templateForm, setTemplateForm] = useState({ code: '', channel: 'EMAIL', subject: '', body: '', isActive: true });
  const [providerForm, setProviderForm] = useState({ channel: 'TELEGRAM', name: 'Telegram Utama', url: '', token: '' });
  const [notificationForm, setNotificationForm] = useState({ channel: 'EMAIL', recipient: '', templateCode: '', subject: '', body: '' });
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [promos, setPromos] = useState<PromoRule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promoForm, setPromoForm] = useState({ name:'', code:'', type:'PERCENT', value:10, channel:'ALL', productIds:[] as string[], minSubtotal:0, maxDiscount:'', memberTier:'', minQuantity:1, buyQuantity:1, getQuantity:1, usageLimit:'', perCustomerLimit:'', startsAt:new Date().toISOString().slice(0,10), endsAt:'' });
  const [promoPreviewForm, setPromoPreviewForm] = useState({ subtotal: 100000, code: '', memberTier: '' });
  const [promoPreview, setPromoPreview] = useState<PromoPreview | null>(null);
  const [carrier, setCarrier] = useState('MANUAL');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadCommerceSnapshot() {
    return Promise.all([
      readJson<CursorResponse<StoreOrder>>(`${API}/orders?limit=20`, token),
      readJson<CursorResponse<Shipment>>(`${API}/shipments?limit=15`, token),
      readJson<PromoRule[]>(`${API}/promotions?limit=100`, token),
      readJson<ProductPage>(`${API}/products?limit=200`, token),
    ]);
  }

  function applyCommerceSnapshot([od, sh, pm, pr]: Awaited<ReturnType<typeof loadCommerceSnapshot>>) {
    setOrders(rows(od));
    setShipments(rows(sh));
    setPromos(pm ?? []);
    setProducts(pr.items ?? []);
  }

  async function refreshCommerce() {
    applyCommerceSnapshot(await loadCommerceSnapshot());
  }

  async function loadExtensionSnapshot() {
    return Promise.all([
      readJson<CursorResponse<LoyaltyProgram>>(`${API}/loyalty/programs?limit=15`, token),
      readJson<LoyaltyCustomer[]>(`${API}/customers?limit=100`, token),
      readJson<CursorResponse<Device>>(`${API}/devices?limit=50`, token),
      readJson<CursorResponse<Notification>>(`${API}/notifications?limit=200`, token),
      readJson<NotificationTemplate[]>(`${API}/notifications/templates`, token),
      readJson<NotificationProvider[]>(`${API}/notifications/providers`, token),
      readJson<DailyDigestConfig>(`${API}/reports/daily-digest/config`, token),
    ]);
  }

  function applyExtensionSnapshot([lp, cu, dv, nt, tp, pv, dg]: Awaited<ReturnType<typeof loadExtensionSnapshot>>) {
    const loyaltyPrograms = rows(lp);
    setPrograms(loyaltyPrograms);
    setLoyaltyCustomers(cu ?? []);
    setDevices(rows(dv));
    setNotifications(rows(nt));
    setTemplates(tp ?? []);
    setProviders(pv ?? []);
    setDigestConfig(dg);
    setLoyaltyCustomerId((current) => current || cu?.[0]?.id || '');
    setLoyaltyForm((current) => ({
      ...current,
      programId: current.programId || loyaltyPrograms.find((program) => program.isActive !== false)?.id || loyaltyPrograms[0]?.id || '',
      customerId: current.customerId || cu?.[0]?.id || '',
    }));
  }

  async function refreshExtensions() {
    applyExtensionSnapshot(await loadExtensionSnapshot());
  }

  async function createLoyaltyProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    setBusy(true); setMessage('');
    try {
      // CreateLoyaltyProgramDto: name required; earnRate, redemptionRate, minimumRedeem and
      // pointsExpireDays optional and all numeric. The transaction form below picks its program
      // from this list, so with no way to create one the whole loyalty surface was unreachable.
      await writeJson(`${API}/loyalty/programs`, token, 'POST', {
        name: String(fd.get('name') ?? '').trim(),
        earnRate: fd.get('earnRate') ? Number(fd.get('earnRate')) : undefined,
        redemptionRate: fd.get('redemptionRate') ? Number(fd.get('redemptionRate')) : undefined,
        minimumRedeem: fd.get('minimumRedeem') ? Number(fd.get('minimumRedeem')) : undefined,
        pointsExpireDays: fd.get('pointsExpireDays') ? Number(fd.get('pointsExpireDays')) : undefined,
      });
      form.reset();
      await refreshExtensions();
      setMessage('Program loyalitas berhasil dibuat.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Program loyalitas gagal dibuat.'); }
    finally { setBusy(false); }
  }

  async function registerDevice() {
    setBusy(true); setMessage('');
    try {
      if (!deviceForm.code.trim() || !deviceForm.name.trim() || !deviceForm.platform.trim()) throw new Error('Kode, nama, dan platform device wajib diisi.');
      await writeJson(`${API}/devices`, token, 'POST', { ...deviceForm, code: deviceForm.code.trim(), name: deviceForm.name.trim(), platform: deviceForm.platform.trim(), appVersion: deviceForm.appVersion.trim() || undefined });
      setDeviceForm({ code: '', name: '', platform: 'POS_WEB', appVersion: '' });
      setMessage('Device berhasil didaftarkan. Rotasi credential sebelum node toko mulai sync.');
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Device gagal didaftarkan.'); } finally { setBusy(false); }
  }

  async function rotateCredential(device: Device) {
    setBusy(true); setMessage(''); setCredential(null);
    try {
      const result = await writeJson<DeviceCredentialResult>(`${API}/devices/${device.id}/credentials/rotate`, token, 'POST', {});
      setCredential(result);
      setMessage(`Credential ${device.code} berhasil dirotasi. Secret hanya ditampilkan sekali.`);
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Credential device gagal dirotasi.'); } finally { setBusy(false); }
  }

  async function setDeviceActive(device: Device, isActive: boolean) {
    setBusy(true); setMessage('');
    try {
      await writeJson(`${API}/devices/${device.id}/status`, token, 'PATCH', { isActive });
      setMessage(isActive ? `Device ${device.code} diaktifkan. Rotasi credential baru sebelum sync.` : `Device ${device.code} dinonaktifkan dan credential aktif dicabut.`);
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Status device gagal diubah.'); } finally { setBusy(false); }
  }

  async function saveTemplate() {
    setBusy(true); setMessage('');
    try {
      if (!templateForm.code.trim() || !templateForm.body.trim()) throw new Error('Kode dan body template wajib diisi.');
      const wasEditing = Boolean(editingTemplateId);
      await writeJson(`${API}/notifications/templates`, token, 'POST', { code: templateForm.code.trim(), channel: templateForm.channel, subject: templateForm.subject.trim() || undefined, body: templateForm.body, isActive: templateForm.isActive });
      setTemplateForm({ code: '', channel: 'EMAIL', subject: '', body: '', isActive: true });
      setEditingTemplateId('');
      setMessage(wasEditing ? 'Template notifikasi diperbarui.' : 'Template notifikasi tersimpan.');
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Template gagal disimpan.'); } finally { setBusy(false); }
  }

  async function saveNotificationProvider() {
    setBusy(true); setMessage('');
    try {
      const channel = providerForm.channel;
      if (!providerForm.name.trim()) throw new Error('Nama provider wajib diisi.');
      if (channel === 'WHATSAPP' && !providerForm.url.trim()) throw new Error('Endpoint WhatsApp wajib diisi.');
      if (!providerForm.token.trim()) throw new Error('Token provider wajib diisi dan hanya akan disimpan terenkripsi.');
      const config = channel === 'TELEGRAM'
        ? { channel: 'TELEGRAM', adapter: 'TELEGRAM_BOT' }
        : { channel: 'WHATSAPP', url: providerForm.url.trim(), method: 'POST', recipientField: 'to', bodyField: 'text' };
      await writeJson(`${API}/platform/integrations`, token, 'POST', {
        type: 'NOTIFICATION', provider: channel, name: providerForm.name.trim(), config,
        encryptedSecrets: JSON.stringify({ token: providerForm.token.trim() }), capabilities: { channels: [channel] },
      });
      setProviderForm((current) => ({ ...current, token: '' }));
      setMessage(`Provider ${channel} tersimpan. Aktifkan status CONNECTED sebelum worker menggunakannya.`);
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Provider notifikasi gagal disimpan.'); } finally { setBusy(false); }
  }

  async function setProviderStatus(provider: NotificationProvider, status: 'CONNECTED' | 'DISABLED') {
    setBusy(true); setMessage('');
    try {
      await writeJson(`${API}/platform/integrations/${provider.id}`, token, 'PATCH', { status });
      setMessage(`Provider ${provider.name} ${status === 'CONNECTED' ? 'diaktifkan' : 'dinonaktifkan'}.`);
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Status provider gagal diubah.'); } finally { setBusy(false); }
  }

  async function notificationAction(notification: Notification, action: 'cancel' | 'replay') {
    setBusy(true); setMessage('');
    try {
      await writeJson(`${API}/platform/notifications/${notification.id}/${action}`, token, 'POST', {});
      setMessage(action === 'cancel' ? 'Notifikasi dibatalkan.' : 'Notifikasi dimasukkan kembali ke antrean.');
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Aksi notifikasi gagal.'); } finally { setBusy(false); }
  }

  function editTemplate(template: NotificationTemplate) {
    setEditingTemplateId(template.id);
    setTemplateForm({ code: template.code, channel: template.channel, subject: template.subject ?? '', body: template.body, isActive: template.isActive !== false });
  }

  function cancelTemplateEdit() {
    setEditingTemplateId('');
    setTemplateForm({ code: '', channel: 'EMAIL', subject: '', body: '', isActive: true });
  }

  async function queueNotification() {
    setBusy(true); setMessage('');
    try {
      if (!notificationForm.recipient.trim()) throw new Error('Penerima notifikasi wajib diisi.');
      if (!notificationForm.templateCode.trim() && !notificationForm.body.trim()) throw new Error('Pilih template atau isi body notifikasi.');
      await writeJson(`${API}/notifications`, token, 'POST', { channel: notificationForm.channel, recipient: notificationForm.recipient.trim(), templateCode: notificationForm.templateCode.trim() || undefined, subject: notificationForm.subject.trim() || undefined, body: notificationForm.body.trim() || undefined, data: {} });
      setNotificationForm((current) => ({ ...current, recipient: '', subject: '', body: '' }));
      setMessage('Notifikasi masuk antrean worker.');
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Notifikasi gagal diantrikan.'); } finally { setBusy(false); }
  }

  async function saveDigestConfig() {
    setBusy(true); setMessage('');
    try {
      await writeJson(`${API}/reports/daily-digest/config`, token, 'POST', {
        enabled: digestConfig.enabled,
        hour: digestConfig.hour,
        recipientBindingIds: digestConfig.recipientBindingIds,
      });
      setMessage('Konfigurasi owner daily digest tersimpan. Penerima hanya memakai binding Telegram terverifikasi.');
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Konfigurasi daily digest gagal disimpan.'); } finally { setBusy(false); }
  }

  async function loadLoyaltyCustomer(customerId = loyaltyCustomerId) {
    if (!customerId) { setLoyaltyAccount(null); setLoyaltyTier(null); return; }
    setBusy(true); setMessage('');
    try {
      const [account, tier] = await Promise.all([
        readJson<LoyaltyAccount>(`${API}/loyalty/accounts/${encodeURIComponent(customerId)}`, token),
        readJson<LoyaltyTier>(`${API}/loyalty/tier/${encodeURIComponent(customerId)}`, token),
      ]);
      setLoyaltyAccount(account); setLoyaltyTier(tier);
      setLoyaltyForm((current) => ({ ...current, customerId, programId: current.programId || account.program?.id || programs.find((program) => program.isActive !== false)?.id || '' }));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Loyalty customer gagal dimuat.'); }
    finally { setBusy(false); }
  }

  async function postLoyaltyTransaction() {
    setBusy(true); setMessage('');
    try {
      if (!loyaltyForm.programId || !loyaltyForm.customerId) throw new Error('Program dan pelanggan wajib dipilih.');
      const raw = Math.trunc(Number(loyaltyForm.points) || 0);
      if (!raw) throw new Error('Poin transaksi tidak boleh 0.');
      // Sign convention: EARN grants points, REDEEM/EXPIRE/REFUND consume them, and
      // ADJUSTMENT keeps the operator's sign. REFUND must NOT fall through to the
      // positive default — it claws back previously earned/redeemed points.
      const points = ['REDEEM','EXPIRE','REFUND'].includes(loyaltyForm.type) ? -Math.abs(raw) : loyaltyForm.type === 'ADJUSTMENT' ? raw : Math.abs(raw);
      await writeJson(`${API}/loyalty/transactions`, token, 'POST', { programId: loyaltyForm.programId, customerId: loyaltyForm.customerId, type: loyaltyForm.type, points, referenceType: 'ADMIN_MANUAL', notes: loyaltyForm.notes.trim() || undefined });
      setLoyaltyForm((current) => ({ ...current, points: 0, notes: '' }));
      await loadLoyaltyCustomer(loyaltyForm.customerId);
      setMessage('Transaksi loyalty tersimpan dan saldo pelanggan diperbarui.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Transaksi loyalty gagal.'); }
    finally { setBusy(false); }
  }

  async function previewDigest() {
    setBusy(true); setMessage('');
    try { setDigestPreview(await readJson<DigestPreview>(`${API}/reports/daily-digest/preview`, token)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Preview daily digest gagal dimuat.'); }
    finally { setBusy(false); }
  }

  async function sendDigestNow() {
    setBusy(true); setMessage('');
    try {
      const result = await writeJson<{ queued: number }>(`${API}/reports/daily-digest/send`, token, 'POST', {});
      setMessage(`Owner daily digest masuk antrean: ${result.queued} notifikasi.`);
      await refreshExtensions();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Owner daily digest gagal diantrikan.'); } finally { setBusy(false); }
  }

  async function savePromo() {
    setBusy(true); setMessage('');
    try {
      if (!promoForm.name.trim() || !promoForm.code.trim()) throw new Error('Nama dan kode promo wajib diisi.');
      const body: Record<string, unknown> = {
        name: promoForm.name.trim(), code: promoForm.code.trim().toUpperCase(), type: promoForm.type, value: Number(promoForm.value), channel: promoForm.channel,
        productIds: promoForm.productIds, minSubtotal: Number(promoForm.minSubtotal || 0), memberTier: promoForm.memberTier.trim() || undefined,
        startsAt: promoForm.startsAt, endsAt: promoForm.endsAt || undefined,
        maxDiscount: promoForm.maxDiscount === '' ? undefined : Number(promoForm.maxDiscount),
        usageLimit: promoForm.usageLimit === '' ? undefined : Number(promoForm.usageLimit),
        perCustomerLimit: promoForm.perCustomerLimit === '' ? undefined : Number(promoForm.perCustomerLimit),
      };
      if (['QUANTITY_BREAK','BUNDLE'].includes(promoForm.type)) body.minQuantity = Number(promoForm.minQuantity);
      if (promoForm.type === 'BOGO') { body.buyQuantity = Number(promoForm.buyQuantity); body.getQuantity = Number(promoForm.getQuantity); }
      await writeJson(`${API}/promotions`, token, 'POST', body);
      setPromoForm((current) => ({ ...current, name:'', code:'', productIds:[], memberTier:'', maxDiscount:'', usageLimit:'', perCustomerLimit:'' }));
      setMessage('Promo/voucher tersimpan. Rule akan divalidasi server saat POS atau Storefront checkout.');
      await refreshCommerce();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Promo gagal disimpan.'); } finally { setBusy(false); }
  }

  async function previewPromo() {
    setBusy(true); setMessage(''); setPromoPreview(null);
    try {
      const params = new URLSearchParams({ subtotal: String(Math.max(0, Number(promoPreviewForm.subtotal) || 0)) });
      if (promoPreviewForm.code.trim()) params.set('code', promoPreviewForm.code.trim().toUpperCase());
      if (promoPreviewForm.memberTier.trim()) params.set('memberTier', promoPreviewForm.memberTier.trim().toUpperCase());
      const result = await readJson<PromoPreview>(`${API}/promotions/preview?${params.toString()}`, token);
      setPromoPreview(result);
      setMessage(result.appliedRule ? `Promo ${result.appliedRule.code} tervalidasi server.` : 'Tidak ada promo yang berlaku untuk simulasi ini.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Preview promo gagal dimuat.'); } finally { setBusy(false); }
  }

  async function updatePromoStatus(promo: PromoRule, isActive: boolean) {
    setBusy(true);
    try {
      await writeJson(`${API}/promotions/${promo.id}`, token, 'PATCH', { isActive });
      setMessage(`${promo.code} ${isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
      const rows = await readJson<PromoRule[]>(`${API}/promotions?limit=100`, token);
      setPromos(rows ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Status promo gagal diperbarui.'); } finally { setBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage('');
    const task = mode === 'commerce'
      ? loadCommerceSnapshot().then((snapshot) => { if (!cancelled) applyCommerceSnapshot(snapshot); })
      : loadExtensionSnapshot().then((snapshot) => { if (!cancelled) applyExtensionSnapshot(snapshot); });
    task
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Data gagal dimuat.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, mode]);

  useEffect(() => {
    if ((mode === 'extensions' || mode === 'loyalty') && loyaltyCustomerId) void loadLoyaltyCustomer(loyaltyCustomerId);
  }, [loyaltyCustomerId, token, mode]);

  async function orderAction(order: StoreOrder, action: 'confirm-payment' | 'authorize-invoice' | 'pack' | 'ship' | 'deliver' | 'cancel', operatorInput?: string) {
    setMessage('');
    setBusy(true);
    try {
      let body: Record<string, unknown> | undefined;
      if (action === 'confirm-payment') {
        const method = order.payments[0]?.method;
        if (!['QRIS', 'TRANSFER', 'CARD'].includes(method)) throw new Error('Order bukan pembayaran elektronik yang menunggu konfirmasi.');
        const externalRef = operatorInput?.trim();
        if (!externalRef) throw new Error('Referensi provider/bank wajib diisi.');
        body = { paymentMethod: method, provider: 'backoffice', externalRef };
      } else if (action === 'ship') {
        if (order.fulfillmentType === 'PICKUP') {
          body = {};
        } else {
          if (!carrier.trim() || !trackingNumber.trim()) throw new Error('Isi carrier dan nomor resi sebelum mengirim delivery.');
          body = { carrier: carrier.trim(), trackingNumber: trackingNumber.trim(), ownFleet: false };
        }
      } else if (action === 'cancel') {
        const reason = operatorInput?.trim();
        if (!reason) throw new Error('Alasan pembatalan wajib diisi.');
        body = { reason };
      }
      const response = await authFetch(`${API}/orders/${order.id}/${action}`, token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Aksi fulfillment gagal.');
      setMessage(`Order ${order.number}: ${action} berhasil.`);
      setDialog(null); setDialogValue('');
      await refreshCommerce();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Aksi fulfillment gagal.'); }
    finally { setBusy(false); }
  }

  const extensionMode = mode !== 'commerce';
  const showLoyalty = mode === 'extensions' || mode === 'loyalty';
  const showDevices = mode === 'extensions' || mode === 'devices';
  const showNotifications = mode === 'extensions' || mode === 'notifications';
  const showProviders = mode === 'extensions' || mode === 'integrations' || mode === 'providers' || mode === 'connections';

  if (loading) return <TableSkeleton rows={4} />;

  return (
    <>
      {extensionMode && <>
        {(showLoyalty || showDevices) && <section className="grid2">
          {showLoyalty && <Panel eyebrow="LOYALTY" title="Program, tier & transaksi poin" badge={`${programs.length} program`}>
            <Table head={['Nama', 'Poin', 'Status']} rows={programs.map((p) => [<strong>{p.name}</strong>, p.pointsPerAmount != null ? `${p.pointsPerAmount} / Rp` : '-', <StatusChip status={p.isActive === false ? 'NONAKTIF' : 'AKTIF'} />])} empty="Belum ada program loyalitas." />
            <form className="inline" onSubmit={createLoyaltyProgram}>
              <label>Nama program<input name="name" required placeholder="Loyalitas Utama" /></label>
              <label>Poin perRp<input name="earnRate" type="number" step="0.0001" min="0" placeholder="0.01" /></label>
              <label>Nilai tukar redeem<input name="redemptionRate" type="number" step="0.01" min="0" placeholder="100" /></label>
              <label>Minimum redeem<input name="minimumRedeem" type="number" min="0" placeholder="100" /></label>
              <label>Masa berlaku poin (hari)<input name="pointsExpireDays" type="number" min="1" placeholder="365" /></label>
              {/* POST /loyalty/programs is gated by BOTH @Permissions('loyalty.manage') and
                  @Roles(SUPER_ADMIN, OWNER, ADMIN) — the two guards throw independently, so
                  holding the permission is not enough. A control rendered for a manager would
                  only ever produce a 403. */}
              {canManageLoyaltyPrograms && <button disabled={busy}>Tambah program</button>}
            </form>
            <div className="inlineEditor">
              <label>Pelanggan<select value={loyaltyCustomerId} onChange={(event) => { setLoyaltyCustomerId(event.target.value); setLoyaltyForm((current) => ({ ...current, customerId: event.target.value })); }}><option value="">Pilih pelanggan</option>{loyaltyCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}</select></label>
              <div className="catalogStat"><small>Saldo poin</small><strong>{loyaltyAccount?.points ?? 0}</strong><span>{loyaltyTier ? `${loyaltyTier.tier} · diskon ${loyaltyTier.discountPct}%` : 'Pilih pelanggan'}</span></div>
              <label>Program<select value={loyaltyForm.programId} onChange={(event) => setLoyaltyForm({ ...loyaltyForm, programId: event.target.value })}>{programs.filter((program) => program.isActive !== false).map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label>
              <label>Tipe<select value={loyaltyForm.type} onChange={(event) => setLoyaltyForm({ ...loyaltyForm, type: event.target.value })}>{['EARN','REDEEM','ADJUSTMENT','EXPIRE','REFUND'].map((type) => <option key={type}>{type}</option>)}</select></label>
              <label>Poin<input type="number" step="1" value={loyaltyForm.points} onChange={(event) => setLoyaltyForm({ ...loyaltyForm, points: Math.trunc(Number(event.target.value) || 0) })} /></label>
              <label>Catatan<input value={loyaltyForm.notes} onChange={(event) => setLoyaltyForm({ ...loyaltyForm, notes: event.target.value })} /></label>
              <div className="rowActions">{canAll('loyalty.manage') && <button type="button" disabled={busy || !loyaltyForm.customerId || !loyaltyForm.programId} onClick={() => void postLoyaltyTransaction()}>Simpan transaksi poin</button>}</div>
            </div>
          </Panel>}
          {showDevices && <Panel eyebrow="DEVICE REGISTRATION" title="Daftarkan node toko" badge="signed sync">
            <div className="formStack">
              <label>Kode<input value={deviceForm.code} onChange={(e) => setDeviceForm({ ...deviceForm, code: e.target.value })} placeholder="POS-PUSAT-01" /></label>
              <label>Nama<input value={deviceForm.name} onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })} placeholder="POS Kasir 1" /></label>
              <label>Platform<input value={deviceForm.platform} onChange={(e) => setDeviceForm({ ...deviceForm, platform: e.target.value })} placeholder="POS_WEB / EDGE_NODE" /></label>
              <label>Versi aplikasi<input value={deviceForm.appVersion} onChange={(e) => setDeviceForm({ ...deviceForm, appVersion: e.target.value })} placeholder="0.5.3" /></label>
              {canManageIntegrations && <button type="button" disabled={busy} onClick={() => void registerDevice()}>Daftarkan device</button>}
            </div>
          </Panel>}
        </section>}
        {showDevices && <Panel eyebrow="PERANGKAT" title="Device & credential sync" badge={`${devices.length} device`}>
          <Table head={['Kode', 'Nama', 'Platform', 'Last seen', 'Status', 'Aksi']} rows={devices.map((d) => [
            <strong>{d.code}</strong>, d.name, `${d.platform ?? '-'}${d.appVersion ? ` · ${d.appVersion}` : ''}`, d.lastSeenAt ? tanggal(d.lastSeenAt) : '-',
            <StatusChip status={d.isActive === false ? 'OFF' : 'ON'} />,
            <div className="rowActions">{canManageIntegrations && <button type="button" className="secondary" disabled={busy || d.isActive === false} onClick={() => void rotateCredential(d)}>Rotasi secret</button>}{canManageIntegrations && <button type="button" className="secondary" disabled={busy} onClick={() => void setDeviceActive(d, d.isActive === false)}>{d.isActive === false ? 'Aktifkan' : 'Nonaktifkan'}</button>}</div>,
          ])} empty="Belum ada device." />
          {credential && <div className="notice success"><strong>SECRET SEKALI TAMPIL</strong><br/>Key ID: <code>{credential.keyId}</code><br/>Secret: <code>{credential.secret}</code><br/><small>Simpan pada secure store node toko. Setelah panel ini ditutup, server tidak akan menampilkan secret lagi.</small></div>}
        </Panel>}
        {(showProviders || showNotifications) && <section className="grid2">
          {showProviders && <Panel eyebrow="PROVIDER" title="WhatsApp / Telegram" badge={`${providers.length} connection`}>
            <div className="formStack">
              <label>Channel<select value={providerForm.channel} onChange={(e) => setProviderForm({ ...providerForm, channel: e.target.value, name: e.target.value === 'TELEGRAM' ? 'Telegram Utama' : 'WhatsApp Utama' })}>{['TELEGRAM','WHATSAPP'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Nama<input value={providerForm.name} onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })} /></label>
              {providerForm.channel === 'WHATSAPP' && <label>Endpoint provider<input value={providerForm.url} onChange={(e) => setProviderForm({ ...providerForm, url: e.target.value })} placeholder="https://provider.example/messages" /></label>}
              <label>Token / secret<input type="password" value={providerForm.token} onChange={(e) => setProviderForm({ ...providerForm, token: e.target.value })} placeholder="Disimpan terenkripsi oleh server" /></label>
              {canManageIntegrations && <button type="button" disabled={busy} onClick={() => void saveNotificationProvider()}>Simpan provider</button>}
            </div>
            <Table head={['Provider', 'Channel', 'Status', 'Health', 'Aksi']} rows={providers.map((p) => [<strong>{p.name}</strong>, String((p.config as { channel?: string } | null)?.channel ?? p.provider), <StatusChip status={p.status} />, p.lastError ? <small title={p.lastError}>DEGRADED</small> : p.lastHealthCheckAt ? <small>{tanggal(p.lastHealthCheckAt)}</small> : '-', (canManageIntegrations ? <button type="button" className="secondary" disabled={busy} onClick={() => void setProviderStatus(p, p.status === 'CONNECTED' ? 'DISABLED' : 'CONNECTED')}>{p.status === 'CONNECTED' ? 'Nonaktifkan' : 'Aktifkan'}</button> : null)])} empty="Belum ada provider notifikasi." />
          </Panel>}
          {showNotifications && <Panel eyebrow="NOTIFICATION TEMPLATE" title="Template provider-neutral" badge={`${templates.length} template`}>
            <div className="formStack">
              <label>Kode<input value={templateForm.code} onChange={(e) => setTemplateForm({ ...templateForm, code: e.target.value })} placeholder="ORDER_STATUS" /></label>
              <label>Channel<select value={templateForm.channel} onChange={(e) => setTemplateForm({ ...templateForm, channel: e.target.value })}>{['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Subject<input value={templateForm.subject} onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })} placeholder="Opsional" /></label>
              <label>Body<textarea value={templateForm.body} onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })} placeholder="Pesanan {{order.number}} sudah dikirim" /></label>
              <label><input type="checkbox" checked={templateForm.isActive} onChange={(e) => setTemplateForm({ ...templateForm, isActive: e.target.checked })} /> Template aktif</label>
              {canManageNotificationLifecycle && <button type="button" disabled={busy} onClick={() => void saveTemplate()}>{editingTemplateId ? 'Perbarui template' : 'Simpan template'}</button>}
              {editingTemplateId && <><span className="mutedText">Mode ubah: {templateForm.code} · {templateForm.channel} akan diperbarui, bukan diduplikasi.</span><button type="button" className="secondary" onClick={cancelTemplateEdit}>Batal ubah</button></>}
            </div>
            <Table head={['Kode', 'Channel', 'Status', 'Aksi']} rows={templates.slice(0, 30).map((t) => [<strong>{t.code}</strong>, t.channel, <StatusChip status={t.isActive === false ? 'NONAKTIF' : 'AKTIF'} />, <button type="button" className="secondary" onClick={() => editTemplate(t)}>Edit</button>])} empty="Belum ada template." />
          </Panel>}
        </section>}
        {showNotifications && <Panel eyebrow="OWNER REPORTING" title="Owner Daily Digest" badge={digestConfig.enabled ? 'AKTIF' : 'NONAKTIF'}>
          <div className="formStack">
            <label><input type="checkbox" checked={digestConfig.enabled} onChange={(e) => setDigestConfig({ ...digestConfig, enabled: e.target.checked })} /> Aktifkan pengiriman owner digest</label>
            <label>Jam kirim (0-23)<input type="number" min="0" max="23" value={digestConfig.hour} onChange={(e) => setDigestConfig({ ...digestConfig, hour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })} /></label>
            <label>Penerima Telegram terverifikasi<select multiple value={digestConfig.recipientBindingIds} onChange={(e) => setDigestConfig({ ...digestConfig, recipientBindingIds: Array.from(e.target.selectedOptions).map((option) => option.value) })}>{digestConfig.availableRecipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.employeeNumber ? `${recipient.employeeNumber} · ` : ''}{recipient.employeeName}{recipient.isPrimary ? ' · PRIMARY' : ''}</option>)}</select></label>
            <div className="rowActions">{canManageNotificationLifecycle && <button type="button" disabled={busy} onClick={() => void saveDigestConfig()}>Simpan daily digest</button>}<button type="button" className="secondary" disabled={busy} onClick={() => void previewDigest()}>Preview hari ini</button>{canManageNotificationLifecycle && <button type="button" className="secondary" disabled={busy || !digestConfig.enabled || digestConfig.recipientBindingIds.length === 0} onClick={() => void sendDigestNow()}>Kirim sekarang</button>}</div>
          </div>
          {digestPreview && <div className="notice"><strong>Preview digest</strong><pre className="digestPreviewText">{digestPreview.text}</pre></div>}
          <p className="sectionHelp">Recipient raw tidak diterima. Verifikasi Telegram dilakukan dari Employee Portal terlebih dahulu; binding yang dicabut otomatis membuat pengiriman fail-closed.</p>
        </Panel>}
        {showNotifications && <Panel eyebrow="NOTIFICATION QUEUE" title="Kirim notifikasi" badge="worker delivery">
          <div className="formStack">
            <label>Channel<select value={notificationForm.channel} onChange={(e) => setNotificationForm({ ...notificationForm, channel: e.target.value, templateCode: '' })}>{['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Template<select value={notificationForm.templateCode} onChange={(e) => setNotificationForm({ ...notificationForm, templateCode: e.target.value })}><option value="">Body manual</option>{templates.filter((t) => t.channel === notificationForm.channel && t.isActive !== false).map((t) => <option key={t.id} value={t.code}>{t.code}</option>)}</select></label>
            <label>Penerima<input value={notificationForm.recipient} onChange={(e) => setNotificationForm({ ...notificationForm, recipient: e.target.value })} placeholder="chat id / nomor WhatsApp / email" /></label>
            <label>Subject<input value={notificationForm.subject} onChange={(e) => setNotificationForm({ ...notificationForm, subject: e.target.value })} placeholder="Opsional" /></label>
            <label>Body manual<textarea value={notificationForm.body} onChange={(e) => setNotificationForm({ ...notificationForm, body: e.target.value })} placeholder="Kosongkan bila memakai template tanpa variable." /></label>
            {canQueueNotifications && <button type="button" disabled={busy} onClick={() => void queueNotification()}>Masukkan antrean</button>}
          </div>
        </Panel>}
        {showNotifications && <Panel eyebrow="DELIVERY HISTORY" title="Notification Center" badge={`${notifications.length} item`}>
          <Table head={['Channel', 'Penerima', 'Status', 'Provider', 'Attempt', 'Error', 'Aksi']} rows={notifications.map((n) => [<strong>{n.channel}</strong>, n.recipient, <StatusChip status={n.status} />, n.provider ?? '-', String(n.attempts ?? 0), n.lastError ? <small title={n.lastError}>{n.lastError.slice(0, 70)}</small> : '-', <div className="rowActions">{canManageNotificationLifecycle && n.status === 'QUEUED' && <button type="button" className="secondary" disabled={busy} onClick={() => void notificationAction(n, 'cancel')}>Batal</button>}{canManageNotificationLifecycle && ['FAILED','CANCELLED'].includes(n.status) && <button type="button" className="secondary" disabled={busy} onClick={() => void notificationAction(n, 'replay')}>Replay</button>}</div>])} empty="Belum ada notifikasi." />
        </Panel>}
      </>}

      {mode === 'commerce' && <>
        {commerceSection === 'channels' && <section className="grid2">
          <Panel eyebrow="PROMOTION ENGINE" title="Promo / Voucher" badge={`${promos.length} rule`}>
            <div className="formStack">
              <label>Nama<input value={promoForm.name} onChange={(e)=>setPromoForm({...promoForm,name:e.target.value})}/></label>
              <label>Kode<input value={promoForm.code} onChange={(e)=>setPromoForm({...promoForm,code:e.target.value.toUpperCase()})}/></label>
              <label>Tipe<select value={promoForm.type} onChange={(e)=>setPromoForm({...promoForm,type:e.target.value})}>{['PERCENT','AMOUNT','QUANTITY_BREAK','BOGO','BUNDLE'].map((x)=><option key={x}>{x}</option>)}</select></label>
              <label>Nilai<input type="number" min="0" value={promoForm.value} onChange={(e)=>setPromoForm({...promoForm,value:Number(e.target.value)})}/></label>
              <label>Channel<select value={promoForm.channel} onChange={(e)=>setPromoForm({...promoForm,channel:e.target.value})}>{['ALL','POS','STOREFRONT'].map((x)=><option key={x}>{x}</option>)}</select></label>
              <label>Produk eligible <small>(Ctrl/⌘ untuk multi-select; kosong=semua)</small><select multiple value={promoForm.productIds} onChange={(e)=>setPromoForm({...promoForm,productIds:Array.from(e.target.selectedOptions).map((o)=>o.value)})}>{products.map((p)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
              <label>Min subtotal<input type="number" min="0" value={promoForm.minSubtotal} onChange={(e)=>setPromoForm({...promoForm,minSubtotal:Number(e.target.value)})}/></label>
              <label>Max discount<input type="number" min="0" value={promoForm.maxDiscount} onChange={(e)=>setPromoForm({...promoForm,maxDiscount:e.target.value})} placeholder="opsional"/></label>
              <label>Tier member<input value={promoForm.memberTier} onChange={(e)=>setPromoForm({...promoForm,memberTier:e.target.value.toUpperCase()})} placeholder="opsional"/></label>
              {['QUANTITY_BREAK','BUNDLE'].includes(promoForm.type)&&<label>Minimum quantity<input type="number" min="1" step="1" value={promoForm.minQuantity} onChange={(e)=>setPromoForm({...promoForm,minQuantity:Math.max(1,Number(e.target.value)||1)})}/></label>}
              {promoForm.type==='BOGO'&&<><label>Buy quantity<input type="number" min="1" step="1" value={promoForm.buyQuantity} onChange={(e)=>setPromoForm({...promoForm,buyQuantity:Math.max(1,Number(e.target.value)||1)})}/></label><label>Get free<input type="number" min="1" step="1" value={promoForm.getQuantity} onChange={(e)=>setPromoForm({...promoForm,getQuantity:Math.max(1,Number(e.target.value)||1)})}/></label></>}
              <label>Quota global<input type="number" min="1" step="1" value={promoForm.usageLimit} onChange={(e)=>setPromoForm({...promoForm,usageLimit:e.target.value})} placeholder="opsional"/></label>
              <label>Quota / customer<input type="number" min="1" step="1" value={promoForm.perCustomerLimit} onChange={(e)=>setPromoForm({...promoForm,perCustomerLimit:e.target.value})} placeholder="opsional"/></label>
              <label>Mulai<input type="date" value={promoForm.startsAt} onChange={(e)=>setPromoForm({...promoForm,startsAt:e.target.value})}/></label>
              <label>Selesai<input type="date" value={promoForm.endsAt} onChange={(e)=>setPromoForm({...promoForm,endsAt:e.target.value})}/></label>
              {canManagePromotions && <button type="button" disabled={busy} onClick={()=>void savePromo()}>Simpan promo</button>}
            </div>
          </Panel>
          <Panel eyebrow="PROMOTION RULES" title="Promo Aktif & Preview" badge="server authoritative">
            <div className="formStack sectionBlockBottom">
              <label>Subtotal simulasi<input type="number" min="0" value={promoPreviewForm.subtotal} onChange={(e)=>setPromoPreviewForm({...promoPreviewForm, subtotal:Number(e.target.value)})}/></label>
              <label>Kode promo<input value={promoPreviewForm.code} onChange={(e)=>setPromoPreviewForm({...promoPreviewForm, code:e.target.value.toUpperCase()})} placeholder="opsional"/></label>
              <label>Tier member<input value={promoPreviewForm.memberTier} onChange={(e)=>setPromoPreviewForm({...promoPreviewForm, memberTier:e.target.value.toUpperCase()})} placeholder="opsional"/></label>
              <button type="button" className="secondary" disabled={busy} onClick={()=>void previewPromo()}>Preview rule</button>
            </div>
            {promoPreview && <div className="notice sectionBlockBottom"><strong>{promoPreview.appliedRule ? `${promoPreview.appliedRule.code} · ${promoPreview.appliedRule.name}` : 'Tidak ada rule terpakai'}</strong><small>Subtotal {new Intl.NumberFormat('id-ID').format(promoPreview.subtotal)} · Discount {new Intl.NumberFormat('id-ID').format(promoPreview.discount)}</small>{promoPreview.note && <small>{promoPreview.note}</small>}</div>}
            <Table head={['Kode','Tipe','Channel','Quota','Status','Aksi']} rows={promos.slice(0,30).map((p)=>[<strong>{p.code}</strong>,p.type,p.channel,`${p.perCustomerLimit??'-'} / ${p.usageLimit??'-'}`,<StatusChip status={p.isActive?'ACTIVE':'INACTIVE'}/>,(canManagePromotions ? <button type="button" className="secondary" disabled={busy} onClick={()=>void updatePromoStatus(p,!p.isActive)}>{p.isActive?'Nonaktifkan':'Aktifkan'}</button> : null)])} empty="Belum ada promo." />
            <p className="sectionHelp">Preview memakai endpoint server yang sama dengan rule checkout. BOGO menggunakan unit eligible termurah sebagai free item. Quantity break memakai persen; bundle memakai nominal per grup. Quota dicatat saat Sale/Order benar-benar dibuat.</p>
          </Panel>
        </section>}
        {commerceSection === 'fulfillment' && <section className="grid2">
          <Panel eyebrow="PENGIRIMAN" title="Shipments" badge={`${shipments.length} shipment`}>
            <Table head={['Nomor', 'Dibuat', 'Status']} rows={shipments.map((s) => [<strong>{s.number}</strong>, tanggal(s.createdAt), <StatusChip status={s.status ?? 'PENDING'} />])} empty="Belum ada shipment." />
          </Panel>
          <Panel eyebrow="KONTROL PENGIRIMAN" title="Carrier eksternal" badge="dipakai saat Ship">
            <div className="formStack">
              <label>Carrier<input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="JNE / J&T / Manual" /></label>
              <label>Nomor resi<input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="Nomor resi sebelum Ship" /></label>
            </div>
            <p className="sectionHelp">Nomor resi hanya dikirim ke server saat aksi Ship. Own-fleet memakai workflow armada dan gate pass tersendiri.</p>
          </Panel>
        </section>}

        {commerceSection === 'orders' && <Panel eyebrow="COMMERCE" title="Fulfillment Storefront" badge={`${orders.length} order`}>
          <Table
            head={['Order', 'Pelanggan', 'Fulfillment', 'Metode', 'Status', 'Aksi']}
            rows={orders.map((o) => {
              const payment = o.payments[0];
              const actions: React.ReactNode[] = [];
              if (o.status === 'PENDING_PAYMENT' && Boolean(payment && ['QRIS', 'TRANSFER', 'CARD'].includes(payment.method)) && canManagePayments) actions.push(<button key="confirm" type="button" className="secondary" disabled={busy} onClick={() => { setDialog({ kind: 'confirm-payment', order: o }); setDialogValue(''); }}>Konfirmasi bayar</button>);
              if (o.status === 'PENDING_PAYMENT' && payment?.method === 'INVOICE' && canManagePayments) actions.push(<button key="credit" type="button" className="secondary" disabled={busy} onClick={() => void orderAction(o, 'authorize-invoice')}>Otorisasi termin</button>);
              if (['PAID', 'PROCESSING'].includes(o.status) && canManageShipments) actions.push(<button key="pack" type="button" className="secondary" disabled={busy} onClick={() => void orderAction(o, 'pack')}>Pack</button>);
              if (o.status === 'PACKED' && canManageShipments) actions.push(<button key="ship" type="button" className="secondary" disabled={busy} onClick={() => void orderAction(o, 'ship')}>Ship</button>);
              if (o.status === 'SHIPPED' && canManageShipments) actions.push(<button key="deliver" type="button" className="secondary" disabled={busy} onClick={() => void orderAction(o, 'deliver')}>Deliver</button>);
              if (payment?.status !== 'PAID' && ['PENDING_PAYMENT', 'PROCESSING', 'PACKED'].includes(o.status) && canCancelOrders) actions.push(<button key="cancel" type="button" className="secondary dangerButton" disabled={busy} onClick={() => { setDialog({ kind: 'cancel', order: o }); setDialogValue(''); }}>Batalkan</button>);
              return [<strong>{o.number}</strong>, o.customerName, <small>{o.fulfillmentType ?? 'DELIVERY'} · {o.shippingMethodName ?? o.shippingMethodCode ?? '-'}</small>, <small>{payment?.method ?? 'UNSELECTED'} / {payment?.status ?? '-'}</small>, <StatusChip status={o.status} />, <div className="rowActions">{actions.length ? actions : <span>-</span>}</div>];
            })}
            empty="Belum ada order storefront."
          />
          <p className="sectionHelp">Packing hanya lolos setelah inspeksi outbound memenuhi syarat server. Pembayaran elektronik harus memiliki referensi provider yang sudah diverifikasi.</p>
        </Panel>}
      </>}

      {message && <div className="notice">{message}</div>}

      {dialog && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="commerce-dialog-title">
        <div className="modalCard">
          <span className="eyebrow">{dialog.kind === 'confirm-payment' ? 'PAYMENT CONFIRMATION' : 'ORDER CANCELLATION'}</span>
          <h2 id="commerce-dialog-title">{dialog.kind === 'confirm-payment' ? `Konfirmasi pembayaran ${dialog.order.number}` : `Batalkan ${dialog.order.number}`}</h2>
          <p className="sectionHelp">{dialog.kind === 'confirm-payment' ? 'Masukkan referensi provider/bank yang sudah benar-benar diverifikasi.' : 'Tuliskan alasan pembatalan untuk audit trail.'}</p>
          <label>{dialog.kind === 'confirm-payment' ? 'Referensi eksternal' : 'Alasan pembatalan'}
            <input autoFocus value={dialogValue} onChange={(e) => setDialogValue(e.target.value)} placeholder={dialog.kind === 'confirm-payment' ? 'Contoh: BANK-TRX-...' : 'Alasan pembatalan'} />
          </label>
          <div className="modalActions">
            <button type="button" className="secondary" disabled={busy} onClick={() => { setDialog(null); setDialogValue(''); }}>Kembali</button>
            {(dialog.kind === 'confirm-payment' ? canManagePayments : canCancelOrders) && <button type="button" className={dialog.kind === 'cancel' ? 'dangerButton' : ''} disabled={busy || !dialogValue.trim()} onClick={() => void orderAction(dialog.order, dialog.kind, dialogValue)}>{busy ? 'Memproses…' : dialog.kind === 'confirm-payment' ? 'Konfirmasi pembayaran' : 'Batalkan order'}</button>}
          </div>
        </div>
      </div>}
    </>
  );
}
