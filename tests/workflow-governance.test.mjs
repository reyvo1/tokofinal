import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const policy = JSON.parse(readFileSync('config/workflow-policy.json', 'utf8'));
const modules = JSON.parse(readFileSync('config/module-delivery-map.json', 'utf8'));

test('workflow policy has ordered phases and critical domains', () => {
  assert.equal(policy.phaseOrder.INTAKE, 0);
  assert.ok(policy.phaseOrder.RELEASED > policy.phaseOrder.IMPLEMENTATION);
  assert.ok(policy.criticalImpactDomains.includes('accounting'));
  assert.ok(policy.criticalImpactDomains.includes('inventory'));
});

test('module waves have unique ids and valid dependencies', () => {
  const ids = modules.waves.map((wave) => wave.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const wave of modules.waves) {
    for (const dependency of wave.dependsOn ?? []) assert.ok(ids.includes(dependency), `${wave.id} depends on unknown ${dependency}`);
    assert.ok(wave.exitCriteria.length > 0);
  }
});

test('workflow manifests pass machine validation', () => {
  const result = spawnSync(process.execPath, ['scripts/workflow.mjs', 'validate'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('workflow governance installs deterministic validator dependencies before TypeScript-backed repository validation', () => {
  const source = readFileSync('.github/workflows/workflow-governance.yml', 'utf8');
  const install = source.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
  const validate = source.indexOf('node scripts/validate-repo.mjs');
  assert.ok(install >= 0 && validate > install);
  assert.match(source, /cache-dependency-path: package-lock\.json/);
});
