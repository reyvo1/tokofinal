import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_ENTRIES = [
  'apps', 'packages', 'database', 'scripts', 'tests', 'config',
  path.join('.github', 'workflows'),
  'package.json', 'package-lock.json', 'VERSION', '.env.example', '.env.local.example', '.env.postgres.example',
];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'logs', 'data']);
const SKIP_FILE = /(?:next-env\.d\.ts|\.db(?:-journal|-shm|-wal)?|\.sqlite3?(?:-journal|-shm|-wal)?|\.log|\.tsbuildinfo)$/i;

function isSkippedRelative(relative) {
  const normalized = relative.replaceAll('\\', '/');
  const parts = normalized.split('/');
  return parts.some((part) => SKIP_DIRS.has(part)) || SKIP_FILE.test(parts.at(-1) || '');
}

function filesUnder(root, entry) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  const result = [];
  const visit = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.isDirectory() && SKIP_DIRS.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.isFile() && !SKIP_FILE.test(item.name)) result.push(full);
    }
  };
  visit(absolute);
  return result;
}

function trackedFiles(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  const args = ['ls-files', '-z', '--', ...ROOT_ENTRIES.map((entry) => entry.replaceAll('\\', '/'))];
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return null;
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((relative) => !isSkippedRelative(relative))
    .map((relative) => path.join(root, relative))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
}

function authoritativeFiles(root) {
  const tracked = trackedFiles(root);
  if (tracked) return tracked;
  return ROOT_ENTRIES.flatMap((entry) => filesUnder(root, entry));
}

export function sourceFingerprint(root = process.cwd()) {
  const files = authoritativeFiles(root)
    .map((file) => ({ file, relative: path.relative(root, file).replaceAll('\\', '/') }))
    .sort((a, b) => a.relative.localeCompare(b.relative));
  const hash = crypto.createHash('sha256');
  for (const { file, relative } of files) {
    const body = fs.readFileSync(file);
    hash.update(relative); hash.update('\0'); hash.update(String(body.length)); hash.update('\0'); hash.update(body); hash.update('\0');
  }
  return { algorithm: 'sha256', value: hash.digest('hex'), fileCount: files.length };
}
