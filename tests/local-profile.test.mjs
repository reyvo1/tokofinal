import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function models(schema) { return [...schema.matchAll(/^model\s+(\w+)/gm)].map((match) => match[1]); }

test('local profile uses SQLite and does not require root Docker Compose', () => {
  const env = readFileSync('.env.local.example', 'utf8');
  assert.match(env, /DATABASE_PROFILE=sqlite/);
  assert.match(env, /DATABASE_URL=file:\.\/data\/toko360\.db/);
  assert.equal(existsSync('docker-compose.yml'), false);
});

test('SQLite and PostgreSQL schemas stay structurally aligned', () => {
  const sqlite = readFileSync('apps/api/prisma/schema.sqlite.prisma', 'utf8');
  const postgres = readFileSync('apps/api/prisma/schema.postgresql.prisma', 'utf8');
  assert.deepEqual(models(sqlite), models(postgres));
  assert.match(sqlite, /provider\s*=\s*"sqlite"/);
  assert.match(postgres, /provider\s*=\s*"postgresql"/);
  assert.doesNotMatch(sqlite, /@db\.Decimal/);
});

test('Ubuntu-first local tooling is canonical and source tree has no Windows launchers', () => {
  for (const path of ['scripts/setup-local.mjs', 'scripts/reset-local-db.mjs']) assert.equal(existsSync(path), true, `missing ${path}`);
  const found = [];
  const skip = new Set(['node_modules', '.git', '.next', 'dist']);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(?:cmd|ps1)$/i.test(name)) found.push(path);
    }
  };
  walk('.');
  assert.deepEqual(found, []);
});
