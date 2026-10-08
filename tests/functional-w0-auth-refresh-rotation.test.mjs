import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../apps/api/src/auth/auth.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/auth/auth.controller.ts', import.meta.url), 'utf8');
const adminHelper = readFileSync(new URL('../apps/admin/app/auth-fetch.ts', import.meta.url), 'utf8');
const posHelper = readFileSync(new URL('../apps/pos/app/auth-fetch.ts', import.meta.url), 'utf8');
const employeeHelper = readFileSync(new URL('../apps/employee-portal/app/auth-fetch.ts', import.meta.url), 'utf8');
const schemas = ['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma'].map((name) => readFileSync(new URL(`../apps/api/prisma/${name}`, import.meta.url), 'utf8'));

test('staff auth issues opaque refresh tokens but persists only a SHA-256 hash', () => {
  assert.match(service, /randomBytes\(48\)\.toString\('base64url'\)/);
  assert.match(service, /createHash\('sha256'\)\.update\(token\)\.digest\('hex'\)/);
  assert.match(service, /refreshTokenHash/);
  assert.match(service, /return \{ accessToken, refreshToken, accessExpiresAt, sessionExpiresAt, user: payload \}/);
  for (const schema of schemas) assert.match(schema, /refreshTokenHash\s+String\?\s+@unique/);
});

test('refresh rotates atomically so the previous opaque token cannot win a concurrent replay', () => {
  assert.match(controller, /@Public\(\)[\s\S]*@Post\('refresh'\)/);
  assert.match(service, /where: \{ refreshTokenHash: tokenHash \}/);
  assert.match(service, /updateMany\([\s\S]*refreshTokenHash: tokenHash[\s\S]*refreshTokenHash: nextRefreshTokenHash/);
  assert.match(service, /updated\.count !== 1/);
  assert.match(service, /REFRESH_TOKEN_ROTATED/);
  assert.match(service, /Refresh token sudah digunakan atau dicabut/);
});

test('admin POS and employee portal share single-flight automatic refresh behavior', () => {
  for (const helper of [adminHelper, posHelper, employeeHelper]) {
    assert.match(helper, /let rotation/);
    assert.match(helper, /\/auth\/refresh/);
    assert.match(helper, /response\.status\s*!==?\s*401|r\.status\s*!==?\s*401/);
    assert.match(helper, /refreshToken/);
  }
  assert.match(adminHelper, /toko360:auth-refreshed/);
  assert.match(posHelper, /toko360:pos-auth-refreshed/);
  assert.match(employeeHelper, /toko360:employee-auth-refreshed/);
});
