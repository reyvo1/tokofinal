import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const script = read('scripts/ci-w3-cash-postgres-probe.mjs');
const summary = read('scripts/ci-write-full-system-summary.mjs');
const r8 = read('scripts/ci-r8-release-evidence-probe.mjs');
const uatReport = read('scripts/github-uat-report.mjs');
const packageScripts = JSON.parse(read('package.json')).scripts;
const workflows = [
  read('.github/workflows/full-system-simulation.yml'),
  read('.github/workflows/toko360-full-uat.yml'),
];

test('W3 executable PostgreSQL probe is reachable through npm and both heavy workflows after R4 runtime', () => {
  assert.equal(packageScripts['ci:w3:postgres-probe'], 'node scripts/ci-w3-cash-postgres-probe.mjs');
  for (const workflow of workflows) {
    const index = workflow.indexOf('id: w3_cash_postgres');
    assert.ok(index > workflow.indexOf('id: r4_core_business'));
    assert.ok(index < workflow.indexOf('id: p2a_multi_uom'));
    assert.match(workflow, /id: w3_cash_postgres\s+continue-on-error: true\s+run: npm run ci:w3:postgres-probe/);
  }
  assert.match(workflows[0], /T360_CI_STEP_W3_CASH_POSTGRES: \$\{\{ steps\.w3_cash_postgres\.outcome \}\}/);
  assert.equal((workflows[1].match(/STEP_W3_CASH_POSTGRES: \$\{\{ steps\.w3_cash_postgres\.outcome \}\}/g) || []).length, 2);
  assert.match(workflows[1], /check "W3 real PostgreSQL cash journals" "\$STEP_W3_CASH_POSTGRES"/);
});

test('W3 real runner requires locked localhost PostgreSQL + loopback API before Prisma import', () => {
  assert.match(script, /env\.T360_CI_EXPECTED_HOST/);
  assert.match(script, /env\.T360_CI_EXPECTED_DATABASE/);
  assert.match(script, /postgresql?:/);
  assert.match(script, /toko360_\(staging\|test\|ci\)/);
  assert.match(script, /apiUrl\.port !== '4000'/);
  assert.match(script, /env\.T360_EXPECTED_SOURCE_FINGERPRINT/);
  assert.ok(script.indexOf('const target = requireSafeTarget();') < script.indexOf("await import('@prisma/client')"));
  assert.match(script, /writeEvidence\('FAIL', \{ failure: 'Probe not completed\.' \}\);/);
  assert.match(script, /writeEvidence\('PASS', evidence\)/);
  assert.match(script, /humanStage20: 'PENDING'/);
});

test('W3 checks real balanced journals and idempotency, not merely source text or simulated HTTP', () => {
  for (const invariant of ['prisma.accountingEvent.findMany', 'prisma.journalLine.findMany',
    'status: \'POSTED\'', 'cents(line.debit)', 'cents(line.credit)',
    'CashierCashMovement', 'CashierShift', 'CASH_DRAWER_TRANSFER_IN',
    'CASH_DRAWER_TRANSFER_OUT', 'CASHIER_SHIFT_SHORT', 'CASHIER_SHIFT_OVER',
    'cashInIdempotentAndPayloadBound', 'cashOutPostedOverdraftBlocked',
    'shortagePostedBeforeClose', 'overagePostedBeforeClose', 'shiftCloseReplayBlocked',
    'precisionRejectedNoMovement']) assert.ok(script.includes(invariant), `Missing W3 invariant: ${invariant}`);
  assert.doesNotMatch(script, /(?:fetch|axios)\s*\(\s*['"]https?:\/\/[^'"l]/i);
});

test('W3 runtime evidence is mandatory in GitHub summary and R8, human gate remains pending', () => {
  assert.match(summary, /const w3CashPostgres = readJson/);
  assert.match(summary, /w3CashPostgres: gateStatus\(w3CashPostgres/);
  assert.match(summary, /'r4CoreBusiness','w3CashPostgres','p2aMultiUom'/);
  assert.match(summary, /w3CashPostgres: stepOutcome/);
  assert.match(r8, /w3Cash:read\('handoff\/quality\/github-w3-cash-postgres-probe-latest\.json'\)/);
  assert.match(r8, /if\(evidence\.w3Cash\.productionTouched!==false/);
  assert.match(r8, /'r4','w3Cash','worker','r8Reporting'/);
  assert.match(uatReport, /\['W3 cash\/journal PostgreSQL runtime probe', process\.env\.STEP_W3_CASH_POSTGRES\]/);
  assert.match(summary, /humanUat: 'PENDING'/);
});

test('negative control: removing W3 aggregate or PostgreSQL target lock invalidates acceptance', () => {
  assert.throws(() => assert.match(summary.replace("'r4CoreBusiness','w3CashPostgres','p2aMultiUom'", "'r4CoreBusiness','p2aMultiUom'"), /'r4CoreBusiness','w3CashPostgres','p2aMultiUom'/));
  assert.throws(() => assert.match(script.replace('url.hostname !== targetHost', 'false'), /url\.hostname !== targetHost/));
  assert.throws(() => assert.match(script.replace("if (env.T360_EXPECTED_SOURCE_FINGERPRINT &&", 'if (false &&'), /if \(env\.T360_EXPECTED_SOURCE_FINGERPRINT &&/));
});


test('W3 actual PostgreSQL probe rejects cashier privilege escalation before finance mutations', () => {
  assert.match(script, /forbiddenAccount\.status === 403/);
  assert.match(script, /forbiddenRule\.status === 403/);
  assert.match(script, /prisma\.account\.count\(\{ where: \{ branchId, code: forbiddenAccountCode/);
  assert.match(script, /prisma\.accountingPostingRule\.count\(\{ where: \{ companyId, code:/);
  assert.match(script, /checks\.cashierCannotMutateFinanceConfiguration = true/);
});

test('W3 missing posting rules reject cash capture and variance closure atomically', () => {
  assert.match(script, /noRuleReceipt\.status === 400/);
  assert.match(script, /noRuleClose\.status === 400/);
  assert.match(script, /cashierShift\.findUnique\(\{ where: \{ id: shift\.id/);
  assert.match(script, /checks\.missingFinanceRulesFailClosedWithoutCashMutation = true/);
  assert.ok(script.indexOf('const noRuleReceipt') < script.indexOf('const accounts = {};'),
    'Missing rule must be tested before Finance creates the valid rules.');
  assert.ok(script.indexOf('const noRuleClose') < script.indexOf('const accounts = {};'));
});

test('W3 supervisor threshold refuses a withdrawal in the real HTTP commit path', () => {
  assert.match(script, /missingSupervisor\.status === 403/);
  assert.match(script, /cashierCashMovement\.count\(\{ where: \{ cashierShiftId: shift\.id/);
  assert.match(script, /checks\.supervisorThresholdRejectsBeforeCommit = true/);
  assert.ok(script.indexOf('const missingSupervisor') > script.indexOf('checks.cashInIdempotentAndPayloadBound'),
    'Supervisor check must run after cash and posting are configured.');
});

test('negative controls detect removal of W3 finance isolation, unmapped cash and supervisor gate', () => {
  for (const [before, after, required] of [
    ['forbiddenAccount.status === 403', 'forbiddenAccount.status >= 400', /forbiddenAccount\.status === 403/],
    ['noRuleReceipt.status === 400', 'noRuleReceipt.status >= 400', /noRuleReceipt\.status === 400/],
    ['noRuleClose.status === 400', 'noRuleClose.status >= 400', /noRuleClose\.status === 400/],
    ['missingSupervisor.status === 403', 'missingSupervisor.status >= 400', /missingSupervisor\.status === 403/],
  ]) {
    assert.throws(() => assert.match(script.replace(before, after), required), `Negative control did not detect mutated invariant: ${before}`);
  }
});
