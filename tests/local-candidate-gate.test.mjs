import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const script = fs.readFileSync('scripts/run-local-candidate-gate.mjs', 'utf8');

test('local candidate gate runs safe local verification before GitHub heavy simulation', () => {
  assert.equal(pkg.scripts['uat:pre-github:local'], 'node scripts/run-local-candidate-gate.mjs');
  assert.match(script, /db:migrations:rehearse:sqlite/);
  assert.match(script, /quality:full/);
  assert.match(script, /ci:uat:coverage/);
  assert.match(script, /GITHUB_FULL_SYSTEM_SIMULATION/);
  assert.match(script, /humanStage20Uat: 'PENDING'/);
  assert.doesNotMatch(script, /uat:candidate:verify|production:promotion:verify|production:smoke/);
});

test('local candidate gate refuses PostgreSQL and production-like runtime locally', () => {
  assert.match(script, /menolak environment production\/live/);
  assert.match(script, /wajib memakai SQLite scratch\/local/);
  assert.match(script, /NODE_ENV/);
  assert.match(script, /DATABASE_PROFILE/);
  assert.equal(fs.existsSync('RUN-LOCAL-CANDIDATE-GATE.cmd'), false);
});

test('local candidate evidence is source-bound and keeps human UAT separate', () => {
  assert.match(script, /sourceFingerprint\(root\)/);
  assert.match(script, /sourceIdentityAfter\.value !== sourceBefore\.value/);
  assert.match(script, /scenarioCount !== 12/);
  assert.match(script, /Human Stage-20 UAT remains PENDING/);
});
