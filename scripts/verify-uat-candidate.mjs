import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff', 'quality', 'uat-candidate-latest.json');
const current = sourceFingerprint(root);
const requirements = [
  ['BUILD_GATE', 'handoff/quality/build-gate-latest.json', (x) => x?.status === 'PASS', (x) => x?.sourceIdentityAfter],
  ['BUILT_BROWSER_UAT', 'handoff/quality/built-browser-uat-latest.json', (x) => x?.status === 'PASS' && x?.browserEvidence?.status === 'PASS', (x) => x?.sourceIdentityAfter || x?.sourceIdentityBefore],
  ['BROWSER_UAT', 'handoff/quality/browser-uat-latest.json', (x) => x?.status === 'PASS', (x) => x?.sourceIdentity],
  ['STAGE20', 'logs/stage20-release-readiness/latest.json', (x) => x?.gate?.passed === true && x?.uat?.passed === true, (x) => x?.sourceIdentity],
];
const checks = [];
let buildArtifactId = null;
try {
  buildArtifactId = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', current.value).current.id;
  checks.push({ id: 'BUILD_ARTIFACT_MANIFEST', status: 'PASS', buildArtifactId });
} catch (error) {
  checks.push({ id: 'BUILD_ARTIFACT_MANIFEST', status: 'FAIL', reason: error instanceof Error ? error.message : String(error) });
}
for (const [id, relative, passed, identity] of requirements) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { checks.push({ id, status: 'FAIL', reason: `Evidence tidak ditemukan: ${relative}` }); continue; }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { checks.push({ id, status: 'FAIL', reason: `Evidence JSON invalid: ${error.message}` }); continue; }
  const source = identity(value);
  if (!passed(value)) checks.push({ id, status: 'FAIL', reason: 'Gate evidence belum PASS.', evidence: relative });
  else if (!source?.value || source.value !== current.value) checks.push({ id, status: 'FAIL', reason: 'Source fingerprint evidence tidak cocok dengan source saat ini.', evidence: relative, evidenceFingerprint: source?.value || null });
  else checks.push({ id, status: 'PASS', evidence: relative, sourceFingerprint: source.value });
}

const build = checks.find((item) => item.id === 'BUILD_GATE');
if (build?.status === 'PASS') {
  const buildData = JSON.parse(fs.readFileSync(path.join(root, 'handoff/quality/build-gate-latest.json'), 'utf8'));
  if (buildData?.sourceIdentityBefore?.value !== current.value || buildData?.sourceIdentityAfter?.value !== current.value) {
    build.status = 'FAIL';
    build.reason = 'Build gate tidak terikat utuh pada source fingerprint saat ini.';
  } else if (!buildArtifactId || buildData?.buildArtifactId !== buildArtifactId) {
    build.status = 'FAIL';
    build.reason = 'Build gate tidak terikat pada build artifact manifest saat ini.';
  }
}
const builtBrowser = checks.find((item) => item.id === 'BUILT_BROWSER_UAT');
if (builtBrowser?.status === 'PASS') {
  const wrapper = JSON.parse(fs.readFileSync(path.join(root, 'handoff/quality/built-browser-uat-latest.json'), 'utf8'));
  if (wrapper?.sourceIdentityBefore?.value !== current.value || wrapper?.sourceIdentityAfter?.value !== current.value) { builtBrowser.status = 'FAIL'; builtBrowser.reason = 'Built browser UAT tidak terikat utuh pada source fingerprint saat ini.'; }
  else if (wrapper?.browserEvidence?.sourceFingerprint !== current.value) { builtBrowser.status = 'FAIL'; builtBrowser.reason = 'Inner browser evidence pada built wrapper berasal dari source fingerprint berbeda.'; }
  else if (!buildArtifactId || wrapper?.buildArtifactId !== buildArtifactId || wrapper?.browserEvidence?.buildArtifactId !== buildArtifactId) { builtBrowser.status = 'FAIL'; builtBrowser.reason = 'Built browser UAT tidak membuktikan build artifact yang sama dengan manifest.'; }
}
const stage = checks.find((item) => item.id === 'STAGE20');
let stageData = null;
if (stage?.status === 'PASS') {
  stageData = JSON.parse(fs.readFileSync(path.join(root, 'logs/stage20-release-readiness/latest.json'), 'utf8'));
  if ((stageData?.uat?.total || 0) !== 12) { stage.status = 'FAIL'; stage.reason = 'Stage-20 harus memuat tepat 12 skenario kritis termasuk Delivery dan Payroll Adjustment/Recovery.'; }
  else if (!buildArtifactId || stageData?.buildArtifactId !== buildArtifactId) { stage.status = 'FAIL'; stage.reason = 'Stage-20 tidak menggunakan build artifact yang sama dengan manifest.'; }
}
if (builtBrowser?.status === 'PASS' && stage?.status === 'PASS') {
  const wrapper = JSON.parse(fs.readFileSync(path.join(root, 'handoff/quality/built-browser-uat-latest.json'), 'utf8'));
  const buildData = JSON.parse(fs.readFileSync(path.join(root, 'handoff/quality/build-gate-latest.json'), 'utf8'));
  if (wrapper?.target?.profile !== 'postgresql') {
    builtBrowser.status = 'FAIL';
    builtBrowser.reason = 'Built browser UAT kandidat harus menggunakan PostgreSQL staging/test, bukan profile lain.';
  } else if (wrapper?.target?.hostHash !== stageData?.target?.hostHash || wrapper?.target?.databaseHash !== stageData?.target?.databaseHash) {
    builtBrowser.status = 'FAIL';
    builtBrowser.reason = 'Built browser UAT dan Stage-20 berasal dari target database berbeda.';
  } else {
    const buildFinishedAt = Date.parse(buildData?.finishedAt);
    const browserStartedAt = Date.parse(wrapper?.startedAt);
    const browserFinishedAt = Date.parse(wrapper?.finishedAt);
    const stageGeneratedAt = Date.parse(stageData?.generatedAt);
    if (![buildFinishedAt, browserStartedAt, browserFinishedAt, stageGeneratedAt].every(Number.isFinite)) {
      builtBrowser.status = 'FAIL';
      builtBrowser.reason = 'Timestamp evidence Build/Built-Browser/Stage-20 tidak lengkap atau invalid.';
    } else if (browserStartedAt < buildFinishedAt) {
      builtBrowser.status = 'FAIL';
      builtBrowser.reason = 'Built browser UAT lebih lama daripada build gate PASS; browser harus dijalankan ulang setelah build.';
    } else if (stageGeneratedAt < browserFinishedAt) {
      stage.status = 'FAIL';
      stage.reason = 'Stage-20 lebih lama daripada built browser UAT; Stage-20 harus dijalankan setelah runtime browser gate.';
    }
  }
}
const passed = checks.every((item) => item.status === 'PASS');
const result = { generatedAt: new Date().toISOString(), status: passed ? 'PASS' : 'FAIL', uatCandidate: passed, productionReady: false, sourceIdentity: current, buildArtifactId, checks, note: 'PASS hanya menyatakan kandidat UAT/release-ready non-production; bukan izin production deployment.' };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`UAT candidate verification: ${result.status} — evidence: ${output}`);
if (!passed) process.exitCode = 1;
