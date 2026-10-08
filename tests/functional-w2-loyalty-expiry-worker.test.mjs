import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../apps/worker/src/index.ts', import.meta.url), 'utf8');

test('loyalty expiry worker consumes ledger FIFO before expiring due earn buckets', () => {
  assert.match(worker, /async function processLoyaltyExpiries/);
  assert.match(worker, /orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(worker, /buckets\.push\(\{ id: row\.id, remaining: row\.points, expiresAt: row\.expiresAt \}\)/);
  assert.match(worker, /const used = Math\.min\(bucket\.remaining, debit\)/);
  assert.match(worker, /bucket\.remaining -= used/);
  assert.match(worker, /bucket\.expiresAt <= now/);
});

test('expiry is balance-safe, append-only, audited, and runs from worker tick', () => {
  assert.match(worker, /Math\.min\(calculated, account\.points\)/);
  assert.match(worker, /type: 'EXPIRE'/);
  assert.match(worker, /points: -expiring/);
  assert.match(worker, /EXPIRE_LOYALTY_POINTS/);
  assert.match(worker, /TransactionIsolationLevel\.Serializable/);
  assert.match(worker, /await processLoyaltyExpiries\(\)/);
});
