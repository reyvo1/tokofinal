import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const workflow = read('.github/workflows/full-system-simulation.yml');
const fullUatWorkflow = read('.github/workflows/toko360-full-uat.yml');
const prepare = read('scripts/ci-prepare-github-simulation.mjs');
const dr = read('scripts/run-postgres-dr-drill.mjs');
const plan = JSON.parse(read('.github/ci/security-dependency-plan.json'));

test('GitHub browser/runtime URLs use localhost consistently with configured CORS origins', () => {
  const runtimeUrls = [
    'T360_API_URL: http://localhost:4000/api/v1',
    'T360_STOREFRONT_URL: http://localhost:3000',
    'T360_ADMIN_URL: http://localhost:3001',
    'T360_POS_URL: http://localhost:3002',
    'T360_EMPLOYEE_URL: http://localhost:3003',
  ];
  for (const [label, source] of [
    ['full-system simulation', workflow],
    ['full automated UAT', fullUatWorkflow],
  ]) {
    for (const value of runtimeUrls) {
      assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} must use ${value}`);
    }
    assert.doesNotMatch(
      source,
      /T360_(?:API|STOREFRONT|ADMIN|POS|EMPLOYEE)_URL: http:\/\/127\.0\.0\.1/,
      `${label} must not split browser origins between localhost and 127.0.0.1`,
    );
  }
  assert.match(prepare, /origin .* tidak tercakup CORS_ORIGINS GitHub simulation/);
  assert.match(prepare, /NEXT_PUBLIC_API_URL dan T360_API_URL wajib menunjuk API base yang sama/);
});


test('DR keeps source stage/test marker strict but permits isolated restore/dr/scratch database names', () => {
  assert.match(dr, /function lockedTarget\([^)]*\{ scratch = false \}/);
  assert.match(dr, /const scratchMarker = \/\(restore\|dr\|scratch\)\/i/);
  assert.match(dr, /\{ scratch: true \}/);
  assert.match(dr, /Database restore scratch wajib berbeda/);
  assert.match(dr, /menolak target production\/live/);
});

test('security proposal fixes production framework peers without forcing Nest 12 schematics TypeScript-6 migration', () => {
  assert.equal(plan.candidates.length, 2);
  for (const candidate of plan.candidates) {
    // next 16.3.5 kena GHSA-vcvr-r3jv-pc5j (RCE di next/og, critical). Gate `npm audit
    // --omit=dev --audit-level=high` memblokir high/critical, jadi plan harus menunjuk versi
    // yang sudah dipatch. Assertion ini mengunci KESESUAIAN plan dengan versi patched, bukan
    // versi spesifik: kalau next rilis patch lagi, plan yang harus ikut, bukan gate.
    assert.equal(candidate.direct.next, plan.candidates[0].direct.next);
    assert.ok(/^16\.[3-9]\.\d+$/.test(candidate.direct.next), `next candidate harus >= 16.3.6 (patch GHSA-vcvr-r3jv-pc5j): ${candidate.direct.next}`);
    assert.equal(candidate.direct['@nestjs/core'], '12.0.4');
    assert.equal(candidate.direct['@nestjs/platform-express'], '12.0.4');
    assert.equal(candidate.direct['@nestjs/config'], '12.0.0');
    assert.equal(candidate.direct['@nestjs/jwt'], '12.0.2');
    assert.equal(candidate.direct['@nestjs/swagger'], '12.0.1');
    assert.equal(candidate.direct['@nestjs/testing'], '12.0.3');
    assert.equal(candidate.direct['@nestjs/cli'], undefined);
    assert.equal(candidate.direct['@nestjs/schematics'], undefined);
    assert.equal(candidate.direct.typescript, undefined);
  }
  assert.equal(plan.candidates[1].direct.prisma, '6.12.0');
  assert.equal(plan.candidates[1].direct['@prisma/client'], '6.12.0');
  assert.ok(plan.notes.some((note) => /TypeScript >=6\.0/.test(note)));
});
