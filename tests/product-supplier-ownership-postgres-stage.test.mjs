import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildTransactionalSql,
  loadDecisions,
  parsePostgresUrl,
  sqlLiteral,
  validateNonProductionConfig,
} from '../scripts/run-product-supplier-ownership-postgres-stage.mjs';

const validValues = {
  T360_STAGE18_TARGET: 'STAGING',
  T360_STAGE18_CONFIRM: 'APPLY_T360_STAGE18_NON_PRODUCTION',
  T360_STAGE18_DATABASE_URL: 'postgresql://user:secret@db.internal:5432/toko360_staging?sslmode=require',
  T360_STAGE18_EXPECTED_HOST: 'db.internal',
  T360_STAGE18_EXPECTED_DATABASE: 'toko360_staging',
  T360_STAGE18_RESTORE_CONFIRM: 'REPLACE_T360_STAGE18_RESTORE_DATABASE',
  T360_STAGE18_RESTORE_DATABASE_URL: 'postgresql://user:secret@db.internal:5432/toko360_stage18_restore?sslmode=require',
  T360_STAGE18_EXPECTED_RESTORE_HOST: 'db.internal',
  T360_STAGE18_EXPECTED_RESTORE_DATABASE: 'toko360_stage18_restore',
};

test('PostgreSQL stage config requires exact non-production identity and separate restore database', () => {
  const config = validateNonProductionConfig(validValues);
  assert.equal(config.target, 'STAGING');
  assert.equal(config.primary.database, 'toko360_staging');
  assert.equal(config.restore.database, 'toko360_stage18_restore');
  assert.equal(config.primary.password, 'secret');
});

test('PostgreSQL stage config rejects production markers and identity mismatch', () => {
  assert.throws(() => validateNonProductionConfig({
    ...validValues,
    T360_STAGE18_DATABASE_URL: 'postgresql://user:secret@db.internal:5432/toko360_production',
    T360_STAGE18_EXPECTED_DATABASE: 'toko360_production',
  }), /production\/live|penanda production/i);
  assert.throws(() => validateNonProductionConfig({
    ...validValues,
    T360_STAGE18_EXPECTED_HOST: 'other.internal',
  }), /Host target tidak cocok/);
  assert.throws(() => validateNonProductionConfig({
    ...validValues,
    T360_STAGE18_RESTORE_DATABASE_URL: validValues.T360_STAGE18_DATABASE_URL,
    T360_STAGE18_EXPECTED_RESTORE_DATABASE: 'toko360_staging',
  }), /wajib berbeda/);
});

test('PostgreSQL URL parser supports sslmode without exposing credentials in identity fields', () => {
  const parsed = parsePostgresUrl('postgresql://alice:p%40ss@stage.example:6432/toko360_staging?sslmode=verify-full', 'URL');
  assert.deepEqual(parsed, {
    hostname: 'stage.example',
    port: '6432',
    database: 'toko360_staging',
    username: 'alice',
    password: 'p@ss',
    sslmode: 'verify-full',
  });
});

test('SQL literal escapes administrative decision values', () => {
  assert.equal(sqlLiteral("O'Reilly"), "'O''Reilly'");
  assert.equal(sqlLiteral(null), 'NULL');
});

test('Transactional PostgreSQL migration is additive, gated, and idempotent-ready', () => {
  const sql = buildTransactionalSql({
    productAssignments: [],
    supplierAssignments: [{
      supplierId: 'supplier-1', expectedCode: 'SUP-001', expectedName: 'PT Sumber Makmur',
      companyId: 'company-1', expectedCompanySlug: 'toko360-demo', expectedCompanyName: 'Toko360 Demo',
      requireOnlyCompany: true, requireNoTransactionCandidate: true,
    }],
  });
  assert.match(sql, /^\\set ON_ERROR_STOP on\nBEGIN;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "companyId" TEXT/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "Product_companyId_sku_idx"/);
  assert.match(sql, /UPDATE "Product" p SET "companyId"/);
  assert.match(sql, /UPDATE "Supplier" s SET "companyId"/);
  assert.match(sql, /T360_STAGE18_GATE product_unresolved/);
  assert.match(sql, /T360_STAGE18_GATE supplier_unresolved/);
  assert.match(sql, /T360_STAGE18_DECISION expected no transaction candidate/);
  assert.match(sql, /COMMIT;\n$/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test('Stage 18 decision file keeps explicit Stage 17 mapping conditional', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't360-stage18-decisions-'));
  const file = path.join(temp, 'decisions.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    productAssignments: [],
    supplierAssignments: [{ supplierId: 's1', companyId: 'c1', optionalIfMissing: true }],
  }));
  const decisions = loadDecisions(file);
  assert.equal(decisions.supplierAssignments.length, 1);
  assert.equal(decisions.supplierAssignments[0].optionalIfMissing, true);
});

test('Stage 18 repository includes PostgreSQL restore drill and sanitized evidence contract', () => {
  const source = fs.readFileSync(new URL('../scripts/run-product-supplier-ownership-postgres-stage.mjs', import.meta.url), 'utf8');
  assert.match(source, /pg_dump/);
  assert.match(source, /pg_restore/);
  assert.match(source, /DROP SCHEMA IF EXISTS public CASCADE/);
  assert.match(source, /hashIdentifier/);
  assert.match(source, /Credential dan raw database URL tidak disimpan/);
  assert.match(source, /replace\(\/postgres/);
});


test('Stage 18 invalidates stale official and latest evidence at attempt start', () => {
  const source = fs.readFileSync(new URL('../scripts/run-product-supplier-ownership-postgres-stage.mjs', import.meta.url), 'utf8');
  assert.match(source, /Stage-18 evidence invalidated at attempt start/);
  assert.match(source, /officialEvidencePath/);
  assert.match(source, /path\.join\(outputRoot, 'latest\.json'\)/);
  assert.match(source, /sourceIdentity: currentSourceIdentity/);
});
