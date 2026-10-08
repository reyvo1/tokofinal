'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Product = { providerSku:string; name:string; category:string; brand?:string|null; costPrice?:string|null; salePrice:string; active:boolean; stock?:number|null; unlimitedStock:boolean };
type Tx = { id:string; number:string; providerSku:string; customerNo:string; sellingPrice:string; costAmount?:string|null; status:string; serialNumber?:string|null; message?:string|null; createdAt:string; attempts:number };
type Page<T> = { items:T[]; nextCursor?:string|null };
type Integration = { id:string; type:string; provider:string; name:string; status:string; hasSecrets:boolean; branchId?:string|null; lastHealthCheckAt?:string|null; lastError?:string|null };

async function call<T>(token:string,path:string,init?:RequestInit):Promise<T>{
  const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(Array.isArray(body.message)?body.message.join(', '):body.message??`HTTP ${response.status}`);
  return body as T;
}

export default function DigitalServicesView({token}:{token:string}){
  const {canAll,identity}=usePermissions(token);
  const adminRole=Boolean(identity?.roles.some((role)=>['SUPER_ADMIN','OWNER','ADMIN'].includes(role)));
  const canManage=canAll('digital_service.manage');
  const canSync=adminRole&&canManage;
  const canConfigure=adminRole&&canAll('integration.manage');
  const [products,setProducts]=useState<Product[]>([]);
  const [txs,setTxs]=useState<Tx[]>([]);
  const [integration,setIntegration]=useState<Integration|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [query,setQuery]=useState('');
  const [form,setForm]=useState({providerSku:'',customerNo:'',maxPrice:''});
  const [credential,setCredential]=useState({username:'',apiKey:'',name:'Digiflazz'});

  async function refresh(){
    try{
      const [p,t,connections]=await Promise.all([
        call<Page<Product>>(token,`/digital-services/products?limit=200${query?`&search=${encodeURIComponent(query)}`:''}`),
        call<Page<Tx>>(token,'/digital-services/transactions?limit=100'),
        call<Integration[]>(token,'/platform/integrations'),
      ]);
      setProducts(p.items); setTxs(t.items);
      setIntegration(connections.find((row)=>row.type==='PPOB'&&row.provider.toUpperCase()==='DIGIFLAZZ')??null);
      setMessage('');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Digital services gagal dimuat.');}
  }
  useEffect(()=>{void refresh();},[token]);

  async function saveConnection(event:FormEvent){
    event.preventDefault();
    if(!canConfigure)return;
    if(!credential.username.trim()||!credential.apiKey.trim()){setMessage('Username dan API key Digiflazz wajib diisi.');return;}
    setBusy(true);
    try{
      const encryptedSecrets=JSON.stringify({username:credential.username.trim(),apiKey:credential.apiKey.trim()});
      if(integration){
        await call(token,`/platform/integrations/${integration.id}`,{method:'PATCH',body:JSON.stringify({status:'CONNECTED',encryptedSecrets,config:{catalogKind:'prepaid'},capabilities:{catalog:true,prepaidTransaction:true,recheck:true}})});
      }else{
        await call(token,'/platform/integrations',{method:'POST',body:JSON.stringify({type:'PPOB',provider:'DIGIFLAZZ',name:credential.name.trim()||'Digiflazz',encryptedSecrets,config:{catalogKind:'prepaid'},capabilities:{catalog:true,prepaidTransaction:true,recheck:true}})});
      }
      setCredential((value)=>({...value,username:'',apiKey:''}));
      await refresh();
      setMessage('Koneksi Digiflazz tersimpan terenkripsi. Jalankan Sync katalog untuk memuat produk provider.');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Koneksi Digiflazz gagal disimpan.');}
    finally{setBusy(false);}
  }

  async function sync(){setBusy(true);try{const result=await call<{queued:boolean;message?:string}>(token,'/digital-services/catalog/sync',{method:'POST',body:'{}'});setMessage(result.message??(result.queued?'Sinkron katalog masuk antrean worker.':'Sinkron katalog sudah di antrean.'));}catch(cause){setMessage(cause instanceof Error?cause.message:'Gagal sinkron katalog.');}finally{setBusy(false);}}
  async function buy(event:FormEvent){event.preventDefault();setBusy(true);try{await call(token,'/digital-services/transactions',{method:'POST',body:JSON.stringify({providerSku:form.providerSku,customerNo:form.customerNo,idempotencyKey:`admin-ppob:${crypto.randomUUID()}`,...(form.maxPrice?{maxPrice:Number(form.maxPrice)}:{})})});setForm((value)=>({...value,customerNo:''}));await refresh();setMessage('Transaksi PPOB masuk antrean provider.');}catch(cause){setMessage(cause instanceof Error?cause.message:'Transaksi gagal.');}finally{setBusy(false);}}
  async function recheck(id:string){setBusy(true);try{await call(token,`/digital-services/transactions/${id}/recheck`,{method:'POST',body:'{}'});await refresh();setMessage('Recheck provider masuk antrean.');}catch(cause){setMessage(cause instanceof Error?cause.message:'Recheck gagal.');}finally{setBusy(false);}}

  return <section className="moduleStack">
    <section className="grid2">
      <Panel eyebrow="PPOB CONNECTION" title="Digiflazz" badge={integration?.status??'BELUM TERHUBUNG'}>
        {integration&&<div className="formStack"><div><StatusChip status={integration.status}/></div><small>Credential: {integration.hasSecrets?'TERSIMPAN':'BELUM ADA'} · scope: {integration.branchId?'BRANCH':'COMPANY'}</small>{integration.lastError&&<div className="notice">{integration.lastError}</div>}</div>}
        {canConfigure&&<form className="formStack" onSubmit={saveConnection}>
          <label>Nama koneksi<input value={credential.name} onChange={(e)=>setCredential({...credential,name:e.target.value})}/></label>
          <label>Username Digiflazz<input autoComplete="off" value={credential.username} onChange={(e)=>setCredential({...credential,username:e.target.value})}/></label>
          <label>API key<input type="password" autoComplete="new-password" value={credential.apiKey} onChange={(e)=>setCredential({...credential,apiKey:e.target.value})}/></label>
          <button disabled={busy}>{integration?'Rotasi credential & aktifkan':'Hubungkan Digiflazz'}</button>
          <p className="sectionHelp">Secret dikirim satu kali ke backend lalu disimpan terenkripsi. API key tidak pernah dibaca kembali ke browser.</p>
        </form>}
      </Panel>
      <Panel eyebrow="PPOB / DIGIFLAZZ" title="Katalog layanan digital" badge={`${products.length} produk`}>
        <div className="formStack"><div className="rowActions"><input placeholder="Cari pulsa / PLN / data / game" value={query} onChange={(e)=>setQuery(e.target.value)}/><button type="button" className="secondary" onClick={()=>void refresh()}>Cari</button>{canSync&&<button type="button" disabled={busy||integration?.status!=='CONNECTED'} onClick={()=>void sync()}>Sync katalog</button>}</div>
        <Table head={['SKU','Produk','Kategori','Harga','Stok']} rows={products.slice(0,50).map((product)=>[product.providerSku,<><strong>{product.name}</strong><br/><small>{product.brand??'-'}</small></>,product.category,new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR'}).format(Number(product.salePrice)),product.unlimitedStock?'∞':String(product.stock??'-')])} empty="Katalog belum tersinkron. Hubungkan Digiflazz lalu sync katalog."/></div>
      </Panel>
    </section>
    <section className="grid2">
      <Panel eyebrow="TRANSAKSI DIGITAL" title="Pulsa, token, paket & voucher"><form className="formStack" onSubmit={buy}><label>Produk<select required value={form.providerSku} onChange={(e)=>{const product=products.find((row)=>row.providerSku===e.target.value);setForm({...form,providerSku:e.target.value,maxPrice:product?.costPrice??''});}}><option value="">Pilih produk</option>{products.map((product)=><option key={product.providerSku} value={product.providerSku}>{product.providerSku} · {product.name} · Rp {Number(product.salePrice).toLocaleString('id-ID')}</option>)}</select></label><label>Nomor pelanggan / meter<input required minLength={3} value={form.customerNo} onChange={(e)=>setForm({...form,customerNo:e.target.value.replace(/\s+/g,'')})}/></label><label>Batas harga beli provider<input type="number" min="0" value={form.maxPrice} onChange={(e)=>setForm({...form,maxPrice:e.target.value})}/></label>{canManage&&<button disabled={busy||!form.providerSku||integration?.status!=='CONNECTED'}>Kirim transaksi</button>}<p className="sectionHelp">Idempotency key dibuat per transaksi. Eksekusi provider berjalan melalui outbox/worker.</p></form></Panel>
      <Panel eyebrow="PPOB HEALTH" title="Kesiapan provider"><div className="formStack"><div><StatusChip status={integration?.status??'DISCONNECTED'}/></div><p>{integration?.status==='CONNECTED'?'Provider siap menerima sync katalog/transaksi.':'Sambungkan IntegrationConnection PPOB/DIGIFLAZZ terlebih dahulu.'}</p><small>Live provider tetap bergantung pada credential Digiflazz yang valid dan akses jaringan worker.</small></div></Panel>
    </section>
    <Panel eyebrow="PPOB HISTORY" title="Status transaksi provider"><Table head={['Nomor','SKU / Tujuan','Status','Harga','SN / Pesan','Aksi']} rows={txs.map((row)=>[row.number,<><strong>{row.providerSku}</strong><br/><small>{row.customerNo}</small></>,<StatusChip status={row.status}/>,new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR'}).format(Number(row.sellingPrice)),row.serialNumber??row.message??'-',canManage&&['PENDING','PROCESSING'].includes(row.status)?<button type="button" className="secondary" disabled={busy} onClick={()=>void recheck(row.id)}>Recheck</button>:null])} empty="Belum ada transaksi digital."/></Panel>
    {message&&<div className="notice">{message}</div>}
  </section>;
}
