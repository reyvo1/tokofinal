#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
const root=process.cwd();
const v4ContractPath=path.join(root,'config/p5-v4-total-ui-rebuild.json');
const v4Contract=fs.existsSync(v4ContractPath)?JSON.parse(fs.readFileSync(v4ContractPath,'utf8')):null;
const controlledGradientsAllowed=v4Contract?.phase==='P5-V4'&&v4Contract?.decision?.controlledDecorativeGradientsAllowed===true;
const apps=['admin','pos','storefront','employee-portal'];
const output=path.join(root,'handoff/quality/ui-interaction-audit-latest.json');
const failures=[]; const result={};

const adminNavigation=src(path.join(root,'apps/admin/app/navigation.ts'));
const adminDomains=src(path.join(root,'apps/admin/app/domain-workspaces.ts'));
const adminShell=src(path.join(root,'apps/admin/app/app-shell.tsx'));
const requiredAdminWorkspaces=[
 ['dashboard','/dashboard','Dashboard'],['commerce','/commerce','Penjualan & Order'],['procurement','/procurement','Pembelian'],
 ['inventory-control','/inventory-control','Persediaan'],['operations-control','/operations-control','Kontrol Operasional'],
 ['master-data','/master-data','Produk & Master Data'],['finance','/finance','Keuangan'],['reports','/reports','Laporan & Analitik'],
 ['people','/people','HRIS & Payroll'],['assets-fleet','/assets-fleet','Aset & Armada'],['intelligence','/intelligence','Forecast & Otomasi'],
 ['integrations','/integrations','Integrasi & Notifikasi'],['organization','/organization','Tenant & Organisasi'],['settings','/settings','Pengaturan & Akses'],
];
for(const [key,route,label] of requiredAdminWorkspaces){
 if(!adminNavigation.includes(`key: '${key}'`)||!adminNavigation.includes(`route: '${route}'`)||!adminNavigation.includes(`label: '${label}'`)) failures.push(`admin: workspace ${label} tidak eksplisit`);
}
for(const marker of ["key: 'providers'",'Telegram & WhatsApp',"key: 'ai'","key: 'forecast'","key: 'automation'","workspaceKey: 'organization'","workspaceKey: 'settings'","key: 'security'","key: 'api-keys'"]){
 if(!adminDomains.includes(marker)) failures.push(`admin: sub-area penting hilang (${marker})`);
}
for(const legacy of ['className="workspaceRail"','className="domainDeck"','className="domainContext"','className="statusbar"']){
 if(adminShell.includes(legacy)) failures.push(`admin: navigasi/layer legacy masih dirender (${legacy})`);
}
function walk(dir,out=[]){if(!fs.existsSync(dir))return out;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.next','dist'].includes(e.name))continue;const p=path.join(dir,e.name);e.isDirectory()?walk(p,out):out.push(p)}return out}
function src(file){return fs.readFileSync(file,'utf8')}
// Pemindai tag JSX yang seimbang. Regex atribut tidak mungkin andal di sini:
//
// 1. `<button\b([^>]*)>` (lama) berhenti pada `>` pertama. Tapi `>` sangat umum di JSX:
//    `attentionCount > 0` maupun `onClick={() => ...}`. Atribut jadi terpotong sebelum
//    onClick terlihat, sehingga button yang BERHANDLER dilaporkan inert (false positive).
// 2. Regex yang mengizinkan `>` di dalam `{...}` (satu tingkat) sudah lebih baik, tapi
//    melewatkan button yang punya brace bersarang lebih dalam - 455 tag menjadi 429, artinya
//    26 button luput diperiksa. Itu melemahkan audit, jadi tidak boleh dipakai.
//
// Solusinya: hitung tutup kurung kurawal sungguhan, sambil menghormati string dan
// template literal supaya `{` di dalam teks tidak ikut terhitung.
function scanTags(source,tag){
 const re=new RegExp(`<${tag}\\b`,'g'); const out=[]; let m;
 while((m=re.exec(source))){
  let i=re.lastIndex, depth=0, quote=null;
  for(;i<source.length;i++){
   const ch=source[i];
   if(quote){ if(ch==='\\'){i++;continue;} if(ch===quote) quote=null; continue; }
   if(ch==='"'||ch==="'"||ch==='`'){ quote=ch; continue; }
   if(ch==='{'){depth++;continue;}
   if(ch==='}'){if(depth>0)depth--;continue;}
   if(ch==='>'&&depth===0) break;
  }
  out.push({index:m.index,attrs:source.slice(re.lastIndex,i)});
  re.lastIndex=i+1;
 }
 return out;
}
for(const app of apps){
 const base=path.join(root,'apps',app); const files=walk(base); const tsx=files.filter(f=>f.endsWith('.tsx')); const css=files.filter(f=>f.endsWith('.css'));
 const source=tsx.map(src).join('\n'); const style=css.map(src).join('\n');
 // A permission ternary written directly as JSX text — `(canAll(...) ? <button>...` without
 // surrounding `{...}` — renders the expression text and leaves the button effectively
 // unconditional. This used to pass the presence-only permission audit. Count both the
 // inline `>(canAll...` form and a standalone line beginning with `(canAll...`.
 const literalPermissionExpressions=tsx.reduce((count,file)=>{
  const text=src(file);
  const inline=(text.match(/>\s*\((?:canAll|canAny)\([^\n]*\?\s*<button/g)||[]).length;
  const standalone=(text.match(/^\s*\((?:canAll|canAny)\([^\n]*\?\s*<button/gm)||[]).length;
  return count+inline+standalone;
 },0);
 const buttons=scanTags(source,'button'); const links=scanTags(source,'a');
 let inertButtons=0; let implicitSubmitButtons=0; for(const m of buttons){const a=m.attrs; if(/onClick\s*=|type\s*=\s*["']submit["']|disabled/.test(a)) continue; const before=source.slice(0,m.index); const lastFormOpen=before.lastIndexOf('<form'); const lastFormClose=before.lastIndexOf('</form>'); if(lastFormOpen>lastFormClose){implicitSubmitButtons++;continue;} inertButtons++;}
 let inertLinks=0; for(const m of links){if(!/href\s*=/.test(m.attrs)) inertLinks++;}
 const overflowBlocks=[...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m)=>/overflow-x\s*:\s*auto/i.test(m[2]));
 // boundedHorizontalScrollers: container tabel boleh overflow-x:auto karena isinya memang
 // lebih lebar (kolom Slip gaji) dan bisa digeser.
 // - .hrTable : Employee Portal, sengaja menghindari nama `table` karena itu utilitas
 //             Tailwind (display:table) yang menimpa styling hand-written.
 // - .table   : Admin, tetap dipakai dan aman karena rule-nya eksplisit display:block,
 //             dan unlayered CSS menang atas utility Tailwind yang berlapis.
 const boundedHorizontalScrollers=overflowBlocks.filter((m)=>/(?:^|,)\s*\.(?:hrTable|table)\b/.test(m[1])).length;
 const horizontalOverflow=overflowBlocks.length-boundedHorizontalScrollers;
 const item={tsxFiles:tsx.length,cssFiles:css.length,buttons:buttons.length,links:links.length,inertButtons,implicitSubmitButtons,inertLinks,literalPermissionExpressions,tailwind:/@import\s+["']tailwindcss["']/.test(style),gradients:(style.match(/(?:linear|radial|conic)-gradient\s*\(/gi)||[]).length,horizontalOverflow,boundedHorizontalScrollers};
 if(!item.tailwind)failures.push(`${app}: Tailwind import hilang`);
 if(item.gradients&&!controlledGradientsAllowed)failures.push(`${app}: gradient dekoratif ${item.gradients}`);
 if(item.horizontalOverflow)failures.push(`${app}: primary horizontal overflow ${item.horizontalOverflow}`);
 if(item.inertButtons)failures.push(`${app}: ${item.inertButtons} button tanpa handler/submit`);
 if(item.inertLinks)failures.push(`${app}: ${item.inertLinks} anchor tanpa href`);
 if(item.literalPermissionExpressions)failures.push(`${app}: ${item.literalPermissionExpressions} permission ternary dirender sebagai teks JSX`);
 result[app]={...item,controlledGradientPolicy:controlledGradientsAllowed?'P5-V4_CONTROLLED_ALLOWED':'FORBIDDEN'};
}
const data={generatedAt:new Date().toISOString(),status:failures.length?'FAIL':'PASS',sourceIdentity:sourceFingerprint(root),surfaces:result,failures,note:'Static interaction inventory is a mandatory companion to real browser UAT; it does not replace runtime click verification.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');console.log(`UI source audit ${data.status}: ${Object.values(result).reduce((n,x)=>n+x.buttons+x.links,0)} controls inventoried.`);if(failures.length){failures.forEach(x=>console.error(`BLOCKER: ${x}`));process.exit(1)}
