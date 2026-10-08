#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const matrixPath = path.join(root, 'config/product-completeness.json');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const failures = [];
const allowed = new Set(matrix.allowedStatuses ?? []);
const all = [...(matrix.features ?? []), ...(matrix.legacyFunctionalPhases ?? []), ...(matrix.postAuditFindings ?? [])];
const ids = all.map((item) => item.id);
if (new Set(ids).size !== ids.length) failures.push('Canonical capability IDs must be unique.');
if (!matrix.authoritative) failures.push('Canonical product completeness matrix must be authoritative.');
if (matrix.productReady !== false) failures.push('PRODUCT_READY must remain false until P7 + Human Stage-20 are accepted.');
if (matrix.humanStage20 !== 'PENDING') failures.push('Human Stage-20 must remain PENDING during P0.');
for (const item of all) {
  if (!allowed.has(item.status)) failures.push(`${item.id} has invalid status ${item.status}`);
  if (['RUNTIME_VERIFIED','HUMAN_ACCEPTED'].includes(item.status) && !(item.evidence?.length)) {
    failures.push(`${item.id} cannot be ${item.status} without explicit evidence.`);
  }
  if (item.status === 'HUMAN_ACCEPTED' && !item.evidence.some((e) => /human|operator|stage-20/i.test(e))) {
    failures.push(`${item.id} HUMAN_ACCEPTED requires explicit human/operator evidence.`);
  }
}

const featureCatalog = fs.readFileSync(path.join(root, 'docs/FEATURE-CATALOG.md'), 'utf8');
const featureKeys = [...featureCatalog.matchAll(/^\|\s*`?([a-z][a-z0-9_]+)`?\s*\|/gm)].map((m) => m[1]).filter((x) => x !== 'feature');
const matrixKeys = new Set((matrix.features ?? []).map((x) => x.key));
for (const key of new Set(featureKeys)) if (!matrixKeys.has(key)) failures.push(`Feature catalog key missing from canonical matrix: ${key}`);

const roadmap = JSON.parse(fs.readFileSync(path.join(root, 'config/functional-depth-roadmap.json'),'utf8'));
if (roadmap.statusAuthority !== 'config/product-completeness.json') failures.push('Functional depth roadmap must defer status authority to canonical matrix.');
const recovery = JSON.parse(fs.readFileSync(path.join(root, 'config/recovery-finding-matrix.json'),'utf8'));
if (recovery.statusAuthority !== 'config/product-completeness.json') failures.push('Recovery matrix must defer status authority to canonical matrix.');

for (const file of ['docs/PROJECT-STATE.md','STATUS-FINAL.md','docs/FUNCTIONAL-DEPTH-ROADMAP.md','docs/FEATURE-CATALOG.md']) {
  const body = fs.readFileSync(path.join(root,file),'utf8');
  if (!body.includes('config/product-completeness.json')) failures.push(`${file} must point to config/product-completeness.json as status authority.`);
}

let tracked = [];
try { tracked = execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).split(/\r?\n/).filter(Boolean); }
catch {
  const walk=(dir,out=[])=>{ for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,e.name); const rel=path.relative(root,p).replaceAll('\\','/'); if(e.isDirectory()){ if(['node_modules','.git','.next','dist','coverage','runtime'].includes(e.name) || rel==='handoff/quality' || rel==='handoff/generated' || rel==='logs') continue; walk(p,out); } else if(!rel.endsWith('.recovery-backup')) out.push(rel); } return out; };
  tracked = walk(root);
}
const forbiddenTracked = tracked.filter((file) =>
  file === 'payroll-adjustment-postgres-stage.env' ||
  file.endsWith('.recovery-backup') ||
  /^handoff\/quality\/.+\.(json|md)$/.test(file) ||
  /^logs\/(payroll-adjustment-postgres-stage|report-exports|stage20-release-readiness)\//.test(file)
);
for (const file of forbiddenTracked) failures.push(`Generated/credential artifact must not be tracked: ${file}`);

const criticalHigh = (matrix.postAuditFindings ?? []).filter((x) => ['CRITICAL','HIGH'].includes(x.severity));
for (const item of criticalHigh) {
  if (['RUNTIME_VERIFIED','HUMAN_ACCEPTED'].includes(item.status) && !item.evidence?.length) failures.push(`${item.key} closed without runtime/human evidence.`);
}

const summary = {
  status: failures.length ? 'FAIL' : 'PASS',
  canonicalSource: 'config/product-completeness.json',
  featureCount: matrix.features.length,
  legacyPhaseCount: matrix.legacyFunctionalPhases.length,
  postAuditFindingCount: matrix.postAuditFindings.length,
  productReady: matrix.productReady,
  humanStage20: matrix.humanStage20,
  failures,
};
console.log(`Product completeness audit ${summary.status}: ${summary.featureCount} features, ${summary.legacyPhaseCount} legacy phases, ${summary.postAuditFindingCount} post-audit findings.`);
if (failures.length) { for (const failure of failures) console.error(`BLOCKER: ${failure}`); process.exit(1); }
