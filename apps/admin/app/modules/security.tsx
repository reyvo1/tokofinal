'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Status = { enabled: boolean; setupPending: boolean; remainingRecoveryCodes: number };
type Setup = { secret: string; otpauthUri: string; algorithm: string; digits: number; period: number };
type Session = { id:string; activeBranchId?:string|null; createdAt:string; lastSeenAt?:string|null; expiresAt:string; revokedAt?:string|null; revokeReason?:string|null; current:boolean };

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await authFetch(`${API}${path}`, token, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Permintaan keamanan gagal.');
  return body as T;
}

export default function SecurityView({ token }: { token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [sessions,setSessions]=useState<Session[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoutAllConfirm,setLogoutAllConfirm]=useState('');

  async function reload() {
    try { const [nextStatus,nextSessions]=await Promise.all([api<Status>('/auth/2fa/status', token),api<Session[]>('/auth/sessions',token)]);setStatus(nextStatus);setSessions(nextSessions); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memuat status keamanan.'); }
  }
  useEffect(() => { void reload(); }, [token]);

  async function beginSetup() {setBusy(true);setMessage('');setRecoveryCodes([]);try{setSetup(await api<Setup>('/auth/2fa/setup',token,{method:'POST'}));setMessage('Secret 2FA dibuat. Tambahkan ke authenticator lalu konfirmasi kode 6 digit.');await reload();}catch(error){setMessage(error instanceof Error?error.message:'Gagal memulai 2FA.');}finally{setBusy(false);}}
  async function confirmSetup(event:FormEvent){event.preventDefault();setBusy(true);setMessage('');try{const result=await api<{recoveryCodes:string[];message:string}>('/auth/2fa/confirm',token,{method:'POST',body:JSON.stringify({code})});setRecoveryCodes(result.recoveryCodes);setSetup(null);setCode('');setMessage(result.message);await reload();}catch(error){setMessage(error instanceof Error?error.message:'Gagal mengaktifkan 2FA.');}finally{setBusy(false);}}
  async function regenerate(event:FormEvent){event.preventDefault();setBusy(true);setMessage('');try{const result=await api<{recoveryCodes:string[]}>('/auth/2fa/recovery-codes',token,{method:'POST',body:JSON.stringify({code})});setRecoveryCodes(result.recoveryCodes);setCode('');setMessage('Recovery code baru dibuat. Simpan sekarang; daftar lama tidak berlaku.');await reload();}catch(error){setMessage(error instanceof Error?error.message:'Gagal membuat recovery code baru.');}finally{setBusy(false);}}
  async function disable(event:FormEvent){event.preventDefault();setBusy(true);setMessage('');try{await api('/auth/2fa/disable',token,{method:'POST',body:JSON.stringify({password,code})});setPassword('');setCode('');setRecoveryCodes([]);setSetup(null);setMessage('2FA dinonaktifkan. Sesi lain sudah dicabut.');await reload();}catch(error){setMessage(error instanceof Error?error.message:'Gagal menonaktifkan 2FA.');}finally{setBusy(false);}}
  async function revokeSession(row:Session){setBusy(true);setMessage('');try{await api(`/auth/sessions/${row.id}/revoke`,token,{method:'POST',body:'{}'});await reload();setMessage('Sesi diputus dan audit event dicatat.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal mencabut sesi.');}finally{setBusy(false);}}
  async function logoutAll(event:FormEvent){event.preventDefault();setBusy(true);setMessage('');try{const result=await api<{revoked:number}>('/auth/logout-all',token,{method:'POST',body:'{}'});setSessions((rows)=>rows.map((row)=>({...row,revokedAt:row.revokedAt??new Date().toISOString(),revokeReason:row.revokeReason??'LOGOUT_ALL'})));setLogoutAllConfirm('');setMessage(`${result.revoked} sesi aktif dicabut. Login ulang diperlukan.`);}catch(error){setMessage(error instanceof Error?error.message:'Gagal logout semua sesi.');}finally{setBusy(false);}}

  return <section className="stack">
    <Panel eyebrow="KEAMANAN AKUN" title="Autentikasi dua faktor" badge={status?.enabled?`AKTIF · ${status.remainingRecoveryCodes} recovery`:'NONAKTIF'}>
      <p className="sectionHelp">TOTP bekerja dengan aplikasi authenticator standar. Secret disimpan terenkripsi di server; recovery code hanya disimpan sebagai hash.</p>
      {!status?.enabled&&<>{!setup?<button type="button" onClick={()=>void beginSetup()} disabled={busy}>Mulai setup 2FA</button>:<form onSubmit={confirmSetup}><label>Secret authenticator<input readOnly value={setup.secret}/></label><label>URI authenticator<textarea readOnly value={setup.otpauthUri} rows={3}/></label><label>Kode 6 digit<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e)=>setCode(e.target.value)} required/></label><button disabled={busy}>Konfirmasi & aktifkan</button></form>}</>}
      {status?.enabled&&<div className="grid2"><form onSubmit={regenerate} className="panel compact"><h3>Buat recovery code baru</h3><label>Kode TOTP / recovery<input value={code} onChange={(e)=>setCode(e.target.value)} required/></label><button disabled={busy}>Regenerasi</button></form><form onSubmit={disable} className="panel compact"><h3>Nonaktifkan 2FA</h3><label>Password<input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required/></label><label>Kode TOTP / recovery<input value={code} onChange={(e)=>setCode(e.target.value)} required/></label><button className="dangerButton" disabled={busy}>Nonaktifkan</button></form></div>}
      {recoveryCodes.length>0&&<div className="panel highlight"><h3>Recovery code — simpan sekarang</h3><p className="sectionHelp">Masing-masing hanya dapat dipakai sekali. Setelah meninggalkan layar ini server tidak dapat menampilkan plaintext-nya kembali.</p><pre>{recoveryCodes.join('\n')}</pre></div>}
    </Panel>

    <Panel eyebrow="SESSION SECURITY" title="Sesi Aktif & Riwayat" badge={`${sessions.filter((row)=>!row.revokedAt&&new Date(row.expiresAt)>new Date()).length} aktif`}>
      <p className="sectionHelp">Inventori sesi berasal dari server. Operator dapat mencabut sesi milik akun sendiri secara individual; sesi current tetap memakai tombol logout normal atau logout-all.</p>
      <Table head={['Sesi','Dibuat / Last seen','Expiry','Status','Aksi']} rows={sessions.map((row)=>[
        <span key={`${row.id}-id`}><strong>{row.current?'CURRENT':'SESSION'}</strong><small>{row.id.slice(0,12)}…</small></span>,<span key={`${row.id}-seen`}><strong>{new Date(row.createdAt).toLocaleString('id-ID')}</strong><small>{row.lastSeenAt?new Date(row.lastSeenAt).toLocaleString('id-ID'):'belum terlihat'}</small></span>,new Date(row.expiresAt).toLocaleString('id-ID'),<StatusChip key={`${row.id}-status`} status={row.revokedAt?'REVOKED':row.current?'CURRENT':'ACTIVE'}/>,!row.revokedAt&&!row.current?<button key={`${row.id}-revoke`} type="button" className="secondary" disabled={busy} onClick={()=>void revokeSession(row)}>Revoke</button>:row.revokeReason??'-'
      ])} empty="Tidak ada sesi."/>
      <form className="formStack" onSubmit={logoutAll}><p className="sectionHelp">Logout-all mencabut seluruh sesi aktif termasuk sesi ini. Ketik <strong>LOGOUT ALL</strong> untuk menghindari tindakan tidak sengaja.</p><label>Konfirmasi<input value={logoutAllConfirm} onChange={(e)=>setLogoutAllConfirm(e.target.value)} placeholder="LOGOUT ALL"/></label><button className="dangerButton" disabled={busy||logoutAllConfirm!=='LOGOUT ALL'}>Cabut semua sesi</button></form>
    </Panel>
    {message&&<div className="notice">{message}</div>}
  </section>;
}
