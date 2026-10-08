import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(file, 'utf8');
const health = read('apps/api/src/app.controller.ts');
const build = read('scripts/run-build-gate.mjs');
const builtBrowser = read('scripts/run-built-browser-uat.mjs');
const browser = read('scripts/browser-uat.mjs');
const stage20 = read('scripts/run-stage20-release-readiness.mjs');
const staging = read('scripts/staging-certification.mjs');
const load = read('scripts/load-test.mjs');
const candidate = read('scripts/verify-uat-candidate.mjs');
const promotion = read('scripts/verify-production-promotion.mjs');
const smoke = read('scripts/production-smoke.mjs');
const ready = read('scripts/verify-production-ready.mjs');

test('build gate writes a fail-closed exact six-app build artifact manifest', () => {
  assert.match(build, /build-artifact-manifest-latest\.json/);
  assert.match(build, /buildArtifactManifest/);
  assert.match(build, /evidence\.buildArtifactId = artifactManifest\.artifact\.id/);
  assert.match(build, /status: 'FAIL'.*artifact: null/s);
});

test('runtime health and browser UAT carry exact build artifact identity', () => {
  assert.match(health, /buildArtifactId: process\.env\.T360_BUILD_ARTIFACT_ID/);
  assert.match(builtBrowser, /T360_BUILD_ARTIFACT_ID: artifact\.current\.id/);
  assert.match(builtBrowser, /T360_EXPECTED_BUILD_ARTIFACT_ID: artifact\.current\.id/);
  assert.match(browser, /Runtime build artifact tidak cocok/);
});

test('Stage-20, staging certification and load evidence reject a different runtime artifact', () => {
  assert.match(stage20, /buildGate\.buildArtifactId !== buildArtifact\.current\.id/);
  assert.match(stage20, /T360_BUILD_ARTIFACT_ID: buildArtifact\.current\.id/);
  assert.match(staging, /runtime build artifact mismatch/);
  assert.match(load, /expected-build-artifact-id/);
  assert.match(load, /runtimeBuildArtifactId/);
});

test('UAT candidate binds build, browser and Stage-20 to one artifact ID', () => {
  assert.match(candidate, /BUILD_ARTIFACT_MANIFEST/);
  assert.match(candidate, /wrapper\?\.buildArtifactId !== buildArtifactId/);
  assert.match(candidate, /stageData\?\.buildArtifactId !== buildArtifactId/);
  assert.match(candidate, /buildArtifactId, checks/);
});

test('promotion requires UAT, Stage-20, staging, load and human approval for one artifact', () => {
  assert.match(promotion, /UAT candidate berasal dari build artifact berbeda/);
  assert.match(promotion, /Stage-20 berasal dari build artifact berbeda/);
  assert.match(promotion, /Staging certification berasal dari build artifact berbeda/);
  assert.match(promotion, /Load evidence tidak membuktikan build artifact/);
  assert.match(promotion, /Approval buildArtifactId tidak cocok/);
});

test('production smoke and final ready gate require the promoted artifact without rebuild drift', () => {
  assert.match(smoke, /T360_PRODUCTION_EXPECTED_BUILD_ARTIFACT_ID/);
  assert.match(smoke, /deployed build artifact mismatch/);
  assert.match(ready, /Production promotion gate berasal dari build artifact berbeda/);
  assert.match(ready, /Production smoke tidak membuktikan build artifact yang dipromosikan/);
  assert.match(ready, /Deployment attestation buildArtifactId tidak cocok/);
});
