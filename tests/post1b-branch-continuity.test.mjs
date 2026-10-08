import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const service = read('apps/api/src/branch-continuity/branch-continuity.service.ts');
const controller = read('apps/api/src/branch-continuity/branch-continuity.controller.ts');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma']
  .map((f) => ({ name: f, src: read(`apps/api/prisma/${f}`) }));

// POST-1B — local-first branch continuity.
//
// The roadmap states the rule this file exists to enforce: "No flow may silently pretend it is
// globally current when a branch is disconnected."
//
// "Silently" is the operative word. A branch serving a stale price is a solvable problem; an operator
// who cannot tell the price is stale is not. Every assertion below is about the *notice* or the
// *refusal* existing, never merely about the data being cached.

// ---------------------------------------------------------------- the declaration

test('capability is declared per flow and per node, never inferred from network state', () => {
  for (const { name, src } of schemas) {
    assert.ok(src.includes('model OfflineCapability {'), `${name} must declare OfflineCapability`);
    assert.ok(src.includes('model NodeCapabilityPolicy {'), `${name} must declare NodeCapabilityPolicy`);
  }
  const bodies = schemas.map(({ src }) => src.slice(src.indexOf('model OfflineCapability {')));
  assert.equal(bodies[0], bodies[1], 'canonical and SQLite schema must agree from OfflineCapability onward');
  assert.equal(bodies[0], bodies[2], 'canonical and PostgreSQL schema must agree from OfflineCapability onward');
});

test('an undeclared flow is refused, not allowed by default', () => {
  // The dangerous default: a brand-new flow that nobody registered would inherit "allowed offline" and
  // go blind on its first disconnection. Undeclared must mean denied.
  assert.match(service, /if \(!fallback\) \{[\s\S]*return \{ flowCode, offlineCapable: false, degradedImpact: null, localAuthoritative: false, source: 'UNDECLARED' as const \};/);
});

test('a node override beats the company default', () => {
  // Legitimate reason: a branch selling perishables must not be allowed to sell them blind, even
  // though the same flow is fine at the main store.
  assert.match(service, /const override = await this\.prisma\.nodeCapabilityPolicy\.findFirst\(\{ where: \{ nodeId, flowCode \} \}\);[\s\S]*if \(override\) \{[\s\S]*source: 'NODE_OVERRIDE' as const/);
  assert.match(service, /source: 'COMPANY_DEFAULT' as const/);
});

test('offline-capable must declare what the operator loses', () => {
  // "Offline-capable" with an empty impact is a blank cheque the operator cashes unknowingly.
  assert.match(service, /if \(dto\.offlineCapable && !dto\.degradedImpact\?\.trim\(\)\) \{[\s\S]*throw new BadRequestException\('Flow offline-capable wajib menyebut degradedImpact: operator harus tahu apa yang ia korbankan\.'\)/);
  assert.match(service, /if \(dto\.offlineCapable && !dto\.degradedImpact\?\.trim\(\)\) \{\s*throw new BadRequestException\('Override offline-capable wajib menyebut degradedImpact\.'\);/);
});

// ---------------------------------------------------------------- fail-closed gate

test('a disconnected branch refuses any flow not declared offline-capable', () => {
  assert.match(service, /async assertMayProceed\(user: AuthUser, nodeId: string, flowCode: string\) \{/);
  assert.match(service, /if \(!policy\.offlineCapable\) \{\s*throw new ForbiddenException\(\s*`Flow \$\{flowCode\} tidak dinyatakan offline-capable dan node sedang \$\{state\.state\}\. Fail-closed: transaksi ditolak, bukan dipalsukan\.`/);
  // The online path must be explicitly online, not merely "not known to be offline".
  assert.match(service, /const online = state\.state === 'ONLINE';\s*if \(online\) return \{ \.\.\.policy, connection: state, permitted: true, reason: null as string \| null \};/);
});

test('a permitted offline flow still returns a reason the operator must see', () => {
  // Permitted is not the same as silently permitted. The degraded impact travels with the answer.
  assert.match(service, /reason: `\$\{flowCode\} berjalan pada state lokal\. \$\{policy\.degradedImpact \?\? ''\}`\.trim\(\),/);
});

test('the gate is reachable as an endpoint, so POS and inventory can actually consult it', () => {
  const block = controller.split('nodes/:nodeId/permit/:flowCode')[1]?.split('\n\n')[0] ?? '';
  assert.match(block, /assertMayProceed/, 'the gate must be callable, not only reachable from inside the service');
  assert.match(block, /@Permissions\('integration\.manage'\)/);
});

// ---------------------------------------------------------------- reads carry authority

test('a read reports its snapshot age and produces a notice when not current', () => {
  assert.match(service, /lastSyncedAt: watermark\.lastSyncedAt,[\s\S]*ageMs,[\s\S]*stale,[\s\S]*connection: state,/);
  assert.match(service, /requiredNotice: state\.state === 'ONLINE' && !stale \? null : `Data \$\{resource\} per \$\{watermark\.lastSyncedAt\.toISOString\(\)\} — \$\{state\.state\}, tertinggal \$\{Math\.round\(ageMs \/ 60000\)\} menit dari sinkronisasi terakhir\.`/);
});

test('a resource with no synchronized snapshot is refused, not served empty', () => {
  // An empty result and an unsynchronized result are different facts. Returning [] for both tells the
  // operator the branch has no stock when it actually has never synced.
  assert.match(service, /if \(!watermark\) \{[\s\S]*throw new NotFoundException\(`Belum ada snapshot tersinkron untuk \$\{resource\} pada node ini; tidak boleh disajikan sebagai data terkini\.`\)/);
});

test('staleness is bounded', () => {
  assert.match(service, /private readonly maxStalenessMs = 24 \* 60 \* 60_000;/);
  assert.match(service, /const stale = ageMs > this\.maxStalenessMs;/);
});

// ---------------------------------------------------------------- connectivity honesty

test('ONLINE is downgraded to DEGRADED when the heartbeat is stale', () => {
  // The verdict is derived from data, not from a stored label, so a node that stops reporting cannot
  // keep claiming ONLINE just because nobody updated the row.
  assert.match(service, /if \(recorded && state === 'ONLINE' && node\.lastHeartbeatAt\) \{[\s\S]*if \(age > 5 \* 60_000\) return \{ state: 'DEGRADED' as const/);
  assert.match(service, /if \(state === 'ONLINE' && node\.lastHeartbeatAt && Date\.now\(\) - node\.lastHeartbeatAt\.getTime\(\) > 5 \* 60_000\) state = 'DEGRADED';/);
});

test('a branch with a backlog may not be reported ONLINE', () => {
  // Online with thousands of pending events is not online. The label is what the dashboard trusts.
  assert.match(service, /if \(dto\.state === 'ONLINE' && \(dto\.lagCount \?\? 0\) > 0\) \{\s*\/\/ Online with a backlog is not ONLINE[\s\S]*throw new BadRequestException\('Node dengan backlog tidak boleh dilaporkan ONLINE; gunakan DEGRADED\.'\);/);
});

test('UNKNOWN and OFFLINE are distinct states', () => {
  // An unconfigured branch and a dead branch are different problems. Collapsing them into one red dot
  // sends the operator to fix the wrong thing.
  for (const { name, src } of schemas) {
    assert.match(src, /enum BranchConnectionState \{[\s\S]*UNKNOWN[\s\S]*ONLINE[\s\S]*DEGRADED[\s\S]*OFFLINE[\s\S]*SUSPENDED/, `${name} must keep all five states`);
  }
  assert.match(service, /const state = recorded\?\.state \?\? 'UNKNOWN';/);
});

test('the consolidated view lists every branch, including ones never heard from', () => {
  // A dashboard that only lists responding branches hides exactly the branch that needs attention.
  // `let`, not `const`: the verdict is downgraded to DEGRADED below when the heartbeat is stale.
  assert.match(service, /let state: BranchConnectionState = recorded\?\.state \?\? 'UNKNOWN';/);
  assert.match(service, /totalPending: rows\.reduce\(\(sum, r\) => sum \+ r\.pending, 0\),[\s\S]*totalDeadLettered: rows\.reduce\(\(sum, r\) => sum \+ r\.deadLettered, 0\)/);
});

// ---------------------------------------------------------------- discovery and backup

test('LAN discovery reveals no business data', () => {
  // A discovery endpoint that leaked inventory or price would be a data leak with a friendly name.
  const body = service.slice(service.indexOf('async discover('), service.indexOf('async recordBackupMetadata('));
  assert.doesNotMatch(body, /price|amount|total|stock|quantity|balance|sale/i, 'discovery must not carry business data');
  assert.match(body, /code: n\.code, role: n\.role,[\s\S]*reachable:/);
  assert.match(service, /protocolVersion: 1,/);
});

test('backup is recorded as metadata only, never as a second copy of branch data', () => {
  assert.match(service, /if \(!\/\^\[0-9a-f\]\{64\}\$\/i\.test\(dto\.checksum\)\) \{[\s\S]*throw new BadRequestException\('Checksum backup harus SHA-256 hex agar dapat diverifikasi saat restore\.'\);/);
  assert.match(service, /kind: dto\.kind \?\? 'LOCAL', note: 'Metadata only; central does not hold branch backup data\.'/);
});

test('rejoin reuses the node code so cursors survive a server replacement', () => {
  assert.match(service, /const node = await this\.prisma\.syncNode\.findFirst\(\{ where: \{ companyId: this\.tenant\(user\), code: dto\.code \} \}\);/);
  assert.match(service, /if \(!node\) throw new NotFoundException\('Node dengan code ini belum pernah terdaftar; gunakan registrasi normal\.'\);/);
  assert.match(service, /Jangan menyalin tabel lintas node\./);
});

// ---------------------------------------------------------------- authorization

test('every continuity route is permission gated', () => {
  // A cashier who could mark their own branch ONLINE, or widen their own offline permission, could
  // quietly trade on data the rest of the company cannot see.
  const parts = controller.split(/@(Get|Put|Post)\(/).slice(2);
  const bodies = parts.filter((_, i) => i % 2 === 0);
  assert.ok(bodies.length >= 12, `expected the full POST-1B surface, found ${bodies.length} handlers`);
  for (const body of bodies) {
    assert.match(body, /@Permissions\('integration\.manage'\)/, 'every continuity handler must be permission gated');
  }
  // None of them are peer wire routes: those live in branch-sync and are HMAC-authenticated.
  assert.doesNotMatch(controller, /@Public\(\)/);
});

test('the module is registered', () => {
  const app = read('apps/api/src/app.module.ts');
  assert.match(app, /import \{ BranchContinuityModule \} from '\.\/branch-continuity\/branch-continuity\.module';/);
  assert.match(app, /\n    BranchContinuityModule,/);
});
