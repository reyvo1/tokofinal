import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('scripts/run-build-gate.mjs','utf8');
const apiPkg=JSON.parse(fs.readFileSync('apps/api/package.json','utf8'));
const rootPkg=JSON.parse(fs.readFileSync('package.json','utf8'));

test('build gate completes SQLite DB smoke before final PostgreSQL Prisma generation and artifact build', () => {
  const sqlitePrepare=source.indexOf('SQLITE_DB_PREPARE');
  const sqliteSmoke=source.indexOf('SQLITE_DB_SMOKE');
  const postgresFinal=source.indexOf('PRISMA_GENERATE_POSTGRES_FINAL');
  const build=source.indexOf('SIX_APP_PRODUCTION_BUILD');
  assert.ok(sqlitePrepare >= 0 && sqliteSmoke > sqlitePrepare && postgresFinal > sqliteSmoke && build > postgresFinal);
  assert.doesNotMatch(source,/PRISMA_GENERATE_SQLITE/);
});

test('artifact-safe PostgreSQL preparation uses prisma db push --skip-generate', () => {
  assert.match(apiPkg.scripts['prisma:push:postgres:no-generate'],/--skip-generate/);
  assert.match(rootPkg.scripts['db:postgres:push:artifact'],/prisma:push:postgres:no-generate/);
  assert.match(rootPkg.scripts['db:postgres:prepare:artifact'],/db:postgres:push:artifact/);
  assert.doesNotMatch(rootPkg.scripts['db:postgres:prepare:artifact'],/db:postgres:generate/);
});
