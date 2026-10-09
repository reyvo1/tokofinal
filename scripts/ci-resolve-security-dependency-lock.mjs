#!/usr/bin/env node
/**
 * Resolve security-only npm lock changes in a fresh isolated workspace graph.
 * Never guesses integrity strings, modifies the repository or bypasses npm ci/audit.
 * Intended for an environment with official npm registry connectivity.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeSecurityLock } from './merge-npm-security-lock.mjs';
import { verifySecurityLock } from './verify-security-lock.mjs';

const sourcePath = fileURLToPath(import.meta.url);
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(obj,null,2)+'\n'); }
function copyManifest(root, temp, rel) {
  const source = path.join(root, rel);
  if (!fs.existsSync(source)) throw Error(`SECURITY_RESOLVE_INVALID: missing manifest ${rel}`);
  const target = path.join(temp, rel);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(source,target);
}
function manifests(root) {
  const result=['package.json'];
  for(const section of ['apps','packages']) {
    const top=path.join(root,section);
    if(!fs.existsSync(top)) continue;
    for(const name of fs.readdirSync(top).sort()) {
      if(fs.statSync(path.join(top,name)).isDirectory() && fs.existsSync(path.join(top,name,'package.json')))
        result.push(`${section}/${name}/package.json`);
    }
  }
  return result;
}
function canonicalTarget(target) {
  const missing = [];
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw Error('SECURITY_RESOLVE_INVALID: output parent cannot be resolved');
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...missing);
}
function assertExternalNewOutput(root, output) {
  const sourceRoot = fs.realpathSync(root);
  const target = canonicalTarget(output);
  const relative = path.relative(sourceRoot, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw Error('SECURITY_RESOLVE_INVALID: candidate output must be outside the source repository');
  }
  if (fs.existsSync(output) || fs.existsSync(target)) {
    throw Error('SECURITY_RESOLVE_INVALID: candidate output already exists; refusing overwrite');
  }
}
/**
 * The production graph keeps sharp optional via Next.js. npm's lockfile-only
 * resolver is allowed to omit optional descendants when regenerating a lock;
 * the previous installer incorrectly assumed they must reappear. Force both
 * security targets as direct dependencies in the SCRATCH resolver manifest,
 * then transplant only the authentic registry-resolved security subgraph.
 * Never copy these temporary edges to the project manifest or root lock entry.
 */
export function pinScratchSecurityDependencies(manifest) {
  const result = structuredClone(manifest);
  const desired = {sharp:'0.35.5','source-map-js':'1.2.2'};
  if (result.overrides?.sharp !== desired.sharp || result.overrides?.['source-map-js'] !== desired['source-map-js']) {
    throw Error('SECURITY_RESOLVE_INVALID: scratch pins require approved root security overrides');
  }
  result.dependencies = {...result.dependencies, ...desired};
  for (const key of Object.keys(desired)) {
    // A duplicate direct declaration across sections is rejected by npm in
    // some versions and may silently shadow a security pin.
    if (result.devDependencies) delete result.devDependencies[key];
    if (result.optionalDependencies) delete result.optionalDependencies[key];
  }
  return result;
}
function validateManifestGraph(root) {
  const pkg=readJson(path.join(root,'package.json'));
  const values={sharp:'0.35.5','source-map-js':'1.2.2'};
  for(const [name,expected] of Object.entries(values)) if(pkg.overrides?.[name]!==expected) throw Error(`SECURITY_RESOLVE_INVALID: override ${name} must be ${expected}`);
  return pkg;
}

export function createSecurityLockCandidate({root, output, npmCommand='npm', env=process.env, allowLocalTestRegistry=false}={}) {
  if(!root || !output) throw Error('SECURITY_RESOLVE_INVALID: root and output are required');
  root=path.resolve(root); output=path.resolve(output);
  assertExternalNewOutput(root,output);
  const pkg=validateManifestGraph(root);
  const old=readJson(path.join(root,'package-lock.json'));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tokofinal-w3-lock-resolve-'));
  try {
    for(const manifest of manifests(root))copyManifest(root,temp,manifest);
    // Do not rely on Next.js optional sharp returning during lock-only npm
    // resolution. Direct pins are SCRATCH ONLY; merge retains original root
    // manifest/lock metadata, and npm ci later verifies graph consistency.
    writeJson(path.join(temp,'package.json'),pinScratchSecurityDependencies(pkg));
    // Deliberately DO NOT copy the vulnerable lock. npm must resolve all
    // native platform artifacts from actual registry metadata.
    const command=spawnSync(npmCommand,['install','--package-lock-only','--include=optional','--ignore-scripts','--no-audit','--no-fund'],{
      cwd:temp,env:{...env,CI:'true'},encoding:'utf8',maxBuffer:24*1024*1024,timeout:180000,
    });
    if(command.error || command.status!==0) throw Error(`SECURITY_RESOLVE_NPM_FAIL: npm lock generation failed (exit=${command.status}, error=${command.error?.code||'none'}): ${(command.stderr||'').slice(-1600)}`);
    const fresh=readJson(path.join(temp,'package-lock.json'));
    const merged=mergeSecurityLock(old,fresh,{allowLocalTestRegistry});
    const plan=readJson(path.join(root,'.github/ci/security-dependency-plan.json'));
    verifySecurityLock(pkg,merged.lock,plan,old);
    // Only after all invariants hold do we emit a candidate file. The caller
    // must run npm ci + audit + official source/UAT gates in the actual repo.
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.writeFileSync(output, JSON.stringify(merged.lock,null,2)+'\n', {flag:'wx',mode:0o600});
    return {changed:merged.changes.length, output};
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1])===sourcePath) {
  try {
    const [root,output]=process.argv.slice(2);
    const result=createSecurityLockCandidate({root,output});
    console.log(`SECURITY LOCK CANDIDATE CREATED — ${result.changed} security nodes; npm ci/audit and full UAT still mandatory`);
  } catch(e) { console.error(e instanceof Error?e.message:String(e));process.exitCode=1; }
}
