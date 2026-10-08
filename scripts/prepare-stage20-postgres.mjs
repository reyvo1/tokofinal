import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { spawnNpmSync } from './lib/process-runner.mjs';
import { readEnvFile, validateNonProductionConfig } from './run-stage20-release-readiness.mjs';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const args = process.argv.slice(2);
const index = args.indexOf('--env-file');
const envFile = path.resolve(process.cwd(), index >= 0 ? args[index + 1] : 'stage20-release-readiness.env');
const preserveArtifact = args.includes('--preserve-artifact');
const values = { ...process.env, ...readEnvFile(envFile) };
const config = validateNonProductionConfig(values);
const env = { ...process.env, DATABASE_URL: config.databaseUrl };

function run(argsList, label) {
  const result = spawnNpmSync(argsList, { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} gagal (exit ${result.status}).`);
}

run(['run', 'prisma:validate:postgres', '-w', '@toko360/api'], 'Validasi schema PostgreSQL');
if (!preserveArtifact) run(['run', 'db:postgres:generate'], 'Generate Prisma Client PostgreSQL');

const indexResult = spawnSync(process.execPath, ['scripts/apply-stage20-critical-indexes.mjs', '--env-file', envFile], {
  cwd: process.cwd(), env, stdio: 'inherit',
});
if (indexResult.error) throw indexResult.error;
if (indexResult.status !== 0) throw new Error(`Penerapan critical index gagal (exit ${indexResult.status}).`);

if (preserveArtifact) {
  const source = sourceFingerprint(process.cwd());
  const artifact = readAndVerifyBuildArtifactManifest(process.cwd(), 'handoff/quality/build-artifact-manifest-latest.json', source.value);
  if (!artifact?.current?.id) throw new Error('Build artifact manifest belum PASS.');
  console.log(`OK: Stage-20 preserve-artifact; critical index diterapkan tanpa generate/build ulang. artifact=${artifact.current.id}`);
} else {
  run(['run', 'build', '-w', '@toko360/api'], 'Build API PostgreSQL');
  console.log('OK: Prisma PostgreSQL, critical index staging, dan API build lulus untuk Tahap 20.');
}
