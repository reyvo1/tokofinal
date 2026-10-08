'use client';
import { authFetch } from '../auth-fetch';
// Modul Operasional: retur, transfer stok, dan stock opname yang dapat dijalankan dari Admin.
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { ErrorState, Panel, Table, StatusChip, rupiah, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type SaleReturn = { id: string; number: string; status: string; refundMethod?: string; refundAmount: string | number; inspectionId?: string | null; createdAt: string };
type OrderReturn = { id: string; number: string; status: string; refundMethod?: string | null; refundAmount: string | number; inspectionId?: string | null; reason?: string | null; createdAt: string; order: { id: string; number: string; customerName: string; status: string }; customer?: { name: string; email?: string | null } | null; items: Array<{ id: string; quantity: number; condition: string; restock: boolean; product: { sku: string; name: string } }> };
type PurchaseReturnItem = { id: string; productId: string; quantity: number; metadata?: { goodsReceiptItemId?: string } | null };
type PurchaseReturn = { id: string; number: string; status: string; amount: string | number; goodsReceiptId?: string | null; supplierCreditNoteNumber?: string | null; inspectionId?: string | null; items: PurchaseReturnItem[]; createdAt: string };
type GoodsReceiptItem = { id: string; productId: string; quantityReceived: number; acceptedQty: number; product?: { id: string; sku: string; name: string } };
type GoodsReceipt = { id: string; number: string; operationalStatus: string; supplier?: { id: string; name: string }; warehouse?: { id: string; code: string; name: string }; items: GoodsReceiptItem[]; receivedAt: string };
type TransferItem = { id: string; productId: string; quantity: number; shippedQty: number; receivedQty: number; batchNumber?: string | null; serialNumbers?: string[] | null };
type Transfer = { id: string; number: string; sourceWarehouseId: string; destinationWarehouseId: string; status: string; items: TransferItem[]; createdAt: string };
type OpnameItem = { id: string; productId: string; batchNumber?: string | null; systemQty: number; countedQty?: number | null; difference?: number | null; reason?: string | null };
type Opname = { id: string; number: string; warehouseId: string; locationId?: string | null; status: string; items: OpnameItem[]; createdAt: string };
type Warehouse = { id: string; code: string; name: string; branchId: string; isActive?: boolean };
type Product = { id: string; sku: string; name: string; trackBatch?: boolean; trackExpiry?: boolean; trackSerial?: boolean };
type InventoryBatch = { id:string; warehouseId:string; productId:string; batchNumber:string; quantity:number; reserved:number; producedAt?:string|null; expiryDate?:string|null };
type InventorySerial = { id:string; warehouseId:string; productId:string; serialNumber:string; status:string; referenceType?:string|null; referenceId?:string|null; createdAt:string };
type WarehouseLocation = { id:string; warehouseId:string; code:string; name:string; type:string; isDefault?:boolean; isActive?:boolean };
type LocationBalance = { id:string; warehouseId:string; locationId:string; productId:string; quantity:number; reserved:number; available:number; location?:WarehouseLocation|null; product?:{ id:string; sku:string; name:string; baseUnit?:string }|null };
type InventoryCondition = 'AVAILABLE'|'DAMAGED'|'QUARANTINE'|'LOST';
type ConditionBalance = { id:string; warehouseId:string; locationId:string; productId:string; condition:InventoryCondition; quantity:number; location?:{ id:string; code:string; name:string; isActive:boolean }|null };
type TransitBalance = { transferId:string; number:string; sourceWarehouseId:string; destinationWarehouseId:string; productId:string; condition:'IN_TRANSIT'; quantity:number; batchNumber?:string|null; serialCount:number; shippedAt?:string|null };
type ReorderVisibility = { warehouseId:string; warehouse:{id:string;code:string;name:string}; productId:string; product:{id:string;sku:string;name:string;minStock:number}; available:number; minStock:number; inboundInTransit:number; outboundInTransit:number; projectedAvailable:number; shortage:number; lowStock:boolean; forecast:{ dailyDemand:number|null; daysOfCover:number|null; leadTimeDays:number; leadTimeIsAssumed:boolean; recommendedQuantity:number; orderQuantity:number; packSize:number|null; recommendedPacks:number|null; drivers:string[]; confidence:'MEASURED'|'THIN_HISTORY'|'MIN_STOCK_ONLY'; basis:string } };

type CursorResponse<T> = T[] | { items?: T[] };
function rowsOf<T>(value: CursorResponse<T>): T[] { return Array.isArray(value) ? value : value.items ?? []; }

type InventoryControlMode = 'overview' | 'traceability' | 'transfers' | 'stocktake' | 'returns';

export default function OperationsView({ token, mode = 'overview' }: { token: string; mode?: InventoryControlMode }) {
  // D-3: every mutation in this module sits behind its own permission. Posting a refund needs
  // sale.refund, opening/rejecting a return needs sale.return, posting a purchase return needs
  // purchase.return, transfer/relocation need inventory.transfer, condition moves need
  // inventory.adjust, the whole opname lifecycle needs inventory.opname, and batch/serial
  // registration need inventory.batch / inventory.serial. A view-only operator used to see all
  // of these and only learn they were forbidden from the 403.
  const { canAll, identity } = usePermissions(token);
  const [saleReturns, setSaleReturns] = useState<SaleReturn[]>([]);
  const [orderReturns, setOrderReturns] = useState<OrderReturn[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [goodsReceipts, setGoodsReceipts] = useState<GoodsReceipt[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [opnames, setOpnames] = useState<Opname[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [serials, setSerials] = useState<InventorySerial[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [locationBalances, setLocationBalances] = useState<LocationBalance[]>([]);
  const [conditionBalances, setConditionBalances] = useState<ConditionBalance[]>([]);
  const [transitBalances, setTransitBalances] = useState<TransitBalance[]>([]);
  const [reorderVisibility, setReorderVisibility] = useState<ReorderVisibility[]>([]);
  const [conditionProductId, setConditionProductId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [transferForm, setTransferForm] = useState({ sourceWarehouseId: '', destinationWarehouseId: '', productId: '', quantity: 1, batchNumber: '', serialText: '', notes: '' });
  const [opnameWarehouseId, setOpnameWarehouseId] = useState('');
  const [opnameLocationId, setOpnameLocationId] = useState('');
  const [locationWarehouseId, setLocationWarehouseId] = useState('');
  const [relocationForm, setRelocationForm] = useState({ productId:'', sourceLocationId:'', destinationLocationId:'', quantity:1, notes:'' });
  const [conditionForm, setConditionForm] = useState<{locationId:string;fromCondition:InventoryCondition;toCondition:InventoryCondition;quantity:number;notes:string}>({ locationId:'', fromCondition:'AVAILABLE', toCondition:'QUARANTINE', quantity:1, notes:'' });
  const [purchaseReturnForm, setPurchaseReturnForm] = useState({ goodsReceiptId: '', goodsReceiptItemId: '', quantity: 1, reason: '', supplierCreditNoteNumber: '' });
  const [selectedOpnameId, setSelectedOpnameId] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [rejectOrderReturnId, setRejectOrderReturnId] = useState('');
  const [rejectOrderReturnReason, setRejectOrderReturnReason] = useState('');
  const [batchForm, setBatchForm] = useState({ warehouseId:'', productId:'', batchNumber:'', producedAt:'', expiryDate:'' });
  const [serialForm, setSerialForm] = useState({ warehouseId:'', productId:'', serialNumber:'' });

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `HTTP ${response.status}`);
    return data as T;
  }

  async function refresh() {
    setLoading(true); setError('');
    try {
      // Each dependency is resolved independently. Sale returns, warehouses and purchase returns
      // sit behind sale.return, master_data.view and purchase.return, while the commerce
      // workspace gate is order|sale|shipment|payment — so a CASHIER legitimately fails two of
      // these. In a bare Promise.all that single 403 rejected all thirteen and replaced the whole
      // workspace with ErrorState, for the role that uses it most. readOptional degrades only an
      // authorization failure, and only to an empty slice; the controller still enforces.
      const [sr, ort, prt, gr, tr, op, wh, pr, ba, se, lo, transit, reorder] = await Promise.all([
        // The returns endpoints are role-gated as well as permission-gated: GET /returns/sales
        // allows CASHIER|WAREHOUSE|FINANCE and GET /returns/orders allows WAREHOUSE|FINANCE, both
        // behind sale.return. MANAGER has neither, so these degrade to empty for them.
        // The path literal is passed whole, query string included, because the permission lookup
        // strips at '?' and existing contract tests match the literal route.
        readOptional(identity, '/returns/sales?limit=50', [] as CursorResponse<SaleReturn>, (p) => api<CursorResponse<SaleReturn>>(p)),
        readOptional(identity, '/returns/orders', [] as CursorResponse<OrderReturn>, (p) => api<CursorResponse<OrderReturn>>(p)),
        readOptional(identity, '/returns/purchases?limit=50', [] as CursorResponse<PurchaseReturn>, (p) => api<CursorResponse<PurchaseReturn>>(p)),
        api<CursorResponse<GoodsReceipt>>('/goods-receipts?limit=100'),
        api<CursorResponse<Transfer>>('/advanced-inventory/stock-transfers'),
        // Stock opnames are @Roles(WAREHOUSE|AUDITOR) behind inventory.adjust, so a CASHIER or
        // FINANCE operator legitimately cannot list them even though they pass the commerce gate.
        readOptional(identity, '/advanced-inventory/stock-opnames', [] as CursorResponse<Opname>, (p) => api<CursorResponse<Opname>>(p)),
        readOptional(identity, '/master-data/warehouses', [] as CursorResponse<Warehouse>, (p) => api<CursorResponse<Warehouse>>(p)),
        api<CursorResponse<Product>>('/products?limit=200'),
        api<CursorResponse<InventoryBatch>>('/inventory-batches'),
        api<CursorResponse<InventorySerial>>('/inventory-serials'),
        readOptional(identity, '/master-data/warehouse-locations', [] as CursorResponse<WarehouseLocation>, (p) => api<CursorResponse<WarehouseLocation>>(p)),
        api<TransitBalance[]>('/advanced-inventory/transit-balances'),
        api<ReorderVisibility[]>('/advanced-inventory/reorder-visibility'),
      ]);
      const warehouseRows = rowsOf(wh).filter((row) => row.isActive !== false);
      const productRows = rowsOf(pr);
      const receiptRows = rowsOf(gr).filter((row) => ['CONFIRMED','PARTIALLY_ACCEPTED'].includes(row.operationalStatus));
      const locationRows = rowsOf(lo).filter((row) => row.isActive !== false);
      setSaleReturns(rowsOf(sr)); setOrderReturns(rowsOf(ort)); setPurchaseReturns(rowsOf(prt)); setGoodsReceipts(receiptRows); setTransfers(rowsOf(tr)); setOpnames(rowsOf(op)); setWarehouses(warehouseRows); setProducts(productRows); setBatches(rowsOf(ba)); setSerials(rowsOf(se)); setLocations(locationRows); setTransitBalances(transit); setReorderVisibility(reorder);
      setPurchaseReturnForm((value) => {
        const receiptId = value.goodsReceiptId || receiptRows[0]?.id || '';
        const receipt = receiptRows.find((row) => row.id === receiptId);
        const itemId = value.goodsReceiptItemId && receipt?.items.some((item) => item.id === value.goodsReceiptItemId) ? value.goodsReceiptItemId : receipt?.items[0]?.id || '';
        return { ...value, goodsReceiptId: receiptId, goodsReceiptItemId: itemId };
      });
      setTransferForm((value) => ({
        ...value,
        sourceWarehouseId: value.sourceWarehouseId || warehouseRows[0]?.id || '',
        destinationWarehouseId: value.destinationWarehouseId || warehouseRows.find((row) => row.id !== (value.sourceWarehouseId || warehouseRows[0]?.id))?.id || '',
        productId: value.productId || productRows[0]?.id || '',
      }));
      setOpnameWarehouseId((value) => value || warehouseRows[0]?.id || '');
      setLocationWarehouseId((value) => value || warehouseRows[0]?.id || '');
      setRelocationForm((value) => ({ ...value, productId:value.productId || productRows[0]?.id || '' }));
      setConditionProductId((value) => value || productRows[0]?.id || '');
      const batchProducts = productRows.filter((row) => row.trackBatch);
      const serialProducts = productRows.filter((row) => row.trackSerial);
      setBatchForm((value) => ({ ...value, warehouseId: value.warehouseId || warehouseRows[0]?.id || '', productId: value.productId || batchProducts[0]?.id || '' }));
      setSerialForm((value) => ({ ...value, warehouseId: value.warehouseId || warehouseRows[0]?.id || '', productId: value.productId || serialProducts[0]?.id || '' }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Data operasional gagal dimuat.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [token]);

  useEffect(() => {
    if (!locationWarehouseId) { setLocationBalances([]); return; }
    let cancelled = false;
    void api<CursorResponse<LocationBalance>>(`/advanced-inventory/location-balances?warehouseId=${encodeURIComponent(locationWarehouseId)}`).then((value) => {
      if (!cancelled) setLocationBalances(rowsOf(value));
    }).catch((err) => { if (!cancelled) setMessage(err instanceof Error ? err.message : 'Saldo lokasi gagal dimuat.'); });
    return () => { cancelled = true; };
  }, [locationWarehouseId, token]);

  useEffect(() => {
    if (!locationWarehouseId || !conditionProductId) { setConditionBalances([]); return; }
    let cancelled = false;
    const query = `/advanced-inventory/condition-balances?warehouseId=${encodeURIComponent(locationWarehouseId)}&productId=${encodeURIComponent(conditionProductId)}`;
    void api<ConditionBalance[]>(query).then((value) => {
      if (cancelled) return;
      setConditionBalances(value);
      const availableSource = value.find((row) => row.quantity > 0);
      setConditionForm((form) => ({ ...form, locationId: value.some((row) => row.locationId === form.locationId && row.condition === form.fromCondition && row.quantity > 0) ? form.locationId : availableSource?.locationId ?? '' }));
    }).catch((err) => { if (!cancelled) setMessage(err instanceof Error ? err.message : 'Saldo kondisi inventory gagal dimuat.'); });
    return () => { cancelled = true; };
  }, [locationWarehouseId, conditionProductId, token]);

  const warehouseById = useMemo(() => new Map(warehouses.map((row) => [row.id, row])), [warehouses]);
  const productById = useMemo(() => new Map(products.map((row) => [row.id, row])), [products]);
  const selectedOpname = opnames.find((row) => row.id === selectedOpnameId);
  const locationOptions = locations.filter((row) => row.warehouseId === locationWarehouseId);
  const opnameLocationOptions = locations.filter((row) => row.warehouseId === opnameWarehouseId);
  const conditionSourceRows = conditionBalances.filter((row) => row.condition === conditionForm.fromCondition && row.quantity > 0);

  async function run(key: string, work: () => Promise<string | void>) {
    if (busyKey) return;
    setBusyKey(key); setMessage('');
    try {
      const result = await work();
      if (result) setMessage(result);
      await refresh();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Operasi gagal.'); }
    finally { setBusyKey(''); }
  }

  async function confirmSaleReturn(row: SaleReturn) {
    if (!['REQUESTED','APPROVED'].includes(row.status)) return;
    await run(`return:${row.id}`, async () => {
      await api(`/returns/sales/${row.id}/confirm`, {
        method: 'POST', body: JSON.stringify({ inspectionId: row.inspectionId ?? undefined, notes: 'Refund diselesaikan dari modul Retur & Transfer setelah inspeksi.' }),
      });
      return `Retur ${row.number} selesai. Refund, stok, loyalitas, pajak, dan jurnal telah diposting server.`;
    });
  }

  async function startOrderReturnInspection(row: OrderReturn) {
    await run(`order-return:${row.id}:inspection`, async () => {
      await api(`/returns/orders/${row.id}/inspection`, { method: 'POST' });
      return `Inspeksi retur online ${row.number} dibuat. Selesaikan di Kontrol Operasional sebelum refund.`;
    });
  }

  async function confirmOrderReturn(row: OrderReturn) {
    await run(`order-return:${row.id}:confirm`, async () => {
      await api(`/returns/orders/${row.id}/confirm`, { method: 'POST', body: JSON.stringify({ refundMethod: row.refundMethod ?? 'ORIGINAL', notes: 'Refund order online diposting dari Admin setelah inspeksi inbound APPROVED.' }) });
      return `Retur order ${row.number} selesai. Refund/reversal stok, pajak, dan jurnal telah diposting server.`;
    });
  }

  async function rejectOrderReturn(event: FormEvent) {
    event.preventDefault();
    const row = orderReturns.find((item) => item.id === rejectOrderReturnId);
    const reason = rejectOrderReturnReason.trim();
    if (!row || !reason) return;
    await run(`order-return:${row.id}:reject`, async () => {
      await api(`/returns/orders/${row.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
      setRejectOrderReturnId(''); setRejectOrderReturnReason('');
      return `Retur order ${row.number} ditolak.`;
    });
  }

  async function createPurchaseReturn(event: FormEvent) {
    event.preventDefault();
    await run('purchase-return:create', async () => {
      const receipt = goodsReceipts.find((row) => row.id === purchaseReturnForm.goodsReceiptId);
      const item = receipt?.items.find((row) => row.id === purchaseReturnForm.goodsReceiptItemId);
      if (!receipt || !item) throw new Error('Pilih penerimaan dan item yang akan diretur.');
      if (!Number.isInteger(purchaseReturnForm.quantity) || purchaseReturnForm.quantity < 1 || purchaseReturnForm.quantity > item.acceptedQty) {
        throw new Error(`Jumlah retur harus 1 sampai ${item.acceptedQty}. Server tetap memvalidasi sisa retur kumulatif.`);
      }
      const row = await api<PurchaseReturn>('/returns/purchases', {
        method: 'POST',
        body: JSON.stringify({
          goodsReceiptId: receipt.id,
          reason: purchaseReturnForm.reason || undefined,
          supplierCreditNoteNumber: purchaseReturnForm.supplierCreditNoteNumber || undefined,
          idempotencyKey: `admin-purchase-return-${receipt.id}-${item.id}-${purchaseReturnForm.quantity}`,
          items: [{ goodsReceiptItemId: item.id, quantity: purchaseReturnForm.quantity, reason: purchaseReturnForm.reason || undefined }],
        }),
      });
      setPurchaseReturnForm((value) => ({ ...value, quantity: 1, reason: '', supplierCreditNoteNumber: '' }));
      return `Retur supplier ${row.number} dibuat. Selesaikan inspeksi outbound di Kontrol Operasional sebelum posting retur.`;
    });
  }

  async function confirmPurchaseReturn(row: PurchaseReturn) {
    await run(`purchase-return:${row.id}`, async () => {
      await api(`/returns/purchases/${row.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ inspectionId: row.inspectionId ?? undefined, supplierCreditNoteNumber: row.supplierCreditNoteNumber ?? undefined, notes: 'Retur supplier diposting dari Admin setelah pemeriksaan outbound.' }),
      });
      return `Retur supplier ${row.number} selesai. Stok, utang/piutang refund supplier, pajak, dan jurnal telah diposting server.`;
    });
  }

  async function createTransfer(event: FormEvent) {
    event.preventDefault();
    await run('transfer:create', async () => {
      if (!transferForm.sourceWarehouseId || !transferForm.destinationWarehouseId || !transferForm.productId) throw new Error('Pilih gudang asal, tujuan, dan produk.');
      if (transferForm.sourceWarehouseId === transferForm.destinationWarehouseId) throw new Error('Gudang asal dan tujuan harus berbeda.');
      if (!Number.isInteger(transferForm.quantity) || transferForm.quantity < 1) throw new Error('Jumlah transfer minimal 1.');
      const product = productById.get(transferForm.productId);
      const serialNumbers = transferForm.serialText.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
      if (product?.trackBatch && !transferForm.batchNumber.trim()) throw new Error('Produk ini memakai batch; pilih nomor batch.');
      if (product?.trackSerial && serialNumbers.length !== transferForm.quantity) throw new Error(`Produk serial membutuhkan ${transferForm.quantity} serial.`);
      const row = await api<Transfer>('/advanced-inventory/stock-transfers', {
        method: 'POST', body: JSON.stringify({ sourceWarehouseId: transferForm.sourceWarehouseId, destinationWarehouseId: transferForm.destinationWarehouseId, notes: transferForm.notes || undefined, items: [{ productId: transferForm.productId, quantity: transferForm.quantity, batchNumber: transferForm.batchNumber.trim() || undefined, serialNumbers: serialNumbers.length ? serialNumbers : undefined }] }),
      });
      setTransferForm((value) => ({ ...value, quantity: 1, batchNumber: '', serialText: '', notes: '' }));
      return `Transfer ${row.number} dibuat dan menunggu approval.`;
    });
  }

  async function transferAction(row: Transfer, action: 'approve' | 'ship' | 'receive') {
    await run(`transfer:${row.id}:${action}`, async () => {
      if (action === 'receive') {
        const items = row.items.map((item) => ({ transferItemId: item.id, receivedQty: Math.max(0, item.shippedQty - item.receivedQty) })).filter((item) => item.receivedQty > 0);
        if (!items.length) throw new Error('Tidak ada quantity dalam perjalanan yang tersisa untuk diterima.');
        await api(`/advanced-inventory/stock-transfers/${row.id}/receive`, { method: 'PATCH', body: JSON.stringify({ items, notes: 'Penerimaan seluruh sisa quantity dari Admin.' }) });
      } else {
        await api(`/advanced-inventory/stock-transfers/${row.id}/${action}`, { method: 'PATCH' });
      }
      return `Transfer ${row.number}: ${action} berhasil.`;
    });
  }

  async function createOpname(event: FormEvent) {
    event.preventDefault();
    await run('opname:create', async () => {
      if (!opnameWarehouseId) throw new Error('Pilih gudang untuk stock opname.');
      const row = await api<Opname>('/advanced-inventory/stock-opnames', { method: 'POST', body: JSON.stringify({ warehouseId: opnameWarehouseId, locationId: opnameLocationId || undefined, notes: opnameLocationId ? 'Stock opname lokasi dibuat dari Admin.' : 'Stock opname seluruh gudang dibuat dari Admin.' }) });
      setSelectedOpnameId(row.id);
      setCounts(Object.fromEntries(row.items.map((item) => [item.id, String(item.systemQty)])));
      return `Stock opname ${row.number} dibuat. Masukkan hasil hitung fisik.`;
    });
  }

  function editCounts(row: Opname) {
    setSelectedOpnameId(row.id);
    setCounts(Object.fromEntries(row.items.map((item) => [item.id, String(item.countedQty ?? item.systemQty)])));
    setMessage(`Menghitung ${row.number}. Nilai awal diisi sesuai system quantity; ubah sesuai hitung fisik.`);
  }

  async function saveCounts(row: Opname) {
    await run(`opname:${row.id}:count`, async () => {
      const items = row.items.map((item) => {
        const raw = counts[item.id];
        const countedQty = Number(raw);
        if (!Number.isInteger(countedQty) || countedQty < 0) throw new Error(`Hasil hitung ${productById.get(item.productId)?.name ?? item.productId} harus bilangan bulat >= 0.`);
        return { opnameItemId: item.id, countedQty, ...(countedQty !== item.systemQty ? { reason: 'Hasil hitung fisik berbeda dari sistem.' } : {}) };
      });
      await api(`/advanced-inventory/stock-opnames/${row.id}/count`, { method: 'PATCH', body: JSON.stringify({ items }) });
      return `Hasil hitung ${row.number} disimpan.`;
    });
  }

  async function opnameAction(row: Opname, action: 'submit' | 'complete') {
    await run(`opname:${row.id}:${action}`, async () => {
      await api(`/advanced-inventory/stock-opnames/${row.id}/${action}`, { method: 'PATCH' });
      if (action === 'complete') { setSelectedOpnameId(''); setCounts({}); }
      return action === 'submit' ? `${row.number} diajukan untuk approval.` : `${row.number} selesai; movement dan jurnal penyesuaian diposting.`;
    });
  }

  async function relocateStock(event: FormEvent) {
    event.preventDefault();
    await run('location:relocate', async () => {
      if (!locationWarehouseId || !relocationForm.productId || !relocationForm.sourceLocationId || !relocationForm.destinationLocationId) throw new Error('Gudang, produk, lokasi asal, dan lokasi tujuan wajib dipilih.');
      if (relocationForm.sourceLocationId === relocationForm.destinationLocationId) throw new Error('Lokasi asal dan tujuan harus berbeda.');
      if (!Number.isInteger(relocationForm.quantity) || relocationForm.quantity < 1) throw new Error('Jumlah relokasi minimal 1.');
      await api('/advanced-inventory/location-relocations', { method:'POST', body:JSON.stringify({ warehouseId:locationWarehouseId, productId:relocationForm.productId, sourceLocationId:relocationForm.sourceLocationId, destinationLocationId:relocationForm.destinationLocationId, quantity:relocationForm.quantity, notes:relocationForm.notes || undefined }) });
      const fresh = await api<CursorResponse<LocationBalance>>(`/advanced-inventory/location-balances?warehouseId=${encodeURIComponent(locationWarehouseId)}`);
      setLocationBalances(rowsOf(fresh));
      setRelocationForm((value) => ({ ...value, quantity:1, notes:'' }));
      return 'Relokasi stok antar-lokasi berhasil. Total stok gudang tidak berubah.';
    });
  }

  async function moveCondition(event: FormEvent) {
    event.preventDefault();
    await run('condition:move', async () => {
      if (!locationWarehouseId || !conditionProductId || !conditionForm.locationId) throw new Error('Gudang, produk, dan lokasi kondisi wajib dipilih.');
      if (conditionForm.fromCondition === conditionForm.toCondition) throw new Error('Kondisi asal dan tujuan harus berbeda.');
      if (!Number.isInteger(conditionForm.quantity) || conditionForm.quantity < 1) throw new Error('Jumlah perubahan kondisi minimal 1.');
      await api('/advanced-inventory/condition-movements', { method:'POST', body:JSON.stringify({ warehouseId:locationWarehouseId, productId:conditionProductId, locationId:conditionForm.locationId, fromCondition:conditionForm.fromCondition, toCondition:conditionForm.toCondition, quantity:conditionForm.quantity, notes:conditionForm.notes || undefined }) });
      const fresh = await api<ConditionBalance[]>(`/advanced-inventory/condition-balances?warehouseId=${encodeURIComponent(locationWarehouseId)}&productId=${encodeURIComponent(conditionProductId)}`);
      setConditionBalances(fresh);
      setConditionForm((value) => ({ ...value, quantity:1, notes:'' }));
      return `Kondisi stok ${conditionForm.fromCondition} → ${conditionForm.toCondition} berhasil. Stok fisik tetap, sellable stock disesuaikan server.`;
    });
  }

  async function createBatch(event: FormEvent) {
    event.preventDefault();
    await run('batch:create', async () => {
      if (!batchForm.warehouseId || !batchForm.productId || !batchForm.batchNumber.trim()) throw new Error('Gudang, produk, dan nomor batch wajib diisi.');
      await api('/inventory-batches', { method:'POST', body:JSON.stringify({ warehouseId:batchForm.warehouseId, productId:batchForm.productId, batchNumber:batchForm.batchNumber.trim(), producedAt:batchForm.producedAt || undefined, expiryDate:batchForm.expiryDate || undefined, quantity:0 }) });
      setBatchForm((value) => ({ ...value, batchNumber:'', producedAt:'', expiryDate:'' }));
      return 'Batch berhasil dipraregistrasi dengan quantity 0. Kuantitas hanya bertambah melalui movement inventory canonical.';
    });
  }

  async function createSerial(event: FormEvent) {
    event.preventDefault();
    await run('serial:create', async () => {
      if (!serialForm.warehouseId || !serialForm.productId || !serialForm.serialNumber.trim()) throw new Error('Gudang, produk, dan nomor serial wajib diisi.');
      await api('/inventory-serials', { method:'POST', body:JSON.stringify({ warehouseId:serialForm.warehouseId, productId:serialForm.productId, serialNumber:serialForm.serialNumber.trim() }) });
      setSerialForm((value) => ({ ...value, serialNumber:'' }));
      return 'Serial berhasil diregistrasi terhadap stok fisik yang sudah diposting.';
    });
  }

  if (error) return <ErrorState message={`Data retur/transfer/opname tidak dapat dimuat: ${error}`} />;

  return (
    <>
      {mode === 'traceability' && <section className="grid2">
        <Panel eyebrow="TRACEABILITY" title="Batch / Expiry" badge={`${batches.length} batch`}>
          <form className="formStack" onSubmit={createBatch}>
            <label>Gudang<select required value={batchForm.warehouseId} onChange={(e)=>setBatchForm({...batchForm,warehouseId:e.target.value})}>{warehouses.map((w)=><option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
            <label>Produk batch<select required value={batchForm.productId} onChange={(e)=>setBatchForm({...batchForm,productId:e.target.value})}><option value="">Pilih produk</option>{products.filter((p)=>p.trackBatch).map((p)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
            <label>Nomor batch<input required value={batchForm.batchNumber} onChange={(e)=>setBatchForm({...batchForm,batchNumber:e.target.value})}/></label>
            <label>Tanggal produksi<input type="date" value={batchForm.producedAt} onChange={(e)=>setBatchForm({...batchForm,producedAt:e.target.value})}/></label>
            <label>Kedaluwarsa{productById.get(batchForm.productId)?.trackExpiry?' (wajib)':''}<input required={Boolean(productById.get(batchForm.productId)?.trackExpiry)} type="date" value={batchForm.expiryDate} onChange={(e)=>setBatchForm({...batchForm,expiryDate:e.target.value})}/></label>
            {canAll('inventory.batch') && <button disabled={Boolean(busyKey)}>Praregistrasi batch</button>}
          </form>
          <Table head={['Batch','Produk','Gudang','Qty / Reserved','Expiry','Status']} rows={batches.slice(0,40).map((b)=>{const expired=Boolean(b.expiryDate&&new Date(b.expiryDate).getTime()<=Date.now());return [<strong>{b.batchNumber}</strong>,productById.get(b.productId)?.sku??b.productId,warehouseById.get(b.warehouseId)?.code??'-',`${b.quantity} / ${b.reserved}`,b.expiryDate?tanggal(b.expiryDate):'-',<StatusChip status={expired?'EXPIRED':'ACTIVE'}/>];})} empty="Belum ada batch." />
          <p className="sectionHelp">Praregistrasi tidak menambah stok. Kuantitas batch hanya boleh berasal dari penerimaan/retur/transfer/movement canonical.</p>
        </Panel>
        <Panel eyebrow="TRACEABILITY" title="Serial Number" badge={`${serials.length} serial`}>
          <form className="formStack" onSubmit={createSerial}>
            <label>Gudang<select required value={serialForm.warehouseId} onChange={(e)=>setSerialForm({...serialForm,warehouseId:e.target.value})}>{warehouses.map((w)=><option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
            <label>Produk serial<select required value={serialForm.productId} onChange={(e)=>setSerialForm({...serialForm,productId:e.target.value})}><option value="">Pilih produk</option>{products.filter((p)=>p.trackSerial).map((p)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
            <label>Nomor serial<input required value={serialForm.serialNumber} onChange={(e)=>setSerialForm({...serialForm,serialNumber:e.target.value})}/></label>
            {canAll('inventory.serial') && <button disabled={Boolean(busyKey)}>Registrasi serial</button>}
          </form>
          <Table head={['Serial','Produk','Gudang','Status']} rows={serials.slice(0,40).map((x)=>[<strong>{x.serialNumber}</strong>,productById.get(x.productId)?.sku??x.productId,warehouseById.get(x.warehouseId)?.code??'-',<StatusChip status={x.status}/>])} empty="Belum ada serial." />
          <p className="sectionHelp">Server menolak serial untuk produk non-serial dan menolak jumlah serial fisik melebihi stok inventory yang sudah diposting.</p>
        </Panel>
      </section>}

      <section className="grid2">
        {mode === 'returns' && <Panel eyebrow="RETUR" title="Retur Penjualan" badge={loading ? 'memuat' : `${saleReturns.length} retur`}>
          <Table loading={loading} head={['Nomor', 'Refund', 'Nilai', 'Status', 'Tindakan']} rows={saleReturns.map((r) => [
            <strong>{r.number}</strong>, r.refundMethod ?? '-', rupiah(r.refundAmount ?? 0), <StatusChip status={r.status ?? '-'} />,
            ['REQUESTED','APPROVED'].includes(r.status) ? canAll('sale.refund') ? <button type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void confirmSaleReturn(r)}>{busyKey === `return:${r.id}` ? 'Memproses…' : 'Selesaikan refund'}</button> : <span>-</span> : <span>-</span>,
          ])} empty="Belum ada retur penjualan." />
        </Panel>}

        {mode === 'returns' && <Panel eyebrow="ONLINE RETURN" title="Retur Pesanan Storefront" badge={loading ? 'memuat' : `${orderReturns.length} retur`}>
          <Table loading={loading} head={['Nomor / Order', 'Customer', 'Nilai', 'Status', 'Tindakan']} rows={orderReturns.map((r) => {
            const actions: React.ReactNode[] = [];
            if (r.status === 'REQUESTED' && canAll('sale.return')) actions.push(<button key="inspect" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void startOrderReturnInspection(r)}>Mulai inspeksi</button>);
            if (['INSPECTION','APPROVED'].includes(r.status) && canAll('sale.refund')) actions.push(<button key="confirm" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void confirmOrderReturn(r)}>Posting refund</button>);
            if (['REQUESTED','INSPECTION'].includes(r.status) && canAll('sale.return')) actions.push(<button key="reject" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => { setRejectOrderReturnId(r.id); setRejectOrderReturnReason(''); }}>Tolak</button>);
            return [<><strong>{r.number}</strong><small className="blockMeta">{r.order.number}</small></>, r.customer?.name ?? r.order.customerName, rupiah(Number(r.refundAmount ?? 0)), <StatusChip status={r.status} />, <div className="rowActions">{actions.length ? actions : '-'}</div>];
          })} empty="Belum ada retur order storefront." />
          {rejectOrderReturnId && canAll('sale.return') && <form className="formStack" onSubmit={rejectOrderReturn}><label>Alasan penolakan<input required maxLength={1000} value={rejectOrderReturnReason} onChange={(e) => setRejectOrderReturnReason(e.target.value)} /></label><div className="rowActions"><button disabled={Boolean(busyKey)}>Konfirmasi tolak</button><button type="button" className="secondary" onClick={() => { setRejectOrderReturnId(''); setRejectOrderReturnReason(''); }}>Batal</button></div></form>}
          <p className="sectionHelp">Customer mengajukan retur dari akun Storefront. Staff memulai inspeksi inbound, Kontrol Operasional memverifikasi barang, lalu Finance/Warehouse memposting refund dan reversal.</p>
        </Panel>}

        {mode === 'transfers' && <Panel eyebrow="TRANSFER BARU" title="Pindah Stok Antar-Gudang" badge="workflow approval">
          <form className="formStack" onSubmit={createTransfer}>
            <label>Gudang asal<select required value={transferForm.sourceWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, sourceWarehouseId: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
            <label>Gudang tujuan<select required value={transferForm.destinationWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, destinationWarehouseId: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
            <label>Produk<select required value={transferForm.productId} onChange={(e) => setTransferForm({ ...transferForm, productId: e.target.value, batchNumber:'', serialText:'' })}>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
            <label>Jumlah<input required type="number" min="1" step="1" value={transferForm.quantity} onChange={(e) => setTransferForm({ ...transferForm, quantity: Number(e.target.value) })} /></label>
            {productById.get(transferForm.productId)?.trackBatch && <label>Batch<select required value={transferForm.batchNumber} onChange={(e)=>setTransferForm({...transferForm,batchNumber:e.target.value})}><option value="">Pilih batch</option>{batches.filter((b)=>b.warehouseId===transferForm.sourceWarehouseId&&b.productId===transferForm.productId&&b.quantity>b.reserved).map((b)=><option key={b.id} value={b.batchNumber}>{b.batchNumber} · tersedia {b.quantity-b.reserved}{b.expiryDate?` · exp ${tanggal(b.expiryDate)}`:''}</option>)}</select></label>}
            {productById.get(transferForm.productId)?.trackSerial && <label>Serial transfer <small>(satu per baris/koma)</small><textarea required value={transferForm.serialText} onChange={(e)=>setTransferForm({...transferForm,serialText:e.target.value})} placeholder="SN001&#10;SN002" /></label>}
            <label>Catatan<input value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} /></label>
            {canAll('inventory.transfer') && <button disabled={Boolean(busyKey)}>{busyKey === 'transfer:create' ? 'Membuat…' : 'Buat transfer'}</button>}
          </form>
        </Panel>}
      </section>

      {mode === 'returns' && <section className="grid2">
        <Panel eyebrow="RETUR SUPPLIER" title="Buat Retur Pembelian" badge="inspection required">
          <form className="formStack" onSubmit={createPurchaseReturn}>
            <label>Penerimaan barang<select required value={purchaseReturnForm.goodsReceiptId} onChange={(e) => { const receipt = goodsReceipts.find((row) => row.id === e.target.value); setPurchaseReturnForm({ ...purchaseReturnForm, goodsReceiptId: e.target.value, goodsReceiptItemId: receipt?.items[0]?.id ?? '' }); }}>
              <option value="">Pilih penerimaan</option>{goodsReceipts.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.supplier?.name ?? 'Supplier'} · {r.warehouse?.code ?? '-'}</option>)}
            </select></label>
            <label>Item<select required value={purchaseReturnForm.goodsReceiptItemId} onChange={(e) => setPurchaseReturnForm({ ...purchaseReturnForm, goodsReceiptItemId: e.target.value })}>
              <option value="">Pilih item</option>{(goodsReceipts.find((row) => row.id === purchaseReturnForm.goodsReceiptId)?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.product?.sku ?? item.productId} · {item.product?.name ?? 'Produk'} · accepted {item.acceptedQty}</option>)}
            </select></label>
            <label>Jumlah<input required type="number" min="1" step="1" value={purchaseReturnForm.quantity} onChange={(e) => setPurchaseReturnForm({ ...purchaseReturnForm, quantity: Number(e.target.value) })} /></label>
            <label>Alasan<input value={purchaseReturnForm.reason} onChange={(e) => setPurchaseReturnForm({ ...purchaseReturnForm, reason: e.target.value })} /></label>
            <label>Credit note supplier <small>(boleh nanti bila belum tersedia)</small><input value={purchaseReturnForm.supplierCreditNoteNumber} onChange={(e) => setPurchaseReturnForm({ ...purchaseReturnForm, supplierCreditNoteNumber: e.target.value })} /></label>
            {canAll('purchase.return') && <button disabled={Boolean(busyKey)}>{busyKey === 'purchase-return:create' ? 'Membuat…' : 'Buat retur supplier'}</button>}
          </form>
        </Panel>

        <Panel eyebrow="PURCHASE RETURN" title="Retur Pembelian / Supplier" badge={loading ? 'memuat' : `${purchaseReturns.length} retur`}>
          <Table loading={loading} head={['Nomor', 'Nilai', 'Credit Note', 'Status', 'Tindakan']} rows={purchaseReturns.map((r) => [
            <strong>{r.number}</strong>, rupiah(Number(r.amount ?? 0)), r.supplierCreditNoteNumber ?? '-', <StatusChip status={r.status} />,
            ['REQUESTED','APPROVED'].includes(r.status) ? canAll('purchase.return') ? <button type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void confirmPurchaseReturn(r)}>{busyKey === `purchase-return:${r.id}` ? 'Memproses…' : 'Posting retur'}</button> : <span>-</span> : <span>-</span>,
          ])} empty="Belum ada retur pembelian." />
          <p className="sectionHelp">Retur baru membuat pemeriksaan outbound. Selesaikan pemeriksaan di Kontrol Operasional dahulu. Server menolak posting bila inspeksi belum lulus atau stok tidak cukup.</p>
        </Panel>
      </section>}

      {mode === 'transfers' && <Panel eyebrow="GUDANG" title="Transfer Stok Antar-Gudang" badge={loading ? 'memuat' : `${transfers.length} transfer`}>
        <Table loading={loading} head={['Nomor', 'Rute', 'Item', 'Tanggal', 'Status', 'Tindakan']} rows={transfers.map((t) => {
          const source = warehouseById.get(t.sourceWarehouseId); const destination = warehouseById.get(t.destinationWarehouseId);
          const itemText = t.items.map((item) => `${productById.get(item.productId)?.sku ?? item.productId}: ${item.receivedQty}/${item.shippedQty || item.quantity}`).join(', ');
          const actions: React.ReactNode[] = [];
          if (canAll('inventory.transfer')) {
            if (['DRAFT','REQUESTED'].includes(t.status)) actions.push(<button key="approve" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void transferAction(t, 'approve')}>Approve</button>);
            if (t.status === 'APPROVED') actions.push(<button key="ship" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void transferAction(t, 'ship')}>Ship</button>);
            if (['SHIPPED','PARTIALLY_RECEIVED'].includes(t.status)) actions.push(<button key="receive" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void transferAction(t, 'receive')}>Terima sisa</button>);
          }
          return [<strong>{t.number}</strong>, `${source?.code ?? '?'} → ${destination?.code ?? '?'}`, <small>{itemText || '-'}</small>, tanggal(t.createdAt), <StatusChip status={t.status} />, <div className="rowActions">{actions.length ? actions : '-'}</div>];
        })} empty="Belum ada transfer." />
        <p className="sectionHelp">Ship mengurangi stok gudang asal dan memindahkannya ke in-transit. Receive menambah stok tujuan. Semua movement dan accounting event diposting server.</p>
      </Panel>}

      <section className="grid2">
        {mode === 'transfers' && <Panel eyebrow="IN-TRANSIT" title="Stok Dalam Perjalanan" badge={`${transitBalances.reduce((sum,row)=>sum+row.quantity,0)} unit`}>
          <Table head={['Transfer','Rute','Produk','Batch / Serial','Qty']} rows={transitBalances.map((row)=>[<strong>{row.number}</strong>,`${warehouseById.get(row.sourceWarehouseId)?.code??'?'} → ${warehouseById.get(row.destinationWarehouseId)?.code??'?'}`,productById.get(row.productId)?.sku??row.productId,row.batchNumber?`${row.batchNumber}${row.serialCount?` · ${row.serialCount} serial`:''}`:(row.serialCount?`${row.serialCount} serial`:'-'),row.quantity])} empty="Tidak ada stok IN_TRANSIT." />
          <p className="sectionHelp">IN_TRANSIT dihitung dari ledger StockTransfer (shippedQty − receivedQty), bukan disimpan sebagai stok gudang agar quantity tidak terhitung ganda.</p>
        </Panel>}
        {mode === 'overview' && <Panel eyebrow="REORDER" title="Minimum Stok & Reorder Visibility" badge={`${reorderVisibility.filter((row)=>row.shortage>0).length} shortage`}>
          <Table head={['Gudang','Produk','Available','Min','Inbound','Projected','Shortage','Laju/hari','Habis dalam','Lead time','Pesan','Dasar rekomendasi']}
            rows={reorderVisibility.map((row)=>{ const f=row.forecast; return [
              row.warehouse.code,`${row.product.sku} · ${row.product.name}`,row.available,row.minStock,row.inboundInTransit,row.projectedAvailable,row.shortage,
              // "Belum terukur" BUKAN "0". Menampilkan 0 membuat produk yang belum pernah terjual
              // terlihat seperti barang mati - itu keputusan jual, bukan kesimpulan forecast.
              f.dailyDemand === null ? <span className="mutedText">belum terukur</span> : `${f.dailyDemand}/hari`,
              f.daysOfCover === null ? <span className="mutedText">—</span> : `${f.daysOfCover} hari`,
              `${f.leadTimeDays} hari${f.leadTimeIsAssumed ? ' *' : ''}`,
              f.recommendedPacks !== null ? `${f.recommendedPacks} pak (${f.orderQuantity})` : f.orderQuantity,
              <span className="mutedText">{f.basis}</span>,
            ]; })}
            empty="Tidak ada produk minimum-stock yang perlu ditinjau." />
          <p className="sectionHelp">Projected = available + inbound IN_TRANSIT. Shortage menghitung kebutuhan terhadap minimum stok tanpa menganggap stok outbound masih tersedia.</p>
          <p className="sectionHelp">Laju/hari diukur dari penjualan 30 hari terakhir; <strong>*</strong> menandai lead time yang diasumsikan karena belum ada riwayat purchase order. Rekomendasi memakai angka terbesar antara permintaan selama lead time dan minStock pemilik. Baris dengan laju "belum terukur" hanya memakai minStock.</p>
          {/* Alasan per baris ditampilkan, bukan hanya angka: rekomendasi yang tidak bisa dijelaskan
              adalah tebakan yang berpenampilan resmi. */}
          <details><summary>Alasan rekomendasi ({reorderVisibility.filter((row)=>row.forecast.drivers.length).length} baris)</summary>
            <ul>{reorderVisibility.map((row)=> row.forecast.drivers.length ? <li key={`${row.warehouseId}-${row.productId}`}><strong>{row.product.sku} · {row.warehouse.code}</strong>: {row.forecast.drivers.join(' · ')}</li> : null)}</ul>
          </details>
        </Panel>}
      </section>

      {mode === 'overview' && <section className="grid2">
        <Panel eyebrow="LOCATION INVENTORY" title="Saldo Stok per Lokasi" badge={`${locationBalances.length} saldo`}>
          <div className="formStack">
            <label>Gudang<select value={locationWarehouseId} onChange={(e) => { setLocationWarehouseId(e.target.value); setRelocationForm((value) => ({ ...value, sourceLocationId:'', destinationLocationId:'' })); }}>{warehouses.map((w)=><option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
          </div>
          <Table head={['Lokasi','Produk','Qty','Reserved','Available']} rows={locationBalances.map((row)=>[`${row.location?.code ?? row.locationId}${row.location?.isDefault ? ' · DEFAULT' : ''}`,row.product ? `${row.product.sku} · ${row.product.name}` : row.productId,row.quantity,row.reserved,row.available])} empty="Belum ada saldo lokasi. Saldo gudang lama dimaterialisasi otomatis pada akses location-aware pertama." />
        </Panel>
        <Panel eyebrow="LOCATION MOVE" title="Relokasi Dalam Gudang" badge="aggregate tetap">
          <form className="formStack" onSubmit={relocateStock}>
            <label>Produk<select required value={relocationForm.productId} onChange={(e)=>setRelocationForm({...relocationForm,productId:e.target.value})}><option value="">Pilih produk</option>{products.map((p)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
            <label>Lokasi asal<select required value={relocationForm.sourceLocationId} onChange={(e)=>setRelocationForm({...relocationForm,sourceLocationId:e.target.value})}><option value="">Pilih lokasi</option>{locationOptions.map((l)=><option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></label>
            <label>Lokasi tujuan<select required value={relocationForm.destinationLocationId} onChange={(e)=>setRelocationForm({...relocationForm,destinationLocationId:e.target.value})}><option value="">Pilih lokasi</option>{locationOptions.map((l)=><option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></label>
            <label>Jumlah<input type="number" min="1" step="1" value={relocationForm.quantity} onChange={(e)=>setRelocationForm({...relocationForm,quantity:Number(e.target.value)})}/></label>
            <label>Catatan<input value={relocationForm.notes} onChange={(e)=>setRelocationForm({...relocationForm,notes:e.target.value})}/></label>
            {canAll('inventory.transfer') && <button disabled={Boolean(busyKey)}>{busyKey==='location:relocate'?'Memindahkan…':'Relokasi stok'}</button>}
          </form>
          <p className="sectionHelp">Relokasi hanya memindahkan saldo antar bin/lokasi. Quantity warehouse aggregate, accounting, dan nilai persediaan tidak berubah.</p>
        </Panel>
      </section>}

      {mode === 'overview' && <section className="grid2">
        <Panel eyebrow="CONDITION CONTROL" title="Kondisi Stok per Lokasi" badge="sellable-aware">
          <div className="formStack">
            <label>Produk<select value={conditionProductId} onChange={(e)=>{setConditionProductId(e.target.value);setConditionForm((value)=>({...value,locationId:''}));}}><option value="">Pilih produk</option>{products.map((p)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
          </div>
          <Table head={['Lokasi','Kondisi','Quantity']} rows={conditionBalances.map((row)=>[row.location?`${row.location.code} · ${row.location.name}`:row.locationId,<StatusChip status={row.condition}/>,row.quantity])} empty="Belum ada saldo kondisi. Stok legacy akan dimaterialisasi sebagai AVAILABLE saat pertama diakses." />
          <p className="sectionHelp">AVAILABLE adalah stok sellable. DAMAGED, QUARANTINE, dan LOST tetap tercatat sebagai stok fisik terklasifikasi tetapi tidak dapat dipakai penjualan/reservasi.</p>
        </Panel>
        <Panel eyebrow="CONDITION MOVE" title="Ubah Kondisi Stok" badge="append-only audit">
          <form className="formStack" onSubmit={moveCondition}>
            <label>Kondisi asal<select value={conditionForm.fromCondition} onChange={(e)=>setConditionForm({...conditionForm,fromCondition:e.target.value as InventoryCondition,locationId:''})}><option value="AVAILABLE">AVAILABLE</option><option value="DAMAGED">DAMAGED</option><option value="QUARANTINE">QUARANTINE</option><option value="LOST">LOST</option></select></label>
            <label>Lokasi / saldo<select required value={conditionForm.locationId} onChange={(e)=>setConditionForm({...conditionForm,locationId:e.target.value})}><option value="">Pilih saldo</option>{conditionSourceRows.map((row)=><option key={row.id} value={row.locationId}>{row.location?.code ?? row.locationId} · {row.quantity} {row.condition}</option>)}</select></label>
            <label>Kondisi tujuan<select value={conditionForm.toCondition} onChange={(e)=>setConditionForm({...conditionForm,toCondition:e.target.value as InventoryCondition})}><option value="AVAILABLE">AVAILABLE</option><option value="DAMAGED">DAMAGED</option><option value="QUARANTINE">QUARANTINE</option><option value="LOST">LOST</option></select></label>
            <label>Jumlah<input type="number" min="1" step="1" value={conditionForm.quantity} onChange={(e)=>setConditionForm({...conditionForm,quantity:Number(e.target.value)})}/></label>
            <label>Catatan<input value={conditionForm.notes} onChange={(e)=>setConditionForm({...conditionForm,notes:e.target.value})} placeholder="Alasan rusak, karantina, hilang, atau release"/></label>
            {canAll('inventory.adjust') && <button disabled={Boolean(busyKey)}>{busyKey==='condition:move'?'Memproses…':'Ubah kondisi'}</button>}
          </form>
          <p className="sectionHelp">Server menolak pemindahan stok AVAILABLE yang sedang reserved. Setiap perubahan kondisi menghasilkan audit log, outbox event, dan condition movement immutable.</p>
        </Panel>
      </section>}

      {mode === 'stocktake' && <section className="grid2">
        <Panel eyebrow="STOCK OPNAME" title="Mulai Penghitungan Fisik" badge="branch scoped">
          <form className="formStack" onSubmit={createOpname}>
            <label>Gudang<select required value={opnameWarehouseId} onChange={(e) => { setOpnameWarehouseId(e.target.value); setOpnameLocationId(''); }}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
            <label>Lokasi <small>(kosong = seluruh gudang)</small><select value={opnameLocationId} onChange={(e)=>setOpnameLocationId(e.target.value)}><option value="">Seluruh gudang</option>{opnameLocationOptions.map((l)=><option key={l.id} value={l.id}>{l.code} · {l.name}{l.isDefault?' · DEFAULT':''}</option>)}</select></label>
            {canAll('inventory.opname') && <button disabled={Boolean(busyKey)}>{busyKey === 'opname:create' ? 'Membuat…' : 'Mulai stock opname'}</button>}
          </form>
          <p className="sectionHelp">Snapshot system quantity dibuat server. Setelah hitung fisik disimpan, submit dan approval akan membuat inventory movement serta jurnal selisih.</p>
        </Panel>

        <Panel eyebrow="GUDANG" title="Sesi Stock Opname" badge={loading ? 'memuat' : `${opnames.length} sesi`}>
          <Table loading={loading} head={['Nomor', 'Gudang', 'Dibuat', 'Status', 'Tindakan']} rows={opnames.map((o) => {
            const actions: React.ReactNode[] = [];
            if (canAll('inventory.opname')) {
              if (o.status === 'COUNTING') actions.push(<button key="count" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => editCounts(o)}>Hitung</button>);
              if (o.status === 'COUNTING' && o.items.length > 0 && o.items.every((item) => item.countedQty != null)) actions.push(<button key="submit" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void opnameAction(o, 'submit')}>Submit</button>);
              if (o.status === 'WAITING_APPROVAL') actions.push(<button key="complete" type="button" className="secondary" disabled={Boolean(busyKey)} onClick={() => void opnameAction(o, 'complete')}>Approve & posting</button>);
            }
            return [<strong>{o.number}</strong>, warehouseById.get(o.warehouseId)?.code ?? '-', tanggal(o.createdAt), <StatusChip status={o.status} />, <div className="rowActions">{actions.length ? actions : '-'}</div>];
          })} empty="Belum ada stock opname." />
        </Panel>
      </section>}

      {mode === 'stocktake' && selectedOpname && selectedOpname.status === 'COUNTING' && <Panel eyebrow="PHYSICAL COUNT" title={`Hitung ${selectedOpname.number}`} badge={`${selectedOpname.items.length} item`}>
        {selectedOpname.items.length === 0 ? <p className="sectionHelp">Gudang belum memiliki inventory yang dapat dihitung.</p> : <div className="formStack">
          {selectedOpname.items.map((item) => <label key={item.id}>{productById.get(item.productId)?.name ?? item.productId}{item.batchNumber?` · batch ${item.batchNumber}`:''} · sistem {item.systemQty}
            <input type="number" min="0" step="1" value={counts[item.id] ?? ''} onChange={(e) => setCounts((value) => ({ ...value, [item.id]: e.target.value }))} />
          </label>)}
          <div className="rowActions">{canAll('inventory.opname') && <button type="button" disabled={Boolean(busyKey)} onClick={() => void saveCounts(selectedOpname)}>{busyKey === `opname:${selectedOpname.id}:count` ? 'Menyimpan…' : 'Simpan hitung fisik'}</button>}<button type="button" className="secondary" onClick={() => setSelectedOpnameId('')}>Tutup</button></div>
        </div>}
      </Panel>}

      {message && <div className="notice">{message}</div>}
    </>
  );
}
