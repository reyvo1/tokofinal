'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type Company = { id:string; name:string; slug?:string|null; timezone:string; currency:string; createdAt?:string; updatedAt?:string };
type Branch = { id:string; code:string; name:string; address?:string|null; isActive:boolean };
type TenantProfile = {
  company: Company;
  branches: Branch[];
  activeBranchId: string;
  provisioningMode: 'BOOTSTRAP_ONLY';
  provisioningNote: string;
};

async function call<T>(token:string,path:string,init?:RequestInit):Promise<T>{
  const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});
  const data=await response.json();
  if(!response.ok)throw new Error(Array.isArray(data.message)?data.message.join(', '):data.message??'Request gagal');
  return data as T;
}

export default function OrganizationAdminView({token}:{token:string}){
  // PATCH /platform/tenant dijaga platform.configure, sedangkan POST/PATCH
  // /master-data/branches dijaga master_data.manage. Dua permission itu tidak
  // boleh diasumsikan selalu dimiliki bersamaan.
  const {canAll}=usePermissions(token);
  const canConfigurePlatform=canAll('platform.configure');
  const canManageBranches=canAll('master_data.manage');
  const [profile,setProfile]=useState<TenantProfile|null>(null);
  const [message,setMessage]=useState('');
  const [tenantForm,setTenantForm]=useState({name:'',timezone:'Asia/Makassar',currency:'IDR'});
  const [branchForm,setBranchForm]=useState({code:'',name:'',address:''});
  const [editingBranchId,setEditingBranchId]=useState<string|null>(null);

  async function refresh(){
    const tenant=await call<TenantProfile>(token,'/platform/tenant');
    setProfile(tenant);
    setTenantForm({name:tenant.company.name,timezone:tenant.company.timezone,currency:tenant.company.currency});
  }
  useEffect(()=>{void refresh().catch((error)=>setMessage(error instanceof Error?error.message:'Gagal memuat tenant'));},[token]);

  async function saveTenant(event:FormEvent){
    event.preventDefault();
    setMessage('');
    try{
      await call(token,'/platform/tenant',{method:'PATCH',body:JSON.stringify({
        name:tenantForm.name.trim(),timezone:tenantForm.timezone.trim(),currency:tenantForm.currency.trim().toUpperCase(),
      })});
      await refresh();
      setMessage('Profil company aktif diperbarui.');
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan company');}
  }

  async function saveBranch(event:FormEvent){
    event.preventDefault();
    setMessage('');
    try{
      const path=editingBranchId?`/master-data/branches/${editingBranchId}`:'/master-data/branches';
      await call(token,path,{method:editingBranchId?'PATCH':'POST',body:JSON.stringify({
        code:branchForm.code.trim().toUpperCase(),name:branchForm.name.trim(),address:branchForm.address.trim()||undefined,
      })});
      setEditingBranchId(null);
      setBranchForm({code:'',name:'',address:''});
      await refresh();
      setMessage(editingBranchId?'Cabang diperbarui.':'Cabang dibuat.');
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan cabang');}
  }

  function editBranch(branch:Branch){
    setEditingBranchId(branch.id);
    setBranchForm({code:branch.code,name:branch.name,address:branch.address??''});
  }
  async function toggleBranch(branch:Branch){
    setMessage('');
    try{
      await call(token,`/master-data/branches/${branch.id}`,{method:'PATCH',body:JSON.stringify({isActive:!branch.isActive})});
      await refresh();
      setMessage(branch.isActive?'Cabang dinonaktifkan.':'Cabang diaktifkan.');
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal mengubah status cabang');}
  }

  return <section className="stack">
    <section className="grid2">
      <Panel eyebrow="TENANT" title="Company Aktif" badge={profile?.company.slug??'tenant'}>
        <form className="formStack" onSubmit={saveTenant}>
          <label>Nama company<input required minLength={2} value={tenantForm.name} onChange={(event)=>setTenantForm({...tenantForm,name:event.target.value})}/></label>
          <label>Timezone IANA<input required value={tenantForm.timezone} onChange={(event)=>setTenantForm({...tenantForm,timezone:event.target.value})} placeholder="Asia/Makassar"/></label>
          <label>Mata uang<input required maxLength={3} value={tenantForm.currency} onChange={(event)=>setTenantForm({...tenantForm,currency:event.target.value.toUpperCase()})} placeholder="IDR"/></label>
          {canConfigurePlatform&&<button>Simpan company</button>}
        </form>
        <p className="sectionHelp">{profile?.provisioningNote??'Company baru hanya dibuat melalui bootstrap/deployment terkontrol.'}</p>
      </Panel>

      <Panel eyebrow="BRANCH" title={editingBranchId?'Edit Cabang':'Tambah Cabang'} badge={`${profile?.branches.length??0} cabang`}>
        <form className="formStack" onSubmit={saveBranch}>
          <label>Kode cabang<input required value={branchForm.code} onChange={(event)=>setBranchForm({...branchForm,code:event.target.value.toUpperCase()})} placeholder="PUSAT"/></label>
          <label>Nama cabang<input required value={branchForm.name} onChange={(event)=>setBranchForm({...branchForm,name:event.target.value})}/></label>
          <label>Alamat<textarea value={branchForm.address} onChange={(event)=>setBranchForm({...branchForm,address:event.target.value})}/></label>
          <div className="actionRow">
            {canManageBranches&&<button>{editingBranchId?'Simpan perubahan':'Tambah cabang'}</button>}
            {editingBranchId&&<button type="button" className="secondary" onClick={()=>{setEditingBranchId(null);setBranchForm({code:'',name:'',address:''});}}>Batal</button>}
          </div>
        </form>
      </Panel>
    </section>

    <Panel eyebrow="CABANG TENANT" title="Daftar Cabang" badge={profile?.activeBranchId?'context aktif':'-'}>
      <Table
        head={['Kode','Nama','Alamat','Status','Context','Aksi']}
        rows={(profile?.branches??[]).map((branch)=>[
          <strong>{branch.code}</strong>,
          branch.name,
          branch.address??'-',
          <StatusChip status={branch.isActive?'ACTIVE':'INACTIVE'}/>,
          branch.id===profile?.activeBranchId?<strong>AKTIF</strong>:'-',
          <div className="actionRow">{canManageBranches&&<><button type="button" className="secondary" onClick={()=>editBranch(branch)}>Edit</button>{branch.id===profile?.activeBranchId&&branch.isActive?<span className="sectionHelp">Context aktif</span>:<button type="button" className="secondary" onClick={()=>void toggleBranch(branch)}>{branch.isActive?'Nonaktifkan':'Aktifkan'}</button>}</>}</div>,
        ])}
        empty="Belum ada cabang."
      />
    </Panel>
    {message&&<div className="notice">{message}</div>}
  </section>;
}
