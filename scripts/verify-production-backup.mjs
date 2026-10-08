#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { expectedPostgresTarget } from './lib/runtime-target-identity.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff', 'quality', 'production-backup-latest.json');
const CONFIRM = 'VERIFY_T360_PRODUCTION_BACKUP';
const DEFAULT_MAX_AGE_MINUTES = 120;
const sourceIdentity = sourceFingerprint(root);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} wajib tersedia.`);
  return value;
}
function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}
function metadataTarget(metadata) {
  if (metadata?.source?.target?.profile === 'postgresql' && metadata.source.target.hostHash && metadata.source.target.databaseHash) {
    return metadata.source.target;
  }
  if (metadata?.source?.profile === 'postgresql' && metadata.source.host && metadata.source.database) {
    return { profile: 'postgresql', hostHash: shortHash(String(metadata.source.host).trim().toLowerCase()), databaseHash: shortHash(String(metadata.source.database).trim()) };
  }
  throw new Error('Metadata backup tidak memiliki PostgreSQL target identity yang dapat diverifikasi.');
}
function sameDb(a, b) {
  return a?.profile === 'postgresql' && b?.profile === 'postgresql' && a.hostHash === b.hostHash && a.databaseHash === b.databaseHash;
}

const evidence = {
  generatedAt: null,
  status: 'FAIL',
  productionTouched: false,
  sourceIdentity,
  databaseTarget: null,
  backupCreatedAt: null,
  backupSha256: null,
  backupSize: null,
  ageMinutes: null,
  checks: [],
  error: null,
};
function check(id, status, detail = null) {
  evidence.checks.push({ id, status, ...(detail ? { detail } : {}) });
}

try {
  if (process.env.T360_PRODUCTION_BACKUP_CONFIRM !== CONFIRM) throw new Error(`T360_PRODUCTION_BACKUP_CONFIRM harus ${CONFIRM}.`);
  const metadataFile = path.resolve(required('T360_PRODUCTION_BACKUP_METADATA'));
  const expectedTarget = expectedPostgresTarget(required('T360_PRODUCTION_EXPECTED_DB_HOST'), required('T360_PRODUCTION_EXPECTED_DB_NAME'));
  evidence.databaseTarget = expectedTarget;

  const maxAgeMinutesRaw = process.env.T360_PRODUCTION_BACKUP_MAX_AGE_MINUTES || String(DEFAULT_MAX_AGE_MINUTES);
  const maxAgeMinutes = Number(maxAgeMinutesRaw);
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0 || maxAgeMinutes > 1440) throw new Error('T360_PRODUCTION_BACKUP_MAX_AGE_MINUTES harus >0 dan <=1440.');

  if (!fs.existsSync(metadataFile)) throw new Error('Metadata backup production tidak ditemukan.');
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  if (!metadata?.artifact || !metadata?.sha256 || !Number.isFinite(Number(metadata?.size)) || !metadata?.createdAt) throw new Error('Metadata backup production tidak lengkap.');
  const backupTarget = metadataTarget(metadata);
  if (!sameDb(backupTarget, expectedTarget)) throw new Error('Backup berasal dari database yang berbeda dengan target production yang diharapkan.');
  check('PRODUCTION_DATABASE_TARGET', 'PASS');

  const createdAt = Date.parse(metadata.createdAt);
  if (!Number.isFinite(createdAt)) throw new Error('createdAt metadata backup invalid.');
  const now = Date.now();
  const ageMinutes = (now - createdAt) / 60000;
  if (ageMinutes < -5) throw new Error('Timestamp backup berada terlalu jauh di masa depan.');
  if (ageMinutes > maxAgeMinutes) throw new Error(`Backup production terlalu lama: ${ageMinutes.toFixed(1)} menit > ${maxAgeMinutes} menit.`);
  evidence.backupCreatedAt = new Date(createdAt).toISOString();
  evidence.ageMinutes = Number(Math.max(0, ageMinutes).toFixed(2));
  check('BACKUP_FRESHNESS', 'PASS', { maxAgeMinutes });

  const artifact = path.isAbsolute(metadata.artifact) ? metadata.artifact : path.resolve(path.dirname(metadataFile), metadata.artifact);
  if (!fs.existsSync(artifact)) throw new Error('Artifact backup production tidak ditemukan.');
  const bytes = fs.readFileSync(artifact);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== metadata.sha256) throw new Error('Checksum artifact backup production tidak cocok dengan metadata.');
  if (bytes.length !== Number(metadata.size)) throw new Error('Ukuran artifact backup production tidak cocok dengan metadata.');
  evidence.backupSha256 = sha256;
  evidence.backupSize = bytes.length;
  check('BACKUP_CHECKSUM_SIZE', 'PASS');

  evidence.status = 'PASS';
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  check('PRODUCTION_BACKUP_GATE', 'FAIL', evidence.error);
  process.exitCode = 1;
} finally {
  evidence.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Production backup verification: ${evidence.status} — evidence: ${output}`);
}
