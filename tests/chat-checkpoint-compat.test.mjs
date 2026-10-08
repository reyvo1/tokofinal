import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('checkpoint handoff preserves progress and redacts secrets without Git metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 't360-chat-v121-'));
  try {
    for (const directory of [
      'scripts', 'config', 'docs', 'instructions', '.github', '.chatgpt',
      'work-items/active', 'work-items/completed', 'work-items/generated/T360-TEST',
    ]) mkdirSync(join(root, directory), { recursive: true });

    cpSync('scripts/generate-chat-context.mjs', join(root, 'scripts', 'generate-chat-context.mjs'));
    writeJson(join(root, 'config', 'chat-handoff.json'), {
      version: '1.2.1',
      timezone: 'Asia/Makassar',
      systemInstructionMaxChars: 8000,
      outputDirectory: 'handoff/generated',
      includeMaximumActiveItems: 3,
      includeMaximumGitChanges: 20,
      includeNextReadyBacklog: true,
      copyToClipboardOnWindows: false,
      openGeneratedFilesOnWindows: false,
      includeHandoffMaxChars: 5000,
      includeChecklistMaxChars: 3000,
      redactedEnvironmentKeys: ['JWT_SECRET', 'DATABASE_URL', 'TOKEN', 'PASSWORD', 'SECRET'],
    });
    writeJson(join(root, 'config', 'implementation-backlog.json'), { items: [] });
    writeJson(join(root, 'work-items', 'active', 'T360-TEST.json'), {
      id: 'T360-TEST', backlogKey: 'tenant', title: 'Tenant isolation', phase: 'IMPLEMENTATION',
      risk: 'HIGH', module: 'tenant', wave: 'W0', featureFlag: '', updatedAt: '2026-08-02T09:00:00.000Z',
    });
    writeFileSync(join(root, 'work-items', 'generated', 'T360-TEST', 'TASK.md'), '# Task\n');
    writeFileSync(
      join(root, 'work-items', 'generated', 'T360-TEST', 'SESSION-HANDOFF.md'),
      '# Handoff\nINVENTORY-DAN-SALES-SUDAH-SELESAI\nJWT_SECRET=rahasia-jangan-bocor\n',
    );
    writeFileSync(
      join(root, 'work-items', 'generated', 'T360-TEST', 'IMPLEMENTATION-CHECKLIST.md'),
      '# Checklist\n- [x] Inventory\n- [x] Sales\n',
    );
    writeFileSync(join(root, 'instructions', 'SYSTEM-INSTRUCTIONS.md'), '# Instructions\n' + 'A'.repeat(1200));
    writeFileSync(join(root, 'docs', 'PROJECT-STATE.md'), '## Official checkpoint\n```text\nRC_TEST\n```\n');
    writeFileSync(join(root, 'docs', 'DEVELOPMENT-KIT.md'), '# Kit\n');
    writeJson(join(root, 'package.json'), { name: 'fixture', version: '0.5.3' });
    writeFileSync(join(root, 'VERSION'), '0.5.3\n');

    const result = spawnSync(process.execPath, ['scripts/generate-chat-context.mjs', 'generate', '--quiet'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const first = readFileSync(join(root, 'handoff', 'generated', 'FIRST-CHAT.md'), 'utf8');
    assert.match(first, /INVENTORY-DAN-SALES-SUDAH-SELESAI/);
    assert.match(first, /SESSION-HANDOFF\.md/);
    assert.match(first, /IMPLEMENTATION-CHECKLIST\.md/);
    assert.match(first, /JWT_SECRET[:=] <REDACTED>/);
    assert.ok(!first.includes('rahasia-jangan-bocor'));
    assert.match(first, /ZIP yang diunggah bersama pesan ini/);
    assert.match(first, /Dibuat dari: `-`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
