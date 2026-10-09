import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertReleaseFinancialIntegrity } from '../scripts/lib/release-financial-integrity.mjs';
import { balancedR6JournalLines } from '../scripts/lib/ci-r6-balanced-journal-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
const healthy = () => ({
  status: 'PASS', trialBalance: { debit: 362200, credit: 362200, difference: 0, balanced: true },
  balanceSheet: { difference: 0, balanced: true }, unbalancedJournalIds: [],
  postedEventsMissingJournal: 0, failedEvents: 0, queuedEvents: 0, unresolvedEvents: 0,
  pendingFinanceTransactions: 0, nonPostedTaxTransactions: 0, blockers: 0, warnings: 0,
});

// This reproduces the exact FAIL body observed in GitHub staging even though HTTP was 200.
const githubImbalance = () => ({
  ...healthy(), status: 'FAIL', trialBalance: { debit: 362200, credit: 312200, difference: 50000, balanced: false },
  balanceSheet: { difference: 50000, balanced: false }, unbalancedJournalIds: ['83d4d05f-ccbd-445b-beee-a027c26d61bd'], blockers: 3,
});

const variants = [
  ['observed GitHub 50k unbalanced journal', githubImbalance()],
  ['WARN status', { ...healthy(), status: 'WARN', warnings: 1 }],
  ['FAIL even with zero blockers', { ...healthy(), status: 'FAIL' }],
  ['positive blockers despite PASS', { ...healthy(), blockers: 1 }],
  ['unbalanced journal despite PASS', { ...healthy(), unbalancedJournalIds: ['J1'] }],
  ['missing Journal IDs', (() => { const r = healthy(); delete r.unbalancedJournalIds; return r; })()],
  ['missing counters', (() => { const r = healthy(); delete r.failedEvents; return r; })()],
  ['unresolved events', { ...healthy(), unresolvedEvents: 1 }],
  ['queued events', { ...healthy(), queuedEvents: 1 }],
  ['pending finance', { ...healthy(), pendingFinanceTransactions: 1 }],
  ['pending taxes', { ...healthy(), nonPostedTaxTransactions: 1 }],
  ['missing posted journal', { ...healthy(), postedEventsMissingJournal: 1 }],
  ['inconsistent debit/credit despite balanced flag', { ...healthy(), trialBalance: { debit: 362200, credit: 312200, difference: 0, balanced: true } }],
  ['inconsistent trial difference', { ...healthy(), trialBalance: { debit: 1, credit: 1, difference: 50000, balanced: true } }],
  ['inconsistent balance sheet', { ...healthy(), balanceSheet: { difference: 50000, balanced: true } }],
  ['missing balance sheet', (() => { const r = healthy(); delete r.balanceSheet; return r; })()],
  ['missing trial balance', (() => { const r = healthy(); delete r.trialBalance; return r; })()],
  ['string zero', { ...healthy(), blockers: '0' }],
  ['NaN amount', { ...healthy(), trialBalance: { debit: Number.NaN, credit: 0, difference: 0, balanced: true } }],
  ['not JSON object', null],
  ['array response', []],
];

test('valid accounting PASS is accepted only with intact report and zero blockers', () => {
  assert.deepEqual(assertReleaseFinancialIntegrity(healthy()), { status: 'PASS', blockers: 0, unbalancedJournals: 0, trialBalanceDifference: 0, balanceSheetDifference: 0 });
});

for (const [label, body] of variants) {
  test(`release financial integrity fails closed on ${label}`, () => assert.throws(() => assertReleaseFinancialIntegrity(body), /Financial integrity release gate FAIL/));
}

test('CI R6 journal fixture is balanced and rejects same-account or invalid amounts', () => {
  const lines = balancedR6JournalLines('cash-account', 'contra-account');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].accountId, 'cash-account');
  assert.equal(lines[1].accountId, 'contra-account');
  assert.equal(lines.reduce((sum, x) => sum + x.debit, 0), 50000);
  assert.equal(lines.reduce((sum, x) => sum + x.credit, 0), 50000);
  assert.throws(() => balancedR6JournalLines('same', 'same'), /dua akun/);
  assert.throws(() => balancedR6JournalLines('cash', 'contra', -50), /integer positif/);
  assert.throws(() => balancedR6JournalLines('cash', 'contra', 50.50), /integer positif/);
  const probe = read('scripts/ci-r6-scale-ai-probe.mjs');
  assert.match(probe, /balancedR6JournalLines\(account\.id, creditAccount\.id\)/);
  assert.match(probe, /counterFinanceSummary/);
  assert.doesNotMatch(probe, /lines: \{ create: \[\{ accountId: account\.id, debit: 50000, credit: 0 \}\] \}/);
});

test('both production and staging CERTIFICATION invoke the strict gate on real response body', () => {
  const staging = read('scripts/staging-certification.mjs');
  const production = read('scripts/production-smoke.mjs');
  assert.match(staging, /const accounting = assertReleaseFinancialIntegrity\(body\)/);
  assert.match(production, /const accounting = assertReleaseFinancialIntegrity\(body\)/);
  assert.match(staging, /if \(!passed\) process\.exitCode = 2/);
  assert.match(production, /if \(!passed\) process\.exitCode = 1/);
  assert.match(staging, /logout-revokes-session/);
  assert.match(production, /PRODUCTION_LOGOUT_REVOCATION/);
});

function runIsolatedHarness(script, report, isProduction) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't360-financial-release-'));
  try {
    for (const src of [script, 'lib/source-fingerprint.mjs', 'lib/runtime-target-identity.mjs', 'lib/build-artifact-identity.mjs', 'lib/release-financial-integrity.mjs']) {
      const destination = path.join(dir, 'scripts', src);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const mock = {
        'lib/source-fingerprint.mjs': `export const sourceFingerprint = () => ({value:'fingerprint',algorithm:'sha256',fileCount:1});\n`,
        'lib/runtime-target-identity.mjs': `export const expectedPostgresTarget = (host, database) => ({profile:'postgresql',hostHash:host,databaseHash:database});\nexport const assertRuntimeDatabaseTarget = (got,want) => {if(JSON.stringify(got)!==JSON.stringify(want)) throw Error('database mismatch')};\nexport const shortHash = () => 'hosthash';\n`,
        'lib/build-artifact-identity.mjs': `export const readAndVerifyBuildArtifactManifest = () => ({current:{id:'BUILD'}});\n`,
      }[src];
      fs.writeFileSync(destination, mock ?? read(`scripts/${src}`));
    }
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
    fs.mkdirSync(path.join(dir, 'handoff/quality'), { recursive: true });
    const evidence = {
      status: 'PASS', sourceIdentity: { value: 'fingerprint' }, readOnly: true, businessMutationsPerformed: false,
      databaseTarget: { profile: 'postgresql', hostHash: 'dbhost', databaseHash: 'dbname' },
    };
    fs.writeFileSync(path.join(dir, 'handoff/quality/production-schema-latest.json'), JSON.stringify(evidence));
    const mock = `
const financial = ${JSON.stringify(report)};
let revoked = false;
globalThis.fetch = async (url, options={}) => {
 const endpoint = new URL(url).pathname;
 let body = {}; let status=200;
 if(endpoint==='/api/v1/health') body={status:'ok',service:'toko360-api', release:{sourceFingerprint:'fingerprint',buildArtifactId:'BUILD',databaseTarget:{profile:'postgresql',hostHash:'dbhost',databaseHash:'dbname'}}};
 else if(endpoint==='/api/v1/auth/login') {status=201;body={accessToken:'token',user:{sid:'session'}};}
 else if(endpoint==='/api/v1/auth/sessions') {status=revoked?401:200;body=revoked?{message:'revoked'}:[{current:true}];}
 else if(endpoint==='/api/v1/platform/ops-health') body={healthy:true};
 else if(endpoint==='/api/v1/reports/financial-integrity') body=financial;
 else if(endpoint==='/api/v1/auth/logout') {status=201; revoked=true;}
 else throw new Error('unexpected route '+endpoint);
 const headers={'content-type':'application/json','x-content-type-options':'nosniff','x-frame-options':'DENY','strict-transport-security':'max-age=31536000'};
 return new Response(JSON.stringify(body), {status,headers});
};\n`;
    const preload = path.join(dir, 'mock-fetch.mjs'); fs.writeFileSync(preload, mock);
    const output = path.join(dir, 'handoff/quality', isProduction ? 'production-smoke-latest.json' : 'staging-certification-latest.json');
    const env = { ...process.env,
      STAGING_BASE_URL: 'http://127.0.0.1:4000', STAGING_EXPECTED_HOST: '127.0.0.1', STAGING_EXPECTED_DB_HOST: 'dbhost', STAGING_EXPECTED_DB_NAME: 'dbname', STAGING_TEST_EMAIL: 'test@invalid', STAGING_TEST_PASSWORD: 'test', STAGING_CERT_OUTPUT: output,
      T360_PRODUCTION_SMOKE_CONFIRM: 'RUN_T360_PRODUCTION_SMOKE', T360_PRODUCTION_BASE_URL: 'https://production.example.test', T360_PRODUCTION_EXPECTED_HOST: 'production.example.test', T360_PRODUCTION_EXPECTED_SOURCE_FINGERPRINT: 'fingerprint', T360_PRODUCTION_EXPECTED_BUILD_ARTIFACT_ID: 'BUILD', T360_PRODUCTION_EXPECTED_DB_HOST: 'dbhost', T360_PRODUCTION_EXPECTED_DB_NAME: 'dbname', T360_PRODUCTION_TEST_EMAIL: 'test@invalid', T360_PRODUCTION_TEST_PASSWORD: 'test',
    };
    const run = spawnSync(process.execPath, ['--import', preload, path.join(dir, 'scripts', script)], { cwd: dir, encoding: 'utf8', timeout: 15000, env });
    assert.equal(run.error, undefined, run.error?.message);
    assert.ok(fs.existsSync(output), `${script}: evidence absent; ${run.stderr}`);
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, evidence: JSON.parse(fs.readFileSync(output, 'utf8')) };
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
}

for (const [script, isProd] of [['staging-certification.mjs',false],['production-smoke.mjs',true]]) {
  test(`${script} accepts sound financial report and writes PASS`, () => {
    const r = runIsolatedHarness(script, healthy(), isProd);
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    assert.equal(isProd ? r.evidence.status : r.evidence.passed, isProd ? 'PASS' : true);
  });
  for (const [caseLabel, bad] of [['actual GitHub 50k imbalance', githubImbalance()],['false PASS with blockers', {...healthy(),blockers:2}],['WARN pending', {...healthy(),status:'WARN',warnings:1}]]) {
    test(`${script} rejects ${caseLabel} over HTTP 200 and writes FAIL`, () => {
      const r = runIsolatedHarness(script,bad,isProd);
      assert.equal(r.status, isProd ? 1 : 2, `${r.stderr}\n${r.stdout}`);
      assert.equal(isProd ? r.evidence.status : r.evidence.passed, isProd ? 'FAIL' : false);
      const failed = r.evidence.checks.find((c) => isProd ? c.id==='PRODUCTION_FINANCIAL_INTEGRITY' : c.name==='financial-integrity');
      assert.ok(failed, 'financial-integrity check must run');
      assert.equal(isProd ? failed.status : failed.ok, isProd?'FAIL':false);
      assert.match(failed.error, /Financial integrity release gate FAIL/);
    });
  }
}
