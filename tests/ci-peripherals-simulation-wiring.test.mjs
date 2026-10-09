import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createProviderSimulator } from '../scripts/ci-provider-simulator.mjs';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sum = (text) => createHash('md5').update(text).digest('hex');

test('both GitHub heavy workflows run the real simulation and fail the mandatory gate if red', () => {
  const full = read('.github/workflows/full-system-simulation.yml');
  const uat = read('.github/workflows/toko360-full-uat.yml');
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['ci:peripherals:simulation'], /node --experimental-strip-types scripts\/ci-peripheral-contract-simulation\.mjs/);
  for (const workflow of [full, uat]) {
    assert.match(workflow, /id: peripheral_sim[\s\S]*?run: npm run ci:peripherals:simulation/);
    assert.match(workflow, /ci-peripheral-contract-simulation-latest\.json|handoff\/quality\//);
  }
  assert.match(uat, /STEP_PERIPHERAL_SIM: \$\{\{ steps\.peripheral_sim\.outcome \}\}/);
  assert.match(uat, /check "POS hardware and Digiflazz protocol simulation" "\$STEP_PERIPHERAL_SIM"/);
  assert.ok(full.indexOf('id: peripheral_sim') < full.indexOf('name: Rehearse expand migrations'), 'must run before runtime-dependent work');
});

test('simulation uses actual production printer/scanner modules; no separate fake implementation', () => {
  const script = read('scripts/ci-peripheral-contract-simulation.mjs');
  assert.match(script, /apps\/pos\/lib\/printing\.ts/);
  assert.match(script, /apps\/pos\/lib\/barcode\.ts/);
  assert.match(script, /printer\.printReceipt\(/);
  assert.match(script, /printer\.openCashDrawer\(/);
  assert.match(script, /scanner\.createBarcodeListener\(/);
  assert.match(script, /providerCertification: 'PENDING'/);
  assert.match(script, /physicalAcceptance: 'PENDING'/);
});

test('unknown CI user or signature is rejected, and first retry with changed payload is refused', async () => {
  const server = createProviderSimulator({ username: 'ci', apiKey: 'fake', allowDigiflazz: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/transaction`;
    const post = async (body) => {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      return res.status;
    };
    const ref_id = 'W3-PERIPHERALS-RETRY';
    const ok = { username: 'ci', customer_no: '0811', buyer_sku_code: 'CI-PLN-SUCCESS', ref_id, sign: sum('cifake' + ref_id) };
    assert.equal(await post({ ...ok, username: 'wrong' }), 401);
    assert.equal(await post({ ...ok, sign: 'bad' }), 401);
    assert.equal(await post(ok), 200);
    assert.equal(await post(ok), 200);
    assert.equal(await post({ ...ok, customer_no: '0822' }), 409);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('simulator disabled by default and handles bad JSON without crashing', async () => {
  const server = createProviderSimulator();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/v1/price-list`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/whatsapp`, { method: 'POST', body: '{broken' })).status, 400);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
