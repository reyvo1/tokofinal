import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const service = read('apps/api/src/branch-sync/branch-sync.service.ts');
const controller = read('apps/api/src/branch-sync/branch-sync.controller.ts');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma']
  .map((f) => ({ name: f, src: read(`apps/api/prisma/${f}`) }));

// POST-1A conflict and reconciliation primitives.
//
// This is the part of a multi-node design that is easiest to get quietly wrong. "Last write wins"
// reconciles perfectly on every test and silently discards one branch's completed sale in
// production: the customer has the goods, the inventory no longer exists, and nothing ever says so.
// The policy encoded here refuses to decide, and the tests below pin that refusal down.

// ---------------------------------------------------------------- the model

test('conflict and version-watermark models exist in every schema', () => {
  for (const { name, src } of schemas) {
    assert.ok(src.includes('model SyncConflict {'), `${name} must declare SyncConflict`);
    assert.ok(src.includes('model SyncAggregateVersion {'), `${name} must declare SyncAggregateVersion`);
  }
  const bodies = schemas.map(({ src }) => src.slice(src.indexOf('model SyncConflict {')));
  assert.equal(bodies[0], bodies[1], 'canonical and SQLite schema must agree from SyncConflict onward');
  assert.equal(bodies[0], bodies[2], 'canonical and PostgreSQL schema must agree from SyncConflict onward');
});

test('a conflict is idempotent on (nodeId, eventId)', () => {
  // Re-detecting the same conflict during a retry storm must not create a second review row, or one
  // stuck aggregate floods the operator queue with duplicates.
  for (const { name, src } of schemas) {
    assert.match(src, /model SyncConflict \{[\s\S]*@@unique\(\[nodeId, eventId\]\)/, `${name} must keep the conflict unique key`);
  }
  assert.match(service, /const existing = await this\.prisma\.syncConflict\.findFirst\(\{ where: \{ nodeId: node\.id, eventId \} \}\);\s*if \(existing\) return existing;/);
});

test('the aggregate watermark is unique per node and aggregate', () => {
  for (const { name, src } of schemas) {
    assert.match(src, /@@unique\(\[nodeId, aggregateType, aggregateId\]\)/, `${name} must keep the watermark unique key`);
  }
});

test('the strategy enum can express a refusal, not only a winner', () => {
  // A schema with only KEEP_LOCAL/KEEP_REMOTE has no way to record "a human must look at this".
  for (const { name, src } of schemas) {
    assert.match(src, /enum SyncConflictStrategy \{[\s\S]*PENDING[\s\S]*MANUAL_REVIEW/, `${name} must keep PENDING and MANUAL_REVIEW`);
  }
});

// ---------------------------------------------------------------- the policy

test('no conflict is ever auto-resolved in favour of a writer', () => {
  // This assertion was WRONG until 2026-10-01 and it is why the defect survived: it pinned
  // `AUTO_RESOLVABLE_STRATEGIES = {MANUAL_REVIEW}` and `strategy: 'MANUAL_REVIEW'` on record, while
  // `resolveConflict` only accepted a PENDING conflict. Nothing ever wrote PENDING, so every recorded
  // conflict escalated to a state that could not be resolved, and `recoveryPlan` reported zero
  // outstanding conflicts. `post1a-conflict-escalation-runtime.test.mjs` now executes this path and
  // fails on the old code; these source assertions are kept only as a cheap regression tripwire for
  // the invariant, never as the proof.
  //
  // The invariant that actually matters: recording leaves the conflict UNDECIDED, and no automatic
  // path anywhere assigns a winner. The operator's three choices are reachable only through
  // resolveConflict, which requires an authenticated user and writes an audit row.
  assert.match(service, /const RESOLUTION_STRATEGIES = new Set<SyncConflictStrategy>\(\['KEEP_LOCAL', 'KEEP_REMOTE', 'MANUAL_REVIEW'\]\);/);
  assert.match(service, /strategy: 'PENDING' \}[\s\S]{0,120}\}\)\.catch/);
  // PENDING is refused as a RESOLUTION because it is the undecided state, not an outcome.
  assert.match(service, /if \(!RESOLUTION_STRATEGIES\.has\(strategy\)\) \{[\s\S]*bukan sebuah resolution/);
});

test('an undeclared version is refused rather than assumed to be zero', () => {
  // "I did not say" and "I was editing version 0" must not look alike. Defaulting to 0 would report a
  // clean bill of health for a writer that never declared what it was editing.
  assert.match(service, /private readVersion\(payload: Record<string, unknown>\): number \| null \{[\s\S]*return Number\.isInteger\(raw\) \? \(raw as number\) : null;/);
  assert.match(service, /if \(baseVersion === null\) throw new BadRequestException\('Event tidak membawa baseVersion; konflik tidak dapat dideteksi\.'\)/);
  assert.match(service, /if \(baseVersion === null\) throw new BadRequestException\('Event tidak membawa baseVersion; konflik tidak dapat direkam\.'\)/);
});

test('detection compares the writer base against the observed watermark and applies nothing', () => {
  // A detector that mutates state is a resolver wearing a detector's name; the caller must be able
  // to ask "is this conflicted?" without consequence.
  assert.match(service, /conflicted: baseVersion !== observed,/);
  assert.match(service, /const observed = watermark\?\.version \?\? 0;/);
  assert.match(service, /async detectConflict\(user: AuthUser, nodeId: string, eventId: string\) \{[\s\S]*?const baseVersion = this\.readVersion[\s\S]*?const watermark[\s\S]*?return \{/);
  // No write inside the detector.
  const body = service.slice(service.indexOf('async detectConflict('), service.indexOf('async recordConflict('));
  assert.doesNotMatch(body, /\.(create|update|upsert|deleteMany)\(/, 'detectConflict must not write');
});

test('a resolution records who decided and when', () => {
  // An inventory discrepancy with no recorded decision is indistinguishable from one nobody looked at.
  assert.match(service, /resolution: \{ note: note \?\? null, decidedBy: user\.sub, decidedAt: new Date\(\)\.toISOString\(\) \}/);
  assert.match(service, /resolvedBy: user\.sub, resolvedAt: new Date\(\)/);
  assert.match(service, /await this\.audit\(scope, 'SYNC_CONFLICT_RESOLVED', 'SyncConflict', conflict\.id, \{ eventId, strategy \}, user\.sub\);/);
});

test('a conflict cannot be resolved twice', () => {
  assert.match(service, /if \(conflict\.strategy !== 'PENDING'\) throw new BadRequestException\(`Konflik sudah berstatus \$\{conflict\.strategy\}\.`\)/);
});

test('a concurrently created conflict is read back, but unrelated persistence errors stay fatal', () => {
  // Two nodes can detect the same conflict at once. Only P2002 means the other writer won; masking
  // any other database error here would turn an outage into a fake concurrency replay.
  const record = service.slice(service.indexOf('async recordConflict('), service.indexOf('async resolveConflict('));
  assert.match(record, /syncConflict\.create\([\s\S]*P2002[\s\S]*return null[\s\S]*throw error/);
  assert.match(record, /if \(!created\) \{\s*const raced = await this\.prisma\.syncConflict\.findFirst\(\{ where: \{ nodeId: node\.id, eventId \} \}\);\s*if \(raced\) return raced;/);
});

test('the watermark is monotonic, so a stale write cannot make a newer one look current', () => {
  // This is the write side of conflict detection. advanceVersion in the service refuses to regress,
  // and the delivery path here must agree: a late stale event that lowered the watermark would hide
  // the very conflict the watermark exists to expose.
  assert.match(service, /if \(existing && existing\.version >= version\) return existing; \/\/ never regress/);
  assert.match(service, /if \(!Number\.isInteger\(version\) \|\| version < 0\) throw new BadRequestException\('Version agregat harus bilangan bulat non-negatif\.'\)/);
  // Without a writer for this table, detectConflict would read 0 forever and report "no conflict"
  // for every event — a silent failure that looks exactly like a healthy system.
  const writes = (service.match(/syncAggregateVersion\.(create|update|upsert)\(/g) ?? []).length;
  assert.ok(writes > 0, 'the watermark must have a write path, not only the read in detectConflict');
});

test('the version-advance route is operator-only', () => {
  const block = controller.split('nodes/:nodeId/aggregates/:aggregateType/:aggregateId/version')[1]?.split('\n\n')[0] ?? '';
  assert.match(block, /@Permissions\('integration\.manage'\)/);
  assert.doesNotMatch(block, /@Public\(\)/, 'the watermark is not a peer wire route');
});

// ---------------------------------------------------------------- recovery

test('recovery after server replacement re-derives from a cursor, never from copied tables', () => {
  // The roadmap forbids cross-node table overwrite. A replacement server comes back with an empty
  // database, so the tempting shortcut — copy the old tables across — is exactly the thing to avoid.
  assert.match(service, /async recoveryPlan\(user: AuthUser, nodeId: string\) \{/);
  assert.match(service, /Tarik per peer dari cursor terakhir; jangan menyalin tabel lintas node\./);
  assert.match(service, /Daftarkan ulang node dengan code yang sama; upsert mengadopsi identitas yang ada\./);
  const body = service.slice(service.indexOf('async recoveryPlan('), service.indexOf('private assertSchemaVersion'));
  assert.doesNotMatch(body, /findMany\(\{ where: \{ companyId: scope\.companyId \} \}\)/, 'recovery must not dump tenant rows');
  // Every step must be a read or a cursor, never a row copy.
  assert.doesNotMatch(body, /\b(createMany|updateMany|deleteMany)\(/);
});

test('recovery surfaces unresolved conflicts before the node reopens for business', () => {
  assert.match(service, /const \[outboxCounts, cursors, peers, conflicts\] = await Promise\.all\(\[/);
  assert.match(service, /this\.prisma\.syncConflict\.count\(\{ where: \{ nodeId: node\.id, strategy: 'PENDING' \} \}\)/);
  assert.match(service, /unresolvedConflicts: conflicts,/);
  assert.match(service, /Verifikasi conflict PENDING sebelum membuka transaksi\./);
});

// ---------------------------------------------------------------- surface

test('the conflict and recovery routes are operator-only and permission gated', () => {
  for (const route of ['nodes/:nodeId/conflicts', 'nodes/:nodeId/conflicts/:eventId', 'nodes/:nodeId/conflicts/:eventId/resolve', 'nodes/:nodeId/recovery-plan']) {
    const block = controller.split(route)[1]?.split('\n\n')[0] ?? '';
    assert.match(block, /@Permissions\('integration\.manage'\)/, `${route} must be permission gated`);
    // Never @Public(): a conflict queue is tenant administration, not a peer wire route.
    assert.doesNotMatch(block, /@Public\(\)/, `${route} must not be a public peer route`);
  }
});
