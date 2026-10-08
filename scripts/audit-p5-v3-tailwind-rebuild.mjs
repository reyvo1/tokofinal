#!/usr/bin/env node
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const fail = (message) => { console.error(`P5 V3 Tailwind rebuild audit FAIL — ${message}`); process.exit(1); };
const config = JSON.parse(read('config/p5-v3-tailwind-rebuild.json'));

if (config.phase !== 'P5-V3') fail('phase harus P5-V3.');
if (config.baseline.commit !== 'fd2d29d9a8d7d6bd0db3c1e085fb4e376440f6bc') fail('baseline commit drift.');
if (config.baseline.automatedP5 !== 'PASS' || config.baseline.humanVisualAcceptance !== 'REJECTED') fail('baseline automated/human state tidak sesuai.');
if (config.decision.deliveryBoundary !== 'ONE_P5_FULL_V3_TOTAL_UI_REBUILD') fail('delivery boundary bukan full rebuild.');
if (config.decision.businessLogicChangesAllowed !== false || config.decision.apiContractChangesAllowed !== false) fail('business/API freeze hilang.');
if (config.decision.tailwindUtilityFirstRequired !== true || config.decision.legacyCompatibilityLayerTailwindOnly !== true) fail('Tailwind utility-first contract hilang.');
if (config.decision.p5V2OverrideBlocksForbidden !== true || config.decision.decorativeGradientsAllowed !== false) fail('override/gradient contract tidak benar.');

const products = {
  admin: { shell: read('apps/admin/app/app-shell.tsx'), css: read('apps/admin/app/globals.css') },
  pos: { shell: read('apps/pos/app/pos-shell.tsx'), css: read('apps/pos/app/globals.css') },
  storefront: { shell: read('apps/storefront/app/storefront-shell.tsx'), css: read('apps/storefront/app/globals.css') },
  employeePortal: { shell: read('apps/employee-portal/app/employee-portal-shell.tsx'), css: read('apps/employee-portal/app/globals.css') },
};

for (const [name, product] of Object.entries(products)) {
  if (!product.shell.includes('data-visual-generation="p5-v3"')) fail(`${name} belum mengaktifkan P5 V3.`);
  if (!product.css.startsWith('@import "tailwindcss";')) fail(`${name} bukan Tailwind CSS v4 surface.`);
  if (/\[data-visual-version=["']?p5-v2/i.test(product.css)) fail(`${name} masih memakai P5 V2 CSS override selector.`);
  if (/(?:linear|radial|conic)-gradient\s*\(/i.test(product.css)) fail(`${name} memakai decorative gradient.`);
  if (/overflow-x\s*:\s*auto/i.test(product.css)) fail(`${name} memakai horizontal page scroll.`);
  const utilityCount = (product.shell.match(/(?:bg-|text-|border-|rounded-|shadow-|grid|flex|gap-|px-|py-|p-|m-|min-h-|max-w-|backdrop-blur)/g) || []).length;
  if (utilityCount < 30) fail(`${name} shell belum utility-first (count=${utilityCount}).`);
}

const adminUi = read('apps/admin/app/ui.tsx');
const adminAnalytics = read('apps/admin/app/analytics.tsx');
const adminShellOpening = products.admin.shell.match(/className="shell[^"]*"/)?.[0] ?? '';
if (!products.admin.shell.includes('data-admin-layout="primary"')) fail('Admin dedicated primary layout wrapper hilang.');
if (!/className="adminLayout[^"]*lg:grid[^"]*lg:grid-cols-\[272px_minmax\(0,1fr\)\]/.test(products.admin.shell)) fail('Admin desktop two-column layout harus dimiliki adminLayout wrapper.');
if (!/<aside className=\{`sidebar/.test(products.admin.shell) || !products.admin.shell.includes('className="main min-w-0 w-full"')) fail('Admin sidebar/main semantic columns tidak lengkap.');
if (adminShellOpening.includes('lg:grid')) fail('Admin outer shell tidak boleh menjadi grid; fixed skip-link/auxiliary nodes dapat menggeser auto-placement.');
if (/compatibility source marker/.test(products.admin.shell)) fail('Admin shell memuat literal source-marker node yang dapat menjadi anonymous CSS-grid item.');
if (!adminUi.includes('rounded-[24px]') || !adminUi.includes('shadow-[')) fail('Admin shared primitives belum direbuild dengan Tailwind utility langsung.');
if (!adminAnalytics.includes('grid-cols-1') || !adminAnalytics.includes('chart')) fail('Admin analytics belum direbuild sebagai dashboard visual yang jelas.');
if (!products.admin.css.includes('.accountCreateGrid')) fail('Admin responsive finance compatibility hilang.');
if (!products.pos.css.includes('.cart{@apply') || !products.pos.css.includes('xl:sticky')) fail('POS cart hierarchy/touch contract hilang.');
if (!/posTopbar sticky[^\n]*flex min-w-0 flex-col[^\n]*sm:flex-row/.test(products.pos.shell)) fail('POS mobile topbar harus stack sebelum sm untuk mencegah intrinsic-width overflow.');
if (!/posTopbarActions flex w-full min-w-0 flex-wrap[^\n]*sm:shrink-0 sm:flex-nowrap/.test(products.pos.shell)) fail('POS action row harus shrink/wrap pada mobile.');
if (!/\.posTopbarActions label \{ @apply[^}]*min-w-0[^}]*flex-\[1_1_12rem\]/.test(products.pos.css) || !/\.posTopbarActions label select \{ @apply[^}]*min-w-0[^}]*flex-1/.test(products.pos.css)) fail('POS warehouse control belum shrink-safe pada mobile.');
if (!products.storefront.css.includes('.productCard') || !products.storefront.css.includes('.productDetail')) fail('Storefront product-first visual primitives hilang.');
if (/@apply[^;]*\bgroup\b/.test(products.storefront.css) || /@apply[^;]*group-hover:/.test(products.storefront.css)) fail('Storefront memakai Tailwind group marker di @apply; gunakan selector parent hover atau class group langsung di markup.');
if (!/\.productCard:hover \.productImage\s*\{[^}]*@apply bg-\[#e8ede5\]/s.test(products.storefront.css)) fail('Storefront product hover relationship hilang setelah group marker dihapus.');
if (!products.employeePortal.css.includes('.employeeMobileNav{@apply grid grid-cols-4')) fail('Employee mobile navigation contract hilang.');

const themes = new Set(Object.values(config.products).map((item) => item.theme));
if (themes.size !== 4) fail('empat produk harus mempunyai identity berbeda.');
if (config.products.admin.canvas !== '#f5f7fb' || config.products.pos.canvas !== '#eef4f6' || config.products.storefront.canvas !== '#f7f7f5' || config.products.employeePortal.canvas !== '#f6f7fb') fail('canvas product identity drift.');

console.log('P5 V3 Tailwind rebuild audit PASS — total UI replacement, utility-first shells, Tailwind compatibility layers, four distinct product identities, business/API frozen, human acceptance still required.');
