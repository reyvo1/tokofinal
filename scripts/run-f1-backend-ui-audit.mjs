import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function walk(dir, predicate = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function unique(values) {
  return [...new Set(values)].sort();
}

function includesAny(text, patterns) {
  return patterns.some((p) => typeof p === 'string' ? text.includes(p) : p.test(text));
}

const controllerFiles = walk(path.join(root, 'apps', 'api', 'src'), (f) => f.endsWith('.controller.ts'));
const apiSourceFiles = walk(path.join(root, 'apps', 'api', 'src'), (f) => /\.(ts|tsx)$/.test(f));
const workerFiles = walk(path.join(root, 'apps', 'worker', 'src'), (f) => /\.(ts|tsx|js|mjs)$/.test(f));
const uiApps = ['admin', 'pos', 'storefront', 'employee-portal'];
const uiFiles = uiApps.flatMap((app) =>
  walk(path.join(root, 'apps', app), (f) => /\.(ts|tsx|js|jsx)$/.test(f)).map((file) => ({ app, file }))
);

const apiText = apiSourceFiles.map(read).join('\n');
const workerText = workerFiles.map(read).join('\n');
const uiTextByApp = Object.fromEntries(uiApps.map((app) => [
  app,
  uiFiles.filter((x) => x.app === app).map((x) => read(x.file)).join('\n'),
]));
const uiText = Object.values(uiTextByApp).join('\n');

const schemaCandidates = [
  path.join(root, 'apps', 'api', 'prisma', 'schema.prisma'),
  path.join(root, 'apps', 'api', 'prisma', 'schema.postgresql.prisma'),
];
const schemaFile = schemaCandidates.find(fs.existsSync);
if (!schemaFile) throw new Error('Prisma schema tidak ditemukan.');
const schemaText = read(schemaFile);
const models = unique([...schemaText.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));

const routes = [];
for (const file of controllerFiles) {
  const text = read(file);
  const controller = text.match(/@Controller\(([^)]*)\)/s);
  const base = controller?.[1]?.match(/['"]([^'"]+)['"]/)?.[1] ?? '';
  const methodRe = /@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/g;
  for (const match of text.matchAll(methodRe)) {
    const sub = match[2]?.match(/['"]([^'"]*)['"]/)?.[1] ?? '';
    const route = `/${base.replace(/^\/|\/$/g, '')}/${sub.replace(/^\/|\/$/g, '')}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    routes.push({ file: rel(file), method: match[1].toUpperCase(), route });
  }
}

function routesMatching(prefixes) {
  return routes.filter((r) => prefixes.some((prefix) => r.route.startsWith(prefix)));
}

function uiAppsUsing(markers) {
  return uiApps.filter((app) => includesAny(uiTextByApp[app], markers));
}

function modelPresence(names) {
  return names.filter((name) => models.includes(name));
}

const capabilities = [
  {
    id: 'F2',
    title: 'Master Product + Multi-UOM',
    targetPhase: 'F2',
    backendMarkers: ['ProductBarcode', 'ProductPrice', 'ProductPriceHistory', 'MasterReference'],
    requiredModels: ['Product', 'ProductBarcode', 'ProductPrice'],
    routePrefixes: ['/products', '/master-data/products', '/master-data/references'],
    uiMarkers: ['quantityFactor', 'unitCode', 'multi-UOM', 'Konversi Unit', 'Barcode & Konversi Unit'],
    missingMarkers: ['ProductVariant', 'ProductUnitConversion'],
    assessment() {
      const hasConversion = includesAny(apiText + schemaText, ['quantityFactor', 'unitCode']);
      const hasUi = includesAny(uiText, this.uiMarkers);
      const noVariant = !models.includes('ProductVariant');
      return hasConversion && hasUi && noVariant ? 'PARTIAL' : hasConversion && hasUi ? 'EXPOSED' : hasConversion ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Multi-UOM berbasis barcode/factor sudah ada, tetapi ProductVariant dan model konversi UOM first-class belum terlihat sebagai model dedicated. F2 harus menormalkan master produk/variant/UOM tanpa merusak POS yang sudah memakai quantityFactor.'
  },
  {
    id: 'F3',
    title: 'Inventory / batch / expiry / condition',
    targetPhase: 'F3',
    requiredModels: ['Inventory','InventoryMovement','WarehouseLocation','InventoryLocationBalance','InventoryBatch','InventorySerial','StockTransfer','StockOpname'],
    routePrefixes: ['/inventory', '/advanced-inventory', '/inventory-batches', '/inventory-serials'],
    uiMarkers: ['inventory-batches', 'inventory-serials', 'stock-opname', 'Traceability', 'Batch & serial'],
    assessment() {
      const core = this.requiredModels.every((m) => models.includes(m));
      const ui = includesAny(uiText, this.uiMarkers);
      const conditionFirstClass = includesAny(schemaText, [/InventoryCondition/i, /condition\s+/i]);
      return core && ui && !conditionFirstClass ? 'PARTIAL' : core && ui ? 'EXPOSED' : core ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Batch, serial, location, transfer, opname sudah kuat. Condition bucket general seperti AVAILABLE/DAMAGED/QUARANTINE/LOST belum terlihat sebagai inventory condition ledger first-class.'
  },
  {
    id: 'F4',
    title: 'Accounting workspace enterprise',
    targetPhase: 'F4',
    requiredModels: ['Account','JournalEntry','JournalLine','AccountingEvent','AccountingEventLine','AccountingPostingRule','AccountingPosting','AccountingCloseControl'],
    routePrefixes: ['/accounting-core'],
    uiMarkers: ['/accounting-core/accounts','/accounting-core/events','Jurnal & Ledger'],
    assessment() {
      const core = this.requiredModels.every((m) => models.includes(m));
      const ui = includesAny(uiTextByApp.admin, this.uiMarkers);
      const postingRulesUi = uiTextByApp.admin.includes('/accounting-core/posting-rules');
      return core && ui && !postingRulesUi ? 'PARTIAL' : core && ui ? 'EXPOSED' : core ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Accounting core kuat dan UI ledger sudah ada, tetapi posting rule/account mapping/version management serta source→event→journal→line drill-down belum terbukti lengkap di operator UI.'
  },
  {
    id: 'F5',
    title: 'Tax workspace dinamis',
    targetPhase: 'F5',
    requiredModels: ['TaxCode','TaxTransaction','TaxDocument','TaxRuleSet','TaxRule'],
    routePrefixes: ['/accounting-core/tax', '/accounting-core/tax-codes', '/payroll/tax-rule-sets'],
    uiMarkers: ['/accounting-core/tax-codes','TAX_SUMMARY','tax-rule-sets'],
    assessment() {
      const core = this.requiredModels.every((m) => models.includes(m));
      const ui = includesAny(uiTextByApp.admin, this.uiMarkers);
      const deepUi = includesAny(uiTextByApp.admin, ['TaxTransaction','TaxDocument','tax/preview','effectiveFrom','effectiveTo']);
      return core && ui && !deepUi ? 'PARTIAL' : core && ui ? 'EXPOSED' : core ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Tax engine/model tersedia, tetapi tax transaction/document ledger, effective-dated rule management, preview, reconciliation, dan audit trail belum seluruhnya terekspos di UI.'
  },
  {
    id: 'F6',
    title: 'Financial reporting + drill-down',
    targetPhase: 'F6',
    requiredModels: ['ReportJob','DailySalesSummary','DailyFinanceSummary','DailyInventorySummary'],
    routePrefixes: ['/reports'],
    uiMarkers: ['/reports/jobs','PROFIT_LOSS','BALANCE_SHEET','GENERAL_LEDGER','TRIAL_BALANCE','TAX_SUMMARY'],
    assessment() {
      const core = models.includes('ReportJob') && routesMatching(['/reports']).length > 0;
      const ui = includesAny(uiTextByApp.admin, this.uiMarkers);
      const drill = includesAny(uiTextByApp.admin, ['journalEntry', 'referenceId', 'drill']);
      return core && ui && !drill ? 'PARTIAL' : core && ui ? 'EXPOSED' : core ? 'HIDDEN' : 'MISSING';
    },
    gap: 'ReportJob dan katalog report tersedia. F6 harus menambah dynamic filters, period comparison, branch/cost-center dimensions, dan report→account→journal→source drill-down.'
  },
  {
    id: 'F7',
    title: 'AR / AP / Cash / Bank / Reconciliation',
    targetPhase: 'F7',
    requiredModels: ['BankStatement','BankStatementLine','BankReconciliation','OperationalFinanceTransaction'],
    routePrefixes: ['/finance-operations','/finance/bank-statements','/finance/reconciliations','/finance/fiscal-periods'],
    uiMarkers: ['supplier-payables','customer-receivables','bank-statements','reconciliations'],
    assessment() {
      const core = this.requiredModels.every((m) => models.includes(m));
      const ui = includesAny(uiTextByApp.admin, this.uiMarkers);
      const aging = includesAny(apiText + uiTextByApp.admin, [/aging/i, /bucket.*30/i]);
      return core && ui && !aging ? 'PARTIAL' : core && ui ? 'EXPOSED' : core ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Operational AP/AR dan bank reconciliation sudah ada. Aging, statement/detail navigation, settlement trace, dan reconciliation operator flow perlu diperdalam.'
  },
  {
    id: 'F8',
    title: 'Automation + scheduled reports',
    targetPhase: 'F8',
    requiredModels: ['BusinessRule','AutomationJob','EventOutbox','ReportJob'],
    routePrefixes: ['/platform/automation-jobs','/reports'],
    uiMarkers: ['automation-jobs','scheduled','schedule'],
    assessment() {
      const core = models.includes('AutomationJob') && includesAny(workerText, ['processAutomationJobs']);
      const ui = includesAny(uiTextByApp.admin, this.uiMarkers);
      const scheduleModel = models.some((m) => /ReportSchedule|ScheduleRule/.test(m));
      return core && (!ui || !scheduleModel) ? 'PARTIAL' : core && ui ? 'EXPOSED' : core ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Automation worker tersedia, tetapi scheduler/report schedule first-class dan operator execution history/rule management belum lengkap.'
  },
  {
    id: 'F9',
    title: 'WhatsApp / Telegram notification center',
    targetPhase: 'F9',
    requiredModels: ['NotificationTemplate','Notification','IntegrationConnection','EmployeeChannelBinding','EmployeeNotificationDelivery'],
    routePrefixes: ['/notifications','/integrations'],
    uiMarkers: ['WHATSAPP','TELEGRAM','/notifications/templates','/notifications'],
    assessment() {
      const core = models.includes('NotificationTemplate') && models.includes('Notification');
      const adapters = includesAny(workerText, ['TELEGRAM_BOT_TOKEN','WHATSAPP_PROVIDER_URL','WHATSAPP_PROVIDER_TOKEN']);
      const ui = includesAny(uiTextByApp.admin, this.uiMarkers);
      const productionReadyFalse = includesAny(apiText, ["id: 'whatsapp-template'", "productionReady: false", "id: 'telegram-bot-api'"]);
      return core && adapters && ui && productionReadyFalse ? 'PARTIAL' : core && adapters && ui ? 'EXPOSED' : core ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Template, queue, Telegram worker, WhatsApp provider adapter, dan UI queue sudah ada. Provider setup/verification, channel binding UX, scheduled report destinations, retry diagnostics, dan production readiness masih harus dituntaskan.'
  },
  {
    id: 'F10',
    title: 'AI / forecasting / operator assistant',
    targetPhase: 'F10',
    requiredModels: ['ForecastRun','ReorderSuggestion','OperatorInsight','AssistantInteraction'],
    routePrefixes: ['/forecasts','/operator-insights','/operator-assistant'],
    uiMarkers: ['/forecasts','/operator-insights','/operator-assistant/query','confidence','sourceLinks','HUMAN_CONFIRMATION_REQUIRED'],
    assessment() {
      const modelsReady = this.requiredModels.every((m) => models.includes(m));
      const forecastRoutes = routesMatching(['/forecasts']).length >= 3;
      const assistantRoutes = routesMatching(['/operator-insights','/operator-assistant']).length >= 4;
      const uiReady = includesAny(uiTextByApp.admin, this.uiMarkers)
        && includesAny(uiTextByApp.admin, ['DETERMINISTIC_RULE_BASED','Analisis sumber','Operator insights']);
      const sourceLinked = includesAny(apiText + uiText, ['sourceLinks','HUMAN_CONFIRMATION_REQUIRED','confidence']);
      return modelsReady && forecastRoutes && assistantRoutes && uiReady && sourceLinked ? 'EXPOSED'
        : (models.includes('ForecastRun') && forecastRoutes) ? 'PARTIAL' : 'MISSING';
    },
    gap: 'Source implementation lengkap: explainable forecast/reorder, permission-scoped deterministic operator assistant, anomaly insights, confidence, source links, dan human-confirmation guardrail tersedia. Runtime/browser/human UAT tetap wajib sebelum closure.'
  },
  {
    id: 'F11',
    title: 'Purchase / Sales / POS integration ke UOM baru',
    targetPhase: 'F11',
    requiredModels: ['PurchaseOrder','PurchaseOrderItem','GoodsReceipt','GoodsReceiptItem','Sale','SaleItem','ProductBarcode','ProductPrice'],
    routePrefixes: ['/purchase-orders','/purchase-requests','/goods-receipts','/sales','/orders'],
    uiMarkers: ['quantityFactor','unitCode','barcodeCode','sellingUnitPrice'],
    assessment() {
      const pos = includesAny(uiTextByApp.pos, ['quantityFactor','unitCode','barcodeCode']);
      const sales = includesAny(apiText, ['quantityFactor','baseQuantity','sourceBarcode']);
      const purchaseUom = includesAny(apiText, [/purchase.*unitCode/i, /ordered.*unitCode/i, /purchase.*quantityFactor/i]);
      return pos && sales && !purchaseUom ? 'PARTIAL' : pos && sales && purchaseUom ? 'EXPOSED' : sales ? 'HIDDEN' : 'MISSING';
    },
    gap: 'Sales/POS multi-UOM sudah jauh lebih matang. Purchase request/PO/receipt masih berbasis orderedQty/unitCost tanpa purchase UOM conversion first-class; ini blocker utama F11.'
  },
];

const results = capabilities.map((cap) => {
  const status = cap.assessment();
  const matchedRoutes = routesMatching(cap.routePrefixes);
  return {
    id: cap.id,
    title: cap.title,
    targetPhase: cap.targetPhase,
    status,
    requiredModels: cap.requiredModels ?? [],
    presentModels: modelPresence(cap.requiredModels ?? []),
    backendRouteCount: matchedRoutes.length,
    backendRoutes: matchedRoutes.map((r) => `${r.method} ${r.route}`),
    uiApps: uiAppsUsing(cap.uiMarkers ?? []),
    gap: cap.gap,
  };
});

const controllerSummary = controllerFiles.map((file) => {
  const owned = routes.filter((route) => route.file === rel(file));
  const routeStrings = owned.map((r) => `${r.method} ${r.route}`);
  const exposedApps = uiApps.filter((app) => routeStrings.some((route) => {
    const pathname = route.split(' ')[1].replace(/\/:[^/]+/g, '');
    return pathname.length > 1 && uiTextByApp[app].includes(pathname);
  }));
  return {
    controller: rel(file),
    routeCount: owned.length,
    uiApps: exposedApps,
    exposure: exposedApps.length ? 'EXPOSED_OR_PARTIAL' : 'HIDDEN_OR_API_ONLY',
  };
});

const unknown = results.filter((x) => !['EXPOSED','HIDDEN','PARTIAL','MISSING','DEFERRED_BY_DESIGN'].includes(x.status));

const audit = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: {
    prismaSchema: rel(schemaFile),
    controllerCount: controllerFiles.length,
    routeCount: routes.length,
    prismaModelCount: models.length,
    uiApps,
  },
  classification: {
    allowed: ['EXPOSED','HIDDEN','PARTIAL','MISSING','DEFERRED_BY_DESIGN'],
    unknownCount: unknown.length,
  },
  capabilities: results,
  controllerExposure: controllerSummary,
  phaseDecision: {
    currentPhase: unknown.length === 0 ? 'F1_AUDIT_COMPLETE_PENDING_REVIEW' : 'F1_IN_PROGRESS',
    nextPhase: 'F2',
    note: 'F2 baru dibuka setelah audit output direview dan roadmap status diperbarui eksplisit.',
  },
};

fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

fs.writeFileSync(
  path.join(root, 'config', 'f1-backend-ui-audit.json'),
  JSON.stringify(audit, null, 2) + '\n',
);

const counts = Object.fromEntries(['EXPOSED','HIDDEN','PARTIAL','MISSING','DEFERRED_BY_DESIGN'].map((s) => [
  s,
  results.filter((x) => x.status === s).length,
]));

const lines = [
  '# F1 — Backend Capability vs UI Exposure Audit',
  '',
  `Generated: ${audit.generatedAt}`,
  '',
  '## Repository scan',
  '',
  `- Prisma models: ${models.length}`,
  `- API controllers: ${controllerFiles.length}`,
  `- API routes: ${routes.length}`,
  `- UI apps: ${uiApps.join(', ')}`,
  '',
  '## Classification summary',
  '',
  `- EXPOSED: ${counts.EXPOSED}`,
  `- PARTIAL: ${counts.PARTIAL}`,
  `- HIDDEN: ${counts.HIDDEN}`,
  `- MISSING: ${counts.MISSING}`,
  `- UNKNOWN: ${unknown.length}`,
  '',
  '## F2–F11 capability matrix',
  '',
  '| Phase | Capability | Status | Backend routes | UI apps | Gap |',
  '|---|---|---:|---:|---|---|',
  ...results.map((x) =>
    `| ${x.id} | ${x.title} | **${x.status}** | ${x.backendRouteCount} | ${x.uiApps.join(', ') || '-'} | ${x.gap.replaceAll('|','/')} |`
  ),
  '',
  '## Controller exposure inventory',
  '',
  '| Controller | Routes | UI exposure | Apps |',
  '|---|---:|---|---|',
  ...controllerSummary.map((x) =>
    `| \`${x.controller}\` | ${x.routeCount} | ${x.exposure} | ${x.uiApps.join(', ') || '-'} |`
  ),
  '',
  '## Locked implementation order',
  '',
  'F2 → F3 → F4 → F5 → F6 → F7 → F8 → F9 → F10 → F11 → F12',
  '',
  'F1 audit tidak mengubah business logic. Output ini menjadi source backlog functional completion berikutnya.',
];

fs.writeFileSync(path.join(root, 'docs', 'F1-BACKEND-UI-AUDIT.md'), lines.join('\n') + '\n');

if (unknown.length) {
  console.error(`F1 AUDIT FAIL: ${unknown.length} capability UNKNOWN.`);
  process.exit(1);
}

console.log('F1 BACKEND/UI AUDIT PASS');
console.log(`Models=${models.length} Controllers=${controllerFiles.length} Routes=${routes.length}`);
for (const x of results) console.log(`${x.id} ${x.status} :: ${x.title}`);
console.log('Output: config/f1-backend-ui-audit.json');
console.log('Output: docs/F1-BACKEND-UI-AUDIT.md');
