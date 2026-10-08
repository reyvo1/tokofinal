import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// POSIX path normalise, collapsing '.' and '..'. path.normalize does this, but the
// relative specifiers in these imports are POSIX-style on every platform we run.
function normalizePath(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

function controllerFiles() {
  // Walk the tree with fs rather than shelling out, so the suite stays dependency-free and
  // does not depend on cwd.
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.controller.ts')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'apps/api/src'));
  return out;
}

const admin = (p) => read(path.join('apps/admin/app', p));

test('P0 inspection: a FAILED inspection exposes a rejection control that is not an approval control', () => {
  const src = read('apps/admin/app/modules/operations-control.tsx');
  // The old defect: one button rendered "Tolak hasil" for FAILED but called approveInspection.
  assert.ok(
    !/i\.status === 'FAILED' \? 'Tolak hasil' : 'Setujui'/.test(src),
    'label must not be a ternary that shows "Tolak hasil" while calling the approve handler',
  );
  // Rejection must reach an explicit reject decision.
  assert.match(src, /reviewInspection\(i, 'reject'\)/, 'rejection control must call the reject decision');
  // And there must be a matching honest approve control for the same row.
  assert.match(src, /reviewInspection\(i, 'approve'\)/, 'approve control must call the approve decision');
});

test('P0 inspection: rejection is never recorded with an approval note', () => {
  const src = read('apps/admin/app/modules/operations-control.tsx');
  const start = src.indexOf('async function reviewInspection');
  const fn = src.slice(start, src.indexOf('async function approveInspection', start));
  // In the reject branch the notes must come from the operator reason, not the
  // fixed approval sentence used by the approve path.
  const ternary = fn.match(/const notes = isReject[\s\S]*?;\n/);
  assert.ok(ternary, 'reviewInspection must compute notes per decision');
  const notesExpr = ternary[0];
  assert.match(notesExpr, /rejectReasons\[inspection\.id\]/, 'reject must use the operator-supplied reason');
  assert.ok(
    !/const notes = isReject[\s\S]*?Selisih penerimaan ditinjau dan disetujui[\s\S]*?;\n/.test(notesExpr.split('?')[0] ?? ''),
    'approval sentence must not be the reject default',
  );
  // The rejection default wording must be present.
  assert.match(notesExpr, /ditolak/i, 'reject must default to explicit rejection wording');
});

test('P0 inspection: rejection records an operator reason', () => {
  const src = read('apps/admin/app/modules/operations-control.tsx');
  assert.match(src, /rejectReasons/, 'rejection reason state must exist');
  assert.match(src, /placeholder="Alasan penolakan/, 'operator must be able to supply a rejection reason');
});

test('P1 reporting: trial-balance account rows perform a real drill-down', () => {
  const src = admin('modules/reporting-workspace.tsx');
  assert.ok(!/void 0;/.test(src), 'dead `void 0;` no-op must not remain in the reporting workspace');
  assert.match(src, /onClick=\{\(\) => void loadDrillDown\(row\.code\)\}/, 'account row click must load drill-down for that account');
});

test('P1 reporting: financial-integrity event-failure counters are rendered', () => {
  const src = admin('modules/reporting-workspace.tsx');
  for (const field of ['postedEventsMissingJournal', 'failedEvents', 'queuedEvents']) {
    assert.match(src, new RegExp(field), `${field} must be surfaced to the operator`);
  }
});

test('P0 idempotency: no inline idempotency key embeds Date.now()', () => {
  // A *constructed* key that embeds Date.now() is a uniqueness key, not an
  // idempotency key: a double click yields two distinct keys and two postings.
  // A key *generator* (newIdempotencyKey) is legitimate — each logical POS sale
  // genuinely needs its own key. Only inline construction inside the payload is wrong.
  const offenders = [];
  for (const app of ['admin', 'pos', 'storefront', 'employee-portal']) {
    const dir = path.join(ROOT, 'apps', app, 'app');
    (function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(p, 'utf8');
          for (const line of src.split('\n')) {
            if (/idempotencyKey\s*:\s*[^,]*Date\.now\(\)/.test(line)) {
              offenders.push(`${path.relative(ROOT, p)}: ${line.trim()}`);
            }
          }
        }
      }
    })(dir);
  }
  assert.deepEqual(offenders, [], `inline idempotency keys must not embed Date.now():\n${offenders.join('\n')}`);
});

test('P0 access control: reports role gate covers every role granted report.view', () => {
  const controller = read('apps/api/src/reports/reports.controller.ts');
  const classGate = controller.match(/@Roles\(([^)]*)\)/);
  assert.ok(classGate, 'reports controller must declare an explicit role gate');
  const allowed = classGate[1].split(',').map((r) => r.trim().replace(/['"]/g, ''));

  const seed = read('apps/api/prisma/seed.ts');
  // Collect every role row that is granted report.view.
  const roleRows = [...seed.matchAll(/\[\s*'([A-Z_]+)'\s*,\s*\[([^\]]*)\]\s*\]/g)];
  const granted = roleRows
    .filter((row) => /['"]report\.view['"]/.test(row[2]))
    .map((row) => row[1])
    .filter((role) => role !== 'EMPLOYEE');

  for (const role of granted) {
    assert.ok(allowed.includes(role), `role ${role} is granted report.view in seed but is missing from the reports @Roles gate; the nav item would render and then 403`);
  }
});

test('P1 navigation: report-type catalogue is not duplicated per surface', () => {
  // Three files each hardcoded their own subset, so the exportable catalogue depended
  // on which workspace the operator happened to be standing in.
  const canonical = read('config/report-type-catalog.json');
  const types = JSON.parse(canonical).reportTypes;
  for (const file of ['apps/admin/app/modules/reporting-workspace.tsx', 'apps/admin/app/modules/automation-workspace.tsx', 'apps/admin/app/modules/accounting.tsx']) {
    const src = read(file);
    assert.ok(
      !/const REPORT_TYPES\s*=\s*\[/.test(src),
      `${file} must not hardcode its own REPORT_TYPES array; import the canonical catalogue`,
    );
  }
  for (const type of types) {
    assert.ok(types.includes(type));
  }
});

test('P1 loyalty: a REFUND adjustment cannot increase the customer balance', () => {
  const src = read('apps/admin/app/modules/extensions.tsx');
  // Find the point-delta expression that decides the sign of a loyalty transaction.
  const line = src.split('\n').find((l) => /\['REDEEM'/.test(l) && /Math\.abs\(raw\)/.test(l));
  assert.ok(line, 'loyalty point-delta expression must exist');
  assert.match(
    line,
    /const points = \[[^\]]*'REDEEM'[^\]]*'EXPIRE'[^\]]*'REFUND'[^\]]*\]\.includes/,
    `REFUND must be listed in the sign-consuming branch; a REFUND that falls through to the positive default increases the customer balance. Got: ${line.trim()}`,
  );
});

test('S1 branch switch: branch-scoped diagnostics refetch when the token changes', () => {
  const src = read('apps/admin/app/modules/r3-operations.tsx');
  // Branch identity lives in the token. Effects that only depend on the selected id keep
  // rendering the previous branch's data after a branch switch.
  const effects = [...src.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[([^\]]*)\]\);/g)];
  assert.ok(effects.length >= 2, 'expected multiple branch-scoped effects');
  for (const effect of effects) {
    const deps = effect[1];
    if (deps.includes('selectedDeviceId') || deps.includes('mappingIntegrationId')) {
      assert.match(deps, /token/, `effect depending on ${deps} must also depend on token, or a branch switch leaves stale branch data on screen`);
    }
  }
});

test('H1 fiscal final close requires a recorded reason', () => {
  const ui = admin('modules/accounting.tsx');
  assert.match(ui, /periodDialog/, 'fiscal period actions must be confirmed through a dialog');
  assert.match(ui, /action === 'close' && !periodDialog\.notes\.trim\(\)/, 'final close must refuse to proceed without a reason');
  assert.ok(
    !/onClick=\{\(\) => void periodAction\(period, 'close'\)\}/.test(ui),
    'final close must not fire directly from the table button',
  );
  const svc = read('apps/api/src/extensions/extensions.service.ts');
  assert.match(svc, /async closeFiscalPeriod\(id: string, user: AuthUser, notes\?: string\)/, 'backend must accept and record the close reason');
  assert.match(svc, /CLOSE_FISCAL_PERIOD[\s\S]{0,400}notes: notes\.trim\(\)/, 'the close reason must be persisted with the audit entry');
});

test('H2 irreversible finance mutations are confirmed', () => {
  const ui = admin('modules/accounting.tsx');
  // post writes to the general ledger with no undo path from this screen.
  const fn = ui.slice(ui.indexOf('function requestFinanceAction'));
  assert.match(
    fn.slice(0, 400),
    /setFinanceDialog\(\{ transaction, action, notes: '' \}\)/,
    'every finance action, including post and approve, must open the confirmation dialog',
  );
  assert.ok(
    !/void financeAction\(transaction, action\);\s*\}/.test(fn.slice(0, 400)),
    'approve/post must not bypass the confirmation dialog',
  );
});

test('C3 payroll has a reachable operator path for components and rule sets', () => {
  // Without these surfaces a fresh install dead-ends: the operator can read tax rule sets
  // but has no way to create or approve one, and payroll cannot be calculated.
  const ctrl = read('apps/api/src/payroll/payroll.controller.ts');
  for (const route of ['components', 'employee-components', 'tax-rule-sets', 'social-security-rule-sets']) {
    assert.ok(ctrl.includes(route), `payroll controller must expose ${route}`);
  }
  assert.match(ctrl, /@Get\('components'\)/, 'the component catalogue must be readable so it can be assigned');
  assert.match(ctrl, /@Get\('employee-components'\)/, 'existing assignments must be readable');

  const ui = admin('modules/hr-payroll.tsx');
  // Payroll bootstrap now uses the canonical permission-aware reader directly. The audit
  // pins that contract so authorization gaps may degrade to an explicit typed fallback,
  // while transport/server failures still propagate instead of becoming false-empty UI.
  assert.match(ui, /import \{ readOptional \} from '\.\.\/read-path-contract';/, 'payroll must use the canonical optional-read contract');
  assert.match(
    ui,
    /readOptional\(identity, '\/payroll\/components\?limit=50', \{ items: \[\], pageInfo: \{\} \} as CursorRows<PayrollComponent>, \(path\) => api<CursorRows<PayrollComponent>>\(path\)\)/,
    'the admin UI must load the paginated component catalogue through the canonical permission-aware reader',
  );
  assert.match(ui, /api\('\/payroll\/components',\{method:'POST'/, 'an operator must be able to create a salary component');
  assert.match(ui, /api\('\/payroll\/employee-components',\{method:'POST'/, 'an operator must be able to assign a component to an employee');
  assert.match(ui, /api\(endpoint,\{method:'POST'[\s\S]{0,400}ruleCode/, 'an operator must be able to create tax/social rule sets');
  assert.match(ui, /\/approve`,\{method:'POST'\}/, 'a DRAFT rule set must be approvable from the UI');
});

test('C3 employee component read stays branch scoped', () => {
  const svc = read('apps/api/src/payroll/payroll.service.ts');
  const fn = svc.slice(svc.indexOf('async listEmployeeComponents'), svc.indexOf('async createComponent'));
  // EmployeePayrollComponent has no branchId, so branch scope must come from bounded employee lookups
  // for only the assignment candidates on the current cursor page.
  assert.match(fn, /employeePayrollComponent\.findMany[\s\S]*take: scanTake/, 'assignment candidates must be read in bounded chunks');
  assert.match(fn, /id: \{ in: employeeIds \}[\s\S]*branchId: scope\.branchId/, 'candidate employee IDs must be filtered to the authenticated branch');
  assert.ok(!/employee\.findMany\(\{\s*where: \{ companyId: scope\.companyId, branchId: scope\.branchId, isActive: true \},\s*select: \{ id: true \}/.test(fn), 'the endpoint must not load every active branch employee before pagination');
});

test('S2 reporting: a single failing endpoint no longer blanks the whole workspace', () => {
  const src = admin('modules/reporting-workspace.tsx');
  // A 15-way Promise.all means one 403 blanks every panel and the operator cannot tell
  // which report is actually broken.
  const load = src.slice(src.indexOf('async function loadReports'));
  const body = load.slice(0, load.indexOf('\n  // S-3'));
  assert.ok(!/await Promise\.all\(\[\s*api</.test(body), 'loadReports must not issue one giant unguarded Promise.all of api() calls');
  assert.match(body, /loadSection\(/, 'each panel must be loaded through an independently guarded helper');
  assert.match(src, /setSectionErrors/, 'per-section failures must be recorded and surfaced');
  assert.match(src, /Sebagian laporan gagal dimuat/, 'the operator must be told which reports failed');
});

test('S2 reporting: a mode only fetches what it renders', () => {
  const src = admin('modules/reporting-workspace.tsx');
  const body = src.slice(src.indexOf('async function loadReports'));
  const block = body.slice(0, body.indexOf('await Promise.all(loads)'));
  // The operations mode has no business paying for cash-flow or trial-balance queries.
  const ops = block.slice(block.indexOf("mode === 'operations'"), block.indexOf("mode === 'scheduled'"));
  assert.ok(!ops.includes('/reports/cash-flow'), 'operations mode must not fetch cash-flow');
  assert.ok(!ops.includes('/reports/trial-balance'), 'operations mode must not fetch trial-balance');
  const fin = block.slice(block.indexOf("mode === 'financial'"), block.indexOf("mode === 'operations'"));
  assert.ok(!fin.includes('/reports/dead-stock'), 'financial mode must not fetch dead-stock');
  assert.ok(!fin.includes('/reports/peak-hours'), 'financial mode must not fetch peak-hours');
});

test('S3 reporting: the date range applies in every mode and refetches on change', () => {
  const src = admin('modules/reporting-workspace.tsx');
  // The old effect depended on [token] only, so changing the date range outside financial
  // mode re-rendered with stale data and never refetched.
  assert.match(src, /useEffect\(\(\) => \{ void loadReports\(\); \}, \[token, mode, from, to, scopeCompanyId, scopeBranchId\]\)/, 'the load effect must depend on the date range and the mode');
});

test('S4 reporting: the cross-branch scope the backend accepts is actually sent', () => {
  const src = admin('modules/reporting-workspace.tsx');
  // reports accept companyId/branchId and are validated with assertRequestedScope; the UI
  // never sent either, so a multi-branch owner could not produce a cross-branch period report.
  assert.match(src, /companyId=\$\{encodeURIComponent\(scopeCompanyId\)\}/, 'companyId must be sent when the operator sets a scope');
  assert.match(src, /branchId=\$\{encodeURIComponent\(scopeBranchId\)\}/, 'branchId must be sent when the operator sets a scope');
  const body = src.slice(src.indexOf('async function loadReports'), src.indexOf('// S-3'));
  for (const endpoint of ['profit-loss', 'trial-balance', 'balance-sheet', 'cash-flow', 'tax-summary', 'margin', 'inventory-valuation']) {
    const line = body.split('\n').find((l) => l.includes(`/reports/${endpoint}?`));
    assert.ok(line, `${endpoint} must be fetched in loadReports`);
    assert.ok(line.includes('${scope}'), `${endpoint} must receive the cross-branch scope; got: ${line.trim()}`);
  }
});

test('A4 notification template edit updates in place instead of looking like a create', () => {
  const ui = admin('modules/extensions.tsx');
  // The backend already upserts on (companyId, code, channel), so the defect was purely
  // presentational: the form never showed that it was editing, and always said "saved".
  assert.match(ui, /editingTemplateId/, 'the template form must track whether it is editing');
  const save = ui.slice(ui.indexOf('async function saveTemplate'));
  const body = save.slice(0, save.indexOf('\n  }'));
  assert.match(body, /wasEditing \? 'Template notifikasi diperbarui\./, 'an update must be reported as an update, not a create');
  assert.match(ui, /\{editingTemplateId \? 'Perbarui template' : 'Simpan template'\}/, 'the submit label must reflect the mode');
  assert.match(ui, /Batal ubah/, 'the operator must be able to leave edit mode');
  assert.match(ui, /setEditingTemplateId\(template\.id\)/, 'editTemplate must mark the row being edited');
});

test('D3 lifecycle controls are hidden when the token cannot perform them', () => {
  const ui = admin('modules/hr-payroll.tsx');
  // The API gates each payroll step behind a distinct permission (calculate / approve /
  // post / publish). Rendering them unconditionally meant a user with payroll.calculate
  // saw "Approve" and only learned it 403'd after clicking.
  assert.match(ui, /usePermissions\(token\)/, 'the payroll view must derive capabilities from the token');
  const perms = ['payroll.calculate', 'payroll.approve', 'payroll.post', 'payroll.publish', 'payroll.manage'];
  for (const permission of perms) {
    assert.ok(ui.includes(`canAll('${permission}')`), `${permission} must gate its control`);
  }
  // Every step of the lifecycle must still be reachable, not merely hidden.
  for (const step of ['/runs/${selectedRun.id}/calculate', '/runs/${selectedRun.id}/approve', '/runs/${selectedRun.id}/post-accounting', '/payments/${payment.id}/settle', '/runs/${selectedRun.id}/publish-payslips']) {
    assert.ok(ui.includes(step), `lifecycle step ${step} must remain reachable`);
  }
});

test('D5 webhook deliveries are listable so the replay endpoint is reachable', () => {
  // The ops panel reported a FAILED webhook count but there was no read path, so the
  // operator saw a number they could not act on and POST .../replay was unreachable.
  const ctrl = read('apps/api/src/platform/platform.controller.ts');
  assert.match(ctrl, /@Get\('webhook-deliveries'\)/, 'the delivery queue must be readable');
  const listIdx = ctrl.indexOf("@Get('webhook-deliveries')");
  const replayIdx = ctrl.indexOf("@Post('webhook-deliveries/:id/replay')");
  assert.ok(listIdx > -1 && replayIdx > listIdx, 'the list route must exist so the replay route has something to act on');

  const svc = read('apps/api/src/platform/platform.service.ts');
  const fn = svc.slice(svc.indexOf('async listWebhookDeliveries'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  // Scope is enforced through the owning endpoint, as WebhookDelivery has no companyId.
  assert.match(body, /webhookEndpoint\.findMany\(\{ where: \{ companyId: scope\.companyId \}/, 'deliveries must be scoped to the tenant endpoints');
  assert.ok(!/payload: true/.test(body), 'the stored payload must not be returned wholesale');

  const ui = admin('modules/platform-control.tsx');
  assert.match(ui, /\/platform\/webhook-deliveries\?limit=100/, 'the webhooks surface must load the delivery queue');
  assert.match(ui, /\/platform\/webhook-deliveries\/\$\{row\.id\}\/replay/, 'the UI must expose the replay action');
  assert.match(ui, /row\.status==='FAILED'/, 'replay must only be offered for failed deliveries, since replaying a delivered event would double-send it');
});

test('D5 approval requests can be delegated from the UI', () => {
  const ui = admin('modules/platform-control.tsx');
  assert.match(ui, /\/platform\/approval-requests\/\$\{row\.id\}\/delegate/, 'the delegate endpoint must be reachable');
  assert.match(ui, /setDelegateTarget/, 'the operator must choose a delegate target');
  // The service refuses to delegate back to the requester, so the picker must exclude them.
  assert.match(ui, /user\.id!==row\.requesterId/, 'the requester must be excluded from the delegate list');
  const svc = read('apps/api/src/platform/platform.service.ts');
  assert.match(svc, /Approval tidak boleh didelegasikan kembali kepada requester/, 'the server enforces the same rule');
});

test('D5 effective-dated employee assignments are operator-reachable', () => {
  const ui = admin('modules/employee-master.tsx');
  assert.match(ui, /\/hr\/employees\/\$\{employeeId\}\/assignments/, 'assignment history must be readable from the UI');
  assert.match(ui, /api\(\s*'\/hr\/assignments',\s*\{ method: 'POST'/, 'an operator must be able to record a new assignment');
  for (const field of ['departmentId', 'positionId', 'managerEmployeeId', 'effectiveFrom', 'effectiveTo', 'isPrimary']) {
    assert.ok(ui.includes(field), `assignment form must carry ${field}`);
  }
  // The manager picker must not offer the employee themselves; the server rejects self-management.
  assert.match(ui, /row\.id !== assignmentEmployeeId/, 'an employee must not be offered as their own manager');
  const svc = read('apps/api/src/hr/hr.service.ts');
  assert.match(svc, /Karyawan tidak dapat menjadi manajer untuk dirinya sendiri/, 'the server enforces the same rule');
});

test('D3 finance mutations are gated by the permission the API actually enforces', () => {
  const ui = admin('modules/accounting.tsx');
  const ctrl = read('apps/api/src/finance-operations/finance-operations.controller.ts');
  // finance-operations.controller.ts splits the lifecycle: approve/reject/cancel need
  // finance.approve, posting to the ledger needs finance.post.
  assert.match(ctrl, /@Permissions\('finance\.approve'\) @Post\(':id\/approve'\)/, 'approve must require finance.approve');
  assert.match(ctrl, /@Permissions\('finance\.post'\) @Post\(':id\/post'\)/, 'post must require finance.post');
  assert.match(ui, /const FINANCE_ACTION_PERMISSION/, 'the UI must map each action to its required permission');
  const map = ui.slice(ui.indexOf('const FINANCE_ACTION_PERMISSION'));
  const block = map.slice(0, map.indexOf('};'));
  assert.match(block, /approve: 'finance\.approve'/, 'approve/reject/cancel must map to finance.approve');
  assert.match(block, /post: 'finance\.post'/, 'post must map to finance.post');
  assert.match(ui, /canAll\(FINANCE_ACTION_PERMISSION\.post\)/, 'the posting button must be gated');
  assert.match(ui, /canAll\(FINANCE_ACTION_PERMISSION\.cancel\)/, 'the cancel button must be gated');
  // Final close is gated separately on the fiscal period lifecycle.
  assert.match(ui, /canAll\('finance\.close_period'\)/, 'final close must be gated on finance.close_period');
});

test('D3 inspection decisions are gated on inspection.approve', () => {
  const ui = admin('modules/operations-control.tsx');
  const ctrl = read('apps/api/src/operations-control/operations-control.controller.ts');
  // inspection.record can create and complete; only inspection.approve can decide.
  assert.match(ctrl, /@Permissions\('inspection\.record'\) @Post\('inspections\/:id\/complete'\)/, 'completing needs inspection.record');
  assert.match(ctrl, /@Permissions\('inspection\.approve'\) @Post\('inspections\/:id\/approve'\)/, 'the review decision needs inspection.approve');
  assert.match(ui, /canAll\('inspection\.approve'\)/, 'the approve/reject controls must be hidden from a record-only operator');
  // The gate must wrap BOTH decisions, not just one of them.
  const gated = ui.slice(ui.indexOf("canAll('inspection.approve')"));
  const fragment = gated.slice(0, gated.indexOf('</>'));
  assert.match(fragment, /Tolak hasil/, 'reject must be inside the permission gate');
  assert.match(fragment, /Setujui/, 'approve must be inside the permission gate');
});

test('D3 every admin module that owns permission-gated mutations is permission-aware', () => {
  // The API convention is consistent across the codebase: X.view for reads, X.manage for
  // writes. A module that mutates permission-gated state but never imports the permission
  // helper will render controls the token cannot possibly execute.
  //
  // security.tsx is deliberately excluded: the auth controller declares no @Permissions and no
  // @Roles on 2FA setup/confirm, recovery codes, session revoke or logout-all. Those are
  // self-service actions scoped to @CurrentUser(), not permission-gated business operations,
  // so gating them on a business permission would be wrong, not safer.
  const SELF_SERVICE = new Set(['security.tsx']);
  const dir = new URL('../apps/admin/app/modules/', import.meta.url);
  const ungated = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.tsx') || SELF_SERVICE.has(file)) continue;
    const src = fs.readFileSync(new URL(file, dir), 'utf8');
    if (/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(src) && !src.includes('usePermissions')) ungated.push(file);
  }
  assert.deepEqual(ungated, [], `these admin modules mutate permission-gated state but render controls without a permission check: ${ungated.join(', ')}`);
});

test('D3 security.tsx is self-service by design, not an oversight', () => {
  // Locks in WHY security.tsx is exempt, so the exemption cannot quietly rot into a gap if
  // someone later adds a business-permission action to that surface.
  const ctrl = read('apps/api/src/auth/auth.controller.ts');
  for (const route of ['2fa/setup', '2fa/confirm', '2fa/recovery-codes', '2fa/disable', 'sessions/:id/revoke', 'logout-all']) {
    const i = ctrl.indexOf(`@Post('${route}')`);
    assert.ok(i > -1, `${route} must exist`);
    const window = ctrl.slice(Math.max(0, i - 200), i);
    assert.ok(
      !/@Permissions\(/.test(window) && !/@Roles\(/.test(window),
      `${route} is expected to be self-service (no @Permissions/@Roles); if that changed, security.tsx now needs gating too`,
    );
  }
  const ui = admin('modules/security.tsx');
  assert.ok(!ui.includes('usePermissions'), 'security.tsx must not invent a permission gate the API does not enforce');
});

test('D3 permission ternaries are executable JSX expressions, never literal UI text', () => {
  const dir = new URL('../apps/admin/app/modules/', import.meta.url);
  const broken = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.tsx')) continue;
    const src = fs.readFileSync(new URL(file, dir), 'utf8');
    if (/>\s*\((?:canAll|canAny)\([^\n]*\?\s*<button/.test(src) || /^\s*\((?:canAll|canAny)\([^\n]*\?\s*<button/m.test(src)) broken.push(file);
  }
  assert.deepEqual(broken, [], `permission ternary rendered as literal JSX text: ${broken.join(', ')}`);
});

test('D3 gating uses JSX the react-jsx transform actually accepts', () => {
  // `cond && {canAll(..) && <button/>}` fails to parse under jsx: react-jsx with a confusing
  // TS1005/TS1381, and it broke four controls in operations-control.tsx during this work.
  const dir = new URL('../apps/admin/app/modules/', import.meta.url);
  const broken = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.tsx')) continue;
    const src = fs.readFileSync(new URL(file, dir), 'utf8');
    if (/&&\s*\{\s*(?:canAll|can)\(/.test(src)) broken.push(file);
  }
  assert.deepEqual(broken, [], `nested JSX expressions after a logical && do not parse: ${broken.join(', ')}`);
});

test('D3 controls are hidden, not merely disabled, for distinct lifecycle steps', () => {
  // A disabled Approve button still invites the click and still reads as available; a step
  // the token cannot perform should not be rendered at all.
  const ui = admin('modules/hr-payroll.tsx');
  // The gate wraps the whole button element; its position relative to the attributes varies,
  // so assert that the approve control is inside a canAll('payroll.approve') conditional and
  // that no disabled-only variant of it exists.
  const approveIdx = ui.indexOf('>3. Approve<');
  assert.ok(approveIdx > -1, 'the payroll approve step must still exist');
  const window = ui.slice(Math.max(0, approveIdx - 700), approveIdx);
  assert.match(window, /canAll\('payroll\.approve'\) &&/, 'the payroll approve step must be conditionally rendered, not merely disabled');
  assert.ok(!/canAll\('payroll\.approve'\)[^<]{0,40}disabled/.test(window), 'the approve step must not be implemented as disabled-only');
  const oc = admin('modules/operations-control.tsx');
  assert.match(oc, /canAll\('gate_pass\.approve'\) \? <button/, 'gate pass approval must be conditionally rendered');
});

test('P0 dashboard money formatting can never render Rp NaN', () => {
  const src = admin('dashboard-overview.tsx');
  // A single missing or malformed aggregate must not reach the operator as "Rp NaN".
  // Intl.NumberFormat().format(NaN) returns "Rp NaN", which is what a screenshot showed.
  const money = src.slice(src.indexOf('function money('), src.indexOf('function compactMoney('));
  assert.match(
    money,
    /Number\.isFinite\(Number\(value\)\)/,
    'money() must coerce non-finite input, or any bad aggregate surfaces as "Rp NaN"',
  );
  const compact = src.slice(src.indexOf('function compactMoney('), src.indexOf('function compactMoney(') + 700);
  assert.match(compact, /Number\.isFinite/, 'compactMoney() must coerce non-finite input too');
});

test('P0 admin UI must not declare Dashboard fields the API never emits', () => {
  // grossProfitBeforeOnlineCogs / grossProfitBeforeOnlineCops were declared in the admin UI
  // but exist nowhere in the API, so the dashboard fell back to undefined and formatted it
  // as "Rp NaN". The API returns today.grossProfit.
  for (const file of ['dashboard-overview.tsx', 'page.tsx']) {
    const src = admin(file);
    assert.ok(
      !/grossProfitBeforeOnlineCogs/.test(src),
      `${file} declares grossProfitBeforeOnlineCogs, which the API never returns`,
    );
  }
  const api = read('apps/api/src/reports/reports.service.ts');
  const i = api.indexOf('async dashboard');
  assert.ok(i > -1, 'the dashboard service must exist');
  const today = api.slice(api.indexOf('today:', i), api.indexOf('today:', i) + 500);
  assert.match(today, /grossProfit:/, 'the API dashboard response must expose today.grossProfit for the UI to consume');

  const dash = admin('dashboard-overview.tsx');
  assert.match(
    dash,
    /Number\.isFinite\(grossProfit\) \? grossProfit : today\.grossProfit/,
    'the gross profit KPI must fall back to the field the API actually returns',
  );
});

test('P0 no admin workspace is reachable but empty for the role that can see it', () => {
  // The reported symptom was "the UI is not synchronised between roles": the sidebar showed a
  // workspace, the operator clicked it, and the page was empty or 403. Two causes, both fixed:
  //   1. dashboard + master-data had no gate at all, so every role saw them.
  //   2. The controls inside those workspaces ARE permission-aware, so a role without the
  //      permission landed on a page whose buttons had all been hidden.
  const nav = read('apps/admin/app/navigation.ts');
  for (const ws of ['dashboard', 'master-data', 'commerce', 'procurement', 'inventory-control',
                    'operations-control', 'finance', 'reports', 'people', 'assets-fleet',
                    'intelligence', 'integrations', 'organization', 'settings']) {
    const entry = nav.slice(nav.indexOf(`key: '${ws}'`));
    const line = entry.slice(0, entry.indexOf('\n  {'));
    assert.ok(
      line.includes('permissionPrefixes') || line.includes('roles:'),
      `workspace "${ws}" has no permissionPrefixes and no roles, so it is visible to every role`,
    );
  }
});

test('P0 the dashboard role gate matches the ReportsController guard exactly', () => {
  // If these two lists drift, a role is either locked out of a menu entry it can use, or shown
  // a menu entry that 403s on every feed it loads.
  const nav = read('apps/admin/app/navigation.ts');
  const entry = nav.slice(nav.indexOf("key: 'dashboard'"));
  // Scope the match to the roles array only; a blanket /'[A-Z_]+'/ also picks up eyebrow: 'OVERVIEW'.
  const rolesArray = (entry.slice(0, entry.indexOf('\n  {')).match(/roles: \[([^\]]*)\]/) || [, ''])[1];
  const navRoles = rolesArray.split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean);
  assert.ok(navRoles.length > 0, 'the dashboard workspace must declare an explicit roles list');
  const ctrl = read('apps/api/src/reports/reports.controller.ts');
  const ctrlRoles = (ctrl.match(/@Roles\(([^)]*)\)/) || [, ''])[1]
    .split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean);
  assert.ok(ctrlRoles.length > 0, 'the reports controller must still declare its role guard');
  assert.deepEqual(
    [...navRoles].sort(), [...ctrlRoles].sort(),
    'the dashboard menu entry and the ReportsController role guard must list the same roles',
  );
});

test('P0 every permission prefix a workspace gates on exists in the API', () => {
  // A prefix that matches no @Permissions anywhere hides the workspace from everyone, which
  // looks identical to the role-desync bug this file was written to prevent.
  const known = new Set();
  for (const file of controllerFiles()) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/@Permissions\('([^']+)'/g)) known.add(m[1]);
  }
  assert.ok(known.size > 100, `expected the API to declare many permissions, found ${known.size}`);
  const nav = read('apps/admin/app/navigation.ts');
  const bad = [];
  for (const m of nav.matchAll(/permissionPrefixes: \[([^\]]*)\]/g)) {
    for (const prefix of m[1].split(',').map((p) => p.trim().replace(/'/g, '')).filter(Boolean)) {
      const covered = [...known].some((k) => k === prefix || k.startsWith(`${prefix}.`) || k.startsWith(`${prefix}_`));
      if (!covered) bad.push(prefix);
    }
  }
  assert.deepEqual(bad, [], `these navigation prefixes match no @Permissions in the API, so the workspace is hidden from every role: ${bad.join(', ')}`);
});

test('P0 the dashboard survives a partial or 403 analytics response', () => {
  // ReportsController is role-gated. A role outside its @Roles list gets a 403, and a partially
  // served response can arrive as an object whose collections are missing. The previous check was
  // `if (!dashboard || !analytics)`, which passes for a truthy-but-empty analytics object and then
  // throws on analytics.salesTrend.reduce — blank page, which is what was reported.
  const src = admin('dashboard-overview.tsx');
  assert.match(
    src,
    /Array\.isArray\(analytics\?\.salesTrend\)/,
    'salesTrend must be read through an Array.isArray guard, not a truthiness check',
  );
  for (const key of ['salesTrend', 'cashFlow', 'topProducts', 'lowStock']) {
    assert.match(src, new RegExp(`Array\\.isArray\\(analytics\\?\\.${key}\\)`), `${key} needs an Array.isArray guard`);
  }
  // Every reduce over analytics data must coerce, so one bad point cannot poison the total.
  for (const m of src.matchAll(/const (total\w+) = (\w+)\.reduce\(([^)]*)\) => sum \+ ([^,]+), 0\);/g)) {
    assert.match(
      m[4],
      /Number\(/,
      `${m[1]} adds ${m[4]} without coercion; a null/undefined point makes the whole KPI NaN`,
    );
  }
  // Every read of an analytics collection must be the right-hand side of its own guard,
  // i.e. exactly `Array.isArray(analytics?.X) ? analytics.X : []`. Assert that shape directly
  // instead of trying to pattern-match access sites.
  for (const key of ['salesTrend', 'cashFlow', 'topProducts', 'lowStock']) {
    assert.ok(
      src.includes(`Array.isArray(analytics?.${key}) ? analytics.${key} : []`),
      `analytics.${key} must be read as: Array.isArray(analytics?.${key}) ? analytics.${key} : []`,
    );
  }
});

test('P0 no server component calls a non-component export from a client module', () => {
  // The employee portal was fully broken: every sub-page (/attendance, /leave, /overtime,
  // /payslips, /history, /profile) crashed with
  //   "Attempted to call isEmployeePortalView() from the server but isEmployeePortalView is on
  //    the client."
  // because app/[view]/page.tsx is a Server Component that imported a type-guard function from
  // employee-portal-shell.tsx, a 'use client' module. Importing a *component* from a client
  // module is legal; *calling* a plain exported function is not.
  const APPS = ['admin', 'pos', 'storefront', 'employee-portal'];
  const clientModules = new Set();
  for (const app of APPS) {
    const root = path.join(ROOT, `apps/${app}/app`);
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.next' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          if (fs.readFileSync(full, 'utf8').trimStart().startsWith("'use client'")) {
            clientModules.add(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
  }
  assert.ok(clientModules.size > 20, `expected many client modules, found ${clientModules.size}`);

  const violations = [];
  for (const app of APPS) {
    const root = path.join(ROOT, `apps/${app}/app`);
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.next' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!['page.tsx', 'layout.tsx', 'route.ts'].includes(entry.name)) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (src.trimStart().startsWith("'use client'")) continue; // a client component, fine
        for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from '(\.[^']+)'/g)) {
          const spec = m[2];
          for (const ext of ['.tsx', '.ts', '']) {
            const target = normalizePath(`${dir}/${spec}${ext}`);
            const rel = path.relative(root, target);
            if (!clientModules.has(rel)) continue;
            for (const raw of m[1].split(',')) {
              const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
              // An uppercase name is rendered as JSX, which is legal. A lowercase one is a
              // plain function/value, and calling it from the server throws at request time.
              if (name && !/^[A-Z]/.test(name)) {
                violations.push(`${path.relative(ROOT, full)} imports non-component "${name}" from client module ${rel}`);
              }
            }
          }
        }
      }
    };
    walk(root);
  }
  assert.deepEqual(violations, [], `server components must not call exports from client modules:\n  ${violations.join('\n  ')}`);
});

test('P0 the employee portal view contract is importable by the server', () => {
  const contract = read('apps/employee-portal/app/employee-portal-views.ts');
  // The word 'use client' appears in this file's explanatory comment, so check the actual
  // directive position rather than a substring match.
  assert.ok(
    !/^\s*['"]use client['"]/m.test(contract),
    'the view contract must stay a plain server-safe module',
  );
  const shell = read('apps/employee-portal/app/employee-portal-shell.tsx');
  assert.match(
    shell,
    /export \{ isEmployeePortalView \} from '\.\/employee-portal-views';/,
    'the shell must re-export the single source of truth rather than keep a second definition',
  );
  const page = read('apps/employee-portal/app/[view]/page.tsx');
  assert.match(
    page,
    /from '\.\.\/employee-portal-views'/,
    'the server route must import the contract from the server-safe module, not from the client shell',
  );
  for (const view of ['attendance', 'leave', 'overtime', 'payslips', 'history', 'profile']) {
    assert.ok(contract.includes(`'${view}'`), `the view contract must cover /${view}`);
  }
});

test('P0 the theme toggle actually reaches the root element in all four apps', () => {
  // Dark mode was inert in the POS and the employee portal. theme-client.tsx wrote
  // documentElement.dataset.t360Theme, which expands to the data-t360-theme attribute, but the
  // stylesheets key their dark palette on [data-t360-theme='dark'] *and* [data-theme='dark'] on
  // different elements, and the login screens render outside their themed shell entirely. The
  // result was a permanently light page with a permanently dark <main> — two themes fighting.
  const APPS = ['admin', 'pos', 'storefront', 'employee-portal'];
  for (const app of APPS) {
    const client = read(`apps/${app}/app/theme-client.tsx`);
    const css = read(`apps/${app}/app/globals.css`);

    // 1. the attribute name must match what the CSS selects on
    assert.match(
      client,
      /root\.setAttribute\('data-t360-theme',\s*theme\)/,
      `${app}: theme-client must set the data-t360-theme attribute the CSS matches on`,
    );
    assert.match(
      client,
      /root\.setAttribute\('data-theme',\s*theme\)/,
      `${app}: theme-client must also set data-theme, because three of the four stylesheets select on it`,
    );

    // 2. the dark palette must be reachable from the root, not only from a themed child shell
    assert.match(
      css,
      /html\[data-t360-theme='dark'\]/,
      `${app}: needs a dark background reachable from <html>; the login screens render outside .*V4 shells`,
    );

    // 3. the shell background itself must be themed — theming only panels leaves the page
    //    background on its light gradient, which is what produced the green cast.
    const shellClass = { admin: 'adminV4', pos: 'posV4', storefront: 'storefrontV4', employee: 'employeeV4' }[app === 'employee-portal' ? 'employee' : app];
    assert.ok(css.includes(shellClass), `${app}: expected the ${shellClass} shell class in its stylesheet`);
  }
});

test('P0 no shell hardcodes a light background that overrides the dark palette', () => {
  // Tailwind utility classes in the shell markup (.posV4 bg-slate-100 text-slate-950) win over the
  // [data-theme='dark'] rules by specificity, so the theme could never take effect on those screens.
  for (const [file, label] of [
    ['apps/pos/app/pos-shell.tsx', 'pos-shell.tsx'],
    ['apps/employee-portal/app/employee-portal-shell.tsx', 'employee-portal-shell.tsx'],
  ]) {
    const src = read(file);
    // Scope to the themed root element. Descendant panels legitimately keep their own bg-* classes;
    // what must go is a colour hardcoded on the element that carries data-theme.
    const main = src.slice(src.indexOf('<main'), src.indexOf('>', src.indexOf('<main')));
    assert.ok(
      !/\bbg-slate-\d{2,3}\b/.test(main),
      `${label} hardcodes a light bg-* on the themed root, which overrides the dark palette`,
    );
    assert.ok(
      !/\btext-slate-950\b/.test(main),
      `${label} hardcodes text-slate-950 on the themed root, so dark mode had dark-on-dark risk`,
    );
  }
});

test('P0 every stylesheet is structurally parseable', () => {
  // A rule inserted into the middle of an unclosed block (html{background:#fff\n
  // html[data-x]{...};color-scheme:light}) takes the whole app down with
  // "Error: Parsing CSS source code failed" and a 500 on every route. tsc, lint and the unit
  // suite all stay green because they never read the CSS; only the dev server and the browser
  // notice, which is why it survived into a screenshot.
  for (const app of ['admin', 'pos', 'storefront', 'employee-portal']) {
    const css = read(`apps/${app}/app/globals.css`);
    const open = (css.match(/\{/g) ?? []).length;
    const close = (css.match(/\}/g) ?? []).length;
    assert.equal(open, close, `${app}/app/globals.css has unbalanced braces (${open} open, ${close} close)`);

    // A selector must not appear inside another rule's body.
    for (const m of css.matchAll(/\{([^{}]{0,300})\}/g)) {
      assert.ok(
        !/\[data-[\w-]+[^\]]*\]\s*\{/.test(m[1]),
        `${app}/app/globals.css: a nested selector appeared inside a rule body, which breaks the parse: ${m[1].slice(0, 80)}`,
      );
    }

    // Every @apply block must be closed on the same logical rule.
    for (const m of css.matchAll(/@apply[^;{}]*/g)) {
      assert.ok(!/\{\s*$/.test(m[0].trimEnd()), `${app}: @apply declaration is unterminated`);
    }
  }
});

test('D3 permission checks use the same SUPER_ADMIN bypass as the API guard', () => {
  const helper = read('apps/admin/app/permissions.ts');
  assert.match(helper, /UNRESTRICTED_ROLES = new Set\(\['SUPER_ADMIN'\]\)/, 'SUPER_ADMIN bypasses permission checks server-side, so the UI must not hide controls from it');
  const guard = read('apps/api/src/auth/permissions.guard.ts');
  assert.match(guard, /user\.roles\.includes\('SUPER_ADMIN'\)/, 'the server guard short-circuits on SUPER_ADMIN');
});

test('H8 the payroll lifecycle is numbered 1-6 with no missing step', () => {
  const ui = admin('modules/hr-payroll.tsx');
  // Step labels appear both as JSX text (>2. Hitung<) and inside ternary string literals
  // ({isAdjustment ? '2. Hitung selisih' : '2. Hitung'}), so both shapes are collected.
  const jsxLabels = [...ui.matchAll(/>(\d)\. ([A-Za-z][^<{]*)</g)].map((m) => m[1]);
  const stringLabels = [...ui.matchAll(/'(\d)\. ([A-Za-z][^']*)'/g)].map((m) => m[1]);
  const steps = [...new Set([...jsxLabels, ...stringLabels])].sort();
  assert.deepEqual(steps, ['1', '2', '3', '4', '6'], `payroll steps must run 1..6; step 5 (settle) lives in the payment panel. Got: ${steps.join(', ')}`);
  // Step 5 must be labelled as the settlement it is, and step 6 must be reachable from it.
  assert.match(ui, /LANGKAH 5 · PEMBAYARAN GAJI/, 'the settlement panel must be labelled as step 5');
  assert.match(
    ui,
    /LANGKAH 5 · PEMBAYARAN GAJI[\s\S]{0,2200}6\. Terbitkan payslip/,
    'step 6 must live in the step-5 panel, because publish only unlocks once every payment is PAID',
  );
});

test('A5 the notification bell reflects real state instead of always showing an alert', () => {
  const shell = read('apps/admin/app/app-shell.tsx');
  assert.ok(
    !/<Bell size=\{17\} \/><span className="adminNotificationDot" \/>/.test(shell),
    'the notification dot must not render unconditionally',
  );
  assert.match(shell, /\{attentionCount > 0 && <span className="adminNotificationDot"/, 'the dot must be conditional on a real count');
  assert.match(shell, /aria-label=\{attentionCount > 0 \? `Pusat notifikasi, \$\{attentionCount\} notifikasi gagal`/, 'the bell must expose its state to assistive technology');
  assert.match(shell, /attentionCount = 0/, 'the count must default to zero so the bell is never optimistic');

  // The shell is presentation-only by architectural contract, so the count is resolved in
  // the data layer and passed down. Fetching it inside the shell would violate that contract.
  assert.ok(!/fetch\(|authFetch\(/.test(shell), 'app-shell.tsx must not perform its own data fetching');
  const page = read('apps/admin/app/page.tsx');
  assert.match(page, /\/notifications\?status=FAILED/, 'the count must come from the real notification queue');
  assert.match(page, /attentionCount=\{attentionCount\}/, 'the resolved count must be passed to the shell');
  assert.match(page, /cancelled/, 'the badge fetch must be cancellable and must not update state after unmount');

  // The endpoint must be readable by every authenticated role, or the shell would 403.
  const ctrl = read('apps/api/src/extensions/extensions.controller.ts');
  const get = ctrl.slice(ctrl.indexOf("@Get('notifications')"));
  const handler = get.slice(0, get.indexOf('@Post'));
  assert.ok(!/@Permissions\(/.test(handler), 'GET /notifications must stay readable by all roles for the shell badge');
});
