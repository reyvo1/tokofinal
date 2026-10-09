import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function packageName(lockKey) {
  const marker = '/node_modules/';
  const offset = lockKey.lastIndexOf(marker);
  if (offset >= 0) return lockKey.slice(offset + marker.length);
  return lockKey.startsWith('node_modules/') ? lockKey.slice('node_modules/'.length) : null;
}
function securityPackage(name) {
  return name === 'sharp' || name === 'source-map-js' || name?.startsWith('@img/sharp-');
}
function reject(message) { throw new Error(`SECURITY_LOCK_MERGE_INVALID: ${message}`); }

/**
 * Graft exact npm-resolved security subgraph from a FRESH fully resolved lock
 * onto the existing lock, preserving unrelated package identities.
 * An actual npm ci and audit must still run before any source adoption.
 */
export function mergeSecurityLock(original, fresh, { allowLocalTestRegistry = false } = {}) {
  if (original?.lockfileVersion !== 3 || fresh?.lockfileVersion !== 3 ||
      !original.packages || !fresh.packages) reject('expected two npm lockfile v3 graphs');
  const result = structuredClone(original);
  const names = new Set([...Object.keys(original.packages), ...Object.keys(fresh.packages)]
    .filter(k => securityPackage(packageName(k))));
  if (!names.has('node_modules/sharp') || !names.has('node_modules/source-map-js')) {
    reject('the baseline must contain sharp and source-map-js');
  }
  const changes = [];
  for (const key of names) {
    const previous = original.packages[key];
    const current = fresh.packages[key];
    if (!current) {
      // Removed optional native platform from a new genuine manifest: do not retain old packages.
      if (previous) { delete result.packages[key];changes.push({key,from:previous.version,to:null}); }
      continue;
    }
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(current.integrity ?? '') ||
        !(String(current.resolved || '').startsWith('https://registry.npmjs.org/') || (allowLocalTestRegistry && String(current.resolved || '').startsWith('http://127.0.0.1:')))) {
      reject(`fresh graph lacks official tarball/integrity for ${key}`);
    }
    const resolved = structuredClone(current);
    // The isolated resolver declares Sharp directly so npm fetches its optional
    // native graph. That TEMPORARY declaration must never convert a package
    // that was optional in the real product into a required production package.
    // Lockfile placement flags belong to the original graph, not the scratch graph.
    for (const flag of ['optional', 'dev', 'devOptional', 'inBundle']) {
      if (previous && Object.hasOwn(previous, flag)) resolved[flag] = previous[flag];
      else delete resolved[flag];
    }
    if (!previous && packageName(key)?.startsWith('@img/sharp-')) resolved.optional = true;
    result.packages[key] = resolved;
    if (JSON.stringify(previous) !== JSON.stringify(resolved)) changes.push({key,from:previous?.version ?? null,to:resolved.version});
  }
  const expectations = new Map([['sharp','0.35.5'],['source-map-js','1.2.2']]);
  for (const [key,pkg] of Object.entries(result.packages)) {
    const name = packageName(key);
    if (expectations.has(name) && pkg.version !== expectations.get(name)) reject(`${key}=${pkg.version} expected ${expectations.get(name)}`);
    if (name?.startsWith('@img/sharp-')) {
      const expected = name.startsWith('@img/sharp-libvips-') ? '1.3.4' : '0.35.5';
      if (pkg.version !== expected) reject(`${key}=${pkg.version} expected ${expected}`);
    }
  }
  if (!result.packages['node_modules/sharp'] || !result.packages['node_modules/source-map-js']) reject('required security packages absent');
  // A fresh lock produced with scratch direct dependencies must not silently
  // drop platform-specific optional packages from Sharp. npm can omit them on
  // some hosts; detect the missing edges BEFORE emitting the candidate rather
  // than handing an un-installable lock to a different CI platform.
  const nativeSharp = result.packages['node_modules/sharp'];
  if (!nativeSharp?.optionalDependencies || typeof nativeSharp.optionalDependencies !== 'object') reject('sharp optional dependency metadata absent');
  for (const [name, version] of Object.entries(nativeSharp.optionalDependencies)) {
    if (!name.startsWith('@img/sharp-')) continue;
    const target = result.packages[`node_modules/${name}`];
    if (!target || target.version !== version || target.optional !== true) {
      reject(`sharp optional native edge missing/wrong classification: ${name}@${version}`);
    }
  }
  if (result.packages['node_modules/sharp'].optionalDependencies?.['@img/sharp-libvips-linux-x64'] !== '1.3.4') reject('patched libvips not declared');
  // npm ci remains authoritative about transitive requirements, dependency edges,
  // and platform-specific optional packages. Do not make up npm metadata.
  for (const [key,originalPkg] of Object.entries(original.packages)) {
    if (!securityPackage(packageName(key)) && JSON.stringify(result.packages[key]) !== JSON.stringify(originalPkg)) {
      reject(`unrelated source changed: ${key}`);
    }
  }
  return {lock:result,changes};
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [baseFile,freshFile,output] = process.argv.slice(2);
  if (!baseFile || !freshFile || !output) throw Error('usage: merge-npm-security-lock.mjs OLD_LOCK CLEAN_NPM_LOCK OUTPUT_LOCK');
  const merge = mergeSecurityLock(JSON.parse(fs.readFileSync(baseFile)),JSON.parse(fs.readFileSync(freshFile)));
  fs.writeFileSync(output,JSON.stringify(merge.lock,null,2)+'\n');
  console.log(`SECURITY LOCK MERGE PREPARED — changed nodes ${merge.changes.length}; real npm ci/audit required`);
}
