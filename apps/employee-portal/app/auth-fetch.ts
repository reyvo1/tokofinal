'use client';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const ACCESS_KEY='employeeToken', REFRESH_KEY='employeeRefreshToken';
let rotation:Promise<string|null>|null=null;
function get(k:string){try{return localStorage.getItem(k)}catch{return null}}
function save(access:string,refresh?:string){try{localStorage.setItem(ACCESS_KEY,access);if(refresh)localStorage.setItem(REFRESH_KEY,refresh)}catch{} window.dispatchEvent(new CustomEvent('toko360:employee-auth-refreshed',{detail:{accessToken:access}}));}
function clear(){try{localStorage.removeItem(ACCESS_KEY);localStorage.removeItem(REFRESH_KEY)}catch{} window.dispatchEvent(new Event('toko360:employee-auth-expired'));}
async function rotate(){if(rotation)return rotation;rotation=(async()=>{const refreshToken=get(REFRESH_KEY);if(!refreshToken)return null;try{const r=await fetch(`${API}/auth/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken})});if(!r.ok){clear();return null}const d=await r.json();if(!d?.accessToken||!d?.refreshToken){clear();return null}save(d.accessToken,d.refreshToken);return d.accessToken as string}catch{return null}})().finally(()=>{rotation=null});return rotation;}
export async function employeeAuthFetch(url:string,fallback:string|null|undefined,init:RequestInit={}){const send=(access?:string|null)=>fetch(url,{...init,headers:{...(init.headers??{}),...(access?{Authorization:`Bearer ${access}`}:{})}});let r=await send(get(ACCESS_KEY)??fallback);if(r.status!==401||url.endsWith('/auth/logout'))return r;const access=await rotate();return access?send(access):r;}
export function storeEmployeeTokens(access:string,refresh?:string){save(access,refresh)}
export function clearEmployeeTokens(){clear()}
