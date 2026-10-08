'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000/api/v1';
type KeyRow={id:string;name:string;keyPrefix:string;scopes:string[];isActive:boolean;lastUsedAt?:string|null;expiresAt?:string|null;apiKey?:string;warning?:string;branchId?:string|null;locationLabel?:string|null};
type BranchRow={id:string;code:string;name:string};
async function req<T>(token:string,path:string,init?:RequestInit){const r=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`HTTP ${r.status}: ${Array.isArray(d.message)?d.message.join(', '):d.message??'Request gagal'}`);return d as T;}

export default function ApiKeysView({token}:{token:string}){
  const [rows,setRows]=useState<KeyRow[]>([]);
  const [name,setName]=useState('');
  const [scopes,setScopes]=useState('product.view,inventory.view');
  const [secret,setSecret]=useState('');
  const [secretLabel,setSecretLabel]=useState('');
  const [msg,setMsg]=useState('');
  // POST-1D. A kiosk is a device in a specific branch, so issuing one asks two questions a generic
  // integration never would: which branch it is pinned to, and where the thing physically stands.
  const [branchId,setBranchId]=useState('');
  const [locationLabel,setLocationLabel]=useState('');
  const [branches,setBranches]=useState<BranchRow[]>([]);
  const [rotateTarget,setRotateTarget]=useState<KeyRow|null>(null);
  const [rotateConfirmation,setRotateConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const {canAll}=usePermissions(token);
  async function load(){setRows(await req<KeyRow[]>(token,'/api-keys'));}
  useEffect(()=>{void load().catch(e=>setMsg(e instanceof Error?e.message:'Gagal memuat API key'));},[token]);
  // /master-data/branches is the real listing; a bare /branches does not exist and 404s, which
  // left the pin selector silently empty — an operator would conclude pinning was unavailable.
  useEffect(()=>{void req<BranchRow[]>(token,'/master-data/branches').then(setBranches).catch((error)=>{setBranches([]);setMsg(error instanceof Error?`Daftar cabang gagal dimuat: ${error.message}`:'Daftar cabang gagal dimuat.');});},[token]);
  async function create(e:FormEvent){e.preventDefault();setBusy(true);try{const row=await req<KeyRow>(token,'/api-keys',{method:'POST',body:JSON.stringify({name,scopes:scopes.split(',').map(x=>x.trim()).filter(Boolean),...(branchId?{branchId}:{}),...(locationLabel.trim()?{locationLabel:locationLabel.trim()}:{})})});setSecret(row.apiKey??'');setSecretLabel(`Key baru · ${row.keyPrefix}`);setName('');setBranchId('');setLocationLabel('');await load();setMsg('API key dibuat. Simpan secret sebelum meninggalkan halaman.');}catch(e){setMsg(e instanceof Error?e.message:'Gagal membuat key');}finally{setBusy(false);}}
  async function revoke(id:string){setBusy(true);try{await req(token,`/api-keys/${id}/revoke`,{method:'PATCH'});await load();setMsg('API key dicabut.');}catch(e){setMsg(e instanceof Error?e.message:'Gagal revoke');}finally{setBusy(false);}}
  async function rotate(e:FormEvent){e.preventDefault();if(!rotateTarget)return;setBusy(true);try{const row=await req<KeyRow>(token,`/api-keys/${rotateTarget.id}/rotate`,{method:'POST',body:'{}'});setSecret(row.apiKey??'');setSecretLabel(`Rotasi ${rotateTarget.name} · ${row.keyPrefix}`);setRotateTarget(null);setRotateConfirmation('');await load();setMsg('API key dirotasi. Secret lama langsung tidak berlaku.');}catch(error){setMsg(error instanceof Error?error.message:'Gagal rotate key');}finally{setBusy(false);}}
  return <section className="stack">
    <Panel eyebrow="INTEGRATION SECURITY" title="API Keys" badge={`${rows.filter(x=>x.isActive).length} aktif`}>
      <p className="sectionHelp">Lifecycle operator lengkap: create, rotate one-time secret, usage visibility, expiry, dan revoke. Secret penuh tidak pernah dapat dibaca ulang.</p>
      <form className="formStack" onSubmit={create}><label>Nama integrasi<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>Scopes (pisahkan koma)<input required value={scopes} onChange={e=>setScopes(e.target.value)}/></label>
        <label>Pin ke cabang (opsional)<select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Tidak — pakai header x-toko360-branch-id</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></label>
        <label>Lokasi perangkat (opsional)<input value={locationLabel} onChange={e=>setLocationLabel(e.target.value)} placeholder="mis. kios pintu masuk"/></label>
        <div className="actionRow"><button type="button" className="secondary" onClick={()=>{setName('Kios cek harga');setScopes('kiosk.price.read');setLocationLabel('kios pintu masuk');}}>Preset kios</button></div>
        {canAll('api_key.manage')&&<button disabled={busy}>Buat API key</button>}</form>
      {secret&&<div className="notice"><strong>SECRET SEKALI TAMPIL — {secretLabel}</strong><br/><code className="secretCode">{secret}</code><div className="actionRow"><button type="button" className="secondary" onClick={()=>{setSecret('');setSecretLabel('');}}>Saya sudah menyimpan secret</button></div></div>}
      <Table head={['Nama','Prefix / Last use','Scopes','Status','Aksi']} rows={rows.map(k=>[<strong key={`${k.id}-name`}>{k.name}</strong>,<span key={`${k.id}-usage`}><code>{k.keyPrefix}</code><small>{k.lastUsedAt?`last ${new Date(k.lastUsedAt).toLocaleString('id-ID')}`:'belum digunakan'}{k.expiresAt?` · exp ${new Date(k.expiresAt).toLocaleDateString('id-ID')}`:''}</small></span>,<span key={`${k.id}-scopes`}><small>{k.scopes.join(', ')}</small>{k.branchId&&<small> · pin {branches.find(b=>b.id===k.branchId)?.code??k.branchId}</small>}{k.locationLabel&&<small> · {k.locationLabel}</small>}</span>,<StatusChip key={`${k.id}-status`} status={k.isActive?'ACTIVE':'INACTIVE'}/>,k.isActive?(canAll('api_key.manage')?<div className="actionRow" key={`${k.id}-actions`}><button type="button" className="secondary" disabled={busy} onClick={()=>{setRotateTarget(k);setRotateConfirmation('');}}>Rotate</button><button type="button" className="secondary" disabled={busy} onClick={()=>void revoke(k.id)}>Revoke</button></div>:'-'):'-'])} empty="Belum ada API key"/>
      <p className="sectionHelp">Pemakaian integrasi: header <code>x-api-key</code>. Untuk perusahaan multi-cabang tambahkan <code>x-toko360-branch-id</code>. Scope mengikuti permission domain.action.</p>
      <p className="sectionHelp"><strong>Perangkat kios:</strong> gunakan preset kios. Kunci yang dipin ke satu cabang <em>menolak</em> header cabang yang berbeda — inilah yang mencegah layar di kasir 2, atau perangkat mana pun yang diklik, untuk membaca harga cabang lain. Kios hanya bisa membaca: scopenya <code>kiosk.price.read</code> dan tidak memberi akses tulis apa pun.</p>
    </Panel>
    {rotateTarget&&<Panel eyebrow="KEY ROTATION" title={`Rotate ${rotateTarget.name}`} badge="ONE-TIME SECRET"><form className="formStack" onSubmit={rotate}><p className="sectionHelp">Rotasi langsung membatalkan secret lama. Ketik <strong>ROTATE</strong> untuk melanjutkan tanpa native browser confirm.</p><label>Konfirmasi<input value={rotateConfirmation} onChange={(e)=>setRotateConfirmation(e.target.value)} placeholder="ROTATE" required/></label><div className="actionRow"><button type="button" className="secondary" onClick={()=>{setRotateTarget(null);setRotateConfirmation('');}}>Batal</button>{canAll('api_key.manage')&&<button disabled={busy||rotateConfirmation!=='ROTATE'}>Rotate key</button>}</div></form></Panel>}
    {msg&&<div className="notice">{msg}</div>}
  </section>;
}
