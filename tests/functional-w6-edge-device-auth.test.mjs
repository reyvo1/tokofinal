import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const schemas=['../apps/api/prisma/schema.prisma','../apps/api/prisma/schema.sqlite.prisma','../apps/api/prisma/schema.postgresql.prisma'].map(read);
const auth=read('../apps/api/src/extensions/edge-device-auth.service.ts');
const ctrl=read('../apps/api/src/extensions/edge-sync.controller.ts');
const service=read('../apps/api/src/extensions/extensions.service.ts');
const migration=read('../database/migrations/T360-20260911-edge-device-signature/postgresql-expand.sql');

test('device credentials keep encrypted verifier material and one-time nonce ledger in every schema',()=>{
 for(const schema of schemas){
  assert.match(schema,/encryptedSecret\s+String\?/);
  assert.match(schema,/model DeviceAuthNonce/);
  assert.match(schema,/@@unique\(\[credentialId, nonce\]\)/);
 }
 assert.match(migration,/DeviceAuthNonce/);
 assert.match(migration,/encryptedSecret/);
});

test('credential rotation encrypts the device secret while preserving non-reversible fingerprint',()=>{
 assert.match(service,/secretHash = createHash\('sha256'\)/);
 assert.match(service,/encryptedSecret: this\.secrets\.encryptText\(secret\)/);
 assert.match(service,/Secret hanya ditampilkan sekali/);
});

test('signed edge authentication verifies clock, HMAC and replay nonce fail-closed',()=>{
 assert.match(auth,/maxClockSkewMs = 5 \* 60_000/);
 assert.match(auth,/createHmac\('sha256', secret\)/);
 assert.match(auth,/timingSafeEqual/);
 assert.match(auth,/deviceAuthNonce\.create/);
 assert.match(auth,/P2002/);
 assert.match(auth,/replay ditolak/);
});

test('edge node has dedicated signed pull push ack routes without operator JWT',()=>{
 assert.match(ctrl,/@Public\(\)/);
 assert.match(ctrl,/@Post\('pull'\)/); assert.match(ctrl,/authenticate\(headers, 'sync\.pull'/);
 assert.match(ctrl,/@Post\('push'\)/); assert.match(ctrl,/authenticate\(headers, 'sync\.push'/);
 assert.match(ctrl,/@Post\('ack'\)/); assert.match(ctrl,/authenticate\(headers, 'sync\.ack'/);
 assert.match(service,/edgeSyncPull/); assert.match(service,/edgeSubmitOfflineTransactions/); assert.match(service,/edgeAcknowledgeSync/);
});
