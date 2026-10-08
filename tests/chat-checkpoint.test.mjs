import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function run(cwd, command, args) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'toko360-chat-checkpoint-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'work-items', 'active'), { recursive: true });
  cpSync('scripts/create-chat-checkpoint.mjs', join(root, 'scripts', 'create-chat-checkpoint.mjs'));
  writeFileSync(join(root, 'config', 'chat-handoff.json'), JSON.stringify({ checkpointFilePrefix: 'toko360-checkpoint' }));
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  writeFileSync(join(root, 'source.txt'), 'source resmi\n');
  writeFileSync(join(root, 'work-items', 'active', 'T360-TEST.json'), JSON.stringify({ id: 'T360-TEST', updatedAt: '2026-08-02T00:00:00Z' }));
  assert.equal(run(root, 'git', ['init']).status, 0);
  assert.equal(run(root, 'git', ['config', 'user.email', 'test@example.com']).status, 0);
  assert.equal(run(root, 'git', ['config', 'user.name', 'Test']).status, 0);
  assert.equal(run(root, 'git', ['add', '.']).status, 0);
  assert.equal(run(root, 'git', ['commit', '-m', 'baseline']).status, 0);
  return root;
}

test('checkpoint generator creates verifiable git archive metadata', () => {
  const root = fixture();
  const result = run(root, process.execPath, ['scripts/create-chat-checkpoint.mjs', 'create', '--quiet']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const metadata = JSON.parse(readFileSync(join(root, 'handoff', 'generated', 'CHECKPOINT.json'), 'utf8'));
  assert.equal(metadata.workItemId, 'T360-TEST');
  assert.equal(metadata.source, 'git archive HEAD');
  assert.equal(metadata.workingTree, 'CLEAN');
  assert.match(metadata.fileName, /^toko360-checkpoint-T360-TEST-[a-f0-9]{12}\.zip$/);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.ok(metadata.sizeBytes > 0);
  assert.ok(existsSync(metadata.absolutePath));
});

test('checkpoint generator refuses dirty tracked repository', () => {
  const root = fixture();
  writeFileSync(join(root, 'source.txt'), 'perubahan belum di-commit\n');
  const result = run(root, process.execPath, ['scripts/create-chat-checkpoint.mjs', 'create', '--quiet']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /perubahan tracked atau staged/i);
});

test('checkpoint generator allows unrelated untracked transfer files', () => {
  const root = fixture();
  writeFileSync(join(root, 'installer-sementara.zip'), 'tidak ikut git archive\n');
  const result = run(root, process.execPath, ['scripts/create-chat-checkpoint.mjs', 'create', '--quiet']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const metadata = JSON.parse(readFileSync(join(root, 'handoff', 'generated', 'CHECKPOINT.json'), 'utf8'));
  assert.ok(existsSync(metadata.absolutePath));
});

test('npm chat handoff creates archive before generating and opening the new-chat context', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const command = pkg.scripts['chat:handoff'];
  assert.match(command, /create-chat-checkpoint\.mjs create/);
  assert.match(command, /generate-chat-context\.mjs first --no-open/);
  assert.match(command, /create-chat-checkpoint\.mjs open/);
  assert.ok(command.indexOf(' create') < command.indexOf(' first --no-open'));
  assert.ok(command.indexOf(' first --no-open') < command.lastIndexOf(' open'));
});

test('generated first chat includes exact checkpoint artifact fields', () => {
  const source = readFileSync('scripts/generate-chat-context.mjs', 'utf8');
  assert.match(source, /function checkpointArtifact\(\)/);
  assert.match(source, /ZIP yang diunggah bersama pesan ini/);
  assert.match(source, /artifact\.sha256/);
  assert.match(source, /artifact\.fileName/);
});
