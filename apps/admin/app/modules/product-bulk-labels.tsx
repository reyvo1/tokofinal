'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { code128B } from '../code128';
import { usePermissions } from '../permissions';
import { Panel, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Product = { id:string; sku:string; name:string; barcode?:string|null; unit:string; salePrice:string|number; costPrice:string|number; minStock:number; brandCode?:string|null; category?:{slug:string}|null; productType?:string; trackBatch?:boolean; trackExpiry?:boolean; trackSerial?:boolean; isActive:boolean };
type ProductPage = { items: Product[] };
type DryRun = { dryRun:boolean; total:number; valid:number; creates:number; updates:number; errors:Array<{row:number;sku:string;message:string}> };

async function json<T>(token:string,path:string,init?:RequestInit):Promise<T>{const r=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});const body=await r.json();if(!r.ok)throw new Error(Array.isArray(body.message)?body.message.join(', '):body.message??'Request gagal');return body as T;}
function parseCsv(text:string):string[][]{const rows:string[][]=[];let row:string[]=[];let cell='';let quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;continue;}if(c==='"'){quoted=false;continue;}cell+=c;continue;}if(c==='"'){quoted=true;continue;}if(c===','||c===';'){row.push(cell);cell='';continue;}if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';continue;}cell+=c;}if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}return rows.filter(r=>r.some(v=>v.trim()));}
function bool(v:string){return ['1','true','yes','ya','y'].includes(v.trim().toLowerCase());}
function toRows(text:string){
  const rows=parseCsv(text);
  if(rows.length<2)throw new Error('CSV harus memiliki header dan minimal satu data.');
  const h=rows[0].map(x=>x.trim().replace(/^\uFEFF/,''));
  const required=['sku','name','unit','costPrice','salePrice'];
  const missing=required.filter(key=>!h.includes(key));
  if(missing.length)throw new Error(`Header wajib belum ada: ${missing.join(', ')}.`);
  const at=(r:string[],key:string)=>r[h.indexOf(key)]??'';
  return rows.slice(1).map((r,index)=>{
    const unit=at(r,'unit').trim().toUpperCase();
    if(!unit)throw new Error(`Baris ${index+2}: unit wajib diisi dari master UNIT.`);
    return {sku:at(r,'sku'),name:at(r,'name'),barcode:at(r,'barcode')||undefined,unit,costPrice:Number(at(r,'costPrice')),salePrice:Number(at(r,'salePrice')),retailCeilingPrice:at(r,'retailCeilingPrice')===''?undefined:Number(at(r,'retailCeilingPrice')),minStock:Number(at(r,'minStock')||0),brandCode:at(r,'brandCode')||undefined,categorySlug:at(r,'categorySlug')||undefined,productType:at(r,'productType')||'PHYSICAL',trackBatch:bool(at(r,'trackBatch')),trackExpiry:bool(at(r,'trackExpiry')),trackSerial:bool(at(r,'trackSerial')),isActive:at(r,'isActive')===''?true:bool(at(r,'isActive'))};
  });
}

function Barcode({value}:{value:string}){const layout=useMemo(()=>code128B(value,1.5,42),[value]);return <svg role="img" aria-label={`Code128 ${value}`} viewBox={`0 0 ${layout.width} 60`} width="100%" height="60">{layout.bars.map((bar,i)=><rect key={i} x={bar.x} y="2" width={bar.width} height={layout.height}/>) }<text x={layout.width/2} y="57" textAnchor="middle" fontSize="9">{value}</text></svg>;}

export default function ProductBulkLabelsView({token}:{token:string}){
  const {canAll}=usePermissions(token); const canImport=canAll('product.create');
  const [products,setProducts]=useState<Product[]>([]);const [selected,setSelected]=useState<string[]>([]);const [rows,setRows]=useState<ReturnType<typeof toRows>>([]);const [preview,setPreview]=useState<DryRun|null>(null);const [updateExisting,setUpdateExisting]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [paper,setPaper]=useState<'A4'|'58MM'>('A4');
  useEffect(()=>{void json<ProductPage>(token,'/products?limit=200&includeInactive=true').then(r=>setProducts(r.items)).catch(e=>setMessage(e instanceof Error?e.message:'Produk gagal dimuat.'));},[token]);
  async function fileChange(file?:File){setPreview(null);if(!file){setRows([]);return;}try{setRows(toRows(await file.text()));setMessage(`${file.name}: data siap dry-run.`);}catch(e){setRows([]);setMessage(e instanceof Error?e.message:'CSV tidak valid.');}}
  async function dryRun(){setBusy(true);try{const r=await json<DryRun>(token,'/products/bulk-import',{method:'POST',body:JSON.stringify({rows,dryRun:true,updateExisting})});setPreview(r);setMessage(r.errors.length?`${r.errors.length} error harus diperbaiki.`:`Dry-run valid: ${r.valid}/${r.total}.`);}catch(e){setMessage(e instanceof Error?e.message:'Dry-run gagal.');}finally{setBusy(false);}}
  async function commit(){if(!preview||preview.errors.length)throw new Error('Dry-run bersih wajib sebelum commit.');setBusy(true);try{const r=await json<{created:number;updated:number}>(token,'/products/bulk-import',{method:'POST',body:JSON.stringify({rows,dryRun:false,updateExisting})});setMessage(`Import selesai: ${r.created} dibuat, ${r.updated} diperbarui.`);const p=await json<ProductPage>(token,'/products?limit=200&includeInactive=true');setProducts(p.items);setPreview(null);}catch(e){setMessage(e instanceof Error?e.message:'Import gagal.');}finally{setBusy(false);}}
  async function exportCsv(){setBusy(true);try{const r=await json<{fileName:string;mimeType:string;content:string}>(token,'/products/export-csv');const url=URL.createObjectURL(new Blob([r.content],{type:r.mimeType}));const a=document.createElement('a');a.href=url;a.download=r.fileName;a.click();URL.revokeObjectURL(url);}catch(e){setMessage(e instanceof Error?e.message:'Export gagal.');}finally{setBusy(false);}}
  function printLabels(){
    if(!selected.length){setMessage('Pilih minimal satu produk.');return;}
    const source=document.querySelector('.labelPrintArea');
    if(!(source instanceof HTMLElement)){setMessage('Area label tidak ditemukan.');return;}
    const popup=window.open('','_blank','noopener,noreferrer,width=900,height=700');
    if(!popup){setMessage('Popup print diblokir browser. Izinkan popup lalu ulangi.');return;}
    const thermal=paper==='58MM';
    popup.document.write(`<!doctype html><html><head><title>Label Produk</title><style>@page{margin:${thermal?'2mm':'8mm'};size:${thermal?'58mm auto':'A4'}}body{font-family:Arial,sans-serif;margin:0}.labelPrintArea{display:${thermal?'block':'grid'};grid-template-columns:${thermal?'none':'repeat(3,1fr)'};gap:4mm}.productLabel{box-sizing:border-box;border:1px solid #111;padding:3mm;break-inside:avoid;${thermal?'width:54mm;margin:0 0 2mm':''}}.productLabel strong,.productLabel small{display:block;margin-bottom:2mm}.productLabel svg{width:100%;height:18mm}.productLabel svg rect,.productLabel svg text{fill:#000}</style></head><body>${source.innerHTML}</body></html>`);
    popup.document.close(); popup.focus(); popup.print(); popup.close();
  }
  const selectedProducts=products.filter(p=>selected.includes(p.id));
  return <div className="productBulkLabels"><section className="grid2"><Panel eyebrow="BULK MASTER" title="Import / export produk" badge="CSV Excel-compatible"><div className="formStack"><button type="button" className="secondary" onClick={()=>void exportCsv()} disabled={busy}>Export CSV</button><label>Import CSV<input type="file" accept=".csv,text/csv" onChange={e=>void fileChange(e.target.files?.[0])}/></label><label className="checkboxRow"><input type="checkbox" checked={updateExisting} onChange={e=>{setUpdateExisting(e.target.checked);setPreview(null);}}/> Izinkan update SKU existing</label><div className="rowActions">{canImport&&<button type="button" disabled={busy||!rows.length} onClick={()=>void dryRun()}>Dry-run {rows.length} baris</button>}{canImport&&<button type="button" disabled={busy||!preview||preview.errors.length>0} onClick={()=>void commit()}>Commit import</button>}</div></div>{preview&&<div className="notice"><strong>{preview.valid}/{preview.total} valid · {preview.creates} create · {preview.updates} update</strong>{preview.errors.slice(0,10).map(e=><small key={`${e.row}-${e.sku}`}>Baris {e.row} · {e.sku}: {e.message}</small>)}</div>}<p className="sectionHelp">Header canonical: sku,name,barcode,unit,costPrice,salePrice,retailCeilingPrice,minStock,brandCode,categorySlug,productType,trackBatch,trackExpiry,trackSerial,isActive.</p></Panel><Panel eyebrow="LABEL" title="Code128 label printing" badge={`${selected.length} dipilih`}><label>Ukuran<select value={paper} onChange={e=>setPaper(e.target.value as 'A4'|'58MM')}><option value="A4">A4 label sheet</option><option value="58MM">58 mm thermal</option></select></label><div className="rowActions"><button type="button" className="secondary" onClick={()=>setSelected(products.map(p=>p.id))}>Pilih semua</button><button type="button" className="secondary" onClick={()=>setSelected([])}>Kosongkan</button><button type="button" disabled={!selected.length} onClick={printLabels}>Print label</button></div><Table head={['Pilih','SKU','Produk','Barcode']} rows={products.map(p=>[<input key={p.id} type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/>,p.sku,p.name,p.barcode??'-'])} empty="Belum ada produk."/></Panel></section><section className={`labelPrintArea ${paper==='58MM'?'label58':''}`}>{selectedProducts.map(p=><div className="productLabel" key={p.id}><strong>{p.name}</strong><small>{p.sku} · {new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(p.salePrice))}</small><Barcode value={(p.barcode||p.sku).slice(0,40)}/></div>)}</section>{message&&<div className="notice">{message}</div>}</div>;
}
