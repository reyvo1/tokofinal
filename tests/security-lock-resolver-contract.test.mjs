import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeSecurityLock} from '../scripts/merge-npm-security-lock.mjs';
import {verifySecurityLock} from '../scripts/verify-security-lock.mjs';
import {createSecurityLockCandidate,pinScratchSecurityDependencies} from '../scripts/ci-resolve-security-dependency-lock.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const plan=JSON.parse(fs.readFileSync(path.join(root,'.github/ci/security-dependency-plan.json')));
const checkIntegrity='sha512-'+Buffer.from('tests-only-not-real-integrity').toString('base64');
const entry=(name,version,other={})=>({version,resolved:`https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`,integrity:checkIntegrity,...other});
const old=()=>({lockfileVersion:3,packages:{'':{},'node_modules/other':entry('other','9.1.0'),'node_modules/sharp':entry('sharp','0.35.4',{optional:true}), 'node_modules/source-map-js':entry('source-map-js','1.2.1'),'node_modules/@img/sharp-linux-x64':entry('@img/sharp-linux-x64','0.35.4',{optional:true}), 'node_modules/@img/sharp-libvips-linux-x64':entry('@img/sharp-libvips-linux-x64','1.3.3',{optional:true})}});
const fresh=()=>({lockfileVersion:3,packages:{'':{},'node_modules/other':entry('other','99.9.9'), 'node_modules/sharp':entry('sharp','0.35.5',{optionalDependencies:{'@img/sharp-linux-x64':'0.35.5','@img/sharp-libvips-linux-x64':'1.3.4'}}), 'node_modules/source-map-js':entry('source-map-js','1.2.2'),'node_modules/@img/sharp-linux-x64':entry('@img/sharp-linux-x64','0.35.5'),'node_modules/@img/sharp-libvips-linux-x64':entry('@img/sharp-libvips-linux-x64','1.3.4')}});

test('security override exact versions and both audit proposals are consistent',()=>{
 for(const [name,version] of Object.entries({sharp:'0.35.5','source-map-js':'1.2.2'})){
  assert.equal(pkg.overrides[name],version);
  for(const candidate of plan.candidates)assert.equal(candidate.overrides[name],version);
 }
});
test('new source explicitly uses fresh scratch lock from all workspace manifests and no lock pruning',()=>{
 const code=fs.readFileSync(path.join(root,'scripts/ci-resolve-security-dependency-lock.mjs'),'utf8');
 assert.match(code,/--package-lock-only/); assert.match(code,/--include=optional/);assert.match(code,/for\(const manifest of manifests\(root\)\)/);
 assert.match(code,/pinScratchSecurityDependencies\(pkg\)/);
 assert.doesNotMatch(code,/copyManifest\(root,temp,'package-lock\.json'\)/);
 assert.match(code,/verifySecurityLock\(pkg,merged.lock,plan,old\)/);
 assert.match(code,/fs\.writeFileSync\(output, JSON\.stringify\(merged\.lock/);assert.match(code,/flag:'wx'/);
});
test('merger preserves unrelated prior dependency identities while upgrading native + transitive graph',()=>{
 const result=mergeSecurityLock(old(),fresh());
 assert.equal(result.lock.packages['node_modules/sharp'].version,'0.35.5');
 assert.equal(result.lock.packages['node_modules/source-map-js'].version,'1.2.2');
 assert.equal(result.lock.packages['node_modules/other'].version,'9.1.0');
 assert.equal(result.lock.packages['node_modules/@img/sharp-libvips-linux-x64'].version,'1.3.4');
});
test('merger keeps original optional/production classification instead of inheriting scratch direct pins',()=>{
 const baseline=old();
 baseline.packages['node_modules/sharp'].optional=true;
 baseline.packages['node_modules/@img/sharp-linux-x64'].optional=true;
 baseline.packages['node_modules/@img/sharp-libvips-linux-x64'].optional=true;
 const scratch=fresh();
 // Real npm removes the optional marker when the scratch manifest declares
 // sharp directly to force npm to resolve its native packages.
 delete scratch.packages['node_modules/sharp'].optional;
 delete scratch.packages['node_modules/@img/sharp-linux-x64'].optional;
 const merged=mergeSecurityLock(baseline,scratch).lock;
 assert.equal(merged.packages['node_modules/sharp'].optional,true);
 assert.equal(merged.packages['node_modules/@img/sharp-linux-x64'].optional,true);
 assert.equal(merged.packages['node_modules/@img/sharp-libvips-linux-x64'].optional,true);
 assert.equal(merged.packages['node_modules/source-map-js'].optional,undefined);
 const invalid=structuredClone(merged);
 delete invalid.packages['node_modules/sharp'].optional;
 assert.throws(()=>verifySecurityLock(pkg,invalid,plan,baseline),/dependency classification changed/);
});

test('merger rejects missing native integrity and stale sharp',()=>{
 const invalid=fresh();invalid.packages['node_modules/@img/sharp-linux-x64'].integrity='';
 assert.throws(()=>mergeSecurityLock(old(),invalid),/official tarball\/integrity/);
 const stale=fresh();stale.packages['node_modules/sharp'].version='0.35.4';
 assert.throws(()=>mergeSecurityLock(old(),stale),/expected 0\.35\.5/);
});
test('native platform closure rejects missing or required Sharp binaries before candidate emission', () => {
  const oldLock = old();
  oldLock.packages['node_modules/sharp'].optional = true;
  oldLock.packages['node_modules/@img/sharp-linux-x64'].optional = true;
  oldLock.packages['node_modules/@img/sharp-libvips-linux-x64'].optional = true;
  const next = fresh();
  const merged = mergeSecurityLock(oldLock, next).lock;
  assert.equal(verifySecurityLock(pkg, merged, plan, oldLock).status, 'PASS');

  const missingNative = structuredClone(next);
  delete missingNative.packages['node_modules/@img/sharp-libvips-linux-x64'];
  assert.throws(() => mergeSecurityLock(oldLock, missingNative), /optional native edge missing/);

  const missingLock = structuredClone(merged);
  delete missingLock.packages['node_modules/@img/sharp-linux-x64'];
  assert.throws(() => verifySecurityLock(pkg, missingLock, plan, oldLock), /optional edge unresolved/);

  const requiredNative = structuredClone(merged);
  delete requiredNative.packages['node_modules/@img/sharp-linux-x64'].optional;
  assert.throws(() => verifySecurityLock(pkg, requiredNative, plan, oldLock), /optional edge unresolved/);

  const mismatchedNative = structuredClone(merged);
  mismatchedNative.packages['node_modules/sharp'].optionalDependencies['@img/sharp-linux-x64'] = '0.35.4';
  assert.throws(() => verifySecurityLock(pkg, mismatchedNative, plan, oldLock), /optional edge/);
});

test('if npm resolution fails, output file is never created and old source remains identical',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'w3-fail-closed-test-'));
 const dir=path.join(parent,'repo');fs.mkdirSync(dir);
 try {
  fs.mkdirSync(path.join(dir,'.github/ci'),{recursive:true});
  const minimal={name:'isolated-test',version:'0.0.1',overrides:pkg.overrides};
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(minimal));
  fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify(old()));
  const original=fs.readFileSync(path.join(dir,'package-lock.json'));
  const dest=path.join(parent,'out','package-lock.json');
  assert.throws(()=>createSecurityLockCandidate({root:dir,output:dest,npmCommand:'/does-not-exist/npm'}),/SECURITY_RESOLVE_NPM_FAIL/);
  assert.deepEqual(fs.readFileSync(path.join(dir,'package-lock.json')),original);
  assert.equal(fs.existsSync(dest),false);
 } finally {fs.rmSync(parent,{recursive:true,force:true});}
});

test('candidate resolver refuses source-tree output, symlink bypass and clobbering prior artifact before invoking npm',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'w3-output-guard-'));
 const repo=path.join(parent,'repo');fs.mkdirSync(repo);
 const filename=path.join(repo,'package-lock.json');
 const marker='DO_NOT_OVERWRITE';
 fs.writeFileSync(filename,marker);
 const alias=path.join(parent,'repo-alias');
 fs.symlinkSync(repo,alias);
 try {
  assert.throws(()=>createSecurityLockCandidate({root:repo,output:filename,npmCommand:'/absent/npm'}),/outside the source repository/);
  assert.throws(()=>createSecurityLockCandidate({root:repo,output:path.join(repo,'artifacts/new-lock.json'),npmCommand:'/absent/npm'}),/outside the source repository/);
  assert.throws(()=>createSecurityLockCandidate({root:repo,output:path.join(alias,'artifact.json'),npmCommand:'/absent/npm'}),/outside the source repository/);
  const existing=path.join(parent,'existing.json');fs.writeFileSync(existing,marker);
  assert.throws(()=>createSecurityLockCandidate({root:repo,output:existing,npmCommand:'/absent/npm'}),/already exists/);
  assert.equal(fs.readFileSync(filename,'utf8'),marker);
  assert.equal(fs.readFileSync(existing,'utf8'),marker);
 } finally {fs.rmSync(parent,{recursive:true,force:true});}
});

test('scratch security pins are direct only in the isolated copy and reject incorrect approved overrides',()=>{
  const original={name:'root',overrides:{sharp:'0.35.5','source-map-js':'1.2.2'},
    dependencies:{left:'1.0.0'},devDependencies:{sharp:'0.35.4'},optionalDependencies:{'source-map-js':'1.2.1'}};
  const copy=structuredClone(original);
  const result=pinScratchSecurityDependencies(original);
  assert.deepEqual(original,copy);
  assert.equal(result.dependencies.sharp,'0.35.5');
  assert.equal(result.dependencies['source-map-js'],'1.2.2');
  assert.equal(result.dependencies.left,'1.0.0');
  assert.equal(result.devDependencies.sharp,undefined);
  assert.equal(result.optionalDependencies['source-map-js'],undefined);
  assert.throws(()=>pinScratchSecurityDependencies({...original,overrides:{sharp:'0.35.4','source-map-js':'1.2.2'}}),/approved root security overrides/);
});
