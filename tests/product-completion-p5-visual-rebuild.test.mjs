import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(file)=>fs.readFileSync(file,'utf8');
const visualMap=JSON.parse(read('config/p5-visual-surface-map.json'));
const v4=JSON.parse(read('config/p5-v4-total-ui-rebuild.json'));
const packageJson=JSON.parse(read('package.json'));
const adminShell=read('apps/admin/app/app-shell.tsx');
const adminCss=read('apps/admin/app/globals.css');
const adminDashboard=read('apps/admin/app/dashboard-overview.tsx');
const adminThemeContract=read('apps/admin/app/theme-contract.ts');
const posShell=read('apps/pos/app/pos-shell.tsx');
const posCss=read('apps/pos/app/globals.css');
const storefrontShell=read('apps/storefront/app/storefront-shell.tsx');
const storefrontCss=read('apps/storefront/app/globals.css');
const employeeShell=read('apps/employee-portal/app/employee-portal-shell.tsx');
const employeeCss=read('apps/employee-portal/app/globals.css');
const browserUat=read('scripts/browser-uat.mjs');
const p5Probe=read('scripts/ci-p5-visual-probe.mjs');
const v4Audit=read('scripts/audit-p5-v4-total-ui-rebuild.mjs');
const fullSystem=read('.github/workflows/full-system-simulation.yml');
const fullUat=read('.github/workflows/toko360-full-uat.yml');
const accountingWorkspace=read('apps/admin/app/modules/accounting.tsx');
const adminNavigation=read('apps/admin/app/navigation.ts');

test('P5 screenshot matrix still covers all four products at desktop tablet and mobile widths',()=>{
  const navigationRows=[...adminNavigation.matchAll(/\{ key: '([^']+)', route: '([^']+)', label: '([^']+)'/g)].map((match)=>({key:match[1],route:match[2],label:match[3]}));
  assert.deepEqual(visualMap.admin.primaryWorkspaces.map((item)=>item.route),navigationRows.map((item)=>item.route));
  assert.equal(visualMap.admin.representativeContextualRoutes.length,Math.max(0,navigationRows.length-1));
  assert.ok(visualMap.admin.primaryWorkspaces.some((item)=>item.route==='/manufacturing'&&item.label==='Produksi'));
  assert.ok(visualMap.admin.representativeContextualRoutes.includes('/manufacturing/recipes'));
  assert.equal(visualMap.pos.views.length,4);
  assert.equal(visualMap.storefront.views.length,5);
  assert.equal(visualMap.employeePortal.views.length,7);
  assert.deepEqual([visualMap.requirements.desktopWidth,visualMap.requirements.tabletWidth,visualMap.requirements.mobileWidth],[1440,1024,390]);
  assert.equal(visualMap.requirements.humanAcceptanceRequired,true);
});

test('P5 V4 is the active total presentation rebuild and keeps business API permission authority frozen',()=>{
  assert.equal(v4.phase,'P5-V4');
  assert.equal(v4.decision.deliveryBoundary,'ONE_P5_FULL_V4_TOTAL_PRESENTATION_REBUILD');
  assert.equal(v4.decision.businessLogicChangesAllowed,false);
  assert.equal(v4.decision.apiContractChangesAllowed,false);
  assert.equal(v4.decision.permissionContractChangesAllowed,false);
  assert.equal(v4.decision.tailwindUtilityFirstRequired,true);
  assert.equal(v4.decision.legacyVisualAuthorityAllowed,false);
  assert.equal(v4.decision.controlledDecorativeGradientsAllowed,true);
  assert.equal(v4.decision.humanAcceptanceRequired,true);
  assert.equal(v4.decision.adminReferenceDashboardContractRequired,true);
  assert.equal(v4.decision.adminLightDarkThemeRequired,true);
  assert.equal(v4.decision.adminLegacySemanticClassGapsAllowed,false);
  assert.equal(new Set(Object.values(v4.products).map((item)=>item.theme)).size,4);
});

test('P5 V4 replaces the old skin with four explicit runtime product identities',()=>{
  for(const [source,product] of [[adminShell,'admin'],[posShell,'pos'],[storefrontShell,'storefront'],[employeeShell,'employee-portal']]){
    assert.match(source,new RegExp(`data-visual-product="${product}"`));
    assert.match(source,/data-visual-version="p5-v4"/);
    assert.match(source,/data-visual-generation="p5-v4"/);
  }
  assert.match(adminShell,/adminV4Layout/);
  assert.match(adminCss,/linear-gradient\(135deg,#10b981,#2563eb\)/);
  // Light default preserved via .posV4 in the stylesheet; a Tailwind bg-* utility on the themed
  // root would outrank the [data-theme='dark'] rules and freeze the POS in light mode.
  const posShellRootTag = posShell.slice(posShell.indexOf('<main'), posShell.indexOf('>', posShell.indexOf('<main')));
  assert.doesNotMatch(posShellRootTag,/\bbg-slate-\d{2,3}\b/);assert.doesNotMatch(posShellRootTag,/\btext-slate-950\b/);assert.match(posShell,/posV4 min-h-screen min-w-0/);
  assert.match(posShell,/bg-gradient-to-br from-teal-500 to-cyan-600/);
  assert.match(storefrontShell,/storefrontV4/);
  assert.match(employeeShell,/employeeV4/);
});


test('P5 V4.6 Admin follows the supplied clean dashboard composition and provides persistent light/dark mode',()=>{
  assert.match(adminShell,/data-theme=\{theme\}/);
  assert.match(adminThemeContract,/toko360:ui-theme:v411:admin/);
  assert.match(adminShell,/useT360Theme\(\)/);
  assert.match(adminShell,/Aktifkan mode gelap/);
  assert.match(adminShell,/Aktifkan mode terang/);
  assert.match(adminShell,/className="adminPageHeader"/);
  assert.match(adminShell,/Dashboard Overview/);
  assert.match(adminShell,/Cari domain atau subdomain/);
  assert.equal((adminDashboard.match(/<MetricCard/g)||[]).length,6);
  for(const panel of ['sales-performance','top-revenue-drivers','product-performance','recent-activity','stock-watchlist','quick-actions']) assert.match(adminDashboard,new RegExp(`data-dashboard-panel="${panel}"`));
  assert.match(adminDashboard,/data-chart-kind="donut"/);
  assert.match(adminDashboard,/LineSeriesChart/);
  assert.match(adminCss,/\.adminV4\[data-theme='dark'\]/);
  for(const semanticClass of ['stack','grid2','grid4','stats','stat','formStack','actionRow','rowActions','checkRow','checkboxLabel','checkboxRow','notice','okText','dangerText','catalogSummary','catalogFormShell','catalogFormHeader','pageHeader']) assert.match(adminCss,new RegExp(`\.${semanticClass}`));
});

test('P5 V4 Tailwind surfaces use controlled depth glass and gradients without invalid group apply',()=>{
  const cssBundle=[adminCss,posCss,storefrontCss,employeeCss].join('\n');
  assert.match(cssBundle,/@import "tailwindcss"/);
  assert.match(cssBundle,/backdrop-blur|backdrop-blur-xl/);
  assert.match(cssBundle,/radial-gradient|linear-gradient/);
  assert.match(cssBundle,/prefers-reduced-motion/);
  assert.match(cssBundle,/focus-visible/);
  assert.doesNotMatch(cssBundle,/@apply[^;]*\bgroup\b/);
  assert.doesNotMatch(cssBundle,/@apply[^;]*group-hover:/);
  assert.doesNotMatch(cssBundle,/\[data-visual-version=["']?p5-v2/i);
});

test('P5 V4 runtime browser gate checks actual identity not only overflow screenshots',()=>{
  for(const id of ['P5_V4_ADMIN_VISUAL_IDENTITY','P5_V4_POS_VISUAL_IDENTITY','P5_V4_STOREFRONT_VISUAL_IDENTITY','P5_V4_EMPLOYEE_VISUAL_IDENTITY']){
    assert.match(browserUat,new RegExp(id));
    assert.match(p5Probe,new RegExp(id));
  }
  assert.match(browserUat,/rootLuminance/);
  assert.match(browserUat,/legacy dark skin/);
  assert.match(browserUat,/sidebarLuminance/);
  assert.match(browserUat,/ADMIN_SHELL_GEOMETRY/);
  assert.match(p5Probe,/visualGeneration:\s*'P5-V4'/);
  assert.match(p5Probe,/p5V4TotalPresentationRebuildContract/);
  assert.match(p5Probe,/distinctRuntimeProductIdentity/);
  assert.match(p5Probe,/humanAcceptance:\s*'PENDING'/);
});

test('P5 visual audit and exact-source probe stay permanent in both heavy workflows',()=>{
  assert.equal(packageJson.scripts['audit:p5:visual'],'node scripts/audit-p5-visual-rebuild.mjs && node scripts/audit-p5-v4-total-ui-rebuild.mjs && node scripts/audit-ui-domain-surface-depth.mjs');
  assert.match(v4Audit,/P5 V4 total UI rebuild audit PASS/);
  for(const workflow of [fullSystem,fullUat]){
    assert.match(workflow,/id: p5_visual_rebuild/);
    assert.match(workflow,/npm run ci:p5:probe/);
  }
});

test('P5 Storefront deterministic fixture stays fail-closed and non-production',()=>{
  for(const workflow of [fullSystem,fullUat]){
    assert.match(workflow,/T360_UAT_PREPARE_P5_STOREFRONT_FIXTURE:\s*'true'/);
    assert.match(workflow,/T360_UAT_STOREFRONT_BRANCH_CODE:\s*PUSAT/);
  }
  assert.match(browserUat,/P5 Storefront fixture menolak target non-loopback/);
  assert.match(browserUat,/P5 Storefront fixture menolak environment yang tidak eksplisit non-production/);
  assert.match(browserUat,/productionTouched:\s*false/);
});

test('P5 finance account creation form stays responsive inside the rebuilt Admin workspace',()=>{
  assert.match(accountingWorkspace,/className="accountCreateGrid"/);
  assert.match(adminCss,/\.formGrid, \.accountCreateGrid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(adminCss,/@media \(width >= 768px\)[\s\S]*?\.formGrid, \.accountCreateGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  // Apakah form MELEBUR keluar panel adalah yang diuji, bukan jumlah kolomnya.
  //
  // Aturan lama memakai `120px minmax(180px,1fr) 150px auto` pada viewport >= 1440px. Karena
  // .grid2 sudah 2 kolom sejak 768px, panel "CHART OF ACCOUNTS" hanya ~562px pada viewport 1440 -
  // padahal aturan itu aktif tepat pada 1440. Empat track itu butuh minimum
  // 120+180+150+tombol(~107) + 3 gap = ~597px, jadi form meluber 57px dan tombol "Tambah akun"
  // terdorong keluar viewport (terukur: form cw:530, sw:587; BUTTON R1445 vs viewport 1425).
  //
  // Setiap track fixed dalam px bisa melebihi panelnya, jadi bentuk yang aman adalah track
  // fluid berbasis minmax(0,1fr): track itu mengikuti lebar panel, bukan lebar viewport.
  const wide = adminCss.match(/@media \(width >= 1440px\)[\s\S]*?\.accountCreateGrid\s*\{[^}]*\}/);
  assert.ok(wide, 'aturan .accountCreateGrid pada >= 1440px tidak ditemukan');
  assert.ok(
    !/grid-template-columns:[^;]*\d+px/.test(wide[0]),
    `track fixed px pada >= 1440px bisa melebihi panelnya: ${wide[0].slice(0, 160)}`,
  );
  assert.match(wide[0],/minmax\(0,\s*1fr\)/, 'track harus fluid (minmax(0,1fr)) supaya mengikuti lebar panel');
});
