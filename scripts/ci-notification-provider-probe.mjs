#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
const root=process.cwd();const out=path.join(root,'handoff/quality/github-notification-provider-probe-latest.json');
const api=String(process.env.T360_API_URL||'http://127.0.0.1:4000/api/v1').replace(/\/$/,'');
const simulator=String(process.env.T360_PROVIDER_SIM_URL||'http://127.0.0.1:4789').replace(/\/$/,'');
const logFile=path.resolve(root,process.env.T360_PROVIDER_SIM_LOG||'logs/github-runtime/provider-simulator.jsonl');
const email=process.env.T360_UAT_ADMIN_EMAIL||process.env.SEED_ADMIN_EMAIL;const password=process.env.T360_UAT_ADMIN_PASSWORD||process.env.SEED_ADMIN_PASSWORD;
const employeeEmail=process.env.SEED_EMPLOYEE_EMAIL||'ci-employee@example.invalid';const employeePassword=process.env.SEED_EMPLOYEE_PASSWORD||'CI-Only-Employee-Password-2026!';
if(!email||!password||!employeeEmail||!employeePassword)throw new Error('Credential UAT provider probe tidak tersedia.');
async function request(route,{method='GET',body,token}={}){const headers={'accept':'application/json'};if(token)headers.authorization=`Bearer ${token}`;if(body!==undefined)headers['content-type']='application/json';const r=await fetch(`${api}${route}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});const txt=await r.text();let data;try{data=txt?JSON.parse(txt):null}catch{data=txt}if(!r.ok)throw new Error(`${method} ${route} HTTP ${r.status}: ${txt.slice(0,500)}`);return data}
const login=await request('/auth/login',{method:'POST',body:{email,password}});const token=login.accessToken;if(!token)throw new Error('Provider probe login tidak menghasilkan token.');
const stamp=Date.now();
async function createProvider(channel,config,secret){const created=await request('/platform/integrations',{method:'POST',token,body:{type:'NOTIFICATION',provider:channel,name:`CI ${channel} ${stamp}`,config:{channel,...config},encryptedSecrets:secret,capabilities:['SEND_TEXT']}});await request(`/platform/integrations/${created.id}`,{method:'PATCH',token,body:{status:'CONNECTED'}});return created}
const telegram=await createProvider('TELEGRAM',{adapter:'TELEGRAM_BOT'},'ci-telegram-token');
const whatsapp=await createProvider('WHATSAPP',{url:`${simulator}/whatsapp`,method:'POST',recipientField:'to',bodyField:'body'},JSON.stringify({token:'ci-whatsapp-token',tokenHeader:'authorization',tokenPrefix:'Bearer '}));
const employeeLogin=await request('/auth/login',{method:'POST',body:{email:employeeEmail,password:employeePassword}});const employeeToken=employeeLogin.accessToken;if(!employeeToken)throw new Error('Provider probe employee login tidak menghasilkan token.');
const bindingRequest=await request('/employee/me/channels/request-verification',{method:'POST',token:employeeToken,body:{channel:'TELEGRAM',externalUserId:'ci-owner-chat'}});if(!bindingRequest?.bindingId)throw new Error('Request binding Telegram employee tidak menghasilkan bindingId.');
let verificationCode='';for(let i=0;i<45;i++){const verificationLines=fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8').trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)):[];const verificationCall=[...verificationLines].reverse().find(x=>String(x.url||'').includes('/botci-telegram-token/sendMessage')&&String(x.body?.chat_id||'')==='ci-owner-chat'&&/Kode verifikasi Toko360 Anda: \d{6}/.test(String(x.body?.text||'')));const match=String(verificationCall?.body?.text||'').match(/Kode verifikasi Toko360 Anda: (\d{6})/);if(match){verificationCode=match[1];break}await new Promise(r=>setTimeout(r,1000));}
if(!verificationCode)throw new Error('Kode verifikasi Telegram employee tidak sampai ke provider simulator.');
await request('/employee/me/channels/verify',{method:'POST',token:employeeToken,body:{channel:'TELEGRAM',externalUserId:'ci-owner-chat',code:verificationCode}});
await request('/reports/daily-digest/config',{method:'POST',token,body:{enabled:true,hour:21,recipientBindingIds:[bindingRequest.bindingId]}});
const configuredDigest=await request('/reports/daily-digest/config',{token});if(!configuredDigest?.recipientBindingIds?.includes(bindingRequest.bindingId))throw new Error('Daily digest config tidak mempertahankan verified recipient binding.');
const preview=await request('/reports/daily-digest/preview',{token}); if(!preview?.text)throw new Error('Daily digest preview kosong.');
const digest=await request('/reports/daily-digest/send',{method:'POST',token}); if(Number(digest?.queued||0)<1)throw new Error('Daily owner digest tidak masuk antrean Telegram.');
const telegramQueued=await request('/notifications',{method:'POST',token,body:{channel:'TELEGRAM',recipient:'ci-telegram-chat',body:'CI Telegram provider probe'}});
const whatsappQueued=await request('/notifications',{method:'POST',token,body:{channel:'WHATSAPP',recipient:'+6280000000000',body:'CI WhatsApp provider probe'}});
const ids=[...(digest.notificationIds||[]),telegramQueued.id,whatsappQueued.id].filter(Boolean);
let delivered=[];for(let i=0;i<45;i++){const rows=await request('/notifications?limit=100',{token});delivered=(Array.isArray(rows)?rows:rows?.items||[]).filter(x=>ids.includes(x.id));if(ids.every(id=>delivered.some(x=>x.id===id&&x.status==='SENT')))break;await new Promise(r=>setTimeout(r,1000));}
const missing=ids.filter(id=>!delivered.some(x=>x.id===id&&x.status==='SENT'));if(missing.length)throw new Error(`Provider delivery belum SENT: ${missing.join(', ')}`);
const lines=fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8').trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)):[];
const telegramCalls=lines.filter(x=>String(x.url||'').includes('/botci-telegram-token/sendMessage'));
const whatsappCalls=lines.filter(x=>x.url==='/whatsapp');
if(telegramCalls.length<3)throw new Error(`Simulator hanya menerima ${telegramCalls.length} Telegram call; verification + owner digest + manual wajib terkirim.`);
if(whatsappCalls.length<1)throw new Error('Simulator tidak menerima WhatsApp call.');
if(!telegramCalls.every(x=>x.headers?.['idempotency-key']))throw new Error('Telegram provider call kehilangan idempotency-key.');
if(!whatsappCalls.every(x=>x.headers?.['idempotency-key']))throw new Error('WhatsApp provider call kehilangan idempotency-key.');
const result={generatedAt:new Date().toISOString(),status:'PASS',sourceIdentity:sourceFingerprint(root),providers:{telegramIntegrationId:telegram.id,whatsappIntegrationId:whatsapp.id},dailyDigest:{preview:true,verifiedRecipient:true,queued:digest.queued},deliveries:delivered.map(x=>({id:x.id,channel:x.channel,status:x.status,provider:x.provider,attempts:x.attempts})),simulator:{telegramCalls:telegramCalls.length,whatsappCalls:whatsappCalls.length},productionTouched:false,note:'Deterministic GitHub provider simulation exercises real API, DB, worker queue and Telegram/WhatsApp adapters against localhost provider simulator. Live Telegram remains a separate secret-gated test.'};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(`Notification provider probe PASS: Telegram=${telegramCalls.length}, WhatsApp=${whatsappCalls.length}, delivered=${delivered.length}.`);
