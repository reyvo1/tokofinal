import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/w3-security-lock-recovery.yml', import.meta.url),'utf8');
const script = fs.readFileSync(new URL('../scripts/ci-resolve-security-dependency-lock.mjs', import.meta.url),'utf8');
const runtime = fs.readFileSync(new URL('../scripts/ci-verify-security-runtime.mjs', import.meta.url),'utf8');

function assertOrder(source, patterns) {
  let previous=-1;
  for(const pattern of patterns) {
    const match=pattern.exec(source);
    assert.ok(match,`Missing gate: ${pattern}`);
    assert.ok(match.index>previous,`Gate order/replacement regression: ${pattern}`);
    previous=match.index;
  }
}

test('GitHub recovery cannot auto-push to main or gain write permissions',()=>{
  assert.match(workflow,/branches: \[ci\/w3-security-lock-recovery\]/);
  assert.match(workflow,/permissions:\s+contents: read/);
  assert.doesNotMatch(workflow,/contents:\s*write|pull-requests:\s*write|git push|gh pr create|actions\/checkout@v3/);
  assert.match(workflow,/persist-credentials: false/);
});

test('GitHub first resolves official npm then validates, npm-ci-installs, audits and runs unmodified local gate before artifact',()=>{
  assertOrder(workflow,[
    /node scripts\/ci-resolve-security-dependency-lock\.mjs/,
    /node scripts\/verify-security-lock\.mjs/,
    /cp "\$RUNNER_TEMP\/w3-security-package-lock\.json" package-lock\.json/,
    /run: npm ci --include=optional --no-fund/,
    /run: node scripts\/ci-verify-security-runtime\.mjs/,
    /run: npm run ci:audit:production/,
    /run: npm run uat:pre-github:local/,
    /git diff --exit-code -- package\.json \.github\/ci\/security-dependency-plan\.json/,
    /actions\/upload-artifact@v4/,
  ]);
  assert.doesNotMatch(workflow,/continue-on-error: true|--audit=false|--audit-level=critical|--force|--legacy-peer-deps/);
  assert.match(workflow,/if-no-files-found: error/);
});

test('Security candidate claims no GitHub exact-commit or human acceptance',()=>{
  assert.match(workflow,/exactCommitUat:\\"PENDING\\"|exactCommitUat:"PENDING"/);
  assert.match(workflow,/humanStage20:\\"PENDING\\"|humanStage20:"PENDING"/);
  assert.match(workflow,/checkpoint:process\.env\.GITHUB_SHA/);
  assert.match(workflow,/createHash\("sha256"\)/);
});

test('Isolated resolver forces ephemeral direct pins, but never writes source manifests or security lock in place',()=>{
  assert.match(script,/pinScratchSecurityDependencies\(pkg\)/);
  assert.match(script,/copyManifest\(root,temp,manifest\)/);
  assert.match(script,/\{flag:'wx',mode:0o600\}/);
  assert.doesNotMatch(script,/writeJson\(path\.join\(root,\s*'package\.json'\)/);
  assert.doesNotMatch(script,/copyManifest\(root,temp,'package-lock\.json'\)/);
});

test('negative control: reversed CI audit and npm ci gate must be detected',()=>{
  const reversed = workflow.replace('run: npm ci --include=optional --no-fund','run: __TEMP_SWAP__')
    .replace('run: npm run ci:audit:production', 'run: npm ci --include=optional --no-fund')
    .replace('run: __TEMP_SWAP__','run: npm run ci:audit:production');
  assert.throws(()=>assertOrder(reversed,[/run: npm ci --include=optional --no-fund/,/run: npm run ci:audit:production/]),/Gate order/);
});

test('real patched native image and source-map runtime is checked before the audit and UAT', () => {
  assert.match(runtime, /load\('sharp'\)/);
  assert.match(runtime, /load = fromRoot/);
  assert.match(runtime, /\.png\(\)\.toBuffer\(\)/);
  assert.match(runtime, /SourceMapGenerator/);
  assert.match(runtime, /SourceMapConsumer/);
  assert.match(runtime, /originalPositionFor/);
  assert.doesNotMatch(runtime, /catch\s*\{\s*\}|--ignore-scripts|--force/);
  assertOrder(workflow,[
    /run: npm ci --include=optional --no-fund/,
    /run: node scripts\/ci-verify-security-runtime\.mjs/,
    /run: npm run ci:audit:production/,
    /run: npm run uat:pre-github:local/,
  ]);
});
