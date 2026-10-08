#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const file = path.resolve(process.cwd(), process.env.T360_CI_SUMMARY_OUTPUT || 'handoff/quality/github-full-system-simulation-latest.json');
if (!fs.existsSync(file)) {
  console.error('GITHUB_FULL_SYSTEM_ASSERT_ERROR: summary evidence tidak ditemukan.');
  process.exit(1);
}
let summary;
try { summary = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (error) {
  console.error(`GITHUB_FULL_SYSTEM_ASSERT_ERROR: summary JSON tidak valid: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const reasons = [];
if (summary.status !== 'PASS') reasons.push(`status=${summary.status || 'missing'}`);
if (summary.productionTouched !== false) reasons.push('productionTouched harus false untuk GitHub simulation');
if (summary.gates?.humanUat !== 'PENDING') reasons.push(`humanUat=${summary.gates?.humanUat || 'missing'}`);
if (summary.gates?.uatCandidate !== 'EXPECTED_FAIL_CLOSED') reasons.push(`uatCandidate=${summary.gates?.uatCandidate || 'missing'}`);
if (Array.isArray(summary.failures?.gates) && summary.failures.gates.length) reasons.push(`failingGates=${summary.failures.gates.map((x) => `${x.id}:${x.state}`).join(',')}`);
if (Array.isArray(summary.failures?.steps) && summary.failures.steps.length) reasons.push(`failingSteps=${summary.failures.steps.map((x) => `${x.id}:${x.state}`).join(',')}`);
if (reasons.length) {
  console.error(`GITHUB_FULL_SYSTEM_ASSERT_ERROR: ${reasons.join(' | ')}`);
  process.exit(1);
}
console.log(`GitHub full-system aggregate PASS — source ${summary.sourceIdentity?.value || '<missing>'}, artifact ${summary.buildArtifactId || '<missing>'}; human UAT remains PENDING.`);
