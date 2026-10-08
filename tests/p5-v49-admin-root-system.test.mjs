import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read=(p)=>readFileSync(p,'utf8');
const shell=read('apps/admin/app/app-shell.tsx');
const css=read('apps/admin/app/globals.css');
const navigation=read('apps/admin/app/navigation.ts');
const dashboard=read('apps/admin/app/dashboard-overview.tsx');
const context=JSON.parse(read('config/admin-contextual-workflow-map.json'));

function tsxFiles(dir){
  return readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{
    const path=join(dir,entry.name);
    if(entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && path.endsWith('.tsx') ? [path] : [];
  });
}
const adminTsx=tsxFiles('apps/admin/app');
const adminBundle=adminTsx.map((file)=>`\n/* ${file} */\n${read(file)}`).join('\n');

test('P5 V4.11 Admin has one root presentation authority without override accretion',()=>{
  assert.match(shell,/data-ui-foundation="p5-v4\.11"/);
  assert.equal((css.match(/!important/g)||[]).length,0);
  for(const token of ['--admin-bg','--admin-surface','--admin-text','--admin-muted','--admin-border','--admin-primary']) assert.match(css,new RegExp(token));
  for(const alias of ['--panel:','--border:','--text:','--muted:']) assert.match(css,new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(css,/\.adminV4\[data-theme='dark'\]/);
  assert.match(css,/\.adminV4Sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/s);
  assert.match(css,/@media \(width >= 1024px\)[\s\S]*?\.adminV4Sidebar\s*\{[^}]*transform:\s*none/);
});

test('P5 V4.11 Admin uses one searchable hierarchical domain and subdomain navigation',()=>{
  assert.match(shell,/className="adminPrimaryNavigation"/);
  assert.match(shell,/adminSidebarSubdomains/);
  assert.match(shell,/resolveDomainViews\(item, manifest, identity\)/);
  assert.match(shell,/view\.label, view\.title, view\.description/);
  assert.match(shell,/data-admin-route=\{domainRoute\(item, view\)\}/);
  assert.match(shell,/Cari domain atau subdomain/);
  assert.doesNotMatch(shell,/adminModuleDirectory|moduleOpen|className="domainTabs/);
  assert.equal((navigation.match(/route:\s*'\//g)||[]).length,15);
  assert.match(navigation,/key:\s*'manufacturing'[\s\S]{0,300}?route:\s*'\/manufacturing'/);
  assert.equal(context.rows.length,70);
  assert.equal(context.expectedContextualViews,70);
  for (const route of [
    ['master-data','bulk-labels'],
    ['manufacturing','recipes'],
    ['manufacturing','orders'],
    ['integrations','ppob'],
    ['settings','setup'],
  ]) assert.ok(context.rows.some((row)=>row.workspace===route[0]&&row.view===route[1]), `missing contextual route ${route.join('/')}`);
});

test('P5 V4.11 Admin removes fixed inline form grids and centralizes responsive form primitives',()=>{
  assert.doesNotMatch(adminBundle,/<form[^>]*style=\{\{[^}]*gridTemplateColumns/s);
  assert.doesNotMatch(adminBundle,/<form[^>]*style=\{\{[^}]*display:\s*['"]grid['"]/s);
  for(const primitive of ['formSingle','formGrid','responsiveFormGrid','controlRow','inlineActions','accountCreateGrid']) assert.match(css,new RegExp(`\\.${primitive}`));
  assert.match(css,/\.grid2, \.grid4, \.stats, \.metricGrid\s*\{[^}]*align-items:\s*start/);
  assert.match(css,/@media \(width >= 768px\)[\s\S]*?\.formGrid, \.accountCreateGrid\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
});

test('P5 V4.11 Admin has no static inline presentation patches outside data-driven geometry',()=>{
  for(const pattern of [
    /style=\{\{[^}]*margin(?:Top|Bottom|Left|Right)\s*:\s*\d+/,
    /style=\{\{[^}]*display\s*:\s*['"](?:flex|grid|block)['"]/,
    /style=\{\{[^}]*alignSelf\s*:/,
    /style=\{\{[^}]*whiteSpace\s*:/,
    /style=\{\{[^}]*wordBreak\s*:/,
    /style=\{\{[^}]*background\s*:\s*['"]var\(/,
    /style=\{\{[^}]*color\s*:\s*['"]var\(/,
  ]) assert.doesNotMatch(adminBundle,pattern);
  assert.doesNotMatch(adminBundle,/gridTemplateColumns:\s*['"]/);
  assert.match(css,/\.ownerToolbar\s*\{/);
  assert.match(css,/\.digestPreviewText\s*\{/);
  assert.match(css,/\.sectionBlock\s*\{/);
});

test('P5 V4.11 Admin dashboard composition is structural and complete',()=>{
  assert.equal((dashboard.match(/<MetricCard\b/g)||[]).length,6);
  for(const panel of ['sales-performance','top-revenue-drivers','product-performance','recent-activity','stock-watchlist','quick-actions']) {
    assert.match(dashboard,new RegExp(`data-dashboard-panel="${panel}"`));
  }
  assert.match(css,/\.dashboardMetricGrid\s*\{/);
  assert.match(css,/@media \(width >= 1440px\)[\s\S]*?\.dashboardMetricGrid\s*\{[^}]*repeat\(6,minmax\(0,1fr\)\)/);
});

test('P5 V4.11 Admin root wave remains presentation-only in frontend source',()=>{
  assert.doesNotMatch(shell,/fetch\(|authFetch\(/);
  assert.match(navigation,/hasPermission\(identity, workspace\)/);
  assert.match(navigation,/manifest\?\.uiSchemas/);
  assert.doesNotMatch(adminBundle,/\/api\/v1\/[A-Za-z0-9_-]+\s*=\s*['"]/);
});
