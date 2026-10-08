import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const service = read('apps/api/src/payroll/payroll.service.ts');
const engine = read('apps/api/src/payroll/payroll-method-engine.ts');
const dto = read('apps/api/src/payroll/dto/payroll.dto.ts');
const admin = read('apps/admin/app/modules/hr-payroll.tsx');
const probe = read('scripts/ci-p2-payroll-runtime-probe.mjs');
const r2Probe = read('scripts/ci-r2-hr-payroll-probe.mjs');
const fullSystem = read('.github/workflows/full-system-simulation.yml');
const fullUat = read('.github/workflows/toko360-full-uat.yml');
const summary = read('scripts/ci-write-full-system-summary.mjs');
const uatReport = read('scripts/github-uat-report.mjs');


test('P2 payroll makes GROSS GROSS_UP and NET executable across API service and Admin UI', () => {
  assert.match(dto, /@IsIn\(\['GROSS', 'GROSS_UP', 'NET'\]\)/);
  assert.match(service, /supportedTaxMethods: \['GROSS', 'GROSS_UP', 'NET'\]/);
  assert.match(service, /applyPayrollTaxMethod/);
  assert.match(engine, /method === 'GROSS_UP'/);
  assert.match(engine, /solveGrossUp/);
  assert.match(engine, /method === 'NET'/);
  assert.match(engine, /employerBorneTax: tax/);
  assert.match(admin, /profiles\.supportedTaxMethods/);
  assert.match(admin, /GROSS_UP/);
  assert.match(admin, /NET/);
  assert.doesNotMatch(admin, /disabled[^\n]*GROSS/);
  assert.doesNotMatch(service, /Tax method \$\{dto\.taxMethod\} belum didukung aman/);
});


test('P2 split-period engine allocates actual temporal component amounts instead of stretching one value across the month', () => {
  assert.match(service, /private allocateTemporalAmounts/);
  assert.match(service, /row\.amount \* item\.days \/ rowDays/);
  assert.match(service, /index === overlaps\.length - 1 \? money\(row\.amount - recognized\)/);
  assert.match(service, /grossTemporal\.push/);
  assert.match(service, /taxableTemporal\.push/);
  assert.match(service, /netTemporal\.push/);
  assert.match(service, /calculateSocialAcrossSegments\(grossTemporal/);
  assert.match(service, /calculateTaxAcrossSegments\(taxableTemporal, netBeforeTaxTemporal/);
  assert.match(service, /employeeTaxProfile\.findMany/);
  assert.match(service, /taxRuleSet\.findMany/);
  assert.match(service, /code: selectedTaxRuleSet\.code, status: 'APPROVED'/);
  assert.doesNotMatch(service, /does not split one payroll period across multiple statutory rule versions/);
});


test('P2 exact PostgreSQL payroll probe covers method differences proration posting and paid-salary recovery', () => {
  assert.equal(pkg.scripts['ci:p2:payroll-probe'], 'node scripts/ci-p2-payroll-runtime-probe.mjs');
  for (const marker of [
    /taxMethod: 'GROSS'/,
    /taxMethod: 'GROSS_UP'/,
    /taxMethod: 'NET'/,
    /midPeriodRuleVersioning/,
    /splitPeriodProration/,
    /accountingPosting/,
    /post-accounting/,
    /direction === 'RECOVERY'/,
    /adjustmentRecovery/,
    /assertBalancedJournal/,
    /sourceFingerprint\(root\)/,
    /productionTouched: false/,
  ]) assert.match(probe, marker);
  assert.match(probe, /result\.status === 'CALCULATED'/);
  assert.match(probe, /trace\.status === 'CALCULATED'/);
  assert.match(probe, /employeeTaxDeduction > 0/);
  assert.match(probe, /employerBorneTax > 0/);
  assert.match(probe, /grossAdjustment > 0/);
  assert.match(probe, /liability\.recovery/);
  assert.match(r2Probe, /supportedTaxMethods/);
  assert.doesNotMatch(r2Probe, /unsupportedNetRejected/);
});


test('P2 full GitHub gate requires both mixed-UOM and payroll runtime evidence on exact source', () => {
  for (const workflow of [fullSystem, fullUat]) {
    assert.match(workflow, /id: p2a_multi_uom/);
    assert.match(workflow, /run: npm run ci:p2a:multi-uom-probe/);
    assert.match(workflow, /name: Exercise P2 payroll methods split-period accounting and recovery lifecycle/);
    assert.match(workflow, /id: p2_payroll/);
    assert.match(workflow, /run: npm run ci:p2:payroll-probe/);
  }
  assert.match(fullSystem, /T360_CI_STEP_P2_PAYROLL: \$\{\{ steps\.p2_payroll\.outcome \}\}/);
  assert.match(fullUat, /STEP_P2_PAYROLL: \$\{\{ steps\.p2_payroll\.outcome \}\}/);
  assert.equal((fullUat.match(/STEP_P2_PAYROLL: \$\{\{ steps\.p2_payroll\.outcome \}\}/g) || []).length, 2, 'Full UAT must expose P2 payroll outcome exactly once per consumer env block');
  assert.match(fullUat, /check "P2 payroll runtime probe" "\$STEP_P2_PAYROLL"/);
  assert.match(summary, /github-p2-payroll-runtime-probe-latest\.json/);
  assert.match(summary, /p2Payroll: gateStatus/);
  assert.match(summary, /T360_CI_STEP_P2_PAYROLL/);
  assert.match(summary, /'p2Payroll'/);
  assert.match(uatReport, /P2 payroll runtime probe/);
});
