import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const controller = read('apps/api/src/sales/sales.controller.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const dto = read('apps/api/src/sales/dto/create-sale.dto.ts');
const pos = read('apps/pos/app/page.tsx');
const offline = read('apps/pos/lib/offline.ts');
const sw = read('apps/pos/public/sw.js');

test('POS offline replay is exposed through the same sales domain', () => {
  assert.match(controller, /@Get\('offline\/config'\)/);
  assert.match(controller, /@Post\('offline\/replay'\)/);
  assert.match(controller, /@Permissions\('sale\.create'\)/);
  assert.match(dto, /class OfflineSaleReplayItemDto/);
  assert.match(dto, /expectedTotal/);
  assert.match(dto, /@ArrayMaxSize\(100\)/);
  assert.match(sales, /await this\.create\(normalizedPayload, user,/);
});

test('offline replay is tenant/device scoped and uses an atomic processing lease', () => {
  assert.match(sales, /companyId_code: \{ companyId: scope\.companyId, code: dto\.deviceCode \}/);
  assert.match(sales, /existing\?\.branchId && existing\.branchId !== scope\.branchId/);
  assert.match(sales, /status: 'PROCESSING', OR: \[\{ processedAt: null \}, \{ processedAt: \{ lte: leaseCutoff \} \}\]/);
  assert.match(sales, /where: \{ id: receipt\.id, status: 'PROCESSING' \}/);
  assert.match(sales, /existing\.status === 'APPLIED'/);
});

test('offline sales preserve original business time and reject unsafe payment assumptions', () => {
  assert.match(sales, /const offlineMethod = \(offlinePayments\[0\]\?\.method \?\? normalizedPayload\.paymentMethod \?\? 'CASH'\)/);
  assert.match(sales, /!offlineTender \|\| !offlineTender\.policy\.allowOffline/);
  assert.match(sales, /OFFLINE_LOYALTY_REDEEM_NOT_ALLOWED/);
  assert.match(sales, /createdAt: occurredAt/);
  assert.match(sales, /paidAt: occurredAt/);
  assert.match(sales, /businessDate: occurredAt/);
  assert.match(sales, /OFFLINE_CAPTURE_BEFORE_SHIFT/);
  assert.match(sales, /const businessOccurredAt = beforeShiftMs > 0 \? replayShift\.openedAt : occurredAt/);
  assert.match(sales, /issueDate: occurredAt, taxPeriod: occurredAt\.toISOString\(\)\.slice\(0, 7\)/);
});

test('server validates the amount captured offline before creating a sale', () => {
  assert.match(sales, /const serverQuote = await this\.quote\(normalizedPayload, user\)/);
  assert.match(sales, /Math\.abs\(serverTotal - item\.expectedTotal\) > 0\.01/);
  assert.match(sales, /OFFLINE_TOTAL_CHANGED/);
  assert.match(sales, /idempotencyKey: item\.payload\.idempotencyKey\?\.trim\(\) \|\| `offline-sale:/);
});

test('POS caches safe data, reserves queued stock and replays without dropping conflicts', () => {
  // Asserted by INTENT, not by identifier. This line used to require the literal
  // `saveOfflineSnapshot`, which locked the old localStorage blob in place: renaming the writer to
  // the IndexedDB-backed `persistOfflineSnapshot` broke the test even though the POS now survives
  // a catalog too large for localStorage. A name is not a behaviour.
  assert.match(pos, /loadOfflineSnapshot/);
  assert.match(pos, /persistOfflineSnapshot/);
  // And the outcome has to be checked, or a full disk silently disables offline capability.
  assert.match(pos, /if \(!stored\.ok\)/);
  assert.match(pos, /reservedOfflineQuantity\(offlineQueue, warehouseId, product\.id\)/);
  assert.match(pos, /queueSaleOffline\(replayPayload, Number\(activeQuote\.total\)/);
  assert.match(pos, /result\.status === 'APPLIED'\) return \[\]/);
  assert.match(pos, /status: 'CONFLICT' as const/);
  assert.match(pos, /offlineQueue\.length > 0/);
  assert.match(offline, /toko360_pos_offline_queue_v1/);
  assert.match(offline, /Aturan pajak produk belum tersimpan untuk mode offline/);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /caches\.match\('\/'\)/);
});

test('offline queue is cashier-owned, cache-bounded, and enabled by default without caching API responses', () => {
  const seed = read('apps/api/prisma/seed.ts');
  const catalog = read('docs/FEATURE-CATALOG.md');
  assert.match(offline, /cashierSub: string/);
  assert.match(offline, /clockOffsetMs\?: number/);
  assert.match(pos, /item\.cashierSub === activeSub/);
  assert.match(pos, /Login kembali dengan kasir yang sama/);
  assert.match(pos, /Login dengan kasir asal untuk menyinkronkan/);
  assert.match(pos, /Date\.now\(\) \+ offlineClockOffsetMs/);
  assert.match(pos, /Transaksi BELUM masuk antrean offline/);
  assert.match(sales, /POS_OFFLINE_MAX_CACHE_MINUTES/);
  assert.match(sales, /OFFLINE_CONFIG_STALE/);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(seed, /\['pos_offline', true, 'implemented-safe-replay'\]/);
  assert.match(catalog, /\| pos_offline \| on \| implemented-safe-replay \|/);
});
