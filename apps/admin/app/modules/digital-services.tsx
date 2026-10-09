'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Product = { id:string; metadata?:{taxTreatment?:string}|null; providerSku:string; name:string; category:string; brand?:string|null; costPrice?:string|null; salePrice:string; active:boolean; stock?:number|null; unlimitedStock:boolean };
type Tx = { id:string; number:string; providerSku:string; customerNo:string; sellingPrice:string; costAmount?:string|null; status:string; paymentAccountingEventId?:string|null; settlementAccountingEventId?:string|null; refundAccountingEventId?:string|null; serialNumber?:string|null; message?:string|null; createdAt:string; attempts:number };
type Page<T> = { items:T[]; nextCursor?:string|null };
type Integration = { id:string; type:string; provider:string; name:string; status:string; config?:{providerBalanceAccountCode?:string;ppobCashEnabled?:boolean}|null; hasSecrets:boolean; branchId?:string|null; lastHealthCheckAt?:string|null; lastError?:string|null };

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
  const [taxVerify,setTaxVerify]=useState({productId:'',reason:''});
  const [providerBalanceAccount,setProviderBalanceAccount]=useState('');
  const [ppobCashEnabled,setPpobCashEnabled]=useState(false);
  const [credential,setCredential]=useState({username:'',apiKey:'',name:'Digiflazz'});

  async function refresh(){
    try{
      const [p,t,connections]=await Promise.all([
        call<Page<Product>>(token,`/digital-services/products?limit=200${query?`&search=${encodeURIComponent(query)}`:''}`),
        call<Page<Tx>>(token,'/digital-services/transactions?limit=100'),
        call<Integration[]>(token,'/platform/integrations'),
      ]);
      setProducts(p.items); setTxs(t.items);
      const connection=connections.find((row)=>row.type==='PPOB'&&row.provider.toUpperCase()==='DIGIFLAZZ')??null;
      setIntegration(connection);
      setProviderBalanceAccount(connection?.config?.providerBalanceAccountCode??'');
      setPpobCashEnabled(connection?.config?.ppobCashEnabled===true);
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
        await call(token,`/platform/integrations/${integration.id}`,{method:'PATCH',body:JSON.stringify({status:'CONNECTED',encryptedSecrets,config:{...(integration?.config??{}),catalogKind:'prepaid',providerBalanceAccountCode:providerBalanceAccount.trim().toUpperCase(),ppobCashEnabled},capabilities:{catalog:true,prepaidTransaction:true,recheck:true}})});
      }else{
        await call(token,'/platform/integrations',{method:'POST',body:JSON.stringify({type:'PPOB',provider:'DIGIFLAZZ',name:credential.name.trim()||'Digiflazz',encryptedSecrets,config:{catalogKind:'prepaid',providerBalanceAccountCode:providerBalanceAccount.trim().toUpperCase(),ppobCashEnabled},capabilities:{catalog:true,prepaidTransaction:true,recheck:true}})});
      }
      setCredential((value)=>({...value,username:'',apiKey:''}));
      await refresh();
      setMessage('Koneksi Digiflazz tersimpan terenkripsi. Jalankan Sync katalog untuk memuat produk provider.');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Koneksi Digiflazz gagal disimpan.');}
    finally{setBusy(false);}
  }

  async function sync(){setBusy(true);try{const result=await call<{queued:boolean;message?:string}>(token,'/digital-services/catalog/sync',{method:'POST',body:'{}'});setMessage(result.message??(result.queued?'Sinkron katalog masuk antrean worker.':'Sinkron katalog sudah di antrean.'));}catch(cause){setMessage(cause instanceof Error?cause.message:'Gagal sinkron katalog.');}finally{setBusy(false);}}
  async function verifyTax(event:FormEvent){
    event.preventDefault(); if(!canManage || !taxVerify.productId || taxVerify.reason.trim().length<12)return;
    setBusy(true);
    try{
      await call(token,`/digital-services/products/${encodeURIComponent(taxVerify.productId)}/tax-verification`,{
        method:'PATCH',body:JSON.stringify({taxTreatment:'NO_TAX_VERIFIED',reason:taxVerify.reason.trim()})
      });
      setTaxVerify({productId:'',reason:''});await refresh();setMessage('Perlakuan pajak diverifikasi dan dicatat di audit log.');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Verifikasi pajak gagal.');}
    finally{setBusy(false);}
  }
  async function finalize(id:string, action:'settle'|'refund'){
    setBusy(true);
    try{await call(token,`/digital-services/transactions/${encodeURIComponent(id)}/${action}`,{method:'POST',body:'{}'});
      await refresh();setMessage(action==='settle'?'Jurnal pendapatan dan biaya provider telah diposting.':'Uang muka telah dikembalikan melalui jurnal refund tunai.');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Penyelesaian PPOB gagal.');}
    finally{setBusy(false);}
  }
  async function recheck(id:string){setBusy(true);try{await call(token,`/digital-services/transactions/${id}/recheck`,{method:'POST',body:'{}'});await refresh();setMessage('Recheck provider masuk antrean.');}catch(cause){setMessage(cause instanceof Error?cause.message:'Recheck gagal.');}finally{setBusy(false);}}

  return <section className="moduleStack">
    <section className="grid2">
      <Panel eyebrow="PPOB CONNECTION" title="Digiflazz" badge={integration?.status??'BELUM TERHUBUNG'}>
        {integration&&<div className="formStack"><div><StatusChip status={integration.status}/></div><small>Credential: {integration.hasSecrets?'TERSIMPAN':'BELUM ADA'} · scope: {integration.branchId?'BRANCH':'COMPANY'}</small>{integration.lastError&&<div className="notice">{integration.lastError}</div>}</div>}
        {canConfigure&&<form className="formStack" onSubmit={saveConnection}>
          <label>Nama koneksi<input value={credential.name} onChange={(e)=>setCredential({...credential,name:e.target.value})}/></label>
          <label>Username Digiflazz<input autoComplete="off" value={credential.username} onChange={(e)=>setCredential({...credential,username:e.target.value})}/></label>
          <label>API key<input type="password" autoComplete="new-password" value={credential.apiKey} onChange={(e)=>setCredential({...credential,apiKey:e.target.value})}/></label><label>Kode akun aset saldo Digiflazz (untuk HPP dan settlement)<input value={providerBalanceAccount} placeholder="Misalnya akun aset saldo provider yang Anda buat" onChange={(e)=>setProviderBalanceAccount(e.target.value.toUpperCase())}/></label>
          <label><input type="checkbox" checked={ppobCashEnabled} onChange={(e)=>setPpobCashEnabled(e.target.checked)}/> Aktifkan transaksi PPOB tunai setelah verifikasi akun, aturan posting, pajak, dan provider</label>
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
      <Panel eyebrow="KEAMANAN PENJUALAN PPOB" title="Verifikasi pajak dan alur kasir">
        <p className="sectionHelp">Transaksi baru dijual tunai lewat POS dengan shift aktif. Tidak ada lagi tombol Admin yang mengirim provider tanpa jurnal. Harga layanan wajib diverifikasi perlakuan pajaknya oleh Finance terlebih dahulu.</p>
        <form className="formStack" onSubmit={verifyTax}>
          <label>Layanan<select value={taxVerify.productId} required onChange={(e)=>setTaxVerify({...taxVerify,productId:e.target.value})}><option value="">Pilih layanan</option>{products.map((product)=><option key={product.id} value={product.id}>{product.providerSku} · {product.name} · {product.metadata?.taxTreatment??'BELUM DIVERIFIKASI'}</option>)}</select></label>
          <label>Dasar resmi klasifikasi tanpa pajak<input required minLength={12} value={taxVerify.reason} onChange={(e)=>setTaxVerify({...taxVerify,reason:e.target.value})}/></label>
          {Boolean(identity?.roles.some((role)=>['SUPER_ADMIN','OWNER','FINANCE'].includes(role)))&&canManage&&<button type="submit" disabled={busy||!taxVerify.productId||taxVerify.reason.trim().length<12}>Simpan bukti verifikasi pajak</button>}
          <p className="sectionHelp">Endpoint hanya menerima peran FINANCE/OWNER/SUPER_ADMIN. Jurnal uang muka wajib ada sebelum event provider dibuat.</p>
        </form>
      </Panel>
      <Panel eyebrow="PPOB HEALTH" title="Kesiapan provider"><div className="formStack"><div><StatusChip status={integration?.status??'DISCONNECTED'}/></div><p>{integration?.status==='CONNECTED'?'Provider siap menerima sync katalog/transaksi.':'Sambungkan IntegrationConnection PPOB/DIGIFLAZZ terlebih dahulu.'}</p><small>Live provider tetap bergantung pada credential Digiflazz yang valid dan akses jaringan worker.</small></div></Panel>
    </section>
    <Panel eyebrow="PPOB HISTORY" title="Status transaksi provider"><Table head={['Nomor','SKU / Tujuan','Status','Harga','SN / Pesan','Aksi']} rows={txs.map((row)=>[row.number,<><strong>{row.providerSku}</strong><br/><small>{row.customerNo}</small></>,<StatusChip status={row.status}/>,new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR'}).format(Number(row.sellingPrice)),row.serialNumber??row.message??'-',<div className="rowActions">
          {canManage&&['PENDING','PROCESSING'].includes(row.status)&&row.paymentAccountingEventId&&<button type="button" className="secondary" disabled={busy} onClick={()=>void recheck(row.id)}>Recheck</button>}
          {canManage&&row.status==='SUCCESS'&&row.paymentAccountingEventId&&!row.settlementAccountingEventId&&!row.refundAccountingEventId&&<button type="button" disabled={busy} onClick={()=>void finalize(row.id,'settle')}>Jurnal final</button>}
          {canAll('payment.refund')&&row.status==='FAILED'&&row.paymentAccountingEventId&&!row.refundAccountingEventId&&!row.settlementAccountingEventId&&<button type="button" className="secondary" disabled={busy} onClick={()=>void finalize(row.id,'refund')}>Refund tunai</button>}
          {row.refundAccountingEventId&&<small>REFUNDED</small>}{row.settlementAccountingEventId&&<small>SETTLED</small>}
        </div>])} empty="Belum ada transaksi digital."/></Panel>
    {message&&<div className="notice">{message}</div>}
  </section>;
}
