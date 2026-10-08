import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('full-system simulation is reusable by release/tag workflow', () => {
  const full = fs.readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');
  const release = fs.readFileSync('.github/workflows/release-candidate.yml', 'utf8');
  assert.match(full, /workflow_call:/);
  assert.match(release, /uses: \.\/\.github\/workflows\/full-system-simulation\.yml/);
  assert.match(release, /needs: full-system-gate/);
  assert.doesNotMatch(release, /npm run build:gate|npm run uat:browser:built|db:postgres:prepare/);
  assert.match(release, /full-system-gated-source/);
  assert.match(release, /sha256sum/);
});

test('release workflow never labels source archive as the tested runtime artifact', () => {
  const release = fs.readFileSync('.github/workflows/release-candidate.yml', 'utf8');
  assert.doesNotMatch(release, /name: toko360-tested-runtime/);
  assert.match(release, /source-checkpoint/);
});
