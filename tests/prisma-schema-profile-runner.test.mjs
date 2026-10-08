import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiPkg = JSON.parse(readFileSync('apps/api/package.json', 'utf8'));
const runner = readFileSync('scripts/run-prisma-schema-command.mjs', 'utf8');

const scripts = apiPkg.scripts;

test('schema-only Prisma validate/generate commands are profile-safe and do not require switching .env', () => {
  assert.equal(scripts['prisma:validate:sqlite'], 'node ../../scripts/run-prisma-schema-command.mjs sqlite validate');
  assert.equal(scripts['prisma:generate:sqlite'], 'node ../../scripts/run-prisma-schema-command.mjs sqlite generate');
  assert.equal(scripts['prisma:validate:postgres'], 'node ../../scripts/run-prisma-schema-command.mjs postgres validate');
  assert.equal(scripts['prisma:generate:postgres'], 'node ../../scripts/run-prisma-schema-command.mjs postgres generate');

  assert.match(runner, /new Set\(\['validate', 'generate'\]\)/);
  assert.match(runner, /DATABASE_PROFILE: profile\.databaseProfile/);
  assert.match(runner, /DATABASE_URL: databaseUrl/);
  assert.match(runner, /file:\.\/data\/toko360-schema-check\.db/);
  assert.match(runner, /postgresql:\/\/schema_check:schema_check@127\.0\.0\.1:5432\/toko360_schema_check\?schema=public/);
  assert.doesNotMatch(runner, /\.env\.postgres|copyFileSync|writeFileSync|dotenv\s+-e/);
});

test('database-touching Prisma commands remain fail-closed behind the active protected environment', () => {
  for (const name of [
    'prisma:push:postgres',
    'prisma:migrate:postgres',
    'prisma:seed:postgres',
    'prisma:studio:postgres',
    'prisma:push:postgres:no-generate',
  ]) {
    assert.match(scripts[name], /^dotenv -e \.\.\/\.\.\/\.env -- /, name);
    assert.doesNotMatch(scripts[name], /run-prisma-schema-command/, name);
  }
});
