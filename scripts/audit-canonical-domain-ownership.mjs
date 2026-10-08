#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifestPath = path.join(root, 'config/canonical-domain-ownership.json');
const schemaPath = path.join(root, 'apps/api/prisma/schema.prisma');
const requiredDomains = ['inventory', 'returns', 'accounting', 'payments', 'notifications', 'payroll', 'assets', 'marketplace', 'summaries'];
const legacyTokens = ['/sale-returns', '/purchase-returns', "'sale-returns", '"sale-returns', "'purchase-returns", '"purchase-returns'];

function fail(message) {
  console.error(`Canonical ownership audit FAIL: ${message}`);
  process.exit(1);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`tidak dapat membaca ${path.relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`); }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(manifestPath)) fail('config/canonical-domain-ownership.json tidak tersedia.');
if (!fs.existsSync(schemaPath)) fail('Prisma schema tidak tersedia.');

const manifest = readJson(manifestPath);
if (manifest.phase !== 'P4') fail(`phase harus P4, actual=${manifest.phase}`);
if (manifest.status !== 'IMPLEMENTED_RUNTIME_PENDING' && manifest.status !== 'RUNTIME_VERIFIED') {
  fail(`status P4 tidak valid: ${manifest.status}`);
}

const configuredRequired = Array.isArray(manifest.requiredDomains) ? manifest.requiredDomains : [];
for (const domain of requiredDomains) if (!configuredRequired.includes(domain)) fail(`requiredDomains tidak memuat ${domain}`);

const domains = Array.isArray(manifest.domains) ? manifest.domains : [];
if (domains.length !== requiredDomains.length) fail(`domains harus tepat ${requiredDomains.length}, actual=${domains.length}`);
const ids = domains.map((entry) => entry.id);
if (new Set(ids).size !== ids.length) fail('domain id duplikat.');
for (const domain of requiredDomains) if (!ids.includes(domain)) fail(`domain ownership hilang: ${domain}`);

const prismaSchema = fs.readFileSync(schemaPath, 'utf8');
for (const entry of domains) {
  for (const field of ['id', 'canonicalOwner', 'canonicalPublicMutationSurface', 'controller', 'service', 'rule']) {
    if (!String(entry[field] || '').trim()) fail(`${entry.id}.${field} wajib diisi.`);
  }
  for (const sourceField of ['controller', 'service']) {
    const source = path.join(root, entry[sourceField]);
    if (!fs.existsSync(source)) fail(`${entry.id}.${sourceField} tidak ada: ${entry[sourceField]}`);
  }
  const models = [...(entry.sourceOfTruthModels || []), ...(entry.ledgerModels || [])];
  if (!models.length) fail(`${entry.id} tidak memiliki sourceOfTruthModels/ledgerModels.`);
  for (const model of models) {
    if (!new RegExp(`^model\\s+${model}\\s+\\{`, 'm').test(prismaSchema)) fail(`${entry.id} merujuk Prisma model yang tidak ada: ${model}`);
  }
  for (const writer of entry.sideEffectWriters || []) {
    if (!fs.existsSync(path.join(root, writer))) fail(`${entry.id} sideEffectWriter tidak ada: ${writer}`);
  }
  if (entry.worker && !fs.existsSync(path.join(root, entry.worker))) fail(`${entry.id}.worker tidak ada: ${entry.worker}`);
}

const aliases = Array.isArray(manifest.legacyAliases) ? manifest.legacyAliases : [];
for (const expected of ['/sale-returns*', '/purchase-returns*']) {
  const alias = aliases.find((entry) => entry.path === expected);
  if (!alias) fail(`legacy alias ${expected} belum dicatat.`);
  if (alias.status !== 'REMOVED_AFTER_COMPATIBILITY_VERIFICATION') fail(`${expected} belum berstatus REMOVED_AFTER_COMPATIBILITY_VERIFICATION.`);
  if (!String(alias.canonicalReplacement || '').startsWith('/returns/')) fail(`${expected} canonical replacement harus /returns/*.`);
}

const activeSourceRoots = ['apps', 'packages'].map((name) => path.join(root, name));
const legacyHits = [];
for (const sourceRoot of activeSourceRoots) {
  for (const file of walk(sourceRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    if (legacyTokens.some((token) => text.includes(token))) legacyHits.push(path.relative(root, file));
  }
}
if (legacyHits.length) fail(`legacy return alias masih dipakai source aktif: ${legacyHits.join(', ')}`);

const returnsController = fs.readFileSync(path.join(root, 'apps/api/src/returns/returns.controller.ts'), 'utf8');
for (const route of ["@Controller('returns')", "@Post('sales')", "@Post('sales/:id/confirm')", "@Post('purchases')", "@Post('purchases/:id/confirm')", "@Post('orders/:id/confirm')"]) {
  if (!returnsController.includes(route)) fail(`canonical returns route hilang: ${route}`);
}
const extensionsController = fs.readFileSync(path.join(root, 'apps/api/src/extensions/extensions.controller.ts'), 'utf8');
if (/sale-returns|purchase-returns/.test(extensionsController)) fail('ExtensionsController masih mengekspos legacy return alias.');

console.log(`Canonical ownership audit PASS — ${domains.length} domain ownership records, legacy return aliases removed, active consumers clean.`);
