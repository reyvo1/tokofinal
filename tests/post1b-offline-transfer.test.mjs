import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const service = read('apps/api/src/branch-continuity/branch-transfer.service.ts');
const controller = read('apps/api/src/branch-continuity/branch-transfer.controller.ts');
const inventory = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma']
  .map((f) => ({ name: f, src: read(`apps/api/prisma/${f}`) }));

// POST-1B — offline inter-branch transfer.
//
// The accounting rule this file defends: goods that have left the source are IN_TRANSIT, which is
// what shipTransfer already does. A branch that is unreachable is a reason for the acknowledgement to
// wait, never a reason to post stock into the destination as though it arrived.
//
// The most important assertion in this file is the negative one at the bottom: that adding offline
// tracking did NOT modify the existing StockTransfer lifecycle. That lifecycle is shared with the
// rest of the inventory module, and a "helpful" enum addition would be a silent cross-module break.

// ---------------------------------------------------------------- additive only

test('the existing StockTransfer lifecycle is not modified by this wave', () => {
  // If someone adds an OFFLINE state to StockTransferStatus or rewrites receiveTransfer, this fails.
  // The offline dimension lives in BranchTransferSync instead, precisely so the shared lifecycle is
  // untouched.
  assert.match(read('apps/api/prisma/schema.prisma'), /enum StockTransferStatus \{\s*DRAFT\s+REQUESTED\s+APPROVED\s+PICKING\s+SHIPPED\s+PARTIALLY_RECEIVED\s+RECEIVED\s+REJECTED\s+CANCELLED\s*\}/);
  assert.match(inventory, /if \(transfer\.status !== 'APPROVED'\) throw new BadRequestException\('Transfer harus disetujui sebelum dikirim\.'\)/);
  assert.match(inventory, /if \(!\['SHIPPED','PARTIALLY_RECEIVED'\]\.includes\(transfer\.status\)\) throw new BadRequestException\('Transfer belum dikirim atau sudah selesai\.'\)/);
  // The offline service must not post inventory itself. It records the acknowledgement and leaves
  // posting to receiveTransfer.
  const body = service.slice(service.indexOf('async acknowledgeArrival('), service.indexOf('async listPending('));
  assert.doesNotMatch(body, /inventory\.(create|update|upsert)|inventoryMovement\.create/, 'this service must never move stock itself');
  assert.doesNotMatch(service, /postOperationalEvent|accounting\./, 'accounting stays with the existing ship/receive path');
});

test('the sync model exists in every schema with the same body', () => {
  for (const { name, src } of schemas) {
    assert.ok(src.includes('model BranchTransferSync {'), `${name} must declare BranchTransferSync`);
  }
  const bodies = schemas.map(({ src }) => src.slice(src.indexOf('model BranchTransferSync {')));
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[0], bodies[2]);
  // One row per transfer: re-registering a departure must replay, not duplicate.
  assert.match(schemas[0].src, /model BranchTransferSync \{[\s\S]*@@unique\(\[transferId\]\)/);
});

// ---------------------------------------------------------------- departure

test('a departure is recorded even when the destination branch is unreachable', () => {
  // This is the whole point of the wave. The source operator has goods in a van and a branch that
  // will not answer; the record must still exist.
  assert.match(service, /const destinationNode = await this\.prisma\.syncNode\.findFirst\(\{ where: \{ companyId: scope\.companyId, branchId: destination\.branchId, isActive: true \} \}\);/);
  assert.match(service, /destinationNodeId: destinationNode\?\.id \?\? null,/);
  assert.match(service, /destinationReachable: Boolean\(destinationNode\)/);
  // No branch anywhere in the method may require the destination to answer.
  const body = service.slice(service.indexOf('async registerDeparture('), service.indexOf('async acknowledgeArrival('));
  assert.doesNotMatch(body, /destinationNode\.lastHeartbeatAt|Date\.now\(\) - .*destinationNode/, 'departure must not depend on destination liveness');
});

test('only a shipped transfer may have a departure', () => {
  // Recording one earlier would claim goods are in the van while they are still on the shelf.
  assert.match(service, /if \(transfer\.status !== 'SHIPPED' && transfer\.status !== 'PARTIALLY_RECEIVED'\) \{[\s\S]*throw new BadRequestException\(`Transfer berstatus \$\{transfer\.status\}; baru SHIPPED atau PARTIALLY_RECEIVED yang punya catatan keberangkatan\.`\)/);
});

test('the departure event id is derived from the transfer, so only a duplicate retry is suppressed', () => {
  assert.match(service, /const shippedEventId = `stock-transfer-shipped:\$\{transferId\}`;/);
  // Stable event identity makes replay safe, but only P2002 is a replay. Database/network failures
  // must still fail the departure registration instead of silently dropping its sync outbox event.
  const departure = service.slice(service.indexOf('async registerDeparture('), service.indexOf('async acknowledgeArrival('));
  assert.match(departure, /syncOutbox\.create\([\s\S]*P2002[\s\S]*return undefined[\s\S]*throw error/);
});

test('departure refuses a transfer from another tenant or branch', () => {
  // Warehouse has no companyId — tenant arrives through branchId. Getting this wrong would let a
  // legitimate-looking transfer id cross a tenant boundary.
  assert.match(service, /if \(source\.branchId && scope\.branchId && source\.branchId !== scope\.branchId\) \{[\s\S]*throw new ForbiddenException\('Transfer ini bukan milik branch aktif Anda\.'\)/);
  assert.match(service, /const owners = await this\.prisma\.branch\.findMany\(\{ where: \{ id: \{ in: branchIds \} \}, select: \{ id: true, companyId: true \} \}\);[\s\S]*if \(owners\.some\(\(b\) => b\.companyId !== scope\.companyId\)\) \{[\s\S]*throw new NotFoundException\('Transfer tidak ditemukan pada tenant ini\.'\)/);
});

// ---------------------------------------------------------------- arrival

test('only the receiving branch may acknowledge arrival', () => {
  // Otherwise a branch could confirm goods arriving somewhere else, and the real destination would
  // never learn its stock never arrived.
  assert.match(service, /if \(destination\?\.branchId && scope\.branchId && destination\.branchId !== scope\.branchId\) \{[\s\S]*throw new ForbiddenException\('Hanya cabang tujuan yang dapat mengonfirmasi kedatangan\.'\)/);
});

test('a quantity mismatch is DISCREPANT and never silently reconciled', () => {
  // This is the case the whole design refuses to paper over: the paperwork says one thing and the
  // counting says another. Auto-reconciling it is how a branch runs out of stock that the ledger
  // says it has.
  assert.match(service, /const state = dto\.receivedQuantity === row\.sourceQuantity \? 'CONVERGED' : 'DISCREPANT';/);
  assert.match(service, /discrepancyReason: state === 'DISCREPANT' \? `Kirim \$\{row\.sourceQuantity\}, terima \$\{dto\.receivedQuantity\}\. \$\{dto\.note \?\? ''\}`\.trim\(\) : null,/);
  assert.match(service, /state === 'CONVERGED' \? 'BRANCH_TRANSFER_ACKED' : 'BRANCH_TRANSFER_DISCREPANT'/);
});

test('an arrival cannot be confirmed twice', () => {
  assert.match(service, /if \(row\.destinationAckedAt\) throw new BadRequestException\('Kedatangan transfer ini sudah pernah dikonfirmasi\.'\)/);
});

test('receiving zero after a departure is refused, with a named alternative', () => {
  // "Nothing arrived" is a real answer, but it is not an acknowledgement of a shipment that left with
  // goods in it. The error points at the actual operation instead of leaving a dead end.
  assert.match(service, /if \(dto\.receivedQuantity === 0 && row\.sourceQuantity > 0\) \{[\s\S]*throw new BadRequestException\('Jumlah diterima nol tidak sah untuk transfer yang sudah berangkat; gunakan pembatalan dengan alasan\.'\)/);
  assert.match(service, /if \(!Number\.isInteger\(dto\.receivedQuantity\) \|\| dto\.receivedQuantity < 0\) \{[\s\S]*throw new BadRequestException\('Jumlah diterima harus bilangan bulat non-negatif\.'\)/);
});

// ---------------------------------------------------------------- abandon

test('no automatic timeout returns goods to the source', () => {
  // The source has already decremented and the serials are IN_TRANSIT. Guessing where they are is how
  // stock goes missing permanently, so abandonment is explicit and always attributed.
  assert.doesNotMatch(service, /setTimeout|scheduler|cron|autoAbandon/, 'abandonment must be a human decision');
  assert.match(service, /if \(!reason\?\.trim\(\)\) throw new BadRequestException\('Pembatalan transfer lintas cabang wajib disertai alasan\.'\)/);
  assert.match(service, /Stok tetap IN_TRANSIT di gudang asal sampai jurnal pengembalian dibuat/);
  // A confirmed transfer cannot be quietly unwound here; that is a journal, not a status change.
  assert.match(service, /if \(row\.destinationAckedAt\) throw new BadRequestException\('Transfer yang sudah dikonfirmasi kedatangan tidak dapat dibatalkan di sini; reversal dilakukan lewat jurnal\.'\)/);
});

// ---------------------------------------------------------------- visibility and access

test('a pending transfer is visible, because it is stock in neither place', () => {
  assert.match(service, /where: \{ companyId: scope\.companyId, state: \{ in: \['AWAITING_DESTINATION', 'DISCREPANT'\] \} \}/);
  // The operator also needs to see WHY it is still pending, which is the destination's state.
  assert.match(service, /destinationState: state/);
});

test('every transfer route is permission gated and none is a public peer route', () => {
  // Acknowledging that goods arrived is tenant administration. A branch that could acknowledge
  // another's stock would make the transfer ledger meaningless.
  //
  // The permission is integration.manage, not inventory.transfer, and that is deliberate: the panel
  // lives in the settings workspace, whose gate grants integration.manage. Widening the settings gate
  // instead would hand every settings operator inventory write access product-wide. The wider
  // permission buys visibility and an audited status change only — the service contains no inventory
  // write, and a test below asserts that.
  const parts = controller.split(/@(Get|Post)\(/).slice(2);
  const bodies = parts.filter((_, i) => i % 2 === 0);
  assert.ok(bodies.length >= 5, `expected the full transfer surface, found ${bodies.length} handlers`);
  for (const body of bodies) {
    assert.match(body, /@Permissions\('integration\.manage'\)/);
    assert.doesNotMatch(body, /^\s*@Public\(\)\s*$/m, `${body.slice(0, 40)} must not be a public peer route`);
  }
  // Count decorator-position occurrences only: the header comment names @Public() while explaining
  // why these routes are NOT public, and a naive substring count reports a false positive.
  const publics = controller.match(/^\s*@Public\(\)\s*$/gm)?.length ?? 0;
  assert.equal(publics, 0, 'no transfer route may be public; they are tenant administration');
});
