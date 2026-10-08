#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

const read = (file) => fs.readFileSync(file, 'utf8');
const fail = (message) => {
  console.error(`P5 V2 art-direction audit FAIL — ${message}`);
  process.exit(1);
};

const config = JSON.parse(read('config/p5-v2-art-direction.json'));
const products = {
  admin: {
    shell: read('apps/admin/app/app-shell.tsx'),
    css: read('apps/admin/app/globals.css'),
  },
  pos: {
    shell: read('apps/pos/app/pos-shell.tsx'),
    css: read('apps/pos/app/globals.css'),
  },
  storefront: {
    shell: read('apps/storefront/app/storefront-shell.tsx'),
    css: read('apps/storefront/app/globals.css'),
  },
  employeePortal: {
    shell: read('apps/employee-portal/app/employee-portal-shell.tsx'),
    css: read('apps/employee-portal/app/globals.css'),
  },
};

if (config.phase !== 'P5-V2') fail('phase contract harus P5-V2.');
if (config.decision.deliveryBoundary !== 'ONE_P5_FULL_V2_ATOMIC_WAVE') fail('delivery boundary berubah.');
if (config.decision.businessLogicChangesAllowed !== false) fail('P5 V2 harus presentation-only.');
if (config.decision.glassLayeringRequired !== true || config.decision.elevationRequired !== true) fail('glass/elevation contract hilang.');
if (config.decision.decorativeGradientsAllowed !== false) fail('decorative gradient tetap dilarang.');
if (config.decision.distinctProductThemesRequired !== true) fail('empat produk wajib punya theme berbeda.');

for (const [name, { shell, css }] of Object.entries(products)) {
  if (!shell.includes('data-visual-version="p5-v2"')) fail(`${name} belum mengaktifkan visual version p5-v2.`);
  if (!css.includes('backdrop-filter')) fail(`${name} belum memiliki glass layer.`);
  if (!css.includes('box-shadow')) fail(`${name} belum memiliki elevation/shadow.`);
  if (!/prefers-reduced-motion\s*:\s*reduce/.test(css)) fail(`${name} kehilangan reduced-motion contract.`);
  if (!/pointer\s*:\s*coarse/.test(css)) fail(`${name} kehilangan coarse-pointer contract.`);
  if (/(?:linear|radial|conic)-gradient\s*\(/i.test(css)) fail(`${name} mengembalikan decorative gradient.`);
}

for (const [name, contract] of Object.entries(config.products)) {
  if (!products[name].css.toLowerCase().includes(contract.canvas.toLowerCase())) fail(`${name} tidak memakai canvas art-direction ${contract.canvas}.`);
  if (!products[name].css.toLowerCase().includes(contract.accent.toLowerCase())) fail(`${name} tidak memakai accent art-direction ${contract.accent}.`);
}

if (!products.admin.css.includes('.navLabel small { display: none; }')) fail('Admin belum mengurangi stacked navigation copy.');
if (!products.admin.shell.includes('adminSidebarSubdomains') || !products.admin.shell.includes('adminPrimaryNavigation')) fail('Admin kehilangan hierarchical domain/subdomain navigation authority.');
if (!products.storefront.css.includes('color-scheme: light')) fail('Storefront belum menjadi light retail surface.');
if (!products.employeePortal.css.includes('color-scheme: light')) fail('Employee Portal belum menjadi light self-service surface.');
if (!products.pos.css.includes('--v2-pos-accent: #22c6b7')) fail('POS belum memakai teal operations identity.');

const themeNames = new Set(Object.values(config.products).map((item) => item.theme));
if (themeNames.size !== 4) fail('theme tiap produk harus berbeda.');

console.log('P5 V2 art-direction audit PASS — 4 distinct product themes, glass/elevation present, no decorative gradients, human acceptance still required.');
