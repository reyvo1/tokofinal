import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const service = read('apps/api/src/branch-sync/branch-sync.service.ts');
const controller = read('apps/api/src/branch-sync/branch-sync.controller.ts');
const dto = read('apps/api/src/branch-sync/dto/branch-sync.dto.ts');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma']
  .map((f) => ({ name: f, src: read(`apps/api/prisma/${f}`) }));

// POST-1A — edge topology and sync foundation.
//
// The requirements in docs/TOKO360-POST-COMPLETION-HYBRID-BRANCH-WORKFLOW.md §2 are not optional
// niceties. "Idempotent replay" and "no duplicate business postings" are the two requirements
// whose violation is silent: a duplicated sale or a doubled stock movement reconciles fine on a
// per-row basis and only shows up as a wrong total weeks later. So these tests assert the
// mechanism, not the intent.

// ---------------------------------------------------------------- model layer

test('all five sync models exist in every schema with identical bodies', () => {
  const required = ['SyncNode', 'SyncPeer', 'SyncOutbox', 'SyncCursor', 'SyncInbox'];
  for (const { name, src } of schemas) {
    for (const model of required) {
      assert.ok(src.includes(`model ${model} {`), `${name} must declare model ${model}`);
    }
    for (const enums of ['SyncNodeRole', 'SyncDirection', 'SyncEventStatus', 'SyncInboxOutcome']) {
      assert.ok(src.includes(`enum ${enums} {`), `${name} must declare enum ${enums}`);
    }
  }
  // The canonical mirror drifting from the runtime schemas is the exact failure that hid
  // Employee.settlementAccountCode for a while; keep the field-level comparison honest.
  const bodies = schemas.map(({ src }) => src.slice(src.indexOf('model SyncNode {')));
  assert.equal(bodies[0], bodies[1], 'canonical and SQLite schema must agree from SyncNode onward');
  assert.equal(bodies[0], bodies[2], 'canonical and PostgreSQL schema must agree from SyncNode onward');
});

test('idempotency is enforced by a database constraint, not a read-then-write check', () => {
  // A SELECT followed by INSERT duplicates the event whenever two peers deliver concurrently.
  // Only a unique index settles that race, so the constraint is the load-bearing part.
  for (const { name, src } of schemas) {
    assert.ok(src.includes('eventId       String        @unique'), `${name} must keep eventId unique on SyncOutbox`);
  }
  assert.match(src_of('schema.prisma'), /model SyncInbox[\s\S]*@@unique\(\[nodeId, eventId\]\)/);
  function src_of(f) { return schemas.find((s) => s.name === f).src; }
});

test('every synchronized operation carries tenant and branch scope', () => {
  // §2: "tenant and branch scope on every synchronized operation".
  const canonical = read('apps/api/prisma/schema.prisma');
  for (const model of ['SyncNode', 'SyncPeer', 'SyncOutbox', 'SyncCursor', 'SyncInbox']) {
    const block = canonical.slice(canonical.indexOf(`model ${model} {`));
    const body = block.slice(0, block.indexOf('\n}'));
    assert.ok(body.includes('companyId'), `${model} must carry companyId`);
  }
  // The DTO must refuse an event with no origin identity, so scope cannot be omitted in transit.
  assert.match(dto, /aggregateType!: string/);
  assert.match(dto, /eventId!: string/);
});

test('retry uses bounded backoff and dead-letters instead of retrying forever', () => {
  assert.match(service, /const DEAD_LETTER_THRESHOLD = \d+;/);
  assert.match(service, /attempts >= DEAD_LETTER_THRESHOLD/);
  // Bounded: the exponent is capped, so a poison event cannot schedule a retry in the far future.
  assert.match(service, /BASE_RETRY_MS \* 2 \*\* Math\.min\(attempts, \d+\)/);
  assert.match(service, /status: dead \? 'DEAD_LETTER' : 'FAILED'/);
  assert.match(service, /nextRetryAt: dead \? null : new Date\(Date\.now\(\) \+ backoffMs\)/);
});

test('a dead-lettered event is requeued under its ORIGINAL event id', () => {
  // Resending the same id is what proves the receiver's duplicate suppression works. Minting a
  // new id on requeue would turn a retry into a second posting.
  assert.match(service, /requeueDeadLetter[\s\S]*eventId: dto\.eventId|requeueDeadLetter[\s\S]*\{ nodeId: node\.id, eventId \}/);
  assert.match(service, /data: \{ status: 'PENDING', attempts: 0, deadLetteredAt: null, lastError: null, nextRetryAt: null \}/);
  // And the requeue must be refused unless it really is dead-lettered.
  assert.match(service, /if \(row\.status !== 'DEAD_LETTER'\) throw new BadRequestException/);
});

// ---------------------------------------------------------------- idempotency

test('replaying the same eventId is a no-op, and a different payload under the same id is refused', () => {
  assert.match(service, /if \(existing\) \{[\s\S]*if \(this\.digest\(existing\.payload as Record<string, unknown>\) !== this\.digest\(dto\.payload\)\) \{[\s\S]*throw new ConflictException/);
  assert.match(service, /return \{ eventId: existing\.eventId, status: existing\.status, duplicate: true \};/);
});

test('the payload digest is order-independent', () => {
  // The same event serialised with keys in a different order is the SAME event. A digest that
  // depends on insertion order would make a legitimate retry look like a protocol violation.
  assert.match(service, /Object\.fromEntries\(Object\.entries\(value as Record<string, unknown>\)\.sort/);
  assert.match(service, /if \(Array\.isArray\(value\)\) return value\.map\(canonical\);/);
});

test('an unsupported schemaVersion fails closed instead of being partially applied', () => {
  // §2: "fail-closed handling for unknown schema/version".
  assert.match(service, /const MAX_SUPPORTED_SCHEMA_VERSION = \d+;/);
  assert.match(service, /isUnsupportedVersion\(version: number\) \{[\s\S]*return !Number\.isInteger\(version\) \|\| version < 1 \|\| version > MAX_SUPPORTED_SCHEMA_VERSION/);
  // Enqueue refuses outright. This assertion used to read
  // `for (const event of dto.events) this.assertSchemaVersion(event.schemaVersion)`, which was true at
  // the time but described publishEvents, not enqueue — and the behaviour it locked was the ACK bug
  // (see "an ack is validated against the stored event"). Written to the intent instead: the write
  // that CREATES an event validates the caller's version, and the one that ACKs a stored event
  // validates the version this node stored.
  assert.match(service, /async enqueueEvent[\s\S]*?this\.assertSchemaVersion\(dto\.schemaVersion\);/);
  // receiveEvents must reject the individual event and keep processing the batch, otherwise one
  // unparseable event would block every event behind it in the same delivery.
  assert.match(service, /await this\.recordInbox\(scope, node, peer, event, 'REJECTED'/);
  assert.match(service, /outcome: 'REJECTED'[\s\S]*?\}\);\s*continue;/);
});

// ---------------------------------------------------------------- authorization

test('every operator branch-sync route requires integration.manage', () => {
  // Registering a node or peer is tenant administration. A cashier who can do this could introduce a
  // second authority that posts stock.
  //
  // The three node-to-node wire routes are the deliberate exception: they are @Public() because a
  // branch server has no user session, and BranchSyncAuthGuard authenticates them by HMAC peer
  // signature instead. That exception is asserted in post1a-peer-transport-security.test.mjs, so it
  // is checked rather than assumed.
  const parts = controller.split(/@(Get|Post|Patch)\(/).slice(2);
  const bodies = parts.filter((_, i) => i % 2 === 0);
  assert.ok(bodies.length >= 14, `expected the full POST-1A surface, found ${bodies.length} handlers`);
  for (const body of bodies) {
    const isWire = /nodes\/:nodeId\/(pull|publish|receive)/.test(body);
    if (isWire) {
      assert.match(body, /@Public\(\)/);
      assert.match(body, /@UseGuards\(BranchSyncAuthGuard\)/);
      assert.ok(!/@Permissions\(/.test(body), 'a wire route is HMAC-authenticated, not permission-gated');
    } else {
      assert.match(body, /@Permissions\('integration\.manage'\)/, 'every operator branch-sync handler must be permission gated');
    }
  }
});

test('a node may only act for itself and only within its own branch', () => {
  // Cross-node impersonation is how one branch would post inventory under another's identity.
  assert.match(service, /private async requireOwnNode\(user: AuthUser, nodeId: string\)/);
  assert.match(service, /if \(node\.branchId && scope\.branchId && node\.branchId !== scope\.branchId\) \{[\s\S]*throw new ForbiddenException/);
});

test('a peer that is not registered and active is refused', () => {
  assert.match(service, /const registration = await this\.prisma\.syncPeer\.findFirst\(\{ where: \{ nodeId: node\.id, peerNodeId: peer\.id, isActive: true \} \}\);[\s\S]*if \(!registration\) throw new ForbiddenException/);
  // A PULL-only peer must not be pulled from.
  assert.match(service, /if \(peer\.direction === 'PUSH'\) throw new BadRequestException/);
});

test('a tenant may have only one active CENTRAL node', () => {
  // Two central hosts would both consolidate and double-post every synced transaction.
  assert.match(service, /if \(dto\.role === 'CENTRAL'\) \{[\s\S]*throw new ConflictException\('Tenant ini sudah punya node CENTRAL aktif\.'\)/);
  assert.match(service, /if \(dto\.role === 'BRANCH' && !dto\.branchId\) throw new BadRequestException/);
});

// ---------------------------------------------------------------- observability

test('lag and pending counts are computed server-side, never taken from the caller', () => {
  // A client-supplied queue depth is a claim, not evidence. The outbox is the only authority.
  assert.match(service, /const pending = await this\.prisma\.syncOutbox\.count\(\{ where: \{ nodeId: node\.id, status: 'PENDING' \} \}\);[\s\S]*serverPending: pending/);
  assert.match(service, /serverDeadLettered: deadLettered/);
  // The comment explaining that lag is server-computed sits directly above the DTO.
  assert.match(dto, /lagCount is computed by the server[\s\S]*class NodeHeartbeatDto \{[\s\S]*pendingCount\?: number;/);
  assert.match(service, /async syncHealth\(user: AuthUser/);
});

test('duplicatesSuppressed is counted where duplicates actually land', () => {
  // This assertion used to be `assert.match(service, /duplicatesSuppressed: duplicates/)`, which locks
  // a VARIABLE NAME and passes for any derivation whatsoever — including the broken one that counted
  // SyncInbox rows with outcome DUPLICATE. That count is structurally always zero: a duplicate is
  // suppressed by the (nodeId, eventId) unique constraint, so no DUPLICATE row is ever created.
  // The admin panel showed a permanent 0 under the label "Duplikat ditekan".
  //
  // The intent, stated so a future edit has to satisfy it: the reported number must come from a
  // counter that receiveEvents actually increments when it suppresses something.
  const schemas = ['apps/api/prisma/schema.prisma', 'apps/api/prisma/schema.sqlite.prisma', 'apps/api/prisma/schema.postgresql.prisma'];
  for (const schema of schemas) {
    assert.match(read(schema), /model SyncNode \{[\s\S]*duplicatesSuppressed\s+Int\s+@default\(0\)/,
      `${schema} must declare the counter on SyncNode`);
  }
  // receiveEvents increments it, and only when something was suppressed.
  assert.match(service, /const duplicates = results\.filter\(\(r\) => r\.outcome === 'DUPLICATE'\)\.length;[\s\S]*duplicatesSuppressed: \{ increment: duplicates \}/);
  // And the reported value reads that counter, not a table that cannot hold the row.
  assert.match(service, /const duplicates = node\.duplicatesSuppressed;/);
  assert.doesNotMatch(service, /syncInbox\.count\(\{ where: \{ nodeId: node\.id, outcome: 'DUPLICATE' \} \}\)/,
    'deriving duplicatesSuppressed from SyncInbox can only ever return 0');
});

test('applying an event advances the aggregate watermark detectConflict reads', () => {
  // detectConflict compares an event's declared baseVersion against SyncAggregateVersion. Before this
  // was asserted, nothing in the receive path wrote that table, so every comparison read version 0: a
  // strictly sequential write reported a conflict and a real one reported a conflict for the wrong
  // reason. A reader-only assertion about the table is not enough — assert the WRITER exists inside
  // receiveEvents, between the apply and the result push.
  const recv = service.slice(service.indexOf('async receiveEvents'), service.indexOf('async syncHealth'));
  assert.match(recv, /await this\.advanceWatermark\(scope, node\.id, event\.aggregateType, event\.aggregateId, declared\)/,
    'receiveEvents must advance the watermark for each applied event');
  // The version comes from the payload, and only when it was actually declared.
  assert.match(recv, /const declared = this\.readVersion\(event\.payload[\s\S]*if \(declared !== null\)/);
  // The internal writer stays monotonic: a late stale write must not lower it.
  const wm = service.slice(service.indexOf('private async advanceWatermark'));
  assert.match(wm, /if \(existing && existing\.version >= version\) return existing;/);
});

test('an ack is validated against the stored event, not the peer body', () => {
  // publishEvents used to check `event.schemaVersion` from the ACK body. SyncEventDto marks that field
  // @IsOptional, so the minimal `{eventId}` ack the DTO permits was rejected with a 400 — the
  // documented contract and the enforced one disagreed.
  assert.match(service, /this\.assertSchemaVersion\(row\.schemaVersion\);/,
    'the version that matters is the one this node stored');
  assert.doesNotMatch(service, /for \(const event of dto\.events\) this\.assertSchemaVersion\(event\.schemaVersion\);/,
    'validating the echoed body rejects the minimal ack the DTO allows');
});

test('the stored cursor is a position, not an event id', () => {
  // advanceCursor wrote lastEventId (an event id) and pullEvents fed it to Date.parse, which returned
  // NaN and collapsed to new Date(0). Every stored cursor therefore meant "from the beginning of time",
  // so a peer that never sent a cursor re-read the node's entire outbox on every pull.
  assert.match(service, /const after = dto\.cursor \?\? cursor\?\.cursor \?\? null;/,
    'pullEvents must compare against the `cursor` column');
  assert.doesNotMatch(service, /const after = dto\.cursor \?\? cursor\?\.lastEventId \?\? null;/,
    'an eventId parsed as a date is always NaN');
  assert.match(service, /data: \{ lastEventId, cursor: position, lastSyncAt: new Date\(\), lagCount: lag \}/,
    'advanceCursor must store the position it compares against');
  assert.match(service, /const position = \(acked\?\.createdAt \?\? new Date\(\)\)\.toISOString\(\);/);
});

test('every applied event writes an audit row naming the origin', () => {
  // §2: "audit trail from originating operator/device through applied canonical mutation".
  assert.match(service, /async receiveEvents[\s\S]*await this\.audit\(scope, 'SYNC_EVENTS_RECEIVED'/);
  // The audit helper must never throw into the request path — a failed audit write is logged, not
  // allowed to reject an event that was already applied.
  assert.match(service, /\}\)\.catch\(\(error: unknown\) => \{\s*this\.logger\.error\(`Audit write failed/);
});

test('bootstrap returns instructions and a cursor, never raw rows', () => {
  // §2: "no direct cross-node table overwrite". A bootstrap that returned tables would be exactly
  // the copy/overwrite the roadmap forbids.
  assert.match(service, /instruction: 'Pull \/branch-sync\/:nodeId\/pull[\s\S]*Jangan menulis tabel lintas node secara langsung\.'/);
  assert.doesNotMatch(service, /bootstrapBranch[\s\S]*findMany\(\{ where: \{ companyId: scope\.companyId \} \}\)/);
});

test('the module is registered in the app module', () => {
  const app = read('apps/api/src/app.module.ts');
  assert.match(app, /import \{ BranchSyncModule \} from '\.\/branch-sync\/branch-sync\.module';/);
  assert.match(app, /\n    BranchSyncModule,/);
});
