import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ci=fs.readFileSync('.github/workflows/ci.yml','utf8');
const full=fs.readFileSync('.github/workflows/full-system-simulation.yml','utf8');
const perf=fs.readFileSync('.github/workflows/performance-smoke.yml','utf8');
const release=fs.readFileSync('.github/workflows/release-candidate.yml','utf8');
const governance=fs.readFileSync('.github/workflows/workflow-governance.yml','utf8');

for (const [name,source] of [['ci',ci],['full-system',full],['performance',perf],['release',release],['governance',governance]]) {
  test(`${name} GitHub workflow uses read-only repository permissions or inherits the hardened full-system contract`, () => {
    assert.match(source,/contents: read/);
  });
}

test('dependency-installing workflows use deterministic npm ci without npm install fallback', () => {
  for (const source of [ci,perf]) {
    assert.match(source,/npm ci/);
    assert.doesNotMatch(source,/npm install/);
    assert.doesNotMatch(source,/if \[ -f package-lock\.json \]/);
  }
  assert.match(full,/npm run build:gate/);
});

test('GitHub Node setup uses npm cache where dependency installation is heavy', () => {
  for (const source of [ci,full,perf]) assert.match(source,/cache: npm/);
  assert.match(release,/uses: \.\/\.github\/workflows\/full-system-simulation\.yml/);
});

test('runtime UAT workflow inherits exact-artifact PostgreSQL preparation from the reusable full-system gate', () => {
  assert.match(full,/db:postgres:prepare:artifact/);
  assert.doesNotMatch(full,/run: npm run db:postgres:prepare\s*$/m);
  assert.match(release,/uses: \.\/\.github\/workflows\/full-system-simulation\.yml/);
  assert.doesNotMatch(release,/db:postgres:prepare/);
});

test('manual performance smoke cleans up the API process group', () => {
  assert.match(perf,/setsid npm run start/);
  assert.match(perf,/kill -TERM -- "-\$pid"/);
  assert.match(perf,/kill -KILL -- "-\$pid"/);
});
