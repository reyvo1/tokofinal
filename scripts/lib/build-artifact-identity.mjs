import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BUILD_ARTIFACT_COMPONENTS = [
  { id: 'api', path: 'apps/api/dist' },
  { id: 'worker', path: 'apps/worker/dist' },
  { id: 'storefront', path: 'apps/storefront/.next' },
  { id: 'admin', path: 'apps/admin/.next' },
  { id: 'pos', path: 'apps/pos/.next' },
  { id: 'employee-portal', path: 'apps/employee-portal/.next' },
];

// 'cache' dan 'route-cache' adalah cache runtime yang ditulis Next.js saat app diserve
// (`next start` mengisi `.next/server/route-cache/...` untuk setiap route yang dirender).
// Keduanya turunan runtime, bukan output build, jadi tidak boleh ikut di-hash: kalau ikut,
// identitas artifact berubah begitu app menerima request pertama, dan R8 akan gagal dengan
// "Build artifact berubah" padahal tidak ada build yang berbeda. Output build sungguhan
// (BUILD_ID, server chunks, manifests, static assets) tetap ter-cover penuh.
const SKIP_DIRS = new Set(['cache', 'route-cache']);
const SKIP_FILES = new Set(['trace']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function filesUnder(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Build artifact component belum tersedia: ${relativeRoot}`);
  }
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      if (entry.isFile() && SKIP_FILES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(absoluteRoot);
  if (!files.length) throw new Error(`Build artifact component kosong: ${relativeRoot}`);
  return files;
}

function componentIdentity(root, component) {
  const files = filesUnder(root, component.path)
    .map((file) => ({ file, relative: path.relative(path.join(root, component.path), file).replaceAll('\\', '/') }))
    .sort((a, b) => a.relative.localeCompare(b.relative));
  const hash = crypto.createHash('sha256');
  let totalBytes = 0;
  for (const { file, relative } of files) {
    const body = fs.readFileSync(file);
    totalBytes += body.length;
    const fileHash = sha256(body);
    hash.update(relative); hash.update('\0'); hash.update(String(body.length)); hash.update('\0'); hash.update(fileHash); hash.update('\0');
  }
  return { id: component.id, path: component.path, sha256: hash.digest('hex'), fileCount: files.length, totalBytes };
}

export function buildArtifactIdentity(root = process.cwd()) {
  const components = BUILD_ARTIFACT_COMPONENTS.map((component) => componentIdentity(root, component));
  const hash = crypto.createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;
  for (const component of components) {
    fileCount += component.fileCount;
    totalBytes += component.totalBytes;
    hash.update(component.id); hash.update('\0'); hash.update(component.path); hash.update('\0'); hash.update(component.sha256); hash.update('\0');
    hash.update(String(component.fileCount)); hash.update('\0'); hash.update(String(component.totalBytes)); hash.update('\0');
  }
  return { algorithm: 'sha256', id: hash.digest('hex'), fileCount, totalBytes, components };
}

export function buildArtifactManifest({ root = process.cwd(), sourceIdentity, generatedAt = new Date().toISOString() } = {}) {
  if (!sourceIdentity?.value) throw new Error('sourceIdentity wajib untuk build artifact manifest.');
  return { generatedAt, status: 'PASS', sourceIdentity, artifact: buildArtifactIdentity(root) };
}

export function verifyBuildArtifactManifest(manifest, root = process.cwd(), expectedSourceFingerprint = null) {
  if (!manifest || manifest.status !== 'PASS' || !manifest.artifact?.id) throw new Error('Build artifact manifest belum PASS.');
  if (expectedSourceFingerprint && manifest.sourceIdentity?.value !== expectedSourceFingerprint) throw new Error('Build artifact manifest berasal dari source fingerprint berbeda.');
  const current = buildArtifactIdentity(root);
  if (current.id !== manifest.artifact.id) throw new Error(`Build artifact berubah. expected=${manifest.artifact.id} actual=${current.id}`);
  return current;
}

export function readAndVerifyBuildArtifactManifest(root = process.cwd(), relative = 'handoff/quality/build-artifact-manifest-latest.json', expectedSourceFingerprint = null) {
  const file = path.isAbsolute(relative) ? relative : path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Build artifact manifest tidak ditemukan: ${relative}`);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Build artifact manifest JSON invalid: ${error.message}`); }
  const current = verifyBuildArtifactManifest(manifest, root, expectedSourceFingerprint);
  return { file, manifest, current };
}
