import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pos = read('apps/pos/app/page.tsx');
const sales = read('apps/api/src/sales/sales.service.ts');
const policy = read('apps/api/src/common/tender-policy.ts');

test('offline tender allowlist berasal dari master PAYMENT_METHOD dan policy server', () => {
  assert.match(sales, /this\.tenderDefinitions\(this\.prisma, scope\)/);
  assert.match(sales, /tenderMethods: tenderMethods\.map\(\(item\) => \(\{ code: item\.code, name: item\.name, \.\.\.item\.policy \}\)\)/);
  assert.match(sales, /paymentMethods: tenderMethods\.filter\(\(item\) => item\.policy\.allowOffline\)\.map\(\(item\) => item\.code\)/);
  assert.match(policy, /allowOffline: bool\(source\.allowOffline, fallback\.allowOffline\)/);
});

test('POS merender tender dinamis dan server mengulang validasi policy saat replay offline', () => {
  assert.match(pos, /tenderMethods\.map\(\(item\) => <option key=\{item\.code\}/);
  assert.doesNotMatch(pos, /<option value="(?:CASH|QRIS|TRANSFER|CARD)"/);
  assert.match(pos, /disabled=\{!apiOnline && !item\.allowOffline\}/);
  assert.match(pos, /splitEnabled \|\| normalizedOnAccount > 0 \|\| !activeTender\?\.allowOffline/);
  assert.match(sales, /const offlineTender = offlineTenderMap\.get\(offlineMethod\)/);
  assert.match(sales, /!offlineTender \|\| !offlineTender\.policy\.allowOffline/);
  assert.match(sales, /offlineTender\.policy\.requiresProvider/);
  assert.match(sales, /offlineTender\.policy\.requiresReference/);
});

test('policy.paymentMethods hanya ringkasan compatibility; keputusan POS memakai tenderMethods lengkap', () => {
  const typeDecl = pos.indexOf('paymentMethods: string[]');
  assert.ok(typeDecl > -1, 'OfflineConfig tetap mengekspos paymentMethods untuk kompatibilitas API');
  const afterType = pos.slice(typeDecl + 1);
  assert.equal([...afterType.matchAll(/policy\.paymentMethods/g)].length, 0);
  assert.match(pos, /const \[tenderMethods, setTenderMethods\] = useState<OfflineTenderMethod\[]>/);
  assert.match(pos, /setTenderMethods\(offlineConfig\.tenderMethods/);
});
