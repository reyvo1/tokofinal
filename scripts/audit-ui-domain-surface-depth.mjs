import fs from 'node:fs';
import path from 'node:path';
import { jsxOpeningTags } from './jsx-opening-tags.mjs';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const apps = ['admin', 'pos', 'storefront', 'employee-portal'];
const requiredSemantic = {
  admin: [
    'stack','grid2','grid4','stats','formStack','actionRow','rowActions','inline','checkRow','checkboxLabel','checkboxRow','sectionHelp','notice','okText','dangerText','warnText','pill','logo','logoMark','pageHeader','stat','ico','delta','catalogSummary','catalogFormShell','catalogFormHeader','categoryHierarchyName','categoryDepthBadge','categoryPrimaryActions','adminTenantCardWrap','dashboardMetricGrid','dashboardGrid','dashboardPanel','dashboardActionButton',
  ],
  pos: ['logout','syncButton','shiftClose','redeem','receiptReady'],
  storefront: ['storefrontViewBody','homeDeck','homeIntro','homeSubtitle','homeActions','metricDeck','panel','sectionTitle','eyebrow','textAction','catalogControls','sortControl','compactGrid','cardActions','favoriteAction','priceRow','productSku','productDetailBody','productDetailVisual','detailPrice','checkoutGrid','cartRow','qty','total','paymentChooser','inventoryList','emptyIcon','skeletonBlock','compact','tall'],
  // `table` dan `tr` TIDAK boleh ada di daftar ini: keduanya nama utilitas Tailwind
  // (display:table dan utilitas warna). Dipakai sebagai class komponen, Tailwind
  // menghasilkan utility yang menimpa styling hand-written - itu sebabnya .table
  // terukur 642px di runner (computed display:table, overflow-x:auto tak berlaku).
  'employee-portal': ['employeeNav','singleWorkspace','welcomeDeck','dashboardGrid','profileGrid','formGrid','formStack','card','cardHeading','actions','row','coords','mutedText','notice','pStat','statusPill','hrTable','hrRow','hrHead','skeletonList','login'],
};
const errors = [];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const report = { apps: {}, capabilityStatus: [], controllerCoverage: {}, contracts: {}, summary: {} };

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts|css)$/.test(ent.name)) out.push(p);
  }
  return out;
}

for (const app of apps) {
  const files = walk(path.join(root, 'apps', app, 'app'));
  const totalLines = files.reduce((sum, p) => sum + fs.readFileSync(p, 'utf8').split('\n').length, 0);
  const css = files.filter((p) => p.endsWith('.css')).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  const missing = (requiredSemantic[app] ?? []).filter((cls) => !new RegExp(`\\.${escapeRegex(cls)}(?=[\\s,{:.#\\[]|$)`).test(css));
  if (missing.length) errors.push(`${app}: semantic classes missing: ${missing.join(', ')}`);
  report.apps[app] = { fileCount: files.length, lineCount: totalLines, requiredSemanticClassCount: (requiredSemantic[app] ?? []).length, missingSemanticClasses: missing };
}

const adminShell = read('apps/admin/app/app-shell.tsx');
const posPage = read('apps/pos/app/page.tsx');
const posShell = read('apps/pos/app/pos-shell.tsx');
const posCss = read('apps/pos/app/globals.css');
const storefrontShell = read('apps/storefront/app/storefront-shell.tsx');
const storefrontCss = read('apps/storefront/app/globals.css');
const employeeApp = read('apps/employee-portal/app/employee-portal-app.tsx');
const employeeShell = read('apps/employee-portal/app/employee-portal-shell.tsx');
const employeeCss = read('apps/employee-portal/app/globals.css');
const adminCss = read('apps/admin/app/globals.css');
const extensionsSource = read('apps/admin/app/modules/extensions.tsx');
const devRunnerSource = read('scripts/run-next-dev-workspace.mjs');
const nextAppPackages = Object.fromEntries(['admin','pos','storefront','employee-portal'].map((app) => [app, JSON.parse(read(`apps/${app}/package.json`))]));
const visualMap = JSON.parse(read('config/p5-visual-surface-map.json'));
const f1 = JSON.parse(read('config/f1-backend-ui-audit.json'));
const adminContextual = JSON.parse(read('config/admin-contextual-workflow-map.json'));
const adminNavigation = read('apps/admin/app/navigation.ts');

for (const [name, shell] of [['admin',adminShell],['pos',posShell],['storefront',storefrontShell],['employee-portal',employeeShell]]) {
  if (!/data-ui-foundation="p5-v4\.11"/.test(shell)) errors.push(`${name}: P5 V4.11 root UI foundation marker missing`);
}
const layoutSources = Object.fromEntries(apps.map((app) => [app, read(`apps/${app}/app/layout.tsx`)]));
const themeContracts = Object.fromEntries(apps.map((app) => [app, read(`apps/${app}/app/theme-contract.ts`)]));
const themeClients = Object.fromEntries(apps.map((app) => [app, read(`apps/${app}/app/theme-client.tsx`)]));
const themedShells = { admin: adminShell, pos: posShell, storefront: storefrontShell, 'employee-portal': employeeShell };
const themeKeys = { admin:'toko360:ui-theme:v411:admin', pos:'toko360:ui-theme:v411:pos', storefront:'toko360:ui-theme:v411:storefront', 'employee-portal':'toko360:ui-theme:v411:employee' };
for (const [app, shell] of Object.entries(themedShells)) {
  if (!/data-theme=\{theme\}/.test(shell)) errors.push(`${app}: runtime theme state missing`);
  if (!/useT360Theme\(\)/.test(shell)) errors.push(`${app}: canonical theme hook missing`);
  if (!/Aktifkan mode gelap/.test(shell) || !/Aktifkan mode terang/.test(shell)) errors.push(`${app}: explicit light/dark toggle missing`);
  const contract = themeContracts[app];
  const client = themeClients[app];
  if (!contract.includes(themeKeys[app])) errors.push(`${app}: product-scoped theme persistence key missing`);
  if (!/T360_THEME_DEFAULT: T360Theme = 'light'/.test(contract)) errors.push(`${app}: deterministic light default missing`);
  if (!/document\.documentElement\.dataset\.t360Theme\s*=\s*theme/.test(client)) errors.push(`${app}: document theme synchronization missing`);
}
if (new Set(Object.values(themeKeys)).size !== apps.length) errors.push('theme keys are not isolated per product');
for (const [app, source] of Object.entries(layoutSources)) {
  if (!/data-t360-theme="light"/.test(source)) errors.push(`${app}: deterministic light root missing`);
  if (/next\/script|<script(?:\s|>)|dangerouslySetInnerHTML|T360_THEME_BOOTSTRAP/.test(source)) errors.push(`${app}: render-time theme script injection is forbidden`);
}
if (!/\.posV4\[data-theme='dark'\]/.test(posCss)) errors.push('pos: complete dark theme surface contract missing');
if (!/\.storefrontV4\[data-theme='dark'\]/.test(storefrontCss)) errors.push('storefront: complete dark theme surface contract missing');
if (!/\.employeeV4\[data-theme='dark'\]/.test(employeeCss)) errors.push('employee-portal: complete dark theme surface contract missing');
if (!/\.adminV4\[data-theme='dark'\]/.test(adminCss)) errors.push('admin: complete dark theme surface contract missing');
report.contracts.theme = { storageKeys: themeKeys, isolatedPerProduct: true, defaultTheme: 'light', surfaces: apps, runtimeSync: 'client effect without script injection', loginBootstrap: true };
const primitiveContracts = [
  ['admin labels', adminCss, /\.workspaceSurface label:not\(\.checkRow\)/],
  ['admin raw buttons', adminCss, /\.workspaceSurface button:not\(\[class\]\)/],
  ['admin grid alignment', adminCss, /\.grid2[^}]*align-items:\s*start/],
  ['storefront labels', storefrontCss, /\.storefrontViewBody label/],
  ['storefront raw buttons', storefrontCss, /\.storefrontViewBody button:not\(\[class\]\)/],
  ['storefront checkout alignment', storefrontCss, /\.checkoutGrid[^}]*align-items:start/],
  ['employee labels', employeeCss, /\.employeeViewBody label/],
  ['employee raw buttons', employeeCss, /\.employeeViewBody button:not\(\[class\]\)/],
  ['employee login card', employeeCss, /\.login>form\{[^}]*width:min\(100%,460px\)/s],
  ['pos light root', posCss, /\.posV4\{[^}]*linear-gradient\(180deg,#f8fafc/i],
  ['pos labels', posCss, /\.posWorkspaceBody label/],
  ['pos raw buttons', posCss, /\.posWorkspaceBody button:not\(\[class\]\)/],
  ['pos layout alignment', posCss, /\.layout\{align-items:start\}/],
];
for (const [label, source, pattern] of primitiveContracts) if (!pattern.test(source)) errors.push(`${label}: root primitive contract missing`);

const loadingGuardHookPattern = /if\s*\(\s*loading[^)]*\)\s*return\s*</g;
const reactHookPattern = /\buse(?:State|Effect|Memo|Ref|Callback|Reducer|LayoutEffect)\s*\(/g;
for (const app of apps) {
  for (const file of walk(path.join(root, 'apps', app, 'app')).filter((p) => p.endsWith('.tsx'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const guard of source.matchAll(loadingGuardHookPattern)) {
      const tail = source.slice((guard.index ?? 0) + guard[0].length);
      const hook = reactHookPattern.exec(tail);
      reactHookPattern.lastIndex = 0;
      if (hook) errors.push(`${path.relative(root, file)}: React hook appears after loading render guard (${hook[0]})`);
    }
  }
}
const extensionGuard = extensionsSource.indexOf('if (loading) return <TableSkeleton rows={4} />;');
if (extensionGuard < 0 || [...extensionsSource.slice(extensionGuard).matchAll(/\buse(?:State|Effect|Memo|Ref|Callback|Reducer|LayoutEffect)\s*\(/g)].length) errors.push('admin extensions: hook-order contract violated after loading guard');
if ((extensionsSource.match(/\/customers\?limit=100/g) ?? []).length !== 1 || !/loadExtensionSnapshot\(\)\.then\(\(snapshot\) => \{ if \(!cancelled\) applyExtensionSnapshot\(snapshot\); \}\)/.test(extensionsSource)) errors.push('admin extensions: canonical extension snapshot loader/customer bootstrap drift');
const expectedDevPorts = { admin:3001, pos:3002, storefront:3000, 'employee-portal':3003 };
for (const [app, port] of Object.entries(expectedDevPorts)) {
  if (nextAppPackages[app]?.scripts?.dev !== `dotenv -e ../../.env -- node ../../scripts/run-next-dev-workspace.mjs ${port}`) errors.push(`${app}: dev script bypasses fresh isolated-dev runner`);
}
if (!/resolve\(workspace, '\.next', 'dev'\)/.test(devRunnerSource) || !/rmSync\(generatedDev, \{ recursive: true, force: true \}\)/.test(devRunnerSource) || !/T360_NEXT_VERIFY: '0'/.test(devRunnerSource)) errors.push('next dev runner: stale .next/dev reset / dev tsconfig authority missing');
if (!/className="adminPrimaryNavigation"/.test(adminShell) || !/adminSidebarSubdomains/.test(adminShell) || !/resolveDomainViews\(item, manifest, identity\)/.test(adminShell) || !/view\.label, view\.title, view\.description/.test(adminShell)) errors.push('admin: searchable hierarchical domain/subdomain navigation missing');
if (/adminModuleDirectory|moduleOpen|className="domainTabs/.test(adminShell)) errors.push('admin: redundant secondary navigation authority returned');
if ((adminCss.match(/!important/g) ?? []).length) errors.push('admin: override accretion returned via !important');

const adminPresentationBundle = walk(path.join(root, 'apps', 'admin', 'app')).filter((p) => p.endsWith('.tsx')).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
for (const pattern of [
  /style=\{\{[^}]*margin(?:Top|Bottom|Left|Right)\s*:\s*\d+/,
  /style=\{\{[^}]*display\s*:\s*['"](?:flex|grid|block)['"]/,
  /style=\{\{[^}]*alignSelf\s*:/,
  /style=\{\{[^}]*whiteSpace\s*:/,
  /style=\{\{[^}]*wordBreak\s*:/,
  /style=\{\{[^}]*background\s*:\s*['"]var\(/,
  /style=\{\{[^}]*color\s*:\s*['"]var\(/,
]) if (pattern.test(adminPresentationBundle)) errors.push(`admin: static inline presentation patch returned (${pattern})`);
if (/gridTemplateColumns:\s*['"]/.test(adminPresentationBundle)) errors.push('admin: literal inline gridTemplateColumns returned; layout must come from semantic CSS');

if (!/data-theme=\{theme\}/.test(adminShell) || !/Aktifkan mode gelap/.test(adminShell) || !/Aktifkan mode terang/.test(adminShell)) errors.push('admin: functional light/dark theme toggle missing');
if (!/posV4 min-h-screen min-w-0/.test(posShell) || !/T360_THEME_DEFAULT: T360Theme = 'light'/.test(read('apps/pos/app/theme-contract.ts')) || !/\.posV4\{[^}]*#f8fafc/.test(posCss)) errors.push('pos: root must remain light-first');
if (!/html\[data-t360-theme='dark'\]/.test(posCss) || !/data-theme=\{theme\}/.test(posShell)) errors.push('pos: explicit dark selection must remain supported');
const posRoot = posCss.match(/\.posV4\{([^}]*)\}/i)?.[1] ?? '';
if (/background\s*:[^;]*(?:#0[0-9a-f]{5}|#111827|#0f172a|#020617)/i.test(posRoot)) errors.push('pos: root may not regress to dark page background');
if (!/companyName=\{manifest\?\.company\?\.name/.test(posPage) || !/branchName=\{manifest\?\.branch\?\.name/.test(posPage)) errors.push('pos: tenant/company branch context is not visible in shell');
if (!/\/receipts\/\$\{encodeURIComponent\(lastReceipt\.number\)\}/.test(posPage)) errors.push('pos: digital receipt backend capability is not exposed after completed sale');
if (!/companyName/.test(storefrontShell) || !/onBranchChange/.test(storefrontShell)) errors.push('storefront: company/branch context missing');
if (!/api\('\/platform\/manifest'\)/.test(employeeApp) || !/companyName=\{manifest\?\.company\?\.name/.test(employeeApp)) errors.push('employee-portal: tenant manifest context missing');
if (/NAV\.slice\(0,\s*4\)/.test(employeeShell)) errors.push('employee-portal: mobile navigation hides valid subdomains');
if (!/NAV\.map\(/.test(employeeShell)) errors.push('employee-portal: complete mobile navigation missing');

if (visualMap.pos.views.length !== 4 || visualMap.storefront.views.length !== 5 || visualMap.employeePortal.views.length !== 7) errors.push('P5 surface matrix changed unexpectedly');

const hiddenControllers = f1.controllerExposure.filter((item) => item.exposure !== 'EXPOSED_OR_PARTIAL');
const hiddenNames = hiddenControllers.map((item) => item.controller);
if (hiddenNames.some((name) => !name.endsWith('/edge-sync.controller.ts'))) errors.push(`operator-useful controller still hidden from UI: ${hiddenNames.join(', ')}`);
if (!hiddenNames.some((name) => name.endsWith('/edge-sync.controller.ts'))) errors.push('edge-sync API-only controller classification changed unexpectedly');
report.controllerCoverage = { hiddenOrApiOnly: hiddenNames, intentionalApiOnly: ['apps/api/src/extensions/edge-sync.controller.ts'] };

const sourceBundle = apps.flatMap((app) => walk(path.join(root, 'apps', app, 'app')).filter((p) => /\.(tsx|ts)$/.test(p)).map((p) => fs.readFileSync(p, 'utf8'))).join('\n');
const noopPatterns = [/onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/g, /onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*undefined\s*\}/g];
if (noopPatterns.some((pattern) => pattern.test(sourceBundle))) errors.push('UI contains explicit no-op click handler');
if (/disabled\s*=\s*\{\s*true\s*\}/.test(sourceBundle)) errors.push('UI contains permanent disabled={true} control');

report.capabilityStatus = f1.capabilities.map(({ id, title, status, uiApps, gap }) => ({ id, title, status, uiApps, gap }));
const partialCapabilities = report.capabilityStatus.filter((item) => item.status === 'PARTIAL').map((item) => item.id);
const unexpectedPartial = partialCapabilities.filter((id) => id !== 'F9');
if (unexpectedPartial.length) errors.push(`unexpected capability still partial after current source scan: ${unexpectedPartial.join(', ')}`);

report.contracts = {
  adminThemeToggle: true,
  posLightFirst: true,
  tenantContextVisible: ['admin','pos','storefront','employee-portal'],
  employeeAllSevenViewsReachableOnMobile: true,
  digitalReceiptExposedInPos: true,
  edgeSyncApiOnlyByDesign: true,
  rootUiFoundation: { admin: 'P5-V4.11', pos: 'P5-V4.11', storefront: 'P5-V4.11', employeePortal: 'P5-V4.11' },
  reactHookOrderFailClosed: true,
  freshIsolatedDevOutput: true,
  rawFormPrimitivesStyled: true,
  gridItemsAlignStart: true,
  adminSearchableHierarchicalNavigation: true,
};

const controlInventory = {};
for (const app of apps) {
  const source = walk(path.join(root, 'apps', app, 'app')).filter((p) => /\.(tsx|ts)$/.test(p)).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  const buttons = jsxOpeningTags(source, 'button');
  const links = jsxOpeningTags(source, 'a');
  let inertButtons = 0;
  let implicitSubmitButtons = 0;
  for (const match of buttons) {
    const attrs = match.attrs;
    if (/onClick\s*=|type\s*=\s*["']submit["']|disabled/.test(attrs)) continue;
    const before = source.slice(0, match.index);
    if (before.lastIndexOf('<form') > before.lastIndexOf('</form>')) implicitSubmitButtons += 1;
    else inertButtons += 1;
  }
  const inertLinks = links.filter((match) => !/href\s*=/.test(match.attrs)).length;
  controlInventory[app] = { buttons: buttons.length, links: links.length, inertButtons, implicitSubmitButtons, inertLinks };
  if (inertButtons) errors.push(`${app}: ${inertButtons} inert button(s) found by full-root inventory`);
  if (inertLinks) errors.push(`${app}: ${inertLinks} anchor(s) without href found by full-root inventory`);
}

const workspaceRows = [...adminNavigation.matchAll(/\{ key: '([^']+)', route: '([^']+)', label: '([^']+)'/g)].map((match) => ({ key: match[1], route: match[2], label: match[3] }));
const visualWorkspaceRoutes = visualMap.admin.primaryWorkspaces.map((workspace) => workspace.route);
const sourceWorkspaceRoutes = workspaceRows.map((workspace) => workspace.route);
if (JSON.stringify(visualWorkspaceRoutes) !== JSON.stringify(sourceWorkspaceRoutes)) errors.push(`admin: visual primary workspace authority drift map=${visualWorkspaceRoutes.length} source=${sourceWorkspaceRoutes.length}`);
if (visualMap.admin.representativeContextualRoutes.length !== Math.max(0, workspaceRows.length - 1)) errors.push('admin: every non-Dashboard primary workspace must keep one representative contextual screenshot route');
for (const workspace of workspaceRows.filter((workspace) => workspace.route !== '/dashboard')) {
  if (!visualMap.admin.representativeContextualRoutes.some((route) => route.startsWith(`${workspace.route}/`))) errors.push(`admin: missing representative contextual screenshot route for ${workspace.route}`);
}
const contextualByWorkspace = {};
for (const row of adminContextual.rows) (contextualByWorkspace[row.workspace] ??= []).push(row.view);
if (adminContextual.rows.length !== adminContextual.expectedContextualViews) errors.push(`admin: contextual source mapping ${adminContextual.rows.length}/${adminContextual.expectedContextualViews}`);

report.controls = controlInventory;
report.adminDomainAuthority = {
  primaryWorkspaceCount: workspaceRows.length,
  primaryWorkspaces: workspaceRows,
  contextualViewCount: adminContextual.rows.length,
  expectedContextualViewCount: adminContextual.expectedContextualViews,
  contextualViews: contextualByWorkspace,
};
report.sourceInventory = {
  apiControllerCount: f1.source.controllerCount,
  apiRouteCount: f1.source.routeCount,
  prismaModelCount: f1.source.prismaModelCount,
  interactiveControlCount: Object.values(controlInventory).reduce((sum, item) => sum + item.buttons + item.links, 0),
};
report.summary = { partialCapabilities, errors };

const rootAudit = {
  version: 4,
  phase: 'P5-V4.9-FOUR-PRODUCT-ROOT-DESIGN-SYSTEM',
  sourceScan: {
    apiControllers: f1.source.controllerCount,
    apiRoutes: f1.source.routeCount,
    prismaModels: f1.source.prismaModelCount,
    adminPrimaryWorkspaces: visualMap.admin.primaryWorkspaces.length,
    adminContextualViews: adminContextual.expectedContextualViews,
    posViews: visualMap.pos.views.length,
    storefrontViews: visualMap.storefront.views.length,
    employeeViews: visualMap.employeePortal.views.length,
    interactiveControls: report.sourceInventory.interactiveControlCount,
  },
  presentation: report.apps,
  controls: controlInventory,
  admin: report.adminDomainAuthority,
  configuredViews: { pos: visualMap.pos.views, storefront: visualMap.storefront.views, employeePortal: visualMap.employeePortal.views },
  capabilities: report.capabilityStatus,
  apiOnlyControllers: hiddenNames,
  intentionalApiOnlyControllers: report.controllerCoverage.intentionalApiOnly,
  contracts: report.contracts,
  remainingTruth: [
    { id: 'F9', status: 'PARTIAL_BY_BACKEND_READINESS', detail: 'WhatsApp/Telegram operator UI exists, but external provider production readiness/setup/verification/retry diagnostics remain incomplete.' },
    { id: 'F10', status: 'SOURCE_IMPLEMENTED_RUNTIME_PENDING', detail: 'Explainable forecast/reorder, permission-scoped deterministic operator assistant, anomaly insights, confidence, source links, history, and human-confirmation guardrails are implemented; runtime/browser/human evidence remains pending.' },
    { id: 'edge-sync', status: 'API_ONLY_BY_DESIGN', detail: 'Device/system synchronization is intentionally not an operator UI domain.' },
  ],
  limitations: ['Static source audits do not replace real browser click/runtime validation.', 'Real production build and Human Visual Acceptance remain mandatory before P5 closure.'],
};

const markdown = [
  '# P5 Full UI Root Audit — V4.9 Four-Product Root Design System', '',
  '## Scope', '',
  `- API: **${rootAudit.sourceScan.apiControllers} controllers / ${rootAudit.sourceScan.apiRoutes} handlers / ${rootAudit.sourceScan.prismaModels} Prisma models**.`,
  `- Admin: **${rootAudit.sourceScan.adminPrimaryWorkspaces} primary workspaces / ${rootAudit.sourceScan.adminContextualViews} contextual views**.`,
  `- POS: **${rootAudit.sourceScan.posViews} views**; Storefront: **${rootAudit.sourceScan.storefrontViews} views**; Employee Portal: **${rootAudit.sourceScan.employeeViews} views**.`,
  `- Static interaction inventory: **${rootAudit.sourceScan.interactiveControls} controls**.`, '',
  '## Presentation authority', '',
  '| Surface | Files | Lines | Required semantic classes | Missing |', '|---|---:|---:|---:|---:|',
  ...Object.entries(report.apps).map(([app, item]) => `| ${app} | ${item.fileCount} | ${item.lineCount} | ${item.requiredSemanticClassCount} | ${item.missingSemanticClasses.length} |`), '',
  '## Interaction inventory', '',
  '| Surface | Buttons | Links | Inert buttons | Inert links |', '|---|---:|---:|---:|---:|',
  ...Object.entries(controlInventory).map(([app, item]) => `| ${app} | ${item.buttons} | ${item.links} | ${item.inertButtons} | ${item.inertLinks} |`), '',
  '## Admin domain/subdomain authority', '',
  `All **${adminContextual.rows.length}/${adminContextual.expectedContextualViews}** contextual destinations are source-mapped. No canonical Admin contextual domain is unmapped.`, '',
  ...workspaceRows.map((workspace) => `- **${workspace.label}** \`${workspace.route}\`: ${(contextualByWorkspace[workspace.key] ?? []).map((view) => `\`${view}\``).join(', ') || 'overview/root only'}`), '',
  '## Capability exposure truth', '',
  '| ID | Capability | Exposure | UI apps | Depth/readiness note |', '|---|---|---|---|---|',
  ...report.capabilityStatus.map((item) => `| ${item.id} | ${item.title} | **${item.status}** | ${item.uiApps.join(', ') || '-'} | ${item.gap.replaceAll('|','/')} |`), '',
  '## API-only / missing useful UI', '',
  '- The only controller without direct operator UI exposure is `apps/api/src/extensions/edge-sync.controller.ts`; it is device/system-facing and intentionally API-only.',
  '- The canonical digital receipt endpoint is exposed from POS after a completed sale.',
  '- No direct no-op click handlers, inert buttons, inert anchors, or permanent `disabled={true}` controls are present in the audited source.', '',
  '## Remaining non-cosmetic gaps', '',
  '- **F9 remains PARTIAL**: WhatsApp/Telegram UI exists, but external provider production readiness and diagnostics remain incomplete.',
  '- **F10 source implementation is complete / runtime pending**: explainable forecast/reorder, permission-scoped deterministic assistant, anomaly insights, source links, confidence, history, and human-confirmation guardrails are present. Runtime/browser/human evidence remains mandatory.', '',
  '## Verification boundary', '',
  'Static source evidence does **not** substitute for real Next production builds or Human Visual Acceptance. P5 stays OPEN and P6 stays BLOCKED until those gates pass.', '',
].join('\n');

fs.mkdirSync(path.join(root, 'handoff', 'quality'), { recursive: true });
fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'handoff', 'quality', 'ui-domain-surface-depth-latest.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'config', 'p5-full-ui-root-audit.json'), JSON.stringify(rootAudit, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'docs', 'P5-FULL-UI-ROOT-AUDIT.md'), markdown);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`UI domain surface depth audit PASS · apps=${apps.length} · controls=${rootAudit.sourceScan.interactiveControls} · partialCapabilities=${partialCapabilities.join(',') || 'none'} · hiddenApiOnly=edge-sync`);
