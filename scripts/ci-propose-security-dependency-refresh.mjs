#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnNpmSync } from './lib/process-runner.mjs';
import { evaluateAudit } from './ci-audit-production-deps.mjs';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const ROOT = process.cwd();
const PLAN_FILE = path.join(ROOT, '.github/ci/security-dependency-plan.json');
const OUTPUT_DIR = path.join(ROOT, 'handoff/quality/security-dependency-proposal');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function copyJson(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function workspacePackageFiles(root) {
  const roots = ['apps', 'packages'];
  const out = [];
  for (const parent of roots) {
    const base = path.join(root, parent);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const file = path.join(base, name, 'package.json');
      if (fs.existsSync(file)) out.push(path.relative(root, file));
    }
  }
  return out.sort();
}

function setDeclaredVersion(pkg, name, version) {
  if (pkg.dependencies?.[name]) { pkg.dependencies[name] = version; return true; }
  if (pkg.devDependencies?.[name]) { pkg.devDependencies[name] = version; return true; }
  return false;
}

function patchPackageJsons(tempRoot, candidate) {
  const direct = candidate.direct || {};
  const nextApps = ['admin', 'storefront', 'pos', 'employee-portal'];
  if (direct.next) {
    for (const app of nextApps) {
      const file = path.join(tempRoot, 'apps', app, 'package.json');
      const pkg = readJson(file);
      if (!pkg.dependencies?.next) throw new Error(`${app} does not declare next`);
      pkg.dependencies.next = direct.next;
      writeJson(file, pkg);
    }
  }

  const apiFile = path.join(tempRoot, 'apps/api/package.json');
  const api = readJson(apiFile);
  for (const [name, version] of Object.entries(direct)) {
    if (name === 'next') continue;
    let changed = setDeclaredVersion(api, name, version);
    if (name === '@prisma/client') {
      const workerFile = path.join(tempRoot, 'apps/worker/package.json');
      if (fs.existsSync(workerFile)) {
        const worker = readJson(workerFile);
        if (setDeclaredVersion(worker, name, version)) {
          writeJson(workerFile, worker);
          changed = true;
        }
      }
    }
    if (!changed) throw new Error(`No workspace declaration found for ${name}`);
  }
  writeJson(apiFile, api);

  const rootFile = path.join(tempRoot, 'package.json');
  const rootPkg = readJson(rootFile);
  rootPkg.overrides = { ...(rootPkg.overrides || {}), ...(candidate.overrides || {}) };
  writeJson(rootFile, rootPkg);
}


function packageNameFromLockKey(key) {
  const marker = '/node_modules/';
  if (key === 'node_modules') return null;
  if (key.startsWith('node_modules/')) return key.slice('node_modules/'.length);
  const index = key.lastIndexOf(marker);
  return index >= 0 ? key.slice(index + marker.length) : null;
}

function verifyOverrideResolution(lock, overrides = {}) {
  const checks = [];
  for (const [name, expected] of Object.entries(overrides)) {
    // Current security plan intentionally uses exact versions for transitive pins.
    if (!/^\\d+\\.\\d+\\.\\d+(?:[-+].+)?$/.test(String(expected))) continue;
    const matches = Object.entries(lock?.packages || {})
      .filter(([key, value]) => packageNameFromLockKey(key) === name && value?.version)
      .map(([key, value]) => ({ key, version: value.version }));
    const ok = matches.length > 0 && matches.every((item) => item.version === expected);
    checks.push({ name, expected, matches, ok });
  }
  return checks;
}

function run(root, args) {
  const result = spawnNpmSync(args, { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' }, maxBuffer: 20 * 1024 * 1024 });
  return {
    exitCode: result.status ?? 2,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null,
  };
}

function blockerLines(findings = []) {
  const lines = [];
  for (const finding of findings) {
    const fix = finding.fixAvailable === true ? 'fixAvailable=true' : finding.fixAvailable ? `fixAvailable=${JSON.stringify(finding.fixAvailable)}` : 'fixAvailable=false';
    lines.push(`PROPOSAL_BLOCKER package=${finding.name} severity=${finding.severity} direct=${finding.isDirect} range=${finding.range ?? 'unknown'} ${fix}`);
    for (const via of finding.via || []) {
      if (typeof via === 'string') lines.push(`  via=${via}`);
      else lines.push(`  via=${via.name ?? 'advisory'} severity=${via.severity ?? 'unknown'} range=${via.range ?? 'unknown'} title=${via.title ?? ''} url=${via.url ?? ''}`);
    }
  }
  return lines;
}

function evaluateCandidate({ root, outputDir, sourceIdentity, committedLockSha256, workspaceFiles, candidate }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `toko360-security-deps-${candidate.id}-`));
  const candidateOutput = path.join(outputDir, candidate.id);
  const result = {
    id: candidate.id,
    description: candidate.description || null,
    status: 'FAIL',
    sourceIdentity,
    productionTouched: false,
    isolated: true,
    direct: candidate.direct || {},
    overrides: candidate.overrides || {},
    committedLockSha256,
    lockStrategy: 'fresh-from-manifests',
    proposedLockSha256: null,
    audit: null,
    overrideResolution: [],
    error: null,
  };
  fs.mkdirSync(candidateOutput, { recursive: true });
  try {
    copyJson(path.join(root, 'package.json'), path.join(tempRoot, 'package.json'));
    for (const rel of workspaceFiles) copyJson(path.join(root, rel), path.join(tempRoot, rel));
    patchPackageJsons(tempRoot, candidate);

    // Deliberately do not seed the candidate with the committed lock. Security proposals must
    // resolve from the patched manifests so transitive overrides/advisory fixes are actually
    // exercised instead of inheriting stale vulnerable resolutions from the old lockfile.
    const install = run(tempRoot, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
    fs.writeFileSync(path.join(candidateOutput, 'npm-install-package-lock-only.log'), `${install.stdout}${install.stderr}`);
    if (install.error || install.exitCode !== 0) {
      const tail = `${install.stderr || install.stdout || ''}`.trim().split(/\r?\n/).slice(-24).join(' | ').slice(-4000);
      throw new Error(`security proposal lock refresh failed with exit ${install.exitCode}${install.error ? `: ${install.error}` : ''}${tail ? `; npm=${tail}` : ''}`);
    }

    const candidateLock = readJson(path.join(tempRoot, 'package-lock.json'));
    result.overrideResolution = verifyOverrideResolution(candidateLock, candidate.overrides || {});
    const unresolvedOverrides = result.overrideResolution.filter((item) => !item.ok);
    if (unresolvedOverrides.length) {
      throw new Error(`security proposal override resolution mismatch: ${unresolvedOverrides.map((item) => `${item.name} expected=${item.expected} actual=${item.matches.map((m) => m.version).join(',') || '<missing>'}`).join('; ')}`);
    }

    const auditRun = run(tempRoot, ['audit', '--omit=dev', '--audit-level=high', '--json']);
    fs.writeFileSync(path.join(candidateOutput, 'npm-audit.json'), auditRun.stdout || '{}');
    let auditJson;
    try { auditJson = JSON.parse(auditRun.stdout || '{}'); }
    catch { throw new Error(`security proposal npm audit did not return valid JSON: ${auditRun.stderr.slice(-500)}`); }
    const evaluated = evaluateAudit(auditJson);
    result.audit = { exitCode: auditRun.exitCode, ...evaluated };

    const proposedLock = path.join(tempRoot, 'package-lock.json');
    result.proposedLockSha256 = sha256(proposedLock);
    copyJson(path.join(tempRoot, 'package.json'), path.join(candidateOutput, 'package.json'));
    fs.copyFileSync(proposedLock, path.join(candidateOutput, 'package-lock.json'));
    for (const rel of workspaceFiles) {
      if (fs.existsSync(path.join(tempRoot, rel))) copyJson(path.join(tempRoot, rel), path.join(candidateOutput, rel));
    }

    result.status = evaluated.passed ? 'PASS' : 'FAIL';
    if (!evaluated.passed) result.error = `${evaluated.blocking} high/critical vulnerabilities remain in candidate ${candidate.id}.`;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  writeJson(path.join(candidateOutput, 'proposal.json'), result);
  return result;
}

export function generateSecurityDependencyProposal({ root = ROOT, outputDir = OUTPUT_DIR } = {}) {
  const sourceIdentity = sourceFingerprint(root);
  const plan = readJson(path.join(root, '.github/ci/security-dependency-plan.json'));
  const candidates = Array.isArray(plan.candidates) ? plan.candidates : [];
  if (!candidates.length) throw new Error('security dependency plan must declare candidates[]');
  const beforeLock = path.join(root, 'package-lock.json');
  const workspaceFiles = workspacePackageFiles(root);
  const committedLockSha256 = sha256(beforeLock);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const results = candidates.map((candidate) => evaluateCandidate({
    root, outputDir, sourceIdentity, committedLockSha256, workspaceFiles, candidate,
  }));
  const preferred = results.find((item) => item.status === 'PASS') || null;
  const summary = {
    generatedAt: new Date().toISOString(),
    status: preferred ? 'PASS' : 'FAIL',
    sourceIdentity,
    productionTouched: false,
    isolated: true,
    committedLockSha256,
    preferredCandidate: preferred?.id || null,
    candidates: results.map((item) => ({
      id: item.id,
      description: item.description,
      status: item.status,
      proposedLockSha256: item.proposedLockSha256,
      audit: item.audit,
      error: item.error,
    })),
    notes: plan.notes || [],
    error: preferred ? null : 'No isolated security dependency candidate is audit-clean.',
  };
  writeJson(path.join(outputDir, 'proposal.json'), summary);
  return summary;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = generateSecurityDependencyProposal();
  console.log(`Security dependency proposal ${result.status} — isolated=${result.isolated} output=${path.relative(ROOT, OUTPUT_DIR)} preferred=${result.preferredCandidate || '<none>'}`);
  for (const candidate of result.candidates || []) {
    console.log(`PROPOSAL_CANDIDATE id=${candidate.id} status=${candidate.status} blocking=${candidate.audit?.blocking ?? 'unknown'} lock=${candidate.proposedLockSha256 || '<none>'}`);
    for (const line of blockerLines(candidate.audit?.findings || [])) console.log(line);
    if (candidate.error) console.error(`  error=${candidate.error}`);
  }
  if (result.status !== 'PASS') process.exitCode = 2;
}
