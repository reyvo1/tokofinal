import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('GitHub heavy simulation does not provision unused Redis and proves the DB-polling worker with a live job instead', () => {
  const workflow = fs.readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');
  const compose = fs.readFileSync('.github/ci/docker-compose.ci.yml', 'utf8');
  const worker = fs.readFileSync('apps/worker/src/index.ts', 'utf8');
  assert.doesNotMatch(workflow, /redis:7-alpine|REDIS_URL/);
  assert.doesNotMatch(compose, /^\s*redis:/m);
  assert.match(worker, /reportJob\.findMany\([\s\S]*status: 'PENDING'/);
  assert.match(worker, /reportJob\.updateMany\([\s\S]*status: 'RUNNING'/);
  assert.match(workflow, /npm run ci:worker:probe/);
});
