import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;

// POST-1C runs a real HTTP wire test against compiled worker output, not a
// transpiled stand-in. No clean checkout may run it before worker compilation.
test('ci:preflight:local generates SQLite Prisma then builds worker before the complete test suite', () => {
  const script = scripts['ci:preflight:local'];
  assert.equal(typeof script, 'string');
  const generate = script.indexOf('npm run db:local:generate');
  const build = script.indexOf('npm run build -w @toko360/worker');
  const allTests = script.indexOf('npm run test:dependency-free');
  assert.ok(generate >= 0 && build > generate && allTests > build,
    'preflight must prepare Prisma, compile the worker, then run ALL tests without skipping');
});

test('Telegram wire suite imports the real compiled worker module', () => {
  const suite = fs.readFileSync(path.join(root, 'tests/post1c-telegram-polling.test.mjs'), 'utf8');
  assert.match(suite, /from ['"]\.\.\/apps\/worker\/dist\/telegram-polling\.js['"]/,
    'real Telegram HTTP test must not be weakened to source/transpile-only testing');
});

test('clean-checkout worker typecheck does not rename shared API build artifacts', () => {
  const suite = fs.readFileSync(path.join(root, 'tests/worker-dist-import-runtime.test.mjs'), 'utf8');
  assert.doesNotMatch(suite, /fs\.renameSync\s*\(/,
    'concurrent tests must never hide/restore apps/api/dist in the shared repository');
  assert.match(suite, /mkdtempSync/);
  assert.match(suite, /--noEmit/);
});
