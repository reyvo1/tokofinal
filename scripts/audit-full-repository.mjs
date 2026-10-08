#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const v4ContractPath = path.join(root, 'config/p5-v4-total-ui-rebuild.json');
const v4Contract = fs.existsSync(v4ContractPath) ? JSON.parse(fs.readFileSync(v4ContractPath, 'utf8')) : null;
const controlledGradientsAllowed = v4Contract?.phase === 'P5-V4' && v4Contract?.decision?.controlledDecorativeGradientsAllowed === true;
const output = path.join(root, 'handoff/quality/full-repository-audit-latest.json');
const ignored = new Set(['node_modules','.next','dist','build','coverage','.git','backups','backup','.turbo','.cache','runtime']);
const ignoredRepoPrefixes = ['handoff/quality/','handoff/generated/','logs/'];
const sourceExt = new Set(['.ts','.tsx','.js','.mjs','.cjs','.css','.scss','.json','.md','.yml','.yaml','.prisma','.sql','.ps1','.cmd']);

function walk(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, list);
    else if (entry.isFile()) list.push(abs);
  }
  return list;
}
function rel(file) { return path.relative(root, file).replaceAll('\\','/'); }
function text(file) { try { return fs.readFileSync(file,'utf8'); } catch { return ''; } }
function countMatches(value, re) { return [...value.matchAll(re)].length; }

const files = walk(root).filter((file) => !ignoredRepoPrefixes.some((prefix) => rel(file).startsWith(prefix)) && !rel(file).endsWith('.recovery-backup'));
const repoFiles = files.filter((f) => sourceExt.has(path.extname(f).toLowerCase()));
const controllerFiles = files.filter((f) => rel(f).startsWith('apps/api/src/') && f.endsWith('.controller.ts'));
let apiHandlers = 0;
for (const file of controllerFiles) apiHandlers += countMatches(text(file), /@(Get|Post|Put|Patch|Delete)\s*\(/g);
const prismaFiles = files.filter((f) => f.endsWith('.prisma'));
let prismaModels = 0;
for (const file of prismaFiles) if (rel(file).includes('apps/api/prisma/schema.')) prismaModels = Math.max(prismaModels, countMatches(text(file), /^model\s+\w+/gm));
const uiRoots = ['apps/admin','apps/pos','apps/storefront','apps/employee-portal'];
const ui = {};
const critical = [];
for (const app of uiRoots) {
  const appFiles = files.filter((f) => rel(f).startsWith(`${app}/`));
  const tsx = appFiles.filter((f) => f.endsWith('.tsx'));
  const css = appFiles.filter((f) => f.endsWith('.css'));
  const tsxText = tsx.map(text).join('\n');
  const cssText = css.map(text).join('\n');
  const postcss = path.join(root, app, 'postcss.config.mjs');
  const globals = path.join(root, app, 'app/globals.css');
  const horizontalOverflowBlocks = [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => /overflow-x\s*:\s*auto/i.test(match[2]));
  // Allow-list "bounded horizontal scroller": container tabel boleh overflow-x:auto karena
  // isinya memang lebih lebar dan bisa digeser.
  // Dua nama, alasan berbeda:
  // - .hrTable  : Employee Portal. Sengaja tidak memakai `table` karena itu utilitas
  //               Tailwind (display:table) yang menimpa styling hand-written.
  // - .table    : Admin. Tetap dipakai dan aman karena rule-nya eksplisit menulis
  //               `display:block`, sehingga utilitas Tailwind tidak bisa menimpanya.
  //              Unlayered CSS menang atas utility Tailwind yang berlapis.
  const boundedHorizontalScrollerCount = horizontalOverflowBlocks.filter((match) => /(?:^|,)\s*\.(?:hrTable|table)\b/.test(match[1])).length;
  const horizontalPrimaryOverflowCount = horizontalOverflowBlocks.length - boundedHorizontalScrollerCount;
  const checks = {
    postcssConfig: fs.existsSync(postcss),
    tailwindImport: fs.existsSync(globals) && /@import\s+["']tailwindcss["']/.test(text(globals)),
    decorativeGradientCount: countMatches(cssText, /(linear-gradient|radial-gradient|conic-gradient)\s*\(/gi),
    horizontalPrimaryOverflowCount,
    boundedHorizontalScrollerCount,
    forcedWideTableCount: countMatches(cssText, /min-width\s*:\s*(?:[7-9]\d\d|\d{4,})px/gi),
    nativePromptCount: countMatches(tsxText, /\b(?:alert|confirm|prompt)\s*\(/g),
    interactiveElements: countMatches(tsxText, /<(?:button|a)\b/g),
  };
  if (!checks.postcssConfig) critical.push(`${app}: postcss.config.mjs tidak ada`);
  if (!checks.tailwindImport) critical.push(`${app}: globals.css belum memakai Tailwind`);
  if (checks.decorativeGradientCount && !controlledGradientsAllowed) critical.push(`${app}: decorative gradient masih ada (${checks.decorativeGradientCount})`);
  if (checks.horizontalPrimaryOverflowCount) critical.push(`${app}: overflow-x:auto masih ada (${checks.horizontalPrimaryOverflowCount})`);
  if (checks.forcedWideTableCount) critical.push(`${app}: forced wide table masih ada (${checks.forcedWideTableCount})`);
  if (checks.nativePromptCount) critical.push(`${app}: native prompt/alert/confirm masih ada (${checks.nativePromptCount})`);
  ui[app] = { files: appFiles.length, tsxFiles: tsx.length, cssFiles: css.length, controlledGradientPolicy: controlledGradientsAllowed ? 'P5-V4_CONTROLLED_ALLOWED' : 'FORBIDDEN', ...checks };
}

const navigation = text(path.join(root,'apps/admin/app/navigation.ts'));
const domains = text(path.join(root,'apps/admin/app/domain-workspaces.ts'));
for (const expected of ['Forecast & Otomasi','Integrasi & Notifikasi','Tenant & Organisasi','Pengaturan & Akses']) if (!navigation.includes(expected)) critical.push(`Admin navigation belum memuat ${expected}`);
for (const expected of ['Telegram & WhatsApp','Notification Center','Integrasi Eksternal','AI Assistant','Forecast','Cabang & Gudang','User & Role','Security','API Key']) if (!domains.includes(expected)) critical.push(`Admin domain workspace belum memuat ${expected}`);
for (const legacy of ['className="workspaceRail"','className="domainDeck"','className="domainContext"','className="statusbar"']) if (text(path.join(root,'apps/admin/app/app-shell.tsx')).includes(legacy)) critical.push(`Admin shell masih merender legacy layer ${legacy}`);

const audit = {
  generatedAt: new Date().toISOString(), status: critical.length ? 'FAIL' : 'PASS', sourceIdentity: sourceFingerprint(root),
  inventory: {
    totalFiles: files.length, auditableFiles: repoFiles.length, controllerFiles: controllerFiles.length, apiHandlers,
    prismaModels, workflows: files.filter((f) => rel(f).startsWith('.github/workflows/') && /\.ya?ml$/.test(f)).length,
    tests: files.filter((f) => rel(f).startsWith('tests/') && /\.test\.mjs$/.test(f)).length,
    migrations: files.filter((f) => rel(f).includes('/migrations/') && /\.(sql|mjs|js)$/.test(f)).length,
    docs: files.filter((f) => /\.(md|txt)$/.test(f) && (rel(f).startsWith('docs/') || rel(f).startsWith('instructions/') || rel(f).startsWith('handoff/') || rel(f)==='AGENTS.md')).length,
  },
  ui,
  featurePlacement: {
    tenant: 'Tenant & Organisasi > Cabang & Gudang',
    users: 'Pengaturan & Akses > User & Role',
    security: 'Pengaturan & Akses > Security / API Key',
    telegramWhatsapp: 'Integrasi & Notifikasi > Telegram & WhatsApp',
    providerIntegrations: 'Integrasi & Notifikasi > Integrasi Eksternal',
    notifications: 'Integrasi & Notifikasi > Notification Center',
    ai: 'Forecast & Otomasi > AI Assistant / Forecast',
  },
  blockers: critical,
  note: 'Structural source audit only. Generated/runtime evidence is excluded. PASS does not mean product completeness; canonical capability truth is config/product-completeness.json and semantic runtime/human acceptance remain separate.',
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(audit,null,2)}\n`);
console.log(`Full repository audit ${audit.status}: ${audit.inventory.totalFiles} files, ${apiHandlers} API handlers, ${Object.values(ui).reduce((n,x)=>n+x.interactiveElements,0)} UI interactive elements.`);
if (critical.length) { for (const item of critical) console.error(`BLOCKER: ${item}`); process.exit(1); }
