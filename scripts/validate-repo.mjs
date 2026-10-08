import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
let ts;
try {
  const module = await import('typescript');
  ts = module.default ?? module;
} catch (error) {
  console.error('Repository validation requires the project-local TypeScript dependency. Run `npm ci` from the repository root before `npm run validate:repo`.');
  throw error;
}

const root = process.cwd();
const failures = [];
const required = [
  'README.md', 'docs/DEVELOPMENT-KIT.md', 'docs/ADVANCED-DEVELOPMENT.md', 'docs/EXTENSION-GUIDE.md',
  'docs/LOCAL-NO-DOCKER.md', 'docs/DATABASE-PROFILES.md', 'docs/CI-TESTING.md',
  'docs/LARGE-SCALE-DATA.md', 'docs/PERFORMANCE-CHECKLIST.md', 'config/performance-budget.json',
  'docs/HRIS-ATTENDANCE-PAYROLL.md', 'docs/BIOMETRIC-LOCATION-SECURITY.md', 'docs/FINGERPRINT-INTEGRATION.md', 'docs/PAYROLL-TAX-INDONESIA.md',
  'docs/ENTERPRISE-ACCOUNTING-TAX.md', 'docs/ASSET-FLEET-OPERATIONS.md', 'docs/INBOUND-OUTBOUND-CONTROL.md', 'docs/AUTOMATION-RULEBOOK.md',
  'CONTRIBUTING.md', 'docs/DEVELOPMENT-WORKFLOW.md', 'docs/IMPLEMENTATION-ROADMAP.md', 'docs/AUTOMATED-WORK-STARTER.md', 'docs/QUALITY-GATES.md', 'docs/PROJECT-CHECKPOINTS.md', 'docs/GITHUB-SETUP.md', 'docs/PROJECT-STATE.md', 'docs/SESSION-HANDOFF.md', 'docs/adr/README.md',
  'config/workflow-policy.json', 'config/module-delivery-map.json', 'config/implementation-backlog.json', 'config/work-automation.json', 'work-items/README.md', 'scripts/workflow.mjs', 'scripts/start-work.mjs', 'scripts/validate-pr-policy.mjs',
  '.github/workflows/workflow-governance.yml', '.github/workflows/release-candidate.yml', '.github/ISSUE_TEMPLATE/bug.yml', '.github/ISSUE_TEMPLATE/database-change.yml', '.github/ISSUE_TEMPLATE/integration.yml', '.github/ISSUE_TEMPLATE/release.yml',
  '.env.local.example', '.env.postgres.example', 'scripts/setup-local.mjs', 'scripts/reset-local-db.mjs', 'scripts/run-quality-gate.mjs', 'scripts/generate-chat-context.mjs', 'scripts/create-chat-checkpoint.mjs',
  'apps/api/prisma/schema.prisma', 'apps/api/prisma/schema.sqlite.prisma', 'apps/api/prisma/schema.postgresql.prisma',
  'apps/api/src/app.module.ts', 'apps/employee-portal/app/page.tsx', 'packages/plugin-sdk/src/index.ts', '.github/workflows/ci.yml',
];
for (const file of required) {
  try { if (!statSync(join(root, file)).isFile()) failures.push(`Missing file: ${file}`); }
  catch { failures.push(`Missing file: ${file}`); }
}
if (existsSync(join(root, 'docker-compose.yml'))) failures.push('Root docker-compose.yml must not be required locally; keep CI-only Docker files under .github/ci.');

const ignoredInventoryDirs = new Set(['node_modules', '.git', '.next', 'dist', 'runtime']);
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name); const stat = statSync(path);
    const rel = relative(root, path).replaceAll('\\', '/');
    if (stat.isDirectory()) {
      if (ignoredInventoryDirs.has(name) || rel === 'handoff/quality' || rel === 'handoff/generated' || rel === 'logs') return [];
      return walk(path);
    }
    if (stat.isFile() && !rel.endsWith('.recovery-backup')) return [path];
    return [];
  });
}
const files = walk(root);
for (const file of files.filter((path) => path.endsWith('.json'))) {
  try { JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { failures.push(`${relative(root, file)} invalid JSON: ${error.message}`); }
}
for (const file of files.filter((path) => /\.(ts|tsx)$/.test(path) && !path.endsWith('.d.ts'))) {
  const source = readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, experimentalDecorators: true },
    reportDiagnostics: true,
    fileName: file,
  });
  for (const diagnostic of output.diagnostics ?? []) {
    failures.push(`${relative(root, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  }
}

function schemaInfo(file) {
  const schema = readFileSync(join(root, file), 'utf8');
  return {
    schema,
    models: [...schema.matchAll(/^model\s+(\w+)/gm)].map((match) => match[1]),
    enums: [...schema.matchAll(/^enum\s+(\w+)/gm)].map((match) => match[1]),
  };
}
const sqlite = schemaInfo('apps/api/prisma/schema.sqlite.prisma');
const postgres = schemaInfo('apps/api/prisma/schema.postgresql.prisma');
const canonical = schemaInfo('apps/api/prisma/schema.prisma');
for (const [name, info] of Object.entries({ sqlite, postgres, canonical })) {
  const duplicates = info.models.filter((model, index) => info.models.indexOf(model) !== index);
  if (duplicates.length) failures.push(`Duplicate Prisma models in ${name}: ${[...new Set(duplicates)].join(', ')}`);
}
if (JSON.stringify(sqlite.models) !== JSON.stringify(postgres.models)) failures.push('SQLite and PostgreSQL schemas must contain the same models in the same order.');
function normalizeProviderSchema(schema) {
  return schema
    .replace(/provider\s*=\s*"(?:sqlite|postgresql)"/, 'provider = "DATABASE"')
    .replace(/\s+@db\.Decimal\([^)]*\)/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}
if (normalizeProviderSchema(sqlite.schema) !== normalizeProviderSchema(postgres.schema)) failures.push('SQLite and PostgreSQL schemas differ beyond connector/native Decimal annotations.');
if (JSON.stringify(sqlite.enums) !== JSON.stringify(postgres.enums)) failures.push('SQLite and PostgreSQL schemas must contain the same enums in the same order.');
if (JSON.stringify(sqlite.models) !== JSON.stringify(canonical.models)) failures.push('Canonical schema.prisma must mirror the SQLite local schema.');
// Model-name comparison alone cannot see a field that exists in one schema and is missing
// from another. That is how Employee.settlementAccountCode and Employee.accountingEventId
// drifted out of the canonical schema while every gate stayed green. Compare the full body
// of every model, and name the offending model/field so the failure is actionable.
function modelBodies(schema) {
  const out = new Map();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    out.set(match[1], match[2]
      .split('\n')
      .map((line) => line.replace(/\s+@db\.\w+(\([^)]*\))?/g, '').trimEnd())
      .filter((line) => line.trim() && !/^\/\//.test(line.trim()))
      .map((line) => line.trim())
      .join('\n'));
  }
  return out;
}
for (const [label, left, right] of [
  ['canonical schema.prisma vs SQLite', canonical, sqlite],
  ['canonical schema.prisma vs PostgreSQL', canonical, postgres],
]) {
  const leftBodies = modelBodies(left.schema);
  const rightBodies = modelBodies(right.schema);
  for (const [model, rightBody] of rightBodies) {
    const leftBody = leftBodies.get(model);
    if (leftBody === undefined) { failures.push(`${label}: model ${model} is missing entirely.`); continue; }
    if (leftBody === rightBody) continue;
    const fieldNames = (body) => new Set([...body.matchAll(/^(\w+)\s+\S/gm)].map((m) => m[1]));
    const leftFields = fieldNames(leftBody);
    const rightFields = fieldNames(rightBody);
    const missing = [...rightFields].filter((f) => !leftFields.has(f));
    const extra = [...leftFields].filter((f) => !rightFields.has(f));
    if (missing.length) failures.push(`${label}: model ${model} is missing field(s): ${missing.join(', ')}.`);
    if (extra.length) failures.push(`${label}: model ${model} has field(s) not in the other schema: ${extra.join(', ')}.`);
    if (!missing.length && !extra.length) failures.push(`${label}: model ${model} has differing field types, attributes, or indexes.`);
  }
}
if (!/provider\s*=\s*"sqlite"/.test(sqlite.schema)) failures.push('SQLite schema must use provider="sqlite".');
if (!/provider\s*=\s*"postgresql"/.test(postgres.schema)) failures.push('PostgreSQL schema must use provider="postgresql".');
if (/@db\.Decimal/.test(sqlite.schema)) failures.push('SQLite schema cannot contain PostgreSQL native Decimal annotations.');
for (const expected of ['FeatureFlag','SystemSetting','ModuleDefinition','IntegrationConnection','EventOutbox','StockTransfer','StockOpname','InventoryBatch','InventorySerial','LoyaltyProgram','BankReconciliation','OfflineTransaction','ForecastRun','Shipment','IdempotencyReceipt','DailySalesSummary','DailyFinanceSummary','DailyInventorySummary','ReportJob','DataRetentionPolicy','DataArchiveRun','Employee','AttendanceEvent','AttendanceRecord','AttendanceGeofence','AttendanceDevice','EmployeeBiometricCredential','PayrollPeriod','PayrollRun','PayrollResult','PayrollLine','Payslip','TaxRuleSet','SocialSecurityRuleSet','EmployeeChannelBinding','EmployeeNotificationDelivery','DailyAttendanceSummary','PayrollPeriodSummary','AccountingEvent','AccountingPostingRule','TaxCode','TaxTransaction','Asset','Vehicle','DeliveryTrip','OperationalInspection','GatePass','OperationPolicy','AutomationJob','OperationalFinanceTransaction']) {
  if (!sqlite.models.includes(expected)) failures.push(`Missing Prisma model: ${expected}`);
}

const workflowPolicy = JSON.parse(readFileSync(join(root, 'config/workflow-policy.json'), 'utf8'));
const moduleDelivery = JSON.parse(readFileSync(join(root, 'config/module-delivery-map.json'), 'utf8'));
const waveIds = moduleDelivery.waves.map((wave) => wave.id);
if (new Set(waveIds).size !== waveIds.length) failures.push('Module delivery wave IDs must be unique.');
for (const wave of moduleDelivery.waves) {
  if (!Array.isArray(wave.exitCriteria) || wave.exitCriteria.length === 0) failures.push(`Delivery wave ${wave.id} must have exit criteria.`);
  for (const dependency of wave.dependsOn ?? []) if (!waveIds.includes(dependency)) failures.push(`Delivery wave ${wave.id} references unknown dependency ${dependency}.`);
}
for (const phase of ['INTAKE','ANALYSIS','DESIGN','IMPLEMENTATION','VERIFICATION','STAGING','RELEASE_READY','RELEASED','CLOSED','BLOCKED']) {
  if (!workflowPolicy.allowedPhases.includes(phase)) failures.push(`Workflow policy missing phase: ${phase}`);
}
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const script of ['work:auto','work:custom','work:resume','work:status','workflow:new','workflow:validate','workflow:status','workflow:advance','workflow:complete','quality:fast','quality:full','release:check']) {
  if (!rootPackage.scripts?.[script]) failures.push(`Missing package workflow script: ${script}`);
}
const developmentKit = readFileSync(join(root, 'docs/DEVELOPMENT-KIT.md'), 'utf8');
if (!/^## 43\. Workflow Pengembangan Resmi/m.test(developmentKit)) failures.push('Development Kit must contain section 43 Workflow Pengembangan Resmi.');
if (!/^## 44\. Otomatisasi Pekerjaan Satu Klik/m.test(developmentKit)) failures.push('Development Kit must contain section 44 Otomatisasi Pekerjaan Satu Klik.');


const implementationBacklog = JSON.parse(readFileSync(join(root, 'config/implementation-backlog.json'), 'utf8'));
const automationConfig = JSON.parse(readFileSync(join(root, 'config/work-automation.json'), 'utf8'));
const backlogKeys = implementationBacklog.items.map((item) => item.key);
if (new Set(backlogKeys).size !== backlogKeys.length) failures.push('Implementation backlog keys must be unique.');
const moduleByWave = new Map(moduleDelivery.waves.map((wave) => [wave.id, new Set(wave.modules)]));
for (const item of implementationBacklog.items) {
  if (!backlogKeys.includes(item.key)) failures.push('Backlog item missing key.');
  if (!waveIds.includes(item.wave)) failures.push(`Backlog ${item.key} references unknown wave ${item.wave}.`);
  if (!moduleByWave.get(item.wave)?.has(item.module) && item.module !== 'inbound-inspection') failures.push(`Backlog ${item.key} module ${item.module} is not registered in wave ${item.wave}.`);
  for (const dependency of item.dependencies ?? []) if (!backlogKeys.includes(dependency)) failures.push(`Backlog ${item.key} references unknown dependency ${dependency}.`);
  if (!workflowPolicy.allowedTypes.includes(item.type)) failures.push(`Backlog ${item.key} has invalid type ${item.type}.`);
  if (!workflowPolicy.allowedRisks.includes(item.risk)) failures.push(`Backlog ${item.key} has invalid risk ${item.risk}.`);
  if (!Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0) failures.push(`Backlog ${item.key} requires acceptance criteria.`);
  if (!Array.isArray(item.testPlan) || item.testPlan.length === 0) failures.push(`Backlog ${item.key} requires test plan.`);
}
if (automationConfig.agent?.enabled && !automationConfig.agent.command) failures.push('Enabled work automation agent requires a command.');

const envLocal = readFileSync(join(root, '.env.local.example'), 'utf8');
if (!/DATABASE_PROFILE=sqlite/.test(envLocal) || !/DATABASE_URL=file:/.test(envLocal)) failures.push('Local environment must default to SQLite file database.');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
if (/Prasyarat:[^\n]*Docker/i.test(readme)) failures.push('README must not require Docker for local setup.');

if (failures.length) {
  console.error('Repository validation failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log(`Repository validation passed: ${files.length} files, ${sqlite.models.length} Prisma models, SQLite local + PostgreSQL CI/production profiles.`);
