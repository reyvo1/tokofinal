import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pos = readFileSync(new URL('../apps/pos/app/page.tsx', import.meta.url), 'utf8');
const products = readFileSync(new URL('../apps/api/src/products/products.service.ts', import.meta.url), 'utf8');
const master = readFileSync(new URL('../apps/api/src/master-data/master-data.service.ts', import.meta.url), 'utf8');

test('product catalog exposes alternate barcodes and POS exact scan uses quantityFactor', () => {
  assert.match(products, /barcodes:\s*\{ orderBy:/);
  assert.match(pos, /quantityFactor\?: string \| number/);
  assert.match(pos, /function scanExactBarcode/);
  assert.match(pos, /alternate\?\.quantityFactor \?\? 1/);
  assert.match(pos, /add\(product, 1, \{ unitCode:/);
  assert.match(pos, /e\.key === 'Enter'/);
});

test('fractional alternate-unit barcode fails closed instead of rounding inventory silently', () => {
  assert.match(master, /normalizedFactor/);
  assert.match(master, /Number\.isSafeInteger\(factor\)/);
  assert.match(pos, /!Number\.isSafeInteger\(factor\) \|\| factor <= 0/);
  assert.match(pos, /tidak dapat diposting sebagai stok integer/);
});
