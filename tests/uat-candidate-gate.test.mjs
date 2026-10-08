import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceFingerprint } from '../scripts/lib/source-fingerprint.mjs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const buildGate = fs.readFileSync('scripts/run-build-gate.mjs','utf8');
const builtBrowser = fs.readFileSync('scripts/run-built-browser-uat.mjs','utf8');
const verifier = fs.readFileSync('scripts/verify-uat-candidate.mjs','utf8');
const release = fs.readFileSync('.github/workflows/release-candidate.yml','utf8');
const fullSystem = fs.readFileSync('.github/workflows/full-system-simulation.yml','utf8');

test('source fingerprint is deterministic and covers executable source roots', () => {
  const a = sourceFingerprint(process.cwd());
  const b = sourceFingerprint(process.cwd());
  assert.equal(a.algorithm, 'sha256');
  assert.equal(a.value, b.value);
  assert.match(a.value, /^[0-9a-f]{64}$/);
  assert.ok(a.fileCount > 100);
});

test('source fingerprint uses Git-tracked authored files and ignores runtime-created untracked files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't360-fingerprint-git-'));
  try {
    fs.mkdirSync(path.join(root, 'apps', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'demo', 'index.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{\"name\":\"fingerprint-git-test\"}\n');
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{\"lockfileVersion\":3}\n');
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    assert.equal(spawnSync('git', ['add', 'apps/demo/index.ts', 'package.json', 'package-lock.json'], { cwd: root }).status, 0);

    const before = sourceFingerprint(root);
    fs.writeFileSync(path.join(root, 'apps', 'demo', 'runtime-evidence.json'), '{\"generated\":true}\n');
    const withRuntimeFile = sourceFingerprint(root);
    assert.equal(withRuntimeFile.value, before.value);
    assert.equal(withRuntimeFile.fileCount, before.fileCount);

    fs.writeFileSync(path.join(root, 'apps', 'demo', 'index.ts'), 'export const value = 2;\n');
    const trackedMutation = sourceFingerprint(root);
    assert.notEqual(trackedMutation.value, before.value);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source fingerprint ignores generated TypeScript and Next metadata but still tracks authored source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't360-fingerprint-'));
  try {
    fs.mkdirSync(path.join(root, 'apps', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'demo', 'index.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{\"name\":\"fingerprint-test\"}\n');
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{\"lockfileVersion\":3}\n');
    const before = sourceFingerprint(root);

    fs.writeFileSync(path.join(root, 'apps', 'demo', 'tsconfig.tsbuildinfo'), 'generated incremental metadata');
    const withBuildInfo = sourceFingerprint(root);
    assert.equal(withBuildInfo.value, before.value);
    assert.equal(withBuildInfo.fileCount, before.fileCount);

    fs.writeFileSync(path.join(root, 'apps', 'demo', 'next-env.d.ts'), 'generated Next.js type metadata');
    const withNextEnv = sourceFingerprint(root);
    assert.equal(withNextEnv.value, before.value);
    assert.equal(withNextEnv.fileCount, before.fileCount);

    fs.writeFileSync(path.join(root, 'apps', 'demo', 'authored-types.d.ts'), 'declare const authored: unique symbol;\n');
    const authoredDeclaration = sourceFingerprint(root);
    assert.notEqual(authoredDeclaration.value, before.value);

    fs.writeFileSync(path.join(root, 'apps', 'demo', 'index.ts'), 'export const value = 2;\n');
    const authoredChange = sourceFingerprint(root);
    assert.notEqual(authoredChange.value, authoredDeclaration.value);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Next workspaces use phase-isolated deterministic generated-type authority for typecheck and build', () => {
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(gitignore, /(?:^|\n)next-env\.d\.ts(?:\r?\n|$)/);
  const runner = fs.readFileSync('scripts/typecheck-next-workspace.mjs', 'utf8');
  assert.match(runner, /\["typegen"\]/);
  assert.match(runner, /resolve\(workspace, \"\.next\"\)/);
  assert.match(runner, /resolve\(workspace, \"next-env\.d\.ts\"\)/);
  assert.match(runner, /resolve\(workspace, \"tsconfig\.build\.tsbuildinfo\"\)/);
  assert.match(runner, /rmSync\(path, \{ recursive: true, force: true \}\)/);
  assert.match(runner, /\.next.*dev.*lock/s);
  assert.match(runner, /detectDevProcessFromProc/);
  assert.match(runner, /tsconfig\.build\.json/);
  assert.match(runner, /runNodeTool\("next build", nextBin, \["build"\]/);
  assert.doesNotMatch(runner, /ignoreBuildErrors/);
  for (const workspace of ['admin', 'storefront', 'pos', 'employee-portal']) {
    const workspacePkg = JSON.parse(fs.readFileSync(path.join('apps', workspace, 'package.json'), 'utf8'));
    const nextConfig = fs.readFileSync(path.join('apps', workspace, 'next.config.mjs'), 'utf8');
    const buildTsconfig = JSON.parse(fs.readFileSync(path.join('apps', workspace, 'tsconfig.build.json'), 'utf8'));
    assert.equal(workspacePkg.scripts.lint, 'node ../../scripts/typecheck-next-workspace.mjs typecheck');
    assert.equal(workspacePkg.scripts.build, 'dotenv -e ../../.env -- node ../../scripts/typecheck-next-workspace.mjs build');
    assert.match(nextConfig, /PHASE_DEVELOPMENT_SERVER/);
    assert.doesNotMatch(nextConfig, /isolatedDevBuild/, `${workspace} must not carry the key Next removed`);
    assert.match(nextConfig, /ignoreBuildErrors:\s*false/);
    assert.match(nextConfig, /verificationOwnsTypes\s*=\s*process\.env\.T360_NEXT_VERIFY\s*===\s*["']1["']/);
    assert.match(nextConfig, /isDevelopmentServer\s*&&\s*!verificationOwnsTypes/);
    assert.match(nextConfig, /["']tsconfig\.json["'][\s\S]*["']tsconfig\.build\.json["']/);
    assert.match(nextConfig, /tsconfigPath,/);
    assert.equal(buildTsconfig.extends, './tsconfig.json');
    assert.equal(Object.hasOwn(buildTsconfig, 'compilerOptions'), false);
    assert.ok(buildTsconfig.include.includes('.next/types/**/*.ts'));
    assert.equal(buildTsconfig.include.some((entry) => entry.includes('.next/dev')), false);
    assert.ok(buildTsconfig.exclude.includes('.next/dev/**/*'));
    assert.equal(fs.existsSync(path.join('apps', workspace, 'tsconfig.typecheck.json')), false);
  }
});

test('build gate records deterministic install, both Prisma profiles and six-app build', () => {
  assert.equal(pkg.scripts['build:gate'], 'node scripts/run-build-gate.mjs');
  assert.match(buildGate, /setup:dependencies/);
  assert.doesNotMatch(buildGate, /T360_BUILD_GATE_SKIP_INSTALL/);
  assert.match(buildGate, /prisma:validate:sqlite/);
  assert.match(buildGate, /prisma:validate:postgres/);
  assert.match(buildGate, /db:local:prepare/);
  assert.match(buildGate, /SQLITE_DB_SMOKE/);
  assert.match(buildGate, /db:postgres:generate/);
  assert.match(buildGate, /SIX_APP_PRODUCTION_BUILD/);
  assert.match(buildGate, /SIX_APP_PRODUCTION_BUILD', \{ NODE_ENV: 'production' \}/);
  assert.match(buildGate, /sourceIdentityBefore/);
  assert.match(buildGate, /sourceIdentityAfter/);
});

test('built browser UAT starts all six runtime processes and rejects production', () => {
  for (const workspace of ['@toko360/api','@toko360/worker','@toko360/storefront','@toko360/admin','@toko360/pos','@toko360/employee-portal']) {
    assert.match(builtBrowser, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(builtBrowser, /PROD\|PRODUCTION\|LIVE/);
  assert.match(builtBrowser, /browser-uat\.mjs/);
  assert.equal(pkg.scripts['uat:browser:built'], 'node scripts/run-built-browser-uat.mjs');
});

test('candidate verifier requires build, built-browser wrapper, browser and Stage-20 evidence bound to one source fingerprint', () => {
  assert.equal(pkg.scripts['uat:candidate:verify'], 'node scripts/verify-uat-candidate.mjs');
  assert.match(verifier, /BUILD_GATE/);
  assert.match(verifier, /BUILT_BROWSER_UAT/);
  assert.match(verifier, /built-browser-uat-latest\.json/);
  assert.match(verifier, /BROWSER_UAT/);
  assert.match(verifier, /STAGE20/);
  assert.match(verifier, /source fingerprint evidence tidak cocok/i);
  assert.match(verifier, /uatCandidate: passed/);
  assert.match(verifier, /productionReady: false/);
  assert.match(builtBrowser, /sourceIdentityBefore/);
  assert.match(builtBrowser, /sourceIdentityAfter/);
  assert.match(builtBrowser, /browserEvidence/);
  assert.match(builtBrowser, /T360_UAT_EXPECTED_HOST/);
  assert.match(builtBrowser, /T360_UAT_EXPECTED_DATABASE/);
  assert.match(builtBrowser, /menolak NODE_ENV production\/live/);
  assert.match(verifier, /target database berbeda/);
  assert.match(verifier, /browser harus dijalankan ulang setelah build/);
  assert.match(verifier, /Stage-20 harus dijalankan setelah runtime browser gate/);
  assert.match(verifier, /tepat 12 skenario kritis/);
});

test('runtime gate CI reuses full-system exact-artifact browser gate and does not label automated output as final UAT candidate', () => {
  assert.match(release, /uses: \.\/\.github\/workflows\/full-system-simulation\.yml/);
  assert.match(fullSystem, /npm run uat:browser:built/);
  assert.match(fullSystem, /T360_UAT_ADMIN_EMAIL: ci-admin@example\.invalid/);
  assert.match(fullSystem, /CORS_ORIGINS: http:\/\/localhost:3000/);
  assert.match(fullSystem, /SECRET_MASTER_KEY: [0-9a-f]{64}/);
  assert.match(fullSystem, /full-system-evidence/);
  assert.doesNotMatch(fullSystem, /T360_BUILD_GATE_SKIP_INSTALL/);
  assert.match(fullSystem, /T360_UAT_EXPECTED_HOST: localhost/);
  assert.match(fullSystem, /T360_UAT_EXPECTED_DATABASE: toko360_staging/);
  assert.doesNotMatch(release, /name: toko360-release-candidate/);
  assert.match(release, /full-system-gated-source/);
});


test('runtime target identity rejects production and locks PostgreSQL host/database', async () => {
  const { runtimeTargetIdentity } = await import('../scripts/run-built-browser-uat.mjs');
  assert.throws(() => runtimeTargetIdentity({ NODE_ENV: 'production', DATABASE_PROFILE: 'sqlite', DATABASE_URL: 'file:./data/test.db' }), /NODE_ENV production/);
  assert.throws(() => runtimeTargetIdentity({ NODE_ENV: 'staging', DATABASE_PROFILE: 'postgresql', DATABASE_URL: 'postgresql://u:p@db:5432/toko360_staging' }), /EXPECTED_HOST/);
  assert.throws(() => runtimeTargetIdentity({ NODE_ENV: 'staging', DATABASE_PROFILE: 'postgresql', DATABASE_URL: 'postgresql://u:p@prod-db:5432/toko360_staging', T360_UAT_EXPECTED_HOST: 'prod-db', T360_UAT_EXPECTED_DATABASE: 'toko360_staging' }), /production\/live/);
  const target = runtimeTargetIdentity({ NODE_ENV: 'staging', DATABASE_PROFILE: 'postgresql', DATABASE_URL: 'postgresql://u:p@staging-db:5432/toko360_staging', T360_UAT_EXPECTED_HOST: 'staging-db', T360_UAT_EXPECTED_DATABASE: 'toko360_staging' });
  assert.equal(target.profile, 'postgresql');
  assert.match(target.hostHash, /^[0-9a-f]{16}$/);
  assert.match(target.databaseHash, /^[0-9a-f]{16}$/);
});
