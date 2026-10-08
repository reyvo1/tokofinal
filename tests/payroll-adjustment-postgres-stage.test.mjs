import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePayrollMigrationConfig } from '../scripts/run-payroll-adjustment-postgres-stage.mjs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const stage20 = fs.readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');
const migration = fs.readFileSync('database/migrations/T360-20260912-payroll-differential-adjustment/postgresql-expand.sql','utf8');
const example = fs.readFileSync('config/payroll-adjustment-postgres-stage.env.example','utf8');
const runner = fs.readFileSync('scripts/run-payroll-adjustment-postgres-stage.mjs','utf8');

const base = {
  T360_PAYROLL_MIGRATION_TARGET: 'STAGING',
  T360_PAYROLL_MIGRATION_CONFIRM: 'APPLY_T360_PAYROLL_ADJUSTMENT_NON_PRODUCTION',
  T360_PAYROLL_MIGRATION_DATABASE_URL: 'postgresql://user:secret@localhost:5432/toko360_staging?sslmode=disable',
  T360_PAYROLL_MIGRATION_EXPECTED_HOST: 'localhost',
  T360_PAYROLL_MIGRATION_EXPECTED_DATABASE: 'toko360_staging',
};

test('payroll adjustment PostgreSQL migration runner requires exact non-production identity', () => {
  const config = validatePayrollMigrationConfig(base);
  assert.equal(config.target, 'STAGING');
  assert.equal(config.connection.database, 'toko360_staging');
  assert.throws(() => validatePayrollMigrationConfig({ ...base, T360_PAYROLL_MIGRATION_DATABASE_URL: 'postgresql://u:p@localhost:5432/toko360_production', T360_PAYROLL_MIGRATION_EXPECTED_DATABASE: 'toko360_production' }), /production\/live/);
  assert.throws(() => validatePayrollMigrationConfig({ ...base, T360_PAYROLL_MIGRATION_CONFIRM: 'WRONG' }), /APPLY_T360_PAYROLL_ADJUSTMENT_NON_PRODUCTION/);
});

test('payroll adjustment PostgreSQL migration remains expand-only and idempotent', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "adjustmentOfRunId"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "direction"/);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|INDEX)|TRUNCATE|DELETE\s+FROM/i);
});

test('Stage-20 requires payroll migration evidence for the same source and target database', () => {
  assert.match(stage20, /payroll-adjustment-postgres-stage/);
  assert.match(stage20, /payrollMigration\.sourceIdentity\?\.value !== currentSourceIdentity\.value/);
  assert.match(stage20, /payrollMigration\.target\?\.hostHash !== targetHostHash/);
  assert.match(stage20, /payrollMigration\.target\?\.databaseHash !== targetDatabaseHash/);
  assert.match(stage20, /payrollAdjustmentPostgresMigration: true/);
  assert.match(stage20, /payrollMigration\.preserveBuildArtifact !== true/);
  assert.match(stage20, /payrollMigration\.buildArtifactId !== buildArtifact\.current\.id/);
});

test('staging commands expose migration and prepare Stage-20 before final readiness runner', () => {
  assert.equal(pkg.scripts['db:payroll-adjustment:stage:postgres'], 'node scripts/run-payroll-adjustment-postgres-stage.mjs --env-file payroll-adjustment-postgres-stage.env');
  assert.match(pkg.scripts['release:readiness:staging'], /prepare-stage20-postgres\.mjs/);
  assert.match(pkg.scripts['release:readiness:staging'], /run-stage20-release-readiness\.mjs/);
  assert.match(pkg.scripts['db:payroll-adjustment:stage:postgres:artifact'], /--preserve-artifact/);
  assert.match(example, /T360_PAYROLL_MIGRATION_CONFIRM=APPLY_T360_PAYROLL_ADJUSTMENT_NON_PRODUCTION/);
});


test('Stage-20 blocks release when payroll recovery mapping/account/rule configuration is missing', () => {
  assert.match(stage20, /__PAYROLL_RECEIVABLE__/);
  assert.match(stage20, /PAYROLL_EMPLOYEE_RECOVERY/);
  assert.match(stage20, /PAYROLL_RECOVERY_CONFIGURATION/);
  assert.match(stage20, /Object\.values\(payrollRecoveryConfiguration\)\.every\(Boolean\)/);
});


test('payroll migration invalidates stale latest evidence before migration preflight', () => {
  assert.match(runner, /evidence invalidated at attempt start/);
  assert.match(runner, /status: 'FAIL'/);
  assert.match(runner, /sourceIdentity: currentSourceIdentity/);
});


test('payroll migration can preserve exact build artifact without regenerating Prisma Client', () => {
  assert.match(runner, /const preserveArtifact = args\.includes\('--preserve-artifact'\)/);
  assert.match(runner, /readAndVerifyBuildArtifactManifest/);
  assert.match(runner, /buildArtifactId = artifact\.current\.id/);
  assert.match(runner, /preserveBuildArtifact: preserveArtifact/);
  assert.ok(runner.includes("else {\n    runNpm(['run', 'db:postgres:generate']"));
});
