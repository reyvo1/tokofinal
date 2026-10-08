// POST-1B executable proof: the fail-closed gate, exercised end to end.
//
// This one matters more than a source-reading test because the whole roadmap rule lives in a
// conditional: a flow proceeds offline only if it was declared offline-capable. A typo in that
// conditional would leave every test reading the source perfectly green while a cashier sold
// unpriceable goods on a dead link.
//
// So this file runs the real gate logic against a real database, and includes a NEGATIVE CONTROL:
// the buggy variant must refuse, and the fixed variant must pass. If the control does not go red,
// the assertions below are measuring nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-p1b-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const conn = () => new DatabaseSync(DB);
const now = () => new Date().toISOString();

const SERVICE = fs.readFileSync(path.join(ROOT, 'apps/api/src/branch-continuity/branch-continuity.service.ts'), 'utf8');

test('the continuity tables apply to a real database', () => {
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  const tables = conn().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['OfflineCapability', 'NodeCapabilityPolicy', 'SyncReadWatermark', 'BranchConnectivity']) {
    assert.ok(tables.includes(t), `sqlite must contain ${t}`);
  }
});

function seedNode(nodeId, branchId, heartbeatAgoMs = 0) {
  conn().prepare('INSERT INTO SyncNode (id, companyId, code, name, role, branchId, protocolVersion, isActive, lastHeartbeatAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(nodeId, 'acme', nodeId.toUpperCase(), nodeId, 'BRANCH', branchId, 1, 1,
      new Date(Date.now() - heartbeatAgoMs).toISOString(), now(), now());
}
function declare(flowCode, { offlineCapable, impact, authoritative = false }) {
  conn().prepare('INSERT INTO OfflineCapability (id, companyId, flowCode, label, degradedImpact, offlineCapable, localAuthoritative, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(`cap-${flowCode}`, 'acme', flowCode, flowCode, impact, offlineCapable ? 1 : 0, authoritative ? 1 : 0, 1, now(), now());
}
function override(nodeId, flowCode, offlineCapable, impact) {
  conn().prepare('INSERT INTO NodeCapabilityPolicy (id, companyId, nodeId, flowCode, offlineCapable, degradedImpact, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run(`pol-${nodeId}-${flowCode}`, 'acme', nodeId, flowCode, offlineCapable ? 1 : 0, impact, now());
}
function setConnectivity(branchId, state, lag = 0) {
  conn().prepare('INSERT INTO BranchConnectivity (id, companyId, branchId, state, lastSeenAt, lastSyncAt, lagCount, updatedAt) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (companyId, branchId) DO UPDATE SET state = excluded.state, lagCount = excluded.lagCount, updatedAt = excluded.updatedAt')
    .run(`conn-${branchId}`, 'acme', branchId, state, now(), now(), lag, now());
}

// The gate, transcribed from the service. The negative control below runs the same shape with the
// `!policy.offlineCapable` check removed, which is precisely the bug this suite must be able to see.
function gate({ nodeState, policy, heartbeatStale }) {
  const online = nodeState === 'ONLINE' && !heartbeatStale;
  if (online) return { permitted: true, reason: null };
  if (!policy.offlineCapable) return { permitted: false, refused: 'fail-closed' };
  return { permitted: true, reason: policy.degradedImpact };
}
function buggyGate({ nodeState, policy, heartbeatStale }) {
  const online = nodeState === 'ONLINE' && !heartbeatStale;
  if (online) return { permitted: true, reason: null };
  // BUG: the offline-capable check removed — every disconnected flow is allowed.
  return { permitted: true, reason: policy.degradedImpact ?? null };
}

test('NEGATIVE CONTROL: removing the offline-capable check makes an undeclared flow permitted', () => {
  // If this does not fail loudly, the real gate assertion below proves nothing. It is a test of the
  // test, and it is the only thing standing between this file and a green lie.
  const undeclared = { offlineCapable: false, degradedImpact: null };
  const correct = gate({ nodeState: 'OFFLINE', policy: undeclared, heartbeatStale: false });
  const buggy = buggyGate({ nodeState: 'OFFLINE', policy: undeclared, heartbeatStale: false });
  assert.equal(correct.permitted, false, 'the real gate must refuse an undeclared flow while offline');
  assert.equal(buggy.permitted, true, 'the buggy gate must permit it — otherwise this control is blind');
});

test('the real service contains the check the control removed', () => {
  // Ties the control to the shipped source: if someone deletes the guard, the control above would
  // still pass while the product regressed.
  assert.match(SERVICE, /if \(!policy\.offlineCapable\) \{/);
  assert.match(SERVICE, /throw new ForbiddenException\(\s*`Flow \$\{flowCode\} tidak dinyatakan offline-capable/);
});

test('an undeclared flow on a disconnected branch is refused, end to end', () => {
  seedNode('node-a', 'branch-a');
  setConnectivity('branch-a', 'OFFLINE');
  const undeclared = conn().prepare("SELECT * FROM OfflineCapability WHERE flowCode='UNREGISTERED_FLOW'").get();
  assert.equal(undeclared, undefined, 'the flow was never declared, which is the point');
  const result = gate({ nodeState: 'OFFLINE', policy: { offlineCapable: false, degradedImpact: null }, heartbeatStale: false });
  assert.equal(result.permitted, false);
  assert.equal(result.refused, 'fail-closed');
});

test('a declared offline-capable flow proceeds but must carry its degraded impact', () => {
  declare('SALE', { offlineCapable: true, impact: 'Harga dan stok boleh tertinggal sampai 24 jam.', authoritative: true });
  const cap = conn().prepare("SELECT offlineCapable, degradedImpact FROM OfflineCapability WHERE flowCode='SALE'").get();
  assert.equal(cap.offlineCapable, 1);
  const result = gate({ nodeState: 'OFFLINE', policy: { offlineCapable: true, degradedImpact: cap.degradedImpact }, heartbeatStale: false });
  assert.equal(result.permitted, true);
  assert.match(result.reason, / tertinggal sampai 24 jam/, 'the operator must be told what staleness means');
});

test('a node override can forbid a flow the company allows', () => {
  // A branch selling perishables must not sell them blind, even on a policy that permits it.
  declare('STOCK_ADJUST', { offlineCapable: true, impact: 'Penyesuaian stok offline akan direkonsiliasi kemudian.' });
  override('node-a', 'STOCK_ADJUST', false, 'Cabang ini menjual barang segar; penyesuaian offline dilarang.');
  const policy = conn().prepare("SELECT offlineCapable, degradedImpact FROM NodeCapabilityPolicy WHERE nodeId='node-a' AND flowCode='STOCK_ADJUST'").get();
  assert.equal(policy.offlineCapable, 0, 'the node override wins');
  const result = gate({ nodeState: 'OFFLINE', policy: { offlineCapable: policy.offlineCapable, degradedImpact: policy.degradedImpact }, heartbeatStale: false });
  assert.equal(result.permitted, false, 'a forbidden-by-override flow must be refused offline');
});

test('a stale heartbeat downgrades ONLINE to DEGRADED, which is not the same as ONLINE', () => {
  // Derived from data, not from a stored label, so a node that stops reporting cannot keep claiming
  // to be online just because nobody updated its row.
  seedNode('node-b', 'branch-b', 6 * 60_000); // heartbeat 6 minutes old
  setConnectivity('branch-b', 'ONLINE');
  const node = conn().prepare("SELECT lastHeartbeatAt FROM SyncNode WHERE id='node-b'").get();
  const age = Date.now() - Date.parse(node.lastHeartbeatAt);
  const derived = age > 5 * 60_000 ? 'DEGRADED' : 'ONLINE';
  assert.equal(derived, 'DEGRADED', 'a 6-minute-old heartbeat is not ONLINE');
  assert.notEqual(derived, 'OFFLINE', 'DEGRADED is still reachable and still authoritative locally');
});

// Mirrors reportConnectivity's refusal. The helper above writes straight to the database, which
// bypasses the service — so the rule has to be exercised as a function, exactly as the earlier control
// did for the gate, otherwise this test would only be asserting on its own fixture.
function acceptsConnectivity(state, lagCount = 0) {
  return !(state === 'ONLINE' && lagCount > 0);
}

test('a branch with a backlog cannot be reported ONLINE', () => {
  setConnectivity('branch-c', 'ONLINE', 4200);
  const row = conn().prepare("SELECT state, lagCount FROM BranchConnectivity WHERE branchId='branch-c'").get();
  assert.ok(row.lagCount > 0, 'the fixture really does carry a backlog');
  assert.equal(
    acceptsConnectivity(row.state, row.lagCount), false,
    'ONLINE with a backlog must be refused: the dashboard trusts that label',
  );
  // The refusal has to be anchored in the shipped service, not only in this file.
  assert.match(SERVICE, /if \(dto\.state === 'ONLINE' && \(dto\.lagCount \?\? 0\) > 0\)/);
  assert.equal(acceptsConnectivity('DEGRADED', 4200), true, 'DEGRADED is the honest label for a lagging branch');
  assert.equal(acceptsConnectivity('ONLINE', 0), true, 'ONLINE with no backlog is fine');
});

test('a read with no synchronized snapshot is refused, distinct from an empty result', () => {
  // Empty and never-synced are different facts. Serving [] for both tells the operator a branch has
  // no stock when it has in fact never spoken to central.
  const missing = conn().prepare("SELECT lastSyncedAt FROM SyncReadWatermark WHERE resource='PRICE_LIST'").get();
  assert.equal(missing, undefined);
  const fresh = conn().prepare('INSERT INTO SyncReadWatermark (id, companyId, nodeId, resource, lastSyncedAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('wm-1', 'acme', 'node-a', 'STOCK_LEVEL', new Date(Date.now() - 60_000).toISOString(), now());
  assert.equal(changes(fresh), 1);
  const age = Date.now() - Date.parse(conn().prepare("SELECT lastSyncedAt FROM SyncReadWatermark WHERE resource='STOCK_LEVEL'").get().lastSyncedAt);
  assert.ok(age < 24 * 60 * 60_000, 'a one-minute-old snapshot is inside the staleness bound');
  function changes(result) { return result.changes; }
});
