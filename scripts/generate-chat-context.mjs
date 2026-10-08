import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = process.cwd();
const config = readJson(join(root, 'config', 'chat-handoff.json'));
const outputDir = join(root, config.outputDirectory ?? 'handoff/generated');
const canonicalInstruction = join(root, 'instructions', 'SYSTEM-INSTRUCTIONS.md');
const isWindows = process.platform === 'win32';
const mode = process.argv[2] ?? 'generate';
const quiet = process.argv.includes('--quiet');
const noOpen = process.argv.includes('--no-open');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readText(path, fallback = '') {
  return existsSync(path) ? readFileSync(path, 'utf8') : fallback;
}

function write(path, content) {
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeExcerpt(text, maxChars) {
  let output = String(text ?? '');
  for (const key of config.redactedEnvironmentKeys ?? []) {
    const pattern = new RegExp(`(${escapeRegExp(key)}\\s*[:=]\\s*)([^\\r\\n]+)`, 'gi');
    output = output.replace(pattern, '$1<REDACTED>');
  }
  output = output
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, '$1<REDACTED>')
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\r\n]+/gi, '$1: <REDACTED>');
  const limit = Math.max(500, Number(maxChars ?? 4000));
  if (output.length <= limit) return output.trim();
  const headLength = Math.floor(limit * 0.6);
  const tailLength = limit - headLength;
  return `${output.slice(0, headLength).trimEnd()}\n\n...[dipotong oleh generator handoff]...\n\n${output.slice(-tailLength).trimStart()}`;
}

function packetContext(id) {
  const directory = join(root, 'work-items', 'generated', id);
  const handoffPath = join(directory, 'SESSION-HANDOFF.md');
  const checklistPath = join(directory, 'IMPLEMENTATION-CHECKLIST.md');
  return {
    handoffPath: existsSync(handoffPath) ? relative(root, handoffPath).replaceAll('\\', '/') : '-',
    handoff: existsSync(handoffPath)
      ? safeExcerpt(readFileSync(handoffPath, 'utf8'), config.includeHandoffMaxChars)
      : 'Belum ada SESSION-HANDOFF.md.',
    checklistPath: existsSync(checklistPath) ? relative(root, checklistPath).replaceAll('\\', '/') : '-',
    checklist: existsSync(checklistPath)
      ? safeExcerpt(readFileSync(checklistPath, 'utf8'), config.includeChecklistMaxChars)
      : 'Belum ada IMPLEMENTATION-CHECKLIST.md.',
  };
}

function run(command, args = []) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
  });
}

function gitValue(args, fallback = 'tidak tersedia') {
  const result = run('git', args);
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
}

function parseCheckpoint(text) {
  const officialSection = text.match(/## Official checkpoint[\s\S]*?```(?:text)?\s*([^`\r\n]+)\s*```/i);
  if (officialSection) return officialSection[1].trim();
  return text.match(/RC[0-9A-Z._-]+/)?.[0] ?? 'BELUM_DITETAPKAN';
}

function parseEnvProfile() {
  for (const file of ['.env', '.env.local', '.env.example', '.env.local.example']) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const match = readFileSync(path, 'utf8').match(/^DATABASE_PROFILE\s*=\s*([^\r\n#]+)/m);
    if (match) return { profile: match[1].trim(), source: file };
  }
  return { profile: 'belum diketahui', source: '-' };
}

function readWorkItems(directory) {
  const path = join(root, directory);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = join(path, name);
      try { return { file, data: readJson(file) }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.data.updatedAt ?? '').localeCompare(String(a.data.updatedAt ?? '')));
}

function nextReadyBacklog(completedKeys, activeKeys) {
  const path = join(root, 'config', 'implementation-backlog.json');
  if (!existsSync(path)) return null;
  const backlog = readJson(path);
  return backlog.items
    .filter((item) => !completedKeys.has(item.key) && !activeKeys.has(item.key))
    .filter((item) => (item.dependencies ?? []).every((key) => completedKeys.has(key)))
    .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999))[0] ?? null;
}

function instructionInfo() {
  const content = readText(canonicalInstruction);
  const max = Number(config.systemInstructionMaxChars ?? 8000);
  if (!content.trim()) throw new Error('Instruksi sistem canonical tidak ditemukan.');
  if (content.length > max) throw new Error(`Instruksi sistem ${content.length} karakter, melebihi batas ${max}.`);
  const adapters = [
    join(root, 'AGENTS.md'),
    join(root, '.github', 'copilot-instructions.md'),
    join(root, '.chatgpt', 'SYSTEM-INSTRUCTIONS.md'),
  ];
  mkdirSync(join(root, '.github'), { recursive: true });
  mkdirSync(join(root, '.chatgpt'), { recursive: true });
  for (const adapter of adapters) copyFileSync(canonicalInstruction, adapter);
  return {
    content,
    chars: content.length,
    max,
    checksum: createHash('sha256').update(content).digest('hex'),
  };
}

function repositoryFingerprint(paths) {
  const hash = createHash('sha256');
  for (const path of paths.filter(existsSync).sort()) {
    hash.update(relative(root, path).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function latestQuality() {
  const path = join(root, 'handoff', 'quality', 'latest.json');
  if (!existsSync(path)) return { status: 'BELUM_DIREKAM', gate: '-', finishedAt: '-', log: '-' };
  try { return readJson(path); } catch { return { status: 'TIDAK_VALID', gate: '-', finishedAt: '-', log: relative(root, path) }; }
}


function checkpointArtifact() {
  const metadataPath = join(outputDir, 'CHECKPOINT.json');
  const unavailable = {
    status: 'BELUM_DIBUAT',
    fileName: '-',
    relativePath: '-',
    sha256: '-',
    sizeBytes: 0,
    commit: '-',
    workItemId: '-',
    source: '-',
  };
  if (!existsSync(metadataPath)) return unavailable;
  try {
    const metadata = readJson(metadataPath);
    const absolutePath = metadata.absolutePath || join(root, metadata.relativePath ?? '');
    const available = Boolean(metadata.fileName && absolutePath && existsSync(absolutePath));
    return {
      status: available ? 'READY' : 'FILE_TIDAK_DITEMUKAN',
      fileName: metadata.fileName ?? '-',
      relativePath: metadata.relativePath ?? '-',
      sha256: metadata.sha256 ?? '-',
      sizeBytes: Number(metadata.sizeBytes ?? 0),
      commit: metadata.commit ?? '-',
      workItemId: metadata.workItemId ?? '-',
      source: metadata.source ?? '-',
    };
  } catch {
    return { ...unavailable, status: 'METADATA_TIDAK_VALID' };
  }
}
function currentWorkContext() {
  const path = join(root, 'handoff', 'CURRENT-WORK.md');
  return {
    path: existsSync(path) ? relative(root, path).replaceAll('\\', '/') : '-',
    content: existsSync(path)
      ? safeExcerpt(readFileSync(path, 'utf8'), config.includeHandoffMaxChars)
      : 'Belum ada handoff/CURRENT-WORK.md.',
  };
}

function buildContext() {
  const instructions = instructionInfo();
  const projectState = readText(join(root, 'docs', 'PROJECT-STATE.md'));
  const active = readWorkItems('work-items/active');
  const completed = readWorkItems('work-items/completed');
  const completedKeys = new Set(completed.map(({ data }) => data.backlogKey).filter(Boolean));
  const activeKeys = new Set(active.map(({ data }) => data.backlogKey).filter(Boolean));
  const next = config.includeNextReadyBacklog === false ? null : nextReadyBacklog(completedKeys, activeKeys);
  const env = parseEnvProfile();
  const statusResult = run('git', ['status', '--porcelain']);
  const changed = statusResult.status === 0
    ? statusResult.stdout.trim().split(/\r?\n/).filter(Boolean).slice(0, config.includeMaximumGitChanges ?? 20)
    : [];
  const version = readText(join(root, 'VERSION'), readJson(join(root, 'package.json')).version).trim();
  const checkpoint = parseCheckpoint(projectState);
  const importantPaths = [
    join(root, 'VERSION'),
    join(root, 'package.json'),
    join(root, 'docs', 'PROJECT-STATE.md'),
    join(root, 'docs', 'DEVELOPMENT-KIT.md'),
    canonicalInstruction,
    join(root, 'handoff', 'CURRENT-WORK.md'),
    ...active.map(({ file }) => file),
    ...active.flatMap(({ data }) => [
      join(root, 'work-items', 'generated', data.id, 'SESSION-HANDOFF.md'),
      join(root, 'work-items', 'generated', data.id, 'IMPLEMENTATION-CHECKLIST.md'),
    ]),
  ];
  const generatedDate = new Date();
  const timezone = config.timezone ?? 'Asia/Makassar';
  const generatedAtLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(generatedDate).replace(' ', 'T');
  return {
    generatedAt: generatedDate.toISOString(),
    generatedAtLocal,
    timezone,
    repository: basename(root),
    version,
    checkpoint,
    stateFingerprint: repositoryFingerprint(importantPaths),
    checkpointArtifact: checkpointArtifact(),
    instructions: {
      relativePath: relative(root, canonicalInstruction).replaceAll('\\', '/'),
      chars: instructions.chars,
      maxChars: instructions.max,
      sha256: instructions.checksum,
    },
    git: {
      branch: gitValue(['branch', '--show-current']),
      commit: gitValue(['rev-parse', '--short=12', 'HEAD']),
      status: changed.length ? 'DIRTY' : (statusResult.status === 0 ? 'CLEAN' : 'GIT_TIDAK_TERSEDIA'),
      changes: changed,
    },
    database: env,
    currentWork: currentWorkContext(),
    workflow: {
      active: active.slice(0, config.includeMaximumActiveItems ?? 3).map(({ file, data }) => ({
        id: data.id,
        title: data.title,
        phase: data.phase,
        risk: data.risk,
        module: data.module,
        wave: data.wave,
        featureFlag: data.featureFlag || '-',
        updatedAt: data.updatedAt,
        file: relative(root, file).replaceAll('\\', '/'),
        task: existsSync(join(root, 'work-items', 'generated', data.id, 'TASK.md'))
          ? `work-items/generated/${data.id}/TASK.md`
          : '-',
        ...packetContext(data.id),
      })),
      activeCount: active.length,
      completedCount: completed.length,
      nextReady: next ? {
        key: next.key,
        title: next.title,
        module: next.module,
        wave: next.wave,
        risk: next.risk,
      } : null,
    },
    quality: latestQuality(),
  };
}

function list(values, render, empty = '- Tidak ada.') {
  return values?.length ? values.map(render).join('\n') : empty;
}

function generateFiles() {
  mkdirSync(outputDir, { recursive: true });
  const context = buildContext();
  const systemContent = readText(canonicalInstruction);
  const activeText = list(context.workflow.active, (item) =>
    `- **${item.id}** — ${item.title}\n  - Fase: ${item.phase}; risiko: ${item.risk}; modul/wave: ${item.module}/${item.wave}\n  - Work item: \`${item.file}\`\n  - Task: \`${item.task}\`\n  - Handoff: \`${item.handoffPath}\`\n  - Checklist: \`${item.checklistPath}\`\n  - Feature flag: \`${item.featureFlag}\``);
  const currentWorkText = context.currentWork.path !== '-'
    ? `### Current working baseline\n\nSumber: \`${context.currentWork.path}\`\n\n${context.currentWork.content.split(/\r?\n/).map((line) => `> ${line}`).join('\n')}`
    : '';
  const activeProgressText = list(context.workflow.active, (item) => {
    const handoff = item.handoff.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
    const checklist = item.checklist.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
    return `### ${item.id} — Session handoff\n\nSumber: \`${item.handoffPath}\`\n\n${handoff}\n\n### ${item.id} — Checklist\n\nSumber: \`${item.checklistPath}\`\n\n${checklist}`;
  }, '');
  const progressText = [currentWorkText, activeProgressText].filter(Boolean).join('\n\n') || '- Tidak ada.';
  const changesText = list(context.git.changes, (change) => `- \`${change}\``, '- Working tree bersih atau Git belum tersedia.');
  const nextText = context.workflow.nextReady
    ? `${context.workflow.nextReady.key} — ${context.workflow.nextReady.title} (${context.workflow.nextReady.module}/${context.workflow.nextReady.wave}, ${context.workflow.nextReady.risk})`
    : 'Tidak ada tugas READY; selesaikan work item aktif atau periksa dependency.';
  const quality = context.quality;
  const artifact = context.checkpointArtifact;
  const firstChat = `# CHAT PERTAMA TOKO360 — HASIL GENERATOR\n\nKita melanjutkan proyek Toko360 dari repository/checkpoint di bawah. Gunakan source yang saya unggah pada chat ini sebagai sumber kerja. Jangan memakai baseline lama, jangan mengulang audit yang sudah ditutup tanpa bukti regression, dan jangan menganggap fitur selesai tanpa quality gate.\n\n## ZIP yang diunggah bersama pesan ini\n\n- File: \`${artifact.fileName}\`\n- Status: \`${artifact.status}\`\n- Dibuat dari: \`${artifact.source}\`\n- Commit ZIP: \`${artifact.commit}\`\n- SHA-256: \`${artifact.sha256}\`\n- Ukuran: \`${artifact.sizeBytes}\` byte\n- Lokasi lokal: \`${artifact.relativePath}\`\n\nChat baru wajib memverifikasi commit source terhadap commit ZIP di atas sebelum mengedit.\n\n## Baseline resmi\n\n- Checkpoint: \`${context.checkpoint}\`\n- Version: \`${context.version}\`\n- Repository: \`${context.repository}\`\n- State fingerprint: \`${context.stateFingerprint}\`\n- Dibuat: \`${context.generatedAtLocal}\` (${context.timezone}); UTC \`${context.generatedAt}\`\n- Instruksi sistem: \`${context.instructions.relativePath}\` — ${context.instructions.chars}/${context.instructions.maxChars} karakter\n- Instruction SHA-256: \`${context.instructions.sha256}\`\n\n## Kondisi Git\n\n- Branch: \`${context.git.branch}\`\n- Commit: \`${context.git.commit}\`\n- Status: \`${context.git.status}\`\n${changesText}\n\n## Database\n\n- Profil aktif/terdeteksi: \`${context.database.profile}\` dari \`${context.database.source}\`\n- Jangan tampilkan atau meminta credential. Jangan pernah reset/mengubah database production.\n\n## Work item aktif\n\n${activeText}\n\n- Jumlah aktif: ${context.workflow.activeCount}\n- Jumlah completed: ${context.workflow.completedCount}\n- Backlog READY berikutnya: ${nextText}\n\n## Progres aktual dari handoff dan checklist\n\n${progressText}\n\n## Quality gate terakhir\n\n- Gate: \`${quality.gate ?? '-'}\`\n- Status: \`${quality.status ?? 'BELUM_DIREKAM'}\`\n- Waktu: \`${quality.finishedAt ?? '-'}\`\n- Log: \`${quality.log ?? '-'}\`\n\n## Instruksi kerja sesi ini\n\n1. Baca \`docs/PROJECT-STATE.md\`, instruksi sistem, work item aktif, \`TASK.md\`, dan source terkait sebelum mengedit.\n2. Verifikasi checkpoint, branch, commit, schema, serta perubahan Git. Bila berbeda dari konteks ini, hentikan asumsi dan laporkan perbedaannya.\n3. Lanjutkan work item aktif pada satu langkah aman berikutnya. Bila tidak ada work item aktif, gunakan backlog READY dan workflow satu klik.\n4. Pertahankan tenant/branch isolation, permission, idempotensi, inventory movement, accounting core, tax core, audit, sync, keamanan, pagination, dan rollback sesuai dampak.\n5. Jangan membuat modul duplikat, jangan merusak workflow, jangan memakai data production untuk testing, dan jangan mengarang hasil build/test.\n6. Setelah perubahan, jalankan test yang relevan, perbarui work item/checklist/handoff, dan jelaskan dengan tegas apa yang lulus, gagal, belum diuji, atau memerlukan vendor/credential.\n\nMulai dengan memeriksa file yang diunggah dan menyebutkan: checkpoint yang terbaca, work item yang akan dilanjutkan, risiko utama, serta langkah aman pertama. Setelah itu langsung kerjakan tanpa mengulang pertanyaan yang jawabannya sudah tersedia di repository.\n`;
  const uploadChecklist = `# Berkas untuk Chat/Akun Baru\n\nUnggah atau sediakan:\n\n1. \`${artifact.fileName}\` — ZIP checkpoint otomatis dari commit \`${artifact.commit}\`.\n2. Tempel isi \`handoff/generated/FIRST-CHAT.md\` sebagai pesan pertama.\n3. Verifikasi SHA-256 ZIP: \`${artifact.sha256}\`.\n4. Gunakan \`handoff/generated/SYSTEM-INSTRUCTIONS.txt\` pada pengaturan instruksi sistem/custom instructions akun baru.\n5. Bila ada: log error yang sudah disensor, database TEST/STAGING, migration terbaru, dan bukti quality gate.\n\nJangan mengunggah \`.env\`, password, token, credential vendor, database production yang dapat diubah, biometric mentah, atau data pribadi pelanggan/karyawan.\n`;
  write(join(outputDir, 'SYSTEM-INSTRUCTIONS.txt'), systemContent);
  write(join(outputDir, 'FIRST-CHAT.md'), firstChat);
  write(join(outputDir, 'PROJECT-CONTEXT.json'), `${JSON.stringify(context, null, 2)}\n`);
  write(join(outputDir, 'UPLOAD-CHECKLIST.md'), uploadChecklist);
  return { context, systemContent, firstChat };
}

function copyWindows(path) {
  if (!isWindows || config.copyToClipboardOnWindows === false) return false;
  const escaped = resolve(path).replaceAll("'", "''");
  const result = run(process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `[Console]::OutputEncoding=[Text.UTF8Encoding]::UTF8; Set-Clipboard -Value (Get-Content -LiteralPath '${escaped}' -Raw -Encoding UTF8)`,
  ]);
  return result.status === 0;
}

function openWindows(path) {
  if (!isWindows || noOpen || config.openGeneratedFilesOnWindows === false) return;
  spawn('notepad.exe', [path], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function report(files) {
  if (quiet) return;
  console.log('\nToko360 chat handoff berhasil dibuat.');
  console.log(`Checkpoint : ${files.context.checkpoint}`);
  console.log(`Version    : ${files.context.version}`);
  console.log(`Work aktif : ${files.context.workflow.activeCount}`);
  console.log(`Instruksi  : ${files.context.instructions.chars}/${files.context.instructions.maxChars} karakter`);
  console.log(`Folder     : ${relative(root, outputDir)}`);
  console.log(`ZIP        : ${files.context.checkpointArtifact.fileName}`);
}

const files = generateFiles();
report(files);

if (mode === 'system') {
  const path = join(outputDir, 'SYSTEM-INSTRUCTIONS.txt');
  const copied = copyWindows(path);
  if (!quiet) console.log(copied ? 'Instruksi sistem telah disalin ke clipboard.' : `Buka dan salin: ${relative(root, path)}`);
  openWindows(path);
} else if (['first', 'chat', 'handoff'].includes(mode)) {
  const path = join(outputDir, 'FIRST-CHAT.md');
  const copied = copyWindows(path);
  if (!quiet) console.log(copied ? 'Chat pertama telah disalin ke clipboard.' : `Buka dan salin: ${relative(root, path)}`);
  openWindows(path);
} else if (mode === 'open') {
  openWindows(join(outputDir, 'FIRST-CHAT.md'));
}
