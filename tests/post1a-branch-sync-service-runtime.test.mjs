// POST-1A: the sync pipeline executed, not a helper that imitates it.
//
// `post1a-topology-evidence.test.mjs` proves its own `deliver()` function: it inserts into SyncInbox
// with raw SQL and decides by itself what "applied" means. That is a fine way to show the SHAPE of a
// three-node topology, and it is the reason acceptance items #1/#3/#4/#5 sat at PARTIAL — a defect
// inside `receiveEvents` would have left it green.
//
// Loading the real service and running it against three pushed SQLite databases closes that gap. Four
// defects were found this way, all of which every existing gate reported as healthy:
//
//   1. `receiveEvents` never advanced the aggregate watermark, so `detectConflict` compared every
//      write against version 0 — a sequential write read as a conflict, permanently.
//   2. `syncHealth.duplicatesSuppressed` counted SyncInbox rows with outcome DUPLICATE. A duplicate is
//      suppressed BY the (nodeId, eventId) unique constraint, so no such row is ever created and the
//      operator panel showed a permanent 0 next to the label "Duplikat ditekan".
//   3. `publishEvents` validated `event.schemaVersion` from the ACK body, but SyncEventDto marks that
//      field @IsOptional — the documented minimal `{eventId}` ack was rejected with a 400.
//   4. `advanceCursor` stored an eventId in `lastEventId`, and `pullEvents` fed it to `Date.parse`.
//      NaN collapsed to `new Date(0)`, so the stored cursor meant "from the beginning of time" and a
//      peer that sent no cursor re-read the node's entire outbox on every pull.
//
// Fixture notes that cost time, kept so the next run does not rediscover them:
//   - Each database is a separate server: its own row ids AND its own copy of the node registry.
//     Central's id is meaningless inside Bandung's database.
//   - Fixture order is User → Company → Branch → SyncNode. SyncNode.branchId is an FK to Branch and
//     Branch.companyId is an FK to Company; skipping a level fails as a Prisma FK error, which reads
//     like a service defect rather than a fixture one.
//   - AuditLog.userId references User. Without a real User row the service's own `.catch` swallows
//     every audit write, and the audit evidence this suite asserts on is silently absent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't360-p1a-service-'));

const DBS = {
  central: path.join(TMP, 'central.db'),
  bandung: path.join(TMP, 'bandung.db'),
  surabaya: path.join(TMP, 'surabaya.db'),
};
for (const db of Object.values(DBS)) {
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', prismaFml],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${db}` }, encoding: 'utf8', stdio: 'pipe' });
}

const { BranchSyncService } = await load('apps/api/src/branch-sync/branch-sync.service.ts',
  { platform: 'node', external: ['@prisma/client'] });

// SecretProtector only seals a peer secret, and sealSecret() passes an already-braced value straight
// through, so a no-key stub is faithful here. Authentication itself is exercised elsewhere.
const secrets = { encryptText: (s) => s, decryptText: (s) => s };
const clients = {};
const svc = {};
for (const name of Object.keys(DBS)) {
  clients[name] = new PrismaClient({ datasources: { db: { url: `file:${DBS[name]}` } } });
  svc[name] = new BranchSyncService(clients[name], secrets);
}

const COMPANY = 'acme';
const OPERATOR = 'sync-operator';
const user = (branchId = null) => ({ sub: OPERATOR, companyId: COMPANY, branchId, roles: ['ADMIN'] });

// ids[database][code] — never a bare id map.
const ids = {};
const CODE_OF = { central: 'CENTRAL', bandung: 'BR-01', surabaya: 'BR-02' };
const DEFS = [['CENTRAL', 'CENTRAL', null], ['BR-01', 'BRANCH', 'br-1'], ['BR-02', 'BRANCH', 'br-2']];

for (const name of Object.keys(DBS)) {
  await clients[name].user.create({ data: { id: OPERATOR, name: 'Sync Operator', email: `${name}@sync.test`, passwordHash: 'x', isActive: true } });
  await clients[name].company.create({ data: { id: COMPANY, name: 'Acme', timezone: 'Asia/Makassar', currency: 'IDR' } });
  await clients[name].branch.create({ data: { id: 'br-1', companyId: COMPANY, code: 'BR1', name: 'Cabang 1', isActive: true } });
  await clients[name].branch.create({ data: { id: 'br-2', companyId: COMPANY, code: 'BR2', name: 'Cabang 2', isActive: true } });
  ids[name] = {};
  for (const [code, role, branchId] of DEFS) {
    const node = await svc[name].registerNode(user(branchId), { code, name: code, role, branchId: branchId ?? undefined, protocolVersion: 1 });
    ids[name][code] = node.id;
  }
  // Every node holds every peer, because a branch server authenticates against the full registry.
  const peers = name === 'central' ? ['BR-01', 'BR-02'] : ['CENTRAL'];
  for (const peer of peers) {
    await svc[name].registerPeer(user(), ids[name][CODE_OF[name]], { peerNodeId: ids[name][peer], direction: 'BIDIRECTIONAL', sharedSecretRef: '{sealed}' });
  }
}

const me = (name) => ids[name][CODE_OF[name]];
/** The wire shape a peer POSTs to /receive. */
const wire = (e) => ({
  eventId: e.eventId, aggregateType: e.aggregateType, aggregateId: e.aggregateId,
  eventType: e.eventType, schemaVersion: e.schemaVersion, payload: e.payload,
});
/** The full wire round trip: the owner serves the pull, the peer receives and acks. */
async function deliver(from, to, eventId, aggregateId, baseVersion, total) {
  await svc[from].enqueueEvent(user(CODE_OF[from] === 'CENTRAL' ? null : `br-${from === 'bandung' ? 1 : 2}`), me(from), {
    eventId, aggregateType: 'Sale', aggregateId, eventType: 'SALE_CREATED', schemaVersion: 1,
    payload: { total, baseVersion },
  });
  const pulled = await svc[from].pullEvents(user(CODE_OF[from] === 'CENTRAL' ? null : `br-${from === 'bandung' ? 1 : 2}`), me(from), { peerNodeId: ids[from]['CENTRAL'], limit: 200 });
  const batch = pulled.events.filter((e) => e.eventId === eventId).map(wire);
  const received = await svc[to].receiveEvents(user(), me(to), ids[to][CODE_OF[from]], batch);
  return { pulled, received };
}

test.after(async () => { await Promise.all(Object.values(clients).map((c) => c.$disconnect())); });

// ---------------------------------------------------------------- topology

test('three separate databases each hold the full node registry', async () => {
  for (const name of Object.keys(DBS)) {
    const rows = await svc[name].listNodes(user());
    assert.equal(rows.length, 3, `${name} must know all three nodes, got ${rows.length}`);
  }
  assert.equal(new Set(Object.values(DBS)).size, 3, 'three nodes means three separate databases');
});

test('a tenant may not register a second active CENTRAL', async () => {
  // Runs the real uniqueness check. A second host would consolidate and double-post every event.
  await assert.rejects(
    () => svc.central.registerNode(user(), { code: 'CENTRAL-B', name: 'Central dua', role: 'CENTRAL', protocolVersion: 1 }),
    (e) => /sudah punya node CENTRAL aktif/.test(e.message),
    'a second CENTRAL must be refused, not silently registered',
  );
});

// ---------------------------------------------------------------- delivery

test('a branch event reaches central through the real service and applies exactly once', async () => {
  const { received } = await deliver('bandung', 'central', 'sale-rt-001', 'S-001', 0, 250000);
  assert.equal(received.applied, 1, `expected one applied, got ${JSON.stringify(received.results)}`);
  assert.equal(await clients.central.syncInbox.count({ where: { nodeId: me('central'), eventId: 'sale-rt-001' } }), 1);
});

test('a replayed delivery is refused without a second posting', async () => {
  const again = await svc.central.receiveEvents(user(), me('central'), ids.central['BR-01'], [
    wire({ eventId: 'sale-rt-001', aggregateType: 'Sale', aggregateId: 'S-001', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 250000, baseVersion: 0 } }),
  ]);
  assert.equal(again.applied, 0);
  assert.equal(again.duplicates, 1, 'the replay must be classified DUPLICATE');
  assert.equal(await clients.central.syncInbox.count({ where: { nodeId: me('central'), eventId: 'sale-rt-001' } }), 1, 'no second inbox row');
});

test('two branches transacting while partitioned both land on central, once each', async () => {
  // The partition is the absence of delivery: each branch enqueues, and central sees neither until
  // each is pulled explicitly.
  await svc.bandung.enqueueEvent(user('br-1'), me('bandung'), {
    eventId: 'sale-part-b', aggregateType: 'Sale', aggregateId: 'S-200', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 75000, baseVersion: 5 },
  });
  await svc.surabaya.enqueueEvent(user('br-2'), me('surabaya'), {
    eventId: 'sale-part-s', aggregateType: 'Sale', aggregateId: 'S-300', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 90000, baseVersion: 7 },
  });
  assert.equal(await clients.central.syncInbox.count({ where: { eventId: 'sale-part-b' } }), 0, 'central must not see a partitioned event yet');
  assert.equal(await clients.central.syncInbox.count({ where: { eventId: 'sale-part-s' } }), 0);

  // Reconnect: each branch serves its own pull, central receives from each.
  const fromB = await svc.bandung.pullEvents(user('br-1'), me('bandung'), { peerNodeId: ids.bandung.CENTRAL, limit: 200 });
  const fromS = await svc.surabaya.pullEvents(user('br-2'), me('surabaya'), { peerNodeId: ids.surabaya.CENTRAL, limit: 200 });
  const b = await svc.central.receiveEvents(user(), me('central'), ids.central['BR-01'], fromB.events.map(wire));
  const s = await svc.central.receiveEvents(user(), me('central'), ids.central['BR-02'], fromS.events.map(wire));
  assert.equal(b.applied + s.applied, 2, `both partitioned sales must converge, got ${JSON.stringify([b, s])}`);
  assert.equal(await clients.central.syncInbox.count({ where: { eventId: { in: ['sale-part-b', 'sale-part-s'] } } }), 2);
});

test('replaying every event both branches produced changes nothing on central', async () => {
  const snapshot = () => clients.central.syncInbox.findMany({ where: { nodeId: me('central') }, orderBy: { eventId: 'asc' } })
    .then((rows) => rows.map((r) => `${r.eventId}:${r.outcome}`));
  const before = await snapshot();
  assert.ok(before.length > 0, 'the snapshot must be non-empty, or "unchanged" is vacuous');

  for (const [branch, nodeId] of [['bandung', 'BR-01'], ['surabaya', 'BR-02']]) {
    const pulled = await svc[branch].pullEvents(user(`br-${branch === 'bandung' ? 1 : 2}`), me(branch), { peerNodeId: ids[branch].CENTRAL, limit: 200 });
    await svc.central.receiveEvents(user(), me('central'), ids.central[nodeId], pulled.events.map(wire));
  }
  assert.deepEqual(await snapshot(), before, 'a full replay must not change central state');
});

test('applying an event advances the watermark detectConflict reads', async () => {
  // The defect: receiveEvents wrote the inbox row and stopped. detectConflict then compared every
  // write against version 0 forever, so a strictly sequential write read as a conflict and a real one
  // read as a conflict for the wrong reason.
  const { received } = await deliver('bandung', 'central', 'sale-wm-001', 'S-400', 12, 50000);
  assert.equal(received.applied, 1);

  const watermark = await clients.central.syncAggregateVersion.findFirst({ where: { nodeId: me('central'), aggregateType: 'Sale', aggregateId: 'S-400' } });
  assert.ok(watermark, 'applying an event must leave a watermark behind');
  assert.equal(watermark.version, 12, `watermark must equal the applied baseVersion, got ${watermark.version}`);

  // And a writer that agrees with the observed version is not in conflict.
  await svc.central.enqueueEvent(user(), me('central'), {
    eventId: 'sale-wm-002', aggregateType: 'Sale', aggregateId: 'S-400', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 51000, baseVersion: 12 },
  });
  const agreed = await svc.central.detectConflict(user(), me('central'), 'sale-wm-002');
  assert.equal(agreed.observedVersion, 12);
  assert.equal(agreed.conflicted, false, 'a write built on the version actually observed is not a conflict');

  // A stale writer still is — that is the control working, not noise.
  await svc.central.enqueueEvent(user(), me('central'), {
    eventId: 'sale-wm-003', aggregateType: 'Sale', aggregateId: 'S-400', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 52000, baseVersion: 9 },
  });
  const stale = await svc.central.detectConflict(user(), me('central'), 'sale-wm-003');
  assert.equal(stale.conflicted, true, 'a write built on version 9 while 12 is observed must be a conflict');
});

test('the watermark never regresses when a stale event arrives late', async () => {
  const { received } = await deliver('surabaya', 'central', 'sale-wm-old', 'S-400', 3, 1000);
  assert.equal(received.applied, 1);
  const after = await clients.central.syncAggregateVersion.findFirst({ where: { nodeId: me('central'), aggregateType: 'Sale', aggregateId: 'S-400' } });
  assert.equal(after.version, 12, `a late version 3 must not lower the watermark, got ${after.version}`);
});

// ---------------------------------------------------------------- observability

test('duplicatesSuppressed counts what was actually suppressed', async () => {
  // The defect: it counted SyncInbox rows with outcome DUPLICATE. A duplicate is suppressed BY the
  // unique constraint, so no such row exists and the operator panel showed a permanent 0.
  const before = (await svc.central.syncHealth(user())).nodes.find((n) => n.code === 'CENTRAL').duplicatesSuppressed;
  const batch = [
    wire({ eventId: 'sale-dup-001', aggregateType: 'Sale', aggregateId: 'S-500', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 1000, baseVersion: 0 } }),
    wire({ eventId: 'sale-dup-002', aggregateType: 'Sale', aggregateId: 'S-501', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 2000, baseVersion: 0 } }),
  ];
  const first = await svc.central.receiveEvents(user(), me('central'), ids.central['BR-01'], batch);
  assert.equal(first.applied, 2);
  assert.equal(first.duplicates, 0);

  const replay = await svc.central.receiveEvents(user(), me('central'), ids.central['BR-01'], batch);
  assert.equal(replay.duplicates, 2, 'both replays are duplicates');

  const after = (await svc.central.syncHealth(user())).nodes.find((n) => n.code === 'CENTRAL').duplicatesSuppressed;
  assert.equal(after, before + 2, `duplicatesSuppressed must move by the number suppressed, got ${before} -> ${after}`);
});

test('every applied delivery writes an audit row naming the origin peer', async () => {
  const rows = await clients.central.auditLog.findMany({ where: { action: 'SYNC_EVENTS_RECEIVED' }, orderBy: { createdAt: 'asc' } });
  assert.ok(rows.length > 0, 'no SYNC_EVENTS_RECEIVED audit rows at all');
  const latest = rows.at(-1);
  assert.equal(latest.payload.peer, 'BR-01', 'the audit row must name the peer the event came from');
  assert.ok(Array.isArray(latest.payload.outcomes), 'outcomes must be recorded, not summarised away');
});

// ---------------------------------------------------------------- ack + cursor

test('a minimal ack is accepted, as SyncEventDto promises', async () => {
  // The defect: publishEvents validated event.schemaVersion from the body, but that field is
  // @IsOptional on the DTO, so the documented minimal ack was rejected with a 400.
  await svc.central.enqueueEvent(user(), me('central'), {
    eventId: 'sale-ack-001', aggregateType: 'Sale', aggregateId: 'S-600', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 3000, baseVersion: 0 },
  });
  const acked = await svc.central.publishEvents(user(), me('central'), { events: [{ eventId: 'sale-ack-001' }] });
  assert.equal(acked.acknowledged, 1, `the minimal ack must work, got ${JSON.stringify(acked)}`);
  assert.equal((await clients.central.syncOutbox.findFirst({ where: { eventId: 'sale-ack-001' } })).status, 'PUBLISHED');
});

test('the stored cursor is a position pullEvents can compare against', async () => {
  // The defect: advanceCursor stored an eventId in lastEventId and pullEvents fed it to Date.parse.
  // NaN collapsed to new Date(0), so every stored cursor meant "from the beginning of time".
  const row = await clients.central.syncCursor.findFirst({ where: { nodeId: me('central') } });
  assert.ok(row, 'no cursor row was written');
  assert.ok(row.cursor, 'the `cursor` column must hold a position');
  assert.ok(!Number.isNaN(Date.parse(row.cursor)), `cursor must parse as a date, got ${row.cursor}`);
  assert.equal(row.lastEventId, 'sale-ack-001', 'lastEventId stays the readable identity of the acked event');
});

test('a second ack moves the stored cursor forward', async () => {
  // advanceCursor has TWO write paths — create on the first ack, update on every ack after that. A suite
  // that only ever acked once exercised create and proved nothing about update: deleting `cursor:` from
  // the update data left it green, because the row the assertion read was the one create had written.
  // A negative control that stays green is not approval — it means the test is the part that is wrong.
  //
  // So: ack a second, later event and require the SAME row to have moved forward.
  await svc.central.enqueueEvent(user(), me('central'), {
    eventId: 'sale-ack-002', aggregateType: 'Sale', aggregateId: 'S-601', eventType: 'SALE_CREATED', schemaVersion: 1, payload: { total: 4000, baseVersion: 0 },
  });
  const before = await clients.central.syncCursor.findFirst({ where: { nodeId: me('central') } });
  const acked = await svc.central.publishEvents(user(), me('central'), { events: [{ eventId: 'sale-ack-002' }] });
  assert.equal(acked.acknowledged, 1, `the minimal ack must work on the update path too, got ${JSON.stringify(acked)}`);

  const after = await clients.central.syncCursor.findFirst({ where: { nodeId: me('central') } });
  assert.equal(after.id, before.id, 'the same cursor row must be updated, not a second one created');
  assert.equal(after.lastEventId, 'sale-ack-002', 'lastEventId must name the event just acked');
  assert.ok(after.cursor, 'the update path must also write a position');
  assert.ok(!Number.isNaN(Date.parse(after.cursor)), `cursor must parse as a date, got ${after.cursor}`);
  assert.notEqual(after.cursor, before.cursor, 'a second ack at a later time must move the stored position');
  assert.ok(
    Date.parse(after.cursor) >= Date.parse(before.cursor),
    `the stored position must not go backwards: ${before.cursor} -> ${after.cursor}`,
  );
});

test('a delivery signed by one peer but claiming another is refused', async () => {
  // The controller always passes this.auth, so the service's identity cross-check is the last line:
  // a valid signature from peer A that names peer B in the body must not be accepted, or a branch
  // could post events under another branch's identity.
  // The stub signs as BR-02 while the body names BR-01: the mismatch the cross-check exists for.
  const authAsOtherPeer = { authenticate: async () => ({ companyId: COMPANY, nodeId: ids.central['BR-02'], peerNodeId: ids.central['BR-02'], peerId: 'x' }) };
  await assert.rejects(
    () => svc.central.receiveEvents(user(), me('central'), ids.central['BR-01'], [
      wire({ eventId: 'sale-imp-001', aggregateType: 'Sale', aggregateId: 'S-700', eventType: 'SALE_CREATED', schemaVersion: 1, payload: {} }),
    ], authAsOtherPeer, { 'x-toko360-signature': 'a'.repeat(64), 'x-toko360-node-code': 'BR-02', 'x-toko360-peer-node-code': 'CENTRAL', 'x-toko360-timestamp': new Date().toISOString(), 'x-toko360-nonce': 'nonce-abcdefghijklmnop' }),
    (e) => /signature tidak cocok dengan peerNodeId pada body/.test(e.message),
    'a signature from one peer naming another in the body must be refused',
  );
  assert.equal(await clients.central.syncInbox.count({ where: { eventId: 'sale-imp-001' } }), 0, 'nothing may be written');

  await assert.rejects(
    () => svc.central.publishEvents(user(), me('central'), { events: [{ eventId: 'sale-does-not-exist' }] }),
    (e) => /tidak ada pada outbox/.test(e.message),
    'acking an event this node never queued must be refused, not silently accepted',
  );
});

test('a schemaVersion the receiver cannot interpret is refused, not applied', async () => {
  const res = await svc.central.receiveEvents(user(), me('central'), ids.central['BR-02'], [
    wire({ eventId: 'sale-future-001', aggregateType: 'Sale', aggregateId: 'S-800', eventType: 'SALE_CREATED', schemaVersion: 99, payload: { total: 1, baseVersion: 0 } }),
  ]);
  assert.equal(res.rejected, 1, 'an unknown schemaVersion must be rejected');
  assert.equal(res.applied, 0);
  assert.equal(await clients.central.syncInbox.count({ where: { eventId: 'sale-future-001', outcome: 'APPLIED' } }), 0, 'nothing may be applied');
});
