import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(file, 'utf8');
const ownership = JSON.parse(read('config/canonical-domain-ownership.json'));
const extensionsController = read('apps/api/src/extensions/extensions.controller.ts');
const extensionsService = read('apps/api/src/extensions/extensions.service.ts');
const extensionsModule = read('apps/api/src/extensions/extensions.module.ts');
const extensionsDto = read('apps/api/src/extensions/dto/extensions.dto.ts');
const returnsController = read('apps/api/src/returns/returns.controller.ts');
const packageJson = JSON.parse(read('package.json'));
const fullSystem = read('.github/workflows/full-system-simulation.yml');
const fullUat = read('.github/workflows/toko360-full-uat.yml');
const summary = read('scripts/ci-write-full-system-summary.mjs');
const uatReport = read('scripts/github-uat-report.mjs');
const p4Probe = read('scripts/ci-p4-canonical-ownership-probe.mjs');
const canonicalAudit = read('scripts/audit-canonical-domain-ownership.mjs');

const requiredDomains = ['inventory', 'returns', 'accounting', 'payments', 'notifications', 'payroll', 'assets', 'marketplace', 'summaries'];

function sourceFiles(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('P4 removes legacy sale/purchase return routes and adapter implementation', () => {
  assert.doesNotMatch(extensionsController, /sale-returns|purchase-returns/);
  assert.doesNotMatch(extensionsService, /ReturnsService|saleReturns\(|createSaleReturn\(|completeSaleReturn\(|purchaseReturns\(|createPurchaseReturn\(|completePurchaseReturn\(/);
  assert.doesNotMatch(extensionsModule, /ReturnsModule/);
  assert.doesNotMatch(extensionsDto, /class ReturnItemDto|class CreateSaleReturnDto|class CreatePurchaseReturnDto/);

  assert.match(returnsController, /@Controller\('returns'\)/);
  assert.match(returnsController, /@Post\('sales'\)/);
  assert.match(returnsController, /@Post\('sales\/:id\/confirm'\)/);
  assert.match(returnsController, /@Post\('purchases'\)/);
  assert.match(returnsController, /@Post\('purchases\/:id\/confirm'\)/);
  assert.match(returnsController, /@Post\('orders\/:id\/confirm'\)/);
});

test('P4 active application source has no legacy return consumer', () => {
  const hits = [];
  for (const root of ['apps/admin', 'apps/pos', 'apps/storefront', 'apps/employee-portal', 'apps/worker', 'packages']) {
    for (const file of sourceFiles(root)) {
      const source = read(file);
      if (/\/sale-returns|\/purchase-returns|['"]sale-returns|['"]purchase-returns/.test(source)) hits.push(file);
    }
  }
  assert.deepEqual(hits, []);
});

test('P4 canonical ownership manifest covers every required domain exactly once', () => {
  assert.equal(ownership.phase, 'P4');
  assert.equal(ownership.status, 'IMPLEMENTED_RUNTIME_PENDING');
  assert.deepEqual(ownership.requiredDomains, requiredDomains);
  assert.equal(ownership.domains.length, requiredDomains.length);
  assert.equal(new Set(ownership.domains.map((entry) => entry.id)).size, requiredDomains.length);
  for (const id of requiredDomains) {
    const entry = ownership.domains.find((row) => row.id === id);
    assert.ok(entry, `missing ${id}`);
    assert.ok(entry.canonicalOwner);
    assert.ok(entry.canonicalPublicMutationSurface);
    assert.ok(entry.controller);
    assert.ok(entry.service);
    assert.ok(entry.rule);
    assert.ok((entry.sourceOfTruthModels?.length || 0) + (entry.ledgerModels?.length || 0) > 0);
  }
});

test('P4 manifest records both legacy aliases as removed with canonical replacements', () => {
  const aliases = new Map(ownership.legacyAliases.map((entry) => [entry.path, entry]));
  for (const [legacy, replacement] of [['/sale-returns*', '/returns/sales*'], ['/purchase-returns*', '/returns/purchases*']]) {
    assert.equal(aliases.get(legacy)?.status, 'REMOVED_AFTER_COMPATIBILITY_VERIFICATION');
    assert.equal(aliases.get(legacy)?.canonicalReplacement, replacement);
  }
});

test('P4 canonical ownership audit is a permanent full-repository quality gate', () => {
  assert.equal(packageJson.scripts['audit:canonical:ownership'], 'node scripts/audit-canonical-domain-ownership.mjs');
  assert.match(packageJson.scripts['audit:full:repo'], /audit:canonical:ownership/);
  assert.match(canonicalAudit, /Canonical ownership audit PASS/);
  assert.match(canonicalAudit, /legacy return alias masih dipakai source aktif/);
  assert.match(canonicalAudit, /requiredDomains/);
});

test('P4 exact-runtime probe proves canonical routes live and legacy aliases router-missing', () => {
  assert.equal(packageJson.scripts['ci:p4:probe'], 'node scripts/ci-p4-canonical-ownership-probe.mjs');
  assert.match(p4Probe, /\/returns\/sales/);
  assert.match(p4Probe, /\/returns\/purchases/);
  assert.match(p4Probe, /\/returns\/orders/);
  assert.match(p4Probe, /legacySaleReturnsRouterMissing/);
  assert.match(p4Probe, /legacyPurchaseReturnsRouterMissing/);
  assert.match(p4Probe, /productionTouched: false/);
  assert.match(p4Probe, /github-p4-canonical-ownership-probe-latest\.json/);
});

test('P4 exact-runtime gate is mandatory in both heavy GitHub workflows and aggregate/UAT reporting', () => {
  for (const workflow of [fullSystem, fullUat]) {
    assert.match(workflow, /id: p4_canonical_ownership/);
    assert.match(workflow, /npm run ci:p4:probe/);
  }
  assert.match(fullSystem, /T360_CI_STEP_P4_CANONICAL_OWNERSHIP: \$\{\{ steps\.p4_canonical_ownership\.outcome \}\}/);
  assert.match(fullUat, /STEP_P4_CANONICAL_OWNERSHIP: \$\{\{ steps\.p4_canonical_ownership\.outcome \}\}/);
  assert.match(fullUat, /check "P4 canonical domain ownership and legacy-surface removal" "\$STEP_P4_CANONICAL_OWNERSHIP"/);
  assert.match(summary, /github-p4-canonical-ownership-probe-latest\.json/);
  assert.match(summary, /p4CanonicalOwnership/);
  assert.match(summary, /T360_CI_STEP_P4_CANONICAL_OWNERSHIP/);
  assert.match(uatReport, /P4 canonical domain ownership and legacy-surface removal/);
});
