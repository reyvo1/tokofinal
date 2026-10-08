import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const auth = read('apps/api/src/branch-sync/branch-sync-auth.service.ts');
const guard = read('apps/api/src/branch-sync/branch-sync-auth.guard.ts');
const service = read('apps/api/src/branch-sync/branch-sync.service.ts');
const controller = read('apps/api/src/branch-sync/branch-sync.controller.ts');
const schemas = ['schema.prisma', 'schema.sqlite.prisma', 'schema.postgresql.prisma']
  .map((f) => ({ name: f, src: read(`apps/api/prisma/${f}`) }));

// POST-1A transport security.
//
// The device path (apps/api/src/extensions/edge-device-auth.service.ts) already established the
// pattern; this checks the peer path actually followed it rather than inventing a weaker one. A
// branch server is the higher-value target: it holds every queued event for a whole store, so a
// replayed signature there re-delivers a batch of business mutations, not one.

// ---------------------------------------------------------------- nonce replay

test('a spent nonce is refused by a unique constraint, not by a lookup', () => {
  for (const { name, src } of schemas) {
    assert.ok(src.includes('model SyncPeerNonce {'), `${name} must declare SyncPeerNonce`);
  }
  // Prisma emits @@unique as a separate CREATE UNIQUE INDEX; the runtime proof lives in
  // post1a-idempotency-runtime.test.mjs, which asserts the index exists in a real database.
  assert.match(schemas[0].src, /model SyncPeerNonce[\s\S]*@@unique\(\[peerId, nonce\]\)/);
  assert.match(auth, /tx\.syncPeerNonce\.create\(/);
  assert.match(auth, /error\.code === 'P2002'\) \{[\s\S]{0,240}?throw new UnauthorizedException\('Nonce peer sync sudah pernah dipakai \(replay ditolak\)\.'\)/);
});

test('the signature covers the payload, so a captured request cannot be re-pointed', () => {
  // Signing only the operation name would let an operator capture a small pull signature and reuse
  // it to inject a different batch of events.
  assert.match(auth, /const payloadHash = createHash\('sha256'\)\.update\(this\.stableJson\(payload\)\)\.digest\('hex'\);/);
  assert.match(auth, /const canonical = \['v1', node\.id, peerNode\.id, requestAt\.toISOString\(\), nonce, operation, payloadHash\]\.join\('\\n'\);/);
  assert.match(auth, /const expected = createHmac\('sha256', secret\)\.update\(canonical\)\.digest\('hex'\);/);
});

test('signature comparison is constant-time and length-guarded', () => {
  // timingSafeEqual throws on a length mismatch, so an unguarded call turns a malformed header into
  // a 500 instead of a clean 401.
  // A bare source substring avoids embedding regex literals inside a regex literal, which is a
  // syntax error in JS — the earlier version of this assertion could not even parse.
  assert.ok(
    auth.includes("if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;"),
    'safeEqualHex must reject a non-64-hex digest before calling timingSafeEqual',
  );
  assert.match(auth, /timingSafeEqual\(a, b\)/);
});

test('the signing digest is key-order independent', () => {
  // The same request serialised twice must produce the same signature, or every retry fails.
  assert.match(auth, /Object\.keys\(row\)\.sort\(\)/);
});

test('clock skew is bounded', () => {
  assert.match(auth, /private readonly maxClockSkewMs = 5 \* 60_000;/);
  assert.match(auth, /Math\.abs\(Date\.now\(\) - requestAt\.getTime\(\)\) > this\.maxClockSkewMs/);
});

// ---------------------------------------------------------------- trust boundaries

test('a cross-tenant peer is refused before any business mutation is reached', () => {
  // A valid signature from another company must not be usable here, even though it verifies.
  assert.match(auth, /if \(node\.companyId !== peerNode\.companyId\) throw new UnauthorizedException\('Peer berada pada tenant berbeda\.'\)/);
});

test('a node may not sign as its own peer', () => {
  assert.match(auth, /if \(nodeCode === peerNodeCode\) throw new UnauthorizedException/);
});

test('an unregistered or deactivated peer is refused', () => {
  assert.match(auth, /where: \{ nodeId: node\.id, peerNodeId: peerNode\.id, isActive: true \}/);
  assert.match(auth, /if \(!registration\) throw new UnauthorizedException\('Peer tidak terdaftar aktif pada node pengirim\.'\)/);
});

test('an undecodable secret is a rejection, not a crash', () => {
  // A secret stored by an older version, or a corrupted row, must produce a clean 401 that tells the
  // operator to rotate — never a 500 that looks like a server fault.
  assert.match(auth, /try \{\s*secret = this\.secrets\.decryptText\(registration\.sharedSecretRef\);\s*\} catch \{\s*throw new UnauthorizedException\('Secret peer tidak dapat didekode; credential perlu dirotasi\.'\);/);
});

// ---------------------------------------------------------------- the dual-path rule

test('a request is either a session or a signature, never a blend', () => {
  // The failure this prevents: a request carrying BOTH a valid operator session and a valid-but-
  // different peer signature, where whichever check ran first silently decided the tenant.
  assert.match(guard, /const SIGNATURE_HEADERS = \['x-toko360-signature', 'x-toko360-node-code', 'x-toko360-peer-node-code'\]/);
  // A partial header set must not fall through to the session path: that would let a caller bypass
  // the peer path by sending one header and omitting the rest.
  assert.match(guard, /if \(present\.length === 0\) return true;/);
  assert.match(guard, /if \(present\.length !== SIGNATURE_HEADERS\.length\) \{\s*\/\/ A partial signature set[\s\S]*throw new UnauthorizedException\('Header signature peer sync tidak lengkap\.'\);/);
});

test('the signature, not the URL or body, decides the tenant', () => {
  assert.match(guard, /request\.user = \{ \.\.\.\(request\.user \?\? \{\}\), companyId: identity\.companyId, sub: `sync-peer:\$\{identity\.nodeId\}` \};/);
});

test('the receiving side rejects a body that names a different peer than the signature', () => {
  // Without this, a branch could sign honestly as itself and then name another peer in the body,
  // delivering events into a queue it was never authorised to write to.
  assert.match(service, /if \(identity && identity\.peerNodeId !== peerNodeId\) \{\s*throw new ForbiddenException\('Peer pengirim pada signature tidak cocok dengan peerNodeId pada body\.'\);/);
});

// ---------------------------------------------------------------- secret hygiene

test('the peer secret is stored encrypted and never returned to a caller', () => {
  assert.match(service, /private sealSecret\(sharedSecretRef: string\): string \{/);
  assert.match(service, /sharedSecretRef: this\.sealSecret\(dto\.sharedSecretRef\)/);
  // Both on create and on update, or a rotated secret would be stored in plaintext.
  assert.match(service, /update: \{[^}]*sharedSecretRef: this\.sealSecret\(dto\.sharedSecretRef\)/);
  assert.match(service, /rows\.map\(\(\{ sharedSecretRef: _secret, \.\.\.rest \}\) => rest\)/);
});

// ---------------------------------------------------------------- route wiring

test('exactly the three node-to-node routes are public, and each carries the guard', () => {
  // Count decorator-position occurrences only: the explanatory comment above the wire routes also
  // contains the literal text '@Public()', so a naive substring count reports four.
  const publics = controller.match(/^\s*@Public\(\)\s*$/gm)?.length ?? 0;
  assert.equal(publics, 3, 'only the three wire routes may be @Public(); the rest are operator routes');
  for (const route of ['pull', 'publish', 'receive']) {
    const block = controller.split(`@Post('nodes/:nodeId/${route}')`)[1]?.split('\n\n')[0] ?? '';
    assert.match(block, /@Public\(\)/, `${route} must be @Public() so a peer with no user session can call it`);
    assert.match(block, /@UseGuards\(BranchSyncAuthGuard\)/, `${route} must carry BranchSyncAuthGuard`);
  }
});

test('the auth service and guard are registered in the module', () => {
  const mod = read('apps/api/src/branch-sync/branch-sync.module.ts');
  assert.match(mod, /providers: \[BranchSyncService, BranchSyncAuthService, BranchSyncAuthGuard\]/);
  // SecretProtectorService comes from PlatformModule; importing PrismaModule alone would not resolve it.
  assert.match(mod, /imports: \[PrismaModule, PlatformModule\]/);
});

test('the heartbeat timestamp is advanced by the peer path, not only by the operator path', () => {
  // Last-seen evidence for a branch comes from its own sync traffic. If only the operator route
  // updated it, a healthy but unattended branch would look dead to the observability surface.
  assert.match(auth, /tx\.syncNode\.update\(\{ where: \{ id: node\.id \}, data: \{ lastHeartbeatAt: new Date\(\) \} \}\)/);
});
