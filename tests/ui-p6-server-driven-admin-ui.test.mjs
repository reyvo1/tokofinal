import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page=readFileSync(new URL('../apps/admin/app/page.tsx',import.meta.url),'utf8');
const shell=readFileSync(new URL('../apps/admin/app/app-shell.tsx',import.meta.url),'utf8');
const domain=readFileSync(new URL('../apps/admin/app/domain-workspaces.ts',import.meta.url),'utf8');
const navigation=readFileSync(new URL('../apps/admin/app/navigation.ts',import.meta.url),'utf8');

test('UI-P6 resolves nested domain views from canonical source plus runtime constraints',()=>{
  assert.match(domain,/export function resolveDomainViews/);
  assert.match(domain,/enabledModuleCodes\(manifest/);
  assert.match(domain,/identityCanSeeView\(identity,\s*view\)/);
  assert.match(domain,/readDomainOverrides\(manifest,\s*workspace\)/);
  assert.match(domain,/hidden\s*===\s*true/);
  assert.match(domain,/moduleCodes\.some/);
});

test('UI-P6 UiSchema overrides remain presentation-only and canonical',()=>{
  assert.match(domain,/surface\.toLowerCase\(\) === 'admin'/);
  assert.match(domain,/domainViews/);
  assert.match(domain,/override\.workspace !== workspace\.key/);
  assert.match(domain,/overrides\.has\(override\.key\)/);
  assert.match(domain,/typeof o\?\.label\s*={2,3}\s*'string'|typeof override\?\.label\s*={2,3}\s*'string'/);
  assert.match(domain,/typeof o\?\.title\s*={2,3}\s*'string'|typeof override\?\.title\s*={2,3}\s*'string'/);
  assert.match(domain,/typeof o\?\.description\s*={2,3}\s*'string'|typeof override\?\.description\s*={2,3}\s*'string'/);
  assert.doesNotMatch(domain,/fetch\(/);
});

test('UI-P6 shell uses runtime-resolved nested views and exposes tenant/runtime status',()=>{
  assert.match(shell,/resolveDomainViews\(activeWorkspace, manifest, identity\)/);
  assert.match(shell,/role="status" aria-live="polite"/);
  assert.match(shell,/Tenant aktif/);
  assert.match(shell,/const branchLabel = manifest\?\.branch\?\.name \?\? 'Cabang aktif'/);
  assert.match(shell,/const companyLabel = manifest\?\.company\?\.name \?\? 'Toko360'/);
  assert.match(shell,/\{companyLabel\}/);
  assert.match(page,/identity=\{identity\}/);
});

test('UI-P6 redirects a runtime-hidden nested deep link to canonical domain root',()=>{
  assert.match(page,/const visibleViews = resolveDomainViews\(activeWorkspace, manifest, identity\)/);
  assert.match(page,/router\.replace\(activeWorkspace\.route\)/);
  assert.match(page,/parts\.length !== 2/);
});

test('UI-P6 preserves canonical top-level discoverability while contextual views keep runtime constraints and backend authority',()=>{
  assert.match(navigation,/resolveAdminNavigation/);
  assert.doesNotMatch(navigation,/enabledModuleCodes|activeModules/);
  assert.match(navigation,/identity\.permissions/);
  assert.match(domain,/manifest\.features\?\.\[module\.featureKey\]\?\.enabled === true/);
  assert.match(domain,/moduleCodes\.some/);
  assert.match(page,/authFetch/);
});
