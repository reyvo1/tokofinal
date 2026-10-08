'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type Mode = 'platform' | 'custom-fields' | 'approvals' | 'webhooks' | 'ui-config' | 'audit-ops';
type Setting = { id:string; namespace:string; key:string; value:unknown; isSecret:boolean; branchId?:string|null; updatedAt?:string };
type CustomField = { id:string; entityType:string; key:string; label:string; dataType:string; required:boolean; searchable:boolean; isActive:boolean };
type Webhook = { id:string; name:string; url:string; events:unknown; isActive:boolean; headers?:unknown; createdAt?:string };
type ApprovalPolicy = { id:string; code:string; name:string; entityType:string; steps:unknown; isActive:boolean };
type ApprovalRequest = { id:string; entityType:string; entityId:string; status:string; requesterId:string; currentStep:number; requestedAt:string };
type UiSchema = { id:string; code:string; surface:string; version:number; branchId?:string|null; schema:unknown };
type AuditRow = { id:string; action:string; entityType:string; entityId?:string|null; createdAt:string; user?:{name?:string|null;email?:string|null}|null };
type OutboxRow = { id:string; eventType:string; aggregateType:string; aggregateId:string; status:string; attempts:number; lastError?:string|null; createdAt:string };
type WebhookDelivery = { id:string; endpointId:string; eventId?:string|null; eventType:string; status:string; attempts:number; responseCode?:number|null; responseBody?:string|null; nextRetryAt?:string|null; deliveredAt?:string|null; createdAt:string };
type DelegableUser = { id:string; name:string; email?:string|null; isActive:boolean; branchId?:string|null };
type OpsHealth = { healthy:boolean; checkedAt:string; outbox:{pending:number;failed:number}; webhooks:{failed:number}; reportJobs:{pendingStale:number;failed:number}; automationJobs:{failed:number} };

type Props = { token:string; mode:Mode };

async function call<T>(token:string,path:string,init?:RequestInit):Promise<T>{
  const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});
  const data=await response.json();
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${Array.isArray(data.message)?data.message.join(', '):data.message??'Request gagal'}`);
  return data as T;
}
function parseJson(value:string, fallback:unknown={}){ const trimmed=value.trim(); if(!trimmed)return fallback; return JSON.parse(trimmed); }
function pretty(value:unknown){ try{return JSON.stringify(value,null,2);}catch{return String(value??'');} }
async function optionalAuthorization<T>(promise:Promise<T>,fallback:T):Promise<T>{try{return await promise;}catch(error){if(error instanceof Error&&/\b(401|403)\b/.test(error.message))return fallback;throw error;}}

export default function PlatformControlView({token,mode}:Props){
  // D-3: each platform sub-surface is gated by its own permission in
  // platform.controller.ts. Rendering every control for every operator produced buttons that
  // could only ever 403 — for example a custom_field.manage-only operator saw System Settings.
  const {canAll}=usePermissions(token);
  const [deliveries,setDeliveries]=useState<WebhookDelivery[]>([]);
  const [delegableUsers,setDelegableUsers]=useState<DelegableUser[]>([]);
  const [delegateTarget,setDelegateTarget]=useState<Record<string,string>>({});
  const [message,setMessage]=useState('');
  const [settings,setSettings]=useState<Setting[]>([]);
  const [fields,setFields]=useState<CustomField[]>([]);
  const [webhooks,setWebhooks]=useState<Webhook[]>([]);
  const [policies,setPolicies]=useState<ApprovalPolicy[]>([]);
  const [requests,setRequests]=useState<ApprovalRequest[]>([]);
  const [schemas,setSchemas]=useState<UiSchema[]>([]);
  const [audit,setAudit]=useState<AuditRow[]>([]);
  const [outbox,setOutbox]=useState<OutboxRow[]>([]);
  const [health,setHealth]=useState<OpsHealth|null>(null);
  const [settingForm,setSettingForm]=useState({namespace:'system',key:'',value:'{}',isSecret:false});
  const [fieldForm,setFieldForm]=useState({entityType:'PRODUCT',key:'',label:'',dataType:'string',required:false,searchable:false});
  const [fieldValueForm,setFieldValueForm]=useState({definitionId:'',entityType:'PRODUCT',entityId:'',value:'""'});
  const [webhookForm,setWebhookForm]=useState({name:'',url:'',events:'order.created'});
  const [policyForm,setPolicyForm]=useState({code:'',name:'',entityType:'PURCHASE_REQUEST',steps:'[{"roles":["OWNER"]}]'});
  const [schemaForm,setSchemaForm]=useState({code:'admin.navigation',surface:'admin',version:1,schema:'{"domainViews":[]}'});

  async function refresh(){
    setMessage('');
    try{
      if(mode==='platform')setSettings(await call<Setting[]>(token,'/platform/settings'));
      if(mode==='custom-fields')setFields(await call<CustomField[]>(token,'/platform/custom-fields'));
      if(mode==='webhooks')setWebhooks(await call<Webhook[]>(token,'/platform/webhooks'));
      if(mode==='webhooks')setDeliveries(await call<WebhookDelivery[]>(token,'/platform/webhook-deliveries?limit=100'));
      if(mode==='approvals'){
        const [nextPolicies,nextRequests]=await Promise.all([call<ApprovalPolicy[]>(token,'/platform/approval-policies'),call<ApprovalRequest[]>(token,'/platform/approval-requests')]);
        setDelegableUsers(await optionalAuthorization(call<DelegableUser[]>(token,'/users'),[] as DelegableUser[]));
        setPolicies(nextPolicies);setRequests(nextRequests);
      }
      if(mode==='ui-config')setSchemas(await call<UiSchema[]>(token,'/platform/ui-schemas'));
      if(mode==='audit-ops'){
        const [nextAudit,nextOutbox,nextHealth]=await Promise.all([call<AuditRow[]>(token,'/platform/audit-logs?limit=100'),call<OutboxRow[]>(token,'/platform/outbox?limit=100'),call<OpsHealth>(token,'/platform/ops-health')]);
        setAudit(nextAudit);setOutbox(nextOutbox);setHealth(nextHealth);
      }
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat control plane');}
  }
  useEffect(()=>{void refresh();},[token,mode]);

  async function saveSetting(event:FormEvent){event.preventDefault();try{await call(token,'/platform/settings',{method:'POST',body:JSON.stringify({namespace:settingForm.namespace,key:settingForm.key,value:parseJson(settingForm.value),isSecret:settingForm.isSecret})});setSettingForm({...settingForm,key:'',value:'{}'});await refresh();setMessage('System setting disimpan.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan setting');}}
  async function createField(event:FormEvent){event.preventDefault();try{await call(token,'/platform/custom-fields',{method:'POST',body:JSON.stringify(fieldForm)});setFieldForm({...fieldForm,key:'',label:''});await refresh();setMessage('Custom field dibuat.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal membuat custom field');}}
  async function setFieldValue(event:FormEvent){event.preventDefault();try{const definition=fields.find((row)=>row.id===fieldValueForm.definitionId);if(!definition)throw new Error('Pilih definisi custom field.');if(!fieldValueForm.entityId.trim())throw new Error('Entity ID wajib diisi.');await call(token,'/platform/custom-field-values',{method:'POST',body:JSON.stringify({definitionId:definition.id,entityType:definition.entityType,entityId:fieldValueForm.entityId.trim(),value:parseJson(fieldValueForm.value,'')})});setFieldValueForm((current)=>({...current,entityId:'',value:'""'}));setMessage('Nilai custom field tersimpan untuk entitas target.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan nilai custom field');}}
  async function createWebhook(event:FormEvent){event.preventDefault();try{await call(token,'/platform/webhooks',{method:'POST',body:JSON.stringify({name:webhookForm.name,url:webhookForm.url,events:webhookForm.events.split(',').map((value)=>value.trim()).filter(Boolean)})});setWebhookForm({name:'',url:'',events:'order.created'});await refresh();setMessage('Webhook dibuat.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal membuat webhook');}}
  async function createPolicy(event:FormEvent){event.preventDefault();try{await call(token,'/platform/approval-policies',{method:'POST',body:JSON.stringify({code:policyForm.code,name:policyForm.name,entityType:policyForm.entityType,steps:parseJson(policyForm.steps,[])})});setPolicyForm({...policyForm,code:'',name:''});await refresh();setMessage('Approval policy dibuat.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal membuat approval policy');}}
  async function decide(request:ApprovalRequest,status:'APPROVED'|'REJECTED'){try{await call(token,`/platform/approval-requests/${request.id}/decision`,{method:'PATCH',body:JSON.stringify({status,notes:'Diputuskan melalui Admin control-plane.'})});await refresh();setMessage(`Approval ${status.toLowerCase()}.`);}catch(error){setMessage(error instanceof Error?error.message:'Gagal memutuskan approval');}}
  async function createSchema(event:FormEvent){event.preventDefault();try{await call(token,'/platform/ui-schemas',{method:'POST',body:JSON.stringify({code:schemaForm.code,surface:schemaForm.surface,version:Number(schemaForm.version),schema:parseJson(schemaForm.schema)})});await refresh();setMessage('UI schema dibuat.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal membuat UI schema');}}
  async function replayDelivery(row:WebhookDelivery){try{await call(token,`/platform/webhook-deliveries/${row.id}/replay`,{method:'POST',body:'{}'});await refresh();setMessage(`Delivery ${row.eventType} masuk antrean replay.`);}catch(error){setMessage(error instanceof Error?error.message:'Gagal replay delivery webhook');}}
  async function delegate(row:ApprovalRequest){const targetUserId=delegateTarget[row.id];if(!targetUserId)throw new Error('Pilih penerima delegasi terlebih dahulu.');await call(token,`/platform/approval-requests/${row.id}/delegate`,{method:'PATCH',body:JSON.stringify({targetUserId,notes:'Didelegasikan melalui Admin control-plane.'})});setDelegateTarget((current)=>({...current,[row.id]:''}));await refresh();setMessage('Approval didelegasikan.');}
  async function replayOutbox(row:OutboxRow){try{await call(token,`/platform/outbox/${row.id}/replay`,{method:'POST',body:'{}'});await refresh();setMessage('Outbox direplay.');}catch(error){setMessage(error instanceof Error?error.message:'Gagal replay outbox');}}

  const failedOutbox=useMemo(()=>outbox.filter((row)=>row.status==='FAILED'),[outbox]);

  return <section className="stack">
    {mode==='platform'&&<>
      <Panel eyebrow="SYSTEM SETTINGS" title="Konfigurasi Runtime" badge={`${settings.length} setting`}>
        <form className="formStack" onSubmit={saveSetting}>
          <div className="grid2"><label>Namespace<input required value={settingForm.namespace} onChange={(e)=>setSettingForm({...settingForm,namespace:e.target.value})}/></label><label>Key<input required value={settingForm.key} onChange={(e)=>setSettingForm({...settingForm,key:e.target.value})}/></label></div>
          <label>Value JSON<textarea required value={settingForm.value} onChange={(e)=>setSettingForm({...settingForm,value:e.target.value})}/></label>
          <div className="permissionGrid"><label className="checkRow"><input type="checkbox" checked={settingForm.isSecret} onChange={(e)=>setSettingForm({...settingForm,isSecret:e.target.checked})}/><span>Secret value (encrypted)</span></label></div>
          <button disabled={!canAll('platform.configure')}>Simpan setting</button>
        </form>
      </Panel>
      <Panel eyebrow="SETTINGS" title="Setting Aktif"><Table head={['Namespace','Key','Value','Scope']} rows={settings.map((row)=>[row.namespace,<strong>{row.key}</strong>,<code>{typeof row.value==='string'?row.value:pretty(row.value)}</code>,row.branchId?'BRANCH':'COMPANY'])} empty="Belum ada system setting."/></Panel>
    </>}

    {mode==='custom-fields'&&<>
      <section className="grid2">
        <Panel eyebrow="CUSTOM FIELD" title="Tambah Definisi"><form className="formStack" onSubmit={createField}><div className="grid2"><label>Entity type<input required value={fieldForm.entityType} onChange={(e)=>setFieldForm({...fieldForm,entityType:e.target.value.toUpperCase()})}/></label><label>Key<input required value={fieldForm.key} onChange={(e)=>setFieldForm({...fieldForm,key:e.target.value})}/></label></div><label>Label<input required value={fieldForm.label} onChange={(e)=>setFieldForm({...fieldForm,label:e.target.value})}/></label><label>Tipe<select value={fieldForm.dataType} onChange={(e)=>setFieldForm({...fieldForm,dataType:e.target.value})}>{['string','text','number','decimal','boolean','date','datetime','select','multiselect','json'].map((value)=><option key={value}>{value}</option>)}</select></label><div className="permissionGrid"><label className="checkRow"><input type="checkbox" checked={fieldForm.required} onChange={(e)=>setFieldForm({...fieldForm,required:e.target.checked})}/><span>Wajib</span></label><label className="checkRow"><input type="checkbox" checked={fieldForm.searchable} onChange={(e)=>setFieldForm({...fieldForm,searchable:e.target.checked})}/><span>Searchable</span></label></div><button disabled={!canAll('custom_field.manage')}>Buat custom field</button></form></Panel>
        <Panel eyebrow="ENTITY VALUE" title="Isi Nilai Custom Field" badge="canonical setter"><form className="formStack" onSubmit={setFieldValue}><label>Definisi<select required value={fieldValueForm.definitionId} onChange={(e)=>{const definition=fields.find((row)=>row.id===e.target.value);setFieldValueForm({...fieldValueForm,definitionId:e.target.value,entityType:definition?.entityType??fieldValueForm.entityType});}}><option value="">Pilih custom field</option>{fields.filter((row)=>row.isActive).map((row)=><option key={row.id} value={row.id}>{row.entityType} · {row.label} ({row.key})</option>)}</select></label><label>Entity ID<input required value={fieldValueForm.entityId} onChange={(e)=>setFieldValueForm({...fieldValueForm,entityId:e.target.value})} placeholder="ID produk/customer/order target"/></label><label>Value JSON<textarea required rows={4} value={fieldValueForm.value} onChange={(e)=>setFieldValueForm({...fieldValueForm,value:e.target.value})} placeholder={'"nilai" / 123 / true / {"key":"value"}'}/></label><button disabled={!canAll('custom_field.manage')}>Simpan nilai</button></form><p className="sectionHelp">Entity type mengikuti definisi terpilih. Server tetap memvalidasi ownership tenant terhadap definisi custom field.</p></Panel>
      </section>
      <Panel eyebrow="DEFINITIONS" title="Custom Fields"><Table head={['Entity','Key','Label','Type','Status']} rows={fields.map((row)=>[row.entityType,row.key,row.label,row.dataType,<StatusChip status={row.isActive?'ACTIVE':'INACTIVE'}/>])} empty="Belum ada custom field."/></Panel>
    </>}

    {mode==='webhooks'&&<>
      <Panel eyebrow="WEBHOOK" title="Tambah Endpoint"><form className="formStack" onSubmit={createWebhook}><label>Nama<input required value={webhookForm.name} onChange={(e)=>setWebhookForm({...webhookForm,name:e.target.value})}/></label><label>HTTPS URL<input required type="url" value={webhookForm.url} onChange={(e)=>setWebhookForm({...webhookForm,url:e.target.value})} placeholder="https://example.com/hook"/></label><label>Events<input required value={webhookForm.events} onChange={(e)=>setWebhookForm({...webhookForm,events:e.target.value})} placeholder="order.created,payment.paid"/></label><button disabled={!canAll('webhook.manage')}>Buat webhook</button></form></Panel>
      <Panel eyebrow="ENDPOINTS" title="Webhook Aktif"><Table head={['Nama','URL','Events','Status']} rows={webhooks.map((row)=>[row.name,row.url,<code>{pretty(row.events)}</code>,<StatusChip status={row.isActive?'ACTIVE':'INACTIVE'}/>])} empty="Belum ada webhook."/></Panel>
      <Panel eyebrow="DELIVERY QUEUE" title="Riwayat Pengiriman Webhook" badge={`${deliveries.filter((row)=>row.status==='FAILED').length} gagal`}>
        <p className="sectionHelp">Panel kesehatan operasional menampilkan jumlah delivery gagal, tetapi tanpa daftar ini operator tidak tahu delivery mana yang bermasalah dan tidak dapat menjalankan replay.</p>
        <Table head={['Event','Endpoint','Status','Percobaan','Respons','Dibuat','Aksi']} rows={deliveries.map((row)=>[
          <><strong>{row.eventType}</strong>{row.eventId?<><br/><small className="mutedText">{row.eventId}</small></>:null}</>,
          webhooks.find((hook)=>hook.id===row.endpointId)?.name ?? row.endpointId,
          <StatusChip status={row.status} />,
          row.attempts,
          row.responseCode?`${row.responseCode} ${row.responseBody?`<small className="mutedText">${row.responseBody.slice(0,80)}</small>`:''}`:'-',
          new Date(row.createdAt).toLocaleString('id-ID'),
          row.status==='FAILED'
            ? <button type="button" className="secondary" onClick={()=>void replayDelivery(row)}>Replay</button>
            : <small className="mutedText">{row.status}</small>,
        ])} empty="Belum ada delivery webhook."/>
      </Panel>
    </>}

    {mode==='approvals'&&<>
      <Panel eyebrow="APPROVAL POLICY" title="Buat Kebijakan"><form className="formStack" onSubmit={createPolicy}><div className="grid2"><label>Kode<input required value={policyForm.code} onChange={(e)=>setPolicyForm({...policyForm,code:e.target.value.toUpperCase()})}/></label><label>Entity type<input required value={policyForm.entityType} onChange={(e)=>setPolicyForm({...policyForm,entityType:e.target.value.toUpperCase()})}/></label></div><label>Nama<input required value={policyForm.name} onChange={(e)=>setPolicyForm({...policyForm,name:e.target.value})}/></label><label>Steps JSON<textarea required value={policyForm.steps} onChange={(e)=>setPolicyForm({...policyForm,steps:e.target.value})}/></label><button disabled={!canAll('approval.manage')}>Buat policy</button></form></Panel>
      <Panel eyebrow="POLICY" title="Approval Policies"><Table head={['Kode','Nama','Entity','Status']} rows={policies.map((row)=>[row.code,row.name,row.entityType,<StatusChip status={row.isActive?'ACTIVE':'INACTIVE'}/>])} empty="Belum ada policy."/></Panel>
      <Panel eyebrow="REQUESTS" title="Approval Queue"><Table head={['Entity','Status','Step','Waktu','Aksi']} rows={requests.map((row)=>[`${row.entityType} · ${row.entityId}`,<StatusChip status={row.status}/>,row.currentStep,new Date(row.requestedAt).toLocaleString('id-ID'),row.status==='PENDING'?<div className="formStack"><div className="actionRow"><button type="button" className="secondary" onClick={()=>void decide(row,'APPROVED')}>Setujui</button><button type="button" className="secondary" onClick={()=>void decide(row,'REJECTED')}>Tolak</button></div><div className="actionRow"><select aria-label={`Penerima delegasi untuk ${row.entityType} ${row.entityId}`} value={delegateTarget[row.id]??''} onChange={(e)=>setDelegateTarget((current)=>({...current,[row.entityId?row.id:row.id]:e.target.value}))}><option value="">Delegasikan ke…</option>{delegableUsers.filter((user)=>user.isActive&&user.id!==row.requesterId).map((user)=><option key={user.id} value={user.id}>{user.name}{user.email?` · ${user.email}`:''}</option>)}</select><button type="button" className="secondary" disabled={!delegateTarget[row.id]} onClick={()=>void delegate(row).catch((error)=>setMessage(error instanceof Error?error.message:'Gagal mendelegasikan approval'))}>Delegasikan</button></div></div>:'-'])} empty="Tidak ada approval request."/></Panel>
    </>}

    {mode==='ui-config'&&<>
      <Panel eyebrow="UI SCHEMA" title="Runtime UI Configuration"><form className="formStack" onSubmit={createSchema}><div className="grid2"><label>Code<input required value={schemaForm.code} onChange={(e)=>setSchemaForm({...schemaForm,code:e.target.value})}/></label><label>Surface<input required value={schemaForm.surface} onChange={(e)=>setSchemaForm({...schemaForm,surface:e.target.value})}/></label></div><label>Version<input type="number" min="1" value={schemaForm.version} onChange={(e)=>setSchemaForm({...schemaForm,version:Number(e.target.value)})}/></label><label>Schema JSON<textarea required value={schemaForm.schema} onChange={(e)=>setSchemaForm({...schemaForm,schema:e.target.value})}/></label><button disabled={!canAll('ui_schema.manage')}>Simpan UI schema</button></form></Panel>
      <Panel eyebrow="SCHEMAS" title="UI Schema Versions"><Table head={['Code','Surface','Version','Scope']} rows={schemas.map((row)=>[row.code,row.surface,row.version,row.branchId?'BRANCH':'COMPANY/GLOBAL'])} empty="Belum ada UI schema."/></Panel>
    </>}

    {mode==='audit-ops'&&<>
      <section className="grid2"><Panel eyebrow="OPS HEALTH" title="Kesehatan Operasional" badge={health?.healthy?'HEALTHY':'ATTENTION'}>{health?<div className="metricGrid"><div><small>Outbox pending</small><strong>{health.outbox.pending}</strong></div><div><small>Outbox failed</small><strong>{health.outbox.failed}</strong></div><div><small>Webhook failed</small><strong>{health.webhooks.failed}</strong></div><div><small>Report failed</small><strong>{health.reportJobs.failed}</strong></div></div>:<p>Memuat health...</p>}</Panel><Panel eyebrow="FAILED OUTBOX" title="Replay Queue" badge={`${failedOutbox.length} failed`}><Table head={['Event','Aggregate','Attempts','Aksi']} rows={failedOutbox.map((row)=>[row.eventType,`${row.aggregateType}:${row.aggregateId}`,row.attempts,<button type="button" className="secondary" onClick={()=>void replayOutbox(row)}>Replay</button>])} empty="Tidak ada failed outbox."/></Panel></section>
      <Panel eyebrow="AUDIT" title="Audit Log Terbaru"><Table head={['Action','Entity','User','Waktu']} rows={audit.map((row)=>[row.action,`${row.entityType}${row.entityId?` · ${row.entityId}`:''}`,row.user?.name??row.user?.email??'-',new Date(row.createdAt).toLocaleString('id-ID')])} empty="Belum ada audit log."/></Panel>
      <Panel eyebrow="OUTBOX" title="Event Outbox"><Table head={['Event','Aggregate','Status','Attempts','Error']} rows={outbox.map((row)=>[row.eventType,`${row.aggregateType}:${row.aggregateId}`,<StatusChip status={row.status}/>,row.attempts,row.lastError??'-'])} empty="Outbox kosong."/></Panel>
    </>}

    {message&&<div className="notice">{message}</div>}
  </section>;
}
