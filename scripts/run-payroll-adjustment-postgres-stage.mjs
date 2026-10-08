import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnNpmSync } from './lib/process-runner.mjs';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';
import { parsePostgresUrl, readEnvFile, splitSqlStatements } from './run-stage20-release-readiness.mjs';

const CONFIRM = 'APPLY_T360_PAYROLL_ADJUSTMENT_NON_PRODUCTION';
const MIGRATION = 'database/migrations/T360-20260912-payroll-differential-adjustment/postgresql-expand.sql';

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function shortHash(value) { return hash(value).slice(0, 16); }

export function validatePayrollMigrationConfig(values) {
  const target = String(values.T360_PAYROLL_MIGRATION_TARGET || '').toUpperCase();
  if (!['TEST', 'STAGING'].includes(target)) throw new Error('T360_PAYROLL_MIGRATION_TARGET harus TEST atau STAGING.');
  if (values.T360_PAYROLL_MIGRATION_CONFIRM !== CONFIRM) throw new Error(`T360_PAYROLL_MIGRATION_CONFIRM harus ${CONFIRM}.`);
  const connection = parsePostgresUrl(values.T360_PAYROLL_MIGRATION_DATABASE_URL, 'T360_PAYROLL_MIGRATION_DATABASE_URL');
  if (connection.hostname !== values.T360_PAYROLL_MIGRATION_EXPECTED_HOST) throw new Error('Host payroll migration tidak cocok.');
  if (connection.database !== values.T360_PAYROLL_MIGRATION_EXPECTED_DATABASE) throw new Error('Database payroll migration tidak cocok.');
  const unsafe = /(^|[-_.])(prod|production|live)([-_.]|$)/i;
  if (unsafe.test(connection.hostname) || unsafe.test(connection.database)) throw new Error('Payroll migration menolak target production/live.');
  const marker = target === 'TEST' ? /test/i : /stag/i;
  if (!marker.test(connection.database)) throw new Error(`Nama database payroll migration harus memuat penanda ${target}.`);
  return { target, connection, databaseUrl: values.T360_PAYROLL_MIGRATION_DATABASE_URL };
}

function runNpm(args, env, label) {
  const result = spawnNpmSync(args, { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} gagal (exit ${result.status}).`);
}

async function inspect(prisma) {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema=current_schema()
      AND ((table_name='PayrollRun' AND column_name IN ('adjustmentOfRunId','adjustmentSequence','adjustmentReason','adjustmentPostingDate'))
        OR (table_name='PayrollPayment' AND column_name='direction'))
    ORDER BY table_name,column_name`);
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT indexname,indexdef FROM pg_indexes
    WHERE schemaname=current_schema()
      AND indexname='PayrollRun_companyId_branchId_adjustmentOfRunId_adjustmentSequence_key'`);
  let invalidDirection = null;
  const directionExists = columns.some((row) => row.table_name === 'PayrollPayment' && row.column_name === 'direction');
  if (directionExists) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "PayrollPayment" WHERE "direction" IS NULL OR "direction"=''`);
    invalidDirection = Number(rows?.[0]?.count || 0);
  }
  return { columns, indexes, invalidDirection };
}

function verifyAfter(state) {
  const required = new Set([
    'PayrollRun.adjustmentOfRunId','PayrollRun.adjustmentSequence','PayrollRun.adjustmentReason','PayrollRun.adjustmentPostingDate','PayrollPayment.direction',
  ]);
  for (const row of state.columns) required.delete(`${row.table_name}.${row.column_name}`);
  if (required.size) throw new Error(`Kolom payroll adjustment belum lengkap: ${[...required].join(', ')}.`);
  if (state.indexes.length !== 1) throw new Error('Unique index adjustment sequence belum tersedia.');
  if (state.invalidDirection !== 0) throw new Error(`PayrollPayment.direction invalid tersisa ${state.invalidDirection}.`);
}

async function main() {
  const root = process.cwd();
  const currentSourceIdentity = sourceFingerprint(root);
  const outputDir = path.join(root, 'logs', 'payroll-adjustment-postgres-stage');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'latest.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(), status: 'FAIL', productionTouched: false, sourceIdentity: currentSourceIdentity,
    buildArtifactId: null, preserveBuildArtifact: false,
    gate: { passed: false }, error: 'Payroll adjustment staging evidence invalidated at attempt start; a fresh PASS must replace it.'
  }, null, 2)}\n`);
  const args = process.argv.slice(2);
  const index = args.indexOf('--env-file');
  const preserveArtifact = args.includes('--preserve-artifact');
  const envFile = path.resolve(root, index >= 0 ? args[index + 1] : 'payroll-adjustment-postgres-stage.env');
  const values = { ...process.env, ...readEnvFile(envFile) };
  const config = validatePayrollMigrationConfig(values);
  const migrationPath = path.join(root, MIGRATION);
  if (!fs.existsSync(migrationPath)) throw new Error(`Migration SQL tidak ditemukan: ${MIGRATION}`);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const statements = splitSqlStatements(sql);
  if (!statements.length) throw new Error('Migration SQL kosong.');
  if (/\b(DROP\s+(?:TABLE|COLUMN|INDEX)|TRUNCATE\b|DELETE\s+FROM)\b/i.test(sql)) throw new Error('Payroll migration bukan expand-only; eksekusi ditolak.');

  const env = { ...process.env, DATABASE_PROFILE: 'postgresql', DATABASE_URL: config.databaseUrl };
  runNpm(['run', 'prisma:validate:postgres', '-w', '@toko360/api'], env, 'Validasi Prisma PostgreSQL');
  let buildArtifactId = null;
  if (preserveArtifact) {
    const artifact = readAndVerifyBuildArtifactManifest(root, 'handoff/quality/build-artifact-manifest-latest.json', currentSourceIdentity.value);
    buildArtifactId = artifact.current.id;
    console.log(`Payroll migration preserve-artifact: Prisma Client tidak digenerate ulang. artifact=${buildArtifactId}`);
  } else {
    runNpm(['run', 'db:postgres:generate'], env, 'Generate Prisma Client PostgreSQL');
  }
  process.env.DATABASE_URL = config.databaseUrl;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const evidence = {
    generatedAt: new Date().toISOString(), status: 'FAIL', productionTouched: false,
    sourceIdentity: currentSourceIdentity, buildArtifactId, preserveBuildArtifact: preserveArtifact, migration: MIGRATION, migrationSha256: hash(sql), statementCount: statements.length,
    target: { mode: config.target, hostHash: shortHash(config.connection.hostname), databaseHash: shortHash(config.connection.database) },
    before: null, after: null, gate: { passed: false }, error: null,
  };
  try {
    await prisma.$connect();
    evidence.before = await inspect(prisma);
    await prisma.$transaction(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
    }, { timeout: 120000 });
    evidence.after = await inspect(prisma);
    verifyAfter(evidence.after);
    evidence.status = 'PASS'; evidence.gate.passed = true;
    console.log(`Payroll adjustment PostgreSQL staging migration PASS — ${statements.length} statement(s).`);
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(outputDir, 'latest.json'), JSON.stringify(evidence, null, 2) + '\n');
    await prisma.$disconnect().catch(() => {});
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(`PAYROLL_MIGRATION_ERROR: ${error.message}`); process.exitCode = 1; });
