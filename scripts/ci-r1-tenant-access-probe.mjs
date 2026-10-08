#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root=process.cwd();
const output=path.join(root,'handoff/quality/github-r1-tenant-access-probe-latest.json');
const api=String(process.env.T360_API_URL||'http://127.0.0.1:4000/api/v1').replace(/\/$/,'');
const email=process.env.T360_UAT_ADMIN_EMAIL||process.env.SEED_ADMIN_EMAIL;
const password=process.env.T360_UAT_ADMIN_PASSWORD||process.env.SEED_ADMIN_PASSWORD;
if(!email||!password)throw new Error('Credential R1 probe tidak tersedia.');

async function request(route,{method='GET',body,token,expect}={}){
  const headers={accept:'application/json'};
  if(token)headers.authorization=`Bearer ${token}`;
  if(body!==undefined)headers['content-type']='application/json';
  const response=await fetch(`${api}${route}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(expect!==undefined){if(response.status!==expect)throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0,400)}`);return data;}
  if(!response.ok)throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0,500)}`);
  return data;
}

const login=await request('/auth/login',{method:'POST',body:{email,password}});
let token=login.accessToken;if(!token)throw new Error('Login R1 tidak menghasilkan token.');
const stamp=Date.now();
const tenant=await request('/platform/tenant',{token});
if(!tenant?.company?.id||!tenant?.activeBranchId)throw new Error('Tenant profile tidak lengkap.');
await request('/platform/tenant',{method:'PATCH',token,body:{name:tenant.company.name,timezone:tenant.company.timezone,currency:tenant.company.currency}});

const branch=await request('/master-data/branches',{method:'POST',token,body:{code:`R1${String(stamp).slice(-8)}`,name:`R1 CI Branch ${stamp}`,address:'GitHub deterministic R1 branch'}});
const before=await request('/auth/branch-context',{token});
if(!before.canSwitch||!before.branches.some((item)=>item.id===branch.id))throw new Error('Branch baru tidak tersedia pada authorized branch context.');
const switched=await request('/auth/branch-context',{method:'POST',token,body:{branchId:branch.id}});
token=switched.accessToken;
const manifest=await request('/platform/manifest',{token});
if(manifest?.branch?.id!==branch.id)throw new Error('JWT/session branch context tidak berpindah pada runtime manifest.');

const invalidBranch='00000000-0000-4000-8000-000000000999';
await request('/auth/branch-context',{method:'POST',token,body:{branchId:invalidBranch},expect:403});
const foreignCompany='00000000-0000-4000-8000-000000000998';
await request(`/platform/settings?companyId=${foreignCompany}`,{token,expect:403});

const permissions=await request('/users/permissions',{token});
const roles=await request('/users/roles',{token});
if(!Array.isArray(permissions)||!permissions.some((item)=>item.code==='branch.switch'))throw new Error('Permission branch.switch tidak tersedia.');
if(!Array.isArray(roles)||!roles.some((item)=>item.name==='SUPER_ADMIN'))throw new Error('Role catalog tidak lengkap.');
const roleName=`R1_CI_${String(stamp).slice(-8)}`;
const role=await request('/users/roles',{method:'POST',token,body:{name:roleName,description:'R1 GitHub runtime role',permissionCodes:['audit.view']}});
await request(`/users/roles/${role.id}/permissions`,{method:'PATCH',token,body:{permissionCodes:['audit.view','master_data.view']}});
const user=await request('/users',{method:'POST',token,body:{name:'R1 CI Operator',email:`r1-${stamp}@example.invalid`,password:'R1-CI-Strong-Password-2026!',roleNames:[roleName]}});
await request(`/users/${user.id}/roles`,{method:'PATCH',token,body:{roleNames:[roleName,'CASHIER']}});
await request(`/users/${user.id}/status`,{method:'PATCH',token,body:{isActive:false}});
await request(`/users/${user.id}/status`,{method:'PATCH',token,body:{isActive:true}});

const controlPlane={};
for(const route of ['/platform/settings','/platform/custom-fields','/platform/webhooks','/platform/approval-policies','/platform/approval-requests','/platform/audit-logs?limit=20','/platform/outbox?limit=20','/platform/ui-schemas','/platform/ops-health']){
  const data=await request(route,{token});controlPlane[route]=Array.isArray(data)?data.length:(data?.healthy!==undefined?data.healthy:true);
}

const back=await request('/auth/branch-context',{method:'POST',token,body:{branchId:before.homeBranchId}});
const backManifest=await request('/platform/manifest',{token:back.accessToken});
if(backManifest?.branch?.id!==before.homeBranchId)throw new Error('Branch context tidak dapat kembali ke home branch.');

const result={
  generatedAt:new Date().toISOString(),status:'PASS',sourceIdentity:sourceFingerprint(root),
  tenant:{companyId:tenant.company.id,homeBranchId:before.homeBranchId,createdBranchId:branch.id,switched:true,returnedHome:true},
  access:{permissionCount:permissions.length,roleCountBefore:roles.length,createdRoleId:role.id,createdUserId:user.id,statusLifecycle:true},
  isolation:{foreignBranchDenied:true,foreignCompanyDenied:true},controlPlane,
  note:'R1 runtime probe exercises trusted tenant profile, same-company session branch switching, cross-scope denial, role/permission/user/status lifecycle, and control-plane reads on live PostgreSQL runtime.'
};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(`R1 tenant/access probe PASS: branch=${branch.id}, role=${role.id}, user=${user.id}.`);
