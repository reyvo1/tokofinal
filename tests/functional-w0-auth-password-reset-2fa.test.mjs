import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../apps/api/src/auth/auth.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/auth/auth.controller.ts', import.meta.url), 'utf8');
const loginDto = readFileSync(new URL('../apps/api/src/auth/dto/login.dto.ts', import.meta.url), 'utf8');
const totp = readFileSync(new URL('../apps/api/src/auth/totp.ts', import.meta.url), 'utf8');
const schemas = ['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma'].map((name) => readFileSync(new URL(`../apps/api/prisma/${name}`, import.meta.url), 'utf8'));

for (const schema of schemas) {
  test('auth schema carries encrypted 2FA state and single-use reset tokens', () => {
    assert.match(schema, /twoFactorEnabled\s+Boolean\s+@default\(false\)/);
    assert.match(schema, /twoFactorSecretEncrypted\s+String\?/);
    assert.match(schema, /twoFactorPendingSecretEncrypted\s+String\?/);
    assert.match(schema, /twoFactorRecoveryCodes\s+Json\?/);
    assert.match(schema, /model PasswordResetToken[\s\S]*tokenHash\s+String\s+@unique[\s\S]*usedAt\s+DateTime\?/);
  });
}

test('login requires the second factor before any staff session is issued', () => {
  const gate = service.indexOf('if (user.twoFactorEnabled)');
  const session = service.indexOf('tx.authSession.create');
  assert.ok(gate >= 0 && session > gate, '2FA gate must run before authSession.create');
  assert.match(service, /TWO_FACTOR_REQUIRED/);
  assert.match(service, /TWO_FACTOR_INVALID/);
  assert.match(loginDto, /twoFactorCode\?: string/);
});

test('TOTP implementation is dependency-free and supports encrypted pending/active secrets', () => {
  assert.match(totp, /createHmac\('sha1'/);
  assert.match(totp, /timingSafeEqual/);
  assert.match(totp, /otpauth:\/\/totp\//);
  assert.match(service, /this\.secrets\.encryptText\(secret\)/);
  assert.match(service, /this\.secrets\.decryptText/);
  assert.match(service, /twoFactorPendingSecretEncrypted/);
  assert.match(service, /recoveryCodes\.map\(\(value\) => this\.hashRecoveryCode/);
});

test('recovery codes are hashed, one-time and can be regenerated only after a second-factor check', () => {
  assert.match(service, /toko360-recovery:/);
  assert.match(service, /hashes\.filter\(\(_, itemIndex\) => itemIndex !== index\)/);
  assert.match(service, /TWO_FACTOR_RECOVERY_REGENERATED/);
  assert.match(controller, /@Post\('2fa\/recovery-codes'\)/);
});

test('password reset is opaque, generic, single-use and revokes active sessions', () => {
  assert.match(controller, /@Post\('password-reset\/request'\)/);
  assert.match(controller, /@Post\('password-reset\/confirm'\)/);
  assert.match(service, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(service, /Jika akun aktif ditemukan/);
  assert.match(service, /PASSWORD_RESET_REQUESTED/);
  assert.match(service, /PASSWORD_RESET_COMPLETED/);
  assert.match(service, /updateMany\(\{ where: \{ id: reset\.id, usedAt: null, expiresAt: \{ gt: now \} \}/);
  assert.match(service, /revokeReason: 'PASSWORD_RESET'/);
});

test('plaintext reset tokens are exposed only behind an explicit non-production development switch', () => {
  assert.match(service, /!\['production', 'staging'\]\.includes\(environment\)/);
  assert.match(service, /AUTH_EXPOSE_RESET_TOKEN/);
  assert.match(service, /developmentResetToken/);
});
