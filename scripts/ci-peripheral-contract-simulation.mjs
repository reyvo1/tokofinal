#!/usr/bin/env node
/** Executed POS device-protocol + loopback Digiflazz simulation for exact-source GitHub CI. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProviderSimulator } from './ci-provider-simulator.mjs';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = path.resolve(import.meta.dirname, '..');
const printer = await import(pathToFileURL(path.join(root, 'apps/pos/lib/printing.ts')).href);
const scanner = await import(pathToFileURL(path.join(root, 'apps/pos/lib/barcode.ts')).href);
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const receipt = (width) => ({ storeName: 'Toko360 CI', invoiceNumber: 'CI-20261009-001', cashierName: 'Kasir CI', dateLabel: '09/10/2026', paperWidth: width, columns: [{ left: 'Paket 1', right: '12000' }], summary: [{ label: 'TOTAL', value: 'Rp12.000', bold: true }] });

await check('Printer 58mm/80mm: actual ESC/POS receipt transport, totals, reset, cut', async () => {
  for (const width of [58, 80]) {
    const writes = [];
    const connected = { write: async (bytes) => writes.push(Buffer.from(bytes)), close: () => {} };
    const result = await printer.printReceipt(receipt(width), connected);
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    const bytes = writes[0];
    assert.ok(bytes.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])));
    assert.ok(bytes.subarray(-6).equals(Buffer.from([0x1d, 0x56, 0x42, 3, 0, 0])));
    assert.ok(bytes.includes(Buffer.from('CI-20261009-001')));
    assert.ok(bytes.includes(Buffer.from('Rp12.000')));
    assert.equal(printer.columnsForWidth(width), width === 58 ? 32 : 48);
    const raw = printer.buildRawBtUrl(bytes);
    assert.ok(raw.startsWith('rawbt:base64,'));
    assert.ok(Buffer.from(raw.slice('rawbt:base64,'.length), 'base64').equals(bytes));
  }
});
await check('Laci kas pin 2/5: pulse bytes, no connection, device write failure', async () => {
  for (const pin of [2, 5]) {
    const writes = [];
    const result = await printer.openCashDrawer({ write: async (bytes) => writes.push(Buffer.from(bytes)), close: () => {} }, pin);
    assert.equal(result.ok, true);
    assert.equal(hex(writes[0]), pin === 2 ? '1b70fa08004000' : '1b70f508004000');
  }
  assert.equal((await printer.openCashDrawer()).ok, false);
  const failed = await printer.openCashDrawer({ write: async () => { throw new Error('SIMULATED_DISCONNECT'); }, close: () => {} });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /SIMULATED_DISCONNECT/);
});
await check('Scanner keyboard wedge: valid scan, manual input isolation, modifier and slow Enter guards', async () => {
  const events = new Map();
  const target = { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: (name) => events.delete(name) };
  const scans = [];
  const listener = scanner.createBarcodeListener({ onScan: (code) => scans.push(code) });
  const stop = listener.start(target);
  assert.equal(typeof events.get('keydown'), 'function');
  const originalNow = Date.now;
  let now = 10000;
  Date.now = () => now;
  const send = (key, extra = {}) => {
    let prevented = false;
    events.get('keydown')({ key, target: { tagName: 'BUTTON' }, preventDefault: () => { prevented = true; }, ...extra });
    return prevented;
  };
  try {
    for (const key of '8990000000012') { send(key); now += 5; }
    assert.equal(send('Enter'), true);
    assert.deepEqual(scans, ['8990000000012']);
    for (const key of 'manual') { send(key, { target: { tagName: 'INPUT', type: 'text' } }); now += 3; }
    send('Enter', { target: { tagName: 'INPUT', type: 'text' } });
    assert.equal(scans.length, 1);
    for (const key of '1234567') { send(key); now += 5; }
    now += 100;
    assert.equal(send('Enter'), false);
    send('1'); send('2', { ctrlKey: true }); send('3'); send('Enter');
    assert.equal(scans.length, 1);
  } finally { Date.now = originalNow; stop(); }
  assert.equal(events.has('keydown'), false);
});

const ciUser = 't360-ci-user';
const ciKey = 't360-ci-fake-key-not-real';
const server = createProviderSimulator({ username: ciUser, apiKey: ciKey, allowDigiflazz: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (endpoint, body) => {
    const res = await fetch(`${base}/v1/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { code: res.status, data: await res.json() };
  };
  const md5 = (value) => createHash('md5').update(value).digest('hex');
  await check('Digiflazz catalog: valid signed request, 4 deterministic products, invalid signature refused', async () => {
    const payload = { cmd: 'prepaid', username: ciUser, sign: md5(ciUser + ciKey + 'pricelist') };
    const ok = await post('price-list', payload);
    assert.equal(ok.code, 200);
    assert.deepEqual(ok.data.data.map((p) => p.buyer_sku_code), ['CI-PLN-SUCCESS', 'CI-PLN-FAILED', 'CI-PLN-PENDING', 'CI-PLN-AMBIGUOUS']);
    assert.equal((await post('price-list', { ...payload, sign: 'WRONG' })).code, 401);
  });
  await check('Digiflazz paid lifecycle response: SUCCESS, FAILED, PENDING, ambiguous status (no fake refund)', async () => {
    for (const scenario of ['SUCCESS', 'FAILED', 'PENDING', 'AMBIGUOUS']) {
      const ref_id = `CI-${scenario}-1`;
      const payload = { username: ciUser, buyer_sku_code: `CI-PLN-${scenario}`, customer_no: '0812345678', ref_id, sign: md5(ciUser + ciKey + ref_id) };
      const first = await post('transaction', payload);
      const replay = await post('transaction', payload);
      assert.equal(first.code, 200);
      assert.equal(replay.code, 200);
      assert.deepEqual(first.data, replay.data);
      assert.equal(first.data.data.status, { SUCCESS: 'Sukses', FAILED: 'Gagal', PENDING: 'Pending', AMBIGUOUS: 'error' }[scenario]);
      assert.ok(first.data.data.price > 0);
      assert.equal((await post('transaction', { ...payload, customer_no: '0812999999' })).code, 409);
      assert.equal((await post('transaction', { ...payload, sign: 'BAD' })).code, 401);
    }
  });
  await check('Digiflazz simulator isolation: localhost binding, refused unknown SKU and disabled mode', async () => {
    assert.equal(server.address().address, '127.0.0.1');
    const ref_id = 'CI-UNKNOWN';
    const denied = await post('transaction', { username: ciUser, buyer_sku_code: 'REAL-PRODUCTION-SKU', customer_no: '0812345678', ref_id, sign: md5(ciUser + ciKey + ref_id) });
    assert.equal(denied.code, 401);
    const disabled = createProviderSimulator();
    await new Promise((resolve) => disabled.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${disabled.address().port}/v1/price-list`, { method: 'POST', body: '{}' });
      assert.equal(res.status, 403);
    } finally { await new Promise((resolve) => disabled.close(resolve)); }
  });
  await check('Existing Telegram/WhatsApp simulator HTTP response retained', async () => {
    const res = await fetch(`${base}/whatsapp`, { method: 'POST', body: JSON.stringify({ to: 'CI', body: 'test' }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
} finally { await new Promise((resolve) => server.close(resolve)); }

const output = path.join(root, 'handoff/quality/ci-peripheral-contract-simulation-latest.json');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ status: 'PASS', sourceFingerprint: sourceFingerprint(root).value, checks, simulatedOnly: true, productionTouched: false, physicalAcceptance: 'PENDING', providerCertification: 'PENDING' }, null, 2) + '\n');
console.log(`CI PERIPHERAL CONTRACT SIMULATION PASS — ${checks.length}/${checks.length} scenarios; no physical hardware/provider contacted.`);
