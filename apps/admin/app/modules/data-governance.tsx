'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const ENTITY_TYPES = ['AUDIT_LOG','ASSISTANT_INTERACTION','OPERATOR_INSIGHT'] as const;

type Policy = { id:string; entityType:string; hotDays:number; warmDays:number; archiveAfter:boolean; isActive:boolean; createdAt:string; updatedAt:string };
type ArchiveRun = { id:string; entityType:string; rangeStart:string; rangeEnd:string; status:string; rowsProcessed:number; archiveUri?:string|null; checksum?:string|null; errorMessage?:string|null; startedAt?:string|null; finishedAt?:string|null; createdAt:string };
type DailySales = { id:string; businessDate:string; channel:string; transactionCount:number; itemQuantity:number; grossSales:string|number; netSales:string|number; grossProfit:string|number };
type DailyFinance = { id:string; businessDate:string; accountId:string; debit:string|number; credit:string|number; balance:string|number };
type DailyResponse = { sales:DailySales[]; finance:DailyFinance[]; from:string; to:string };
type MaterializeResult = { businessDate:string; salesChannels:number; financeAccounts:number; sourceSales:number; sourceJournalLines:number };

async function api<T>(token:string,path:string,init:RequestInit={}):Promise<T>{
  const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init.headers??{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(Array.isArray(body.message)?body.message.join(', '):body.message??'Request data governance gagal.');
  return body as T;
}
function today(){return new Date().toISOString().slice(0,10);}
function daysAgo(days:number){return new Date(Date.now()-days*86400000).toISOString().slice(0,10);}
function provider(uri?:string|null){if(!uri)return '-';const match=/^([a-z0-9+.-]+):\/\//i.exec(uri);return match?.[1]?.toUpperCase()??'UNKNOWN';}
function compact(value?:string|null){if(!value)return '-';return value.length>28?`${value.slice(0,14)}…${value.slice(-10)}`:value;}

export default function DataGovernanceView({token}:{token:string}){
  const [policies,setPolicies]=useState<Policy[]>([]);
  const [runs,setRuns]=useState<ArchiveRun[]>([]);
  const [summaries,setSummaries]=useState<DailyResponse|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [policyForm,setPolicyForm]=useState({entityType:'AUDIT_LOG',hotDays:365,warmDays:1095,archiveAfter:true,isActive:true});
  const [summaryDate,setSummaryDate]=useState(today());
  const [archiveTarget,setArchiveTarget]=useState<Policy|null>(null);
  const [archiveEnd,setArchiveEnd]=useState(daysAgo(2));
  const [archiveConfirmation,setArchiveConfirmation]=useState('');
  const [lastMaterialize,setLastMaterialize]=useState<MaterializeResult|null>(null);
  const {canAll}=usePermissions(token);

  async function refresh(){
    setMessage('');
    try{
      const from=daysAgo(14),to=today();
      const [nextPolicies,nextRuns,nextSummaries]=await Promise.all([
        api<Policy[]>(token,'/retention/policies'),
        api<ArchiveRun[]>(token,'/retention/archive-runs'),
        api<DailyResponse>(token,`/analytics/daily-summaries?from=${from}&to=${to}`),
      ]);
      setPolicies(nextPolicies);setRuns(nextRuns);setSummaries(nextSummaries);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat data governance.');}
  }
  useEffect(()=>{void refresh();},[token]);

  function editPolicy(row:Policy){setPolicyForm({entityType:row.entityType,hotDays:row.hotDays,warmDays:row.warmDays,archiveAfter:row.archiveAfter,isActive:row.isActive});}
  async function savePolicy(event:FormEvent){
    event.preventDefault();setBusy(true);setMessage('');
    try{
      await api(token,'/retention/policies',{method:'POST',body:JSON.stringify(policyForm)});
      await refresh();setMessage(`Policy ${policyForm.entityType} tersimpan.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan policy.');}
    finally{setBusy(false);}
  }
  async function togglePolicy(row:Policy){
    setBusy(true);setMessage('');
    try{
      await api(token,'/retention/policies',{method:'POST',body:JSON.stringify({entityType:row.entityType,hotDays:row.hotDays,warmDays:row.warmDays,archiveAfter:row.archiveAfter,isActive:!row.isActive})});
      await refresh();setMessage(`Policy ${row.entityType} ${row.isActive?'dinonaktifkan':'diaktifkan'}.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal mengubah status policy.');}
    finally{setBusy(false);}
  }
  async function materialize(event:FormEvent){
    event.preventDefault();setBusy(true);setMessage('');
    try{
      const result=await api<MaterializeResult>(token,'/analytics/daily-summaries/materialize',{method:'POST',body:JSON.stringify({businessDate:summaryDate})});
      setLastMaterialize(result);await refresh();setMessage(`Daily summary ${summaryDate} dimaterialisasi dari sumber transaksi/jurnal authoritative.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal materialisasi summary.');}
    finally{setBusy(false);}
  }
  async function executeArchive(event:FormEvent){
    event.preventDefault();if(!archiveTarget)return;
    setBusy(true);setMessage('');
    try{
      await api(token,'/retention/archive-runs',{method:'POST',body:JSON.stringify({policyId:archiveTarget.id,rangeEnd:archiveEnd,confirmation:archiveConfirmation})});
      setArchiveTarget(null);setArchiveConfirmation('');await refresh();setMessage(`Archive ${archiveTarget.entityType} selesai dan checksum tercatat.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Archive gagal.');}
    finally{setBusy(false);}
  }

  const latestBusinessDate=useMemo(()=>{
    const rows=[...(summaries?.sales??[]),...(summaries?.finance??[])];
    return rows.map((row)=>row.businessDate).sort().at(-1)??null;
  },[summaries]);

  return <section className="stack">
    <Panel eyebrow="P3 DATA GOVERNANCE" title="Retention & Archive" badge={`${policies.filter((row)=>row.isActive).length} policy aktif`}>
      <p className="sectionHelp">Archive adalah operasi eksplisit operator. Server menolak archive tanpa konfirmasi <code>ARCHIVE</code>; artifact URI, provider, checksum, status, error, dan history tetap diaudit.</p>
      <form className="formGrid" onSubmit={savePolicy}>
        <label>Entity<select value={policyForm.entityType} onChange={(e)=>setPolicyForm({...policyForm,entityType:e.target.value})}>{ENTITY_TYPES.map((value)=><option key={value}>{value}</option>)}</select></label>
        <label>Hot days<input type="number" min="1" value={policyForm.hotDays} onChange={(e)=>setPolicyForm({...policyForm,hotDays:Number(e.target.value)})}/></label>
        <label>Warm days<input type="number" min="1" value={policyForm.warmDays} onChange={(e)=>setPolicyForm({...policyForm,warmDays:Number(e.target.value)})}/></label>
        <label className="checkRow"><input type="checkbox" checked={policyForm.archiveAfter} onChange={(e)=>setPolicyForm({...policyForm,archiveAfter:e.target.checked})}/><span>Archive setelah warm period</span></label>
        <label className="checkRow"><input type="checkbox" checked={policyForm.isActive} onChange={(e)=>setPolicyForm({...policyForm,isActive:e.target.checked})}/><span>Policy aktif</span></label>
        {canAll('report.export')&&<button disabled={busy}>Simpan policy</button>}
      </form>
      <Table head={['Entity','Hot/Warm','Archive','Status','Aksi']} rows={policies.map((row)=>[
        <strong key={`${row.id}-entity`}>{row.entityType}</strong>,`${row.hotDays} / ${row.warmDays} hari`,row.archiveAfter?'YA':'TIDAK',<StatusChip key={`${row.id}-status`} status={row.isActive?'ACTIVE':'INACTIVE'}/>,canAll('report.export')?<div className="actionRow" key={`${row.id}-actions`}><button type="button" className="secondary" onClick={()=>editPolicy(row)}>Edit</button><button type="button" className="secondary" onClick={()=>void togglePolicy(row)} disabled={busy}>{row.isActive?'Nonaktifkan':'Aktifkan'}</button><button type="button" disabled={!row.isActive||!row.archiveAfter||busy} onClick={()=>{setArchiveTarget(row);setArchiveConfirmation('');}}>Jalankan archive</button></div>:'-'
      ])} empty="Belum ada retention policy."/>
    </Panel>

    {archiveTarget&&<Panel eyebrow="SAFETY CONFIRMATION" title={`Archive ${archiveTarget.entityType}`} badge="DESTRUCTIVE-LIKE IO">
      <form className="formStack" onSubmit={executeArchive}>
        <p className="sectionHelp">Operasi ini membuat artifact durable dari data sebelum cutoff policy. Ketik <strong>ARCHIVE</strong> untuk memastikan operator memahami tindakan.</p>
        <label>Range end<input type="date" value={archiveEnd} onChange={(e)=>setArchiveEnd(e.target.value)} required/></label>
        <label>Konfirmasi<input value={archiveConfirmation} onChange={(e)=>setArchiveConfirmation(e.target.value)} placeholder="ARCHIVE" required/></label>
        <div className="actionRow"><button type="button" className="secondary" onClick={()=>{setArchiveTarget(null);setArchiveConfirmation('');}}>Batal</button>{canAll('report.export')&&<button disabled={busy||archiveConfirmation!=='ARCHIVE'}>Eksekusi archive</button>}</div>
      </form>
    </Panel>}

    <Panel eyebrow="ARCHIVE HISTORY" title="Riwayat Archive" badge={`${runs.length} run`}>
      <Table head={['Entity / Range','Status','Rows','Artifact','Checksum / Error']} rows={runs.map((run)=>[
        <span key={`${run.id}-range`}><strong>{run.entityType}</strong><small>{new Date(run.rangeStart).toLocaleDateString('id-ID')} → {new Date(run.rangeEnd).toLocaleDateString('id-ID')}</small></span>,<StatusChip key={`${run.id}-status`} status={run.status}/>,run.rowsProcessed,<span key={`${run.id}-uri`}><strong>{provider(run.archiveUri)}</strong><small>{run.archiveUri??'-'}</small></span>,run.status==='FAILED'?<span key={`${run.id}-error`} className="dangerText">{run.errorMessage??'Unknown error'}</span>:<code key={`${run.id}-checksum`} title={run.checksum??''}>{compact(run.checksum)}</code>
      ])} empty="Belum ada archive run."/>
    </Panel>

    <Panel eyebrow="SYSTEM OWNERSHIP" title="Daily Summary Materialization" badge="ADMIN-OWNED">
      <p className="sectionHelp">P3 menetapkan ownership tunggal: materialisasi DailySalesSummary/DailyFinanceSummary adalah operasi Admin eksplisit. Worker tidak diklaim sebagai owner otomatis. Sumber tetap Sale COMPLETED dan JournalLine authoritative pada company/branch aktif.</p>
      <form className="actionRow" onSubmit={materialize}><label>Tanggal bisnis<input type="date" value={summaryDate} onChange={(e)=>setSummaryDate(e.target.value)} required/></label>{canAll('report.export')&&<button disabled={busy}>Materialize summary</button>}</form>
      <div className="metricGrid">
        <div><small>Latest materialized</small><strong>{latestBusinessDate?new Date(latestBusinessDate).toLocaleDateString('id-ID'):'-'}</strong></div>
        <div><small>Sales rows (14d)</small><strong>{summaries?.sales.length??0}</strong></div>
        <div><small>Finance rows (14d)</small><strong>{summaries?.finance.length??0}</strong></div>
        <div><small>Last source rows</small><strong>{lastMaterialize?`${lastMaterialize.sourceSales}/${lastMaterialize.sourceJournalLines}`:'-'}</strong></div>
      </div>
      <Table head={['Tanggal','Channel','Transaksi','Qty','Net Sales','Gross Profit']} rows={(summaries?.sales??[]).slice(0,20).map((row)=>[new Date(row.businessDate).toLocaleDateString('id-ID'),row.channel,row.transactionCount,row.itemQuantity,Number(row.netSales).toLocaleString('id-ID'),Number(row.grossProfit).toLocaleString('id-ID')])} empty="Daily sales summary belum dimaterialisasi."/>
    </Panel>
    {message&&<div className="notice">{message}</div>}
  </section>;
}
