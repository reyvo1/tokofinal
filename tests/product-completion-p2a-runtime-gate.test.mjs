import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const probe = read('scripts/ci-p2a-multi-uom-runtime-probe.mjs');
const fullSystem = read('.github/workflows/full-system-simulation.yml');
const fullUat = read('.github/workflows/toko360-full-uat.yml');
const summary = read('scripts/ci-write-full-system-summary.mjs');
const uatReport = read('scripts/github-uat-report.mjs');

const requiredRuntimeMarkers = [
  /quantityFactor === 2/,
  /unitQuantity === 2/,
  /orderItem\.quantity === 4/,
  /baseUnitReservation/,
  /shipmentSnapshot/,
  /fulfillmentBaseInventoryAndAccounting/,
  /isActive: false/,
  /partialReturnHistoricalRemainder/,
  /inventoryRoundTrip/,
  /orderRefunded/,
  /assertBalancedJournal/,
  /completeAndApproveInspection/,
  /sourceFingerprint\(root\)/,
  /productionTouched: false/,
  /checks\.selfProvisionedFixture = true/,
  /prisma\.product\.create/,
  /prisma\.inventory\.create/,
  /fixtureQuantity = 8/,
  /T360_CI_EXPECTED_DATABASE/,
  /T360_UAT_EXPECTED_DATABASE/,
];

test('P2A exposes a dedicated exact-runtime mixed-UOM probe instead of relying on source markers', () => {
  assert.equal(pkg.scripts['ci:p2a:multi-uom-probe'], 'node scripts/ci-p2a-multi-uom-runtime-probe.mjs');
  for (const marker of requiredRuntimeMarkers) assert.match(probe, marker);
  assert.match(probe, /storefront\/account\/returns/);
  assert.match(probe, /returns\/orders\/\$\{createdReturn\.id\}\/inspection/);
  assert.match(probe, /returns\/orders\/\$\{createdReturn\.id\}\/confirm/);
  assert.match(probe, /github-p2a-multi-uom-runtime-probe-latest\.json/);
  assert.match(probe, /PostgreSQL non-production runtime/);
  assert.match(probe, /operations-control\/inspections\/\$\{inspectionId\}\/evidence/);
  assert.match(probe, /operations-control\/inspections\/\$\{inspectionId\}\/complete/);
  assert.match(probe, /operations-control\/inspections\/\$\{inspectionId\}\/approve/);
  assert.doesNotMatch(probe, /operationalInspection\.update/);
  assert.doesNotMatch(probe, /inspectionResultItem\.update/);
});


test('P2A runtime probe self-provisions deterministic stock instead of depending on mutable seed inventory', () => {
  assert.match(probe, /const fixtureQuantity = 8/);
  assert.match(probe, /prisma\.product\.create/);
  assert.match(probe, /metadata: \{ runtimeProbe: 'P2A'/);
  assert.match(probe, /prisma\.inventory\.create/);
  assert.match(probe, /quantity: fixtureQuantity/);
  assert.match(probe, /available: fixtureQuantity/);
  assert.match(probe, /checks\.selfProvisionedFixture = true/);
  assert.doesNotMatch(probe, /Fixture produk stok >=4 base unit tanpa batch\/serial tidak tersedia/);
});

test('P2A runtime probe locks mutation to the exact non-production PostgreSQL target', () => {
  assert.match(probe, /assertNonProductionPostgresTarget/);
  assert.match(probe, /T360_CI_EXPECTED_HOST/);
  assert.match(probe, /T360_CI_EXPECTED_DATABASE/);
  assert.match(probe, /T360_UAT_EXPECTED_HOST/);
  assert.match(probe, /T360_UAT_EXPECTED_DATABASE/);
  assert.match(probe, /runtime target mismatch/);
  assert.match(probe, /menolak database production\/live/);
  assert.match(probe, /runtimeTarget,/);
});

test('P2A runtime probe preserves historical transaction UOM after current ProductUnit changes', () => {
  const deactivateAt = probe.indexOf("body: { isActive: false }");
  const firstReturnAt = probe.indexOf("request('/storefront/account/returns'");
  assert.ok(deactivateAt > 0, 'probe must deactivate the current ProductUnit');
  assert.ok(firstReturnAt > deactivateAt, 'historical returns must run after ProductUnit deactivation');
  assert.match(probe, /returnItem\.productUnitId === unit\.id/);
  assert.match(probe, /returnItem\.unitCode === unitCode/);
  assert.match(probe, /returnItem\.unitQuantity === 1/);
  assert.match(probe, /returnItem\.quantityFactor === 2/);
  assert.match(probe, /returnItem\.quantity === 2/);
  assert.match(probe, /returnedAmounts\.net\.equals\(originalNet\)/);
  assert.match(probe, /returnedAmounts\.tax\.equals\(originalTax\)/);
  assert.match(probe, /returnedAmounts\.gross\.equals\(originalGross\)/);
});

test('both exact-source GitHub workflows run P2A runtime proof as a named gate', () => {
  for (const workflow of [fullSystem, fullUat]) {
    assert.match(workflow, /name: Exercise P2A mixed-UOM order fulfillment and historical return lifecycle/);
    assert.match(workflow, /id: p2a_multi_uom/);
    assert.match(workflow, /run: npm run ci:p2a:multi-uom-probe/);
  }
  assert.match(fullUat, /STEP_P2A_MULTI_UOM: \$\{\{ steps\.p2a_multi_uom\.outcome \}\}/);
  assert.match(fullUat, /check "P2A mixed-UOM runtime probe" "\$STEP_P2A_MULTI_UOM"/);
});

test('aggregate and UAT summaries fail closed when P2A exact-runtime evidence is missing or failed', () => {
  assert.match(summary, /github-p2a-multi-uom-runtime-probe-latest\.json/);
  assert.match(summary, /p2aMultiUom: gateStatus\(/);
  assert.match(summary, /v\.status === 'PASS'/);
  assert.match(summary, /v\.productionTouched === false/);
  assert.match(summary, /Object\.values\(v\.checks \|\| \{\}\)\.every\(Boolean\)/);
  assert.match(summary, /T360_CI_STEP_P2A_MULTI_UOM/);
  assert.match(summary, /'p2aMultiUom'/);
  assert.match(uatReport, /P2A mixed-UOM runtime probe/);
});
