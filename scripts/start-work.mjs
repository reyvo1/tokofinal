import { spawnSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const root = process.cwd();
const backlogPath = join(root, 'config', 'implementation-backlog.json');
const automationPath = join(root, 'config', 'work-automation.json');
const policyPath = join(root, 'config', 'workflow-policy.json');
const deliveryPath = join(root, 'config', 'module-delivery-map.json');
const activeDir = join(root, 'work-items', 'active');
const completedDir = join(root, 'work-items', 'completed');
const generatedDir = join(root, 'work-items', 'generated');
const projectStatePath = join(root, 'docs', 'PROJECT-STATE.md');
const isWindows = process.platform === 'win32';


function currentCheckpoint() {
  if (!existsSync(projectStatePath)) return 'CHECKPOINT_BELUM_DITETAPKAN';
  const text = readFileSync(projectStatePath, 'utf8');
  const match = text.match(/## Official checkpoint[\s\S]*?```(?:text)?\s*([^`\r\n]+)\s*```/i);
  return match?.[1]?.trim() || text.match(/RC[0-9A-Z._-]+/)?.[0] || 'CHECKPOINT_BELUM_DITETAPKAN';
}

function fail(message, code = 1) {
  console.error(`\nToko360 automation error: ${message}`);
  process.exit(code);
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Tidak dapat membaca ${relative(root, path)}: ${error.message}`);
  }
}

function readJsonFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const path = join(directory, name);
      return { path, file: name, data: loadJson(path) };
    });
}

const backlog = loadJson(backlogPath);
const automation = loadJson(automationPath);
const policy = loadJson(policyPath);
const delivery = loadJson(deliveryPath);
const waves = new Map(delivery.waves.map((wave) => [wave.id, wave]));
const impactDomains = ['database', 'inventory', 'accounting', 'tax', 'payment', 'payroll', 'sync', 'security', 'performance'];

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'pekerjaan';
}

function localId(start = new Date()) {
  for (let offset = 0; offset < 60; offset += 1) {
    const now = new Date(start.getTime() + offset * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Makassar',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    const id = `T360-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
    const used = [...readJsonFiles(activeDir), ...readJsonFiles(completedDir)].some(({ data }) => data.id === id);
    if (!used) return id;
  }
  fail('Tidak dapat membuat work item ID unik. Coba lagi.');
}

function ownerName() {
  return process.env.T360_OWNER || process.env.USERNAME || process.env.USER || 'local-developer';
}

function branchPrefix(type) {
  const mapping = {
    feature: 'feature', bug: 'fix', security: 'security', migration: 'migration',
    integration: 'integration', performance: 'performance', documentation: 'docs',
    release: 'release', hotfix: 'hotfix',
  };
  return mapping[type] ?? 'feature';
}

function shellQuoteWindows(value) {
  const string = String(value);
  if (!/[\s&()\[\]{}^=;!'+,`~]/.test(string)) return string;
  return `"${string.replace(/"/g, '\\"')}"`;
}

function run(command, args = [], options = {}) {
  const { cwd = root, optional = false, capture = false } = options;
  let result;
  if (isWindows && /\.(cmd|bat)$/i.test(command)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    const line = [command, ...args].map(shellQuoteWindows).join(' ');
    result = spawnSync(comspec, ['/d', '/s', '/c', line], {
      cwd,
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
      windowsHide: true,
    });
  } else {
    result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
      windowsHide: true,
    });
  }
  if (result.error && !optional) fail(`${command} gagal dijalankan: ${result.error.message}`);
  if ((result.status ?? 1) !== 0 && !optional) {
    const detail = capture ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
    fail(`${command} keluar dengan kode ${result.status}.${detail ? `\n${detail}` : ''}`);
  }
  return result;
}

function commandExists(command) {
  if (isWindows) {
    const result = run('cmd.exe', ['/d', '/s', '/c', `where ${command}`], { optional: true, capture: true });
    return result.status === 0;
  }
  const result = run('sh', ['-lc', `command -v ${command}`], { optional: true, capture: true });
  return result.status === 0;
}

function activeItems() {
  return readJsonFiles(activeDir)
    .sort((a, b) => String(b.data.updatedAt ?? '').localeCompare(String(a.data.updatedAt ?? '')));
}

function completedKeys() {
  return new Set(readJsonFiles(completedDir).map(({ data }) => data.backlogKey).filter(Boolean));
}

function activeKeys() {
  return new Set(activeItems().map(({ data }) => data.backlogKey).filter(Boolean));
}

function nextBacklogItem() {
  const completed = completedKeys();
  const active = activeKeys();
  const candidates = backlog.items
    .filter((item) => !completed.has(item.key) && !active.has(item.key))
    .filter((item) => (item.dependencies ?? []).every((dependency) => completed.has(dependency)))
    .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
  return candidates[0] ?? null;
}

function blockedBacklogItems() {
  const completed = completedKeys();
  const active = activeKeys();
  return backlog.items
    .filter((item) => !completed.has(item.key) && !active.has(item.key))
    .map((item) => ({ ...item, missing: (item.dependencies ?? []).filter((dependency) => !completed.has(dependency)) }))
    .filter((item) => item.missing.length > 0)
    .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
}

function defaultImpacts() {
  return Object.fromEntries(impactDomains.map((domain) => [domain, 'NONE']));
}

function migrationPlanFor(item) {
  if (item.impacts?.database === 'NONE') return 'Tidak ada perubahan database. Jika implementasi berubah, buat migration plan baru sebelum fase DESIGN.';
  return 'Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.';
}

function createWorkItem(source) {
  mkdirSync(activeDir, { recursive: true });
  const id = localId();
  const now = new Date().toISOString();
  const title = source.title;
  const item = {
    id,
    backlogKey: source.key ?? '',
    title,
    type: source.type,
    module: source.module,
    wave: source.wave,
    phase: 'ANALYSIS',
    risk: source.risk,
    owner: ownerName(),
    featureFlag: source.featureFlag ?? '',
    dependencies: source.dependencies ?? [],
    impacts: { ...defaultImpacts(), ...(source.impacts ?? {}) },
    businessRules: source.businessRules?.length ? source.businessRules : [
      'Definisikan invariant utama modul berdasarkan Development Kit sebelum implementasi.',
      'Semua mutasi harus tenant-scoped, auditable, dan idempotent bila dapat diulang.',
    ],
    acceptanceCriteria: source.acceptanceCriteria?.length ? source.acceptanceCriteria : [
      'Fitur memenuhi kebutuhan bisnis terukur tanpa merusak modul yang sudah stabil.',
      'Permission, audit, error handling, dan dokumentasi tersedia.',
    ],
    testPlan: source.testPlan?.length ? source.testPlan : [
      'Tambahkan unit test untuk aturan bisnis utama.',
      'Tambahkan integration test untuk tenant scope, idempotency, dan error path.',
    ],
    migrationPlan: source.migrationPlan ?? migrationPlanFor(source),
    rollbackPlan: source.rollbackPlan ?? 'Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.',
    monitoringPlan: source.monitoringPlan ?? 'Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.',
    securityNotes: source.securityNotes ?? 'Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.',
    documentation: source.documentation?.length ? source.documentation : ['docs/DEVELOPMENT-KIT.md', 'docs/DEVELOPMENT-WORKFLOW.md'],
    automation: {
      createdBy: 'scripts/start-work.mjs',
      packetDirectory: `work-items/generated/${id}`,
      createdFromBacklog: Boolean(source.key),
      configVersion: automation.version,
    },
    createdAt: now,
    updatedAt: now,
  };
  const file = join(activeDir, `${id}-${slugify(title)}.json`);
  writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
  return { item, file };
}

function findLikelyPaths(moduleName) {
  const normalized = moduleName.toLowerCase();
  const roots = [
    join(root, 'apps', 'api', 'src', 'modules'),
    join(root, 'apps'),
    join(root, 'packages'),
    join(root, 'docs'),
  ];
  const matches = [];
  function walk(directory, depth = 0) {
    if (!existsSync(directory) || depth > 3 || matches.length >= 30) return;
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      let stat;
      try { stat = statSync(path); } catch { continue; }
      const rel = relative(root, path).replaceAll('\\', '/');
      if (name.toLowerCase().includes(normalized) || rel.toLowerCase().includes(normalized)) matches.push(rel);
      if (stat.isDirectory() && !['node_modules', '.git', '.next', 'dist'].includes(name)) walk(path, depth + 1);
    }
  }
  for (const directory of roots) walk(directory);
  return [...new Set(matches)].slice(0, 20);
}

function markdownList(values, empty = '- Belum ditentukan.') {
  if (!values?.length) return empty;
  return values.map((value) => `- ${value}`).join('\n');
}

function writePacketFile(path, content, preserveExisting) {
  if (preserveExisting && existsSync(path) && readFileSync(path, 'utf8').trim()) {
    return { path, written: false, preserved: true };
  }
  writeFileSync(path, content, 'utf8');
  return { path, written: true, preserved: false };
}

function createPacket(item, file, options = {}) {
  const preserveExisting = options.preserveExisting ?? true;
  const directory = join(generatedDir, item.id);
  mkdirSync(directory, { recursive: true });
  const likelyPaths = findLikelyPaths(item.module);
  const branch = `${branchPrefix(item.type)}/${item.id.toLowerCase()}-${slugify(item.title)}`;
  const wave = waves.get(item.wave);
  const task = `# ${item.id} — ${item.title}\n\n## Mulai dari sini\n\n- Work item: \`${relative(root, file).replaceAll('\\', '/')}\`\n- Modul: \`${item.module}\`\n- Wave: \`${item.wave} — ${wave?.name ?? 'Unknown'}\`\n- Risiko: \`${item.risk}\`\n- Fase awal: \`${item.phase}\`\n- Branch yang disarankan: \`${branch}\`\n- Feature flag: \`${item.featureFlag || 'tidak ditentukan'}\`\n\n## Tujuan\n\n${item.title}. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.\n\n## Aturan bisnis\n\n${markdownList(item.businessRules)}\n\n## Acceptance criteria\n\n${markdownList(item.acceptanceCriteria)}\n\n## Dampak lintas modul\n\n| Domain | Dampak |\n|---|---|\n${impactDomains.map((domain) => `| ${domain} | ${item.impacts[domain]} |`).join('\n')}\n\n## Test plan\n\n${markdownList(item.testPlan)}\n\n## Migration plan\n\n${item.migrationPlan}\n\n## Rollback plan\n\n${item.rollbackPlan}\n\n## Monitoring plan\n\n${item.monitoringPlan}\n\n## Security notes\n\n${item.securityNotes}\n\n## File yang kemungkinan relevan\n\n${markdownList(likelyPaths.map((path) => `\`${path}\``), '- Cari implementasi terkait menggunakan nama modul dan event bisnis.') }\n\n## Dokumen sumber\n\n${markdownList(item.documentation.map((path) => `\`${path}\``))}\n`;
  const checklist = `# Implementation Checklist — ${item.id}\n\n## Analysis\n\n- [ ] Baca work item dan seluruh dokumen sumber.\n- [ ] Audit implementasi yang sudah ada; jangan membuat modul duplikat.\n- [ ] Tetapkan system of record, state machine, invariant, dan failure modes.\n- [ ] Konfirmasi dampak database, inventory, accounting, tax, payment, payroll, sync, security, dan performance.\n\n## Design\n\n- [ ] Tetapkan API/DTO/event contract.\n- [ ] Tetapkan permission dan tenant/branch scope.\n- [ ] Tetapkan idempotency key serta retry behavior.\n- [ ] Tetapkan migration, index, pagination, retention, dan rollback.\n- [ ] Tetapkan accounting/tax posting rule bila relevan.\n\n## Implementation\n\n- [ ] Implementasi kecil dan modular.\n- [ ] Hindari jurnal, pajak, stok, atau notification logic tersebar di modul.\n- [ ] Tambahkan audit event dan structured error.\n- [ ] Perbarui dokumentasi dan feature flag.\n\n## Verification\n\n${item.testPlan.map((test) => `- [ ] ${test}`).join('\n')}\n- [ ] Jalankan \`npm run quality:fast\`.\n- [ ] Jalankan \`npm run quality:full\` sebelum release.\n- [ ] Catat evidence dan known issues pada work item/handoff.\n\n## Release\n\n- [ ] UAT atau staging selesai.\n- [ ] Rollback plan telah diuji atau direview.\n- [ ] Monitoring aktif.\n- [ ] Work item dipindahkan ke RELEASE_READY, RELEASED, lalu CLOSED sesuai evidence.\n`;
  const prompt = `# Prompt Pelaksana — ${item.id}\n\nKerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.\n\n## Identitas\n- ID: ${item.id}\n- Judul: ${item.title}\n- Modul: ${item.module}\n- Wave: ${item.wave}\n- Risk: ${item.risk}\n- Work item file: ${relative(root, file).replaceAll('\\', '/')}\n\n## Instruksi wajib\n1. Baca docs/DEVELOPMENT-KIT.md, docs/DEVELOPMENT-WORKFLOW.md, work item, dan dokumen sumbernya.\n2. Audit source yang ada sebelum mengedit.\n3. Kerjakan hanya scope work item dan pertahankan kompatibilitas.\n4. Semua data harus company/branch scoped.\n5. Semua mutasi yang dapat diulang harus idempotent.\n6. Stok hanya berubah melalui inventory movement; jurnal melalui accounting core; pajak melalui tax core.\n7. Tambahkan permission, audit, validation, pagination/index bila relevan.\n8. Tambahkan test sesuai test plan dan jalankan quality gate.\n9. Perbarui work item dengan evidence, perubahan, known issues, dan rollback.\n10. Jangan memakai database production, credential, atau data pelanggan nyata.\n\n## Acceptance criteria\n${markdownList(item.acceptanceCriteria)}\n\n## Test plan\n${markdownList(item.testPlan)}\n\nBerikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.\n`;
  const handoff = `# Session Handoff — ${item.id}\n\n- Checkpoint baseline: \`${currentCheckpoint()}\`\n- Work item: \`${relative(root, file).replaceAll('\\', '/')}\`\n- Branch: \`${branch}\`\n- Phase: \`${item.phase}\`\n- Owner: \`${item.owner}\`\n\n## Sudah dikerjakan\n\n- Work item dan paket pekerjaan dibuat otomatis.\n\n## Belum dikerjakan\n\n- [ ] Audit source.\n- [ ] Design.\n- [ ] Implementation.\n- [ ] Verification.\n\n## Hasil quality gate\n\nBelum dijalankan.\n\n## Known issues\n\nBelum ada.\n\n## Langkah aman berikutnya\n\nBuka \`TASK.md\`, lakukan audit source, lalu isi hasil analisis sebelum berpindah ke fase DESIGN.\n`;
  const taskFile = join(directory, 'TASK.md');
  const checklistFile = join(directory, 'IMPLEMENTATION-CHECKLIST.md');
  const promptFile = join(directory, 'AI-PROMPT.md');
  const handoffFile = join(directory, 'SESSION-HANDOFF.md');
  const fileResults = [
    writePacketFile(taskFile, task, preserveExisting),
    writePacketFile(checklistFile, checklist, preserveExisting),
    writePacketFile(promptFile, prompt, preserveExisting),
    writePacketFile(handoffFile, handoff, preserveExisting),
  ];
  for (const path of [taskFile, checklistFile, promptFile, handoffFile]) {
    if (!existsSync(path) || !readFileSync(path, 'utf8').trim()) {
      fail(`Paket kerja gagal dibuat atau kosong: ${relative(root, path)}`);
    }
  }
  return {
    directory,
    taskFile,
    checklistFile,
    promptFile,
    handoffFile,
    branch,
    preservedFiles: fileResults.filter((result) => result.preserved).map((result) => result.path),
  };
}

function gitStatusPath(line) {
  const raw = String(line).slice(3).trim();
  const renamedPath = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
  return renamedPath.replace(/^"|"$/g, '').replaceAll('\\', '/');
}

function isAutomationArtifact(line) {
  const path = gitStatusPath(line);
  return path.startsWith('work-items/active/') || path.startsWith('work-items/generated/');
}

function ensureGitBranch(branch) {
  if (!automation.autoCreateBranch) return { created: false, reason: 'disabled' };
  if (!commandExists('git')) return { created: false, reason: 'git-not-found' };
  let initialized = false;
  if (!existsSync(join(root, '.git'))) {
    if (!automation.autoInitializeGit) return { created: false, reason: 'not-a-git-repository' };
    const result = run('git', ['init', '-b', 'main'], { optional: true, capture: true });
    if (result.status !== 0) return { created: false, reason: 'git-init-failed' };
    initialized = true;
  }
  const status = run('git', ['status', '--porcelain'], { optional: true, capture: true });
  const dirtyLines = String(status.stdout ?? '').split(/\r?\n/).filter(Boolean);
  const blockingChanges = dirtyLines.filter((line) => !isAutomationArtifact(line));
  if (blockingChanges.length && !initialized) {
    return { created: false, reason: 'working-tree-dirty', blockingChanges };
  }
  const branchExists = run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { optional: true, capture: true }).status === 0;
  const switchResult = branchExists
    ? run('git', ['switch', branch], { optional: true, capture: true })
    : run('git', ['switch', '-c', branch], { optional: true, capture: true });
  if (switchResult.status !== 0) return { created: false, reason: 'branch-switch-failed' };
  return { created: true, initialized, branch };
}

function validateCreatedWork() {
  if (!automation.runWorkflowValidation) return;
  console.log('\n==> Memvalidasi work item');
  run(process.execPath, ['scripts/workflow.mjs', 'validate']);
  if (automation.runRepositoryValidationWhenDependenciesExist && existsSync(join(root, 'node_modules', 'typescript'))) {
    console.log('\n==> Memvalidasi repository');
    run(process.execPath, ['scripts/validate-repo.mjs']);
  } else {
    console.log('Repository validation penuh dilewati karena dependency belum tersedia. Jalankan npm run quality:fast setelah setup.');
  }
}

function openPacket(packet) {
  if (!automation.openEditor) return;
  if (isWindows) {
    if (automation.preferredEditor === 'code' && commandExists('code.cmd')) {
      const comspec = process.env.ComSpec || 'cmd.exe';
      spawn(comspec, ['/d', '/s', '/c', `code.cmd -r "${root}" "${packet.taskFile}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return;
    }
    if (automation.fallbackEditor === 'notepad') {
      spawn('notepad.exe', [packet.taskFile], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return;
    }
  } else if (commandExists('code')) {
    spawn('code', ['-r', root, packet.taskFile], { detached: true, stdio: 'ignore' }).unref();
  }
}

function runConfiguredAgent(packet) {
  const agent = automation.agent ?? {};
  if (!agent.enabled || !agent.command) return { started: false, reason: 'disabled' };
  const substitutions = {
    '{promptFile}': packet.promptFile,
    '{taskFile}': packet.taskFile,
    '{repositoryRoot}': root,
  };
  const args = (agent.args ?? []).map((arg) => substitutions[arg] ?? arg
    .replaceAll('{promptFile}', packet.promptFile)
    .replaceAll('{taskFile}', packet.taskFile)
    .replaceAll('{repositoryRoot}', root));
  const cwd = String(agent.workingDirectory ?? '{repositoryRoot}').replaceAll('{repositoryRoot}', root);
  const result = run(agent.command, args, { cwd, optional: true, capture: false });
  return { started: result.status === 0, reason: result.status === 0 ? 'started' : 'failed' };
}

function printResult(item, file, packet, gitResult, agentResult) {
  console.log('\n============================================================');
  console.log('PEKERJAAN SIAP DIKERJAKAN');
  console.log('============================================================');
  console.log(`ID       : ${item.id}`);
  console.log(`Judul    : ${item.title}`);
  console.log(`Modul    : ${item.module}`);
  console.log(`Wave     : ${item.wave}`);
  console.log(`Risk     : ${item.risk}`);
  console.log(`Work item: ${relative(root, file)}`);
  console.log(`Task     : ${relative(root, packet.taskFile)}`);
  console.log(`AI prompt: ${relative(root, packet.promptFile)}`);
  if (gitResult.created) console.log(`Git      : branch ${gitResult.branch}`);
  else console.log(`Git      : branch tidak dibuat (${gitResult.reason})`);
  if (agentResult.started) console.log('Agent    : external automation runner dijalankan.');
  else if ((automation.agent ?? {}).enabled) console.log(`Agent    : tidak berjalan (${agentResult.reason}).`);
  else console.log('Agent    : nonaktif; source code tetap dikerjakan developer/AI setelah paket dibuka.');
  console.log('\nLangkah berikutnya: baca TASK.md, audit source, lalu mulai fase DESIGN dan IMPLEMENTATION.');
}

function prepare(source) {
  const { item, file } = createWorkItem(source);
  const packet = createPacket(item, file, { preserveExisting: false });
  const gitResult = ensureGitBranch(packet.branch);
  validateCreatedWork();
  const agentResult = (automation.agent?.autoRunOnPrepare ?? true)
    ? runConfiguredAgent(packet)
    : { started: false, reason: 'prepare-disabled' };
  openPacket(packet);
  printResult(item, file, packet, gitResult, agentResult);
  return item;
}

async function askCustom(rl) {
  console.log('\nJenis: feature, bug, security, migration, integration, performance, documentation, release, hotfix');
  const type = (await rl.question('Jenis pekerjaan [feature]: ')).trim() || 'feature';
  if (!policy.allowedTypes.includes(type)) fail(`Jenis tidak valid: ${type}`);
  const title = (await rl.question('Judul pekerjaan: ')).trim();
  if (!title) fail('Judul wajib diisi.');
  const module = (await rl.question('Nama modul: ')).trim();
  if (!module) fail('Nama modul wajib diisi.');
  console.log(`Wave tersedia: ${[...waves.keys()].join(', ')}`);
  const wave = (await rl.question('Delivery wave [W0]: ')).trim().toUpperCase() || 'W0';
  if (!waves.has(wave)) fail(`Wave tidak valid: ${wave}`);
  const risk = (await rl.question('Risk [MEDIUM]: ')).trim().toUpperCase() || 'MEDIUM';
  if (!policy.allowedRisks.includes(risk)) fail(`Risk tidak valid: ${risk}`);
  return {
    title, type, module, wave, risk, dependencies: [], impacts: defaultImpacts(),
    businessRules: [
      'Definisikan aturan bisnis dan invariant berdasarkan Development Kit sebelum implementasi.',
      'Semua perubahan harus tenant-scoped, auditable, dan aman terhadap retry sesuai dampaknya.',
    ],
    acceptanceCriteria: [
      'Pekerjaan selesai sesuai scope dan tidak menimbulkan regression pada modul yang sudah stabil.',
      'Test, dokumentasi, rollback, monitoring, dan security notes tersedia.',
    ],
    testPlan: [
      'Unit test aturan bisnis utama.',
      'Integration test happy path, error path, permission, dan tenant scope.',
    ],
    documentation: ['docs/DEVELOPMENT-KIT.md', 'docs/DEVELOPMENT-WORKFLOW.md'],
  };
}

async function chooseActive(rl, requestedId) {
  const items = activeItems();
  if (!items.length) return null;
  if (requestedId) return items.find(({ data }) => data.id === requestedId) ?? null;
  if (items.length === 1) return items[0];
  console.log('\nPekerjaan aktif:');
  items.forEach(({ data }, index) => console.log(`${index + 1}. ${data.id} | ${data.phase} | ${data.module} | ${data.title}`));
  const answer = (await rl.question('Pilih nomor [1]: ')).trim() || '1';
  const index = Number.parseInt(answer, 10) - 1;
  return items[index] ?? null;
}

async function resume(rl, requestedId) {
  const selected = await chooseActive(rl, requestedId);
  if (!selected) {
    console.log('Belum ada pekerjaan aktif. Gunakan mode pekerjaan berikutnya atau pekerjaan khusus.');
    return;
  }
  const packet = createPacket(selected.data, selected.path, { preserveExisting: true });
  const branchResult = ensureGitBranch(packet.branch);
  const branchBlocked = ['working-tree-dirty', 'branch-switch-failed'].includes(branchResult.reason);
  const agentResult = branchBlocked || automation.agent?.autoRunOnResume === false
    ? { started: false, reason: branchBlocked ? branchResult.reason : 'resume-disabled' }
    : runConfiguredAgent(packet);
  openPacket(packet);
  console.log(`\nMelanjutkan ${selected.data.id}: ${selected.data.title}`);
  console.log(`Task: ${relative(root, packet.taskFile)}`);
  console.log(`Checklist: ${relative(root, packet.checklistFile)}`);
  console.log(`Handoff: ${relative(root, packet.handoffFile)}`);
  console.log(`AI prompt: ${relative(root, packet.promptFile)} (${readFileSync(packet.promptFile, 'utf8').length} karakter)`);
  if (packet.preservedFiles.length) {
    console.log(`Progres dipertahankan: ${packet.preservedFiles.length} file paket tidak ditimpa.`);
  }
  if (agentResult.started) console.log('Agent: external automation runner dijalankan untuk pekerjaan aktif.');
  else if ((automation.agent ?? {}).enabled) console.log(`Agent: tidak berjalan (${agentResult.reason}).`);
  else console.log('Agent: nonaktif. Aktifkan dan isi command pada config/work-automation.json untuk coding otomatis.');
  if (!branchResult.created) {
    console.log(`Branch tidak dipindahkan: ${branchResult.reason}`);
    if (branchResult.blockingChanges?.length) {
      console.log('Perubahan yang harus disimpan atau dibatalkan terlebih dahulu:');
      for (const line of branchResult.blockingChanges) console.log(`- ${line}`);
    }
  }
}

function status() {
  const completed = completedKeys();
  const active = activeItems();
  const next = nextBacklogItem();
  console.log('\nToko360 automated work status');
  console.log(`Backlog total     : ${backlog.items.length}`);
  console.log(`Backlog completed : ${completed.size}`);
  console.log(`Work item aktif   : ${active.length}`);
  if (next) console.log(`Tugas siap berikut: ${next.key} — ${next.title}`);
  else {
    const blocked = blockedBacklogItems();
    console.log(`Tugas blocked     : ${blocked.length}`);
    if (!blocked.length) console.log('Semua backlog otomatis sudah selesai atau sedang aktif.');
  }
  for (const { data } of active) console.log(`- ${data.id} | ${data.phase} | ${data.module} | ${data.title}`);
}

async function main() {
  const [mode = 'menu', requestedId] = process.argv.slice(2);
  const rl = createInterface({ input, output });
  try {
    if (mode === 'next') {
      const active = activeItems();
      if (active.length && !process.argv.includes('--force-new')) {
        console.log('Masih ada pekerjaan aktif. Sistem akan membukanya agar pekerjaan tidak menumpuk.');
        await resume(rl, requestedId);
        return;
      }
      const next = nextBacklogItem();
      if (!next) {
        status();
        console.log('\nTidak ada tugas roadmap yang READY. Selesaikan dependency aktif atau buat pekerjaan khusus.');
        return;
      }
      prepare(next);
      return;
    }
    if (mode === 'custom') {
      prepare(await askCustom(rl));
      return;
    }
    if (mode === 'resume') {
      await resume(rl, requestedId);
      return;
    }
    if (mode === 'status') {
      status();
      return;
    }
    console.log('============================================================');
    console.log('Toko360 — Mulai Pekerjaan Otomatis');
    console.log('============================================================');
    console.log('1. Ambil tugas roadmap berikutnya secara otomatis');
    console.log('2. Buat pekerjaan khusus');
    console.log('3. Lanjutkan pekerjaan aktif');
    console.log('4. Lihat status workflow');
    console.log('0. Keluar');
    const choice = (await rl.question('\nPilih [1]: ')).trim() || '1';
    if (choice === '1') {
      const active = activeItems();
      if (active.length) {
        console.log('\nMasih ada pekerjaan aktif. Sistem membuka pekerjaan tersebut agar workflow tidak menumpuk.');
        await resume(rl);
      } else {
        const next = nextBacklogItem();
        if (!next) status();
        else prepare(next);
      }
    } else if (choice === '2') prepare(await askCustom(rl));
    else if (choice === '3') await resume(rl);
    else if (choice === '4') status();
  } finally {
    rl.close();
  }
}

await main();
