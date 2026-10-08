import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(file)=>fs.readFileSync(file,'utf8');
const pkg=JSON.parse(read('package.json'));
const fullSystem=read('.github/workflows/full-system-simulation.yml');
const fullUat=read('.github/workflows/toko360-full-uat.yml');
const browser=read('scripts/browser-uat.mjs');
const worker=read('apps/worker/src/index.ts');
const adminNav=read('apps/admin/app/navigation.ts');
const adminDomains=read('apps/admin/app/domain-workspaces.ts');
const adminPage=read('apps/admin/app/page.tsx');

test('full UI migration makes Tailwind v4 canonical and audit commands mandatory',()=>{
  assert.equal(pkg.devDependencies.tailwindcss,'4.3.3');
  assert.equal(pkg.devDependencies['@tailwindcss/postcss'],'4.3.3');
  assert.match(pkg.scripts['audit:full:repo'], /^node scripts\/audit-full-repository\.mjs/);
  assert.match(pkg.scripts['audit:full:repo'], /audit:product:completeness/);
  assert.equal(pkg.scripts['ci:api:sweep'],'node scripts/ci-runtime-api-sweep.mjs');
  assert.equal(pkg.scripts['ci:ui:audit'],'node scripts/ci-ui-source-audit.mjs');
  assert.equal(pkg.scripts['ci:provider:probe'],'node scripts/ci-notification-provider-probe.mjs');
});

test('Admin information architecture exposes tenant, provider, Telegram/WhatsApp and AI explicitly',()=>{
  for (const label of ['Forecast & Otomasi','Integrasi & Notifikasi','Tenant & Organisasi','Pengaturan & Akses','Laporan & Analitik']) assert.match(adminNav,new RegExp(label.replace(/[&/]/g,'\\$&')));
  for(const label of ['Telegram & WhatsApp','AI Assistant','Forecast','Cabang & Gudang','User & Role']) assert.match(adminDomains,new RegExp(label.replace(/[&/]/g,'\\$&')));
  assert.match(adminPage,/activeWorkspace\.key === 'integrations'/);
  assert.match(adminPage,/activeWorkspace\.key === 'intelligence'/);
  assert.match(adminPage,/activeWorkspace\.key === 'organization'/);
  assert.match(adminPage,/activeWorkspace\.key === 'settings'/);
});

test('GitHub full-system and manual UAT require repository/UI/API/provider deep gates',()=>{
  for(const workflow of [fullSystem,fullUat]){
    assert.match(workflow,/npm run audit:full:repo/);
    assert.match(workflow,/npm run ci:ui:audit/);
    assert.match(workflow,/npm run ci:api:sweep/);
    assert.match(workflow,/npm run ci:provider:probe/);
    assert.match(workflow,/T360_CI_TELEGRAM_API_BASE_URL: http:\/\/127\.0\.0\.1:4789/);
    assert.match(workflow,/WEBHOOK_ALLOW_PRIVATE_TARGETS/);
  }
});

test('provider simulation cannot redirect production Telegram traffic',()=>{
  assert.match(worker,/function telegramApiBaseUrl/);
  assert.match(worker,/process\.env\.CI !== 'true'/);
  assert.match(worker,/T360_UAT_ENVIRONMENT/);
  assert.match(worker,/\['127\.0\.0\.1', 'localhost'\]/);
  assert.match(worker,/https:\/\/api\.telegram\.org/);
});

test('browser UAT traverses navigation and checks desktop tablet mobile geometry',()=>{
  assert.match(browser,/assertResponsiveMatrix/);
  assert.match(browser,/\[1440,900\]/);
  assert.match(browser,/\[1024,768\]/);
  assert.match(browser,/\[390,844\]/);
  assert.match(browser,/ADMIN_ALL_NAVIGATION_RUNTIME/);
  assert.match(browser,/\/integrations\/notifications/);
  assert.match(browser,/R8 contextual route \/integrations\/notifications active/);
  assert.match(browser,/POS_ALL_WORKSPACES_RUNTIME/);
  assert.match(browser,/STOREFRONT_NAVIGATION_RUNTIME/);
  assert.match(browser,/EMPLOYEE_ALL_SELF_SERVICE_ROUTES/);
  assert.match(browser,/scrollWidth > width \+ 3/);
});

test('native browser prompt/confirm/alert are forbidden on operator surfaces',()=>{
  for(const app of ['admin','pos','storefront','employee-portal']){
    const files=[];const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())walk(p);else if(p.endsWith('.tsx'))files.push(p)}};walk(`apps/${app}/app`);
    const source=files.map(read).join('\n');assert.doesNotMatch(source,/\bwindow\.(?:prompt|confirm|alert)\s*\(/,app);
  }
});
