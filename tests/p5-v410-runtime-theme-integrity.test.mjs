import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(p)=>fs.readFileSync(p,'utf8');
const apps=['admin','pos','storefront','employee-portal'];
const keySuffix={admin:'admin',pos:'pos',storefront:'storefront','employee-portal':'employee'};

test('V4.11 root layouts stay server-safe and never render script bootstrap nodes',()=>{
  for(const app of apps){
    const source=read(`apps/${app}/app/layout.tsx`);
    assert.match(source,/data-t360-theme="light"/);
    assert.doesNotMatch(source,/next\/script|<script(?:\s|>)|dangerouslySetInnerHTML|T360_THEME_BOOTSTRAP/);
  }
});

test('V4.11 theme storage is isolated, versioned, and light-first',()=>{
  const seen=[];
  for(const app of apps){
    const source=read(`apps/${app}/app/theme-contract.ts`);
    const expected=`toko360:ui-theme:v411:${keySuffix[app]}`;
    assert.match(source,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(source,/T360_THEME_DEFAULT: T360Theme = 'light'/);
    assert.doesNotMatch(source,/BOOTSTRAP|prefers-color-scheme/);
    seen.push(expected);
  }
  assert.equal(new Set(seen).size,4);
});

test('V4.11 theme hook applies document theme without render-time script injection',()=>{
  for(const app of apps){
    const source=read(`apps/${app}/app/theme-client.tsx`);
    assert.match(source,/readStoredTheme/);
    assert.match(source,/applyTheme/);
    assert.match(source,/document\.documentElement\.dataset\.t360Theme = theme/);
    assert.match(source,/document\.documentElement\.style\.colorScheme = theme/);
    assert.match(source,/window\.localStorage\.setItem\(T360_THEME_STORAGE_KEY, next\)/);
    assert.doesNotMatch(source,/dangerouslySetInnerHTML|<script/);
  }
});

test('authenticated shells and login-only surfaces retain explicit theme controls',()=>{
  const shellFiles={admin:'app-shell.tsx',pos:'pos-shell.tsx',storefront:'storefront-shell.tsx','employee-portal':'employee-portal-shell.tsx'};
  for(const app of apps){
    const source=read(`apps/${app}/app/${shellFiles[app]}`);
    assert.match(source,/useT360Theme\(\)/);
    assert.match(source,/toggleTheme/);
    assert.match(source,/Aktifkan mode gelap/);
    assert.match(source,/Aktifkan mode terang/);
    assert.match(source,/data-ui-foundation="p5-v4\.11"/);
  }
  assert.match(read('apps/admin/app/page.tsx'),/<T360ThemeToggle className="loginThemeToggle"/);
  assert.match(read('apps/pos/app/page.tsx'),/<T360ThemeToggle className="loginThemeToggle"/);
  assert.match(read('apps/employee-portal/app/employee-portal-app.tsx'),/<T360ThemeToggle className="loginThemeToggle"/);
});
