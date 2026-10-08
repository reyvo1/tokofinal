#!/usr/bin/env node
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const fail = (message) => { throw new Error(`P5 V4 audit FAIL: ${message}`); };
const config = JSON.parse(read('config/p5-v4-total-ui-rebuild.json'));

if (config.phase !== 'P5-V4') fail('phase harus P5-V4.');
if (config.decision?.deliveryBoundary !== 'ONE_P5_FULL_V4_TOTAL_PRESENTATION_REBUILD') fail('delivery boundary tidak canonical.');
if (config.decision?.businessLogicChangesAllowed !== false || config.decision?.apiContractChangesAllowed !== false || config.decision?.permissionContractChangesAllowed !== false) fail('business/API/permission freeze contract hilang.');
if (config.decision?.tailwindUtilityFirstRequired !== true || config.decision?.legacyVisualAuthorityAllowed !== false) fail('Tailwind/legacy authority contract tidak benar.');
if (config.decision?.humanAcceptanceRequired !== true) fail('human acceptance wajib tetap aktif.');

const products = {
  admin: { shell: read('apps/admin/app/app-shell.tsx'), css: read('apps/admin/app/globals.css'), dashboard: read('apps/admin/app/dashboard-overview.tsx') },
  pos: { shell: read('apps/pos/app/pos-shell.tsx'), css: read('apps/pos/app/globals.css') },
  storefront: { shell: read('apps/storefront/app/storefront-shell.tsx'), css: read('apps/storefront/app/globals.css') },
  employeePortal: { shell: read('apps/employee-portal/app/employee-portal-shell.tsx'), css: read('apps/employee-portal/app/globals.css') },
};

for (const [name, product] of Object.entries(products)) {
  if (!product.shell.includes('data-visual-generation="p5-v4"')) fail(`${name} belum mengaktifkan p5-v4.`);
  if (!product.css.includes('@import "tailwindcss"')) fail(`${name} tidak memakai Tailwind.`);
  if (/\[data-visual-version=["']?p5-v2/i.test(product.css)) fail(`${name} masih memakai override selector P5 V2.`);
  if (/@apply[^;]*\bgroup\b/.test(product.css) || /@apply[^;]*group-hover:/.test(product.css)) fail(`${name} memakai invalid Tailwind group @apply.`);
  if (!/prefers-reduced-motion/.test(product.css) || !/focus-visible/.test(product.css)) fail(`${name} kehilangan reduced-motion/focus contract.`);
}

const adminShell = products.admin.shell;
const adminCss = products.admin.css;
const adminTheme = read('apps/admin/app/theme-contract.ts');
if (!/adminV4Layout/.test(adminShell) || !/@media \(width >= 1024px\)[\s\S]*?\.adminV4Layout\s*\{[^}]*grid-template-columns:\s*246px minmax\(0,1fr\)/.test(adminCss)) fail('Admin semantic two-column layout V4.9 hilang.');
if (!/adminBrandMark/.test(adminShell) || !/linear-gradient\(135deg,#10b981,#2563eb\)/.test(adminCss)) fail('Admin brand identity V4 hilang.');
if (!/\.adminMainContent\s*\{[^}]*max-width:\s*1720px/.test(adminCss)) fail('Admin bounded workspace width V4.9 hilang.');
if (/compatibility source marker/.test(adminShell)) fail('Admin source marker text node kembali.');
if (config.decision?.adminReferenceDashboardContractRequired !== true || config.decision?.adminLightDarkThemeRequired !== true) fail('Admin reference/dashboard dual-theme contract belum dikunci.');
if (!/data-theme=\{theme\}/.test(adminShell) || !/useT360Theme\(\)/.test(adminShell) || !/Aktifkan mode gelap/.test(adminShell) || !/Aktifkan mode terang/.test(adminShell) || !/toko360:ui-theme:v411:admin/.test(adminTheme)) fail('Admin light/dark theme persistence/toggle contract hilang.');
if (!/className="adminPageHeader"/.test(adminShell) || !/Dashboard Overview/.test(adminShell) || !/Cari domain atau subdomain/.test(adminShell)) fail('Admin reference dashboard shell contract hilang.');
const adminDashboard = products.admin.dashboard;
if ((adminDashboard.match(/<MetricCard/g) || []).length !== 6) fail('Admin dashboard harus memiliki tepat 6 KPI card seperti reference contract.');
for (const panel of ['sales-performance','top-revenue-drivers','product-performance','recent-activity','stock-watchlist','quick-actions']) {
  if (!adminDashboard.includes(`data-dashboard-panel="${panel}"`)) fail(`Admin dashboard panel hilang: ${panel}`);
}
if (!adminDashboard.includes('data-chart-kind="donut"') || !adminDashboard.includes('LineSeriesChart')) fail('Admin dashboard chart contract line+donut hilang.');
for (const semanticClass of ['stack','grid2','grid4','stats','stat','formStack','actionRow','rowActions','checkRow','checkboxLabel','checkboxRow','notice','okText','dangerText','catalogSummary','catalogFormShell','catalogFormHeader','pageHeader']) {
  if (!products.admin.css.includes(`.${semanticClass}`)) fail(`Admin shared semantic CSS class hilang: ${semanticClass}`);
}
if (!/\.adminV4\[data-theme='dark'\]/.test(products.admin.css)) fail('Admin dark theme CSS authority hilang.');

const posShell = products.pos.shell;
// The bright POS identity is asserted against the themed root element and the .posV4 rule in
// the stylesheet. A Tailwind bg-slate-100 utility on the root used to satisfy this check, but it
// outranks every [data-theme='dark'] rule by specificity, which pinned the POS to light forever
// and made the theme toggle a no-op — the page rendered as a dark <main> over a light <html>.
const posRootTag = posShell.slice(posShell.indexOf('<main'), posShell.indexOf('>', posShell.indexOf('<main')));
if (!/posV4 min-h-screen/.test(posRootTag)) fail('POS V4 root harus memakai shell posV4.');
if (/\bbg-slate-\d{2,3}\b/.test(posRootTag) || /\btext-slate-950\b/.test(posRootTag)) fail('POS V4 root tidak boleh hardcode warna terang, itu memblokir dark mode.');
if (!/linear-gradient\(180deg,#f8fafc/i.test(products.pos.css)) fail('POS V4 surface light default hilang dari .posV4.');
if (!/lg:flex-row/.test(posShell) || !/posTopbarActions/.test(posShell)) fail('POS responsive header V4 hilang.');
if (!/bg-gradient-to-br from-teal-500 to-cyan-600/.test(posShell)) fail('POS V4 visual identity hilang.');

if (!/storefrontV4/.test(products.storefront.shell) || !/premium-natural-retail/.test(JSON.stringify(config.products.storefront))) fail('Storefront V4 identity tidak aktif.');
if (!/employeeV4/.test(products.employeePortal.shell) || !/violet-self-service-workspace/.test(JSON.stringify(config.products.employeePortal))) fail('Employee V4 identity tidak aktif.');

const themes = Object.values(config.products).map((item) => item.theme);
if (new Set(themes).size !== 4) fail('Empat produk harus memiliki theme berbeda.');

console.log('P5 V4 total UI rebuild audit PASS: 4 product identities, Tailwind-first presentation, business/API/permission frozen.');
