import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

// ---------------------------------------------------------------------------------------------
// Workspace modules bootstrap with a single Promise.all. An endpoint the API refuses rejects the
// whole batch and the module renders ErrorState in place of the page, so a legitimately-scoped
// operator sees "Terjadi kendala" on a workspace whose own menu gate they passed.
//
// This was found and fixed once in hr-payroll.tsx (via its read()/canReadHrPath helper) and never
// looked for again. It is present in at least five other modules. CASHIER -> commerce is the
// clearest case: the cashier passes the order|sale|shipment|payment gate, but operations.tsx also
// read purchase returns (purchase.return) and warehouses (master_data.view), neither of which is
// in the CASHIER role, so the workspace was blank for its heaviest user.
//
// The rule encoded here is the actual invariant, not a proxy: for every role that can pass a
// workspace gate, every read that workspace's modules perform unguarded must be one the API
// actually allows that role. API allowance is role AND permission — RolesGuard and
// PermissionsGuard are both registered in app.module.ts and each throws independently — so this
// test parses both decorators straight from the controllers instead of trusting a hand-written
// table. An earlier draft of this file had such a table and it was wrong: it mapped
// GET /returns/orders to `return.view` when the controller requires `sale.return` behind an
// explicit @Roles list.
// ---------------------------------------------------------------------------------------------

const METHOD = '(GET|POST|PATCH|PUT|DELETE)';
const rolesOf = (text) => [...String(text).matchAll(/'([A-Z_]+)'/g)].map(x => x[1]);

const walk = (dir, prefix = '') => fs.readdirSync(new URL(`apps/api/src/${prefix}`, ROOT), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(dir, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]);

/** Every controller route with the role list and permission the API enforces. */
function parseRoutes() {
  const routes = [];
  for (const name of walk('apps/api/src')) {
    if (!name.endsWith('.controller.ts')) continue;
    const src = fs.readFileSync(new URL(`apps/api/src/${name}`, ROOT), 'utf8');
    const ctrl = src.match(/@Controller\(\s*'([^']*)'\s*\)/);
    if (!ctrl) continue;
    // Class-level @Roles and @Permissions apply to any handler that declares neither of its own.
    const head = src.slice(0, src.indexOf('\n', src.indexOf('@Controller')) + 200);
    const classRoles = rolesOf((head.match(/@Roles\(([^)]*)\)/) ?? [])[1] ?? '');
    const classPerm = (head.match(/@Permissions\(\s*["']([^"']+)["']\s*\)/) ?? [])[1] ?? null;

    // Guards are NOT consistently written before the HTTP decorator. master-data.controller.ts
    // writes `@Get('warehouses') @Permissions('master_data.view')` — permission AFTER the verb —
    // while returns.controller.ts writes `@Roles(...) @Permissions(...) @Get('sales')` — guards
    // BEFORE. A single left-to-right scan that assumes one order attributes each handler to the
    // other one's guards, and the audit then reports master_data.manage for a route the class
    // actually gates with master_data.view, i.e. it invents defects.
    //
    // So: one handler per line (verified — no controller in this tree puts a handler's decorators
    // on separate lines), and each line is read in isolation. Decorator order inside the line
    // stops mattering.
    const reHttp = /@(Get|Post|Patch|Put|Delete)\(\s*["']([^"']*)["']\s*\)/;
    const reRoles = /@Roles\(([^)]*)\)/;
    const rePerm = /@Permissions\(\s*["']([^"']+)["']\s*\)/;
    for (const line of src.split('\n')) {
      const http = line.match(reHttp);
      if (!http) continue;
      const roleArg = line.match(reRoles);
      const permArg = line.match(rePerm);
      routes.push({
        method: http[1].toUpperCase(),
        path: '/' + [ctrl[1], http[2]].filter(Boolean).join('/'),
        roles: roleArg ? rolesOf(roleArg[1]) : classRoles,
        perm: permArg ? permArg[1] : classPerm,
      });
    }
  }
  return routes;
}

const match = (route, call) => {
  const a = route.split('/'), b = call.split('/');
  return a.length === b.length && a.every((x, i) => x === b[i] || x.startsWith(':') || b[i].startsWith(':'));
};

function parseRoles() {
  const roles = [];
  for (const m of read('apps/api/prisma/seed.ts').matchAll(/\['([A-Z_]+)',\s*\[([\s\S]*?)\]\]/g)) {
    roles.push({ name: m[1], perms: new Set([...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])) });
  }
  return roles;
}

function parseWorkspaces() {
  const out = [];
  for (const m of read('apps/admin/app/navigation.ts').matchAll(/key:\s*'([a-z-]+)'[\s\S]{0,600}?permissionPrefixes:\s*\[([^\]]*)\]/g)) {
    out.push({ key: m[1], prefixes: [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]) });
  }
  return out;
}

function parseDomainViewGates() {
  const out = new Map();
  let workspace = null;
  for (const line of read('apps/admin/app/domain-workspaces.ts').split('\n')) {
    const workspaceMatch = line.match(/\{\s*workspaceKey:\s*'([^']+)'\s*,\s*views:\s*\[/);
    if (workspaceMatch) { workspace = workspaceMatch[1]; continue; }
    if (!workspace) continue;
    const viewMatch = line.match(/\{\s*key:\s*'([^']+)'/);
    if (viewMatch) {
      const rolesMatch = line.match(/roles:\s*\[([^\]]*)\]/);
      const prefixesMatch = line.match(/permissionPrefixes:\s*\[([^\]]*)\]/);
      out.set(`${workspace}:${viewMatch[1]}`, {
        roles: rolesMatch ? rolesOf(rolesMatch[1]) : [],
        prefixes: prefixesMatch ? [...prefixesMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [],
      });
    }
    if (/^\s*\]\},?\s*$/.test(line)) workspace = null;
  }
  return out;
}

const modulesDir = new URL('apps/admin/app/modules/', ROOT);
const modules = fs.readdirSync(modulesDir).filter(f => f.endsWith('.tsx')).map(f => ({
  name: f.replace('.tsx', ''),
  src: fs.readFileSync(new URL(f, modulesDir), 'utf8'),
}));

// A read is "degraded" when it is routed through a permission-aware helper. hr-payroll predates
// this file and uses read()/canReadHrPath; the rest use readOptional().
function unguardedReads(mod) {
  const guarded = new Set([
    ...(mod.src.match(/readOptional\([^,]+,\s*'(\/[^'?]+)/g) ?? []),
    ...(mod.src.match(/read(?:<[^>]*>)?\(\s*'(\/[^'?]+)/g) ?? []),
  ].map(g => g.split("'")[1]));
  const reads = new Set();
  for (const m of mod.src.matchAll(/Promise\.all\(\[([\s\S]*?)\]\)/g)) {
    for (const c of m[1].matchAll(/'(\/[^'?]+)/g)) if (!c[1].includes('${')) reads.add(c[1]);
  }
  return [...reads].filter(p => !guarded.has(p));
}

const byExport = new Map();
for (const mod of modules) {
  const m = mod.src.match(/export default function (\w+)/);
  if (m) byExport.set(m[1], mod.name);
}
const mapRaw = JSON.parse(read('config/admin-contextual-workflow-map.json'));
const modulesForRow = (row) => [...new Set(
  String(row.renderer).split('+').map((renderer) => byExport.get(renderer.split(':')[0])).filter(Boolean),
)];
const domainViewGates = parseDomainViewGates();

const routes = parseRoutes();
const roles = parseRoles();
const workspaces = parseWorkspaces();

const passes = (role, r) => {
  if (r.roles?.length && !r.roles.includes(role.name) && !r.roles.includes('SUPER_ADMIN')) return false;
  if (r.perm && !role.perms.has(r.perm)) return false;
  return true;
};
const covered = (perms, prefixes) => prefixes.some(pre => [...perms].some(p => p === pre || p.startsWith(pre + '.')));
const passesViewGate = (role, gate) => {
  if (!gate) return true;
  if (role.name === 'SUPER_ADMIN') return true;
  if (gate.roles.length && !gate.prefixes.length) return gate.roles.includes(role.name);
  if (gate.roles.includes(role.name)) return true;
  if (!gate.prefixes.length) return true;
  return covered(role.perms, gate.prefixes);
};

test('every unguarded read a permission-visible contextual view performs is allowed for every role that can open that view', () => {
  const offenders = [];
  let checked = 0;
  let checkedViews = 0;
  for (const ws of workspaces) {
    if (!ws.prefixes.length) continue;
    const rows = mapRaw.rows.filter((row) => row.workspace === ws.key);
    if (!rows.length) continue;
    for (const role of roles) {
      if (!covered(role.perms, ws.prefixes)) continue;
      for (const row of rows) {
        const gate = domainViewGates.get(`${ws.key}:${row.view}`);
        assert.ok(gate, `missing domain-view gate for ${ws.key}/${row.view}; permission audit cannot safely infer reachability`);
        if (!passesViewGate(role, gate)) continue;
        checkedViews++;
        for (const modName of modulesForRow(row)) {
          const mod = modules.find(m => m.name === modName);
          for (const path of unguardedReads(mod)) {
            const r = routes.find(rr => rr.method === 'GET' && match(rr.path, path));
            if (!r) continue;
            checked++;
            if (passes(role, r)) continue;
            const why = [
              r.roles?.length ? `roles@${r.roles.join('|')}` : null,
              r.perm ? `perm@${r.perm}` : null,
            ].filter(Boolean).join(' ');
            offenders.push(`${ws.key}/${row.view} / ${role.name}: ${modName} reads ${path} (${why})`);
          }
        }
      }
    }
  }
  assert.ok(checkedViews > 40, `the scan must inspect contextual view reachability; it inspected only ${checkedViews} visible role/view pairs`);
  assert.ok(checked > 40, `the scan must inspect the real contextual bootstrap reads; it inspected only ${checked}, so it would pass vacuously`);
  assert.deepEqual([...new Set(offenders)], [],
    `these reads 403 for a role that can open the contextual view:\n${[...new Set(offenders)].sort().join('\n')}`);
});

test('the route parser reads the real controllers, not a hand-written permission table', () => {
  // Guards against reintroducing the table that made this file wrong in the first place.
  assert.ok(routes.length > 300, `expected the full controller surface, parsed ${routes.length}; controllers seen: ${walk('apps/api/src').filter(n => n.endsWith('.controller.ts')).length}`);
  const orders = routes.find(r => r.path === '/returns/orders' && r.method === 'GET');
  assert.ok(orders, 'GET /returns/orders must be parsed from returns.controller.ts');
  assert.equal(orders.perm, 'sale.return', 'GET /returns/orders requires sale.return');
  assert.ok(orders.roles.includes('WAREHOUSE') && orders.roles.includes('FINANCE'), 'and an explicit @Roles list');
  const sales = routes.find(r => r.path === '/returns/sales' && r.method === 'GET');
  assert.equal(sales.perm, 'sale.return');
  assert.ok(sales.roles.includes('CASHIER'), 'GET /returns/sales is role-allowed for CASHIER');
});

test('CASHIER can load the commerce workspace it passes the gate for', () => {
  // The regression that motivated this file: the cashier is the heaviest user of commerce.
  const cashier = roles.find(r => r.name === 'CASHIER');
  const commerce = workspaces.find(w => w.key === 'commerce');
  assert.ok(covered(cashier.perms, commerce.prefixes), 'CASHIER must pass the commerce gate');
  for (const path of unguardedReads(modules.find(m => m.name === 'operations'))) {
    const r = routes.find(rr => rr.method === 'GET' && match(rr.path, path));
    if (!r) continue;
    assert.ok(passes(cashier, r), `operations.tsx reads ${path}, which CASHIER is refused; it must degrade, not blank the page`);
  }
});

test('the permission-aware reader degrades authorization failures only', () => {
  const src = read('apps/admin/app/read-path-contract.ts');
  assert.match(src, /export function readPermissionFor/);
  assert.match(src, /export async function readOptional/);
  assert.match(src, /return fallback/, 'a forbidden read must degrade to the fallback slice');
  assert.match(src, /403|Forbidden/, 'only an authorization failure may degrade');
  assert.match(src, /throw err/, 'a real error must still propagate');
});

test('every degraded read passes an explicit typed fallback slice', () => {
  // A readOptional call whose fallback is undefined would set state to undefined and crash the
  // render, trading a blank page for a crash.
  for (const mod of modules) {
    for (const m of mod.src.matchAll(/readOptional\(([^;]+?)\),\s*/g)) {
      assert.ok(/ as [A-Za-z]/.test(m[1]), `${mod.name}: readOptional needs a typed fallback, got: ${m[1].slice(0, 80)}`);
    }
  }
});
