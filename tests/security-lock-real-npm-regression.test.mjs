import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mergeSecurityLock } from '../scripts/merge-npm-security-lock.mjs';
import { verifySecurityLock } from '../scripts/verify-security-lock.mjs';
import { pinScratchSecurityDependencies } from '../scripts/ci-resolve-security-dependency-lock.mjs';

const PACKAGE_DEFS = {
  'runtime-without-sharp': { '1.0.0': { dependencies: { 'stable-unrelated': '^1.0.0' } } },
  next: {
    '16.3.8': { dependencies: { 'source-map-js': '^1.2.1', 'stable-unrelated': '^1.0.0' }, optionalDependencies: { sharp: '^0.35.4' } },
  },
  sharp: {
    '0.35.4': { optionalDependencies: { '@img/sharp-linux-x64': '0.35.4', '@img/sharp-libvips-linux-x64': '1.3.3' } },
    '0.35.5': { optionalDependencies: { '@img/sharp-linux-x64': '0.35.5', '@img/sharp-libvips-linux-x64': '1.3.4' } },
  },
  'source-map-js': { '1.2.1': {}, '1.2.2': {} },
  'stable-unrelated': { '1.0.0': {}, '1.1.0': {} },
  '@img/sharp-linux-x64': { '0.35.4': {}, '0.35.5': {} },
  '@img/sharp-libvips-linux-x64': { '1.3.3': {}, '1.3.4': {} },
};

function npmCommand(cwd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const kill = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(kill); reject(error); });
    child.on('close', code => {
      clearTimeout(kill);
      if (code === 0) resolve({stdout, stderr});
      else reject(new Error(`npm ${args.join(' ')} exit=${code}: ${stderr.slice(-3000)} ${stdout.slice(-1000)}`));
    });
  });
}

function packFixtures(baseDir, env) {
  const packages = new Map();
  for (const [name, versions] of Object.entries(PACKAGE_DEFS)) {
    for (const [version, attrs] of Object.entries(versions)) {
      const folder = path.join(baseDir, 'source', name.replaceAll('/', '_'), version);
      fs.mkdirSync(folder, {recursive: true});
      fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({name, version, ...attrs}));
      fs.writeFileSync(path.join(folder, 'index.js'), 'module.exports = true;\n');
      const dest = path.join(baseDir, 'tarballs');
      fs.mkdirSync(dest, {recursive:true});
      const pack = spawnSync('npm', ['pack', '--silent', '--pack-destination', dest], {cwd: folder, env, encoding:'utf8', timeout:15_000});
      assert.equal(pack.status, 0, `fixture npm pack: ${pack.stderr}`);
      const archive = fs.readFileSync(path.join(dest, pack.stdout.trim().split(/\r?\n/).at(-1)));
      packages.set(`${name}@${version}`, {
        archive,
        integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
      });
    }
  }
  return packages;
}

async function fakeRegistry(packages) {
  let publishUpgrade = false;
  const server = http.createServer((request, response) => {
    const decoded = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const slash = '/-/';
    const end = decoded.indexOf(slash);
    if (end >= 0) {
      const name = decoded.slice(1, end), file = decoded.slice(end + slash.length);
      const match = file.match(/-(\d+\.\d+\.\d+)\.tgz$/);
      const tarball = match && packages.get(`${name}@${match[1]}`)?.archive;
      if (!tarball) { response.writeHead(404);response.end('not found');return; }
      response.setHeader('content-type', 'application/octet-stream');response.end(tarball);return;
    }
    const name = decoded.slice(1);
    const versions = PACKAGE_DEFS[name];
    if (!versions) { response.writeHead(404);response.end('not found');return; }
    const exposed = Object.entries(versions).filter(([version]) => name !== 'stable-unrelated' || publishUpgrade || version === '1.0.0');
    const records = Object.fromEntries(exposed.map(([version, attrs]) => {
      const basename = name.split('/').at(-1);
      return [version, {name, version, ...attrs,
        dist: {tarball: `http://127.0.0.1:${server.address().port}/${name}/-/${basename}-${version}.tgz`, integrity: packages.get(`${name}@${version}`).integrity} }];
    }));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({name, 'dist-tags': {latest: exposed.at(-1)[0]}, versions:records}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, url:`http://127.0.0.1:${server.address().port}/`,publishUpgrade: () => {publishUpgrade=true;}};
}

function versions(lock) {
  return Object.fromEntries(['sharp','source-map-js','stable-unrelated','@img/sharp-linux-x64','@img/sharp-libvips-linux-x64']
    .map(name => [name, lock.packages[`node_modules/${name}`]?.version]));
}

test('genuine npm 10: stale optional lock -> fresh registry graph -> scoped merge -> npm ci, with negative controls', {timeout:120_000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko360-npm-security-real-cli-'));
  let server;
  try {
    const env = {...process.env,
      npm_config_cache:path.join(dir, 'cache'),npm_config_fetch_retries:'0',
      npm_config_fund:'false',npm_config_audit:'false',npm_config_update_notifier:'false',
      CI:'true'};
    const packages = packFixtures(dir, env);
    const registry = await fakeRegistry(packages);
    server = registry.server;
    env.npm_config_registry = registry.url;
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    const packageJson = {name:'toko360-security-cli-regression',version:'0.0.1',private:true,
      dependencies:{next:'16.3.8'},overrides:{sharp:'0.35.4','source-map-js':'1.2.1'}};
    const manifest = path.join(repo, 'package.json');
    fs.writeFileSync(manifest, JSON.stringify(packageJson));
    await npmCommand(repo, ['install','--package-lock-only','--include=optional','--ignore-scripts','--no-audit','--no-fund'], env);
    const oldText = fs.readFileSync(path.join(repo,'package-lock.json'));
    const old = JSON.parse(oldText);
    assert.deepEqual(versions(old), {sharp:'0.35.4','source-map-js':'1.2.1','stable-unrelated':'1.0.0',
      '@img/sharp-linux-x64':'0.35.4','@img/sharp-libvips-linux-x64':'1.3.3'});
    registry.publishUpgrade();
    packageJson.overrides={sharp:'0.35.5','source-map-js':'1.2.2'};
    fs.writeFileSync(manifest, JSON.stringify(packageJson));
    const freshDir = path.join(dir, 'fresh');
    fs.mkdirSync(freshDir);
    fs.copyFileSync(manifest, path.join(freshDir, 'package.json'));
    await npmCommand(freshDir, ['install','--package-lock-only','--include=optional','--ignore-scripts','--no-audit','--no-fund'], env);
    const fresh = JSON.parse(fs.readFileSync(path.join(freshDir,'package-lock.json')));
    assert.equal(versions(fresh)['stable-unrelated'], '1.1.0');
    const merged = mergeSecurityLock(old, fresh, {allowLocalTestRegistry:true}).lock;
    assert.deepEqual(versions(merged), {sharp:'0.35.5','source-map-js':'1.2.2','stable-unrelated':'1.0.0',
      '@img/sharp-linux-x64':'0.35.5','@img/sharp-libvips-linux-x64':'1.3.4'});
    const officialPlan = JSON.parse(fs.readFileSync(new URL('../.github/ci/security-dependency-plan.json', import.meta.url)));
    assert.equal(verifySecurityLock(packageJson, merged, officialPlan, old).status,'PASS');
    fs.writeFileSync(path.join(repo,'package-lock.json'), JSON.stringify(merged,null,2)+'\n');
    await npmCommand(repo, ['ci','--include=optional','--ignore-scripts','--no-audit','--no-fund'], env);
    const sharp = JSON.parse(fs.readFileSync(path.join(repo,'node_modules/sharp/package.json')));
    const sourceMap = JSON.parse(fs.readFileSync(path.join(repo,'node_modules/source-map-js/package.json')));
    const unrelated = JSON.parse(fs.readFileSync(path.join(repo,'node_modules/stable-unrelated/package.json')));
    assert.deepEqual([sharp.version,sourceMap.version,unrelated.version],['0.35.5','1.2.2','1.0.0']);
    assert.notDeepEqual(fs.readFileSync(path.join(repo,'package-lock.json')), oldText);

    // Regression for the operator's real failure: npm may resolve a manifest
    // with no optional Sharp edge at all. The scratch-only direct pins must
    // restore both security targets without modifying the source manifest.
    const noOptional = path.join(dir,'without-optional-sharp');
    fs.mkdirSync(noOptional);
    const manifestWithoutOptional = {name:'optional-omission-case',version:'1.0.0',private:true,
      dependencies:{'runtime-without-sharp':'1.0.0'},
      overrides:{sharp:'0.35.5','source-map-js':'1.2.2'}};
    fs.writeFileSync(path.join(noOptional,'package.json'),JSON.stringify(manifestWithoutOptional));
    await npmCommand(noOptional,['install','--package-lock-only','--include=optional','--ignore-scripts','--no-audit','--no-fund'],env);
    const missingGraph=JSON.parse(fs.readFileSync(path.join(noOptional,'package-lock.json')));
    assert.equal(missingGraph.packages['node_modules/sharp'],undefined);
    assert.equal(missingGraph.packages['node_modules/source-map-js'],undefined);
    const pinned=pinScratchSecurityDependencies(manifestWithoutOptional);
    assert.deepEqual(pinned.dependencies,{'runtime-without-sharp':'1.0.0',sharp:'0.35.5','source-map-js':'1.2.2'});
    assert.deepEqual(manifestWithoutOptional.dependencies,{'runtime-without-sharp':'1.0.0'});
    const forcedDir=path.join(dir,'forced-security-edges');
    fs.mkdirSync(forcedDir);
    fs.writeFileSync(path.join(forcedDir,'package.json'),JSON.stringify(pinned));
    await npmCommand(forcedDir,['install','--package-lock-only','--include=optional','--ignore-scripts','--no-audit','--no-fund'],env);
    const restored=JSON.parse(fs.readFileSync(path.join(forcedDir,'package-lock.json')));
    assert.equal(restored.packages['node_modules/sharp'].version,'0.35.5');
    assert.equal(restored.packages['node_modules/source-map-js'].version,'1.2.2');
    assert.equal(restored.packages['node_modules/@img/sharp-linux-x64'].version,'0.35.5');
    assert.equal(restored.packages['node_modules/@img/sharp-libvips-linux-x64'].version,'1.3.4');
    await npmCommand(forcedDir,['ci','--include=optional','--ignore-scripts','--no-audit','--no-fund'],env);
    assert.equal(JSON.parse(fs.readFileSync(path.join(forcedDir,'node_modules/sharp/package.json'))).version,'0.35.5');

    // Execute the actual resolver end-to-end (not just its helper), using
    // genuine npm CLI + fixture tarballs in a localhost test registry.
    // Production CLI does NOT enable the local-registry test-only switch.
    fs.writeFileSync(path.join(repo,'package-lock.json'), oldText);
    fs.mkdirSync(path.join(repo,'.github','ci'),{recursive:true});
    fs.writeFileSync(path.join(repo,'.github','ci','security-dependency-plan.json'),JSON.stringify(officialPlan));
    const resolvedCandidate=path.join(dir,'candidate-out','package-lock.json');
    // The fixture HTTP server lives in THIS process. Spawn the real resolver
    // in another process so its synchronous npm invocation cannot starve it.
    const resolverModule=new URL('../scripts/ci-resolve-security-dependency-lock.mjs',import.meta.url).href;
    const resolverCode=`import {createSecurityLockCandidate} from ${JSON.stringify(resolverModule)};createSecurityLockCandidate({root:process.argv[1],output:process.argv[2],allowLocalTestRegistry:true});`;
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',resolverCode,repo,resolvedCandidate],
        {cwd:repo,env,stdio:['ignore','pipe','pipe']});
      let stderr='';
      const timeout=setTimeout(()=>child.kill('SIGKILL'),45_000);
      child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
      child.on('error',error=>{clearTimeout(timeout);reject(error);});
      child.on('close',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(`resolver child exit ${code}: ${stderr.slice(-2500)}`));});
    });
    const fromFunction=JSON.parse(fs.readFileSync(resolvedCandidate,'utf8'));
    assert.deepEqual(versions(fromFunction),versions(merged));
    assert.equal(old.packages['node_modules/sharp'].optional, true);
    assert.equal(fromFunction.packages['node_modules/sharp'].optional, true, 'optional Sharp must remain optional after scratch-direct resolution');
    assert.equal(fromFunction.packages['node_modules/@img/sharp-linux-x64'].optional, true);
    const wronglyRequired = structuredClone(fromFunction);
    delete wronglyRequired.packages['node_modules/sharp'].optional;
    assert.throws(() => verifySecurityLock(packageJson, wronglyRequired, officialPlan, old), /dependency classification changed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo,'package-lock.json'))),old);
    fs.writeFileSync(path.join(repo,'package-lock.json'),JSON.stringify(fromFunction,null,2)+'\n');
    await npmCommand(repo,['ci','--include=optional','--ignore-scripts','--no-audit','--no-fund'],env);
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo,'node_modules/sharp/package.json'))).version,'0.35.5');
    // Production installs that omit optional packages must NOT receive Sharp
    // just because the resolution scratch workspace temporarily pinned it.
    await npmCommand(repo,['ci','--omit=optional','--ignore-scripts','--no-audit','--no-fund'],env);
    assert.equal(fs.existsSync(path.join(repo,'node_modules/sharp')),false);
    assert.equal(fs.existsSync(path.join(repo,'node_modules/source-map-js')),true);

    const bad = structuredClone(merged);
    bad.packages['node_modules/sharp'].version='0.35.4';
    assert.throws(() => verifySecurityLock(packageJson,bad,officialPlan,old), /expected 0\.35\.5/);
    const missing = structuredClone(merged);
    delete missing.packages['node_modules/sharp'];
    assert.throws(() => verifySecurityLock(packageJson,missing,officialPlan,old), /absent/);
    const noIntegrity = structuredClone(merged);
    delete noIntegrity.packages['node_modules/@img/sharp-linux-x64'].integrity;
    assert.throws(() => mergeSecurityLock(old,noIntegrity,{allowLocalTestRegistry:true}),/official tarball\/integrity/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
