#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const port=Number(process.env.T360_PROVIDER_SIM_PORT||4789);const log=path.resolve(process.cwd(),process.env.T360_PROVIDER_SIM_LOG||'logs/github-runtime/provider-simulator.jsonl');fs.mkdirSync(path.dirname(log),{recursive:true});
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{let parsed;try{parsed=body?JSON.parse(body):null}catch{parsed=body}const row={at:new Date().toISOString(),method:req.method,url:req.url,headers:req.headers,body:parsed};fs.appendFileSync(log,JSON.stringify(row)+'\n');if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,message_id:`mock-${Date.now()}`,id:`mock-${Date.now()}`}));});});
server.listen(port,'127.0.0.1',()=>console.log(`Toko360 provider simulator listening on http://127.0.0.1:${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
