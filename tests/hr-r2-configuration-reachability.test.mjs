import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
const view = read('apps/admin/app/modules/hr-payroll.tsx');

function body(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `end marker not found after ${startMarker}`);
  return source.slice(start, end);
}

// R2HrConfiguration owns the entire attendance operator surface: roster and shifts, attendance
// policy, effective-dated assignment, corrections, devices, geofence, biometric credentials,
// attendance history, employee tax/social profiles, and payroll accounting mapping. It used to
// be a component that nothing rendered, so /people/attendance and /people/compliance both
// displayed the payroll lifecycle and all ten panels were unreachable from every role. Every
// gate stayed green because the panel titles and endpoints are present in source — presence is
// not reachability. That is the audit A-15 failure class.

test('the R2 attendance/compliance surface is actually mounted', () => {
  const config = body(view, 'function R2HrConfiguration', '\nexport default function HrPayrollView');
  assert.ok(config.length > 0, 'R2HrConfiguration must still exist');

  const usages = [...view.matchAll(/<R2HrConfiguration\b/g)];
  assert.equal(usages.length, 1, 'R2HrConfiguration must be rendered exactly once, by HrPayrollView');

  const mount = body(view, 'if (mode === \'attendance\' || mode === \'compliance\') {', 'async function action');
  assert.match(mount, /<R2HrConfiguration token=\{token\} employees=\{employees\} mode=\{mode\}/);
});

test('the mode branch happens after every hook, so hook order stays stable', () => {
  // The V4.8.2 crash: ExtensionsView returned its loading skeleton before registering a later
  // useEffect, so the hook count changed between renders and React threw at runtime. tsc, lint
  // and every source audit stayed green. A conditional return before the last hook reproduces it.
  const mountIndex = view.indexOf("if (mode === 'attendance' || mode === 'compliance') {");
  assert.notEqual(mountIndex, -1, 'the mode branch must exist');

  const viewStart = view.indexOf('export default function HrPayrollView');
  const prefix = view.slice(viewStart, mountIndex);
  const hooks = [...prefix.matchAll(/\buse(State|Effect|Memo|Callback|Ref)\(/g)];
  assert.ok(hooks.length > 0, 'sanity: HrPayrollView must register hooks before the branch');

  // Every hook call in the whole component must appear before the conditional return.
  const afterBranch = view.slice(mountIndex);
  const lateHooks = [...afterBranch.matchAll(/^(\s*)const\s*\[[^\]]*\]\s*=\s*useState|^(\s*)useEffect\(|^(\s*)const\s+\w+\s*=\s*useMemo/gm)];
  assert.equal(lateHooks.length, 0, `no hook may be registered after the conditional return (found ${lateHooks.length})`);
});

test('attendance and compliance views render the R2 surface, payroll does not', () => {
  // A wrong default is the other failure: if the branch also caught 'payroll', the payroll
  // lifecycle would disappear for the role that uses it most.
  const branch = body(view, "if (mode === 'attendance' || mode === 'compliance') {", 'async function action');
  assert.match(branch, /mode === 'attendance'/);
  assert.match(branch, /mode === 'compliance'/);
  assert.doesNotMatch(branch, /mode === 'payroll'/, 'payroll must keep its own lifecycle view');
});

test('the ten R2 operator panels exist in the mounted component', () => {
  const config = body(view, 'function R2HrConfiguration', '\nexport default function HrPayrollView');
  for (const panel of [
    'R2 · ROSTER',
    'R2 · POLICY',
    'R2 · PLACEMENT',
    'R2 · ATTENDANCE CORRECTION',
    'R2 · DEVICE',
    'R2 · GEOFENCE',
    'R2 · BIOMETRIC',
    'R2 · HISTORY',
    'R2 · PAYROLL COMPLIANCE',
    'R2 · ACCOUNTING',
  ]) {
    assert.ok(config.includes(panel), `mounted R2 surface must keep the ${panel} panel`);
  }
  // The attendance-only branch and the compliance branch are separate returns; both must exist.
  assert.match(config, /if \(mode === 'attendance'\) return <>/, 'attendance branch must exist');
  assert.equal([...config.matchAll(/\breturn <>/g)].length, 2, 'attendance and compliance branches must both return a surface');
});

test('the contextual map still routes attendance and compliance to this view', () => {
  const map = JSON.parse(read('config/admin-contextual-workflow-map.json'));
  const people = map.rows.filter((row) => row.workspace === 'people');
  const byView = Object.fromEntries(people.map((row) => [row.view, row.renderer]));
  assert.equal(byView.attendance, 'HrPayrollView:attendance');
  assert.equal(byView.compliance, 'HrPayrollView:compliance');
  assert.equal(byView.payroll, 'HrPayrollView:payroll');
});
