import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectFullSystemSummary, renderMarkdownSummary, writeFullSystemSummary } from '../scripts/ci-write-full-system-summary.mjs';

function copySourceSkeleton(target) {
  for (const entry of ['package.json','package-lock.json','VERSION']) { if (fs.existsSync(entry)) fs.copyFileSync(entry,path.join(target,entry)); }
  for (const dir of ['scripts','tests','config','database','packages','apps','.github']) fs.cpSync(dir,path.join(target,dir),{recursive:true});
}

test('GitHub summary marks missing gates NOT_RUN and stays FAIL', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'t360-ci-summary-'));
  copySourceSkeleton(root);
  const result=collectFullSystemSummary(root,{T360_CI_JOB_STATUS:'failure'});
  assert.equal(result.status,'FAIL');
  assert.equal(result.gates.stage20Automated,'NOT_RUN');
  assert.equal(result.gates.humanUat,'PENDING');
  assert.equal(result.productionTouched,false);
  fs.rmSync(root,{recursive:true,force:true});
});

test('GitHub summary rejects stale current-source evidence instead of reusing PASS', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'t360-ci-summary-'));
  copySourceSkeleton(root);
  const q=path.join(root,'handoff','quality'); fs.mkdirSync(q,{recursive:true});
  fs.writeFileSync(path.join(q,'github-critical-uat-coverage-latest.json'),JSON.stringify({status:'PASS',scenarioCount:12,sourceIdentity:{value:'old-source'}}));
  const result=collectFullSystemSummary(root,{T360_CI_JOB_STATUS:'failure'});
  assert.equal(result.gates.criticalUatCoverage,'STALE');
  assert.equal(result.status,'FAIL');
  fs.rmSync(root,{recursive:true,force:true});
});


test('GitHub summary renders concise gate diagnostics without claiming human UAT', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'t360-ci-summary-'));
  copySourceSkeleton(root);
  const result=collectFullSystemSummary(root,{T360_CI_JOB_STATUS:'failure'});
  const markdown=renderMarkdownSummary(result);
  assert.match(markdown, /Toko360 Full-System Simulation/);
  assert.match(markdown, /Human Stage-20 UAT/);
  assert.match(markdown, /PENDING/);
  assert.match(markdown, /Production touched:\*\* false/);
  fs.rmSync(root,{recursive:true,force:true});
});

test('GitHub summary appends markdown to GITHUB_STEP_SUMMARY when requested', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'t360-ci-summary-'));
  copySourceSkeleton(root);
  const stepSummary=path.join(root,'step-summary.md');
  const output='handoff/quality/test-github-summary.json';
  const { result, target }=writeFullSystemSummary(root,{T360_CI_JOB_STATUS:'failure',GITHUB_STEP_SUMMARY:stepSummary,T360_CI_SUMMARY_OUTPUT:output},output);
  assert.equal(result.status,'FAIL');
  assert.ok(fs.existsSync(target));
  assert.match(fs.readFileSync(stepSummary,'utf8'),/Evidence gates/);
  fs.rmSync(root,{recursive:true,force:true});
});
