import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnNpm } from './lib/process-runner.mjs';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const root = process.cwd();
const logDir = path.join(root, 'logs', 'built-browser-uat');
const wrapperEvidencePath = path.join(root, 'handoff', 'quality', 'built-browser-uat-latest.json');
const requiredBuild = [
  'apps/api/dist/main.js', 'apps/worker/dist/index.js',
  'apps/storefront/.next/BUILD_ID', 'apps/admin/.next/BUILD_ID', 'apps/pos/.next/BUILD_ID', 'apps/employee-portal/.next/BUILD_ID',
];
const services = [
  ['api', '@toko360/api'], ['worker', '@toko360/worker'], ['storefront', '@toko360/storefront'],
  ['admin', '@toko360/admin'], ['pos', '@toko360/pos'], ['employee', '@toko360/employee-portal'],
];
const children = [];
let browserChild;
let runtimeEnv = { ...process.env };
const evidence = {
  startedAt: new Date().toISOString(), finishedAt: null, environment: null, target: null, status: 'FAIL',
  sourceIdentityBefore: sourceFingerprint(root), sourceIdentityAfter: null, buildArtifactId: null,
  prerequisites: [], services: [], browserExitCode: null, browserEvidence: null, error: null,
};

export function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function shortHash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }

export function runtimeTargetIdentity(env) {
  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  if (/prod|production|live/.test(nodeEnv)) throw new Error('Built browser UAT menolak NODE_ENV production/live.');
  const profile = String(env.DATABASE_PROFILE || '').toLowerCase();
  const databaseUrl = String(env.DATABASE_URL || '');
  const unsafe = /(^|[-_.])(prod|production|live)([-_.]|$)/i;
  if (profile === 'postgresql' || /^postgres(?:ql)?:/i.test(databaseUrl)) {
    let parsed;
    try { parsed = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL PostgreSQL untuk built browser UAT tidak valid.'); }
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!parsed.hostname || !database) throw new Error('DATABASE_URL PostgreSQL wajib memuat host dan database.');
    if (unsafe.test(parsed.hostname) || unsafe.test(database)) throw new Error('Built browser UAT menolak database/host production/live.');
    const expectedHost = String(env.T360_UAT_EXPECTED_HOST || '').trim();
    const expectedDatabase = String(env.T360_UAT_EXPECTED_DATABASE || '').trim();
    if (!expectedHost || !expectedDatabase) throw new Error('T360_UAT_EXPECTED_HOST dan T360_UAT_EXPECTED_DATABASE wajib untuk built browser UAT PostgreSQL.');
    if (parsed.hostname !== expectedHost) throw new Error('Host built browser UAT tidak cocok dengan T360_UAT_EXPECTED_HOST.');
    if (database !== expectedDatabase) throw new Error('Database built browser UAT tidak cocok dengan T360_UAT_EXPECTED_DATABASE.');
    return { profile: 'postgresql', hostHash: shortHash(parsed.hostname), databaseHash: shortHash(database) };
  }
  if (profile === 'sqlite' || /^file:/i.test(databaseUrl)) return { profile: 'sqlite', databaseHash: shortHash(databaseUrl) };
  throw new Error('DATABASE_PROFILE/DATABASE_URL built browser UAT tidak dikenali.');
}

function passPrerequisite(id, detail = null) { evidence.prerequisites.push({ id, status: 'PASS', ...(detail ? { detail } : {}) }); }
function failPrerequisite(id, error) { evidence.prerequisites.push({ id, status: 'FAIL', error }); throw new Error(error); }

function requireFile(relative, id) {
  if (!fs.existsSync(path.join(root, relative))) failPrerequisite(id, `File wajib belum tersedia: ${relative}`);
  passPrerequisite(id, relative);
}

function startService(name, workspace) {
  const out = fs.createWriteStream(path.join(logDir, `${name}.log`), { flags: 'w' });
  const child = spawnNpm(['run', 'start', '-w', workspace], {
    cwd: root, env: runtimeEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  child.stdout.pipe(out); child.stderr.pipe(out);
  children.push({ name, workspace, child, out });
  evidence.services.push({ name, workspace, pid: child.pid ?? null });
  return child;
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

async function stopAll() {
  terminateChild(browserChild);
  for (const item of children) terminateChild(item.child);
  await Promise.race([
    Promise.all(children.map(({ child }) => child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve)))),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  for (const item of children) {
    if (item.child.exitCode === null) {
      try { if (process.platform !== 'win32' && item.child.pid) process.kill(-item.child.pid, 'SIGKILL'); else item.child.kill('SIGKILL'); } catch {}
    }
    item.out.end();
  }
}

async function main() {
  fs.mkdirSync(path.dirname(wrapperEvidencePath), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  try {
    const envFile = path.join(root, '.env');
    requireFile('.env', 'ENV_FILE');
    runtimeEnv = { ...readEnvFile(envFile), ...process.env, T360_SOURCE_FINGERPRINT: evidence.sourceIdentityBefore.value, T360_EXPECTED_SOURCE_FINGERPRINT: evidence.sourceIdentityBefore.value };
    const environment = String(runtimeEnv.T360_UAT_ENVIRONMENT || 'LOCAL_UAT').toUpperCase();
    evidence.environment = environment;
    if (/PROD|PRODUCTION|LIVE/.test(environment)) failPrerequisite('NON_PRODUCTION_ENVIRONMENT', 'Built browser UAT ditolak pada production/live.');
    passPrerequisite('NON_PRODUCTION_ENVIRONMENT', environment);
    evidence.target = runtimeTargetIdentity(runtimeEnv);
    passPrerequisite('DATABASE_TARGET_LOCK', evidence.target.profile);
    for (const [index, file] of requiredBuild.entries()) requireFile(file, `BUILD_ARTIFACT_${index + 1}`);
    const artifact = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', evidence.sourceIdentityBefore.value);
    evidence.buildArtifactId = artifact.current.id;
    runtimeEnv = { ...runtimeEnv, T360_BUILD_ARTIFACT_ID: artifact.current.id, T360_EXPECTED_BUILD_ARTIFACT_ID: artifact.current.id };
    passPrerequisite('BUILD_ARTIFACT_IDENTITY', artifact.current.id);

    for (const [name, workspace] of services) startService(name, workspace);
    const earlyExit = Promise.race(children.map(({ name, child }) => new Promise((_, reject) => child.once('exit', (code) => reject(new Error(`${name} berhenti sebelum Browser UAT selesai (exit ${code}).`))))));
    const browserDone = new Promise((resolve, reject) => {
      browserChild = spawn(process.execPath, ['scripts/browser-uat.mjs'], {
        cwd: root, env: runtimeEnv, stdio: 'inherit', detached: process.platform !== 'win32',
      });
      browserChild.once('error', reject);
      browserChild.once('exit', (code) => {
        evidence.browserExitCode = code ?? 1;
        if (code === 0) return resolve();
        // `scripts/browser-uat.mjs` menulis evidence-nya sendiri termasuk pesan kegagalan yang
        // sudah terperinci (mis. stderr Chrome). Bacanya di sini supaya artifact wrapper
        // menyimpan PENYEBAB, bukan cuma "exit 1". Sebelumnya stdout child memakai `inherit`
        // sehingga hanya masuk log runner yang mruby.ai/retire, dan `browser-uat-latest.json`
        // tidak pernah terunggah kalau run gagal sebelum evidence ditulis - membuat kegagalan
        // browser mustahil ditelusuri tanpa menjalankan ulang.
        let detail = '';
        try {
          const childEvidence = path.join(root, 'handoff', 'quality', 'browser-uat-latest.json');
          if (fs.existsSync(childEvidence)) {
            const parsed = JSON.parse(fs.readFileSync(childEvidence, 'utf8'));
            if (typeof parsed.error === 'string') detail = parsed.error;
          }
        } catch { /* evidence tidak terbaca; pesan exit saja yang tersisa */ }
        reject(new Error(`Browser UAT gagal (exit ${code ?? 1}).${detail ? ` Penyebab: ${detail}` : ''}`));
      });
    });
    await Promise.race([browserDone, earlyExit]);

    const browserEvidencePath = path.join(root, 'handoff', 'quality', 'browser-uat-latest.json');
    if (!fs.existsSync(browserEvidencePath)) throw new Error('Browser UAT selesai tetapi evidence browser-uat-latest.json tidak ditemukan.');
    const browserEvidence = JSON.parse(fs.readFileSync(browserEvidencePath, 'utf8'));
    evidence.browserEvidence = {
      path: 'handoff/quality/browser-uat-latest.json', status: browserEvidence?.status || null,
      sourceFingerprint: browserEvidence?.sourceIdentity?.value || null, buildArtifactId: browserEvidence?.runtimeBuildArtifactId || null, startedAt: browserEvidence?.startedAt || null, finishedAt: browserEvidence?.finishedAt || null,
    };
    if (browserEvidence?.status !== 'PASS') throw new Error('Browser UAT wrapper menolak PASS karena inner browser evidence bukan PASS.');
    if (browserEvidence?.sourceIdentity?.value !== evidence.sourceIdentityBefore.value) throw new Error('Browser UAT wrapper menolak evidence dari source fingerprint berbeda.');
    if (browserEvidence?.runtimeBuildArtifactId !== evidence.buildArtifactId) throw new Error('Browser UAT wrapper menolak runtime build artifact yang berbeda dari manifest build.');
    evidence.sourceIdentityAfter = sourceFingerprint(root);
    if (evidence.sourceIdentityAfter.value !== evidence.sourceIdentityBefore.value) throw new Error('Source fingerprint berubah selama built browser UAT; evidence dibatalkan.');
    evidence.status = 'PASS';
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await stopAll();
    evidence.sourceIdentityAfter ||= sourceFingerprint(root);
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(wrapperEvidencePath, JSON.stringify(evidence, null, 2) + '\n');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().then(() => console.log(`Built browser UAT PASS — evidence: ${wrapperEvidencePath}`)).catch((error) => {
  console.error(`Built browser UAT FAIL — ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
