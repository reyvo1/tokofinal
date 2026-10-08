import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const manifest = JSON.parse(read('config/expand-migration-order.json'));
const fullSystem = read('.github/workflows/full-system-simulation.yml');
const fullUat = read('.github/workflows/toko360-full-uat.yml');
const rehearsal = read('scripts/rehearse-expand-migrations.mjs');
const pkg = JSON.parse(read('package.json'));

test('expand migration manifest keeps dependency-safe F2-F11 order', () => {
  const names = manifest.migrations;
  assert.ok(Array.isArray(names) && names.length >= 11);
  const pos = (name) => names.indexOf(name);
  assert.ok(pos('T360-20260923-category-hierarchy') >= 0);
  assert.ok(pos('T360-20260923-product-variant') < pos('T360-20260923-product-multi-uom'));
  assert.ok(pos('T360-20260923-product-multi-uom') < pos('T360-20260923-f11-transaction-uom'));
  assert.ok(pos('T360-20260923-inventory-serial-receipt') < pos('T360-20260923-f3-transfer-traceability'));
  for (const name of names) {
    assert.ok(fs.existsSync(path.join(root, 'database', 'migrations', name, 'sqlite-expand.sql')), `${name} sqlite migration missing`);
    assert.ok(fs.existsSync(path.join(root, 'database', 'migrations', name, 'postgresql-expand.sql')), `${name} postgres migration missing`);
  }
});

test('migration rehearsal refuses mutation of an already-existing migration and checks current schema contract', () => {
  assert.match(rehearsal, /Migration yang sudah ada di baseline berubah/);
  assert.match(rehearsal, /buildExpectedSchemaContract/);
  assert.match(rehearsal, /compareSchemaContract/);
  assert.match(rehearsal, /missingTables/);
  assert.match(rehearsal, /missingColumns/);
  assert.match(rehearsal, /generateScratchClient/);
  assert.match(rehearsal, /output = \"\$\{normalizedOutput\}\"/);
  assert.match(rehearsal, /pathToFileURL\(entry\)/);
  assert.doesNotMatch(rehearsal, /import\('@prisma\/client'\)/);
  assert.doesNotMatch(rehearsal, /PGPASSWORD[^\n]*commandArgs/);
});

test('local and PostgreSQL rehearsal commands are exposed through npm', () => {
  assert.match(pkg.scripts['db:migrations:rehearse:sqlite'], /rehearse-expand-migrations\.mjs --provider sqlite/);
  assert.match(pkg.scripts['db:migrations:rehearse:postgres'], /rehearse-expand-migrations\.mjs --provider postgresql/);
});

test('authoritative GitHub full-system simulation rehearses expand migrations before staging db push', () => {
  const migrationAt = fullSystem.indexOf('Rehearse expand migrations from previous source baseline');
  const stagingAt = fullSystem.indexOf('Prepare PostgreSQL staging schema and bootstrap seed');
  assert.ok(migrationAt > 0 && stagingAt > migrationAt);
  assert.match(fullSystem, /T360_MIGRATION_BASE_REF="\$BASE_REF" npm run db:migrations:rehearse:postgres/);
  assert.match(fullSystem, /CREATE DATABASE toko360_migration_rehearsal/);
});

test('manual GitHub full UAT also rehearses migrations and reports the gate', () => {
  assert.match(fullUat, /fetch-depth: 0/);
  assert.match(fullUat, /id: migration_rehearsal/);
  assert.match(fullUat, /db:migrations:rehearse:postgres/);
  assert.match(fullUat, /STEP_MIGRATION: \$\{\{ steps\.migration_rehearsal\.outcome \}\}/);
  assert.match(fullUat, /check "Expand migration rehearsal" "\$STEP_MIGRATION"/);
});


test('migration rehearsal keeps Prisma verification schema inside API workspace so generate never auto-installs from filesystem root', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'rehearse-expand-migrations.mjs'), 'utf8');
  assert.match(script, /const apiWorkspace = path\.join\(root, 'apps', 'api'\)/);
  assert.match(script, /fs\.mkdtempSync\(path\.join\(apiWorkspace, '\.t360-migration-rehearsal-'\)\)/);
  assert.doesNotMatch(script, /os\.tmpdir\(\).*t360-migration-rehearsal/);
});
