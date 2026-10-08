import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { npmInvocation } from '../scripts/lib/process-runner.mjs';

const root = process.cwd();

test('Windows npm commands are routed through cmd.exe', () => {
  const command = npmInvocation(['install', '--no-audit'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
  assert.equal(command.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(command.args, ['/d', '/s', '/c', 'npm.cmd', 'install', '--no-audit']);
});

test('Unix npm commands run npm directly', () => {
  const command = npmInvocation(['--version'], 'linux', {});
  assert.equal(command.command, 'npm');
  assert.deepEqual(command.args, ['--version']);
});

test('Node scripts do not directly spawn npm.cmd', () => {
  for (const relative of [
    'scripts/install-dependencies.mjs',
    'scripts/setup-local.mjs',
    'scripts/diagnose-install.mjs',
    'scripts/reset-local-db.mjs',
  ]) {
    const source = readFileSync(resolve(root, relative), 'utf8');
    assert.doesNotMatch(source, /spawn(?:Sync)?\(\s*(?:npm|'npm\.cmd'|"npm\.cmd")/);
  }
});
