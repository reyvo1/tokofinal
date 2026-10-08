// The setter endpoint had NO caller in the product. An administrator could only appoint a supervisor
// by knowing the URL and crafting the request by hand — so in practice nobody was ever appointed,
// and `GET /supervisor-approval/status` reported `configured:false` in a seeded branch.
//
// A panel that exists but is never mounted, and an endpoint that exists but is never called, both
// pass every static gate. These assertions fail if the surface is deleted OR if it stops being
// wired to the real endpoint, because they check the call, not the label.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const accessControl = read('apps/admin/app/modules/access-control.tsx');
const usersService = read('apps/api/src/users/users.service.ts');
const usersController = read('apps/api/src/users/users.controller.ts');
const approvalController = read('apps/api/src/supervisor-approval/supervisor-approval.controller.ts');
const adminPage = read('apps/admin/app/page.tsx');

test('the Access Control panel actually calls the supervisor PIN endpoint', () => {
  assert.match(accessControl, /'\/supervisor-approval\/pin'/,
    'the panel must call the real endpoint, not a local stand-in');
  assert.match(accessControl, /method:'POST'/);
  assert.match(accessControl, /targetUserId:user\.id/,
    'the target must be the user whose row the operator acted on');
});

test('the panel reads live approver status, degrading authorization only while surfacing outages', () => {
  // Operators without approval visibility may receive 401/403 and get a neutral fallback. A network
  // or 5xx failure is not equivalent to "not configured" and must still fail the workspace load.
  assert.match(accessControl, /'\/supervisor-approval\/status'/);
  assert.match(accessControl, /optionalAuthorization/);
  assert.match(accessControl, /\\b\(401\|403\)\\b/);
  assert.match(accessControl, /HTTP \$\{response\.status\}/);
  assert.doesNotMatch(accessControl, /\.catch\(\(\)=>null\)/);
  assert.match(accessControl, /setSupervisorStatus\(nextSupervisorStatus\)/,
    'and the result must reach state, not be fetched and discarded');
});

test('appointing and revoking are two explicit actions', () => {
  // Revoking on blur would strip somebody's authority because the operator tabbed away. This is an
  // explicit action in the call itself, so the test below asserts the revoke sends an empty PIN
  // explicitly rather than relying on a substring that a correctly-written revoke would not contain
  // either — that check passed against the exact bug it was written for.
  assert.match(accessControl, /saveSupervisorPin\(user,''\)/,
    'Cabut must send an explicit empty PIN');
  // The real hazard: ANY blur-triggered call to the setter revokes authority as a side effect of
  // navigating away. Assert the setter is only reachable from a click.
  //
  // Two dead ends here, both worth recording. `assert.doesNotMatch` on the string `onBlur=` was
  // vacuous: it passed with the bug present, because the buggy handler was a different shape than
  // the string it searched for. The replacement, matching the whole `<input ... />` element with
  // `<input[^>]*type="password"[^>]*\/>`, then failed for a reason that had nothing to do with the
  // behaviour — `[^>]*` stops at the `>` of the `=>` inside `onChange={(event)=>setUserForm(...)}`,
  // so the element could never be captured. A test that fails on a regex detail teaches nothing.
  // Line-scoped matching is what the file's own formatting supports, and it is checked for presence
  // first so "found no PIN field" cannot read as "found no bug".
  const pinLines = accessControl.split('\n').filter((line) => line.includes('type="password"'));
  assert.ok(pinLines.length >= 2,
    `expected to find the PIN field(s) to inspect, found ${pinLines.length} — a guard that matches nothing proves nothing`);
  for (const line of pinLines) {
    assert.doesNotMatch(line, /onBlur/,
      'no PIN field may act on blur: tabbing away must not revoke somebody\'s authority');
    assert.doesNotMatch(line, /void saveSupervisorPin/,
      'the PIN field must never call the setter itself — only the explicit buttons may');
  }
  assert.match(accessControl, /disabled=\{!canManageUsers\|\|!\(supervisorDrafts\[user\.id\]\?\?''\)\.trim\(\)\}/,
    'saving must be blocked until a PIN is actually typed');
});

test('the operator cannot appoint or revoke themselves', () => {
  // Self-approval is refused server-side, but the UI must not offer it: a row that offers an action
  // the server will always refuse is a broken control.
  assert.match(accessControl, /user\.id===actorId[\s\S]{0,220}Akun aktif sendiri dilindungi/);
});

test('the roster tells the UI who the approver is', () => {
  // Without these two fields the panel has nothing to render: `canApprovePrivilegedActions` is the
  // appointment itself, and the timestamp is what tells an administrator a PIN is already set.
  assert.match(usersService, /canApprovePrivilegedActions: true/,
    'GET /users must return the approver flag');
  assert.match(usersService, /supervisorPinUpdatedAt: true/,
    'and when the PIN was last changed');
  assert.doesNotMatch(usersService, /select:[\s\S]{0,700}?supervisorPinHash: true/,
    'the PIN HASH must never leave the server — the UI only needs to know one exists');
});

test('the panel is actually mounted on a real Admin route', () => {
  // The "declared but never rendered" failure mode: the import exists, the component is never
  // reached. Mounting is the only thing that makes it a surface.
  assert.match(adminPage, /import AccessControlView from '\.\/modules\/access-control'/);
  const mount = adminPage.match(/<AccessControlView[\s\S]{0,400}?\/>/);
  assert.ok(mount, 'AccessControlView must be rendered somewhere, not merely imported');
  assert.match(usersController, /@Get\(\)/, 'and its data source must still be routed');
});

test('the setter stays restricted to owner-level roles, in the controller that owns it', () => {
  // The panel only renders for user.manage holders, but the server is the boundary: a CASHIER must
  // be refused even with a hand-crafted request.
  assert.match(approvalController, /SUPER_ADMIN', 'OWNER', 'ADMIN'/);
  assert.match(approvalController, /Hanya OWNER, ADMIN, atau SUPER_ADMIN yang dapat mengatur PIN supervisor/);
});
