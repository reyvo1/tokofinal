import path from 'node:path';
import process from 'node:process';
import { spawnNpmSync } from './lib/process-runner.mjs';
import { readEnvFile, validateNonProductionConfig } from './run-tenant-http-db-integration.mjs';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { readAndVerifyBuildArtifactManifest } from './lib/build-artifact-identity.mjs';

const args = process.argv.slice(2);
const index = args.indexOf('--env-file');
const envFile = path.resolve(process.cwd(), index >= 0 ? args[index + 1] : 'stage19-integration.env');
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
if (preserveArtifact) {
  const source = sourceFingerprint(process.cwd());
  const artifact = readAndVerifyBuildArtifactManifest(process.cwd(), 'handoff/quality/build-artifact-manifest-latest.json', source.value);
  const apiDist = path.resolve(process.cwd(), 'apps/api/dist/main.js');
  if (!artifact?.current?.id) throw new Error('Build artifact manifest belum PASS.');
  if (!process.env.CI && !process.env.T360_ALLOW_PRESERVE_ARTIFACT) console.warn('WARN: --preserve-artifact digunakan di luar CI; pastikan Prisma Client PostgreSQL berasal dari build gate yang sama.');
  console.log(`OK: Stage-19 preserve-artifact; tidak generate/build ulang API. artifact=${artifact.current.id}`);
} else {
  run(['run', 'db:postgres:generate'], 'Generate Prisma Client PostgreSQL');
  run(['run', 'build', '-w', '@toko360/api'], 'Build API PostgreSQL');
  console.log('OK: Schema PostgreSQL valid, Prisma Client PostgreSQL tergenerate, dan API build lulus.');
}
