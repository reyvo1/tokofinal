// Nest dependency resolution happens at START, not at compile time.
//
// This file exists because the entire Toko360 API failed to boot while `tsc`, the full test suite and
// the six-app production build were all green. BranchContinuityModule injects SecretProtectorService
// without importing the module that provides it; PlatformModule is not @Global, so Nest could not
// resolve it and threw UnknownDependenciesException at startup. No gate in this repo sees that, because
// nothing in the suite boots the app.
//
// A source-level assertion is still worth having, but it is NOT the proof — the boot check below is.
// The negative control models the exact omission.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Every module, found by scanning rather than a hand-kept list, so a new module is covered the day it
// is written instead of the day someone remembers this file.
function modules(dir = 'apps/api/src') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...modules(full));
    else if (entry.name.endsWith('.module.ts')) out.push(full);
  }
  return out;
}

const moduleFiles = modules();
assert.ok(moduleFiles.length > 20, `expected the real module set, found ${moduleFiles.length}`);


/** Every file under a repo-relative directory, recursively, as repo-relative paths. */
function walk(dir) {
  const out = [];
  const base = path.join(ROOT, dir);
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name)));
    else out.push(`${dir}/${entry.name}`);
  }
  return out;
}

/** Locate a guard class's source file by name, e.g. JwtAuthGuard -> auth/jwt-auth.guard.ts. */
function findGuardFile(guardName) {
  // Match on the guard class name appearing inside any *.guard.ts, rather than guessing the filename.
  // Guessing breaks on names like `BranchSyncAuthGuard` -> `branch-sync-auth.guard.ts` vs the real
  // `branch-sync-auth.guard.ts` vs `branch-sync.guard.ts`; searching the contents cannot be wrong.
  const files = walk('apps/api/src').filter((f) => f.endsWith('.guard.ts'));
  return files.find((f) => read(f).includes(`class ${guardName}`)) ?? null;
}

test('every service that injects SecretProtectorService has a module that provides it', () => {
  // Walk services → their sibling module → that module's imports. A service injected without a module
  // that provides it cannot boot, and the failure names a class the author did not touch.
  const platformExports = read('apps/api/src/platform/platform.module.ts');
  assert.match(platformExports, /providers: \[[^\]]*SecretProtectorService/, 'PlatformModule must provide it');
  assert.match(platformExports, /exports: \[[^\]]*SecretProtectorService/, 'and export it');
  assert.doesNotMatch(platformExports, /@Global/, 'it is deliberately not global, so each consumer must import it');

  const offenders = [];
  let providersChecked = 0;
  for (const file of moduleFiles) {
    const source = read(file);
    // Skip the module that PROVIDES the service. platform.module.ts imports its own
    // SecretProtectorService because that is where the class lives; it is the definition, not a
    // consumer, and flagging it would make the test unfixable.
    if (/\bSecretProtectorService\b/.test(source) && /providers: \[[^\]]*SecretProtectorService/.test(source)) continue;
    // Resolve the service file from the import specifier itself. Deriving the name from the class and
    // guessing the path made this scanner silently blind: every lookup missed, the catch swallowed the
    // ENOENT, and the test passed against the exact bug it was written for. An unreadable import is now
    // an error, never a silent "no".
    const serviceImports = [...source.matchAll(/import \{ ([^}]+) \} from '(\.[^']+)';/g)];
    const needsSecret = serviceImports.some(([, names, specifier]) => {
      // Some modules write the specifier as './foo.service', others as './foo'. Normalise before
      // appending, or the lookup lands on 'foo.service.service.ts'.
      const base = specifier.replace(/\.service$/, '');
      const filePath = path.resolve(path.dirname(path.join(ROOT, file)), `${base}.service.ts`);
      const names2 = names.split(',').map((n) => n.trim().replace(/\.service$/, '')).filter((n) => n.endsWith('Service'));
      if (names2.length === 0) return false;
      const body = fs.readFileSync(filePath, 'utf8'); // deliberately not in a try/catch
      providersChecked++;
      // Look for the PROVIDER inside the constructor, not for the class that was imported. The two
      // names differ: the module imports BranchContinuityService, and that service injects
      // SecretProtectorService. Matching the imported name here found nothing and reported "no
      // dependency", which is how the original bug slipped past this test.
      const constructor = (body.match(/constructor\([^)]*\)/) || [''])[0];
      return /\bSecretProtectorService\b/.test(constructor);
    });
    if (!needsSecret) continue;
    if (!/imports: \[[^\]]*PlatformModule/.test(source)) {
      offenders.push(`${file} injects SecretProtectorService but does not import PlatformModule`);
    }
  }
  assert.ok(providersChecked > 10, `the scanner must actually resolve provider files, resolved ${providersChecked}`);
  assert.deepEqual(offenders, [], `modules that cannot boot:\n${offenders.join('\n')}`);
});

test('the branch-continuity module imports what its services inject', () => {
  // Named explicitly as well, because the scanner above reports a list and this names the reason.
  const module = read('apps/api/src/branch-continuity/branch-continuity.module.ts');
  const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  for (const [service, file] of [['BranchContinuityService', 'branch-continuity'], ['BranchTransferService', 'branch-transfer']]) {
    const source = read(`apps/api/src/branch-continuity/${file}.service.ts`);
    const injected = [...source.matchAll(/constructor\([^)]*\)/g)]
      .flatMap((m) => [...m[0].matchAll(/private readonly (\w+)/g)].map((x) => x[1]));
    for (const dependency of injected) {
      if (dependency === 'PrismaService') {
        assert.match(module, /PrismaModule/, `${service} injects PrismaService`);
        continue;
      }
      if (dependency === 'SecretProtectorService') {
        assert.match(module, /PlatformModule/, `${service} injects SecretProtectorService, so BranchContinuityModule must import PlatformModule`);
      }
      assert.ok(!/SecretProtector/.test(kebab(dependency)), 'sanity: the file name derivation is for the two known providers only');
    }
  }
});

/**
 * A controller that re-declares a globally-registered guard breaks the boot in a way nothing else sees.
 *
 * The same class of failure as the SecretProtectorService omission above, reached from the other
 * direction. `JwtAuthGuard` is registered once, globally, via `APP_GUARD` in app.module. Adding
 * `@UseGuards(JwtAuthGuard)` to a controller tells Nest to construct a SECOND instance scoped to that
 * controller's own module — and it cannot, because `JwtAuthGuard` injects `ApiKeysService`, which
 * `AuthModule` exports but the new module never imports:
 *
 *     UnknownDependenciesException: Nest can't resolve dependencies of the JwtAuthGuard
 *     (Reflector, JwtService, PrismaService, ?). ... argument ApiKeysService at index [3]
 *
 * This was found by actually booting the API, not by any gate: tsc passed, the whole suite passed,
 * and the six-app build passed. Only starting the process surfaced it.
 *
 * So the rule is the inverse of the rule above: a guard that is already global must NOT be repeated
 * per controller, and a module that legitimately needs a locally-scoped guard must import whatever
 * that guard injects.
 */
test('no controller re-declares a guard that app.module already registers globally', () => {
  const appModule = read('apps/api/src/app.module.ts');
  // Discover the globally-registered guards instead of hardcoding a list, so adding one to
  // app.module automatically extends this check.
  const globalGuards = [...appModule.matchAll(/provide:\s*APP_GUARD,\s*useClass:\s*(\w+)/g)].map((m) => m[1]);
  assert.ok(globalGuards.includes('JwtAuthGuard'), 'JwtAuthGuard is expected to be global; update this test if that changes');

  const offenders = [];
  for (const file of walk('apps/api/src')) {
    if (!file.endsWith('.controller.ts')) continue;
    const text = read(file);
    for (const guard of globalGuards) {
      // Strip comments so the explanatory note in these files is not read as a violation.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (code.includes(`@UseGuards(${guard})`)) offenders.push(`${file}: @UseGuards(${guard})`);
    }
  }
  assert.deepEqual(offenders, [],
    'these controllers re-declare a global guard, forcing Nest to build a second instance that this module cannot satisfy');
});

test('every module that uses a locally-scoped guard imports that guard\'s dependencies', () => {
  // The other half of the rule: if a guard is NOT global and a controller does declare it, the
  // module must be able to construct it. Checked structurally — a guard's constructor parameters are
  // resolved from its own module.
  const globalGuards = new Set(
    [...read('apps/api/src/app.module.ts').matchAll(/provide:\s*APP_GUARD,\s*useClass:\s*(\w+)/g)].map((m) => m[1]),
  );
  const problems = [];
  for (const file of walk('apps/api/src')) {
    if (!file.endsWith('.controller.ts')) continue;
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const match of code.matchAll(/@UseGuards\(([A-Za-z0-9_]+)\)/g)) {
      const guard = match[1];
      if (globalGuards.has(guard)) continue;
      const guardFile = findGuardFile(guard);
      if (!guardFile) { problems.push(`${file}: cannot locate ${guard}.ts to check its imports`); continue; }
      const moduleFile = file.replace(/\.controller\.ts$/, '.module.ts');
      if (!fs.existsSync(path.join(ROOT, moduleFile))) { problems.push(`${file}: uses ${guard} but has no sibling module`); continue; }
      const guardText = read(guardFile);
      const injected = [...guardText.matchAll(/constructor\(([\s\S]*?)\)\s*\{/g)]
        .flatMap((m) => [...m[1].matchAll(/(?:private|public|protected|readonly)?\s*\w*\s*:\s*(\w+Service|\w+Repository)/g)].map((x) => x[1]));
      const moduleText = read(moduleFile);
      for (const dependency of new Set(injected)) {
        const providedElsewhere = new RegExp(`${dependency}[,\\s}]`).test(
          // Either the module lists it as a provider, or it imports a module that does.
          moduleText.slice(moduleText.indexOf('@Module(')),
        );
        if (!providedElsewhere) problems.push(`${moduleFile}: ${guard} injects ${dependency}, which the module does not provide`);
      }
    }
  }
  assert.deepEqual(problems, [], 'a locally-scoped guard whose dependencies the module cannot supply fails at BOOT');
});
