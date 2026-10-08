// The SUPER_ADMIN bypass is the reason a permission cannot be judged by reading a token.
//
// I claimed the draft list was unreachable for the bootstrap admin because that token's 117
// permissions did not include inventory.opname. It returned HTTP 200 the moment it was actually
// called, because PermissionsGuard short-circuits for SUPER_ADMIN before looking at permissions at
// all. Same shape as a regression test that passes because its check is blind: a plausible reading of
// the source, confidently reported, and wrong.
//
// The Admin UI has the matching bypass (UNRESTRICTED_ROLES in app/permissions.ts). If the two ever
// diverge, the operator sees a control that the server will refuse — or worse, is refused a screen
// they are entitled to. So this file pins the bypass on BOTH sides and asserts they name the same
// roles, which is the property that actually matters.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('SUPER_ADMIN bypasses the permission check before permissions are consulted', () => {
  const guard = read('apps/api/src/auth/permissions.guard.ts');
  const superAdmin = guard.indexOf("roles.includes('SUPER_ADMIN')");
  const consult = guard.indexOf('permissions?.includes(permission)');
  assert.ok(superAdmin > 0, 'the guard must have a SUPER_ADMIN branch');
  assert.ok(consult > 0, 'the guard must consult the permission list somewhere');
  // Order is the whole point: a token without the permission still passes when the role is present.
  assert.ok(superAdmin < consult, 'the SUPER_ADMIN bypass must come BEFORE the permission check, or it is dead code');
  // And it must actually return true rather than merely being present.
  assert.match(guard, /roles\.includes\('SUPER_ADMIN'\)\)\s*return true;/);
});

test('the Admin UI bypass names the same unrestricted roles as the API guard', () => {
  const ui = read('apps/admin/app/permissions.ts');
  const api = read('apps/api/src/auth/permissions.guard.ts');
  const uiRoles = ui.match(/UNRESTRICTED_ROLES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(uiRoles, 'the UI must declare its unrestricted roles in one visible place');
  const fromUi = uiRoles[1].split(',').map((r) => r.trim().replace(/['"]/g, '')).filter(Boolean);
  const fromApi = [...api.matchAll(/roles\.includes\('([A-Z_]+)'\)/g)].map((m) => m[1]);
  for (const role of fromUi) {
    assert.ok(fromApi.includes(role), `UI bypasses ${role} but the API guard does not — an operator would see a control the server refuses`);
  }
  for (const role of fromApi) {
    assert.ok(fromUi.includes(role), `API guard bypasses ${role} but the UI hides the control — an entitled operator is locked out of a screen`);
  }
  assert.ok(fromUi.length > 0 && fromApi.length > 0, 'neither side may silently bypass nothing');
});

test('no route is documented as unreachable on the strength of a token inspection', () => {
  // The POST-1C draft routes are gated inventory.opname. Their reachability was asserted from a
  // decoded JWT and it was wrong. This test cannot prove reachability — only the live call can — so
  // it records the reason in code where the next person will read it before repeating the mistake.
  const controller = read('apps/api/src/mobile-ops/mobile-ops.controller.ts');
  assert.match(controller, /@Get\('drafts'\)\s*\n\s*@Permissions\('inventory\.opname'\)/);
  assert.match(
    read('apps/api/src/auth/permissions.guard.ts'),
    /SUPER_ADMIN/,
    'the bypass this assertion depends on must keep existing, or the comment above becomes a lie',
  );
});
