import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('browser UAT authenticates POS and requires live cashier/offline-config bootstrap', () => {
  const source = fs.readFileSync('scripts/browser-uat.mjs', 'utf8');
  assert.match(source, /localStorage\.setItem\('toko360_pos_token'/);
  assert.match(source, /POS authenticated cashier shell/);
  assert.match(source, /Gudang\/toko/);
  assert.match(source, /POS online data\/offline-config bootstrap/);
  assert.match(source, /Server online/);
  assert.match(source, /POS_AUTHENTICATED_RUNTIME/);
  assert.match(source, /evidence\.posDiagnostic/);
  assert.match(source, /browserPageDiagnostic/);
});
