import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));

test('local pre-push gate generates the local Prisma client before the service-independent regression suite', () => {
  assert.equal(pkg.scripts['test:dependency-free'], 'node --test tests/*.test.mjs');
  const preflight = pkg.scripts['ci:preflight:local'];
  assert.match(preflight, /workflow:validate/);
  assert.match(preflight, /validate:repo/);
  assert.match(preflight, /db:local:generate/);
  assert.match(preflight, /test:dependency-free/);
  assert.ok(
    preflight.indexOf('db:local:generate') < preflight.indexOf('test:dependency-free'),
    'Prisma Client must be generated before runtime-backed tests import @prisma/client',
  );
  assert.doesNotMatch(preflight, /npm ci|db:local:push|db:local:seed|build:gate|uat:browser|postgres/);
});

test('Ubuntu-first preflight is exposed directly through npm with no root launcher', () => {
  assert.equal(fs.existsSync('RUN-GITHUB-PREFLIGHT.cmd'), false);
  assert.ok(pkg.scripts['ci:preflight:local']);
});
