#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff', 'quality', 'production-promotion-latest.json');
const current = sourceFingerprint(root);

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function readJson(relativeOrAbsolute, label) {
  const file = path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(root, relativeOrAbsolute);
  if (!fs.existsSync(file)) throw new Error(`${label} tidak ditemukan: ${relativeOrAbsolute}`);
  try { return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (error) { throw new Error(`${label} JSON invalid: ${error.message}`); }
}
function time(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp invalid.`);
  return parsed;
}
function sameDb(a, b) { return a?.hostHash && b?.hostHash && a.hostHash === b.hostHash && a.databaseHash === b.databaseHash; }
function requireSource(value, label) {
  if (value?.sourceIdentity?.value !== current.value) throw new Error(`${label} berasal dari source fingerprint berbeda.`);
}

const checks = [];
let status = 'FAIL';
let error = null;
let stagingTarget = null;
let buildArtifactId = null;
try {
  buildArtifactId = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', current.value).current.id;
  checks.push({ id: 'BUILD_ARTIFACT_MANIFEST', status: 'PASS', buildArtifactId });
  const uat = readJson('handoff/quality/uat-candidate-latest.json', 'UAT candidate').value;
  if (uat.status !== 'PASS' || uat.uatCandidate !== true) throw new Error('UAT candidate belum PASS.');
  requireSource(uat, 'UAT candidate');
  if (uat.buildArtifactId !== buildArtifactId) throw new Error('UAT candidate berasal dari build artifact berbeda.');
  checks.push({ id: 'UAT_CANDIDATE', status: 'PASS' });

  const stage20 = readJson('logs/stage20-release-readiness/latest.json', 'Stage-20').value;
  if (!stage20?.gate?.passed || !stage20?.uat?.passed) throw new Error('Stage-20 belum PASS lengkap.');
  requireSource(stage20, 'Stage-20');
  if (stage20.buildArtifactId !== buildArtifactId) throw new Error('Stage-20 berasal dari build artifact berbeda.');
  stagingTarget = stage20.target;
  checks.push({ id: 'STAGE20', status: 'PASS' });

  const stagingCert = readJson('handoff/quality/staging-certification-latest.json', 'Staging certification').value;
  if (!stagingCert.passed) throw new Error('Staging certification belum PASS.');
  requireSource(stagingCert, 'Staging certification');
  if (stagingCert.buildArtifactId !== buildArtifactId) throw new Error('Staging certification berasal dari build artifact berbeda.');
  if (!sameDb(stagingCert.databaseTarget, stagingTarget)) throw new Error('Staging certification berasal dari database runtime berbeda dengan Stage-20.');
  checks.push({ id: 'STAGING_CERTIFICATION', status: 'PASS' });

  const load = readJson('handoff/quality/load-health-latest.json', 'Load evidence').value;
  if (!load?.thresholds?.passed) throw new Error('Load evidence belum memenuhi threshold.');
  requireSource(load, 'Load evidence');
  if (load.runtimeSourceFingerprint !== current.value) throw new Error('Load evidence tidak membuktikan runtime source fingerprint yang sedang dipromosikan.');
  if (load.runtimeBuildArtifactId !== buildArtifactId) throw new Error('Load evidence tidak membuktikan build artifact yang sedang dipromosikan.');
  if (!sameDb(load.runtimeDatabaseTarget, stagingTarget)) throw new Error('Load evidence berasal dari runtime database berbeda dengan Stage-20.');
  if (load.target?.hostHash !== stagingCert.target?.hostHash) throw new Error('Load evidence dan staging certification berasal dari host runtime berbeda.');
  checks.push({ id: 'LOAD_CAPACITY', status: 'PASS' });

  const indexProfile = readJson('handoff/quality/postgres-index-profile-latest.json', 'PostgreSQL index profile').value;
  requireSource(indexProfile, 'PostgreSQL index profile');
  if (!sameDb(indexProfile.target, stagingTarget)) throw new Error('Index profile berasal dari database staging berbeda dengan Stage-20.');
  checks.push({ id: 'INDEX_PROFILE', status: 'PASS', warnings: {
    sequentialScanCandidates: indexProfile?.warnings?.sequentialScanCandidates?.length ?? null,
    unusedLargeIndexes: indexProfile?.warnings?.unusedLargeIndexes?.length ?? null,
    deadTupleCandidates: indexProfile?.warnings?.deadTupleCandidates?.length ?? null,
  } });

  const dr = readJson('handoff/quality/postgres-dr-drill-latest.json', 'PostgreSQL DR drill').value;
  if (dr.status !== 'PASS') throw new Error('PostgreSQL DR drill belum PASS.');
  requireSource(dr, 'PostgreSQL DR drill');
  if (!sameDb(dr.sourceTarget, stagingTarget)) throw new Error('DR drill source database berbeda dengan Stage-20.');
  checks.push({ id: 'POSTGRES_DR_DRILL', status: 'PASS' });

  const approvalFile = argument('approval-file', process.env.T360_PRODUCTION_PROMOTION_APPROVAL || 'production-promotion-approval.json');
  const approval = readJson(approvalFile, 'Production promotion approval').value;
  if (approval.environment !== 'STAGING' || approval.decision !== 'GO_FOR_PRODUCTION_PROMOTION') throw new Error('Production promotion approval harus STAGING + GO_FOR_PRODUCTION_PROMOTION.');
  if (typeof approval.approvedBy !== 'string' || approval.approvedBy.trim().length < 2) throw new Error('approvedBy wajib diisi.');
  if (approval.sourceFingerprint !== current.value) throw new Error('Approval sourceFingerprint tidak cocok dengan source saat ini.');
  if (approval.buildArtifactId !== buildArtifactId) throw new Error('Approval buildArtifactId tidak cocok dengan artifact yang sudah diuji.');
  if (!sameDb(approval.stagingTarget, stagingTarget)) throw new Error('Approval stagingTarget berbeda dengan Stage-20.');
  const requiredPass = ['securitySecrets','securityTesting','authControls','backupRetention','backupEncryption','queueCapacity','monitoringAlerts','cutoverPlan','rollbackPlan','financialOpeningBalances','inventoryOpeningBalances','privacyRetention','indexReview'];
  for (const key of requiredPass) if (approval?.checks?.[key] !== 'PASS') throw new Error(`Approval check ${key} wajib PASS.`);
  const providersEnabled = approval?.providers?.enabled === true;
  const providerStatus = approval?.checks?.providerCertification;
  if (providersEnabled ? providerStatus !== 'PASS' : !['PASS','NOT_APPLICABLE'].includes(providerStatus)) throw new Error('providerCertification tidak sesuai status provider.');
  const externalApiEnabled = approval?.externalApiAccess?.enabled === true;
  const apiKeyStatus = approval?.checks?.apiKeyLifecycle;
  if (externalApiEnabled ? apiKeyStatus !== 'PASS' : !['PASS','NOT_APPLICABLE'].includes(apiKeyStatus)) throw new Error('apiKeyLifecycle tidak sesuai status external API access.');
  const approvalAt = time(approval.approvedAt, 'approvedAt');
  const evidenceTimes = [
    time(uat.generatedAt, 'UAT candidate'), time(stage20.generatedAt, 'Stage-20'), time(stagingCert.generatedAt, 'Staging certification'),
    time(load.generatedAt, 'Load evidence'), time(indexProfile.generatedAt, 'Index profile'), time(dr.generatedAt, 'DR drill'),
  ];
  if (approvalAt < Math.max(...evidenceTimes)) throw new Error('Approval produksi lebih lama daripada salah satu evidence wajib; approval harus dilakukan setelah review evidence terbaru.');
  checks.push({ id: 'HUMAN_PROMOTION_APPROVAL', status: 'PASS', approvedBy: approval.approvedBy });
  status = 'PASS';
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
  checks.push({ id: 'PRODUCTION_PROMOTION_GATE', status: 'FAIL', reason: error });
  process.exitCode = 1;
}

const result = {
  generatedAt: new Date().toISOString(), status, promotionReady: status === 'PASS', productionReady: false,
  sourceIdentity: current, buildArtifactId, stagingTarget, checks, error,
  note: 'PASS hanya mengizinkan promotion/cutover terkontrol. Production-ready tetap memerlukan deploy + production smoke + deployment attestation.',
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`Production promotion verification: ${status} — evidence: ${output}`);
