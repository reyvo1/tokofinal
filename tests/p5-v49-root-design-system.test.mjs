import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(file)=>fs.readFileSync(file,'utf8');
const apps=['admin','pos','storefront','employee-portal'];
const shells={
  admin:read('apps/admin/app/app-shell.tsx'),
  pos:read('apps/pos/app/pos-shell.tsx'),
  storefront:read('apps/storefront/app/storefront-shell.tsx'),
  'employee-portal':read('apps/employee-portal/app/employee-portal-shell.tsx'),
};
const css=Object.fromEntries(apps.map((app)=>[app,read(`apps/${app}/app/globals.css`)]));
const layouts=Object.fromEntries(apps.map((app)=>[app,read(`apps/${app}/app/layout.tsx`)]));
const themes=Object.fromEntries(apps.map((app)=>[app,read(`apps/${app}/app/theme-contract.ts`)]));
const themeClients=Object.fromEntries(apps.map((app)=>[app,read(`apps/${app}/app/theme-client.tsx`)]));

const expectedKeys={
  admin:'toko360:ui-theme:v411:admin',
  pos:'toko360:ui-theme:v411:pos',
  storefront:'toko360:ui-theme:v411:storefront',
  'employee-portal':'toko360:ui-theme:v411:employee',
};

test('V4.11 uses isolated persisted light-first theme protocol across all four products',()=>{
  const keys=[];
  for(const app of apps){
    assert.match(shells[app],/data-ui-foundation="p5-v4\.11"/);
    assert.match(shells[app],/data-theme=\{theme\}/);
    assert.match(shells[app],/useT360Theme\(\)/);
    assert.match(layouts[app],/data-t360-theme="light"/);
    assert.doesNotMatch(layouts[app],/next\/script|<script(?:\s|>)|T360_THEME_BOOTSTRAP/);
    assert.match(themes[app],new RegExp(expectedKeys[app].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(themeClients[app],/T360_THEME_STORAGE_KEY/);
    assert.match(themeClients[app],/document\.documentElement\.dataset\.t360Theme = theme/);
    assert.match(themeClients[app],/Aktifkan mode gelap/);
    assert.match(themeClients[app],/Aktifkan mode terang/);
    keys.push(expectedKeys[app]);
  }
  assert.equal(new Set(keys).size,4);
  for(const source of [...Object.values(themes),...Object.values(themeClients)]) assert.doesNotMatch(source,/toko360:ui-theme:(?!v411)/);
});

test('V4.11 dark mode has explicit complete surface ownership instead of global cross-product leakage',()=>{
  assert.match(css.admin,/\.adminV4\[data-theme='dark'\]/);
  assert.match(css.pos,/\.posV4\[data-theme='dark'\]/);
  assert.match(css.storefront,/\.storefrontV4\[data-theme='dark'\]/);
  assert.match(css['employee-portal'],/\.employeeV4\[data-theme='dark'\]/);
  assert.match(css.admin,/\.loginThemeToggle/);
  assert.match(css.pos,/\.loginThemeToggle/);
  assert.match(css['employee-portal'],/\.loginThemeToggle/);
});

test('V4.11 POS and Storefront remain deterministic light by default on first run',()=>{
  assert.match(themes.pos,/T360_THEME_DEFAULT: T360Theme = 'light'/);
  assert.match(themes.storefront,/T360_THEME_DEFAULT: T360Theme = 'light'/);
  assert.doesNotMatch(themes.pos,/prefers-color-scheme/);
  assert.doesNotMatch(themes.storefront,/prefers-color-scheme/);
  assert.equal((css.pos.match(/!important/g) ?? []).length <= 3,true);
  // The storefront dark canvas is navy, matching admin and POS, confirmed by the owner on
  // 2026-09-28 after the green-black gradient (#07110e) was reported as a green screen. It was
  // originally authored as a 'root design system' value, but the intent is the token's role, not
  // that specific hue — so the assertion pins the palette family and stays hue-tolerant.
  assert.match(css.storefront,/\.storefrontV4\[data-theme='dark'\][^}]*#0b1220/i);
  assert.doesNotMatch(css.storefront,/\.storefrontV4\[data-theme='dark'\][^}]*#07110e/i);
});

test('V4.11 theme integrity wave does not introduce API or business-domain imports into theme/layout/shell authority',()=>{
  for(const source of [...Object.values(shells),...Object.values(layouts),...Object.values(themes),...Object.values(themeClients)]){
    assert.doesNotMatch(source,/apps\/api|@toko360\/api|prisma|inventory movement|accounting core/i);
  }
});
