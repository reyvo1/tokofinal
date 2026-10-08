import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const matrix = JSON.parse(readFileSync(join(root, 'config/recovery-finding-matrix.json'), 'utf8'));
const allowedWaves = new Set(['R0','R1','R2','R3','R4','R5','R6','R7','R8']);
const ids = matrix.findings.map((item) => item.id);
const uniqueIds = new Set(ids);

if (matrix.findingCount !== 48 || matrix.findings.length !== 48 || uniqueIds.size !== 48) {
  throw new Error(`Recovery finding coverage invalid: declared=${matrix.findingCount} rows=${matrix.findings.length} unique=${uniqueIds.size}`);
}
for (let i = 1; i <= 48; i += 1) {
  const id = `F${String(i).padStart(2, '0')}`;
  if (!uniqueIds.has(id)) throw new Error(`Missing recovery finding ${id}`);
}
for (const item of matrix.findings) {
  if (!allowedWaves.has(item.primaryWave)) throw new Error(`Invalid primary wave for ${item.id}: ${item.primaryWave}`);
  if (item.secondaryWave && !allowedWaves.has(item.secondaryWave)) throw new Error(`Invalid secondary wave for ${item.id}: ${item.secondaryWave}`);
  if (!item.closureRequirement?.trim()) throw new Error(`Missing closure requirement for ${item.id}`);
  if (!item.status?.trim()) throw new Error(`Missing status for ${item.id}`);
}
if (matrix.unmappedFindingCount !== 0) throw new Error(`Recovery matrix still has ${matrix.unmappedFindingCount} unmapped findings`);

const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
const prismaModels = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].length;

const walk = (dir, suffix) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, suffix));
    else if (!suffix || full.endsWith(suffix)) out.push(full);
  }
  return out;
};
const controllers = walk(join(root, 'apps/api/src'), '.controller.ts');
let apiHandlers = 0;
for (const file of controllers) {
  const source = readFileSync(file, 'utf8');
  apiHandlers += [...source.matchAll(/@(Get|Post|Put|Patch|Delete)\s*\(/g)].length;
}
const uiFiles = [
  ...walk(join(root, 'apps/admin/app'), '.tsx'),
  ...walk(join(root, 'apps/pos/app'), '.tsx'),
  ...walk(join(root, 'apps/storefront/app'), '.tsx'),
  ...walk(join(root, 'apps/employee-portal/app'), '.tsx'),
];
let uiControls = 0;
for (const file of uiFiles) {
  const source = readFileSync(file, 'utf8');
  uiControls += [...source.matchAll(/<button\b([^>]*)>/g)].length;
  uiControls += [...source.matchAll(/<a\b([^>]*)>/g)].length;
}

if (prismaModels < matrix.sourceSnapshot.prismaModels) {
  throw new Error(`Recovery baseline regression: Prisma models dropped below R0 floor ${matrix.sourceSnapshot.prismaModels} -> ${prismaModels}.`);
}
if (apiHandlers < matrix.sourceSnapshot.apiHandlers) {
  throw new Error(`Recovery baseline regression: API handlers dropped below R0 floor ${matrix.sourceSnapshot.apiHandlers} -> ${apiHandlers}.`);
}
if (uiControls < matrix.sourceSnapshot.uiInteractiveElements) {
  throw new Error(`Recovery baseline regression: UI controls dropped below R0 floor ${matrix.sourceSnapshot.uiInteractiveElements} -> ${uiControls}.`);
}

const counts = Object.fromEntries([...allowedWaves].map((wave) => [wave, matrix.findings.filter((item) => item.primaryWave === wave).length]));
console.log(`Recovery audit PASS: 48/48 mapped, 0 unmapped, ${prismaModels} Prisma models, ${apiHandlers} API handlers, ${uiControls} UI controls.`);
console.log(`Primary wave distribution: ${JSON.stringify(counts)}`);
