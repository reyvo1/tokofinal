import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const json = (file) => JSON.parse(read(file));

test('P3 retention and daily summaries are intentional Admin operator workflows', () => {
  const domain = read('apps/admin/app/domain-workspaces.ts');
  const page = read('apps/admin/app/page.tsx');
  const view = read('apps/admin/app/modules/data-governance.tsx');
  const dto = read('apps/api/src/extensions/dto/extensions.dto.ts');
  const map = json('config/admin-contextual-workflow-map.json');
  assert.match(domain, /key: 'data-governance'/);
  assert.match(page, /DataGovernanceView/);
  assert.ok(map.rows.some((row) => row.workspace === 'settings' && row.view === 'data-governance' && row.renderer === 'DataGovernanceView'));
  for (const token of ['/retention/policies','/retention/archive-runs','/analytics/daily-summaries/materialize','ARCHIVE HISTORY','checksum','archiveUri','ADMIN-OWNED']) assert.ok(view.includes(token), `missing P3 data-governance contract: ${token}`);
  assert.match(dto, /confirmation!:\s*'ARCHIVE'/);
  assert.match(view, /archiveConfirmation!=='ARCHIVE'/);
});

test('P3 security lifecycle exposes API-key rotation and active-session revocation', () => {
  const apiKeys = read('apps/admin/app/modules/api-keys.tsx');
  const security = read('apps/admin/app/modules/security.tsx');
  const authController = read('apps/api/src/auth/auth.controller.ts');
  const authService = read('apps/api/src/auth/auth.service.ts');
  assert.match(apiKeys, /\/api-keys\/\$\{rotateTarget\.id\}\/rotate/);
  assert.match(apiKeys, /rotateConfirmation!=='ROTATE'/);
  assert.match(security, /\/auth\/sessions/);
  assert.match(security, /\/auth\/logout-all/);
  assert.match(security, /logoutAllConfirm!=='LOGOUT ALL'/);
  assert.match(authController, /@Post\('sessions\/:id\/revoke'\)/);
  assert.match(authService, /async revokeSession\(id: string, user: AuthUser\)/);
  assert.match(authService, /REVOKE_AUTH_SESSION/);
});

test('P3 capability catalog carries explicit runtime maturity truth without losing it to scoped overrides', () => {
  const seed = read('apps/api/prisma/seed.ts');
  const platform = read('apps/api/src/platform/platform.service.ts');
  const page = read('apps/admin/app/page.tsx');
  for (const token of ['maturityClass','operatorVisibility','ownership','helpText','ADAPTER_REQUIRED','FOUNDATION']) assert.ok(seed.includes(token), `missing seed maturity truth: ${token}`);
  assert.match(platform, /config: \{ \.\.\.priorConfig, \.\.\.nextConfig \}/);
  assert.match(page, /maturityClass/);
  assert.match(page, /Flag runtime bukan bukti product-completeness/);
});

test('P3 exact-runtime gate is mandatory in both GitHub workflows and aggregate reporting', () => {
  const packageJson = json('package.json');
  const probe = read('scripts/ci-p3-productization-probe.mjs');
  const fullSystem = read('.github/workflows/full-system-simulation.yml');
  const fullUat = read('.github/workflows/toko360-full-uat.yml');
  const summary = read('scripts/ci-write-full-system-summary.mjs');
  const uatReport = read('scripts/github-uat-report.mjs');
  assert.equal(packageJson.scripts['ci:p3:probe'], 'node scripts/ci-p3-productization-probe.mjs');
  for (const token of ['activeSessionInventory','apiKeyRotation','dailySummaryExplicitAdminOwnership','archiveExplicitSafetyConfirmation','capabilityMaturityTruth','productionTouched: false']) assert.ok(probe.includes(token), `missing P3 runtime proof: ${token}`);
  for (const workflow of [fullSystem, fullUat]) {
    assert.match(workflow, /id: p3_productization/);
    assert.match(workflow, /npm run ci:p3:probe/);
  }
  assert.match(summary, /github-p3-productization-probe-latest\.json/);
  assert.match(summary, /p3Productization/);
  assert.match(summary, /T360_CI_STEP_P3_PRODUCTIZATION/);
  assert.match(uatReport, /STEP_P3_PRODUCTIZATION/);
});

test('P3 preserves R6 archive runtime probe under explicit archive confirmation', () => {
  const r6 = read('scripts/ci-r6-scale-ai-probe.mjs');
  assert.match(r6, /confirmation: 'ARCHIVE'/);
});
