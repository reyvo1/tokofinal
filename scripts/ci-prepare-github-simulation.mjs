#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REQUIRED_UAT_IDS = [
  'UAT-01-AUTH-ACCESS',
  'UAT-02-PUBLIC-CATALOG',
  'UAT-03-SALES-ORDER-PAYMENT',
  'UAT-04-PURCHASE-RECEIPT',
  'UAT-05-INVENTORY-OPERATIONS',
  'UAT-06-ACCOUNTING-FINANCE-REPORTS',
  'UAT-07-HR-ATTENDANCE-PAYROLL',
  'UAT-08-OFFLINE-SYNC',
  'UAT-09-AUDIT-DENIAL',
  'UAT-10-RESTORE-ROLLBACK',
  'UAT-11-DELIVERY-LIFECYCLE',
  'UAT-12-PAYROLL-ADJUSTMENT-RECOVERY',
];

const scenarioNotes = {
  'UAT-01-AUTH-ACCESS': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-02-PUBLIC-CATALOG': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-03-SALES-ORDER-PAYMENT': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-04-PURCHASE-RECEIPT': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-05-INVENTORY-OPERATIONS': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-06-ACCOUNTING-FINANCE-REPORTS': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-07-HR-ATTENDANCE-PAYROLL': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-08-OFFLINE-SYNC': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-09-AUDIT-DENIAL': 'Automated GitHub coverage exists; human UAT remains required for release.',
  'UAT-10-RESTORE-ROLLBACK': 'Automated GitHub DR/restore coverage exists; human rollback review remains required.',
  'UAT-11-DELIVERY-LIFECYCLE': 'Automated GitHub source/browser coverage exists; human operational UAT remains required.',
  'UAT-12-PAYROLL-ADJUSTMENT-RECOVERY': 'Automated GitHub source/PostgreSQL coverage exists; human operational UAT remains required.',
};

function required(env, key) {
  const value = String(env[key] ?? '').trim();
  if (!value) throw new Error(`${key} wajib diisi untuk GitHub system simulation.`);
  return value;
}

function parsePostgres(raw) {
  let value;
  try { value = new URL(raw); } catch { throw new Error('T360_CI_DATABASE_URL tidak valid.'); }
  if (!['postgres:', 'postgresql:'].includes(value.protocol)) throw new Error('T360_CI_DATABASE_URL wajib PostgreSQL.');
  const database = decodeURIComponent(value.pathname.replace(/^\//, ''));
  if (!value.hostname || !database || !value.username) throw new Error('T360_CI_DATABASE_URL wajib memuat host, database, dan user.');
  return { url: raw, host: value.hostname, port: value.port || '5432', database };
}

export function validateGithubSimulationConfig(env = process.env) {
  const databaseUrl = required(env, 'T360_CI_DATABASE_URL');
  const connection = parsePostgres(databaseUrl);
  const expectedHost = required(env, 'T360_CI_EXPECTED_HOST');
  const expectedDatabase = required(env, 'T360_CI_EXPECTED_DATABASE');
  if (connection.host !== expectedHost || connection.database !== expectedDatabase) throw new Error('GitHub simulation database tidak cocok dengan expected host/database.');
  if (/(^|[-_.])(prod|production|live)([-_.]|$)/i.test(connection.host) || /(^|[-_.])(prod|production|live)([-_.]|$)/i.test(connection.database)) {
    throw new Error('GitHub system simulation menolak target production/live.');
  }
  if (!/(test|stag)/i.test(connection.database)) throw new Error('Database GitHub simulation wajib memuat penanda test/stag.');

  const restoreDatabase = required(env, 'T360_CI_STAGE18_RESTORE_DATABASE');
  const drRestoreDatabase = required(env, 'T360_CI_DR_RESTORE_DATABASE');
  for (const [label, name] of [['stage18 restore', restoreDatabase], ['DR restore', drRestoreDatabase]]) {
    if (!/(test|stag|restore|dr)/i.test(name) || /(^|[-_.])(prod|production|live)([-_.]|$)/i.test(name)) throw new Error(`${label} database tidak aman untuk CI.`);
    if (name === connection.database) throw new Error(`${label} database wajib berbeda dari target utama.`);
  }
  if (restoreDatabase === drRestoreDatabase) throw new Error('Stage18 restore dan DR restore wajib database berbeda.');

  const corsOrigins = String(env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003').split(',').map((value) => value.trim()).filter(Boolean);
  const browserDefaults = { T360_STOREFRONT_URL: 'http://localhost:3000', T360_ADMIN_URL: 'http://localhost:3001', T360_POS_URL: 'http://localhost:3002', T360_EMPLOYEE_URL: 'http://localhost:3003' };
  for (const [key, fallback] of Object.entries(browserDefaults)) {
    const raw = String(env[key] || fallback);
    let origin;
    try { origin = new URL(raw).origin; } catch { throw new Error(`${key} tidak valid.`); }
    if (!corsOrigins.includes(origin)) throw new Error(`${key} origin ${origin} tidak tercakup CORS_ORIGINS GitHub simulation.`);
  }
  const publicApiUrl = String(env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1');
  const probeApiUrl = String(env.T360_API_URL || 'http://localhost:4000/api/v1');
  let publicApi; let probeApi;
  try { publicApi = new URL(publicApiUrl); probeApi = new URL(probeApiUrl); } catch { throw new Error('NEXT_PUBLIC_API_URL/T360_API_URL tidak valid.'); }
  if (publicApi.origin !== probeApi.origin || publicApi.pathname.replace(/\/$/, '') !== probeApi.pathname.replace(/\/$/, '')) {
    throw new Error('NEXT_PUBLIC_API_URL dan T360_API_URL wajib menunjuk API base yang sama pada GitHub simulation.');
  }

  const adminEmail = required(env, 'SEED_ADMIN_EMAIL');
  const adminPassword = required(env, 'SEED_ADMIN_PASSWORD');
  if (adminPassword.length < 14) throw new Error('SEED_ADMIN_PASSWORD CI minimal 14 karakter.');
  if (/@toko360\.local$/i.test(adminEmail)) throw new Error('GitHub simulation tidak boleh memakai akun demo @toko360.local.');

  return {
    connection,
    restoreDatabase,
    drRestoreDatabase,
    adminEmail,
    adminPassword,
    jwtSecret: required(env, 'JWT_SECRET'),
    orderAccessSecret: required(env, 'ORDER_ACCESS_SECRET'),
    secretMasterKey: required(env, 'SECRET_MASTER_KEY'),
    webhookSigningSecret: required(env, 'WEBHOOK_SIGNING_SECRET'),
  };
}

function envLine(key, value) {
  const text = String(value ?? '');
  if (/\r|\n/.test(text)) throw new Error(`${key} tidak boleh multiline.`);
  return `${key}=${text}`;
}

export function renderGithubSimulationFiles(env = process.env) {
  const config = validateGithubSimulationConfig(env);
  const { connection } = config;
  const base = [
    envLine('NODE_ENV', 'staging'),
    envLine('DATABASE_PROFILE', 'postgresql'),
    envLine('DATABASE_URL', connection.url),
    envLine('API_PORT', '4000'),
    envLine('JWT_SECRET', config.jwtSecret),
    envLine('ORDER_ACCESS_SECRET', config.orderAccessSecret),
    envLine('ALLOW_MOCK_PAYMENTS', 'false'),
    envLine('NEXT_PUBLIC_BRANCH_CODE', env.NEXT_PUBLIC_BRANCH_CODE || 'PUSAT'),
    envLine('JWT_EXPIRES_IN', '15m'),
    envLine('SEED_MODE', 'bootstrap'),
    envLine('SEED_COMPANY_ID', env.SEED_COMPANY_ID),
    envLine('SEED_COMPANY_NAME', env.SEED_COMPANY_NAME || 'Toko360 GitHub CI'),
    envLine('SEED_COMPANY_SLUG', env.SEED_COMPANY_SLUG || 'toko360-github-ci'),
    envLine('SEED_BRANCH_CODE', env.SEED_BRANCH_CODE || 'PUSAT'),
    envLine('SEED_BRANCH_NAME', env.SEED_BRANCH_NAME || 'Cabang GitHub CI'),
    envLine('SEED_WAREHOUSE_CODE', env.SEED_WAREHOUSE_CODE || 'GDG-UTAMA'),
    envLine('SEED_WAREHOUSE_NAME', env.SEED_WAREHOUSE_NAME || 'Gudang GitHub CI'),
    envLine('SEED_ADMIN_EMAIL', config.adminEmail),
    envLine('SEED_ADMIN_PASSWORD', config.adminPassword),
    envLine('CORS_ORIGINS', env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003'),
    envLine('NEXT_PUBLIC_API_URL', env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'),
    envLine('SECRET_MASTER_KEY', config.secretMasterKey),
    envLine('SECRET_KEY_ID', 'github-ci-v1'),
    envLine('WEBHOOK_SIGNING_SECRET', config.webhookSigningSecret),
    envLine('APP_VERSION', env.APP_VERSION || '0.5.3'),
    envLine('WORKER_INTERVAL_MS', '1000'),
    envLine('REPORT_EXPORT_DIR', path.resolve(env.T360_CI_REPORT_EXPORT_DIR || path.join(process.cwd(), 'logs', 'report-exports'))),
    envLine('EMPLOYEE_PORTAL_URL', 'http://localhost:3003'),
    envLine('ATTENDANCE_MEDIA_PROVIDER', 'disabled'),
    envLine('JWT_REFRESH_EXPIRES_DAYS', '30'),
    envLine('AUTH_PASSWORD_RESET_EXPIRES_MINUTES', '30'),
    envLine('AUTH_EXPOSE_RESET_TOKEN', 'false'),
    envLine('ADMIN_PUBLIC_URL', 'http://localhost:3001'),
    envLine('CUSTOMER_VERIFICATION_DEBUG_CODE', 'false'),
  ].join('\n') + '\n';

  const dbWithName = (name) => {
    const url = new URL(connection.url);
    url.pathname = `/${name}`;
    return url.toString();
  };

  const stage18 = [
    'T360_STAGE18_TARGET=STAGING',
    'T360_STAGE18_CONFIRM=APPLY_T360_STAGE18_NON_PRODUCTION',
    envLine('T360_STAGE18_DATABASE_URL', connection.url),
    envLine('T360_STAGE18_EXPECTED_HOST', connection.host),
    envLine('T360_STAGE18_EXPECTED_DATABASE', connection.database),
    'T360_STAGE18_RESTORE_CONFIRM=REPLACE_T360_STAGE18_RESTORE_DATABASE',
    envLine('T360_STAGE18_RESTORE_DATABASE_URL', dbWithName(config.restoreDatabase)),
    envLine('T360_STAGE18_EXPECTED_RESTORE_HOST', connection.host),
    envLine('T360_STAGE18_EXPECTED_RESTORE_DATABASE', config.restoreDatabase),
    'T360_STAGE18_DECISIONS_FILE=stage18-ownership-decisions.json',
  ].join('\n') + '\n';

  const stage19 = [
    'T360_STAGE19_TARGET=STAGING',
    'T360_STAGE19_CONFIRM=RUN_T360_STAGE19_NON_PRODUCTION',
    envLine('T360_STAGE19_DATABASE_URL', connection.url),
    envLine('T360_STAGE19_EXPECTED_HOST', connection.host),
    envLine('T360_STAGE19_EXPECTED_DATABASE', connection.database),
    'T360_STAGE19_API_PORT=41919',
    'T360_STAGE19_API_START_TIMEOUT_MS=90000',
  ].join('\n') + '\n';

  const stage20 = [
    'T360_STAGE20_TARGET=STAGING',
    'T360_STAGE20_CONFIRM=RUN_T360_STAGE20_NON_PRODUCTION',
    envLine('T360_STAGE20_DATABASE_URL', connection.url),
    envLine('T360_STAGE20_EXPECTED_HOST', connection.host),
    envLine('T360_STAGE20_EXPECTED_DATABASE', connection.database),
    'T360_STAGE20_API_PORT=42020',
    'T360_STAGE20_API_START_TIMEOUT_MS=90000',
    'T360_STAGE20_OBSERVATION_SAMPLES=10',
    'T360_STAGE20_OBSERVATION_INTERVAL_MS=250',
    'T360_STAGE20_HEALTH_P95_BUDGET_MS=1500',
    'T360_STAGE20_LONG_QUERY_THRESHOLD_MS=15000',
    'T360_STAGE20_MAX_ACTIVE_CONNECTIONS=50',
  ].join('\n') + '\n';

  const payroll = [
    'T360_PAYROLL_MIGRATION_TARGET=STAGING',
    'T360_PAYROLL_MIGRATION_CONFIRM=APPLY_T360_PAYROLL_ADJUSTMENT_NON_PRODUCTION',
    envLine('T360_PAYROLL_MIGRATION_DATABASE_URL', connection.url),
    envLine('T360_PAYROLL_MIGRATION_EXPECTED_HOST', connection.host),
    envLine('T360_PAYROLL_MIGRATION_EXPECTED_DATABASE', connection.database),
  ].join('\n') + '\n';

  const pendingUat = JSON.stringify({
    environment: 'STAGING',
    approver: '',
    executedAt: '',
    releaseDecision: 'PENDING',
    rollbackOwner: '',
    monitoringOwner: '',
    scenarios: REQUIRED_UAT_IDS.map((id) => ({ id, status: 'PENDING', notes: scenarioNotes[id] })),
  }, null, 2) + '\n';

  return {
    '.env': base,
    'stage18-postgres.env': stage18,
    'stage18-ownership-decisions.json': JSON.stringify({ version: 1, productAssignments: [], supplierAssignments: [] }, null, 2) + '\n',
    'stage19-integration.env': stage19,
    'stage20-release-readiness.env': stage20,
    'stage20-uat-ci-pending.json': pendingUat,
    'payroll-adjustment-postgres-stage.env': payroll,
  };
}

export function writeGithubSimulationFiles(root = process.cwd(), env = process.env) {
  const files = renderGithubSimulationFiles(env);
  for (const [relative, content] of Object.entries(files)) fs.writeFileSync(path.join(root, relative), content, 'utf8');
  return Object.keys(files);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const files = writeGithubSimulationFiles();
    console.log(`GitHub system simulation config siap: ${files.join(', ')}`);
  } catch (error) {
    console.error(`GITHUB_SIM_CONFIG_ERROR: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
