'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table, TableSkeleton, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type PaymentProviderEvent = {
  id: string; provider: string; eventId: string; eventType: string; externalRef?: string | null;
  paymentId?: string | null; orderId?: string | null; amount?: string | number | null; status: string;
  error?: string | null; receivedAt: string; processedAt?: string | null;
};
type OutletOverview = {
  // The report declares which authority it reads. It says POSTED_JOURNAL: the branch journal, not
  // the Sale/Order tables — so a confirmed return reduces this figure the way it reduces the P&L.
  source: 'POSTED_JOURNAL';
  totals: { revenue: number; grossProfit: number; transactions: number; outletCount: number };
  ranked: Array<{ branchId: string; name: string; code: string; isActive: boolean; rank: number; sharePct: number; lowStock: number; pendingOrders: number; today: { revenue: number; grossProfit: number; transactions: number } }>;
};
type CashierTarget = { userId: string; name: string; target: number; achieved: number; transactions: number; progressPct: number | null; onTrack: boolean | null };
type CashierTargets = { generatedAt: string; rows: CashierTarget[] };
type Device = { id: string; code: string; name: string; platform?: string; appVersion?: string | null; lastSeenAt?: string | null; isActive?: boolean };
type SyncReceipt = { id: string; since: string; checkpoint: string; nextCursor?: string | null; eventCount: number; status: string; acknowledgedAt?: string | null; createdAt: string };
type OfflineTransaction = { id: string; localId: string; sequence: number; transactionType: string; status: string; serverEntityType?: string | null; serverEntityId?: string | null; errorMessage?: string | null; attempts: number; nextRetryAt?: string | null; deadLetteredAt?: string | null; receivedAt: string; processedAt?: string | null };
type SyncDiagnostics = { device: Device; receipts: SyncReceipt[]; offlineTransactions: OfflineTransaction[] };
type Integration = { id: string; type: string; provider: string; name: string; status: string; branchId?: string | null };
type ExternalMapping = { id: string; integrationId: string; entityType: string; internalId: string; externalId: string; metadata?: unknown; updatedAt?: string; };
type MarketplaceOrder = { id: string; integrationId: string; externalOrderId: string; internalOrderId?: string | null; marketplace: string; shopId?: string | null; status: string; orderData: unknown; lastSyncedAt: string; createdAt: string };
type CursorResponse<T> = T[] | { items?: T[] };

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API}${path}`, token, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Request gagal.');
  return data as T;
}
function rows<T>(value: CursorResponse<T>): T[] { return Array.isArray(value) ? value : value.items ?? []; }
function rupiah(value: number | string | null | undefined) { return `Rp ${Number(value ?? 0).toLocaleString('id-ID')}`; }

type R3OperationsMode = 'reporting' | 'devices' | 'connections';

export default function R3OperationsView({ token, mode = 'connections' }: { token: string; mode?: R3OperationsMode }) {
  const [payments, setPayments] = useState<PaymentProviderEvent[]>([]);
  const [outlets, setOutlets] = useState<OutletOverview | null>(null);
  const [cashiers, setCashiers] = useState<CashierTargets | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [sync, setSync] = useState<SyncDiagnostics | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [mappingIntegrationId, setMappingIntegrationId] = useState('');
  const [mappings, setMappings] = useState<ExternalMapping[]>([]);
  const [mappingForm, setMappingForm] = useState({ entityType: 'PRODUCT', internalId: '', externalId: '', metadata: '' });
  const [marketplaceOrders, setMarketplaceOrders] = useState<MarketplaceOrder[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [marketplaceForm, setMarketplaceForm] = useState({ integrationId: '', externalOrderId: '', marketplace: '', shopId: '', status: 'PAID', orderData: '{}' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { canAll } = usePermissions(token);

  const marketplaceIntegrations = useMemo(
    () => integrations.filter((row) => row.type === 'MARKETPLACE' || /market/i.test(`${row.type} ${row.provider}`)),
    [integrations],
  );

  async function refreshCore() {
    const [paymentRows, outletRows, cashierRows, deviceRows, integrationRows, marketplaceRows] = await Promise.all([
      request<PaymentProviderEvent[]>(token, '/payments/provider-events?limit=100'),
      request<OutletOverview>(token, '/reports/multi-outlet'),
      request<CashierTargets>(token, '/sales/cashier-targets'),
      request<CursorResponse<Device>>(token, '/devices?limit=100'),
      request<CursorResponse<Integration>>(token, '/platform/integrations'),
      request<MarketplaceOrder[]>(token, '/marketplace-orders'),
    ]);
    const integrationList = rows(integrationRows);
    setPayments(paymentRows ?? []);
    setOutlets(outletRows);
    setCashiers(cashierRows);
    setDevices(rows(deviceRows));
    setIntegrations(integrationList);
    setMappingIntegrationId((current) => current || integrationList[0]?.id || '');
    setMarketplaceOrders(marketplaceRows ?? []);
    setTargetDrafts(Object.fromEntries((cashierRows.rows ?? []).map((row) => [row.userId, String(row.target ?? 0)])));
    setSelectedDeviceId((current) => current || rows(deviceRows)[0]?.id || '');
    setMarketplaceForm((current) => ({ ...current, integrationId: current.integrationId || integrationList.find((row) => row.type === 'MARKETPLACE')?.id || '' }));
  }

  async function refreshSync(deviceId = selectedDeviceId) {
    if (!deviceId) { setSync(null); return; }
    setSync(await request<SyncDiagnostics>(token, `/devices/${deviceId}/sync/diagnostics?limit=100`));
  }

  async function refreshMappings(integrationId = mappingIntegrationId) {
    if (!integrationId) { setMappings([]); return; }
    setMappings(await request<ExternalMapping[]>(token, `/integrations/${integrationId}/mappings`));
  }

  useEffect(() => {
    void (async () => {
      try { await refreshCore(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Data R3 gagal dimuat.'); }
      finally { setLoading(false); }
    })();
  }, [token]);

  // Branch identity arrives via the token. Both effects must depend on it, otherwise a
  // branch switch leaves sync diagnostics and external mappings showing the previous
  // branch's data until the user happens to change the selection.
  useEffect(() => {
    if (selectedDeviceId) void refreshSync(selectedDeviceId).catch((error) => setMessage(error instanceof Error ? error.message : 'Diagnostik sync gagal dimuat.'));
    else setSync(null);
  }, [selectedDeviceId, token]);

  useEffect(() => {
    if (mappingIntegrationId) void refreshMappings(mappingIntegrationId).catch((error) => setMessage(error instanceof Error ? error.message : 'External mapping gagal dimuat.'));
    else setMappings([]);
  }, [mappingIntegrationId, token]);

  async function saveTargets() {
    setBusy(true); setMessage('');
    try {
      const targets = Object.fromEntries(Object.entries(targetDrafts).map(([userId, value]) => [userId, Math.max(0, Number(value) || 0)]));
      await request(token, '/sales/cashier-targets', { method: 'POST', body: JSON.stringify({ targets }) });
      setCashiers(await request<CashierTargets>(token, '/sales/cashier-targets'));
      setMessage('Target kasir tersimpan.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Target kasir gagal disimpan.'); }
    finally { setBusy(false); }
  }

  async function acknowledge(receipt: SyncReceipt) {
    if (!selectedDeviceId) return;
    setBusy(true); setMessage('');
    try {
      await request(token, `/devices/${selectedDeviceId}/sync/ack`, { method: 'POST', body: JSON.stringify({ receiptId: receipt.id, checkpoint: receipt.checkpoint }) });
      await refreshSync();
      setMessage('Sync receipt di-acknowledge.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Acknowledge sync gagal.'); }
    finally { setBusy(false); }
  }

  async function requeue(transaction: OfflineTransaction) {
    if (!selectedDeviceId) return;
    setBusy(true); setMessage('');
    try {
      await request(token, `/devices/${selectedDeviceId}/offline-transactions/${transaction.id}/requeue`, { method: 'POST', body: JSON.stringify({}) });
      await refreshSync();
      setMessage('Offline transaction dimasukkan kembali ke antrean.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Requeue gagal.'); }
    finally { setBusy(false); }
  }

  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mappingIntegrationId) { setMessage('Pilih integration sebelum menyimpan mapping.'); return; }
    setBusy(true); setMessage('');
    try {
      let metadata: unknown = undefined;
      if (mappingForm.metadata.trim()) metadata = JSON.parse(mappingForm.metadata);
      await request(token, `/integrations/${mappingIntegrationId}/mappings`, { method: 'POST', body: JSON.stringify({
        entityType: mappingForm.entityType.trim(),
        internalId: mappingForm.internalId.trim(),
        externalId: mappingForm.externalId.trim(),
        ...(metadata === undefined ? {} : { metadata }),
      }) });
      setMappingForm((current) => ({ ...current, internalId: '', externalId: '', metadata: '' }));
      await refreshMappings(mappingIntegrationId);
      setMessage('External mapping tersimpan.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'External mapping gagal disimpan.'); }
    finally { setBusy(false); }
  }

  async function removeMapping(mapping: ExternalMapping) {
    if (!mappingIntegrationId) return;
    setBusy(true); setMessage('');
    try {
      await request(token, `/integrations/${mappingIntegrationId}/mappings/${mapping.id}`, { method: 'DELETE' });
      await refreshMappings(mappingIntegrationId);
      setMessage('External mapping dihapus.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'External mapping gagal dihapus.'); }
    finally { setBusy(false); }
  }

  async function importMarketplace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      const orderData = JSON.parse(marketplaceForm.orderData || '{}') as unknown;
      await request(token, '/marketplace-orders/import', { method: 'POST', body: JSON.stringify({
        integrationId: marketplaceForm.integrationId,
        externalOrderId: marketplaceForm.externalOrderId.trim(),
        marketplace: marketplaceForm.marketplace.trim(),
        shopId: marketplaceForm.shopId.trim() || undefined,
        status: marketplaceForm.status.trim(),
        orderData,
      }) });
      setMarketplaceOrders(await request<MarketplaceOrder[]>(token, '/marketplace-orders'));
      setMarketplaceForm((current) => ({ ...current, externalOrderId: '', shopId: '', orderData: '{}' }));
      setMessage('MarketplaceOrder berhasil diimpor/diupdate.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'MarketplaceOrder gagal diproses.'); }
    finally { setBusy(false); }
  }

  if (loading) return <TableSkeleton rows={8} />;

  return <div>
    {mode === 'connections' && <section className="grid2">
      <Panel eyebrow="R3 · PAYMENT" title="Payment Provider Diagnostics" badge={`${payments.length} event`}>
        <Table head={['Provider / Event','Referensi','Status','Nominal','Error']} rows={payments.map((row) => [
          <span key={row.id}><strong>{row.provider}</strong><small>{row.eventType} · {row.eventId}</small></span>,
          <small key={`${row.id}-ref`}>{row.externalRef ?? '-'}<br />{row.paymentId ? `payment:${row.paymentId}` : row.orderId ? `order:${row.orderId}` : ''}</small>,
          <StatusChip key={`${row.id}-status`} status={row.status} />,
          rupiah(row.amount),
          row.error ? <small title={row.error}>{row.error.slice(0, 80)}</small> : '-',
        ])} empty="Belum ada payment provider event." />
      </Panel>

    </section>}


    {mode === 'reporting' && <Panel eyebrow="R3 · REPORTING" title="Multi-outlet Performance" badge={`${outlets?.totals.outletCount ?? 0} outlet`}>
      {outlets && <><div className="metricGrid"><div><small>Omzet</small><strong>{rupiah(outlets.totals.revenue)}</strong></div><div><small>Laba kotor</small><strong>{rupiah(outlets.totals.grossProfit)}</strong></div><div><small>Transaksi</small><strong>{outlets.totals.transactions}</strong></div></div>
      <p className="ownerNote">Omzet dan laba kotor dihitung dari jurnal posted tiap cabang, jadi retur yang sudah dikonfirmasi langsung mengurangi — sama seperti Laporan Laba Rugi.</p>
      <Table head={['Rank','Outlet','Omzet','Share','Low stock','Pending']} rows={outlets.ranked.map((row) => [String(row.rank), <span key={row.branchId}><strong>{row.name}</strong><small>{row.code}</small></span>, rupiah(row.today.revenue), `${row.sharePct}%`, String(row.lowStock), String(row.pendingOrders)])} empty="Belum ada outlet." /></>}
    </Panel>}

    {mode === 'reporting' && <Panel eyebrow="R3 · REPORTING" title="Cashier Targets" badge={`${cashiers?.rows.length ?? 0} kasir`}>
      <Table head={['Kasir','Target','Tercapai','Transaksi','Progress','Input target']} rows={(cashiers?.rows ?? []).map((row) => [
        <strong key={row.userId}>{row.name}</strong>, rupiah(row.target), rupiah(row.achieved), String(row.transactions),
        row.progressPct === null ? '-' : <span className={row.onTrack ? 'okText' : ''}>{row.progressPct}%</span>,
        <input key={`${row.userId}-target`} type="number" min="0" value={targetDrafts[row.userId] ?? '0'} onChange={(event) => setTargetDrafts({ ...targetDrafts, [row.userId]: event.target.value })} />,
      ])} empty="Belum ada kasir aktif." />
      <div className="rowActions"><button type="button" disabled={busy} onClick={() => void saveTargets()}>Simpan target kasir</button></div>
    </Panel>}

    {mode === 'devices' && <section className="grid2">
      <Panel eyebrow="R3 · EDGE" title="Device Sync Diagnostics" badge={sync?.device.code ?? 'pilih device'}>
        <label>Device<select value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}><option value="">Pilih device</option>{devices.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
        {sync && <Table head={['Receipt','Checkpoint','Event','Status','Aksi']} rows={sync.receipts.map((row) => [
          <small key={row.id}>{row.id.slice(0, 8)}<br />{tanggal(row.createdAt)}</small>, tanggal(row.checkpoint), String(row.eventCount),
          <StatusChip key={`${row.id}-status`} status={row.status} />,
          row.status !== 'ACKNOWLEDGED' ? (canAll('integration.manage') ? <button type="button" className="secondary" disabled={busy} onClick={() => void acknowledge(row)}>Acknowledge</button> : '-') : '-',
        ])} empty="Belum ada sync receipt." />}
      </Panel>

      <Panel eyebrow="R3 · EDGE" title="Offline Transaction Queue" badge={`${sync?.offlineTransactions.length ?? 0} transaksi`}>
        <Table head={['Local / Sequence','Tipe','Status','Attempt','Error','Aksi']} rows={(sync?.offlineTransactions ?? []).map((row) => [
          <small key={row.id}>{row.localId}<br />#{row.sequence}</small>, row.transactionType,
          <StatusChip key={`${row.id}-status`} status={row.status} />, String(row.attempts),
          row.errorMessage ? <small title={row.errorMessage}>{row.errorMessage.slice(0, 70)}</small> : '-',
          ['FAILED','CONFLICT','DEAD_LETTER'].includes(row.status) ? (canAll('integration.manage') ? <button type="button" className="secondary" disabled={busy} onClick={() => void requeue(row)}>Requeue</button> : '-') : '-',
        ])} empty="Belum ada offline transaction." />
      </Panel>
    </section>}

    {mode === 'connections' && <section className="grid2">
      <Panel eyebrow="INTEGRATION MAPPING" title="External ID Mapping" badge={`${mappings.length} mapping`}>
        <label>Integration<select value={mappingIntegrationId} onChange={(event) => setMappingIntegrationId(event.target.value)}><option value="">Pilih integration</option>{integrations.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.provider}</option>)}</select></label>
        <Table head={['Entity','Internal ID','External ID','Aksi']} rows={mappings.map((row) => [<strong key={row.id}>{row.entityType}</strong>, <small key={`${row.id}-internal`}>{row.internalId}</small>, <small key={`${row.id}-external`}>{row.externalId}</small>, canAll('integration.manage') ? <button key={`${row.id}-delete`} type="button" className="secondary dangerButton" disabled={busy} onClick={() => void removeMapping(row)}>Hapus</button> : '-'])} empty="Belum ada mapping untuk integration ini." />
      </Panel>
      <Panel eyebrow="INTEGRATION MAPPING" title="Tambah / update mapping" badge="upsert canonical">
        <form className="formStack" onSubmit={saveMapping}>
          <label>Entity type<input required value={mappingForm.entityType} onChange={(event) => setMappingForm({ ...mappingForm, entityType: event.target.value.toUpperCase() })} placeholder="PRODUCT / CUSTOMER / ORDER" /></label>
          <label>Internal ID<input required value={mappingForm.internalId} onChange={(event) => setMappingForm({ ...mappingForm, internalId: event.target.value })} /></label>
          <label>External ID<input required value={mappingForm.externalId} onChange={(event) => setMappingForm({ ...mappingForm, externalId: event.target.value })} /></label>
          <label>Metadata JSON<textarea value={mappingForm.metadata} onChange={(event) => setMappingForm({ ...mappingForm, metadata: event.target.value })} placeholder='{"shop":"utama"}' /></label>
          {canAll('integration.manage') ? <button disabled={busy || !mappingIntegrationId}>Simpan mapping</button> : <small>Simpan mapping butuh permission integration.manage.</small>}
        </form>
      </Panel>
    </section>}

    {mode === 'connections' && <section className="grid2">
      <Panel eyebrow="R3 · MARKETPLACE" title="Marketplace Orders" badge={`${marketplaceOrders.length} order`}>
        <Table head={['Marketplace','External order','Status','Shop','Last sync']} rows={marketplaceOrders.map((row) => [
          <strong key={row.id}>{row.marketplace}</strong>, row.externalOrderId, <StatusChip key={`${row.id}-status`} status={row.status} />, row.shopId ?? '-', tanggal(row.lastSyncedAt),
        ])} empty="Belum ada MarketplaceOrder." />
      </Panel>
      <Panel eyebrow="R3 · MARKETPLACE" title="Import / Update MarketplaceOrder" badge="server authoritative">
        <form className="formStack" onSubmit={importMarketplace}>
          <label>Integration<select required value={marketplaceForm.integrationId} onChange={(event) => setMarketplaceForm({ ...marketplaceForm, integrationId: event.target.value })}><option value="">Pilih integration</option>{marketplaceIntegrations.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.provider} · {row.status}</option>)}</select></label>
          <label>Marketplace<input required value={marketplaceForm.marketplace} onChange={(event) => setMarketplaceForm({ ...marketplaceForm, marketplace: event.target.value })} placeholder="SHOPEE / TOKOPEDIA / lainnya" /></label>
          <label>External order ID<input required value={marketplaceForm.externalOrderId} onChange={(event) => setMarketplaceForm({ ...marketplaceForm, externalOrderId: event.target.value })} /></label>
          <label>Shop ID<input value={marketplaceForm.shopId} onChange={(event) => setMarketplaceForm({ ...marketplaceForm, shopId: event.target.value })} /></label>
          <label>Status<input required value={marketplaceForm.status} onChange={(event) => setMarketplaceForm({ ...marketplaceForm, status: event.target.value })} /></label>
          <label>Order data JSON<textarea required value={marketplaceForm.orderData} onChange={(event) => setMarketplaceForm({ ...marketplaceForm, orderData: event.target.value })} /></label>
          {canAll('integration.manage') ? <button disabled={busy}>Import / update</button> : <small>Import / update butuh permission integration.manage.</small>}
        </form>
      </Panel>
    </section>}

    {message && <div className="notice">{message}</div>}
  </div>;
}
