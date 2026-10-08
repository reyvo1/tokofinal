import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = process.cwd();
const mode = process.argv[2] ?? 'create';
const quiet = process.argv.includes('--quiet');
const outputDir = join(root, 'handoff', 'generated');
const metadataPath = join(outputDir, 'CHECKPOINT.json');
const pathFile = join(outputDir, 'CHECKPOINT-PATH.txt');
const config = readConfig();

function readConfig() {
  const path = join(root, 'config', 'chat-handoff.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function run(command, args = []) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
  });
}

function fail(message, details = '') {
  console.error(`ERROR: ${message}`);
  if (details.trim()) console.error(details.trim());
  process.exit(1);
}

function git(args, fallback = '') {
  const result = run('git', args);
  if (result.status !== 0) fail(`Perintah Git gagal: git ${args.join(' ')}`, result.stderr || result.stdout);
  const value = result.stdout.trim();
  return value || fallback;
}

function sanitize(value, fallback) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

function activeWorkItemId() {
  const directory = join(root, 'work-items', 'active');
  if (!existsSync(directory)) return 'NO-ACTIVE-WORK';
  const items = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        const data = JSON.parse(readFileSync(join(directory, name), 'utf8'));
        return { id: data.id, updatedAt: String(data.updatedAt ?? '') };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sanitize(items[0]?.id, 'NO-ACTIVE-WORK');
}

function ensureCleanRepository() {
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') fail('Folder ini bukan repository Git.');
  const status = git(['status', '--porcelain', '--untracked-files=no'], '');
  if (status) {
    fail(
      'Checkpoint tidak dibuat karena ada perubahan tracked atau staged yang belum disimpan.',
      `${status}\n\nCommit atau pulihkan perubahan tracked tersebut terlebih dahulu agar ZIP sama dengan source resmi.`,
    );
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createCheckpoint() {
  ensureCleanRepository();
  mkdirSync(outputDir, { recursive: true });
  const branch = git(['branch', '--show-current'], 'DETACHED');
  const commit = git(['rev-parse', '--short=12', 'HEAD']);
  const fullCommit = git(['rev-parse', 'HEAD']);
  const workItemId = activeWorkItemId();
  const prefix = sanitize(config.checkpointFilePrefix, 'toko360-checkpoint');
  const fileName = `${prefix}-${workItemId}-${commit}.zip`;
  const absolutePath = join(outputDir, fileName);
  rmSync(absolutePath, { force: true });

  const archive = run('git', ['archive', '--format=zip', `--output=${absolutePath}`, 'HEAD']);
  if (archive.status !== 0) fail('Git gagal membuat checkpoint ZIP.', archive.stderr || archive.stdout);
  if (!existsSync(absolutePath) || statSync(absolutePath).size < 1) fail('Checkpoint ZIP tidak terbentuk atau kosong.');

  const metadata = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: basename(root),
    workItemId,
    branch,
    commit,
    fullCommit,
    fileName,
    relativePath: relative(root, absolutePath).replaceAll('\\', '/'),
    absolutePath: resolve(absolutePath),
    sizeBytes: statSync(absolutePath).size,
    sha256: sha256(absolutePath),
    source: 'git archive HEAD',
    workingTree: 'CLEAN',
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  writeFileSync(pathFile, `${metadata.absolutePath}\n`, 'utf8');

  if (!quiet) {
    console.log('\nCheckpoint chat berhasil dibuat.');
    console.log(`File       : ${metadata.fileName}`);
    console.log(`Branch     : ${metadata.branch}`);
    console.log(`Commit     : ${metadata.commit}`);
    console.log(`Ukuran     : ${metadata.sizeBytes} byte`);
    console.log(`SHA-256    : ${metadata.sha256}`);
    console.log(`Lokasi     : ${metadata.relativePath}`);
  }
  return metadata;
}

function readMetadata() {
  if (!existsSync(metadataPath)) fail('Metadata checkpoint belum tersedia. Jalankan mode create terlebih dahulu.');
  let metadata;
  try { metadata = JSON.parse(readFileSync(metadataPath, 'utf8')); }
  catch { fail('Metadata checkpoint tidak valid.'); }
  if (!metadata.absolutePath || !existsSync(metadata.absolutePath)) fail('File ZIP checkpoint tidak ditemukan.');
  const actualHash = sha256(metadata.absolutePath);
  if (actualHash !== metadata.sha256) fail('Hash ZIP checkpoint berubah. Buat ulang checkpoint.');
  return metadata;
}

function openHandoff() {
  const metadata = readMetadata();
  if (process.platform === 'win32') {
    spawn('explorer.exe', [`/select,${metadata.absolutePath}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    const chatUrl = String(config.chatUrl ?? 'https://chatgpt.com/');
    spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', chatUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    if (!quiet) {
      console.log(`File Explorer menyorot: ${metadata.fileName}`);
      console.log(`Browser dibuka ke: ${chatUrl}`);
    }
  } else if (!quiet) {
    console.log(`Unggah file: ${metadata.absolutePath}`);
    console.log(`Buka: ${config.chatUrl ?? 'https://chatgpt.com/'}`);
  }
}

if (mode === 'create') createCheckpoint();
else if (['open', 'reveal'].includes(mode)) openHandoff();
else if (mode === 'print') console.log(readMetadata().absolutePath);
else fail(`Mode tidak dikenal: ${mode}`);
