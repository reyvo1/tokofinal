#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) { throw new Error(`SECURITY_LOCK_INVALID: ${message}`); }
function lockPackageName(key) {
  if (key.startsWith('node_modules/')) return key.slice(13);
  const index = key.lastIndexOf('/node_modules/');
  return index < 0 ? null : key.slice(index + 14);
}
function entriesNamed(lock, name) {
  return Object.entries(lock.packages || {}).filter(([k, v]) => lockPackageName(k) === name && v?.version);
}
export function verifySecurityLock(pkg, lock, plan, previousLock = null) {
  if (!pkg || !lock || !plan || typeof pkg !== 'object' || typeof lock !== 'object') fail('JSON structure');
  const fixes = { sharp: '0.35.5', 'source-map-js': '1.2.2' };
  if (pkg.overrides?.sharp !== fixes.sharp || pkg.overrides?.['source-map-js'] !== fixes['source-map-js']) fail('patched override versions');
  if (!Array.isArray(plan.candidates) || plan.candidates.length !== 2) fail('existing diagnostic candidates preserved');
  for (const candidate of plan.candidates) {
    for (const [name, version] of Object.entries(fixes)) {
      if (candidate.overrides?.[name] !== version) fail(`${candidate.id} still forces unsafe ${name}`);
    }
  }
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') fail('npm lockfile v3 required');
  const inspected = [];
  for (const [name, expected] of Object.entries(fixes)) {
    const matches = entriesNamed(lock, name);
    if (!matches.length) fail(`${name} absent from resolved dependency lock`);
    for (const [key, info] of matches) {
      if (info.version !== expected) fail(`${key}=${info.version}, expected ${expected}`);
      if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(String(info.integrity || ''))) fail(`${key} missing npm sha512 integrity`);
      if (!String(info.resolved || '').endsWith(`/${name}-${expected}.tgz`)) fail(`${key} tarball identity mismatch`);
      inspected.push(`${key}@${info.version}`);
    }
  }
  // A lock can declare a patched Sharp version yet omit one of the native
  // optional packages that its own published manifest requires. Such a lock
  // is unsafe for cross-platform deterministic installs (the machine used to
  // generate the lock may differ from GitHub or the deployment platform).
  // Require every published Sharp native edge to resolve to a real, pinned
  // lock entry. The npm registry, not hardcoded platform names, owns the set.
  const nativeSharp = lock.packages['node_modules/sharp'];
  if (!nativeSharp || !nativeSharp.optionalDependencies || typeof nativeSharp.optionalDependencies !== 'object') {
    fail('patched sharp must declare its optional native dependency graph');
  }
  let sharpEdges = 0, libvipsEdges = 0;
  for (const [name, version] of Object.entries(nativeSharp.optionalDependencies)) {
    if (!name.startsWith('@img/sharp-')) continue;
    const expected = name.startsWith('@img/sharp-libvips-') ? '1.3.4' : '0.35.5';
    if (version !== expected) fail(`sharp optional edge ${name}=${version}, expected ${expected}`);
    const key = `node_modules/${name}`;
    const target = lock.packages[key];
    if (!target || target.version !== expected || target.optional !== true) {
      fail(`sharp optional edge unresolved or no longer optional: ${name}@${expected}`);
    }
    if (name.startsWith('@img/sharp-libvips-')) libvipsEdges++;
    else sharpEdges++;
  }
  if (sharpEdges === 0 || libvipsEdges === 0) fail('sharp optional native graph must contain both package families');
  // The sharp version alone is insufficient: its prebuilt shared libraries ship the librsvg fix.
  const families = [['@img/sharp-', '0.35.5'], ['@img/sharp-libvips-', '1.3.4']];
  for (const [prefix, expected] of families) {
    const family = Object.entries(lock.packages).filter(([k, v]) => lockPackageName(k)?.startsWith(prefix) && (prefix !== '@img/sharp-' || !lockPackageName(k)?.startsWith('@img/sharp-libvips-')) && v?.version);
    if (!family.length) fail(`${prefix} family absent: native libraries not resolved`);
    for (const [key, info] of family) {
      if (info.version !== expected) fail(`${key}=${info.version}, expected ${expected}`);
      if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(String(info.integrity || ''))) fail(`${key} missing npm sha512 integrity`);
      if (!String(info.resolved || '').endsWith(`/${lockPackageName(key).split('/').at(-1)}-${expected}.tgz`)) fail(`${key} native tarball identity mismatch`);
      inspected.push(`${key}@${info.version}`);
    }
  }
  const sharp = lock.packages['node_modules/sharp'];
  if (!sharp || sharp.optionalDependencies?.['@img/sharp-linux-x64'] !== '0.35.5' || sharp.optionalDependencies?.['@img/sharp-libvips-linux-x64'] !== '1.3.4') {
    fail('sharp 0.35.5 native dependency metadata does not bind patched libvips');
  }
  for (const [name, version] of Object.entries(sharp.optionalDependencies || {})) {
    if (!name.startsWith('@img/sharp-')) continue;
    const expected = name.startsWith('@img/sharp-libvips-') ? '1.3.4' : '0.35.5';
    if (version !== expected) fail(`sharp optionalDependencies ${name}=${version}, expected ${expected}`);
  }
  // Prevent a fresh lock resolution from silently updating unrelated modules under this security-only scope.
  if (previousLock) {
    const oldPackages = previousLock.packages || {};
    for (const [key, original] of Object.entries(oldPackages)) {
      if (!['sharp', 'source-map-js'].includes(lockPackageName(key)) && !lockPackageName(key)?.startsWith('@img/sharp-')) continue;
      const updated = lock.packages[key];
      if (!updated) continue;
      for (const flag of ['optional', 'dev', 'devOptional', 'inBundle']) {
        if (original[flag] !== updated[flag]) fail(`dependency classification changed: ${key}.${flag}`);
      }
    }
    const allKeys = new Set([...Object.keys(oldPackages), ...Object.keys(lock.packages)]);
    for (const key of allKeys) {
      if (key === '' || lockPackageName(key) === null) continue;
      const name = lockPackageName(key);
      if (name === 'sharp' || name === 'source-map-js' || name.startsWith('@img/sharp-')) continue;
      const before = oldPackages[key]?.version ?? null;
      const after = lock.packages[key]?.version ?? null;
      if (before !== after) fail(`out-of-scope dependency resolution drift: ${key} ${before} => ${after}`);
    }
  }
  return { status: 'PASS', checked: inspected.length, fixed: fixes };
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const [pkgPath, lockPath, planPath, previousPath] = process.argv.slice(2);
    if (!pkgPath || !lockPath || !planPath) fail('expected package.json package-lock.json security-plan.json [prior-lock]');
    const read = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
    const verified = verifySecurityLock(read(pkgPath), read(lockPath), read(planPath), previousPath ? read(previousPath) : null);
    console.log(`SECURITY LOCK PASS — ${verified.checked} pinned module/native entries`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
