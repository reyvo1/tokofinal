import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const primaryUrl = process.env.DATABASE_URL
  || 'postgresql://postgres:toko360_ci_password@localhost:5432/toko360_staging';
const primary = new URL(primaryUrl);
const restoreDatabase = process.env.T360_CI_STAGE18_RESTORE_DATABASE || 'toko360_stage18_restore';
const restoreBuilder = new URL(primaryUrl);
restoreBuilder.pathname = `/${restoreDatabase}`;
const restoreUrl = restoreBuilder.toString();
const restore = new URL(restoreUrl);

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function serialize(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v ?? ''}`).join('\n') + '\n';
}

function exampleFor(target) {
  const base = path.basename(target);
  const candidates = [
    path.join(root, `${target}.example`),
    path.join(root, 'config', `${base}.example`),
  ];
  return candidates.find(fs.existsSync);
}

function normalizeTemplate(target, stage, confirmation, extra = {}) {
  const example = exampleFor(target);
  const env = example ? parseEnv(example) : {};

  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();

    if (upper.includes('DATABASE_URL') || upper.endsWith('_URL')) {
      env[key] = upper.includes('RESTORE') ? restoreUrl : primaryUrl;
    }
    if (upper.includes('EXPECTED_HOST')) {
      env[key] = upper.includes('RESTORE') ? restore.hostname : primary.hostname;
    }
    if (upper.includes('EXPECTED_DATABASE')) {
      env[key] = upper.includes('RESTORE')
        ? decodeURIComponent(restore.pathname.slice(1))
        : decodeURIComponent(primary.pathname.slice(1));
    }
    if (upper.endsWith('_TARGET') || upper.includes('_TARGET_MODE')) env[key] = 'STAGING';
    if (upper.includes('CONFIRM')) {
      env[key] = upper.includes('RESTORE')
        ? 'REPLACE_T360_STAGE18_RESTORE_DATABASE'
        : confirmation;
    }
  }

  Object.assign(env, {
    DATABASE_PROFILE: 'postgresql',
    DATABASE_URL: primaryUrl,
    T360_ALLOW_PRESERVE_ARTIFACT: '1',
    ...extra,
  });

  // Exact aliases used by current repo runners.
  if (stage === 18) {
    Object.assign(env, {
      T360_STAGE18_TARGET: 'STAGING',
      T360_STAGE18_DATABASE_URL: primaryUrl,
      T360_STAGE18_PRIMARY_DATABASE_URL: primaryUrl,
      T360_STAGE18_EXPECTED_HOST: primary.hostname,
      T360_STAGE18_EXPECTED_DATABASE: decodeURIComponent(primary.pathname.slice(1)),
      T360_STAGE18_CONFIRM: 'APPLY_T360_STAGE18_NON_PRODUCTION',
      T360_STAGE18_CONFIRMATION: 'APPLY_T360_STAGE18_NON_PRODUCTION',
      T360_STAGE18_RESTORE_DATABASE_URL: restoreUrl,
      T360_STAGE18_RESTORE_URL: restoreUrl,
      T360_STAGE18_RESTORE_EXPECTED_HOST: restore.hostname,
      T360_STAGE18_RESTORE_EXPECTED_DATABASE: decodeURIComponent(restore.pathname.slice(1)),
      T360_STAGE18_EXPECTED_RESTORE_HOST: restore.hostname,
      T360_STAGE18_EXPECTED_RESTORE_DATABASE: decodeURIComponent(restore.pathname.slice(1)),
      T360_STAGE18_RESTORE_CONFIRM: 'REPLACE_T360_STAGE18_RESTORE_DATABASE',
      T360_STAGE18_RESTORE_CONFIRMATION: 'REPLACE_T360_STAGE18_RESTORE_DATABASE',
    });
  }

  if (stage === 19) {
    Object.assign(env, {
      T360_STAGE19_TARGET: 'STAGING',
      T360_STAGE19_DATABASE_URL: primaryUrl,
      T360_STAGE19_EXPECTED_HOST: primary.hostname,
      T360_STAGE19_EXPECTED_DATABASE: decodeURIComponent(primary.pathname.slice(1)),
      T360_STAGE19_CONFIRM: confirmation,
      T360_STAGE19_CONFIRMATION: confirmation,
    });
  }

  if (stage === 'payroll') {
    Object.assign(env, {
      T360_PAYROLL_ADJUSTMENT_TARGET: 'STAGING',
      T360_PAYROLL_ADJUSTMENT_DATABASE_URL: primaryUrl,
      T360_PAYROLL_ADJUSTMENT_EXPECTED_HOST: primary.hostname,
      T360_PAYROLL_ADJUSTMENT_EXPECTED_DATABASE: decodeURIComponent(primary.pathname.slice(1)),
      T360_PAYROLL_ADJUSTMENT_CONFIRM: confirmation,
      T360_PAYROLL_ADJUSTMENT_CONFIRMATION: confirmation,
    });
  }

  if (stage === 20) {
    Object.assign(env, {
      T360_STAGE20_TARGET: 'STAGING',
      T360_STAGE20_DATABASE_URL: primaryUrl,
      T360_STAGE20_EXPECTED_HOST: primary.hostname,
      T360_STAGE20_EXPECTED_DATABASE: decodeURIComponent(primary.pathname.slice(1)),
      T360_STAGE20_CONFIRM: confirmation,
      T360_STAGE20_CONFIRMATION: confirmation,
      T360_STAGE20_API_PORT: '42020',
      T360_STAGE20_HEALTH_SAMPLES: '30',
      T360_STAGE20_HEALTH_INTERVAL_MS: '50',
      T360_STAGE20_HEALTH_P95_BUDGET_MS: '1000',
      T360_STAGE20_MAX_ACTIVE_CONNECTIONS: '50',
    });
  }

  fs.writeFileSync(path.join(root, target), serialize(env));
  console.log(`Wrote ${target}`);
}

normalizeTemplate('stage18-postgres.env', 18, 'APPLY_T360_STAGE18_NON_PRODUCTION');
normalizeTemplate('stage19-integration.env', 19, 'RUN_T360_STAGE19_NON_PRODUCTION');
normalizeTemplate('payroll-adjustment-postgres-stage.env', 'payroll', 'APPLY_T360_PAYROLL_ADJUSTMENT_NON_PRODUCTION');
normalizeTemplate('stage20-release-readiness.env', 20, 'RUN_T360_STAGE20_NON_PRODUCTION');

const seedSource = path.join(root, 'apps', 'api', 'prisma', 'seed.ts');
const seedText = fs.readFileSync(seedSource, 'utf8');
const requiredNames = [...new Set(
  [...seedText.matchAll(/requiredSeedEnv\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map((m) => m[1])
)];

const fixedUuid = {
  SEED_COMPANY_ID: '11111111-1111-4111-8111-111111111111',
  SEED_BRANCH_ID: '22222222-2222-4222-8222-222222222222',
  SEED_ADMIN_USER_ID: '33333333-3333-4333-8333-333333333333',
  SEED_EMPLOYEE_USER_ID: '44444444-4444-4444-8444-444444444444',
};

function seedValue(name, index) {
  if (fixedUuid[name]) return fixedUuid[name];
  const upper = name.toUpperCase();

  const known = {
    SEED_MODE: 'bootstrap',
    SEED_COMPANY_SLUG: 'toko360-demo',
    SEED_COMPANY_NAME: 'Toko360 Demo',
    SEED_BRANCH_CODE: 'PUSAT',
    SEED_BRANCH_NAME: 'Cabang Pusat',
    SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || process.env.T360_UAT_ADMIN_EMAIL || 'ci-admin@example.invalid',
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || process.env.T360_UAT_ADMIN_PASSWORD || 'CI-Only-Strong-Password-2026!',
    SEED_EMPLOYEE_EMAIL: process.env.SEED_EMPLOYEE_EMAIL || 'ci-employee@example.invalid',
    SEED_EMPLOYEE_PASSWORD: process.env.SEED_EMPLOYEE_PASSWORD || 'CI-Only-Employee-Password-2026!',
  };
  if (known[name]) return known[name];

  if (upper.endsWith('_ID')) {
    const suffix = String(100 + index).padStart(12, '0');
    return `55555555-5555-4555-8555-${suffix}`;
  }
  if (upper.includes('EMAIL')) return `${name.toLowerCase().replaceAll('_', '-')}@toko360.local`;
  if (upper.includes('PASSWORD') || upper.includes('SECRET')) return 'Toko360-CI-Password-123!';
  if (upper.includes('SLUG')) return name.toLowerCase().replace(/^seed_/, '').replaceAll('_', '-');
  if (upper.includes('CODE')) return name.replace(/^SEED_/, '').replaceAll('_', '-').slice(0, 30);
  if (upper.includes('NAME')) return name.replace(/^SEED_/, '').replaceAll('_', ' ');
  if (upper.includes('DATE')) return '2026-01-01';
  if (upper.includes('CURRENCY')) return 'IDR';
  if (upper.includes('TIMEZONE')) return 'Asia/Makassar';
  return `github-uat-${index + 1}`;
}

const dotEnv = parseEnv(path.join(root, '.env'));
Object.assign(dotEnv, {
  DATABASE_PROFILE: 'postgresql',
  DATABASE_URL: primaryUrl,
  NODE_ENV: 'test',
  JWT_SECRET: 'github-uat-jwt-secret-0123456789abcdef',
  ORDER_ACCESS_SECRET: 'github-uat-order-secret-0123456789',
  SECRET_MASTER_KEY: 'github-uat-master-key-0123456789abcdef',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003',
  SEED_MODE: 'bootstrap',
  SEED_COMPANY_ID: fixedUuid.SEED_COMPANY_ID,
  SEED_COMPANY_SLUG: 'toko360-demo',
  SEED_COMPANY_NAME: 'Toko360 Demo',
  SEED_BRANCH_ID: fixedUuid.SEED_BRANCH_ID,
  SEED_BRANCH_CODE: 'PUSAT',
  SEED_BRANCH_NAME: 'Cabang Pusat',
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || process.env.T360_UAT_ADMIN_EMAIL || 'ci-admin@example.invalid',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || process.env.T360_UAT_ADMIN_PASSWORD || 'CI-Only-Strong-Password-2026!',
  SEED_EMPLOYEE_EMAIL: process.env.SEED_EMPLOYEE_EMAIL || 'ci-employee@example.invalid',
  SEED_EMPLOYEE_PASSWORD: process.env.SEED_EMPLOYEE_PASSWORD || 'CI-Only-Employee-Password-2026!',
});

requiredNames.forEach((name, index) => {
  if (!dotEnv[name]) dotEnv[name] = seedValue(name, index);
});

fs.writeFileSync(path.join(root, '.env'), serialize(dotEnv));
console.log(`Wrote .env with ${requiredNames.length} required bootstrap seed variables.`);

const decisions = path.join(root, 'stage18-ownership-decisions.json');
if (!fs.existsSync(decisions)) {
  fs.writeFileSync(decisions, JSON.stringify({
    version: 1,
    productAssignments: [],
    supplierAssignments: [],
  }, null, 2) + '\n');
}

const uat = path.join(root, 'stage20-uat-results.json');
if (!fs.existsSync(uat)) {
  const candidates = [
    path.join(root, 'stage20-uat-results.json.example'),
    path.join(root, 'config', 'stage20-uat-results.json.example'),
  ];
  const example = candidates.find(fs.existsSync);
  if (example) fs.copyFileSync(example, uat);
}

if (process.argv.includes('--seed')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'api', 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  const selected = ['prisma:seed:postgres', 'db:seed:postgres', 'seed:postgres', 'db:seed', 'seed']
    .find((name) => typeof scripts[name] === 'string');

  if (!selected) throw new Error('Canonical API seed script tidak ditemukan.');

  console.log(`Running API seed: ${selected}`);
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', selected, '-w', '@toko360/api'],
    { cwd: root, env: { ...process.env, ...dotEnv }, stdio: 'inherit', shell: false },
  );
  process.exit(result.status ?? 1);
}
