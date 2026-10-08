'use client';
import { authFetch } from '../auth-fetch';
// Asset & Fleet operations: master aset, lifecycle, maintenance planning, driver assignment, depreciation, vehicle, dan fuel.
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { ErrorState, Panel, Skeleton, Table, StatusChip, rupiah, tanggal } from '../ui';
import DeliveryLifecycle from './delivery-lifecycle';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type AssetCategory = { id: string; code: string; name: string; assetType: string; usefulLifeMonths?: number | null };
type Asset = { id: string; categoryId?: string; assetType?: string; code?: string; name: string; status?: string; warehouseId?: string | null; assignedEmployeeId?: string | null; locationName?: string | null; acquisitionCost?: number | string; accumulatedDepreciation?: number | string; bookValue?: number | string; acquisitionDate?: string };
type Maintenance = { id: string; number?: string; status: string; assetId: string; scheduledAt?: string; completedAt?: string; estimatedCost?: number | string; actualCost?: number | string; asset?: { code?: string; name: string } };
type MaintenancePlan = { id: string; assetId: string; code: string; name: string; scheduleType: string; intervalDays?: number | null; intervalOdometer?: number | null; nextDueDate?: string | null; nextDueOdometer?: number | null; autoCreateWorkOrder: boolean; isActive: boolean; asset?: { id: string; code?: string; name: string } };
type Vehicle = { id: string; assetId?: string | null; code: string; plateNumber?: string; vehicleType?: string; status?: string; currentOdometer?: number; defaultDriverEmployeeId?: string | null };
type DriverAssignment = { id: string; vehicleId: string; employeeId: string; effectiveFrom: string; effectiveTo?: string | null; isPrimary: boolean; notes?: string | null; vehicle?: { id: string; code: string; plateNumber?: string }; employee?: { id: string; employeeNumber?: string; fullName: string; isActive?: boolean } };
type Employee = { id: string; employeeNumber?: string; fullName: string; isActive?: boolean };
type Warehouse = { id: string; code?: string; name: string; isActive?: boolean };
type Trip = { id: string; number: string; status: string; createdAt: string; codExpected?: number | string; codCollected?: number | string };
type Fuel = { id: string; vehicleId: string; liters: number | string; totalAmount: number | string; transactionDate: string; receiptNumber?: string | null };
type Inspection = { id: string; number?: string; sourceId: string; status: string; results?: Array<{ templateItemId?: string | null; code: string; label: string }> };
type AssetSummary = { assetCount: number; activeAssetCount: number; acquisitionCost: number | string; accumulatedDepreciation: number | string; bookValue: number | string; maintenanceOpen: number };
type FleetSummary = { vehicleCount: number; availableVehicles: number; maintenanceVehicles: number; activeTrips: number; fuelTransactionCount: number; fuelLiters: number | string; fuelCost: number | string; codExpected: number | string; codCollected: number | string; codVariance: number | string };
type CursorResponse<T> = T[] | { items?: T[] };
function rowsOf<T>(value: CursorResponse<T>): T[] { return Array.isArray(value) ? value : value.items ?? []; }

type AssetsFleetMode = 'assets' | 'maintenance' | 'vehicles' | 'trips';

// The permission each asset/fleet mutation requires, mirroring assets.controller.ts,
// fleet.controller.ts, dan operations-control.controller.ts. The API splits the asset
// lifecycle further than a single asset.manage: perolehan/disposal butuh asset.acquire,
// assignment/transfer butuh asset.assign, dan planning maintenance butuh asset.maintenance.
const ASSET_ACTION_PERMISSION = {
  category: 'asset.manage',
  acquire: 'asset.acquire',
  assign: 'asset.assign',
  transfer: 'asset.assign',
  dispose: 'asset.acquire',
  maintenancePlan: 'asset.maintenance',
  maintenanceWorkOrder: 'asset.maintenance',
  maintenanceComplete: 'asset.maintenance',
  depreciate: 'asset.depreciate',
  vehicle: 'fleet.manage',
  driverAssignment: 'fleet.manage',
  fuel: 'fleet.expense',
  handoverInspection: 'inspection.record',
} as const;

export default function AssetsFleetView({ token, mode = 'assets' }: { token: string; mode?: AssetsFleetMode }) {
  // D-3: setiap mutasi di modul ini dijaga API dengan permission berbeda. Tanpa gerbang,
  // operator tanpa asset.depreciate tetap melihat "Jalankan depresiasi" dan baru tahu 403
  // setelah mengeklik. Kontrol yang tidak bisa berhasil tidak boleh dirender.
  const { canAll, identity } = usePermissions(token);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [driverAssignments, setDriverAssignments] = useState<DriverAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [assetInspections, setAssetInspections] = useState<Inspection[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [fuelRows, setFuelRows] = useState<Fuel[]>([]);
  const [assetSummary, setAssetSummary] = useState<AssetSummary | null>(null);
  const [fleetSummary, setFleetSummary] = useState<FleetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [categoryForm, setCategoryForm] = useState({ code: '', name: '', assetType: 'EQUIPMENT', usefulLifeMonths: 60 });
  const [assetForm, setAssetForm] = useState({ categoryId: '', code: '', name: '', acquisitionCost: 0, paymentMode: 'CASH' });
  const [assetAssignForm, setAssetAssignForm] = useState({ assetId: '', employeeId: '', warehouseId: '', notes: '' });
  const [assetTransferForm, setAssetTransferForm] = useState({ assetId: '', targetEmployeeId: '', targetWarehouseId: '', targetLocationName: '', inspectionId: '', notes: '' });
  const [assetDisposeForm, setAssetDisposeForm] = useState({ assetId: '', mode: 'DISPOSAL', proceeds: 0, settlementMode: 'CASH', inspectionId: '', reason: '' });
  const [handoverForm, setHandoverForm] = useState({ assetId: '', inspectionId: '', result: 'PASS', notes: '' });
  const [maintenancePlanForm, setMaintenancePlanForm] = useState({ assetId: '', code: '', name: '', scheduleType: 'INTERVAL', intervalDays: 30, intervalOdometer: '', nextDueDate: '', nextDueOdometer: '', autoCreateWorkOrder: true });
  const [maintenanceForm, setMaintenanceForm] = useState({ assetId: '', maintenanceType: 'PREVENTIVE', priority: 'NORMAL', estimatedCost: 0, notes: '' });
  const [completeMaintenanceId, setCompleteMaintenanceId] = useState('');
  const [completeForm, setCompleteForm] = useState({ actualCost: 0, paymentMode: 'CASH', odometer: '', notes: '' });
  const [depreciation, setDepreciation] = useState(() => { const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const last = new Date(y,d.getMonth()+1,0).getDate(); return { periodStart: `${y}-${m}-01`, periodEnd: `${y}-${m}-${String(last).padStart(2,'0')}` }; });
  const [vehicleForm, setVehicleForm] = useState({ assetId: '', code: '', plateNumber: '', vehicleType: 'DELIVERY_VAN', currentOdometer: 0, fuelType: 'GASOLINE' });
  const [driverAssignmentForm, setDriverAssignmentForm] = useState({ vehicleId: '', employeeId: '', effectiveFrom: '', effectiveTo: '', isPrimary: true, notes: '' });
  const [fuelForm, setFuelForm] = useState({ vehicleId: '', liters: 0, unitPrice: 0, odometer: '', receiptNumber: '', vendorName: '', paymentMode: 'CASH' });

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `HTTP ${response.status}`);
    return data as T;
  }

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [cat, a, m, mp, assetStats, v, da, e, w, inspections, t, f, fleetStats] = await Promise.all([
        api<AssetCategory[]>('/assets/categories'),
        api<CursorResponse<Asset>>('/assets'),
        api<CursorResponse<Maintenance>>('/assets/maintenances'),
        api<CursorResponse<MaintenancePlan>>('/assets/maintenance-plans'),
        api<AssetSummary>('/assets/summary'),
        api<CursorResponse<Vehicle>>('/fleet/vehicles'),
        api<CursorResponse<DriverAssignment>>('/fleet/driver-assignments'),
        readOptional(identity, '/hr/employees', [] as CursorResponse<Employee>, (p) => api<CursorResponse<Employee>>(p + '?limit=100')),
        readOptional(identity, '/master-data/warehouses', [] as CursorResponse<Warehouse>, (p) => api<CursorResponse<Warehouse>>(p)),
        readOptional(identity, '/operations-control/inspections', [] as CursorResponse<Inspection>, (p) => api<CursorResponse<Inspection>>(p + '?limit=100&sourceType=Asset')),
        api<CursorResponse<Trip>>('/fleet/trips'),
        api<CursorResponse<Fuel>>('/fleet/fuel'),
        api<FleetSummary>('/fleet/summary'),
      ]);
      const assetRows = rowsOf(a); const vehicleRows = rowsOf(v); const employeeRows = rowsOf(e).filter((row) => row.isActive !== false); const warehouseRows = rowsOf(w).filter((row) => row.isActive !== false); const inspectionRows = rowsOf(inspections);
      setCategories(cat); setAssets(assetRows); setMaintenances(rowsOf(m)); setMaintenancePlans(rowsOf(mp)); setAssetSummary(assetStats); setVehicles(vehicleRows); setDriverAssignments(rowsOf(da)); setEmployees(employeeRows); setWarehouses(warehouseRows); setAssetInspections(inspectionRows); setTrips(rowsOf(t)); setFuelRows(rowsOf(f)); setFleetSummary(fleetStats);
      setAssetForm((x) => ({ ...x, categoryId: x.categoryId || cat[0]?.id || '' }));
      setAssetAssignForm((x) => ({ ...x, assetId: x.assetId || assetRows[0]?.id || '', employeeId: x.employeeId || employeeRows[0]?.id || '', warehouseId: x.warehouseId || warehouseRows[0]?.id || '' }));
      setAssetTransferForm((x) => ({ ...x, assetId: x.assetId || assetRows[0]?.id || '', targetEmployeeId: x.targetEmployeeId || employeeRows[0]?.id || '', targetWarehouseId: x.targetWarehouseId || warehouseRows[0]?.id || '' }));
      setAssetDisposeForm((x) => ({ ...x, assetId: x.assetId || assetRows[0]?.id || '' }));
      setHandoverForm((x) => ({ ...x, assetId: x.assetId || assetRows[0]?.id || '' }));
      setMaintenancePlanForm((x) => ({ ...x, assetId: x.assetId || assetRows[0]?.id || '' }));
      setMaintenanceForm((x) => ({ ...x, assetId: x.assetId || assetRows[0]?.id || '' }));
      setVehicleForm((x) => ({ ...x, assetId: x.assetId || assetRows.find((row) => row.assetType === 'VEHICLE')?.id || '' }));
      setDriverAssignmentForm((x) => ({ ...x, vehicleId: x.vehicleId || vehicleRows[0]?.id || '', employeeId: x.employeeId || employeeRows[0]?.id || '' }));
      setFuelForm((x) => ({ ...x, vehicleId: x.vehicleId || vehicleRows[0]?.id || '' }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Data aset dan armada gagal dimuat.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [token]);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function run(key: string, work: () => Promise<string>) {
    if (busy) return;
    setBusy(key); setMessage('');
    try { setMessage(await work()); await refresh(); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Operasi Asset/Fleet gagal.'); }
    finally { setBusy(''); }
  }

  async function createHandoverInspection() { await run('handover-create', async () => {
    if (!handoverForm.assetId) throw new Error('Pilih aset untuk inspeksi serah-terima.');
    const created = await api<Inspection>('/operations-control/inspections', { method: 'POST', body: JSON.stringify({ sourceType: 'Asset', sourceId: handoverForm.assetId, type: 'ASSET_HANDOVER' }) });
    setHandoverForm((x) => ({ ...x, inspectionId: created.id }));
    return `Inspeksi ${created.number ?? created.id} dibuat. Nilai kondisi secara eksplisit sebelum transfer/disposal.`;
  }); }

  async function completeHandoverInspection(e: FormEvent) { e.preventDefault(); await run('handover-complete', async () => {
    if (!handoverForm.inspectionId) throw new Error('Pilih inspeksi serah-terima yang masih IN_PROGRESS.');
    const inspection = assetInspections.find((row) => row.id === handoverForm.inspectionId);
    if (!inspection || inspection.sourceId !== handoverForm.assetId || inspection.status !== 'IN_PROGRESS') throw new Error('Inspeksi serah-terima tidak valid untuk aset ini.');
    const result = handoverForm.result === 'FAIL' ? 'FAIL' : 'PASS';
    await api<Inspection>(`/operations-control/inspections/${inspection.id}/complete`, { method: 'POST', body: JSON.stringify({ results: [{ code: 'ASSET_HANDOVER_CHECK', label: 'Kondisi serah-terima aset', result }], notes: handoverForm.notes || undefined }) });
    setHandoverForm((x) => ({ ...x, inspectionId: '', notes: '' }));
    return result === 'PASS' ? 'Inspeksi serah-terima dinyatakan PASS dan dapat dipakai untuk transfer/disposal.' : 'Inspeksi serah-terima dinyatakan FAIL; transfer/disposal tetap diblokir.';
  }); }

  async function createCategory(e: FormEvent) { e.preventDefault(); await run('category', async () => {
    await api('/assets/categories', { method: 'POST', body: JSON.stringify(categoryForm) });
    setCategoryForm({ ...categoryForm, code: '', name: '' }); return 'Kategori aset berhasil dibuat.';
  }); }
  async function acquireAsset(e: FormEvent) { e.preventDefault(); await run('asset', async () => {
    const row = await api<Asset>('/assets', { method: 'POST', body: JSON.stringify({ ...assetForm, acquisitionCost: Number(assetForm.acquisitionCost) }) });
    setAssetForm((x) => ({ ...x, code: '', name: '', acquisitionCost: 0 })); return `Aset ${row.code ?? row.name} berhasil diperoleh dan jurnal perolehan diposting.`;
  }); }
  async function assignAsset(e: FormEvent) { e.preventDefault(); await run('asset-assign', async () => {
    if (!assetAssignForm.employeeId && !assetAssignForm.warehouseId) throw new Error('Pilih karyawan atau gudang untuk assignment aset.');
    await api(`/assets/${assetAssignForm.assetId}/assign`, { method: 'POST', body: JSON.stringify({ employeeId: assetAssignForm.employeeId || undefined, warehouseId: assetAssignForm.warehouseId || undefined, notes: assetAssignForm.notes || undefined }) });
    setAssetAssignForm((x) => ({ ...x, notes: '' })); return 'Assignment aset diperbarui.';
  }); }
  async function transferAsset(e: FormEvent) { e.preventDefault(); await run('asset-transfer', async () => {
    if (!assetTransferForm.inspectionId) throw new Error('Pilih inspeksi serah-terima PASSED/APPROVED untuk transfer.');
    await api(`/assets/${assetTransferForm.assetId}/transfer`, { method: 'POST', body: JSON.stringify({ targetEmployeeId: assetTransferForm.targetEmployeeId || undefined, targetWarehouseId: assetTransferForm.targetWarehouseId || undefined, targetLocationName: assetTransferForm.targetLocationName || undefined, notes: assetTransferForm.notes || undefined, inspectionId: assetTransferForm.inspectionId }) });
    setAssetTransferForm((x) => ({ ...x, targetLocationName: '', notes: '' })); return 'Transfer custody/lokasi aset berhasil dicatat.';
  }); }
  async function disposeAsset(e: FormEvent) { e.preventDefault(); await run('asset-dispose', async () => {
    if (!assetDisposeForm.inspectionId) throw new Error('Pilih inspeksi serah-terima PASSED/APPROVED untuk disposal/sale.');
    await api(`/assets/${assetDisposeForm.assetId}/dispose`, { method: 'POST', body: JSON.stringify({ mode: assetDisposeForm.mode, proceeds: Number(assetDisposeForm.proceeds), settlementMode: assetDisposeForm.settlementMode, reason: assetDisposeForm.reason || undefined, inspectionId: assetDisposeForm.inspectionId }) });
    setAssetDisposeForm((x) => ({ ...x, proceeds: 0, reason: '' })); return assetDisposeForm.mode === 'SALE' ? 'Penjualan aset berhasil diposting.' : 'Disposal aset berhasil diposting.';
  }); }
  async function createMaintenancePlan(e: FormEvent) { e.preventDefault(); await run('maintenance-plan', async () => {
    const payload = { assetId: maintenancePlanForm.assetId, code: maintenancePlanForm.code.trim(), name: maintenancePlanForm.name.trim(), scheduleType: maintenancePlanForm.scheduleType, intervalDays: maintenancePlanForm.intervalDays || undefined, intervalOdometer: maintenancePlanForm.intervalOdometer ? Number(maintenancePlanForm.intervalOdometer) : undefined, nextDueDate: maintenancePlanForm.nextDueDate || undefined, nextDueOdometer: maintenancePlanForm.nextDueOdometer ? Number(maintenancePlanForm.nextDueOdometer) : undefined, autoCreateWorkOrder: maintenancePlanForm.autoCreateWorkOrder };
    await api('/assets/maintenance-plans', { method: 'POST', body: JSON.stringify(payload) });
    setMaintenancePlanForm((x) => ({ ...x, code: '', name: '', nextDueDate: '', nextDueOdometer: '' })); return 'Maintenance plan berhasil dibuat dan siap dipantau worker.';
  }); }
  async function toggleMaintenancePlan(plan: MaintenancePlan) { await run(`maintenance-plan-${plan.id}`, async () => {
    await api(`/assets/maintenance-plans/${plan.id}/update`, { method: 'POST', body: JSON.stringify({ isActive: !plan.isActive }) });
    return `Maintenance plan ${plan.code} ${plan.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`;
  }); }
  async function createMaintenance(e: FormEvent) { e.preventDefault(); await run('maintenance', async () => {
    const row = await api<Maintenance>('/assets/maintenance', { method: 'POST', body: JSON.stringify({ ...maintenanceForm, estimatedCost: Number(maintenanceForm.estimatedCost) }) });
    setMaintenanceForm((x) => ({ ...x, estimatedCost: 0, notes: '' })); return `Work order ${row.number ?? row.id} dibuat.`;
  }); }
  async function completeMaintenance(e: FormEvent) { e.preventDefault(); if (!completeMaintenanceId) return; await run('maintenance-complete', async () => {
    // CompleteMaintenanceDto declares actualCost, odometer, inspectionId, taxCodeId, paymentMode,
    // completedAt, parts and notes. All eight are sent; `notes` is genuinely whitelisted, so it
    // stays in the payload. (An earlier check of this DTO used `sed -n '78,85p'` and stopped one
    // line short, which hid the notes field and briefly looked like a defect.)
    const payload = { actualCost: Number(completeForm.actualCost), paymentMode: completeForm.paymentMode, ...(completeForm.odometer ? { odometer: Number(completeForm.odometer) } : {}), notes: completeForm.notes || undefined };
    await api(`/assets/maintenance/${completeMaintenanceId}/complete`, { method: 'POST', body: JSON.stringify(payload) });
    setCompleteMaintenanceId(''); setCompleteForm({ actualCost: 0, paymentMode: 'CASH', odometer: '', notes: '' }); return 'Maintenance selesai; biaya, jurnal, dan odometer diposting server.';
  }); }
  async function runDepreciation(e: FormEvent) { e.preventDefault(); await run('depreciation', async () => {
    const result = await api<{ postedCount?: number }>('/assets/depreciation-runs', { method: 'POST', body: JSON.stringify(depreciation) }); return `Depresiasi periode diproses${result.postedCount != null ? ` untuk ${result.postedCount} aset` : ''}.`;
  }); }
  async function createVehicle(e: FormEvent) { e.preventDefault(); await run('vehicle', async () => {
    const row = await api<Vehicle>('/fleet/vehicles', { method: 'POST', body: JSON.stringify({ ...vehicleForm, assetId: vehicleForm.assetId || undefined, currentOdometer: Number(vehicleForm.currentOdometer) }) });
    setVehicleForm((x) => ({ ...x, code: '', plateNumber: '' })); return `Kendaraan ${row.code} dibuat.`;
  }); }
  async function createDriverAssignment(e: FormEvent) { e.preventDefault(); await run('driver-assignment', async () => {
    await api('/fleet/driver-assignments', { method: 'POST', body: JSON.stringify({ vehicleId: driverAssignmentForm.vehicleId, employeeId: driverAssignmentForm.employeeId, effectiveFrom: driverAssignmentForm.effectiveFrom || undefined, effectiveTo: driverAssignmentForm.effectiveTo || undefined, isPrimary: driverAssignmentForm.isPrimary, notes: driverAssignmentForm.notes || undefined }) });
    setDriverAssignmentForm((x) => ({ ...x, effectiveFrom: '', effectiveTo: '', notes: '' })); return 'Penugasan pengemudi berhasil dibuat.';
  }); }
  async function endDriverAssignment(row: DriverAssignment) { await run(`driver-end-${row.id}`, async () => {
    await api(`/fleet/driver-assignments/${row.id}/end`, { method: 'POST', body: JSON.stringify({}) });
    return 'Penugasan pengemudi diakhiri.';
  }); }
  async function recordFuel(e: FormEvent) { e.preventDefault(); await run('fuel', async () => {
    if (!fuelForm.receiptNumber.trim()) throw new Error('Nomor struk BBM wajib untuk idempotency/trace.');
    await api('/fleet/fuel', { method: 'POST', body: JSON.stringify({ vehicleId: fuelForm.vehicleId, liters: Number(fuelForm.liters), unitPrice: Number(fuelForm.unitPrice), ...(fuelForm.odometer ? { odometer: Number(fuelForm.odometer) } : {}), receiptNumber: fuelForm.receiptNumber.trim(), vendorName: fuelForm.vendorName || undefined, paymentMode: fuelForm.paymentMode }) });
    setFuelForm((x) => ({ ...x, liters: 0, unitPrice: 0, receiptNumber: '', vendorName: '' })); return 'Transaksi BBM dicatat dan jurnal biaya diposting.';
  }); }

  if (error) return <ErrorState message={`Data Asset/Fleet tidak dapat dimuat: ${error}`} />;
  if (loading && !assets.length && !vehicles.length) return <Skeleton rows={7}/>;
  return <>
    <div className="pageHeader"><div><p className="eyebrow">OPERATIONS · ASSET & FLEET</p><h2>Aset, Maintenance & Armada</h2><p>Operator lifecycle untuk assignment/transfer/disposal aset, maintenance terjadwal, driver assignment, depresiasi, kendaraan, fuel, dan delivery.</p></div><button type="button" className="secondary" onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>
    <section className="metricGrid">
      {mode === 'assets' && <div className="metricCard"><span>Total aset</span><strong>{assetSummary?.assetCount??assets.length}</strong><small>{assetSummary?.activeAssetCount??0} aktif</small></div>}
      {mode === 'assets' && <div className="metricCard"><span>Nilai buku</span><strong>{rupiah(Number(assetSummary?.bookValue??0))}</strong><small>Cost {rupiah(Number(assetSummary?.acquisitionCost??0))}</small></div>}
      {mode === 'maintenance' && <div className="metricCard"><span>Maintenance open</span><strong>{assetSummary?.maintenanceOpen??0}</strong><small>{maintenancePlans.filter((row)=>row.isActive).length} plan aktif</small></div>}
      {['vehicles','trips'].includes(mode) && <div className="metricCard"><span>Fleet</span><strong>{fleetSummary?.vehicleCount??vehicles.length}</strong><small>{fleetSummary?.activeTrips??0} trip aktif</small></div>}
    </section>

    {mode === 'assets' && <>
    <section className="grid2">
      <Panel eyebrow="MASTER" title="Kategori Aset">{canAll(ASSET_ACTION_PERMISSION.category) && <form className="formStack" onSubmit={createCategory}><label>Kode<input required value={categoryForm.code} onChange={e=>setCategoryForm({...categoryForm,code:e.target.value})}/></label><label>Nama<input required value={categoryForm.name} onChange={e=>setCategoryForm({...categoryForm,name:e.target.value})}/></label><label>Tipe<select value={categoryForm.assetType} onChange={e=>setCategoryForm({...categoryForm,assetType:e.target.value})}>{['MOVABLE','IMMOVABLE','VEHICLE','LAND','BUILDING','EQUIPMENT','FURNITURE','IT','SOFTWARE','OTHER'].map(x=><option key={x}>{x}</option>)}</select></label><label>Umur manfaat (bulan)<input type="number" min="1" value={categoryForm.usefulLifeMonths} onChange={e=>setCategoryForm({...categoryForm,usefulLifeMonths:Number(e.target.value)})}/></label><button disabled={Boolean(busy)}>{busy==='category'?'Menyimpan…':'Buat kategori'}</button></form>}<Table head={['Kode','Nama','Tipe']} rows={categories.map(c=>[<strong>{c.code}</strong>,c.name,c.assetType])} empty="Belum ada kategori aset"/></Panel>
      {canAll(ASSET_ACTION_PERMISSION.acquire) && <Panel eyebrow="PEROLEHAN" title="Daftarkan Aset"><form className="formStack" onSubmit={acquireAsset}><label>Kategori<select required value={assetForm.categoryId} onChange={e=>setAssetForm({...assetForm,categoryId:e.target.value})}>{categories.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label><label>Kode aset<input required value={assetForm.code} onChange={e=>setAssetForm({...assetForm,code:e.target.value})}/></label><label>Nama aset<input required value={assetForm.name} onChange={e=>setAssetForm({...assetForm,name:e.target.value})}/></label><label>Biaya perolehan<input required type="number" min="0" value={assetForm.acquisitionCost} onChange={e=>setAssetForm({...assetForm,acquisitionCost:Number(e.target.value)})}/></label><label>Pembayaran<select value={assetForm.paymentMode} onChange={e=>setAssetForm({...assetForm,paymentMode:e.target.value})}><option>CASH</option><option>BANK</option><option>CREDIT</option></select></label><button disabled={Boolean(busy)}>{busy==='asset'?'Memposting…':'Catat perolehan aset'}</button></form></Panel>}
    </section>

    <Panel eyebrow="ASET" title="Daftar Aset Perusahaan" badge={`${assets.length} aset`}><Table loading={loading} head={['Kode','Nama','Custody','Perolehan','Nilai Buku','Status']} rows={assets.map(a=>[<strong>{a.code??'-'}</strong>,a.name,`${employeeById.get(a.assignedEmployeeId??'')?.fullName??'-'} · ${warehouseById.get(a.warehouseId??'')?.name??a.locationName??'-'}`,rupiah(Number(a.acquisitionCost??0)),rupiah(Number(a.bookValue??0)),<StatusChip status={a.status??'ACTIVE'}/>])} empty="Belum ada aset terdaftar."/></Panel>

    <section className="grid2">
      {canAll(ASSET_ACTION_PERMISSION.assign) && <Panel eyebrow="ASSET LIFECYCLE" title="Assign"><form className="formStack" onSubmit={assignAsset}><label>Aset<select required value={assetAssignForm.assetId} onChange={e=>setAssetAssignForm({...assetAssignForm,assetId:e.target.value})}>{assets.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Karyawan<select value={assetAssignForm.employeeId} onChange={e=>setAssetAssignForm({...assetAssignForm,employeeId:e.target.value})}><option value="">Tanpa karyawan</option>{employees.map(row=><option key={row.id} value={row.id}>{row.employeeNumber??'-'} · {row.fullName}</option>)}</select></label><label>Gudang<select value={assetAssignForm.warehouseId} onChange={e=>setAssetAssignForm({...assetAssignForm,warehouseId:e.target.value})}><option value="">Tanpa gudang</option>{warehouses.map(row=><option key={row.id} value={row.id}>{row.code??'-'} · {row.name}</option>)}</select></label><label>Catatan<input value={assetAssignForm.notes} onChange={e=>setAssetAssignForm({...assetAssignForm,notes:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='asset-assign'?'Menyimpan…':'Assign aset'}</button></form></Panel>}
      {canAll(ASSET_ACTION_PERMISSION.transfer) && <Panel eyebrow="ASSET LIFECYCLE" title="Transfer"><form className="formStack" onSubmit={transferAsset}><label>Aset<select required value={assetTransferForm.assetId} onChange={e=>setAssetTransferForm({...assetTransferForm,assetId:e.target.value,inspectionId:''})}>{assets.filter(a=>['ACTIVE','IDLE'].includes(a.status??'ACTIVE')).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Inspeksi lulus<select required value={assetTransferForm.inspectionId} onChange={e=>setAssetTransferForm({...assetTransferForm,inspectionId:e.target.value})}><option value="">Pilih PASSED/APPROVED</option>{assetInspections.filter(row=>row.sourceId===assetTransferForm.assetId&&['PASSED','APPROVED'].includes(row.status)).map(row=><option key={row.id} value={row.id}>{row.number??row.id} · {row.status}</option>)}</select></label><label>Target karyawan<select value={assetTransferForm.targetEmployeeId} onChange={e=>setAssetTransferForm({...assetTransferForm,targetEmployeeId:e.target.value})}><option value="">Pertahankan/none</option>{employees.map(row=><option key={row.id} value={row.id}>{row.employeeNumber??'-'} · {row.fullName}</option>)}</select></label><label>Target gudang<select value={assetTransferForm.targetWarehouseId} onChange={e=>setAssetTransferForm({...assetTransferForm,targetWarehouseId:e.target.value})}><option value="">Pertahankan/none</option>{warehouses.map(row=><option key={row.id} value={row.id}>{row.code??'-'} · {row.name}</option>)}</select></label><label>Lokasi<input value={assetTransferForm.targetLocationName} onChange={e=>setAssetTransferForm({...assetTransferForm,targetLocationName:e.target.value})}/></label><label>Catatan<input value={assetTransferForm.notes} onChange={e=>setAssetTransferForm({...assetTransferForm,notes:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='asset-transfer'?'Memproses…':'Transfer aset'}</button></form></Panel>}
      {canAll(ASSET_ACTION_PERMISSION.dispose) && <Panel eyebrow="ASSET LIFECYCLE" title="Dispose / Sale"><form className="formStack" onSubmit={disposeAsset}><label>Aset<select required value={assetDisposeForm.assetId} onChange={e=>setAssetDisposeForm({...assetDisposeForm,assetId:e.target.value,inspectionId:''})}>{assets.filter(a=>['ACTIVE','IDLE','DAMAGED'].includes(a.status??'ACTIVE')).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Inspeksi lulus<select required value={assetDisposeForm.inspectionId} onChange={e=>setAssetDisposeForm({...assetDisposeForm,inspectionId:e.target.value})}><option value="">Pilih PASSED/APPROVED</option>{assetInspections.filter(row=>row.sourceId===assetDisposeForm.assetId&&['PASSED','APPROVED'].includes(row.status)).map(row=><option key={row.id} value={row.id}>{row.number??row.id} · {row.status}</option>)}</select></label><label>Mode<select value={assetDisposeForm.mode} onChange={e=>setAssetDisposeForm({...assetDisposeForm,mode:e.target.value})}><option>DISPOSAL</option><option>SALE</option></select></label><label>Proceeds<input type="number" min="0" value={assetDisposeForm.proceeds} onChange={e=>setAssetDisposeForm({...assetDisposeForm,proceeds:Number(e.target.value)})}/></label><label>Settlement<select value={assetDisposeForm.settlementMode} onChange={e=>setAssetDisposeForm({...assetDisposeForm,settlementMode:e.target.value})}><option>CASH</option><option>BANK</option></select></label><label>Alasan<input value={assetDisposeForm.reason} onChange={e=>setAssetDisposeForm({...assetDisposeForm,reason:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='asset-dispose'?'Memposting…':'Lepaskan aset'}</button></form></Panel>}
    </section>

    <Panel eyebrow="ASSET HANDOVER" title="Inspeksi Serah-Terima" badge={`${assetInspections.length} record`}>{canAll(ASSET_ACTION_PERMISSION.handoverInspection) && <form className="formStack" onSubmit={completeHandoverInspection}><label>Aset<select required value={handoverForm.assetId} onChange={e=>setHandoverForm({...handoverForm,assetId:e.target.value,inspectionId:''})}>{assets.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><div className="rowActions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void createHandoverInspection()}>{busy==='handover-create'?'Membuat…':'Buat inspeksi IN_PROGRESS'}</button></div><label>Inspeksi aktif<select required value={handoverForm.inspectionId} onChange={e=>setHandoverForm({...handoverForm,inspectionId:e.target.value})}><option value="">Pilih IN_PROGRESS</option>{assetInspections.filter(row=>row.sourceId===handoverForm.assetId&&row.status==='IN_PROGRESS').map(row=><option key={row.id} value={row.id}>{row.number??row.id}</option>)}</select></label><label>Hasil kondisi<select value={handoverForm.result} onChange={e=>setHandoverForm({...handoverForm,result:e.target.value})}><option>PASS</option><option>FAIL</option></select></label><label>Catatan pemeriksaan<input value={handoverForm.notes} onChange={e=>setHandoverForm({...handoverForm,notes:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='handover-complete'?'Menyelesaikan…':'Finalisasi inspeksi'}</button></form>}<p className="sectionHelp">Transfer/disposal hanya menerima inspeksi Asset berstatus PASSED/APPROVED; hasil FAIL tetap memblokir lifecycle.</p></Panel>
    </>}

    {mode === 'maintenance' && <section className="grid2">
      {canAll(ASSET_ACTION_PERMISSION.maintenancePlan) && <Panel eyebrow="MAINTENANCE PLAN" title="Buat Jadwal Maintenance"><form className="formStack" onSubmit={createMaintenancePlan}><label>Aset<select required value={maintenancePlanForm.assetId} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,assetId:e.target.value})}>{assets.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Kode<input required value={maintenancePlanForm.code} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,code:e.target.value})}/></label><label>Nama<input required value={maintenancePlanForm.name} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,name:e.target.value})}/></label><label>Tipe jadwal<input required value={maintenancePlanForm.scheduleType} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,scheduleType:e.target.value})}/></label><label>Interval hari<input type="number" min="1" value={maintenancePlanForm.intervalDays} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,intervalDays:Number(e.target.value)})}/></label><label>Interval odometer<input type="number" min="1" value={maintenancePlanForm.intervalOdometer} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,intervalOdometer:e.target.value})}/></label><label>Due date<input type="date" value={maintenancePlanForm.nextDueDate} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,nextDueDate:e.target.value})}/></label><label>Due odometer<input type="number" min="0" value={maintenancePlanForm.nextDueOdometer} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,nextDueOdometer:e.target.value})}/></label><label><input type="checkbox" checked={maintenancePlanForm.autoCreateWorkOrder} onChange={e=>setMaintenancePlanForm({...maintenancePlanForm,autoCreateWorkOrder:e.target.checked})}/> Auto-create work order via automation</label><button disabled={Boolean(busy)}>{busy==='maintenance-plan'?'Menyimpan…':'Buat maintenance plan'}</button></form></Panel>}
      {canAll(ASSET_ACTION_PERMISSION.depreciate) && <Panel eyebrow="DEPRECIATION" title="Run Depresiasi"><form className="formStack" onSubmit={runDepreciation}><label>Awal periode<input type="date" required value={depreciation.periodStart} onChange={e=>setDepreciation({...depreciation,periodStart:e.target.value})}/></label><label>Akhir periode<input type="date" required value={depreciation.periodEnd} onChange={e=>setDepreciation({...depreciation,periodEnd:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='depreciation'?'Memposting…':'Jalankan depresiasi'}</button></form><p className="sectionHelp">Server mencegah double-post periode yang sama dan menghormati fiscal-period lock.</p></Panel>}
    </section>}
    {mode === 'maintenance' && <Panel eyebrow="MAINTENANCE PLAN" title="Maintenance Plan" badge={`${maintenancePlans.length} plan`}><Table loading={loading} head={['Kode','Aset','Interval','Due','Auto WO','Status','Aksi']} rows={maintenancePlans.map(plan=>[<strong>{plan.code}</strong>,plan.asset?.name??assetById.get(plan.assetId)?.name??'-',`${plan.intervalDays?`${plan.intervalDays} hari`:''}${plan.intervalDays&&plan.intervalOdometer?' / ':''}${plan.intervalOdometer?`${plan.intervalOdometer} km`:''}`,plan.nextDueDate?tanggal(plan.nextDueDate):plan.nextDueOdometer!=null?`${plan.nextDueOdometer} km`:'-',plan.autoCreateWorkOrder?'YA':'TIDAK',<StatusChip status={plan.isActive?'ACTIVE':'INACTIVE'}/>,canAll(ASSET_ACTION_PERMISSION.maintenancePlan) && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void toggleMaintenancePlan(plan)}>{plan.isActive?'Nonaktifkan':'Aktifkan'}</button>])} empty="Belum ada maintenance plan."/></Panel>}

    <section className="grid2">
      {mode === 'maintenance' && canAll(ASSET_ACTION_PERMISSION.maintenanceWorkOrder) && <Panel eyebrow="MAINTENANCE" title="Buat Work Order"><form className="formStack" onSubmit={createMaintenance}><label>Aset<select required value={maintenanceForm.assetId} onChange={e=>setMaintenanceForm({...maintenanceForm,assetId:e.target.value})}>{assets.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Tipe maintenance<input required value={maintenanceForm.maintenanceType} onChange={e=>setMaintenanceForm({...maintenanceForm,maintenanceType:e.target.value})}/></label><label>Prioritas<select value={maintenanceForm.priority} onChange={e=>setMaintenanceForm({...maintenanceForm,priority:e.target.value})}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>CRITICAL</option></select></label><label>Estimasi biaya<input type="number" min="0" value={maintenanceForm.estimatedCost} onChange={e=>setMaintenanceForm({...maintenanceForm,estimatedCost:Number(e.target.value)})}/></label><label>Catatan<input value={maintenanceForm.notes} onChange={e=>setMaintenanceForm({...maintenanceForm,notes:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='maintenance'?'Membuat…':'Buat work order'}</button></form></Panel>}
      {mode === 'vehicles' && canAll(ASSET_ACTION_PERMISSION.vehicle) && <Panel eyebrow="ARMADA" title="Daftarkan Kendaraan"><form className="formStack" onSubmit={createVehicle}><label>Aset kendaraan (opsional)<select value={vehicleForm.assetId} onChange={e=>setVehicleForm({...vehicleForm,assetId:e.target.value})}><option value="">Tanpa link aset</option>{assets.filter(a=>a.assetType==='VEHICLE').map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Kode<input required value={vehicleForm.code} onChange={e=>setVehicleForm({...vehicleForm,code:e.target.value})}/></label><label>Plat<input required value={vehicleForm.plateNumber} onChange={e=>setVehicleForm({...vehicleForm,plateNumber:e.target.value})}/></label><label>Tipe<input required value={vehicleForm.vehicleType} onChange={e=>setVehicleForm({...vehicleForm,vehicleType:e.target.value})}/></label><label>Odometer awal<input type="number" min="0" value={vehicleForm.currentOdometer} onChange={e=>setVehicleForm({...vehicleForm,currentOdometer:Number(e.target.value)})}/></label><label>Bahan bakar<input value={vehicleForm.fuelType} onChange={e=>setVehicleForm({...vehicleForm,fuelType:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='vehicle'?'Membuat…':'Buat kendaraan'}</button></form></Panel>}
    </section>

    {mode === 'maintenance' && <Panel eyebrow="MAINTENANCE" title="Jadwal & Riwayat Maintenance" badge={`${maintenances.length} record`}><Table loading={loading} head={['Nomor','Aset','Jadwal/Selesai','Biaya','Status','Aksi']} rows={maintenances.map(m=>[<strong>{m.number??'-'}</strong>,assetById.get(m.assetId)?.name??m.asset?.name??'-',m.completedAt?tanggal(m.completedAt):m.scheduledAt?tanggal(m.scheduledAt):'-',rupiah(Number(m.actualCost??m.estimatedCost??0)),<StatusChip status={m.status}/>,!['COMPLETED','CANCELLED'].includes(m.status)?(canAll(ASSET_ACTION_PERMISSION.maintenanceComplete)?<button type="button" className="secondary" onClick={()=>{setCompleteMaintenanceId(m.id);setCompleteForm(x=>({...x,actualCost:Number(m.estimatedCost??0)}));}}>Selesaikan</button>:'-'):'-'])} empty="Belum ada maintenance."/></Panel>}
    {mode === 'maintenance' && completeMaintenanceId && canAll(ASSET_ACTION_PERMISSION.maintenanceComplete) && <Panel eyebrow="MAINTENANCE COMPLETION" title={`Selesaikan ${maintenances.find(m=>m.id===completeMaintenanceId)?.number??''}`}><form className="formStack" onSubmit={completeMaintenance}><label>Biaya aktual<input required type="number" min="0" value={completeForm.actualCost} onChange={e=>setCompleteForm({...completeForm,actualCost:Number(e.target.value)})}/></label><label>Pembayaran<select value={completeForm.paymentMode} onChange={e=>setCompleteForm({...completeForm,paymentMode:e.target.value})}><option>CASH</option><option>BANK</option><option>CREDIT</option></select></label><label>Odometer (bila kendaraan)<input type="number" min="0" value={completeForm.odometer} onChange={e=>setCompleteForm({...completeForm,odometer:e.target.value})}/></label><label>Catatan<input value={completeForm.notes} onChange={e=>setCompleteForm({...completeForm,notes:e.target.value})}/></label><div className="rowActions"><button disabled={Boolean(busy)}>{busy==='maintenance-complete'?'Memposting…':'Selesaikan & posting'}</button><button type="button" className="secondary" onClick={()=>setCompleteMaintenanceId('')}>Batal</button></div></form></Panel>}

    <section className="grid2">
      {mode === 'vehicles' && canAll(ASSET_ACTION_PERMISSION.driverAssignment) && <Panel eyebrow="DRIVER ASSIGNMENT" title="Tugaskan Pengemudi"><form className="formStack" onSubmit={createDriverAssignment}><label>Kendaraan<select required value={driverAssignmentForm.vehicleId} onChange={e=>setDriverAssignmentForm({...driverAssignmentForm,vehicleId:e.target.value})}>{vehicles.map(v=><option key={v.id} value={v.id}>{v.code} · {v.plateNumber}</option>)}</select></label><label>Pengemudi<select required value={driverAssignmentForm.employeeId} onChange={e=>setDriverAssignmentForm({...driverAssignmentForm,employeeId:e.target.value})}>{employees.map(row=><option key={row.id} value={row.id}>{row.employeeNumber??'-'} · {row.fullName}</option>)}</select></label><label>Mulai<input type="date" value={driverAssignmentForm.effectiveFrom} onChange={e=>setDriverAssignmentForm({...driverAssignmentForm,effectiveFrom:e.target.value})}/></label><label>Selesai<input type="date" value={driverAssignmentForm.effectiveTo} onChange={e=>setDriverAssignmentForm({...driverAssignmentForm,effectiveTo:e.target.value})}/></label><label><input type="checkbox" checked={driverAssignmentForm.isPrimary} onChange={e=>setDriverAssignmentForm({...driverAssignmentForm,isPrimary:e.target.checked})}/> Primary driver</label><label>Catatan<input value={driverAssignmentForm.notes} onChange={e=>setDriverAssignmentForm({...driverAssignmentForm,notes:e.target.value})}/></label><button disabled={Boolean(busy)}>{busy==='driver-assignment'?'Menyimpan…':'Buat assignment'}</button></form></Panel>}
      {mode === 'trips' && canAll(ASSET_ACTION_PERMISSION.fuel) && <Panel eyebrow="BBM" title="Catat Pengisian BBM"><form className="formStack" onSubmit={recordFuel}><label>Kendaraan<select required value={fuelForm.vehicleId} onChange={e=>setFuelForm({...fuelForm,vehicleId:e.target.value})}>{vehicles.map(v=><option key={v.id} value={v.id}>{v.code} · {v.plateNumber}</option>)}</select></label><label>Liter<input required type="number" min="0.001" step="0.001" value={fuelForm.liters} onChange={e=>setFuelForm({...fuelForm,liters:Number(e.target.value)})}/></label><label>Harga/liter<input required type="number" min="0" value={fuelForm.unitPrice} onChange={e=>setFuelForm({...fuelForm,unitPrice:Number(e.target.value)})}/></label><label>Odometer<input type="number" min="0" value={fuelForm.odometer} onChange={e=>setFuelForm({...fuelForm,odometer:e.target.value})}/></label><label>Nomor struk<input required value={fuelForm.receiptNumber} onChange={e=>setFuelForm({...fuelForm,receiptNumber:e.target.value})}/></label><label>SPBU/Vendor<input value={fuelForm.vendorName} onChange={e=>setFuelForm({...fuelForm,vendorName:e.target.value})}/></label><label>Pembayaran<select value={fuelForm.paymentMode} onChange={e=>setFuelForm({...fuelForm,paymentMode:e.target.value})}><option>CASH</option><option>BANK</option><option>CREDIT</option></select></label><button disabled={Boolean(busy)}>{busy==='fuel'?'Memposting…':'Catat BBM'}</button></form></Panel>}
    </section>
    {mode === 'vehicles' && <Panel eyebrow="DRIVER ASSIGNMENT" title="Riwayat Penugasan Pengemudi" badge={`${driverAssignments.length} assignment`}><Table loading={loading} head={['Kendaraan','Pengemudi','Mulai','Selesai','Primary','Aksi']} rows={driverAssignments.map(row=>[row.vehicle?.code??vehicleById.get(row.vehicleId)?.code??'-',row.employee?.fullName??employeeById.get(row.employeeId)?.fullName??'-',tanggal(row.effectiveFrom),row.effectiveTo?tanggal(row.effectiveTo):'Aktif',row.isPrimary?'YA':'TIDAK',!row.effectiveTo?(canAll(ASSET_ACTION_PERMISSION.driverAssignment)?<button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void endDriverAssignment(row)}>Akhiri</button>:'-'):'-'])} empty="Belum ada penugasan pengemudi."/></Panel>}

    <section className="grid2">{mode === 'vehicles' && <Panel eyebrow="ARMADA" title="Kendaraan" badge={`${vehicles.length} unit`}><Table loading={loading} head={['Kode','Plat','Driver default','Odometer','Status']} rows={vehicles.map(v=>[<strong>{v.code}</strong>,v.plateNumber??'-',employeeById.get(v.defaultDriverEmployeeId??'')?.fullName??'-',`${Number(v.currentOdometer??0).toLocaleString('id-ID')} km`,<StatusChip status={v.status??'AVAILABLE'}/>])} empty="Belum ada kendaraan."/></Panel>}{mode === 'trips' && <Panel eyebrow="DELIVERY" title="Delivery Trips" badge={`${trips.length} trip`}><Table loading={loading} head={['Nomor','Dibuat','COD','Status']} rows={trips.map(t=>[<strong>{t.number}</strong>,tanggal(t.createdAt),`${rupiah(Number(t.codCollected??0))} / ${rupiah(Number(t.codExpected??0))}`,<StatusChip status={t.status}/>])} empty="Belum ada trip pengiriman."/></Panel>}</section>
    {mode === 'trips' && <Panel eyebrow="FUEL LEDGER" title="Riwayat BBM" badge={`${fuelRows.length} transaksi`}><Table head={['Tanggal','Kendaraan','Liter','Nilai','Receipt']} rows={fuelRows.slice(0,30).map(f=>[tanggal(f.transactionDate),vehicleById.get(f.vehicleId)?.code??'-',Number(f.liters).toFixed(2),rupiah(Number(f.totalAmount)),f.receiptNumber??'-'])} empty="Belum ada transaksi BBM."/></Panel>}
    {mode === 'trips' && <DeliveryLifecycle token={token}/>}
    {message&&<div className="notice">{message}</div>}
  </>;
}
