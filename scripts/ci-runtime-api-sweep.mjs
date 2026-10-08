#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
const root=process.cwd();
const output=path.join(root,'handoff/quality/github-api-runtime-sweep-latest.json');
const api=String(process.env.T360_API_URL||'http://127.0.0.1:4000/api/v1').replace(/\/$/,'');
const email=String(process.env.T360_UAT_ADMIN_EMAIL||process.env.SEED_ADMIN_EMAIL||'');
const password=String(process.env.T360_UAT_ADMIN_PASSWORD||process.env.SEED_ADMIN_PASSWORD||'');
if(!email||!password) throw new Error('Admin UAT credential tidak tersedia untuk API sweep.');
const login=await fetch(`${api}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
const loginBody=await login.json().catch(()=>({})); if(!login.ok||!loginBody.accessToken) throw new Error(`API sweep login gagal HTTP ${login.status}`);
const swaggerUrl=new URL('/docs-json', api.replace(/\/api\/v1$/,''));
const swaggerRes=await fetch(swaggerUrl); if(!swaggerRes.ok) throw new Error(`Swagger JSON gagal HTTP ${swaggerRes.status}`); const swagger=await swaggerRes.json();
const methods=['get','post','put','patch','delete']; const operations=[];
for(const [route,entry] of Object.entries(swagger.paths||{})) for(const method of methods) if(entry?.[method]) operations.push({route,method,operationId:entry[method].operationId||null,security:entry[method].security??swagger.security??[]});
function expand(route){return route.replace(/\{[^}]+\}/g,'00000000-0000-4000-8000-000000000999');}
function runtimePath(route){
  let pathname=expand(route);
  if(!pathname.startsWith('/')) pathname=`/${pathname}`;
  const apiPath=new URL(api).pathname.replace(/\/$/,'');
  if(apiPath && apiPath!=='/' && (pathname===apiPath || pathname.startsWith(`${apiPath}/`))) pathname=pathname.slice(apiPath.length)||'/';
  return pathname.startsWith('/')?pathname:`/${pathname}`;
}
const statuses={}; const blockers=[]; const results=[];
for(const op of operations){
  const pathname=runtimePath(op.route); const url=`${api}${pathname}`;
  const headers={'accept':'application/json','authorization':`Bearer ${loginBody.accessToken}`,'idempotency-key':`ci-api-sweep-${crypto.createHash('sha256').update(op.method+op.route).digest('hex').slice(0,24)}`};
  const init={method:op.method.toUpperCase(),headers}; if(!['get','delete'].includes(op.method)){headers['content-type']='application/json';init.body='{}'}
  let status=0,body=''; try{const response=await fetch(url,init); status=response.status; body=(await response.text()).slice(0,700);}catch(error){blockers.push({route:op.route,method:op.method,error:String(error)});continue}
  statuses[status]=(statuses[status]||0)+1;
  const routerMiss=status===404 && /Cannot\s+(GET|POST|PUT|PATCH|DELETE)/i.test(body);
  const serverFailure=status>=500;
  if(routerMiss||serverFailure) blockers.push({route:op.route,method:op.method,status,body});
  results.push({route:op.route,method:op.method,status,routerMiss});
}
const data={generatedAt:new Date().toISOString(),status:blockers.length?'FAIL':'PASS',sourceIdentity:sourceFingerprint(root),baseUrl:api,operationCount:operations.length,statuses,blockerCount:blockers.length,blockers,results,note:'Every OpenAPI operation is routed against the live exact runtime. Validation/domain 4xx is acceptable for synthetic payloads; router-missing and 5xx are blockers. Critical business lifecycles remain covered by dedicated semantic UAT.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');console.log(`API runtime sweep ${data.status}: ${operations.length} OpenAPI operations, blockers=${blockers.length}.`);if(blockers.length)process.exit(1);
