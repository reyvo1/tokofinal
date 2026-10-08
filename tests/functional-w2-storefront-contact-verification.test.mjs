import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.controller.ts', import.meta.url), 'utf8');
const dto = readFileSync(new URL('../apps/api/src/storefront-customer/dto/storefront-customer.dto.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../apps/api/prisma/schema.prisma', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../apps/api/prisma/seed.ts', import.meta.url), 'utf8');
const storefront = readFileSync(new URL('../apps/storefront/app/page.tsx', import.meta.url), 'utf8');
const localEnv = readFileSync(new URL('../.env.local.example', import.meta.url), 'utf8');
const prodEnv = readFileSync(new URL('../.env.postgres.example', import.meta.url), 'utf8');

const sqliteMigration = readFileSync(new URL('../database/migrations/T360-20260911-customer-contact-verification/sqlite-expand.sql', import.meta.url), 'utf8');
const postgresMigration = readFileSync(new URL('../database/migrations/T360-20260911-customer-contact-verification/postgresql-expand.sql', import.meta.url), 'utf8');

test('customer contact verification persists verification lifecycle and never stores plaintext code', () => {
  assert.match(schema, /emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /phoneVerifiedAt\s+DateTime\?/);
  assert.match(schema, /model CustomerVerificationToken/);
  assert.match(schema, /codeHash\s+String/);
  const tokenModel = schema.match(/model CustomerVerificationToken \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(tokenModel, /\n\s*code\s+String/);
  assert.match(service, /hash\(code, 10\)/);
  assert.match(service, /compare\(dto\.code, row\.codeHash\)/);
  assert.match(service, /attempts >= 5/);
  assert.match(service, /10 \* 60 \* 1000/);
  assert.match(service, /60_000/);
  assert.match(service, /targetHash !== targetHash/);
  assert.match(service, /claimed\.count !== 1/);
});

test('verification endpoints require the existing opaque customer session and support request plus confirm', () => {
  assert.match(controller, /@Post\('verification\/request'\)/);
  assert.match(controller, /requestVerification\(@Body\(\) dto: RequestCustomerVerificationDto/);
  assert.match(controller, /@Post\('verification\/confirm'\)/);
  assert.match(controller, /confirmVerification\(@Body\(\) dto: ConfirmCustomerVerificationDto/);
  assert.match(controller, /x-customer-session/);
  assert.match(dto, /IsIn\(\['EMAIL','PHONE'\]\)/);
  assert.match(dto, /MinLength\(8\)/);
  assert.match(dto, /MaxLength\(8\)/);
});

test('verification is queued through notification templates and production does not expose debug codes', () => {
  assert.match(seed, /CUSTOMER_VERIFY_EMAIL/);
  assert.match(seed, /CUSTOMER_VERIFY_PHONE/);
  assert.match(seed, /channel: 'EMAIL'/);
  assert.match(seed, /channel: 'SMS'/);
  assert.match(service, /tx\.notification\.create/);
  assert.match(service, /CUSTOMER_VERIFICATION_DEBUG_CODE/);
  assert.match(service, /NODE_ENV[^\n]+production/);
  assert.match(localEnv, /CUSTOMER_VERIFICATION_DEBUG_CODE=true/);
  assert.match(prodEnv, /CUSTOMER_VERIFICATION_DEBUG_CODE=false/);
});

test('storefront lets a signed-in customer request and confirm email or phone verification', () => {
  assert.match(storefront, /storefront\/account\/verification\/request/);
  assert.match(storefront, /storefront\/account\/verification\/confirm/);
  assert.match(storefront, /emailVerifiedAt/);
  assert.match(storefront, /phoneVerifiedAt/);
  assert.match(storefront, /Kode verifikasi harus tepat 8 digit/);
  assert.match(storefront, /Verifikasi email/);
  assert.match(storefront, /Verifikasi telepon/);
});

test('sqlite and postgres expansion migrations carry the same verification storage contract', () => {
  for (const migration of [sqliteMigration, postgresMigration]) {
    assert.match(migration, /emailVerifiedAt/);
    assert.match(migration, /phoneVerifiedAt/);
    assert.match(migration, /CustomerVerificationToken/);
    assert.match(migration, /targetHash/);
    assert.match(migration, /codeHash/);
    assert.match(migration, /attempts/);
    assert.match(migration, /expiresAt/);
    assert.match(migration, /consumedAt/);
  }
});
