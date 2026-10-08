// A cashier could give away the whole basket.
//
// `create()` checked only `discount <= subtotal`, so a 99% discount on a large basket committed with
// no approver, no PIN, and nothing in the audit trail. The backend did have a role split for refunds
// (CASHIER files, FINANCE confirms) but the till had no way to BE the approver, so a control nobody
// could satisfy is a control that gets switched off.
//
// The tests below prove three separate things, because each can fail independently while the suite
// stays green: that the server refuses without a grant, that the grant is single-use and scoped,
// and that the POS actually asks for one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sales = read('apps/api/src/sales/sales.service.ts');
const approval = read('apps/api/src/supervisor-approval/supervisor-approval.service.ts');
const controller = read('apps/api/src/supervisor-approval/supervisor-approval.controller.ts');
const schema = read('apps/api/prisma/schema.prisma');
const schemaSqlite = read('apps/api/prisma/schema.sqlite.prisma');
const schemaPostgres = read('apps/api/prisma/schema.postgresql.prisma');
const posSupervisor = read('apps/pos/lib/supervisor.ts');
const pos = read('apps/pos/app/page.tsx');
const salesModule = read('apps/api/src/sales/sales.module.ts');

test('the discount gate is on the commit path, not just the preview', () => {
  // A gate in quote() alone would let the cashier see the discounted total and then discover at
  // submit time that it is refused — after the customer is already being served.
  assert.match(sales, /const SUPERVISOR_DISCOUNT_RATIO = new Prisma\.Decimal\('0\.20'\)/,
    'the threshold must be a fixed constant, not configurable from a screen');
  const commit = sales.slice(sales.indexOf('async create('));
  assert.match(commit, /discount\.dividedBy\(rawSubtotal\)\.greaterThan\(SUPERVISOR_DISCOUNT_RATIO\)/,
    'the threshold check must live in create(), where money is committed');
  assert.match(commit, /Diskon di atas 20% memerlukan persetujuan supervisor/);
  // And without a grant it must refuse rather than fall through to the old behaviour.
  assert.match(commit, /if \(!grantId\) \{\s*throw new ForbiddenException/);
});

test('the grant is consumed, so one approval cannot authorise a second sale', () => {
  assert.match(commit_guards(), /this\.approvals\.consume\(grantId, 'SALE_LINE_DISCOUNT', user\)/,
    'the grant must be spent at the point of use');
  // Single-use is enforced in the service; a replayable grant is a standing permission.
  assert.match(approval, /this\.grants\.delete\(grantId\);/,
    'consume() must delete the grant');
  assert.match(approval, /if \(grant\.action !== action\)/,
    'and must refuse a grant issued for a different action');
  assert.match(approval, /grant\.companyId !== user\.companyId/,
    'and must refuse a grant from another company');
  // Expiry is a real control, so it needs its own assertion. It was previously covered only
  // indirectly by the mere PRESENCE of a TTL constant, which stayed green when the check that uses
  // the constant was deleted — the definition outliving its only use.
  assert.match(approval, /const GRANT_TTL_MS = 5 \* 60 \* 1000;/,
    'a grant is valid for minutes, not for the shift');
  assert.match(approval, /if \(grant\.expiresAt < Date\.now\(\)\) \{/,
    'and consume() must actually check it');
  assert.match(approval, /Persetujuan supervisor sudah kedaluwarsa/,
    'and must say so, so the cashier asks again instead of retrying a dead grant');
});

test('approval issues a capability, never a token or a session', () => {
  // The difference between "a manager approved this" and "the till is now a manager". The second is
  // how till fraud starts, so no JWT, no refresh token, no role change may appear here.
  assert.doesNotMatch(approval, /signAsync|jwtService\.sign|accessToken|refreshToken/,
    'supervisor approval must not mint credentials');
  assert.doesNotMatch(approval, /data:\s*\{[^}]*roles/,
    'and must not alter the approver\'s roles');
  // Every outcome is audited, including failures — a pattern of wrong PINs is the signal a branch
  // manager needs, and it is invisible without the failure rows.
  assert.match(approval, /SUPERVISOR_APPROVAL_FAILED/);
  assert.match(approval, /SUPERVISOR_APPROVAL_GRANTED/);
});

test('a branch with no approver is refused explicitly, not treated as "no approval needed"', () => {
  // The dangerous failure mode: no supervisor exists, the endpoint finds nobody, and the default is
  // to allow. The service must say so in words the cashier can act on.
  assert.match(approval, /Belum ada supervisor terdaftar di cabang ini/);
  assert.match(approval, /canApprovePrivilegedActions/,
    'and the approver must be an explicitly flagged manager, not merely the first user found');
  assert.match(approval, /NOT: \{ id: user\.sub \}/,
    'a cashier must not approve their own privileged action');
});

test('brute force is bounded and the PIN is never stored in the clear', () => {
  assert.match(approval, /PIN_MAX_FAILURES/);
  assert.match(approval, /HttpStatus\.TOO_MANY_REQUESTS/,
    'a locked-out operator must get 429, not a generic 403');
  assert.match(approval, /await hash\(pin, 10\)/, 'the PIN must be hashed');
  assert.match(approval, /await compare\(pin, candidate\.supervisorPinHash\)/, 'and compared');
  assert.doesNotMatch(approval, /pinHash: pin/);
  // 4-8 digits: long enough to be worth guessing, short enough to type at a till in a hurry.
  assert.match(approval, /\^\\d\{4,8\}\$/);
});

test('the three Prisma schemas carry the same approval fields', () => {
  // Field-for-field parity is enforced elsewhere; this is the specific check that the NEW columns
  // exist everywhere, since a field added to only one schema fails at runtime, not at build.
  for (const [name, text] of [['schema.prisma', schema], ['sqlite', schemaSqlite], ['postgres', schemaPostgres]]) {
    assert.match(text, /supervisorPinHash\s+String\?/, `${name} is missing supervisorPinHash`);
    assert.match(text, /canApprovePrivilegedActions\s+Boolean\s+@default\(false\)/, `${name} is missing the approver flag`);
    assert.match(text, /supervisorPinUpdatedAt\s+DateTime\?/, `${name} is missing the PIN timestamp`);
  }
});

test('only an owner or admin can SET a PIN, while any cashier may request approval', () => {
  // Asymmetric on purpose: the setter controls a credential that gates money.
  assert.match(controller, /SUPER_ADMIN', 'OWNER', 'ADMIN'/);
  assert.match(controller, /Hanya OWNER, ADMIN, atau SUPER_ADMIN yang dapat mengatur PIN supervisor/);
  assert.match(controller, /@Get\('status'\)/, 'the POS needs to know if an approver exists');
});

test('SalesModule actually imports the approval module', () => {
  // Nest fails at BOOT, not at build, on a missing provider import — the exact class of bug the
  // boot probe exists to catch.
  assert.match(salesModule, /SupervisorApprovalModule/);
});

test('the POS holds a PIN dialog and never persists a PIN or a grant', () => {
  assert.match(posSupervisor, /export function useSupervisorApproval/);
  assert.match(posSupervisor, /if \(!pending \|\| !token\)/, 'no session, no approval');
  // A grant that survives a reload is a standing permission, so it must stay in component state.
  // Strip comments first: the file's own doc comment NAMES localStorage to explain why it is not
  // used, and a naive substring check fails on the explanation. What matters is executable code.
  const posSupervisorCode = posSupervisor.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(posSupervisorCode, /localStorage|sessionStorage|indexedDB/,
    'the PIN and grant must never touch persistent storage');
  assert.match(posSupervisor, /setGrant\(result\)/);
  assert.match(posSupervisor, /const takeGrant = useCallback/, 'and must be consumable exactly once');
  // Failing closed: a status lookup that errors must not unlock the action. A network blip must
  // never be the reason a privileged action becomes possible.
  assert.match(posSupervisor, /catch \{[\s\S]*?setConfigured\(false\);/,
    'an unknown approver status must be treated as unavailable');
});

test('the POS wires the gate to the discount action it protects', () => {
  assert.match(pos, /useSupervisorApproval/);
  assert.match(pos, /SALE_LINE_DISCOUNT/);
  // And the grant has to reach the sale request, or the server refuses every large discount.
  assert.match(pos, /supervisorApprovalId/);
});

function commit_guards() {
  return sales.slice(sales.indexOf('async create('));
}
