#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff', 'quality', 'production-ready-latest.json');
const current = sourceFingerprint(root);
function argument(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
function read(file, label) {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(absolute)) throw new Error(`${label} tidak ditemukan: ${file}`);
  try { return JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch (error) { throw new Error(`${label} JSON invalid: ${error.message}`); }
}
function timestamp(value, label) { const t = Date.parse(value); if (!Number.isFinite(t)) throw new Error(`${label} timestamp invalid.`); return t; }
const checks = [];
let status = 'FAIL'; let error = null; let target = null;
try {
  const buildArtifactId = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', current.value).current.id;
  checks.push({ id: 'BUILD_ARTIFACT_MANIFEST', status: 'PASS', buildArtifactId });
  const promotion = read('handoff/quality/production-promotion-latest.json', 'Production promotion gate');
  if (promotion.status !== 'PASS' || promotion.promotionReady !== true || promotion.sourceIdentity?.value !== current.value) throw new Error('Production promotion gate belum PASS pada source saat ini.');
  if (promotion.buildArtifactId !== buildArtifactId) throw new Error('Production promotion gate berasal dari build artifact berbeda.');
  checks.push({ id: 'PRODUCTION_PROMOTION', status: 'PASS' });

  const smoke = read('handoff/quality/production-smoke-latest.json', 'Production smoke');
  if (smoke.status !== 'PASS' || smoke.environment !== 'PRODUCTION' || smoke.sourceIdentity?.value !== current.value || smoke.runtimeSourceFingerprint !== current.value) throw new Error('Production smoke belum PASS pada deployed source fingerprint saat ini.');
  if (smoke.buildArtifactId !== buildArtifactId || smoke.runtimeBuildArtifactId !== buildArtifactId) throw new Error('Production smoke tidak membuktikan build artifact yang dipromosikan.');
  target = smoke.target;
  if (timestamp(smoke.generatedAt, 'Production smoke') < timestamp(promotion.generatedAt, 'Promotion gate')) throw new Error('Production smoke lebih lama daripada promotion approval; deploy/smoke harus dilakukan setelah promotion gate PASS.');
  checks.push({ id: 'PRODUCTION_SMOKE', status: 'PASS' });

  const productionBackup = read('handoff/quality/production-backup-latest.json', 'Production backup verification');
  if (productionBackup.status !== 'PASS' || productionBackup.sourceIdentity?.value !== current.value) throw new Error('Production backup verification belum PASS pada source saat ini.');
  if (productionBackup.productionTouched !== false) throw new Error('Production backup verifier tidak boleh menyentuh production runtime.');
  if (productionBackup.databaseTarget?.hostHash !== target?.databaseTarget?.hostHash || productionBackup.databaseTarget?.databaseHash !== target?.databaseTarget?.databaseHash) throw new Error('Production backup berasal dari database berbeda dengan production smoke.');
  const backupCreatedAt = timestamp(productionBackup.backupCreatedAt, 'Production backup createdAt');
  const backupVerifiedAt = timestamp(productionBackup.generatedAt, 'Production backup verification');
  if (backupCreatedAt < timestamp(promotion.generatedAt, 'Promotion gate')) throw new Error('Pre-deploy production backup dibuat sebelum promotion gate PASS; buat backup fresh setelah promotion approval.');
  if (backupVerifiedAt > timestamp(smoke.generatedAt, 'Production smoke')) throw new Error('Pre-deploy production backup harus sudah diverifikasi sebelum production smoke.');
  checks.push({ id: 'PRODUCTION_BACKUP', status: 'PASS' });

  const productionSchema = read('handoff/quality/production-schema-latest.json', 'Production schema verification');
  if (productionSchema.status !== 'PASS' || productionSchema.sourceIdentity?.value !== current.value || productionSchema.readOnly !== true || productionSchema.businessMutationsPerformed !== false) throw new Error('Production schema verification belum PASS/read-only pada source saat ini.');
  if (productionSchema.databaseTarget?.hostHash !== target?.databaseTarget?.hostHash || productionSchema.databaseTarget?.databaseHash !== target?.databaseTarget?.databaseHash) throw new Error('Production schema verification berasal dari database berbeda dengan production smoke.');
  const schemaVerifiedAt = timestamp(productionSchema.generatedAt, 'Production schema verification');
  if (schemaVerifiedAt < backupVerifiedAt) throw new Error('Production schema verification harus dilakukan setelah pre-deploy backup diverifikasi.');
  if (schemaVerifiedAt > timestamp(smoke.generatedAt, 'Production smoke')) throw new Error('Production schema verification harus selesai sebelum production smoke.');
  checks.push({ id: 'PRODUCTION_SCHEMA_CONTRACT', status: 'PASS' });

  const attestationFile = argument('attestation-file', process.env.T360_PRODUCTION_DEPLOYMENT_ATTESTATION || 'production-deployment-attestation.json');
  const attestation = read(attestationFile, 'Production deployment attestation');
  if (attestation.decision !== 'PRODUCTION_DEPLOYMENT_VERIFIED') throw new Error('Deployment attestation decision harus PRODUCTION_DEPLOYMENT_VERIFIED.');
  if (attestation.sourceFingerprint !== current.value) throw new Error('Deployment attestation sourceFingerprint tidak cocok.');
  if (attestation.buildArtifactId !== buildArtifactId) throw new Error('Deployment attestation buildArtifactId tidak cocok dengan artifact yang dipromosikan.');
  if (attestation.productionTarget?.applicationHostHash !== target?.applicationHostHash) throw new Error('Deployment attestation application host berbeda dengan production smoke.');
  if (attestation.productionTarget?.databaseTarget?.hostHash !== target?.databaseTarget?.hostHash || attestation.productionTarget?.databaseTarget?.databaseHash !== target?.databaseTarget?.databaseHash) throw new Error('Deployment attestation database target berbeda dengan production smoke.');
  if (typeof attestation.approvedBy !== 'string' || attestation.approvedBy.trim().length < 2) throw new Error('Deployment attestation approvedBy wajib diisi.');
  const required = ['preDeployBackupVerified','preDeployBackupProtected','migrationsApplied','schemaContractReviewed','sixServicesHealthy','webSurfacesHealthy','monitoringGreen','queueHealthGreen','rollbackReady','smokeReviewed','financialIntegrityReviewed'];
  for (const key of required) if (attestation?.checks?.[key] !== 'PASS') throw new Error(`Deployment attestation ${key} wajib PASS.`);
  if (timestamp(attestation.approvedAt, 'Deployment approval') < timestamp(smoke.generatedAt, 'Production smoke')) throw new Error('Deployment approval harus dilakukan setelah production smoke terbaru.');
  checks.push({ id: 'DEPLOYMENT_ATTESTATION', status: 'PASS', approvedBy: attestation.approvedBy });
  status = 'PASS';
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
  checks.push({ id: 'PRODUCTION_READY_GATE', status: 'FAIL', reason: error });
  process.exitCode = 1;
}
const result = { generatedAt: new Date().toISOString(), status, productionReady: status === 'PASS', sourceIdentity: current, buildArtifactId: checks.find((x) => x.id === 'BUILD_ARTIFACT_MANIFEST')?.buildArtifactId || null, target, checks, error, note: 'PASS memerlukan promotion evidence, exact build artifact identity, verified production backup, read-only production schema contract, deployed source identity, production smoke, dan deployment attestation. Monitoring pasca-rilis tetap wajib dilanjutkan.' };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`Production-ready verification: ${status} — evidence: ${output}`);
