'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const ACCESS_KEY = 'toko360_token';
const REFRESH_KEY = 'toko360_refresh';
let rotation: Promise<string | null> | null = null;

function stored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function persist(accessToken: string, refreshToken: string) {
  try {
    window.localStorage.setItem(ACCESS_KEY, accessToken);
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch { /* session can still continue in-memory for this request */ }
  window.dispatchEvent(new CustomEvent('toko360:auth-refreshed', { detail: { accessToken } }));
}
function clearSession() {
  try { window.localStorage.removeItem(ACCESS_KEY); window.localStorage.removeItem(REFRESH_KEY); } catch { /* noop */ }
  window.dispatchEvent(new Event('toko360:auth-expired'));
}

async function rotateRefresh(): Promise<string | null> {
  if (rotation) return rotation;
  rotation = (async () => {
    const refreshToken = stored(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
      const response = await fetch(`${API}/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) { clearSession(); return null; }
      const data = await response.json();
      if (!data?.accessToken || !data?.refreshToken) { clearSession(); return null; }
      persist(data.accessToken, data.refreshToken);
      return data.accessToken as string;
    } catch { return null; }
  })().finally(() => { rotation = null; });
  return rotation;
}

export async function authFetch(input: string, fallbackAccessToken: string | null | undefined, init: RequestInit = {}): Promise<Response> {
  const send = (accessToken?: string | null) => fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
  });
  const accessToken = stored(ACCESS_KEY) ?? fallbackAccessToken;
  let response = await send(accessToken);
  if (response.status !== 401 || input.endsWith('/auth/logout')) return response;
  const rotated = await rotateRefresh();
  if (!rotated) return response;
  response = await send(rotated);
  return response;
}

export function storeLoginTokens(accessToken: string, refreshToken?: string) {
  try { window.localStorage.setItem(ACCESS_KEY, accessToken); if (refreshToken) window.localStorage.setItem(REFRESH_KEY, refreshToken); } catch { /* caller handles persistence warning if needed */ }
}
export function clearLoginTokens() { clearSession(); }
