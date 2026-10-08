import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(summary) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'t360-ci-assert-'));
  const file=path.join(root,'summary.json');
  fs.writeFileSync(file,JSON.stringify(summary));
  const script=path.resolve('scripts/ci-assert-full-system-summary.mjs');
  const result=spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,T360_CI_SUMMARY_OUTPUT:file},encoding:'utf8'});
  fs.rmSync(root,{recursive:true,force:true});
  return result;
}

test('aggregate GitHub assertion accepts automated PASS while human UAT remains pending', () => {
  const result=run({status:'PASS',productionTouched:false,sourceIdentity:{value:'abc'},buildArtifactId:'artifact',gates:{humanUat:'PENDING',uatCandidate:'EXPECTED_FAIL_CLOSED'},failures:{gates:[],steps:[]}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/aggregate PASS/);
});

test('aggregate GitHub assertion rejects failed or accidentally approved candidate evidence', () => {
  const failed=run({status:'FAIL',productionTouched:false,gates:{humanUat:'PENDING',uatCandidate:'EXPECTED_FAIL_CLOSED'},failures:{gates:[{id:'stage19',state:'FAIL'}],steps:[]}});
  assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/status=FAIL/);
  const approved=run({status:'PASS',productionTouched:false,gates:{humanUat:'PENDING',uatCandidate:'UNEXPECTED_PASS'},failures:{gates:[],steps:[]}});
  assert.notEqual(approved.status,0);
  assert.match(approved.stderr,/uatCandidate=UNEXPECTED_PASS/);
});
