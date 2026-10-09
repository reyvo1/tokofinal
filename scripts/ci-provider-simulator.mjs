#!/usr/bin/env node
/** Loopback-only CI provider simulator. No production provider, device, or credentials contacted. */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = (value) => createHash('md5').update(value).digest('hex');
const PRODUCTS = Object.freeze([
  { buyer_sku_code: 'CI-PLN-SUCCESS', product_name: 'CI Pulsa Sukses', category: 'PULSA', brand: 'CI', type: 'prepaid', price: 10000, buyer_product_status: true, seller_product_status: true, unlimited_stock: true },
  { buyer_sku_code: 'CI-PLN-FAILED', product_name: 'CI Pulsa Gagal', category: 'PULSA', brand: 'CI', type: 'prepaid', price: 11000, buyer_product_status: true, seller_product_status: true, unlimited_stock: true },
  { buyer_sku_code: 'CI-PLN-PENDING', product_name: 'CI Pulsa Pending', category: 'PULSA', brand: 'CI', type: 'prepaid', price: 12000, buyer_product_status: true, seller_product_status: true, unlimited_stock: true },
  { buyer_sku_code: 'CI-PLN-AMBIGUOUS', product_name: 'CI Pulsa Ambigu', category: 'PULSA', brand: 'CI', type: 'prepaid', price: 13000, buyer_product_status: true, seller_product_status: true, unlimited_stock: true },
]);

function response(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function safeLog(logFile, req, body) {
  if (!logFile) return;
  const headers = { ...req.headers };
  for (const key of ['authorization', 'cookie', 'x-api-key', 'proxy-authorization']) {
    if (key in headers) headers[key] = '[REDACTED]';
  }
  // CI Digiflazz signature, destination and username must not enter public Actions artifacts.
  const loggedBody = req.url === '/v1/transaction' || req.url === '/v1/price-list'
    ? { scenario: typeof body?.buyer_sku_code === 'string' ? body.buyer_sku_code : 'CATALOG', refIdPresent: Boolean(body?.ref_id) }
    : body;
  mkdirSync(path.dirname(logFile), { recursive: true });
  appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, headers, body: loggedBody }) + '\n');
}

/** Inject fake secrets in tests. CLI permits Digiflazz only under explicit CI staging. */
export function createProviderSimulator({ username, apiKey, logFile, allowDigiflazz = false } = {}) {
  const requests = new Map();
  return http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      response(res, 200, { ok: true, simulation: true });
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 65536) req.destroy();
    });
    req.on('end', () => {
      let body;
      try { body = raw ? JSON.parse(raw) : {}; }
      catch { response(res, 400, { error: 'INVALID_JSON' }); return; }
      safeLog(logFile, req, body);
      if (req.url === '/v1/price-list' || req.url === '/v1/transaction') {
        if (!allowDigiflazz || !username || !apiKey) {
          response(res, 403, { error: 'SIMULATOR_DISABLED' }); return;
        }
        if (req.method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body)) {
          response(res, 405, { error: 'INVALID_METHOD_OR_BODY' }); return;
        }
        if (body.username !== username) { response(res, 401, { error: 'INVALID_CI_USER' }); return; }
        if (req.url === '/v1/price-list') {
          if (body.cmd !== 'prepaid' || body.sign !== digest(`${username}${apiKey}pricelist`)) {
            response(res, 401, { error: 'INVALID_CI_CATALOG_SIGNATURE' }); return;
          }
          response(res, 200, { data: PRODUCTS.map((p) => ({ ...p })) });
          return;
        }
        const sku = String(body.buyer_sku_code ?? '');
        const refId = typeof body.ref_id === 'string' ? body.ref_id.trim() : '';
        const destination = typeof body.customer_no === 'string' ? body.customer_no.trim() : '';
        if (!refId || !destination || refId.length > 160 || !PRODUCTS.some((p) => p.buyer_sku_code === sku) || body.sign !== digest(`${username}${apiKey}${refId}`)) {
          response(res, 401, { error: 'INVALID_CI_TRANSACTION_SIGNATURE_OR_PAYLOAD' }); return;
        }
        const identity = JSON.stringify({ sku, destination });
        if (requests.has(refId) && requests.get(refId).identity !== identity) {
          response(res, 409, { error: 'CI_REFERENCE_PAYLOAD_MISMATCH' }); return;
        }
        if (!requests.has(refId)) {
          const status = sku.endsWith('SUCCESS') ? 'Sukses' : sku.endsWith('FAILED') ? 'Gagal' : sku.endsWith('PENDING') ? 'Pending' : 'error';
          const price = PRODUCTS.find((p) => p.buyer_sku_code === sku).price;
          requests.set(refId, { identity, data: { ref_id: refId, buyer_sku_code: sku, customer_no: destination, status, price, sn: status === 'Sukses' ? `CI-SN-${digest(refId).slice(0, 12)}` : '' } });
        }
        response(res, 200, { data: requests.get(refId).data });
        return;
      }
      // Preserve existing Telegram/WhatsApp HTTP simulator contract and idempotency logs.
      response(res, 200, { ok: true, message_id: `mock-${Date.now()}`, id: `mock-${Date.now()}` });
    });
    req.on('error', () => { if (!res.headersSent) response(res, 400, { error: 'BAD_REQUEST' }); });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.T360_PROVIDER_SIM_PORT || 4789);
  const logFile = path.resolve(process.cwd(), process.env.T360_PROVIDER_SIM_LOG || 'logs/github-runtime/provider-simulator.jsonl');
  const allowDigiflazz = process.env.CI === 'true' && process.env.T360_UAT_ENVIRONMENT === 'GITHUB_STAGING_SIMULATION';
  const server = createProviderSimulator({
    username: allowDigiflazz ? process.env.T360_CI_DIGIFLAZZ_USERNAME : undefined,
    apiKey: allowDigiflazz ? process.env.T360_CI_DIGIFLAZZ_API_KEY : undefined,
    logFile,
    allowDigiflazz,
  });
  server.listen(port, '127.0.0.1', () => console.log(`Toko360 provider simulator bound to 127.0.0.1:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
