#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnNpm } from './lib/process-runner.mjs';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const evidencePath = path.resolve(root, process.env.T360_LOCAL_CANDIDATE_EVIDENCE || 'handoff/quality/local-candidate-gate-latest.json');

export const localCandidateSteps = [
  { id: 'MIGRATION_REHEARSAL_SQLITE', args: ['run', 'db:migrations:rehearse:sqlite'] },
  { id: 'QUALITY_FULL_SQLITE', args: ['run', 'quality:full'] },
  { id: 'CRITICAL_UAT_COVERAGE', args: ['run', 'ci:uat:coverage'] },
];

function rejectProductionLikeEnvironment(env = process.env) {
  const markers = [env.NODE_ENV, env.T360_ENVIRONMENT, env.T360_UAT_ENVIRONMENT]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  if (markers.some((value) => /(^|[-_.])(prod|production|live)([-_.]|$)/.test(value))) {
    throw new Error('Local candidate gate menolak environment production/live.');
  }

  const profile = String(env.DATABASE_PROFILE || '').toLowerCase();
  const databaseUrl = String(env.DATABASE_URL || '');
  if (profile === 'postgresql' || /^postgres(?:ql)?:/i.test(databaseUrl)) {
    throw new Error('Local candidate gate wajib memakai SQLite scratch/local. PostgreSQL runtime validation dijalankan di GitHub Full System Simulation.');
  }
  if (databaseUrl && !/^file:/i.test(databaseUrl)) {
    throw new Error('DATABASE_URL local candidate tidak dikenali; gunakan SQLite file: URL.');
  }
}

function runNpm(args, id, evidence) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawnNpm(args, { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', (error) => {
      evidence.steps.push({ id, command: `npm ${args.join(' ')}`, status: 'FAIL', durationMs: Date.now() - started, error: error.message });
      reject(error);
    });
    child.once('close', (code) => {
      const passed = code === 0;
      evidence.steps.push({ id, command: `npm ${args.join(' ')}`, status: passed ? 'PASS' : 'FAIL', exitCode: code ?? 1, durationMs: Date.now() - started });
      if (passed) resolve();
      else reject(new Error(`${id} gagal dengan exit code ${code ?? 1}.`));
    });
  });
}

function readJson(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return null;
  try { return JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch { return null; }
}

export async function runLocalCandidateGate() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const sourceBefore = sourceFingerprint(root);
  const evidence = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'FAIL',
    sourceIdentityBefore: sourceBefore,
    sourceIdentityAfter: null,
    steps: [],
    criticalUatCoverage: null,
    nextGate: 'GITHUB_FULL_SYSTEM_SIMULATION',
    humanStage20Uat: 'PENDING',
    error: null,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');

  try {
    rejectProductionLikeEnvironment(process.env);
    for (const step of localCandidateSteps) await runNpm(step.args, step.id, evidence);

    const coverage = readJson('handoff/quality/github-critical-uat-coverage-latest.json');
    if (!coverage || coverage.status !== 'PASS' || coverage.scenarioCount !== 12) {
      throw new Error('Critical UAT coverage evidence tidak PASS 12/12 setelah local candidate gate.');
    }
    if (coverage.sourceIdentity?.value !== sourceBefore.value) {
      throw new Error('Critical UAT coverage evidence berasal dari source fingerprint berbeda.');
    }
    evidence.criticalUatCoverage = {
      status: coverage.status,
      scenarioCount: coverage.scenarioCount,
      sourceFingerprint: coverage.sourceIdentity?.value || null,
    };

    evidence.sourceIdentityAfter = sourceFingerprint(root);
    if (evidence.sourceIdentityAfter.value !== sourceBefore.value) {
      throw new Error(`Source fingerprint berubah selama local candidate gate. before=${sourceBefore.value} after=${evidence.sourceIdentityAfter.value}`);
    }
    evidence.status = 'PASS';
    return evidence;
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.sourceIdentityAfter = sourceFingerprint(root);
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runLocalCandidateGate()
    .then((evidence) => {
      console.log(`LOCAL CANDIDATE GATE PASS — source ${evidence.sourceIdentityAfter.value}`);
      console.log('Next authoritative gate: GitHub Full System Simulation. Human Stage-20 UAT remains PENDING.');
    })
    .catch((error) => {
      console.error(`LOCAL CANDIDATE GATE FAIL — ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
}
