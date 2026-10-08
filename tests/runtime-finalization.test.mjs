import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const installer = readFileSync('scripts/install-dependencies.mjs', 'utf8');
const seed = readFileSync('apps/api/prisma/seed.ts', 'utf8');
const envLocal = readFileSync('.env.local.example', 'utf8');
const envPostgres = readFileSync('.env.postgres.example', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const smoke = readFileSync('scripts/smoke-db.mjs', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const releaseCi = readFileSync('.github/workflows/release-candidate.yml', 'utf8');
const fullSystemCi = readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');

test('dependency installer is lockfile deterministic and fails before npm ci when registry preflight is unavailable', () => {
  assert.match(installer, /package-lock\.json tidak ditemukan/);
  assert.match(installer, /'ci'/);
  assert.doesNotMatch(installer, /const installBase = \[\s*'install'/);
  assert.match(installer, /lookup\(hostname\)/);
  assert.match(installer, /npm.*ping|runNpm\(\['ping'/s);
  assert.match(installer, /Instalasi dibatalkan lebih awal/);
  assert.equal(pkg.scripts['setup:dependencies'], 'node scripts/install-dependencies.mjs');
});

test('PostgreSQL/staging seed defaults to fail-closed bootstrap rather than demo data', () => {
  assert.match(seed, /postgresProfile/);
  assert.match(seed, /\(protectedEnvironment \|\| postgresProfile\) \? 'bootstrap' : 'demo'/);
  assert.match(seed, /SEED_MODE=demo ditolak pada staging\/production/);
  assert.match(seed, /requiredSeedEnv\('SEED_COMPANY_ID'\)/);
  assert.match(seed, /bootstrapPassword\('SEED_ADMIN_PASSWORD'\)/);
});

test('bootstrap seed requires strong explicit identity and never accepts the demo admin domain', () => {
  for (const key of ['SEED_COMPANY_NAME', 'SEED_COMPANY_SLUG', 'SEED_BRANCH_CODE', 'SEED_BRANCH_NAME', 'SEED_WAREHOUSE_CODE', 'SEED_WAREHOUSE_NAME', 'SEED_ADMIN_EMAIL']) {
    assert.match(seed, new RegExp(`requiredSeedEnv\\('${key}'\\)`));
  }
  assert.match(seed, /minimal 14 karakter/);
  assert.match(seed, /bukan domain demo @toko360\.local/);
});

test('demo-only users, sample inventory and employee payroll fixtures are gated behind demoSeed', () => {
  assert.match(seed, /if \(demoSeed\) \{[\s\S]*kasir@toko360\.local/);
  assert.match(seed, /if \(demoSeed\) \{[\s\S]*PT Sumber Makmur[\s\S]*OPENING_STOCK/);
  assert.match(seed, /if \(demoSeed\) \{[\s\S]*karyawan@toko360\.local[\s\S]*BASIC_SALARY/);
});

test('seed logs never disclose seeded passwords', () => {
  assert.doesNotMatch(seed, /console\.log\([^\n]*SEED_.*PASSWORD/);
  assert.doesNotMatch(seed, /Login admin:.*Admin123!/);
  assert.doesNotMatch(seed, /Login karyawan:.*Employee123!/);
  assert.match(seed, /Password tidak ditampilkan ke log/);
});

test('promotion permissions used by controllers are part of canonical permission creation', () => {
  const permissionList = seed.slice(seed.indexOf('const permissionCodes'), seed.indexOf('for (const code of permissionCodes)'));
  assert.match(permissionList, /promotion\.view/);
  assert.match(permissionList, /promotion\.manage/);
});

function controllerFiles(dir) {
  const rows = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) rows.push(...controllerFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.controller.ts')) rows.push(path);
  }
  return rows;
}

test('every controller permission is present in the canonical seed permission list', () => {
  const permissionList = seed.slice(seed.indexOf('const permissionCodes'), seed.indexOf('for (const code of permissionCodes)'));
  const canonical = new Set([...permissionList.matchAll(/'([^']+)'/g)].map((match) => match[1]));
  assert.ok(canonical.size > 100, `expected canonical permission catalogue, found ${canonical.size}`);

  const unknown = [];
  for (const file of controllerFiles('apps/api/src')) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/@Permissions\(\s*['"]([^'"]+)['"]/g)) {
      if (!canonical.has(match[1])) unknown.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(unknown, [], `controller references non-canonical permissions:\n${unknown.join('\n')}`);
});

test('demo seed company ID is a standards-valid deterministic UUID', () => {
  const match = seed.match(/companyId:\s*'([0-9a-f-]{36})'/i);
  assert.ok(match, 'demo companyId harus tersedia');
  assert.match(match[1], /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('local seed remains explicitly demo-friendly while PostgreSQL example is bootstrap-safe', () => {
  assert.match(envLocal, /SEED_MODE=demo/);
  assert.match(envLocal, /SEED_ADMIN_PASSWORD=Admin123!/);
  assert.match(envPostgres, /NODE_ENV=staging/);
  assert.match(envPostgres, /SEED_MODE=bootstrap/);
  assert.match(envPostgres, /SEED_COMPANY_ID=CHANGE_ME_UUID/);
  assert.match(envPostgres, /SEED_ADMIN_PASSWORD=\s*(?:\r?\n|$)/);
});

test('PostgreSQL environment example contains no known demo credential', () => {
  for (const secret of ['Admin123!', 'Kasir123!', 'Employee123!', 'toko360_dev_password']) {
    assert.doesNotMatch(envPostgres, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});


test('database smoke test is seed-mode aware and bootstrap does not require demo fixtures', () => {
  assert.match(smoke, /const seedMode/);
  assert.match(smoke, /if \(seedMode === 'demo'\)/);
  assert.match(smoke, /seed demo harus memiliki product/);
  const bootstrapBranch = smoke.slice(smoke.indexOf("} else {"), smoke.indexOf("assert.ok(flags"));
  assert.doesNotMatch(bootstrapBranch, /products > 0|suppliers > 0/);
});

test('PostgreSQL CI exercises explicit bootstrap seed credentials instead of inheriting demo defaults', () => {
  for (const workflow of [ci, fullSystemCi]) {
    assert.match(workflow, /SEED_MODE: bootstrap/);
    assert.match(workflow, /SEED_COMPANY_ID: 11111111-1111-4111-8111-111111111111/);
    assert.match(workflow, /SEED_ADMIN_EMAIL: ci-admin@example\.invalid/);
    assert.match(workflow, /SEED_ADMIN_PASSWORD: CI-Only-Strong-Password-2026!/);
  }
  assert.match(releaseCi, /uses: \.\/\.github\/workflows\/full-system-simulation\.yml/);
});


test('release-candidate CI inherits the exact built browser UAT gate from full-system workflow', () => {
  assert.match(releaseCi, /uses: \.\/\.github\/workflows\/full-system-simulation\.yml/);
  assert.match(fullSystemCi, /npm run uat:browser:built/);
  assert.match(fullSystemCi, /T360_UAT_ENVIRONMENT: GITHUB_STAGING_SIMULATION/);
  assert.match(fullSystemCi, /CORS_ORIGINS:/);
});
