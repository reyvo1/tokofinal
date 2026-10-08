'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000/api/v1';
type Permission={id:string;code:string;description?:string|null};
type Role={id:string;name:string;description?:string|null;permissions:Array<{permission:Permission}>};
type User={id:string;name:string;email:string;branchId?:string|null;isActive:boolean;canApprovePrivilegedActions?:boolean;supervisorPinUpdatedAt?:string|null;roles:Array<{role:{id:string;name:string}}>;};
async function call<T>(token:string,path:string,init?:RequestInit):Promise<T>{
  const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});
  const data=await response.json();
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${Array.isArray(data.message)?data.message.join(', '):data.message??'Request gagal'}`);
  return data as T;
}
async function optionalAuthorization<T>(promise:Promise<T>,fallback:T):Promise<T>{try{return await promise;}catch(error){if(error instanceof Error&&/\b(401|403)\b/.test(error.message))return fallback;throw error;}}
export default function AccessControlView({token,canManageRoles,actorId}:{token:string;canManageRoles:boolean;actorId?:string}){
  // users.controller.ts memisahkan dua permission: POST /users, PATCH /users/:id/roles dan
  // PATCH /users/:id/status butuh user.manage, sedangkan POST /users/roles dan
  // PATCH /users/roles/:id/permissions butuh role.manage. canManageRoles (SUPER_ADMIN) tetap
  // dipertahankan karena server juga membatasi role creation ke SUPER_ADMIN.
  const {canAll}=usePermissions(token);
  const canManageUsers=canAll('user.manage');
  const canManageRolePermissions=canManageRoles&&canAll('role.manage');
  const [users,setUsers]=useState<User[]>([]);
  const [roles,setRoles]=useState<Role[]>([]);
  const [permissions,setPermissions]=useState<Permission[]>([]);
  const [message,setMessage]=useState('');
  const [userForm,setUserForm]=useState({name:'',email:'',password:'',roleNames:['CASHIER'] as string[]});
  const [roleForm,setRoleForm]=useState({name:'',description:'',permissionCodes:[] as string[]});
  const [selectedRoleId,setSelectedRoleId]=useState('');
  const [rolePermissionCodes,setRolePermissionCodes]=useState<string[]>([]);
  const [userRoleDrafts,setUserRoleDrafts]=useState<Record<string,string[]>>({});
  // Supervisor appointment. The API endpoint existed with no caller anywhere in the product: an
  // administrator had to know the URL and craft the request to appoint the person whose PIN then
  // gates every large discount at the till. A control with no surface is a control that never gets
  // set up, which is exactly what happened — `GET /supervisor-approval/status` reported
  // `configured:false` in a seeded branch.
  const [supervisorDrafts,setSupervisorDrafts]=useState<Record<string,string>>({});
  const [supervisorStatus,setSupervisorStatus]=useState<{configured:boolean;approverName:string|null}|null>(null);

  async function refresh(){
    const [nextUsers,nextRoles,nextPermissions,nextSupervisorStatus]=await Promise.all([
      call<User[]>(token,'/users'),call<Role[]>(token,'/users/roles'),call<Permission[]>(token,'/users/permissions'),
      // Read alongside the users so the supervisor panel and the roster cannot disagree. A failure
      // Authorization denial is optional for operators without approval visibility; transport/server
      // failures remain fatal so an outage cannot masquerade as an unconfigured supervisor module.
      optionalAuthorization(call<{configured:boolean;approverName:string|null}>(token,'/supervisor-approval/status'),null),
    ]);
    setUsers(nextUsers);setRoles(nextRoles);setPermissions(nextPermissions);
    setSupervisorStatus(nextSupervisorStatus);
    setUserRoleDrafts(Object.fromEntries(nextUsers.map((user)=>[user.id,user.roles.map((entry)=>entry.role.name)])));
    const nextSelected=nextRoles.find((role)=>role.id===selectedRoleId)??nextRoles[0];
    if(nextSelected){setSelectedRoleId(nextSelected.id);setRolePermissionCodes(nextSelected.permissions.map((entry)=>entry.permission.code));}
  }
  useEffect(()=>{void refresh().catch((error)=>setMessage(error instanceof Error?error.message:'Gagal memuat access control'));},[token]);

  const selectedRole=useMemo(()=>roles.find((role)=>role.id===selectedRoleId)??null,[roles,selectedRoleId]);
  useEffect(()=>{if(selectedRole)setRolePermissionCodes(selectedRole.permissions.map((entry)=>entry.permission.code));},[selectedRole]);

  async function createUser(event:FormEvent){
    event.preventDefault();setMessage('');
    try{
      await call(token,'/users',{method:'POST',body:JSON.stringify({...userForm,roleNames:userForm.roleNames.length?userForm.roleNames:['CASHIER']})});
      setUserForm({name:'',email:'',password:'',roleNames:['CASHIER']});await refresh();setMessage('Pengguna berhasil dibuat.');
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal membuat pengguna');}
  }
  async function createRole(event:FormEvent){
    event.preventDefault();setMessage('');
    try{
      await call<Role>(token,'/users/roles',{method:'POST',body:JSON.stringify({name:roleForm.name,description:roleForm.description||undefined,permissionCodes:roleForm.permissionCodes})});
      setRoleForm({name:'',description:'',permissionCodes:[]});await refresh();setMessage('Role baru berhasil dibuat.');
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal membuat role');}
  }
  async function saveRolePermissions(){
    if(!selectedRoleId)return;
    setMessage('');
    try{await call(token,`/users/roles/${selectedRoleId}/permissions`,{method:'PATCH',body:JSON.stringify({permissionCodes:rolePermissionCodes})});await refresh();setMessage('Permission role diperbarui.');}
    catch(error){setMessage(error instanceof Error?error.message:'Gagal mengubah permission role');}
  }
  async function saveUserRoles(user:User){
    setMessage('');
    try{await call(token,`/users/${user.id}/roles`,{method:'PATCH',body:JSON.stringify({roleNames:userRoleDrafts[user.id]??[]})});await refresh();setMessage(`Role ${user.name} diperbarui.`);}
    catch(error){setMessage(error instanceof Error?error.message:'Gagal mengubah role user');}
  }
  async function toggleUser(user:User){
    setMessage('');
    try{await call(token,`/users/${user.id}/status`,{method:'PATCH',body:JSON.stringify({isActive:!user.isActive})});await refresh();setMessage(`${user.name} ${user.isActive?'dinonaktifkan':'diaktifkan'}.`);}
    catch(error){setMessage(error instanceof Error?error.message:'Gagal mengubah status user');}
  }
  function toggleCode(current:string[],code:string){return current.includes(code)?current.filter((value)=>value!==code):[...current,code];}
  // Setting a PIN IS the appointment, so this is the only control in the product that can grant the
  // right to approve. Revoking is a separate, explicit action rather than an empty field: silently
  // clearing on blur would revoke somebody's authority because they tabbed away.
  async function saveSupervisorPin(user:User,pin:string){
    setMessage('');
    try{
      await call(token,'/supervisor-approval/pin',{method:'POST',body:JSON.stringify({targetUserId:user.id,pin})});
      setSupervisorDrafts((current)=>({...current,[user.id]:''}));
      await refresh();
      setMessage(pin?`${user.name} dapat menyetujui tindakan supervisor. PIN tidak pernah ditampilkan lagi.`:`Hak supervisor ${user.name} dicabut.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan PIN supervisor');}
  }

  return <section className="stack">
    <section className="grid2">
      <Panel eyebrow="USER" title="Tambah Pengguna">
        <form className="formStack" onSubmit={createUser}>
          <label>Nama<input required value={userForm.name} onChange={(event)=>setUserForm({...userForm,name:event.target.value})}/></label>
          <label>Email<input required type="email" value={userForm.email} onChange={(event)=>setUserForm({...userForm,email:event.target.value})}/></label>
          <label>Password awal<input required minLength={8} type="password" autoComplete="new-password" value={userForm.password} onChange={(event)=>setUserForm({...userForm,password:event.target.value})}/></label>
          <label>Role awal<select multiple value={userForm.roleNames} onChange={(event)=>setUserForm({...userForm,roleNames:Array.from(event.currentTarget.selectedOptions).map((option)=>option.value)})}>{roles.map((role)=><option key={role.id} value={role.name}>{role.name}</option>)}</select></label>
          {canManageUsers&&<button>Simpan pengguna</button>}
        </form>
      </Panel>
      {canManageRolePermissions ? <Panel eyebrow="ROLE" title="Buat Role" badge="SUPER_ADMIN">
        <form className="formStack" onSubmit={createRole}>
          <label>Nama role<input required value={roleForm.name} onChange={(event)=>setRoleForm({...roleForm,name:event.target.value.toUpperCase()})}/></label>
          <label>Deskripsi<input value={roleForm.description} onChange={(event)=>setRoleForm({...roleForm,description:event.target.value})}/></label>
          <div className="permissionGrid">{permissions.map((permission)=><label className="checkRow" key={permission.id}><input type="checkbox" checked={roleForm.permissionCodes.includes(permission.code)} onChange={()=>setRoleForm({...roleForm,permissionCodes:toggleCode(roleForm.permissionCodes,permission.code)})}/><span>{permission.code}</span></label>)}</div>
          {canManageRolePermissions&&<button>Buat role</button>}
        </form>
      </Panel> : <Panel eyebrow="ROLE" title="Katalog Role" badge="READ ONLY"><p className="sectionHelp">Pembuatan role dan perubahan permission global hanya tersedia untuk SUPER_ADMIN. Administrator cabang tetap dapat mengatur role user yang diizinkan server.</p></Panel>}
    </section>

    <Panel eyebrow="ACCESS" title="User, Role & Status" badge={`${users.length} akun`}>
      <Table head={['User','Status','Role aktif','Atur role','Aksi']} rows={users.map((user)=>[
        <div><strong>{user.name}</strong><small>{user.email}</small></div>,
        <StatusChip status={user.isActive?'ACTIVE':'INACTIVE'}/>,
        user.roles.map((entry)=>entry.role.name).join(', ')||'-',
        <select multiple value={userRoleDrafts[user.id]??[]} onChange={(event)=>setUserRoleDrafts({...userRoleDrafts,[user.id]:Array.from(event.currentTarget.selectedOptions).map((option)=>option.value)})}>{roles.map((role)=><option key={role.id} value={role.name}>{role.name}</option>)}</select>,
        user.id===actorId?<span className="sectionHelp">Akun aktif sendiri dilindungi</span>:<div className="actionRow">{canManageUsers&&<><button type="button" className="secondary" onClick={()=>void saveUserRoles(user)}>Simpan role</button><button type="button" className="secondary" onClick={()=>void toggleUser(user)}>{user.isActive?'Nonaktifkan':'Aktifkan'}</button></>}</div>,
      ])} empty="Belum ada user."/>
    </Panel>

    <Panel eyebrow="SUPERVISOR" title="Persetujuan Supervisor" badge={supervisorStatus?.configured?`Aktif: ${supervisorStatus.approverName}`:'Belum ada supervisor'}>
      <p className="sectionHelp">Menyimpan PIN sekaligus menunjuk orang ini sebagai penyetuju diskon di atas 20%, price override, dan retur. Kasir tidak dapat menyetujui miliknya sendiri, dan setiap persetujuan hanya berlaku untuk satu transaksi. PIN disimpan terenkripsi dan tidak pernah ditampilkan lagi setelah disimpan.</p>
      <Table head={['User','Status supervisor','PIN baru','Aksi']} rows={users.map((user)=>[
        <div><strong>{user.name}</strong><small>{user.email}</small></div>,
        user.canApprovePrivilegedActions
          ? <StatusChip status="ACTIVE"/>
          : <span className="sectionHelp">Bukan penyetuju</span>,
        <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="4-8 digit" maxLength={8} value={supervisorDrafts[user.id]??''} onChange={(event)=>setSupervisorDrafts({...supervisorDrafts,[user.id]:event.target.value})}/>,
        user.id===actorId
          ? <span className="sectionHelp">Akun aktif sendiri dilindungi</span>
          : <div className="actionRow">
              <button type="button" className="secondary" disabled={!canManageUsers||!(supervisorDrafts[user.id]??'').trim()} onClick={()=>void saveSupervisorPin(user,(supervisorDrafts[user.id]??'').trim())}>Simpan PIN</button>
              {user.canApprovePrivilegedActions&&<button type="button" className="secondary" disabled={!canManageUsers} onClick={()=>void saveSupervisorPin(user,'')}>Cabut</button>}
            </div>,
      ])} empty="Belum ada user."/>
      {!supervisorStatus?.configured&&<p className="sectionHelp">Cabang ini belum punya supervisor. Sampai satu appointed, kasir melihat "tidak dapat disetujui" pada diskon di atas 20% — bukan ditolak diam-diam.</p>}
    </Panel>

    {canManageRolePermissions && <Panel eyebrow="PERMISSION" title="Permission Role" badge={selectedRole?.name??'-'}>
      <div className="formStack">
        <label>Role<select value={selectedRoleId} onChange={(event)=>setSelectedRoleId(event.target.value)}>{roles.map((role)=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <div className="permissionGrid">{permissions.map((permission)=><label className="checkRow" key={permission.id}><input type="checkbox" checked={rolePermissionCodes.includes(permission.code)} onChange={()=>setRolePermissionCodes(toggleCode(rolePermissionCodes,permission.code))}/><span>{permission.code}</span></label>)}</div>
        <button type="button" onClick={()=>void saveRolePermissions()}>Simpan permission role</button>
        <p className="sectionHelp">Role SUPER_ADMIN/OWNER dilindungi server. Perubahan role/permission selalu diaudit dan user tetap dibatasi branch aktif.</p>
      </div>
    </Panel>}
    {message&&<div className="notice">{message}</div>}
  </section>;
}
