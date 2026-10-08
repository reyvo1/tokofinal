import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const probe=fs.readFileSync('scripts/ci-r8-release-evidence-probe.mjs','utf8');
const master=fs.readFileSync('docs/TOKO360-MASTER-RECOVERY-WORKFLOW.md','utf8');

test('R8 remains dependent on R1-R7 and keeps human Stage-20 separate',()=>{
 assert.match(master,/R8 — GitHub Full Runtime UAT and Release Evidence/);
 assert.match(master,/Depends on:\*\* R1, R2, R3, R4, R5, R6, R7/);
 assert.match(probe,/humanStage20:'PENDING'/);
 assert.match(probe,/uatPassed!==false/);
});

test('R8 binds exact source and build artifact before final automated evidence',()=>{
 assert.match(probe,/sourceFingerprint\(root\)/);
 assert.match(probe,/readAndVerifyBuildArtifactManifest/);
 assert.match(probe,/artifact mismatch/);
});

test('R8 converts all 12 critical UAT scenarios to executed evidence references',()=>{
 const ids=[...probe.matchAll(/'UAT-\d{2}-[A-Z-]+'/g)].map(m=>m[0]);
 assert.equal(new Set(ids).size,12);
 assert.match(probe,/executedEvidence/);
 assert.doesNotMatch(probe,/automatedRegressionFiles/);
});

test('R8 consumes runtime, browser, provider, worker, DR and payroll evidence',()=>{
 for(const token of ['github-r1-tenant-access-probe','github-r2-hr-payroll-probe','github-r3-residual-probe','github-r4-core-business-probe','github-r5-assets-fleet-probe','github-r6-scale-ai-probe','github-r7-ui-probe','built-browser-uat','github-api-runtime-sweep','github-notification-provider-probe','github-worker-runtime-probe','postgres-dr-drill','payroll-adjustment-postgres-stage']) assert.match(probe,new RegExp(token));
});


test('R8 executes reporting/security runtime proof for F23 F24 F25 and F44',()=>{
 const runtime=fs.readFileSync('scripts/ci-r8-reporting-security-probe.mjs','utf8');
 for(const token of ['F23_digestMutationDeniedWithoutAuthorizedRole','F24_disabledDigestBlocksManualSend','F25_lowStockUsesProductMinStockAtRuntime','F44_unverifiedBindingRejected','F44_verifiedBindingAcceptedWithoutRawRecipientConfig']) assert.match(runtime,new RegExp(token));
 assert.match(runtime,/employeeChannelBinding/);
 assert.match(runtime,/minStock: 10/);
 assert.match(runtime,/expect: 403/);
 assert.match(runtime,/expect: 400/);
});

test('R8 requires two safe browser mutation journeys and restoration evidence',()=>{
 const browser=fs.readFileSync('scripts/browser-uat.mjs','utf8');
 assert.match(browser,/R8_DAILY_DIGEST_CONFIG_MUTATION/);
 assert.match(browser,/ADMIN_EMPLOYEE_MASTER_MUTATIONS/);
 assert.match(browser,/R8_SAFE_MUTATION_JOURNEYS/);
 assert.match(browser,/restore original hour through Admin UI/);
 assert.match(probe,/R8_SAFE_MUTATION_JOURNEYS/);
 assert.match(probe,/journeys\.length<2/);
});

test('R8 final evidence consumes reporting security runtime probe',()=>{
 assert.match(probe,/github-r8-reporting-security-probe-latest/);
 assert.match(probe,/r8ReportingSecurity:true/);
});


test('R8 final probe reads safe mutation checks from inner browser evidence while retaining built wrapper identity',()=>{
  assert.match(probe,/browserBuilt:read\('handoff\/quality\/built-browser-uat-latest\.json'\)/);
  assert.match(probe,/browserRuntime:read\('handoff\/quality\/browser-uat-latest\.json'\)/);
  assert.match(probe,/evidence\.browserRuntime\?\.checks/);
  assert.match(probe,/browser wrapper\/inner source mismatch/);
  assert.match(probe,/browser wrapper\/inner artifact mismatch/);
});


test('R8 UAT workflow records exact identities and executes worker runtime probe',()=>{
 const workflow=fs.readFileSync('.github/workflows/toko360-full-uat.yml','utf8');
 assert.match(workflow,/Record exact source and build artifact identities/);
 assert.match(workflow,/T360_EXPECTED_SOURCE_FINGERPRINT=/);
 assert.match(workflow,/T360_EXPECTED_BUILD_ARTIFACT_ID=/);
 assert.match(workflow,/id: worker_probe/);
 assert.match(workflow,/npm run ci:worker:probe/);
 assert.match(workflow,/T360_WORKER_PROBE_BASE_URL: http:\/\/127\.0\.0\.1:4000\/api\/v1/);
});


test('R8 UAT workflow provides worker target lock and PostgreSQL DR evidence',()=>{
 const workflow=fs.readFileSync('.github/workflows/toko360-full-uat.yml','utf8');
 assert.match(workflow,/T360_CI_EXPECTED_HOST: localhost/);
 assert.match(workflow,/T360_CI_EXPECTED_DATABASE: toko360_staging/);
 assert.match(workflow,/id: worker_probe/);
 assert.match(workflow,/Prepare isolated PostgreSQL DR scratch database/);
 assert.match(workflow,/DROP DATABASE IF EXISTS toko360_dr_restore/);
 assert.match(workflow,/CREATE DATABASE toko360_dr_restore OWNER postgres/);
 assert.match(workflow,/id: dr_rehearsal/);
 assert.match(workflow,/npm run db:dr:rehearse:postgres/);
 assert.match(workflow,/T360_DR_RESTORE_DATABASE_URL: postgresql:\/\/postgres:toko360_ci_password@localhost:5432\/toko360_dr_restore\?schema=public/);
});
