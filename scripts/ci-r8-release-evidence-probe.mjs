#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const root=process.cwd();
const output=path.join(root,'handoff/quality/github-r8-release-evidence-latest.json');
const read=(p)=>{const f=path.join(root,p);if(!fs.existsSync(f))throw new Error(`R8 evidence tidak ditemukan: ${p}`);return JSON.parse(fs.readFileSync(f,'utf8'));};
const source=sourceFingerprint(root);
const artifact=readAndVerifyBuildArtifactManifest(root,'handoff/quality/build-artifact-manifest-latest.json',source.value).current;
const evidence={
 r1:read('handoff/quality/github-r1-tenant-access-probe-latest.json'),
 r2:read('handoff/quality/github-r2-hr-payroll-probe-latest.json'),
 r3:read('handoff/quality/github-r3-residual-probe-latest.json'),
 r4:read('handoff/quality/github-r4-core-business-probe-latest.json'),
 r5:read('handoff/quality/github-r5-assets-fleet-probe-latest.json'),
 r6:read('handoff/quality/github-r6-scale-ai-probe-latest.json'),
 r7:read('handoff/quality/github-r7-ui-probe-latest.json'),
 r8Reporting:read('handoff/quality/github-r8-reporting-security-probe-latest.json'),
 browserBuilt:read('handoff/quality/built-browser-uat-latest.json'),
 browserRuntime:read('handoff/quality/browser-uat-latest.json'),
 api:read('handoff/quality/github-api-runtime-sweep-latest.json'),
 provider:read('handoff/quality/github-notification-provider-probe-latest.json'),
 worker:read('handoff/quality/github-worker-runtime-probe-latest.json'),
 dr:read('handoff/quality/postgres-dr-drill-latest.json'),
 payroll:read('logs/payroll-adjustment-postgres-stage/latest.json'),
 stage20:read('logs/stage20-release-readiness/latest.json'),
};
const sourceOf=(v)=>v?.sourceIdentity?.value||v?.sourceIdentityAfter?.value||v?.sourceIdentityBefore?.value||null;
for(const [id,v] of Object.entries(evidence)){
 const s=sourceOf(v); if(s&&s!==source.value) throw new Error(`R8 ${id} stale source: ${s}`);
}
for(const id of ['r1','r2','r3','r4','r5','r6','r7','r8Reporting','browserBuilt','browserRuntime','api','provider','worker','dr']) if(evidence[id]?.status!=='PASS') throw new Error(`R8 evidence ${id} belum PASS.`);
if(!Object.values(evidence.r8Reporting?.checks||{}).every(Boolean)) throw new Error('R8 reporting/security runtime checks belum lengkap.');
if(evidence.browserBuilt?.browserEvidence?.sourceFingerprint!==source.value||evidence.browserRuntime?.sourceIdentity?.value!==source.value) throw new Error('R8 browser wrapper/inner source mismatch.');
if(evidence.browserBuilt?.buildArtifactId!==artifact.id||evidence.browserRuntime?.runtimeBuildArtifactId!==artifact.id||evidence.browserBuilt?.browserEvidence?.buildArtifactId!==artifact.id) throw new Error('R8 browser wrapper/inner artifact mismatch.');
const safeMutation=evidence.browserRuntime?.checks?.find?.((item)=>item?.id==='R8_SAFE_MUTATION_JOURNEYS');
if(!safeMutation||safeMutation.status!=='PASS'||safeMutation.productionTouched!==false||!Array.isArray(safeMutation.journeys)||safeMutation.journeys.length<2) throw new Error('R8 safe browser mutation evidence belum PASS lintas domain.');
if(evidence.payroll?.status!=='PASS'||evidence.payroll?.gate?.passed!==true) throw new Error('R8 payroll recovery evidence belum PASS.');
if(evidence.stage20?.gate?.automatedPassed!==true||evidence.stage20?.gate?.uatPassed!==false||evidence.stage20?.gate?.passed!==false) throw new Error('R8 Stage-20 harus automated PASS tetapi human UAT tetap pending.');
for(const id of ['browserBuilt','worker']) if(evidence[id]?.buildArtifactId&&evidence[id].buildArtifactId!==artifact.id) throw new Error(`R8 ${id} artifact mismatch.`);

const scenarios=[
 ['UAT-01-AUTH-ACCESS',['r1']],['UAT-02-PUBLIC-CATALOG',['browserBuilt','browserRuntime','api']],['UAT-03-SALES-ORDER-PAYMENT',['r4']],
 ['UAT-04-PURCHASE-RECEIPT',['r4']],['UAT-05-INVENTORY-OPERATIONS',['r4']],['UAT-06-ACCOUNTING-FINANCE-REPORTS',['r4','worker','r8Reporting']],
 ['UAT-07-HR-ATTENDANCE-PAYROLL',['r2','payroll']],['UAT-08-OFFLINE-SYNC',['r3']],['UAT-09-AUDIT-DENIAL',['r1','r8Reporting']],
 ['UAT-10-RESTORE-ROLLBACK',['dr']],['UAT-11-DELIVERY-LIFECYCLE',['r5']],['UAT-12-PAYROLL-ADJUSTMENT-RECOVERY',['r2','payroll']],
].map(([id,refs])=>({id,status:'PASS',executedEvidence:refs}));
const checks={exactSource:true,exactBuildArtifact:true,executedCriticalScenarios:scenarios.length===12,r8ReportingSecurity:true,safeBrowserMutationJourneys:safeMutation.journeys.length>=2,providerChain:evidence.provider.productionTouched===false,loadIndependentHumanGate:evidence.stage20.gate.uatPassed===false,humanStage20Pending:true};
const result={generatedAt:new Date().toISOString(),status:'PASS',sourceIdentity:source,buildArtifactId:artifact.id,scenarioCount:scenarios.length,scenarios,checks,productionTouched:false,humanStage20:'PENDING',note:'R8 final automated evidence binds executed runtime/browser/DR/provider probes to one exact source/build artifact. Human Stage-20 remains separate.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
