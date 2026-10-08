'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { Panel, StatusChip, Table, rupiah, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type CursorResponse<T> = T[] | { items?: T[] };
const rowsOf = <T,>(value: CursorResponse<T>): T[] => Array.isArray(value) ? value : value.items ?? [];
type Vehicle = { id:string; code:string; plateNumber?:string; status?:string; currentOdometer?:number };
type Employee = { id:string; employeeNumber:string; fullName:string; isActive?:boolean };
type Warehouse = { id:string; code:string; name:string; isActive?:boolean };
type Product = { id:string; sku:string; name:string };
type Shipment = { id:string; number:string; orderId?:string|null; saleId?:string|null; warehouseId:string; status:string; recipient?:Record<string,unknown>|null };
type TripStop = { id:string; sequence:number; shipmentId?:string|null; customerName:string; address:string; status:string; codExpected:number|string; codCollected:number|string; failureReason?:string|null; shipment?:Shipment|null };
type ManifestItem = { id:string; stopId?:string|null; shipmentId?:string|null; productId:string; expectedQty:number; scannedQty:number; loadedQty:number; deliveredQty:number; returnedQty:number; damagedQty:number; status:string; product?:Product|null };
type Inspection = { id:string; number:string; type:string; status:string; results?:Array<{ id:string; templateItemId?:string|null; code:string; label:string }> };
type GatePass = { id:string; number:string; status:string };
type Trip = { id:string; number:string; status:string; createdAt:string; vehicleId:string; driverEmployeeId:string; originWarehouseId?:string|null; startOdometer?:number|null; endOdometer?:number|null; codExpected:number|string; codCollected:number|string; vehicle?:Vehicle|null; driver?:Employee|null; originWarehouse?:Warehouse|null; loadingInspection?:Inspection|null; preTripInspection?:Inspection|null; postTripInspection?:Inspection|null; gatePass?:GatePass|null; stops:TripStop[]; manifestItems:ManifestItem[] };
type StopDraft = { shipmentId:string; customerName:string; customerPhone:string; address:string; codExpected:number };
type ManifestDraft = { stopIndex:number; shipmentId:string; productId:string; expectedQty:number };

function recipientValue(recipient: Shipment['recipient'], keys:string[]) {
  if (!recipient || typeof recipient !== 'object') return '';
  for (const key of keys) { const value = recipient[key]; if (typeof value === 'string' && value.trim()) return value.trim(); }
  return '';
}

export default function DeliveryLifecycle({ token }: { token:string }) {
  // D-3: the trip lifecycle is not one permission. The API splits it — creating a trip and
  // closing it need delivery.trip.manage, confirming loading needs delivery.loading.confirm,
  // dispatch needs delivery.dispatch, completing a stop needs delivery.proof, and every step
  // that auto-creates an inspection needs inspection.record plus gate_pass.manage /
  // gate_pass.approve for the outbound pass. Rendering all of them unconditionally meant an
  // operator discovered the 403 only after clicking.
  const { canAll, identity } = usePermissions(token);
  const [trips,setTrips]=useState<Trip[]>([]); const [vehicles,setVehicles]=useState<Vehicle[]>([]); const [employees,setEmployees]=useState<Employee[]>([]);
  const [warehouses,setWarehouses]=useState<Warehouse[]>([]); const [shipments,setShipments]=useState<Shipment[]>([]); const [products,setProducts]=useState<Product[]>([]);
  const [selectedTripId,setSelectedTripId]=useState(''); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(''); const [message,setMessage]=useState('');
  const [tripForm,setTripForm]=useState({vehicleId:'',driverEmployeeId:'',originWarehouseId:'',startOdometer:''});
  // Shipment is created here because a trip stop can only reference an existing shipment. The
  // select below was previously the only way in, and it starts empty on a fresh tenant, so the
  // operator had no way to produce the first shipment. POST /shipments is gated shipment.manage.
  const [shipmentForm,setShipmentForm]=useState({warehouseId:'',name:'',phone:'',address:'',carrier:'',service:''});
  const [stops,setStops]=useState<StopDraft[]>([{shipmentId:'',customerName:'',customerPhone:'',address:'',codExpected:0}]);
  const [manifest,setManifest]=useState<ManifestDraft[]>([{stopIndex:0,shipmentId:'',productId:'',expectedQty:1}]);
  const [scanQty,setScanQty]=useState<Record<string,string>>({}); const [stopStatus,setStopStatus]=useState<Record<string,string>>({}); const [stopCod,setStopCod]=useState<Record<string,string>>({}); const [stopReason,setStopReason]=useState<Record<string,string>>({}); const [endOdometer,setEndOdometer]=useState('');

  async function api<T>(path:string, init?:RequestInit):Promise<T>{ const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(init?.headers??{})}}); const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(Array.isArray(data?.message)?data.message.join(', '):data?.message??`HTTP ${response.status}`); return data as T; }
  async function refresh(){ setLoading(true); try { const [t,v,e,w,s,p]=await Promise.all([readOptional(identity,'/fleet/trips',[] as CursorResponse<Trip>,p=>api<CursorResponse<Trip>>(p)),readOptional(identity,'/fleet/vehicles',[] as CursorResponse<Vehicle>,p=>api<CursorResponse<Vehicle>>(p)),readOptional(identity,'/hr/employees?limit=100',[] as CursorResponse<Employee>,p=>api<CursorResponse<Employee>>(p)),readOptional(identity,'/master-data/warehouses',[] as CursorResponse<Warehouse>,p=>api<CursorResponse<Warehouse>>(p)),api<CursorResponse<Shipment>>('/shipments?limit=100'),api<CursorResponse<Product>>('/products?limit=200')]); const tr=rowsOf(t), vr=rowsOf(v), er=rowsOf(e).filter(x=>x.isActive!==false), wr=rowsOf(w).filter(x=>x.isActive!==false), sr=rowsOf(s), pr=rowsOf(p); setTrips(tr);setVehicles(vr);setEmployees(er);setWarehouses(wr);setShipments(sr);setProducts(pr);setSelectedTripId(x=>x&&tr.some(r=>r.id===x)?x:tr[0]?.id??''); setTripForm(x=>({...x,vehicleId:x.vehicleId||vr.find(r=>r.status==='AVAILABLE')?.id||vr[0]?.id||'',driverEmployeeId:x.driverEmployeeId||er[0]?.id||'',originWarehouseId:x.originWarehouseId||wr[0]?.id||''})); setStops(old=>old.map((row,i)=>({...row,shipmentId:row.shipmentId||sr.find(x=>['READY','PICKED_UP'].includes(x.status))?.id||sr[0]?.id||'',...(i===0&&!row.customerName?shipmentDefaults(sr.find(x=>x.id===(row.shipmentId||sr.find(y=>['READY','PICKED_UP'].includes(y.status))?.id||sr[0]?.id))):{})}))); setManifest(old=>old.map(row=>({...row,productId:row.productId||pr[0]?.id||'',shipmentId:row.shipmentId||sr[0]?.id||''}))); } catch(err){ setMessage(err instanceof Error?err.message:'Delivery lifecycle gagal dimuat.'); } finally{setLoading(false);} }
  useEffect(()=>{void refresh();},[token]);
  const selectedTrip=useMemo(()=>trips.find(x=>x.id===selectedTripId)??null,[trips,selectedTripId]);
  function shipmentDefaults(sh?:Shipment){ return { customerName:recipientValue(sh?.recipient,['name','recipientName','customerName'])||sh?.number||'', customerPhone:recipientValue(sh?.recipient,['phone','phoneNumber','customerPhone']), address:recipientValue(sh?.recipient,['address','fullAddress','shippingAddress']) }; }
  function changeStop(index:number, patch:Partial<StopDraft>){ setStops(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row)); }
  function selectShipment(index:number,id:string){ const sh=shipments.find(x=>x.id===id); changeStop(index,{shipmentId:id,...shipmentDefaults(sh)}); setManifest(rows=>rows.map(row=>row.stopIndex===index?{...row,shipmentId:id}:row)); }
  async function run(key:string,work:()=>Promise<string>){ if(busy)return;setBusy(key);setMessage('');try{setMessage(await work());await refresh();}catch(err){setMessage(err instanceof Error?err.message:'Operasi delivery gagal.');}finally{setBusy('');} }
  async function createTrip(e:FormEvent){e.preventDefault();await run('create-trip',async()=>{ const payload={vehicleId:tripForm.vehicleId,driverEmployeeId:tripForm.driverEmployeeId,originWarehouseId:tripForm.originWarehouseId||undefined,...(tripForm.startOdometer?{startOdometer:Number(tripForm.startOdometer)}:{}),stops:stops.map((row,i)=>{const sh=shipments.find(x=>x.id===row.shipmentId);return{sequence:i+1,shipmentId:row.shipmentId||undefined,orderId:sh?.orderId||undefined,saleId:sh?.saleId||undefined,customerName:row.customerName,customerPhone:row.customerPhone||undefined,address:row.address,codExpected:Number(row.codExpected||0)}}),manifestItems:manifest.map(row=>{const sh=shipments.find(x=>x.id===row.shipmentId);return{stopSequence:row.stopIndex+1,shipmentId:row.shipmentId||undefined,orderId:sh?.orderId||undefined,productId:row.productId,expectedQty:Number(row.expectedQty)}})}; const row=await api<Trip>('/fleet/trips',{method:'POST',body:JSON.stringify(payload)});setSelectedTripId(row.id);return`Trip ${row.number} dibuat dan kendaraan di-reserve.`;});}
  async function makeInspection(sourceType:string,sourceId:string,type:string,templateCode?:string){ const created=await api<Inspection>('/operations-control/inspections',{method:'POST',body:JSON.stringify({sourceType,sourceId,type,...(templateCode?{templateCode}:{})})}); const sourceResults:Array<{templateItemId?:string|null;code:string;label:string}>=created.results?.length?created.results:[{code:`${type}_CHECK`,label:`${type} operator confirmation`}]; const results=sourceResults.map(row=>({templateItemId:row.templateItemId||undefined,code:row.code,label:row.label,result:'PASS'})); return api<Inspection>(`/operations-control/inspections/${created.id}/complete`,{method:'POST',body:JSON.stringify({results,notes:'Confirmed from Admin delivery lifecycle'})}); }
  async function confirmLoading(){ if(!selectedTrip)return;await run('loading',async()=>{for(const item of selectedTrip.manifestItems){if(Number(scanQty[item.id]??0)!==item.expectedQty)throw new Error(`Scan ${item.product?.sku??item.productId} harus ${item.expectedQty}.`);} const inspection=await makeInspection('DeliveryTrip',selectedTrip.id,'OTHER'); await api(`/fleet/trips/${selectedTrip.id}/loading`,{method:'POST',body:JSON.stringify({inspectionId:inspection.id,scans:selectedTrip.manifestItems.map(item=>({manifestItemId:item.id,scannedQty:Number(scanQty[item.id]),damagedQty:0}))})});return'Loading manifest tervalidasi; trip READY_TO_DISPATCH.';}); }
  async function dispatchTrip(){if(!selectedTrip)return;await run('dispatch',async()=>{ const pre=await makeInspection('DeliveryTrip',selectedTrip.id,'VEHICLE_PRETRIP','VEHICLE-PRETRIP'); const gate=await api<GatePass>('/operations-control/gate-passes',{method:'POST',body:JSON.stringify({direction:'OUTBOUND',sourceType:'DeliveryTrip',sourceId:selectedTrip.id,vehicleId:selectedTrip.vehicleId,plateNumber:selectedTrip.vehicle?.plateNumber,driverName:selectedTrip.driver?.fullName,driverEmployeeId:selectedTrip.driverEmployeeId,inspectionId:pre.id})}); const approved=await api<GatePass>(`/operations-control/gate-passes/${gate.id}/approve`,{method:'POST',body:'{}'}); await api(`/fleet/trips/${selectedTrip.id}/dispatch`,{method:'POST',body:JSON.stringify({preTripInspectionId:pre.id,gatePassId:approved.id,startOdometer:selectedTrip.startOdometer??selectedTrip.vehicle?.currentOdometer??0})}); return`Pre-trip lulus, Gate Pass ${approved.number} disetujui, trip dispatched.`;}); }
  async function completeStop(stop:TripStop){await run(`stop-${stop.id}`,async()=>{const status=stopStatus[stop.id]||'DELIVERED';const cod=Number(stopCod[stop.id]??stop.codExpected??0);let proofInspectionId:string|undefined;if(status==='DELIVERED'){proofInspectionId=(await makeInspection('DeliveryStop',stop.id,'DELIVERY_PROOF','DELIVERY-PROOF')).id;}await api(`/fleet/stops/${stop.id}/complete`,{method:'POST',body:JSON.stringify({status,codCollected:['DELIVERED','PARTIAL'].includes(status)?cod:0,proofInspectionId,failureReason:stopReason[stop.id]||undefined})});return`Stop ${stop.sequence} diselesaikan sebagai ${status}.`;});}
  async function closeTrip(){if(!selectedTrip)return;await run('close-trip',async()=>{const end=Number(endOdometer||selectedTrip.startOdometer||selectedTrip.vehicle?.currentOdometer||0);const post=await makeInspection('DeliveryTrip',selectedTrip.id,'VEHICLE_POSTTRIP');await api(`/fleet/trips/${selectedTrip.id}/close`,{method:'POST',body:JSON.stringify({postTripInspectionId:post.id,endOdometer:end})});setEndOdometer('');return'Trip ditutup; kendaraan dan shipment return state direkonsiliasi.';});}

  const readyShipments=shipments.filter(x=>['READY','PICKED_UP'].includes(x.status));
  async function createShipment(event:FormEvent){
    event.preventDefault();
    await run('create-shipment',async()=>{
      // CreateShipmentDto: warehouseId and recipient are required; recipient is an @IsObject()
      // stored as JSON, so it is sent as the same {name, phone, address} shape shipmentDefaults()
      // reads back — otherwise the trip manifest would show empty recipient rows.
      await api('/shipments',{method:'POST',body:JSON.stringify({
        warehouseId:shipmentForm.warehouseId,
        carrier:shipmentForm.carrier.trim()||undefined,
        service:shipmentForm.service.trim()||undefined,
        recipient:{ name:shipmentForm.name.trim(), phone:shipmentForm.phone.trim(), address:shipmentForm.address.trim() },
      })});
      setShipmentForm({warehouseId:shipmentForm.warehouseId,name:'',phone:'',address:'',carrier:'',service:''});
      return'Shipment dibuat dan siap dimasukkan ke manifest trip.';
    });
  }

  return <>
    <Panel eyebrow="DELIVERY CONTROL" title="Outbound / Delivery Lifecycle" badge={loading?'memuat':`${trips.filter(x=>x.status!=='CLOSED'&&x.status!=='CANCELLED').length} aktif`}>
      <p className="sectionHelp">Workflow operator: trip → manifest/loading → pre-trip + Gate Pass → dispatch → POD/COD atau gagal/return → post-trip → close.</p>
      <form className="formStack" onSubmit={createShipment}>
        <h4>Buat shipment</h4>
        <p className="sectionHelp">Dipakai lebih dulu sebelum trip: setiap stop pada trip menunjuk shipment yang sudah ada.</p>
        <label>Gudang asal<select required value={shipmentForm.warehouseId} onChange={e=>setShipmentForm({...shipmentForm,warehouseId:e.target.value})}><option value="">Pilih gudang</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
        <label>Nama penerima<input required value={shipmentForm.name} onChange={e=>setShipmentForm({...shipmentForm,name:e.target.value})} /></label>
        <label>Telepon<input value={shipmentForm.phone} onChange={e=>setShipmentForm({...shipmentForm,phone:e.target.value})} /></label>
        <label>Alamat<input value={shipmentForm.address} onChange={e=>setShipmentForm({...shipmentForm,address:e.target.value})} /></label>
        <div className="grid2"><label>Kurir (opsional)<input value={shipmentForm.carrier} onChange={e=>setShipmentForm({...shipmentForm,carrier:e.target.value})} /></label><label>Layanan (opsional)<input value={shipmentForm.service} onChange={e=>setShipmentForm({...shipmentForm,service:e.target.value})} /></label></div>
        {canAll('shipment.manage')?<button disabled={Boolean(busy)}>Buat shipment</button>:<small className="sectionHelp">Dibuat dengan izin shipment.manage.</small>}
      </form>
      <form className="formStack" onSubmit={createTrip}>
        <label>Kendaraan<select required value={tripForm.vehicleId} onChange={e=>setTripForm({...tripForm,vehicleId:e.target.value})}>{vehicles.map(v=><option key={v.id} value={v.id}>{v.code} · {v.plateNumber} · {v.status}</option>)}</select></label>
        <label>Driver<select required value={tripForm.driverEmployeeId} onChange={e=>setTripForm({...tripForm,driverEmployeeId:e.target.value})}>{employees.map(x=><option key={x.id} value={x.id}>{x.employeeNumber} · {x.fullName}</option>)}</select></label>
        <label>Gudang asal<select required value={tripForm.originWarehouseId} onChange={e=>setTripForm({...tripForm,originWarehouseId:e.target.value})}>{warehouses.map(x=><option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></label>
        <label>Odometer awal<input type="number" min="0" value={tripForm.startOdometer} onChange={e=>setTripForm({...tripForm,startOdometer:e.target.value})}/></label>
        {stops.map((row,i)=><div key={`stop-${i}`} className="formStack"><strong>Stop {i+1}</strong><label>Shipment<select required value={row.shipmentId} onChange={e=>selectShipment(i,e.target.value)}>{readyShipments.map(x=><option key={x.id} value={x.id}>{x.number} · {x.status}</option>)}</select></label><label>Penerima<input required value={row.customerName} onChange={e=>changeStop(i,{customerName:e.target.value})}/></label><label>Telepon<input value={row.customerPhone} onChange={e=>changeStop(i,{customerPhone:e.target.value})}/></label><label>Alamat<input required value={row.address} onChange={e=>changeStop(i,{address:e.target.value})}/></label><label>COD expected<input type="number" min="0" value={row.codExpected} onChange={e=>changeStop(i,{codExpected:Number(e.target.value)})}/></label>{stops.length>1&&<button type="button" className="secondary" onClick={()=>{setStops(x=>x.filter((_,n)=>n!==i));setManifest(x=>x.filter(m=>m.stopIndex!==i).map(m=>({...m,stopIndex:m.stopIndex>i?m.stopIndex-1:m.stopIndex})));}}>Hapus stop</button>}</div>)}
        <button type="button" className="secondary" onClick={()=>setStops(x=>[...x,{shipmentId:readyShipments[0]?.id??'',...shipmentDefaults(readyShipments[0]),codExpected:0}])}>Tambah stop</button>
        {manifest.map((row,i)=><div key={`manifest-${i}`} className="formStack"><strong>Manifest {i+1}</strong><label>Stop<select value={row.stopIndex} onChange={e=>setManifest(x=>x.map((m,n)=>n===i?{...m,stopIndex:Number(e.target.value),shipmentId:stops[Number(e.target.value)]?.shipmentId??m.shipmentId}:m))}>{stops.map((_,n)=><option key={n} value={n}>Stop {n+1}</option>)}</select></label><label>Produk<select required value={row.productId} onChange={e=>setManifest(x=>x.map((m,n)=>n===i?{...m,productId:e.target.value}:m))}>{products.map(x=><option key={x.id} value={x.id}>{x.sku} · {x.name}</option>)}</select></label><label>Qty<input required type="number" min="1" value={row.expectedQty} onChange={e=>setManifest(x=>x.map((m,n)=>n===i?{...m,expectedQty:Number(e.target.value)}:m))}/></label>{manifest.length>1&&<button type="button" className="secondary" onClick={()=>setManifest(x=>x.filter((_,n)=>n!==i))}>Hapus item</button>}</div>)}
        <button type="button" className="secondary" onClick={()=>setManifest(x=>[...x,{stopIndex:0,shipmentId:stops[0]?.shipmentId??'',productId:products[0]?.id??'',expectedQty:1}])}>Tambah item manifest</button>
        {canAll('delivery.trip.manage')&&<button disabled={Boolean(busy)||!readyShipments.length}>{busy==='create-trip'?'Membuat…':'Buat delivery trip'}</button>}
      </form>
    </Panel>

    <Panel eyebrow="TRIP WORKBENCH" title={selectedTrip?selectedTrip.number:'Pilih trip'} badge={selectedTrip?.status}>
      <label>Trip<select value={selectedTripId} onChange={e=>setSelectedTripId(e.target.value)}><option value="">Pilih trip</option>{trips.map(x=><option key={x.id} value={x.id}>{x.number} · {x.status}</option>)}</select></label>
      {selectedTrip&&<>
        <p className="sectionHelp">{selectedTrip.vehicle?.code??'-'} · {selectedTrip.driver?.fullName??'-'} · {selectedTrip.originWarehouse?.name??'-'} · COD {rupiah(Number(selectedTrip.codCollected||0))}/{rupiah(Number(selectedTrip.codExpected||0))}</p>
        <Table head={['Stop','Shipment','Penerima','COD','Status','Aksi']} rows={selectedTrip.stops.map(stop=>[stop.sequence,stop.shipment?.number??stop.shipmentId??'-',`${stop.customerName} · ${stop.address}`,`${rupiah(Number(stop.codCollected||0))}/${rupiah(Number(stop.codExpected||0))}`,<StatusChip status={stop.status}/>,['PENDING','ARRIVED'].includes(stop.status)?<div className="formStack"><select value={stopStatus[stop.id]||'DELIVERED'} onChange={e=>setStopStatus({...stopStatus,[stop.id]:e.target.value})}><option>DELIVERED</option><option>FAILED</option><option>RETURNED</option></select>{(stopStatus[stop.id]||'DELIVERED')==='DELIVERED'&&<input type="number" min="0" placeholder="COD diterima" value={stopCod[stop.id]??String(stop.codExpected??0)} onChange={e=>setStopCod({...stopCod,[stop.id]:e.target.value})}/>} {(stopStatus[stop.id]||'DELIVERED')!=='DELIVERED'&&<input placeholder="Alasan gagal/return" value={stopReason[stop.id]??''} onChange={e=>setStopReason({...stopReason,[stop.id]:e.target.value})}/>}{canAll('delivery.proof','inspection.record')&&<button type="button" disabled={Boolean(busy)} onClick={()=>void completeStop(stop)}>Selesaikan stop</button>}</div>:'-'])} empty="Belum ada stop"/>
        <Table head={['Produk','Expected','Scan','Loaded','Delivered','Returned','Status']} rows={selectedTrip.manifestItems.map(item=>[`${item.product?.sku??''} ${item.product?.name??item.productId}`,item.expectedQty,<input key={item.id} type="number" min="0" max={item.expectedQty} value={scanQty[item.id]??''} onChange={e=>setScanQty({...scanQty,[item.id]:e.target.value})}/>,item.loadedQty,item.deliveredQty,item.returnedQty,<StatusChip status={item.status}/>])} empty="Manifest kosong"/>
        <div className="rowActions">
          {['DRAFT','PLANNED','LOADING'].includes(selectedTrip.status)&&canAll('delivery.loading.confirm','inspection.record')&&<button type="button" disabled={Boolean(busy)} onClick={()=>void confirmLoading()}>{busy==='loading'?'Memvalidasi…':'Konfirmasi loading/scan'}</button>}
          {selectedTrip.status==='READY_TO_DISPATCH'&&canAll('delivery.dispatch','gate_pass.manage','gate_pass.approve','inspection.record')&&<button type="button" disabled={Boolean(busy)} onClick={()=>void dispatchTrip()}>{busy==='dispatch'?'Dispatch…':'Pre-trip + Gate Pass + Dispatch'}</button>}
          {['DELIVERED','PARTIALLY_DELIVERED','RETURNING'].includes(selectedTrip.status)&&<>{canAll('delivery.trip.manage','inspection.record')&&<><input type="number" min={selectedTrip.startOdometer??0} placeholder="Odometer akhir" value={endOdometer} onChange={e=>setEndOdometer(e.target.value)}/><button type="button" disabled={Boolean(busy)} onClick={()=>void closeTrip()}>{busy==='close-trip'?'Menutup…':'Post-trip + Close trip'}</button></>}</>}
        </div>
        <small>Loading inspection {selectedTrip.loadingInspection?.status??'-'} · Pre-trip {selectedTrip.preTripInspection?.status??'-'} · Gate Pass {selectedTrip.gatePass?.status??'-'} · Post-trip {selectedTrip.postTripInspection?.status??'-'}</small>
      </>}
    </Panel>
    <Panel eyebrow="DELIVERY TRIPS" title="Status trip" badge={`${trips.length} trip`}><Table loading={loading} head={['Trip','Waktu','Armada/Driver','COD','Status']} rows={trips.map(t=>[<strong>{t.number}</strong>,tanggal(t.createdAt),`${t.vehicle?.code??'-'} · ${t.driver?.fullName??'-'}`,`${rupiah(Number(t.codCollected||0))}/${rupiah(Number(t.codExpected||0))}`,<StatusChip status={t.status}/>])} empty="Belum ada trip pengiriman."/></Panel>
    {message&&<div className="notice">{message}</div>}
  </>;
}
