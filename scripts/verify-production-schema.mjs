#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { expectedPostgresTarget } from './lib/runtime-target-identity.mjs';
import { buildExpectedSchemaContract, compareSchemaContract } from './lib/postgres-schema-contract.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff', 'quality', 'production-schema-latest.json');
const CONFIRM = 'VERIFY_T360_PRODUCTION_SCHEMA_READ_ONLY';
const sourceIdentity = sourceFingerprint(root);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} wajib tersedia.`);
  return value;
}
function parsePostgresUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('T360_PRODUCTION_SCHEMA_DATABASE_URL tidak valid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('T360_PRODUCTION_SCHEMA_DATABASE_URL wajib PostgreSQL.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database || !url.username) throw new Error('Production schema DATABASE_URL wajib memuat host, database, dan user.');
  return { url, host: url.hostname, database };
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function readEvidence(relative, label) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`${label} tidak ditemukan.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${label} JSON invalid: ${error.message}`); }
}
function sameDb(a, b) {
  return a?.profile === 'postgresql' && b?.profile === 'postgresql' && a.hostHash === b.hostHash && a.databaseHash === b.databaseHash;
}

const evidence = {
  generatedAt: null,
  environment: 'PRODUCTION',
  status: 'FAIL',
  productionTouched: false,
  readOnly: true,
  businessMutationsPerformed: false,
  sourceIdentity,
  databaseTarget: null,
  schemaSource: null,
  counts: null,
  contract: null,
  checks: [],
  error: null,
};
function check(id, status, detail = null) {
  evidence.checks.push({ id, status, ...(detail ? { detail } : {}) });
}

let prisma;
try {
  if (process.env.T360_PRODUCTION_SCHEMA_CONFIRM !== CONFIRM) throw new Error(`T360_PRODUCTION_SCHEMA_CONFIRM harus ${CONFIRM}.`);
  const connection = parsePostgresUrl(required('T360_PRODUCTION_SCHEMA_DATABASE_URL'));
  const expectedHost = required('T360_PRODUCTION_EXPECTED_DB_HOST');
  const expectedDatabase = required('T360_PRODUCTION_EXPECTED_DB_NAME');
  if (connection.host !== expectedHost) throw new Error('Host production schema tidak cocok dengan T360_PRODUCTION_EXPECTED_DB_HOST.');
  if (connection.database !== expectedDatabase) throw new Error('Database production schema tidak cocok dengan T360_PRODUCTION_EXPECTED_DB_NAME.');
  evidence.databaseTarget = expectedPostgresTarget(expectedHost, expectedDatabase);

  const promotion = readEvidence('handoff/quality/production-promotion-latest.json', 'Production promotion evidence');
  if (promotion.status !== 'PASS' || promotion.promotionReady !== true || promotion.sourceIdentity?.value !== sourceIdentity.value) throw new Error('Production promotion belum PASS pada source saat ini.');
  check('PRODUCTION_PROMOTION_PREREQUISITE', 'PASS');
  const backup = readEvidence('handoff/quality/production-backup-latest.json', 'Production backup evidence');
  if (backup.status !== 'PASS' || backup.sourceIdentity?.value !== sourceIdentity.value || backup.productionTouched !== false) throw new Error('Production backup belum PASS pada source saat ini.');
  if (!sameDb(backup.databaseTarget, evidence.databaseTarget)) throw new Error('Production backup berasal dari database berbeda dengan target schema verification.');
  check('PRODUCTION_BACKUP_PREREQUISITE', 'PASS');

  const schemaFile = path.join(root, 'apps', 'api', 'prisma', 'schema.postgresql.prisma');
  if (!fs.existsSync(schemaFile)) throw new Error('schema.postgresql.prisma tidak ditemukan.');
  evidence.schemaSource = { file: 'apps/api/prisma/schema.postgresql.prisma', sha256: sha256File(schemaFile) };
  const { Prisma, PrismaClient } = await import('@prisma/client');
  const expected = buildExpectedSchemaContract(Prisma.dmmf);
  if (!expected.models.length) throw new Error('Prisma DMMF tidak memuat model; generate PostgreSQL client sebelum verifikasi production schema.');

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = connection.url.toString();
  prisma = new PrismaClient();
  evidence.productionTouched = true;

  const actual = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const identity = await tx.$queryRawUnsafe('SELECT current_database() AS database, current_schema() AS schema');
    const currentDatabase = String(identity?.[0]?.database || '');
    if (currentDatabase !== expectedDatabase) throw new Error('Database aktif tidak cocok dengan database production yang dikonfirmasi.');
    const tables = await tx.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name`);
    const columns = await tx.$queryRawUnsafe(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,column_name`);
    const enums = await tx.$queryRawUnsafe(`SELECT t.typname AS enum_name,e.enumlabel AS enum_value FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema() ORDER BY t.typname,e.enumsortorder`);
    const indexes = await tx.$queryRawUnsafe(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY tablename,indexname`);
    return { identity, tables, columns, enums, indexes };
  });
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;

  check('READ_ONLY_CONNECTION', 'PASS', { databaseConfirmed: true });
  const contract = compareSchemaContract(expected, actual);
  evidence.counts = {
    expectedModels: expected.models.length,
    expectedColumns: expected.models.reduce((sum, model) => sum + model.columns.length, 0),
    expectedEnums: expected.enums.length,
    actualTables: actual.tables.length,
    actualColumns: actual.columns.length,
    actualEnums: new Set(actual.enums.map((row) => row.enum_name)).size,
    actualIndexes: actual.indexes.length,
  };
  evidence.contract = {
    passed: contract.passed,
    missingTables: contract.missingTables,
    missingColumns: contract.missingColumns,
    enumMismatches: contract.enumMismatches,
    missingCriticalIndexes: contract.missingCriticalIndexes,
  };
  if (!contract.passed) throw new Error(`Production schema contract gagal: tables=${contract.missingTables.length}, columns=${contract.missingColumns.length}, enums=${contract.enumMismatches.length}, criticalIndexes=${contract.missingCriticalIndexes.length}.`);
  check('PRISMA_SCHEMA_CONTRACT', 'PASS', evidence.counts);
  evidence.status = 'PASS';
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  check('PRODUCTION_SCHEMA_GATE', 'FAIL', evidence.error);
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect().catch(() => {});
  evidence.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Production schema verification: ${evidence.status} — evidence: ${output}`);
}
