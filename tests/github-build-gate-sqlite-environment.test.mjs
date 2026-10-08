import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('scripts/run-build-gate.mjs', 'utf8');

test('GitHub build gate fully isolates SQLite compatibility seed from staging classification', () => {
  assert.match(source, /const sqliteEnv = \{ DATABASE_PROFILE: 'sqlite', DATABASE_URL: 'file:\.\/data\/build-gate\.db', SEED_MODE: 'demo', NODE_ENV: 'test' \};/);
  assert.match(source, /runNpm\(\['run', 'db:local:prepare'\], 'SQLITE_DB_PREPARE', sqliteEnv\)/);
  assert.match(source, /runNpm\(\['run', 'test:db:smoke'\], 'SQLITE_DB_SMOKE', sqliteEnv\)/);
});

test('production six-app build remains production-classified after SQLite compatibility checks', () => {
  const sqlitePrepare = source.indexOf('SQLITE_DB_PREPARE');
  const postgresFinal = source.indexOf('PRISMA_GENERATE_POSTGRES_FINAL');
  const productionBuild = source.indexOf("SIX_APP_PRODUCTION_BUILD', { NODE_ENV: 'production' }");
  assert.ok(sqlitePrepare >= 0);
  assert.ok(postgresFinal > sqlitePrepare);
  assert.ok(productionBuild > postgresFinal);
});
