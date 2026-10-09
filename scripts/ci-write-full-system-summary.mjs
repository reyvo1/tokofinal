#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const DEFAULT_OUTPUT = 'handoff/quality/github-full-system-simulation-latest.json';

function readJson(root, relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { __invalidJson: true }; }
}

function evidenceSourceValue(value) {
  return value?.sourceIdentity?.value
    || value?.sourceIdentityAfter?.value
    || value?.sourceIdentityBefore?.value
    || null;
}

function gateStatus(value, currentSource, evaluate, { allowNoSource = false } = {}) {
  if (!value) return 'NOT_RUN';
  if (value.__invalidJson) return 'INVALID_EVIDENCE';
  const source = evidenceSourceValue(value);
  if (!source && !allowNoSource) return 'UNBOUND_EVIDENCE';
  if (source && source !== currentSource) return 'STALE';
  try { return evaluate(value) ? 'PASS' : 'FAIL'; } catch { return 'INVALID_EVIDENCE'; }
}

function stepOutcome(env, name) {
  const raw = String(env[name] || '').trim().toLowerCase();
  if (!raw) return 'NOT_REPORTED';
  if (raw === 'success') return 'PASS';
  if (raw === 'failure') return 'FAIL';
  if (raw === 'cancelled') return 'CANCELLED';
  if (raw === 'skipped') return 'SKIPPED';
  return `UNKNOWN:${raw}`;
}

function candidateStatus(candidate, currentSource) {
  if (!candidate) return 'NOT_RUN';
  if (candidate.__invalidJson) return 'INVALID_EVIDENCE';
  const source = evidenceSourceValue(candidate);
  if (!source) return 'UNBOUND_EVIDENCE';
  if (source !== currentSource) return 'STALE';
  if (candidate.status === 'PASS' || candidate.passed === true) return 'UNEXPECTED_PASS';
  if (candidate.status === 'FAIL' || candidate.passed === false || candidate.gate?.passed === false) return 'EXPECTED_FAIL_CLOSED';
  return 'INVALID_EVIDENCE';
}

export function collectFullSystemSummary(root = process.cwd(), env = process.env) {
  const sourceIdentity = sourceFingerprint(root);
  const current = sourceIdentity.value;
  const visualMap = readJson(root, 'config/p5-visual-surface-map.json');
  const expectedP5Screenshots = {
    adminPrimary: visualMap?.admin?.primaryWorkspaces?.length ?? -1,
    adminContextual: visualMap?.admin?.representativeContextualRoutes?.length ?? -1,
    pos: visualMap?.pos?.views?.length ?? -1,
    storefront: visualMap?.storefront?.views?.length ?? -1,
    employeePortal: visualMap?.employeePortal?.views?.length ?? -1,
  };
  const build = readJson(root, 'handoff/quality/build-gate-latest.json');
  const artifact = readJson(root, 'handoff/quality/build-artifact-manifest-latest.json');
  const transport = readJson(root, 'handoff/quality/github-runtime-artifact-transport-latest.json');
  const dependencyAudit = readJson(root, 'handoff/quality/npm-audit-production-latest.json');
  const coverage = readJson(root, 'handoff/quality/github-critical-uat-coverage-latest.json');
  const repositoryAudit = readJson(root, 'handoff/quality/full-repository-audit-latest.json');
  const uiAudit = readJson(root, 'handoff/quality/ui-interaction-audit-latest.json');
  const apiSweep = readJson(root, 'handoff/quality/github-api-runtime-sweep-latest.json');
  const r1TenantAccess = readJson(root, 'handoff/quality/github-r1-tenant-access-probe-latest.json');
  const r2HrPayroll = readJson(root, 'handoff/quality/github-r2-hr-payroll-probe-latest.json');
  const r4CoreBusiness = readJson(root, 'handoff/quality/github-r4-core-business-probe-latest.json');
  const w3CashPostgres = readJson(root, 'handoff/quality/github-w3-cash-postgres-probe-latest.json');
  const p2aMultiUom = readJson(root, 'handoff/quality/github-p2a-multi-uom-runtime-probe-latest.json');
  const p2Payroll = readJson(root, 'handoff/quality/github-p2-payroll-runtime-probe-latest.json');
  const r5AssetsFleet = readJson(root, 'handoff/quality/github-r5-assets-fleet-probe-latest.json');
  const r6ScaleAi = readJson(root, 'handoff/quality/github-r6-scale-ai-probe-latest.json');
  const p3Productization = readJson(root, 'handoff/quality/github-p3-productization-probe-latest.json');
  const p4CanonicalOwnership = readJson(root, 'handoff/quality/github-p4-canonical-ownership-probe-latest.json');
  const p5VisualRebuild = readJson(root, 'handoff/quality/github-p5-visual-rebuild-probe-latest.json');
  const r3Residual = readJson(root, 'handoff/quality/github-r3-residual-probe-latest.json');
  const r7Ui = readJson(root, 'handoff/quality/github-r7-ui-probe-latest.json');
  const r8ReportingSecurity = readJson(root, 'handoff/quality/github-r8-reporting-security-probe-latest.json');
  const r8Release = readJson(root, 'handoff/quality/github-r8-release-evidence-latest.json');
  const providerProbe = readJson(root, 'handoff/quality/github-notification-provider-probe-latest.json');
  const stage18 = readJson(root, 'logs/stage18-product-supplier-postgres/latest.json');
  const payroll = readJson(root, 'logs/payroll-adjustment-postgres-stage/latest.json');
  const stage19 = readJson(root, 'logs/stage19-tenant-integration/latest.json');
  const builtBrowser = readJson(root, 'handoff/quality/built-browser-uat-latest.json');
  const workerProbe = readJson(root, 'handoff/quality/github-worker-runtime-probe-latest.json');
  const staging = readJson(root, 'handoff/quality/staging-certification-latest.json');
  const load = readJson(root, 'handoff/quality/load-health-latest.json');
  const indexProfile = readJson(root, 'handoff/quality/index-profile-latest.json');
  const dr = readJson(root, 'handoff/quality/postgres-dr-drill-latest.json');
  const stage20 = readJson(root, 'logs/stage20-release-readiness/latest.json');
  const candidate = readJson(root, 'handoff/quality/uat-candidate-latest.json');

  const artifactSource = artifact?.sourceIdentity?.value || null;
  const artifactId = artifact?.status === 'PASS' && artifactSource === current ? artifact?.artifact?.id || null : null;
  const expectedArtifactId = String(env.T360_EXPECTED_BUILD_ARTIFACT_ID || '').trim() || artifactId;
  const artifactState = !artifact ? 'NOT_RUN'
    : artifact.__invalidJson ? 'INVALID_EVIDENCE'
      : artifact.status !== 'PASS' ? 'FAIL'
        : artifactSource !== current ? 'STALE'
          : !artifactId ? 'INVALID_EVIDENCE'
            : expectedArtifactId && artifactId !== expectedArtifactId ? 'ARTIFACT_MISMATCH'
              : 'PASS';

  const gate = {
    build: gateStatus(build, current, (v) => v.status === 'PASS' && v.buildArtifactId === artifactId),
    buildArtifact: artifactState,
    artifactTransport: gateStatus(transport, current, (v) => v.status === 'PASS'
      && Boolean(artifactId) && v.buildArtifactId === artifactId
      && /^(?:sha256:)?[a-f0-9]{64}$/i.test(String(v.github?.artifactDigest || ''))),
    dependencyAudit: gateStatus(dependencyAudit, current, (v) => v.status === 'PASS' && v.blockingCount === 0 && v.productionTouched === false),
    criticalUatCoverage: gateStatus(coverage, current, (v) => v.status === 'PASS' && v.scenarioCount === 12),
    repositoryAudit: gateStatus(repositoryAudit, current, (v) => v.status === 'PASS' && v.inventory?.apiHandlers > 0),
    uiInteractionAudit: gateStatus(uiAudit, current, (v) => v.status === 'PASS' && Object.values(v.surfaces || {}).every((surface) => surface.inertButtons === 0 && surface.inertLinks === 0)),
    apiRuntimeSweep: gateStatus(apiSweep, current, (v) => v.status === 'PASS' && v.operationCount > 0 && v.blockerCount === 0),
    r1TenantAccess: gateStatus(r1TenantAccess, current, (v) => v.status === 'PASS' && v.isolation?.foreignBranchDenied === true && v.isolation?.foreignCompanyDenied === true && v.tenant?.switched === true && v.access?.statusLifecycle === true),
    r2HrPayroll: gateStatus(r2HrPayroll, current, (v) => v.status === 'PASS' && Object.values(v.checks || {}).every(Boolean)),
    r4CoreBusiness: gateStatus(r4CoreBusiness, current, (v) => v.status === 'PASS' && Object.values(v.checks || {}).every(Boolean)),
    w3CashPostgres: gateStatus(w3CashPostgres, current, (v) => v.status === 'PASS' && v.productionTouched === false && v.humanStage20 === 'PENDING' && Object.keys(v.checks || {}).length >= 10 && Object.values(v.checks).every(Boolean)),
    p2aMultiUom: gateStatus(p2aMultiUom, current, (v) => v.status === 'PASS' && v.productionTouched === false && Object.values(v.checks || {}).every(Boolean)),
    p2Payroll: gateStatus(p2Payroll, current, (v) => v.status === 'PASS' && v.productionTouched === false && Object.values(v.checks || {}).every(Boolean)),
    r5AssetsFleet: gateStatus(r5AssetsFleet, current, (v) => v.status === 'PASS' && Object.values(v.checks || {}).every(Boolean)),
    r6ScaleAi: gateStatus(r6ScaleAi, current, (v) => v.status === 'PASS' && Object.values(v.checks || {}).every(Boolean)),
    p3Productization: gateStatus(p3Productization, current, (v) => v.status === 'PASS' && v.productionTouched === false && Object.values(v.checks || {}).every(Boolean)),
    p4CanonicalOwnership: gateStatus(p4CanonicalOwnership, current, (v) => v.status === 'PASS' && v.productionTouched === false && Object.values(v.checks || {}).every(Boolean) && v.ownership?.domainCount === 9),
    p5VisualRebuild: gateStatus(p5VisualRebuild, current, (v) => v.status === 'PASS' && v.productionTouched === false && v.humanAcceptance === 'PENDING' && Object.values(v.checks || {}).every(Boolean) && Object.entries(expectedP5Screenshots).every(([key, expected]) => expected >= 0 && v.screenshotCounts?.[key] === expected)),
    r3Residual: gateStatus(r3Residual, current, (v) => v.status === 'PASS' && Object.values(v.checks || {}).every(Boolean)),
    r7Ui: gateStatus(r7Ui, current, (v) => v.status === 'PASS' && Object.values(v.checks || {}).every(Boolean) && v.workspaceCount === expectedP5Screenshots.adminPrimary && v.contextualWorkspaceCount >= Math.max(0, expectedP5Screenshots.adminPrimary - 1)),
    r8ReportingSecurity: gateStatus(r8ReportingSecurity, current, (v) => v.status === 'PASS' && Object.values(v.checks || {}).every(Boolean) && v.productionTouched === false),
    r8Release: gateStatus(r8Release, current, (v) => v.status === 'PASS' && v.scenarioCount === 12 && v.productionTouched === false && v.humanStage20 === 'PENDING'),
    notificationProviderProbe: gateStatus(providerProbe, current, (v) => v.status === 'PASS' && v.productionTouched === false && v.simulator?.telegramCalls >= 2 && v.simulator?.whatsappCalls >= 1),
    stage18: gateStatus(stage18, current, (v) => v.gate?.passed === true),
    payrollMigration: gateStatus(payroll, current, (v) => v.status === 'PASS' && v.gate?.passed === true),
    stage19: gateStatus(stage19, current, (v) => v.gate?.passed === true && (!artifactId || v.buildArtifactId === artifactId)),
    builtBrowser: gateStatus(builtBrowser, current, (v) => v.status === 'PASS' && (!artifactId || v.buildArtifactId === artifactId)),
    workerRuntime: gateStatus(workerProbe, current, (v) => v.status === 'PASS' && v.productionTouched === false && (!artifactId || v.buildArtifactId === artifactId)),
    stagingCertification: gateStatus(staging, current, (v) => v.passed === true && (!artifactId || v.buildArtifactId === artifactId)),
    load: gateStatus(load, current, (v) => v.thresholds?.passed === true && (!artifactId || v.runtimeBuildArtifactId === artifactId)),
    indexProfile: gateStatus(indexProfile, current, (v) => v.status === 'PASS' && v.gate?.passed === true && v.database === 'postgresql' && Array.isArray(v.tableStats) && Array.isArray(v.indexStats)),
    dr: gateStatus(dr, current, (v) => v.status === 'PASS'),
    stage20Automated: gateStatus(stage20, current, (v) => v.gate?.automatedPassed === true && (!artifactId || v.buildArtifactId === artifactId)),
    humanUat: 'PENDING',
    uatCandidate: candidateStatus(candidate, current),
  };

  const diagnosticSteps = {
    repositoryAudit: stepOutcome(env, 'T360_CI_STEP_REPO_AUDIT'),
    uiInteractionAudit: stepOutcome(env, 'T360_CI_STEP_UI_AUDIT'),
    dependencyAudit: stepOutcome(env, 'T360_CI_STEP_DEPENDENCY_AUDIT'),
    criticalUatCoverage: stepOutcome(env, 'T360_CI_STEP_CRITICAL_COVERAGE'),
    restoreDatabases: stepOutcome(env, 'T360_CI_STEP_RESTORE_DATABASES'),
    stage18: stepOutcome(env, 'T360_CI_STEP_STAGE18'),
    payrollMigration: stepOutcome(env, 'T360_CI_STEP_PAYROLL_MIGRATION'),
    stage19: stepOutcome(env, 'T360_CI_STEP_STAGE19'),
    builtBrowser: stepOutcome(env, 'T360_CI_STEP_BUILT_BROWSER'),
    runtimeStart: stepOutcome(env, 'T360_CI_STEP_RUNTIME_START'),
    workerProbe: stepOutcome(env, 'T360_CI_STEP_WORKER_PROBE'),
    apiRuntimeSweep: stepOutcome(env, 'T360_CI_STEP_API_SWEEP'),
    r1TenantAccess: stepOutcome(env, 'T360_CI_STEP_R1_TENANT_ACCESS'),
    r2HrPayroll: stepOutcome(env, 'T360_CI_STEP_R2_HR_PAYROLL'),
    r4CoreBusiness: stepOutcome(env, 'T360_CI_STEP_R4_CORE_BUSINESS'),
    w3CashPostgres: stepOutcome(env, 'T360_CI_STEP_W3_CASH_POSTGRES'),
    p2aMultiUom: stepOutcome(env, 'T360_CI_STEP_P2A_MULTI_UOM'),
    p2Payroll: stepOutcome(env, 'T360_CI_STEP_P2_PAYROLL'),
    r5AssetsFleet: stepOutcome(env, 'T360_CI_STEP_R5_ASSETS_FLEET'),
    r6ScaleAi: stepOutcome(env, 'T360_CI_STEP_R6_SCALE_AI'),
    p3Productization: stepOutcome(env, 'T360_CI_STEP_P3_PRODUCTIZATION'),
    p4CanonicalOwnership: stepOutcome(env, 'T360_CI_STEP_P4_CANONICAL_OWNERSHIP'),
    p5VisualRebuild: stepOutcome(env, 'T360_CI_STEP_P5_VISUAL'),
    r3Residual: stepOutcome(env, 'T360_CI_STEP_R3_RESIDUAL'),
    r7Ui: stepOutcome(env, 'T360_CI_STEP_R7_UI'),
    r8ReportingSecurity: stepOutcome(env, 'T360_CI_STEP_R8_REPORTING_SECURITY'),
    r8Release: stepOutcome(env, 'T360_CI_STEP_R8_RELEASE'),
    notificationProviderProbe: stepOutcome(env, 'T360_CI_STEP_PROVIDER_PROBE'),
    stagingCertification: stepOutcome(env, 'T360_CI_STEP_STAGING_CERTIFICATION'),
    loadSmoke: stepOutcome(env, 'T360_CI_STEP_LOAD_SMOKE'),
    indexProfile: stepOutcome(env, 'T360_CI_STEP_INDEX_PROFILE'),
    drRehearsal: stepOutcome(env, 'T360_CI_STEP_DR_REHEARSAL'),
    stage20Prepare: stepOutcome(env, 'T360_CI_STEP_STAGE20_PREPARE'),
    stage20Automated: stepOutcome(env, 'T360_CI_STEP_STAGE20_AUTOMATED'),
    candidateFailClosed: stepOutcome(env, 'T360_CI_STEP_CANDIDATE_FAILCLOSED'),
    runtimeArtifactUpload: stepOutcome(env, 'T360_CI_STEP_RUNTIME_ARTIFACT_UPLOAD'),
  };

  const priorJobStatus = String(env.T360_CI_JOB_STATUS || 'unknown').toLowerCase();
  const requiredAutomated = [
    'build','buildArtifact','artifactTransport','dependencyAudit','criticalUatCoverage','repositoryAudit','uiInteractionAudit','stage18','payrollMigration','stage19',
    'builtBrowser','r7Ui','workerRuntime','apiRuntimeSweep','r1TenantAccess','r2HrPayroll','r4CoreBusiness','w3CashPostgres','p2aMultiUom','p2Payroll','r5AssetsFleet','r6ScaleAi','p3Productization','p4CanonicalOwnership','p5VisualRebuild','notificationProviderProbe','stagingCertification','load','indexProfile','dr','stage20Automated',
  ];
  const automatedPassed = requiredAutomated.every((key) => gate[key] === 'PASS');
  const reportedDiagnostics = Object.values(diagnosticSteps).filter((value) => value !== 'NOT_REPORTED');
  const diagnosticPassed = reportedDiagnostics.length === 0 || reportedDiagnostics.every((value) => value === 'PASS');
  const failClosedCandidatePassed = gate.uatCandidate === 'EXPECTED_FAIL_CLOSED';
  const status = priorJobStatus === 'success' && automatedPassed && diagnosticPassed && failClosedCandidatePassed ? 'PASS' : 'FAIL';
  const failingGates = Object.entries(gate).filter(([key, value]) => key !== 'humanUat' && !['PASS','EXPECTED_FAIL_CLOSED'].includes(value));
  const failingSteps = Object.entries(diagnosticSteps).filter(([, value]) => !['PASS','NOT_REPORTED'].includes(value));

  return {
    generatedAt: new Date().toISOString(),
    status,
    environment: String(env.GITHUB_ACTIONS || '').toLowerCase() === 'true' ? 'GITHUB_ACTIONS_NON_PRODUCTION' : 'LOCAL_PRE_GITHUB_VALIDATION',
    priorJobStatus,
    sourceIdentity,
    buildArtifactId: artifactId,
    gates: gate,
    diagnosticSteps,
    failures: {
      gates: failingGates.map(([id, state]) => ({ id, state })),
      steps: failingSteps.map(([id, state]) => ({ id, state })),
    },
    productionTouched: false,
    note: 'Automated GitHub simulation only. Human Stage-20 UAT remains mandatory before UAT-candidate promotion.',
  };
}

export function renderMarkdownSummary(result) {
  const rows = Object.entries(result.gates).map(([id, state]) => `| ${id} | ${state} |`).join('\n');
  const stepRows = Object.entries(result.diagnosticSteps).map(([id, state]) => `| ${id} | ${state} |`).join('\n');
  const failures = result.failures.gates.length || result.failures.steps.length
    ? [...result.failures.gates.map((item) => `gate:${item.id}=${item.state}`), ...result.failures.steps.map((item) => `step:${item.id}=${item.state}`)].join(', ')
    : 'none';
  return [
    '# Toko360 Full-System Simulation',
    '',
    `**Status:** ${result.status}`,
    `**Source:** \`${result.sourceIdentity.value}\``,
    `**Build artifact:** \`${result.buildArtifactId || 'not-available'}\``,
    `**Human Stage-20 UAT:** ${result.gates.humanUat}`,
    `**Production touched:** ${result.productionTouched}`,
    `**Failures:** ${failures}`,
    '',
    '## Evidence gates',
    '| Gate | State |',
    '| --- | --- |',
    rows,
    '',
    '## Diagnostic step outcomes',
    '| Step | State |',
    '| --- | --- |',
    stepRows,
    '',
    '> Automated GitHub simulation cannot approve human Stage-20 UAT or production.',
    '',
  ].join('\n');
}

export function writeFullSystemSummary(root = process.cwd(), env = process.env, output = env.T360_CI_SUMMARY_OUTPUT || DEFAULT_OUTPUT) {
  const result = collectFullSystemSummary(root, env);
  const target = path.resolve(root, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  const stepSummary = String(env.GITHUB_STEP_SUMMARY || '').trim();
  if (stepSummary) fs.appendFileSync(stepSummary, renderMarkdownSummary(result), 'utf8');
  return { result, target };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { result, target } = writeFullSystemSummary();
  console.log(`GitHub full-system summary ${result.status} — ${path.relative(process.cwd(), target)}`);
  if (result.gates.uatCandidate === 'UNEXPECTED_PASS') process.exitCode = 1;
}
