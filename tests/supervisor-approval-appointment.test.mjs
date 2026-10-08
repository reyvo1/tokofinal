// A control nobody can satisfy is a control that gets switched off.
//
// `setPin()` wrote `supervisorPinHash` and nothing else, while `findApprover()` requires
// `canApprovePrivilegedActions: true`. No code in the repository ever wrote that column. So
// `POST /supervisor-approval/pin` answered 201 {ok:true}, the POS read `configured:false`, and every
// approval was refused with "Belum ada supervisor terdaftar" — forever, in every branch, with no
// error anywhere. tsc, 1351 tests, and the six production builds were all green.
//
// These tests run the real service against a stub Prisma, because the failure mode is a *write* that
// is missing: grepping the source for the column name would pass against exactly this bug.
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers/import-ts.mjs';

const { SupervisorApprovalService } = await load(
  'apps/api/src/supervisor-approval/supervisor-approval.service.ts',
  { platform: 'node' },
);

const COMPANY = '00000000-0000-4000-8000-000000000001';
const CASHIER = { sub: 'cashier-1', companyId: COMPANY, branchId: 'branch-1', roles: ['CASHIER'] };
const APPROVER = { id: 'manager-1', name: 'Kepala Toko' };

/**
 * A stub Prisma that behaves like the real table, not like the test's expectation.
 *
 * `canApprovePrivilegedActions` starts false, exactly as the schema default leaves it. If the code
 * under test never writes the flag, the stub will faithfully keep reporting "no approver" — which is
 * the bug this test exists to catch.
 */
function makePrisma({ approverExists = true, approverActive = true, approverBranchId = 'branch-1' } = {}) {
  // Each user carries the company its BRANCH belongs to, because that is how tenancy is expressed:
  // `User` has no companyId column, so every scope in the service goes through the relation.
  const branchCompany = { 'branch-1': COMPANY, 'branch-2': 'company-b' };
  const users = new Map();
  if (approverExists) {
    users.set(APPROVER.id, {
      id: APPROVER.id,
      name: APPROVER.name,
      branchId: approverBranchId,
      companyId: branchCompany[approverBranchId],
      isActive: approverActive,
      canApprovePrivilegedActions: false,
      supervisorPinHash: null,
      supervisorPinUpdatedAt: null,
    });
  }
  const audit = [];

  /** Evaluate the subset of Prisma's `where` grammar this service actually uses. */
  function matches(row, where) {
    if (!where) return true;
    if (where.id !== undefined && where.id !== row.id) return false;
    if (where.isActive !== undefined && where.isActive !== row.isActive) return false;
    if (where.canApprovePrivilegedActions !== undefined
      && where.canApprovePrivilegedActions !== row.canApprovePrivilegedActions) return false;
    if (where.NOT?.id !== undefined && where.NOT.id === row.id) return false;
    if (where.branchId !== undefined && where.branchId !== row.branchId) return false;
    if (where.branch?.companyId !== undefined && where.branch.companyId !== row.companyId) return false;
    // `OR: [{branchId: X}, {branchId: null}]` — the approver may be in the operator's own branch or
    // a company-wide one. A supervisor from a sister branch must not match.
    if (Array.isArray(where.OR) && !where.OR.some((clause) => matches(row, clause))) return false;
    return true;
  }

  return {
    users,
    audit,
    user: {
      findFirst: async ({ where, select }) => {
        const row = [...users.values()].find((candidate) => matches(candidate, where));
        if (!row) return null;
        if (!select) return { ...row };
        const out = {};
        for (const key of Object.keys(select)) if (key in row) out[key] = row[key];
        return out;
      },
      findUnique: async ({ where }) => (users.has(where.id) ? { ...users.get(where.id) } : null),
      update: async ({ where, data }) => {
        const row = users.get(where.id);
        if (!row) throw new Error(`no such user ${where.id}`);
        Object.assign(row, data);
        return { ...row };
      },
    },
    auditLog: {
      create: async ({ data }) => { audit.push(data); return data; },
    },
  };
}

const service = (prisma) => new SupervisorApprovalService(prisma);
const rejection = async (fn) => {
  try { await fn(); } catch (error) { return error; }
  throw new Error('expected a rejection, but the call resolved');
};

test('appointing a supervisor actually appoints them: the flag is written with the PIN', async () => {
  // THE regression. Before the fix this was 403 "Belum ada supervisor terdaftar" even though the
  // PIN was set correctly a moment earlier.
  const prisma = makePrisma();
  await service(prisma).setPin({ sub: 'owner-1', companyId: COMPANY }, APPROVER.id, '482913');

  const row = prisma.users.get(APPROVER.id);
  assert.ok(row.supervisorPinHash, 'the PIN hash must be stored');
  assert.equal(row.canApprovePrivilegedActions, true,
    'setting a PIN must ALSO set the approver flag — otherwise the approver is never found');
  assert.ok(row.supervisorPinUpdatedAt, 'and record when it was set');

  // And the consequence, not just the write: the operator can now be approved.
  const grant = await service(prisma).approve(CASHIER, '482913', {
    action: 'SALE_LINE_DISCOUNT', reason: 'diskon 30%',
  });
  assert.equal(grant.approvedByName, APPROVER.name);
  assert.ok(grant.grantId, 'a grant id must be issued');
  assert.equal(prisma.audit.filter((row) => row.action === 'SUPERVISOR_APPROVAL_GRANTED').length, 1,
    'the approval must be audited');
});

test('a wrong PIN is still refused once an approver exists, and the refusal is audited', async () => {
  // The distinction the POS message depends on: "PIN salah" means find a supervisor, while "belum ada
  // supervisor" means there is nobody to find. Collapsing them sends the cashier hunting for a
  // supervisor who cannot help.
  const prisma = makePrisma();
  await service(prisma).setPin({ sub: 'owner-1', companyId: COMPANY }, APPROVER.id, '482913');

  const error = await rejection(() => service(prisma).approve(CASHIER, '000000', {
    action: 'SALE_LINE_DISCOUNT', reason: 'probe',
  }));
  assert.equal(error.getStatus?.() ?? error.status, 401);
  assert.match(String(error.message), /PIN supervisor salah/);
  assert.equal(prisma.audit.filter((row) => row.action === 'SUPERVISOR_APPROVAL_FAILED').length, 1);
});

test('clearing the PIN revokes the appointment, so the branch cannot approve at all', async () => {
  // The opposite drift: leaving the flag on with no PIN would produce a second confusing state, an
  // "approver" who can never approve.
  const prisma = makePrisma();
  const api = service(prisma);
  await api.setPin({ sub: 'owner-1', companyId: COMPANY }, APPROVER.id, '482913');
  await api.setPin({ sub: 'owner-1', companyId: COMPANY }, APPROVER.id, null);

  const row = prisma.users.get(APPROVER.id);
  assert.equal(row.supervisorPinHash, null);
  assert.equal(row.canApprovePrivilegedActions, false, 'revoking the PIN must revoke the appointment');

  const status = await api.approverStatus(CASHIER);
  assert.equal(status.configured, false);
  assert.equal(status.approverName, null, 'a revoked approver must not be offered to the POS');
  const error = await rejection(() => api.approve(CASHIER, '482913', {
    action: 'SALE_LINE_DISCOUNT', reason: 'probe',
  }));
  assert.match(String(error.message), /Belum ada supervisor terdaftar/);
});

test('a grant is single-use, action-scoped, and company-scoped', async () => {
  const prisma = makePrisma();
  const api = service(prisma);
  await api.setPin({ sub: 'owner-1', companyId: COMPANY }, APPROVER.id, '482913');

  const grant = await api.approve(CASHIER, '482913', { action: 'SALE_LINE_DISCOUNT', reason: 'a' });
  api.consume(grant.grantId, 'SALE_LINE_DISCOUNT', CASHIER);
  const replay = await rejection(() => api.consume(grant.grantId, 'SALE_LINE_DISCOUNT', CASHIER));
  assert.match(String(replay.message), /tidak ditemukan atau sudah dipakai/,
    'one approval must not authorise a second sale');

  const shift = await api.approve(CASHIER, '482913', { action: 'SHIFT_CLOSE', reason: 'b' });
  const wrongAction = await rejection(() => api.consume(shift.grantId, 'SALE_LINE_DISCOUNT', CASHIER));
  assert.match(String(wrongAction.message), /tidak berlaku untuk tindakan ini/);

  // Used to use SALE_REFUND here, which was deleted from the enum in this session: an action that
  // nothing spends is an advertised-but-absent control. The scope check is about the COMPANY, so any
  // action that really exists proves it.
  const other = await api.approve(CASHIER, '482913', { action: 'SALE_CASH_MOVEMENT', reason: 'c' });
  const otherCompany = await rejection(() =>
    api.consume(other.grantId, 'SALE_CASH_MOVEMENT', { ...CASHIER, companyId: 'other-company' }));
  assert.match(String(otherCompany.message), /tidak valid untuk perusahaan ini/);
});

test('an inactive or absent approver is refused explicitly, never treated as "no approval needed"', async () => {
  const absent = makePrisma({ approverExists: false });
  const noSupervisor = await rejection(() => service(absent).approve(CASHIER, '482913', {
    action: 'SALE_LINE_DISCOUNT', reason: 'probe',
  }));
  assert.match(String(noSupervisor.message), /Belum ada supervisor terdaftar/);

  const inactive = makePrisma({ approverActive: false });
  await service(inactive).setPin({ sub: 'owner-1', companyId: COMPANY }, APPROVER.id, '482913');
  const dismissed = await rejection(() => service(inactive).approve(CASHIER, '482913', {
    action: 'SALE_LINE_DISCOUNT', reason: 'probe',
  }));
  assert.match(String(dismissed.message), /Belum ada supervisor terdaftar/);
});

test('a cashier cannot be appointed outside their own company', async () => {
  const prisma = makePrisma();
  const error = await rejection(() => service(prisma).setPin({ sub: 'owner-1', companyId: 'company-a' }, APPROVER.id, '482913'));
  assert.match(String(error.message), /tidak ditemukan pada perusahaan ini/);
  assert.equal(prisma.users.get(APPROVER.id).canApprovePrivilegedActions, false);
});

test('brute force is bounded: five wrong PINs lock the operator out with 429', async () => {
  const prisma = makePrisma();
  const api = service(prisma);
  await api.setPin({ sub: 'owner-1', companyId: COMPANY }, APPROVER.id, '482913');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await rejection(() => api.approve(CASHIER, '000000', { action: 'SALE_LINE_DISCOUNT', reason: 'x' }));
  }
  const locked = await rejection(() => api.approve(CASHIER, '482913', { action: 'SALE_LINE_DISCOUNT', reason: 'x' }));
  assert.equal(locked.getStatus?.() ?? locked.status, 429,
    'a locked-out operator must be told to back off, not handed another attempt');
});
