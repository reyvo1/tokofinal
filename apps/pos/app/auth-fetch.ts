'use client';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const ACCESS_KEY = 'toko360_pos_token';
const REFRESH_KEY = 'toko360_pos_refresh';
let rotation: Promise<string | null> | null = null;
function get(key:string){try{return localStorage.getItem(key)}catch{return null}}
function setTokens(access:string,refresh?:string){try{localStorage.setItem(ACCESS_KEY,access);if(refresh)localStorage.setItem(REFRESH_KEY,refresh)}catch{} window.dispatchEvent(new CustomEvent('toko360:pos-auth-refreshed',{detail:{accessToken:access}}));}
function clear(){try{localStorage.removeItem(ACCESS_KEY);localStorage.removeItem(REFRESH_KEY)}catch{} window.dispatchEvent(new Event('toko360:pos-auth-expired'));}
async function rotate(){if(rotation)return rotation;rotation=(async()=>{const refreshToken=get(REFRESH_KEY);if(!refreshToken)return null;try{const r=await fetch(`${API}/auth/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken})});if(!r.ok){clear();return null}const d=await r.json();if(!d?.accessToken||!d?.refreshToken){clear();return null}setTokens(d.accessToken,d.refreshToken);return d.accessToken as string}catch{return null}})().finally(()=>{rotation=null});return rotation;}
export async function posAuthFetch(url:string,fallback:string|null|undefined,init:RequestInit={}){const send=(access?:string|null)=>fetch(url,{...init,headers:{...(init.headers??{}),...(access?{Authorization:`Bearer ${access}`}:{})}});let response=await send(get(ACCESS_KEY)??fallback);if(response.status!==401||url.endsWith('/auth/logout'))return response;const access=await rotate();return access?send(access):response;}
export function storePosTokens(access:string,refresh?:string){setTokens(access,refresh)}
export function clearPosTokens(){clear()}
