import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const backlog = JSON.parse(readFileSync('config/implementation-backlog.json', 'utf8'));
const automation = JSON.parse(readFileSync('config/work-automation.json', 'utf8'));
const delivery = JSON.parse(readFileSync('config/module-delivery-map.json', 'utf8'));
const policy = JSON.parse(readFileSync('config/workflow-policy.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('terminal work automation and documentation exist', () => {
  for (const path of ['scripts/start-work.mjs', 'docs/AUTOMATED-WORK-STARTER.md']) assert.ok(existsSync(path), `missing ${path}`);
  for (const script of ['work:auto', 'work:custom', 'work:resume', 'work:status']) assert.ok(pkg.scripts[script], `missing npm script ${script}`);
  for (const path of ['mulai-pekerjaan-otomatis.cmd', 'buat-work-item.cmd', 'lanjutkan-pekerjaan.cmd', 'status-pekerjaan.cmd']) assert.equal(existsSync(path), false, `obsolete launcher still present: ${path}`);
});

test('implementation backlog is dependency-safe and mapped to delivery waves', () => {
  const keys = backlog.items.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, 'backlog keys must be unique');
  const keySet = new Set(keys);
  const waveMap = new Map(delivery.waves.map((wave) => [wave.id, new Set(wave.modules)]));
  for (const item of backlog.items) {
    assert.ok(waveMap.has(item.wave), `${item.key} unknown wave ${item.wave}`);
    assert.ok(waveMap.get(item.wave).has(item.module), `${item.key} module ${item.module} not in ${item.wave}`);
    assert.ok(policy.allowedTypes.includes(item.type), `${item.key} invalid type`);
    assert.ok(policy.allowedRisks.includes(item.risk), `${item.key} invalid risk`);
    assert.ok(item.acceptanceCriteria.length > 0, `${item.key} missing acceptance criteria`);
    assert.ok(item.testPlan.length > 0, `${item.key} missing test plan`);
    for (const dependency of item.dependencies ?? []) assert.ok(keySet.has(dependency), `${item.key} unknown dependency ${dependency}`);
  }

  const visiting = new Set();
  const visited = new Set();
  const byKey = new Map(backlog.items.map((item) => [item.key, item]));
  function visit(key) {
    if (visiting.has(key)) assert.fail(`dependency cycle at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependencies ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of keys) visit(key);
});

test('external coding agent is safe-by-default', () => {
  assert.equal(automation.agent.enabled, false);
  assert.equal(typeof automation.autoCreateBranch, 'boolean');
  assert.equal(typeof automation.openEditor, 'boolean');
});

test('automation status command reports the real active/completed backlog state without changing work items', () => {
  const beforeActive = readdirSync('work-items/active').filter((name) => name.endsWith('.json')).sort();
  const beforeCompleted = readdirSync('work-items/completed').filter((name) => name.endsWith('.json')).sort();
  const activeWorkItems = beforeActive.map((name) => JSON.parse(readFileSync(`work-items/active/${name}`, 'utf8')));
  const completedBacklogKeys = new Set(beforeCompleted.map((name) => JSON.parse(readFileSync(`work-items/completed/${name}`, 'utf8')).backlogKey).filter(Boolean));

  const result = spawnSync(process.execPath, ['scripts/start-work.mjs', 'status'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Toko360 automated work status/);
  assert.match(result.stdout, new RegExp(`Backlog total\\s+:\\s*${backlog.items.length}`));
  assert.match(result.stdout, new RegExp(`Backlog completed\\s+:\\s*${completedBacklogKeys.size}`));
  assert.match(result.stdout, new RegExp(`Work item aktif\\s+:\\s*${activeWorkItems.length}`));
  assert.match(result.stdout, /Semua backlog otomatis sudah selesai atau sedang aktif\./);

  assert.deepEqual(readdirSync('work-items/active').filter((name) => name.endsWith('.json')).sort(), beforeActive);
  assert.deepEqual(readdirSync('work-items/completed').filter((name) => name.endsWith('.json')).sort(), beforeCompleted);
});
