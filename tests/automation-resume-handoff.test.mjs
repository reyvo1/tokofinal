import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
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

function makeRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const path of [
    'scripts', 'config', 'docs', 'instructions', '.github', '.chatgpt',
    'work-items/active', 'work-items/completed', 'work-items/generated',
  ]) mkdirSync(join(root, path), { recursive: true });
  return root;
}

test('resume preserves packet progress and invokes configured agent', () => {
  const root = makeRoot('t360-resume-');
  try {
    cpSync('scripts/start-work.mjs', join(root, 'scripts', 'start-work.mjs'));
    const id = 'T360-20260802-170500';
    const generated = join(root, 'work-items', 'generated', id);
    mkdirSync(generated, { recursive: true });
    const marker = 'PROGRES-PENTING-TIDAK-BOLEH-HILANG';
    for (const name of ['TASK.md', 'IMPLEMENTATION-CHECKLIST.md', 'AI-PROMPT.md', 'SESSION-HANDOFF.md']) {
      writeFileSync(join(generated, name), `${marker} ${name}\n`, 'utf8');
    }
    const item = {
      id,
      backlogKey: 'tenant-isolation',
      title: 'Menegakkan isolasi tenant',
      type: 'security',
      module: 'tenant',
      wave: 'W0',
      phase: 'IMPLEMENTATION',
      risk: 'HIGH',
      owner: 'test',
      featureFlag: '',
      dependencies: [],
      impacts: {
        database: 'NONE', inventory: 'HIGH', accounting: 'NONE', tax: 'NONE',
        payment: 'NONE', payroll: 'NONE', sync: 'NONE', security: 'HIGH', performance: 'LOW',
      },
      businessRules: ['Tenant scoped'],
      acceptanceCriteria: ['Tidak lintas tenant'],
      testPlan: ['Tenant test'],
      migrationPlan: 'Tidak ada',
      rollbackPlan: 'Revert',
      monitoringPlan: 'Audit log',
      securityNotes: 'Tenant isolation',
      documentation: [],
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-02T09:00:00.000Z',
    };
    writeJson(join(root, 'work-items', 'active', `${id}-tenant.json`), item);
    writeJson(join(root, 'config', 'implementation-backlog.json'), { items: [] });
    writeJson(join(root, 'config', 'module-delivery-map.json'), { waves: [{ id: 'W0', name: 'Foundation', modules: ['tenant'] }] });
    writeJson(join(root, 'config', 'workflow-policy.json'), { allowedTypes: ['security'], allowedRisks: ['HIGH'] });
    writeJson(join(root, 'config', 'work-automation.json'), {
      version: '1.1.0',
      autoInitializeGit: false,
      autoCreateBranch: false,
      openEditor: false,
      runWorkflowValidation: false,
      runRepositoryValidationWhenDependenciesExist: false,
      agent: {
        enabled: true,
        command: process.execPath,
        args: ['fake-agent.mjs', '{promptFile}'],
        workingDirectory: '{repositoryRoot}',
        autoRunOnPrepare: true,
        autoRunOnResume: true,
      },
    });
    writeFileSync(join(root, 'docs', 'PROJECT-STATE.md'), '## Official checkpoint\n```text\nRC_TEST\n```\n');
    writeFileSync(join(root, 'fake-agent.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('agent-ran.txt', process.argv[2]);\n");

    const result = spawnSync(process.execPath, ['scripts/start-work.mjs', 'resume', id], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Progres dipertahankan: 4 file paket tidak ditimpa/);
    assert.match(result.stdout, /Agent: external automation runner dijalankan/);
    for (const name of ['TASK.md', 'IMPLEMENTATION-CHECKLIST.md', 'AI-PROMPT.md', 'SESSION-HANDOFF.md']) {
      assert.match(readFileSync(join(generated, name), 'utf8'), new RegExp(marker));
    }
    assert.ok(existsSync(join(root, 'agent-ran.txt')), 'configured agent should run on resume');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('chat handoff includes current session progress and redacts secrets', () => {
  const root = makeRoot('t360-chat-');
  try {
    cpSync('scripts/generate-chat-context.mjs', join(root, 'scripts', 'generate-chat-context.mjs'));
    const id = 'T360-20260802-170501';
    const packet = join(root, 'work-items', 'generated', id);
    mkdirSync(packet, { recursive: true });
    const progressMarker = 'INVENTORY-DAN-SALES-SUDAH-SELESAI';
    writeFileSync(join(packet, 'TASK.md'), '# Task\n');
    writeFileSync(join(packet, 'SESSION-HANDOFF.md'), `# Handoff\n${progressMarker}\nJWT_SECRET=rahasia-jangan-bocor\n`);
    writeFileSync(join(packet, 'IMPLEMENTATION-CHECKLIST.md'), '# Checklist\n- [x] Inventory\n- [x] Sales\n');
    writeJson(join(root, 'work-items', 'active', `${id}-tenant.json`), {
      id, backlogKey: 'tenant', title: 'Tenant isolation', phase: 'IMPLEMENTATION', risk: 'HIGH',
      module: 'tenant', wave: 'W0', featureFlag: '', updatedAt: '2026-08-02T09:00:00.000Z',
    });
    writeJson(join(root, 'config', 'implementation-backlog.json'), { items: [] });
    writeJson(join(root, 'config', 'chat-handoff.json'), {
      version: '1.1.0', timezone: 'Asia/Makassar', systemInstructionMaxChars: 8000,
      outputDirectory: 'handoff/generated', includeMaximumActiveItems: 3,
      includeMaximumGitChanges: 20, includeNextReadyBacklog: true,
      copyToClipboardOnWindows: false, openGeneratedFilesOnWindows: false,
      includeHandoffMaxChars: 5000, includeChecklistMaxChars: 3000,
      redactedEnvironmentKeys: ['JWT_SECRET', 'DATABASE_URL', 'TOKEN', 'PASSWORD', 'SECRET'],
    });
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
    assert.match(first, new RegExp(progressMarker));
    assert.match(first, /SESSION-HANDOFF\.md/);
    assert.match(first, /IMPLEMENTATION-CHECKLIST\.md/);
    assert.ok(!first.includes('rahasia-jangan-bocor'));
    assert.match(first, /JWT_SECRET[:=] <REDACTED>/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
