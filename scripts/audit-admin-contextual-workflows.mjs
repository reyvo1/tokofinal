import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const domainFile = path.join(root, 'apps/admin/app/domain-workspaces.ts');
const mapFile = path.join(root, 'config/admin-contextual-workflow-map.json');
const pageFile = path.join(root, 'apps/admin/app/page.tsx');
const shellFile = path.join(root, 'apps/admin/app/app-shell.tsx');
const browserFile = path.join(root, 'scripts/browser-uat.mjs');

function fail(message) {
  console.error(`Admin contextual workflow audit FAIL: ${message}`);
  process.exit(1);
}

const domainSource = fs.readFileSync(domainFile, 'utf8');
const pageSource = fs.readFileSync(pageFile, 'utf8');
const shellSource = fs.readFileSync(shellFile, 'utf8');
const browserSource = fs.readFileSync(browserFile, 'utf8');
const mapping = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

const workspaceStarts = [...domainSource.matchAll(/\{ workspaceKey: '([^']+)', views:\s*\[/g)];
const expected = [];
for (let index = 0; index < workspaceStarts.length; index += 1) {
  const match = workspaceStarts[index];
  const end = index + 1 < workspaceStarts.length ? workspaceStarts[index + 1].index : domainSource.indexOf('];', match.index);
  const block = domainSource.slice(match.index + match[0].length, end);
  for (const view of block.matchAll(/\{ key: '([^']+)'/g)) expected.push(`${match[1]}/${view[1]}`);
}

if (expected.length !== mapping.expectedContextualViews) fail(`domain source has ${expected.length} contextual views; mapping expects ${mapping.expectedContextualViews}`);
if (mapping.rows.length !== mapping.expectedContextualViews) fail(`mapping contains ${mapping.rows.length} rows; expected ${mapping.expectedContextualViews}`);

const mapped = new Map();
for (const row of mapping.rows) {
  const key = `${row.workspace}/${row.view}`;
  if (mapped.has(key)) fail(`duplicate mapping ${key}`);
  if (row.status !== 'SOURCE_IMPLEMENTED') fail(`${key} is not SOURCE_IMPLEMENTED`);
  if (!row.renderer || !row.sourceFile) fail(`${key} is missing renderer/sourceFile`);
  if (!fs.existsSync(path.join(root, row.sourceFile))) fail(`${key} source file does not exist: ${row.sourceFile}`);
  mapped.set(key, row);
}
for (const key of expected) if (!mapped.has(key)) fail(`missing contextual mapping ${key}`);
for (const key of mapped.keys()) if (!expected.includes(key)) fail(`stale contextual mapping ${key}`);

for (const key of ['master-data/catalog','master-data/customers']) if (!mapped.has(key)) fail(`Master Data semantic route missing: ${key}`);
const masterDataSource = fs.readFileSync(path.join(root, 'apps/admin/app/modules/master-data.tsx'), 'utf8');
for (const contract of ["mode==='catalog'","mode==='customers'","Tambah kategori utama","Tambah subkategori"]) {
  if (!masterDataSource.includes(contract)) fail(`Master Data discoverability contract missing: ${contract}`);
}
if (domainSource.includes("label: 'Kategori & Customer'")) fail('Master Data still combines Category and Customer in one contextual label');

const requiredShellContracts = [
  [/const effectiveDomainView = activeDomainView \?\? domainViews\[0\] \?\? null/, 'effective contextual view'],
  [/data-admin-workspace=\{activeWorkspace\.key\}/, 'workspace marker'],
  [/data-admin-view=\{effectiveDomainView\?\.key \?\? (?:''|"")\}/, 'contextual view marker'],
  [/const selected = active && effectiveDomainView\?\.key === view\.key/, 'contextual active state'],
  [/aria-current=\{selected \? 'page' : undefined\}/, 'contextual aria-current'],
];
for (const [contract, label] of requiredShellContracts) if (!contract.test(shellSource)) fail(`Admin shell contextual semantic contract missing: ${label}`);

const criticalRuntimeRoutes = ['/integrations/notifications','/operations-control/delivery','/people/payroll','/people/employees'];
for (const route of criticalRuntimeRoutes) {
  const key = route.slice(1);
  if (!mapped.has(key)) fail(`critical Browser UAT route is not canonical: ${route}`);
  if (!browserSource.includes(`navigateAdminContext(cdp, '${route}'`)) fail(`Browser UAT does not use canonical contextual navigation for ${route}`);
}
if (browserSource.includes('data-admin-route="/assets-fleet"') && browserSource.includes('Outbound / Delivery Lifecycle')) fail('Browser UAT still binds Delivery Lifecycle to stale /assets-fleet workspace');

const requiredPageContracts = [
  "commerceSection=\"orders\"",
  "commerceSection=\"fulfillment\"",
  "<OperationsView token={token} mode=\"returns\" />",
  "activeDomainView.key === 'requests'",
  "activeDomainView?.key === 'receipts'",
  "mode={(activeDomainView?.key ?? 'overview') as 'overview'|'traceability'|'transfers'|'stocktake'|'returns'}",
  "activeDomainView?.key === 'delivery' ? <DeliveryLifecycle",
  "<ReportingWorkspace token={token} mode=\"operations\" />",
  "<AssetsFleetView token={token} mode={(activeDomainView?.key ?? 'assets')",
  "<AiWorkspace token={token} mode=\"forecast\" />",
  "<AutomationWorkspace token={token} mode=\"schedules\" />",
  "<ExtensionsView token={token} mode=\"notifications\" />",
  "<R3OperationsView token={token} mode=\"devices\" />",
];
for (const contract of requiredPageContracts) if (!pageSource.includes(contract)) fail(`page contextual contract missing: ${contract}`);

const modeContracts = [
  ['apps/admin/app/modules/operations.tsx', "type InventoryControlMode = 'overview' | 'traceability' | 'transfers' | 'stocktake' | 'returns'"],
  ['apps/admin/app/modules/operations-control.tsx', "type OperationsControlMode = 'inspections' | 'evidence' | 'gate-pass'"],
  ['apps/admin/app/modules/assets-fleet.tsx', "type AssetsFleetMode = 'assets' | 'maintenance' | 'vehicles' | 'trips'"],
  ['apps/admin/app/modules/reporting-workspace.tsx', "type ReportingMode = 'financial' | 'operations' | 'scheduled'"],
  ['apps/admin/app/modules/ai-workspace.tsx', "type IntelligenceMode = 'ai' | 'forecast'"],
  ['apps/admin/app/modules/automation-workspace.tsx', "type AutomationMode = 'automation' | 'schedules'"],
  ['apps/admin/app/modules/r3-operations.tsx', "type R3OperationsMode = 'reporting' | 'devices' | 'connections'"],
  ['apps/admin/app/modules/extensions.tsx', "commerceSection?: 'orders' | 'fulfillment' | 'channels'"],
];
for (const [file, token] of modeContracts) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (!source.includes(token)) fail(`${file} missing mode contract ${token}`);
}

console.log(`Admin contextual workflow audit PASS: ${expected.length}/${mapping.expectedContextualViews} contextual destinations mapped; ${workspaceStarts.length} contextual workspaces verified.`);
