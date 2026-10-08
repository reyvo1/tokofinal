import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(new URL(`../${p}`, import.meta.url),'utf8');
const schemas=['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);

test('payment provider event receipt exists in all schemas',()=>{
  for(const s of schemas){
    assert.match(s,/model PaymentProviderEvent\s*\{/);
    assert.match(s,/@@unique\(\[integrationId, eventId\]\)/);
    assert.match(s,/requestHash\s+String/);
  }
});

test('public provider callback requires signature and uses encrypted integration secret',()=>{
  const c=read('apps/api/src/payments/payments.controller.ts');
  const s=read('apps/api/src/payments/payments.service.ts');
  assert.match(c,/@Public\(\)[\s\S]*providers\/:integrationId\/callback/);
  assert.match(c,/x-toko360-signature/);
  assert.match(s,/createHmac\('sha256'/);
  assert.match(s,/timingSafeEqual/);
  assert.match(s,/decryptText\(integration\.encryptedSecrets\)/);
  assert.match(s,/integration\.status !== 'CONNECTED'/);
});

test('callback is amount checked, provider-reference deduped, and posts through order accounting flow',()=>{
  const o=read('apps/api/src/orders/orders.service.ts');
  assert.match(o,/async confirmProviderPayment\(/);
  assert.match(o,/payment\.amount\.equals\(input\.amount\)/);
  assert.match(o,/externalRef: input\.externalRef[\s\S]*status: 'PAID'/);
  assert.match(o,/this\.postPrepayment\(/);
  assert.match(o,/Payment already|Payment sudah PAID/);
});

test('provider event replay is request-hash bound',()=>{
  const s=read('apps/api/src/payments/payments.service.ts');
  assert.match(s,/integrationId_eventId/);
  assert.match(s,/existing\.requestHash !== requestHash/);
  assert.match(s,/eventId callback sudah pernah dipakai dengan payload berbeda/);
});

test('payment integration can be connected and secret rotated without exposing secret',()=>{
  const d=read('apps/api/src/platform/dto/platform.dto.ts');
  const c=read('apps/api/src/platform/platform.controller.ts');
  const s=read('apps/api/src/platform/platform.service.ts');
  assert.match(d,/class UpdateIntegrationDto/);
  assert.match(d,/CONNECTED/);
  assert.match(c,/@Patch\('integrations\/:id'\)/);
  assert.match(s,/async updateIntegration\(/);
  assert.match(s,/secretRotated/);
  assert.match(s,/hasSecrets: Boolean\(encryptedSecrets\)/);
});

test('reconciliation endpoint requires payment.reconcile',()=>{
  const c=read('apps/api/src/payments/payments.controller.ts');
  assert.match(c,/@Permissions\('payment\.reconcile'\)/);
  assert.match(c,/@Get\('provider-events'\)/);
});
