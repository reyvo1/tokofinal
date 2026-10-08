import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const extensions = read('apps/admin/app/modules/extensions.tsx');
const posShell = read('apps/pos/app/pos-shell.tsx');
const posCss = read('apps/pos/app/globals.css');
const posTheme = read('apps/pos/app/theme-contract.ts');
const posThemeClient = read('apps/pos/app/theme-client.tsx');
const devRunner = resolve('scripts/run-next-dev-workspace.mjs');
const packages = {
  admin: JSON.parse(read('apps/admin/package.json')),
  pos: JSON.parse(read('apps/pos/package.json')),
  storefront: JSON.parse(read('apps/storefront/package.json')),
  'employee-portal': JSON.parse(read('apps/employee-portal/package.json')),
};

test('P5 V4.8.2 keeps all ExtensionsView hooks before loading render guards', () => {
  const guard = extensions.indexOf('if (loading) return <TableSkeleton rows={4} />;');
  assert.ok(guard > 0, 'ExtensionsView loading guard missing');
  const hookPattern = /\buse(?:State|Effect|Memo|Ref|Callback|Reducer|LayoutEffect)\s*\(/g;
  const hooksAfterGuard = [...extensions.slice(guard).matchAll(hookPattern)].map((match) => match[0]);
  assert.deepEqual(hooksAfterGuard, [], `React hooks found after conditional render guard: ${hooksAfterGuard.join(', ')}`);
  assert.ok(extensions.indexOf('useEffect(() => {\n    if ((mode === \'extensions\' || mode === \'loyalty\')') < guard, 'loyalty effect must be registered before loading return');
});

test('P5 V4.8.2 removes duplicated extension bootstrap data paths so loyalty customer data cannot drift', () => {
  assert.match(extensions, /async function loadExtensionSnapshot\(\)/);
  assert.match(extensions, /readJson<LoyaltyCustomer\[]>\(`\$\{API\}\/customers\?limit=100`, token\)/);
  assert.match(extensions, /applyExtensionSnapshot\(await loadExtensionSnapshot\(\)\)/);
  assert.match(extensions, /loadExtensionSnapshot\(\)\.then\(\(snapshot\) => \{ if \(!cancelled\) applyExtensionSnapshot\(snapshot\); \}\)/);
  assert.equal((extensions.match(/\/customers\?limit=100/g) ?? []).length, 1, 'customer bootstrap endpoint must have one canonical loader');
});

test('P5 V4.8.2 makes POS light identity explicit and rejects authored dark-root regressions', () => {
  assert.match(posShell, /data-pos-theme=\{theme\}/);
  assert.match(posShell, /useT360Theme\(\)/);
  assert.match(posTheme, /T360_THEME_DEFAULT: T360Theme = 'light'/);
  assert.match(posTheme, /toko360:ui-theme:v411:pos/);
  assert.match(posThemeClient, /window\.localStorage\.getItem\(T360_THEME_STORAGE_KEY\) === 'dark' \? 'dark' : T360_THEME_DEFAULT/);
  // The light default is preserved, but it must come from .posV4 in the stylesheet rather than a
  // Tailwind utility on the themed root: `bg-slate-100 text-slate-950` on <main> outranks every
  // [data-theme='dark'] rule by specificity, so it pinned the POS light forever and made the
  // theme toggle a no-op. .posV4 still carries the light gradient, asserted just below.
  const posRootTag = posShell.slice(posShell.indexOf('<main'), posShell.indexOf('>', posShell.indexOf('<main')));
  assert.doesNotMatch(posRootTag, /\bbg-slate-\d{2,3}\b/);
  assert.doesNotMatch(posRootTag, /\btext-slate-950\b/);
  assert.match(posShell, /posV4 min-h-screen min-w-0/);
  assert.match(posCss, /\.posV4\{[^}]*linear-gradient\(180deg,#f8fafc/i);
  const root = posCss.match(/\.posV4\{([^}]*)\}/s)?.[1] ?? '';
  const background = root.match(/background:([^;]+)/i)?.[1] ?? '';
  assert.doesNotMatch(background, /#020617|#0f172a|#111827|#030712/i);
});

test('P5 V4.8.2 routes all four Next dev workspaces through the fresh isolated-dev runner', () => {
  const expected = { admin: 3001, pos: 3002, storefront: 3000, 'employee-portal': 3003 };
  for (const [app, port] of Object.entries(expected)) {
    assert.equal(packages[app].scripts.dev, `dotenv -e ../../.env -- node ../../scripts/run-next-dev-workspace.mjs ${port}`);
  }
  const source = read('scripts/run-next-dev-workspace.mjs');
  assert.match(source, /resolve\(workspace, '\.next', 'dev'\)/);
  assert.match(source, /rmSync\(generatedDev, \{ recursive: true, force: true \}\)/);
  assert.match(source, /T360_NEXT_VERIFY: '0'/);
  assert.match(source, /installedNext\.version !== declaredNext/);
});

test('fresh isolated-dev runner deletes stale .next/dev before invoking Next', () => {
  const root = mkdtempSync(join(tmpdir(), 't360-next-dev-'));
  try {
    mkdirSync(join(root, 'node_modules', 'next', 'dist', 'bin'), { recursive: true });
    mkdirSync(join(root, '.next', 'dev'), { recursive: true });
    writeFileSync(join(root, '.next', 'dev', 'stale.css'), 'stale');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { next: '16.3.5' } }));
    writeFileSync(join(root, 'node_modules', 'next', 'package.json'), JSON.stringify({ name: 'next', version: '16.3.5' }));
    writeFileSync(join(root, 'node_modules', 'next', 'dist', 'bin', 'next.js'), `
      const fs = require('node:fs');
      const path = require('node:path');
      if (fs.existsSync(path.join(process.cwd(), '.next', 'dev'))) process.exit(71);
      if (process.env.T360_NEXT_VERIFY !== '0') process.exit(72);
      if (process.argv[2] !== 'dev' || process.argv[3] !== '-p' || process.argv[4] !== '3999') process.exit(73);
      console.log('FAKE_NEXT_DEV_FRESH=PASS');
    `);
    const result = spawnSync(process.execPath, [devRunner, '3999'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /remove stale isolated dev output/);
    assert.match(result.stdout, /FAKE_NEXT_DEV_FRESH=PASS/);
    assert.equal(existsSync(join(root, '.next', 'dev')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
