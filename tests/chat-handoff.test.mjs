import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync('config/chat-handoff.json', 'utf8'));
const canonical = readFileSync('instructions/SYSTEM-INSTRUCTIONS.md', 'utf8');

test('embedded system instructions stay within configured 8k limit', () => {
  assert.equal(config.systemInstructionMaxChars, 8000);
  assert.ok(canonical.length > 1000, 'instructions should be substantive');
  assert.ok(canonical.length <= config.systemInstructionMaxChars, `${canonical.length} exceeds limit`);
});

test('agent instruction adapters match canonical source', () => {
  for (const path of ['AGENTS.md', '.github/copilot-instructions.md', '.chatgpt/SYSTEM-INSTRUCTIONS.md']) {
    assert.ok(existsSync(path), `missing ${path}`);
    assert.equal(readFileSync(path, 'utf8'), canonical, `${path} diverged from canonical instructions`);
  }
});

test('dynamic first-chat generator produces safe current context', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-chat-context.mjs', 'generate', '--quiet'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const path of [
    'handoff/generated/SYSTEM-INSTRUCTIONS.txt',
    'handoff/generated/FIRST-CHAT.md',
    'handoff/generated/PROJECT-CONTEXT.json',
    'handoff/generated/UPLOAD-CHECKLIST.md',
  ]) assert.ok(existsSync(path), `missing ${path}`);
  const first = readFileSync('handoff/generated/FIRST-CHAT.md', 'utf8');
  const context = JSON.parse(readFileSync('handoff/generated/PROJECT-CONTEXT.json', 'utf8'));
  assert.match(first, /RC0\.5\.3\.1_EMBEDDED_INSTRUCTIONS_DYNAMIC_CHAT_HANDOFF/);
  assert.equal(context.version, '0.5.3');
  assert.equal(context.instructions.chars, canonical.length);
  assert.equal(context.currentWork.path, 'handoff/CURRENT-WORK.md');
  assert.match(first, /Current working baseline/);
  assert.match(first, /handoff\/CURRENT-WORK\.md/);
  assert.ok(!first.includes('DATABASE_URL='));
  assert.ok(!first.includes('JWT_SECRET='));
  assert.ok(!first.includes('TELEGRAM_BOT_TOKEN='));
});

test('chat handoff is terminal-first and Windows launchers are absent', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const script of ['chat:generate', 'chat:system', 'chat:first', 'chat:checkpoint', 'chat:handoff']) assert.ok(pkg.scripts[script], `missing npm script ${script}`);
  for (const path of ['pindah-akun-atau-chat.cmd', 'pindah-chat-saja.cmd', 'salin-system-instructions.cmd', 'buat-chat-pertama.cmd']) assert.equal(existsSync(path), false, `obsolete launcher still present: ${path}`);
});
