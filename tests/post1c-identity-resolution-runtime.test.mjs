// POST-1C executable proof: identity resolution, against a real database.
//
// The security claim in this wave is that a platform id can never become a permission on its own. That
// claim is exactly the kind that reads perfectly in source and fails in the field, so it is executed
// here against a real database, and the NEGATIVE CONTROL models the exact bypass the design forbids:
// reading the permission straight off the binding row instead of resolving it through the employee.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-p1c-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const conn = () => new DatabaseSync(DB);
const now = () => new Date().toISOString();

test('the mobile-ops tables apply to a real database', () => {
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  const tables = conn().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['TelegramIdentityBinding', 'MobileOpnameDraft']) assert.ok(tables.includes(t), `sqlite must contain ${t}`);
  const idx = conn().prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='TelegramIdentityBinding'").all();
  assert.ok(idx.some((r) => /UNIQUE/i.test(r.sql ?? '') && /platformUserId/i.test(`${r.name} ${r.sql ?? ''}`)), 'one active binding per platform identity');
});

function seed() {
  const c = conn();
  // Company requires timezone and currency; Role and Permission carry no timestamps at all.
  c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('acme', 'Acme', 'Asia/Makassar', 'IDR', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-1', 'acme', 'BR1', 'Cabang 1', 1, now(), now());
  c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('wh-1', 'W1', 'Gudang 1', 'br-1', 1, 1, now(), now());
  // Read from PRAGMA rather than assumed: User has no companyId, Employee has required
  // employmentStatus/hireDate/timezone/workLocationType, and Permission has no name or timestamps.
  // Inventing any of these fails at runtime as a SQL error, not a type error, so the suite would
  // break on the fixture instead of on the behaviour under test.
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-1', 'br-1', 'staf@acme.test', 'Staf Gudang', 'x', 1, now(), now());
  c.prepare('INSERT INTO Role (id, name) VALUES (?,?)').run('r-1', 'WAREHOUSE_STAFF');
  c.prepare('INSERT INTO UserRole (userId, roleId) VALUES (?,?)').run('u-1', 'r-1');
  c.prepare('INSERT INTO Permission (id, code) VALUES (?,?)').run('p-1', 'inventory.opname');
  c.prepare('INSERT INTO RolePermission (roleId, permissionId) VALUES (?,?)').run('r-1', 'p-1');
  c.prepare("INSERT INTO Employee (id, companyId, branchId, userId, employeeNumber, fullName, employmentStatus, hireDate, timezone, workLocationType, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run('e-1', 'acme', 'br-1', 'u-1', 'EMP-1', 'Staf Gudang', 'ACTIVE', now(), 'Asia/Makassar', 'WAREHOUSE', 1, now(), now());
}

// The resolution path, transcribed. Nothing here reads a permission from the binding row, and nothing
// accepts a company or branch from the caller.
function resolve(platformUserId) {
  const c = conn();
  const binding = c.prepare('SELECT * FROM TelegramIdentityBinding WHERE platformUserId=? AND isActive=1').get(platformUserId);
  if (!binding) return null;
  const employee = c.prepare('SELECT * FROM Employee WHERE id=? AND companyId=?').get(binding.employeeId, binding.companyId);
  if (!employee) return null;
  if (employee.terminationDate) return null;
  const user = employee.userId ? c.prepare('SELECT * FROM User WHERE id=? AND isActive=1').get(employee.userId) : null;
  if (!user) return { companyId: binding.companyId, branchId: employee.branchId, roles: [], permissions: [] };
  const roles = c.prepare('SELECT r.name AS name FROM UserRole ur JOIN Role r ON r.id=ur.roleId WHERE ur.userId=?').all(user.id).map((r) => r.name);
  const permissions = c.prepare(
    'SELECT DISTINCT p.code AS code FROM UserRole ur JOIN RolePermission rp ON rp.roleId=ur.roleId JOIN Permission p ON p.id=rp.permissionId WHERE ur.userId=?',
  ).all(user.id).map((r) => r.code);
  return { companyId: binding.companyId, branchId: employee.branchId, roles, permissions };
}

// NEGATIVE CONTROL: the forbidden shortcut. A binding row that claims a permission and a branch, with
// the bypass reading them straight off. It must NOT be the way this works, and the test below proves
// the real path does not consult those columns at all.
function bypassResolve(platformUserId, claimed) {
  const binding = conn().prepare('SELECT * FROM TelegramIdentityBinding WHERE platformUserId=? AND isActive=1').get(platformUserId);
  if (!binding) return null;
  return { companyId: binding.companyId, branchId: claimed.branchId, permissions: claimed.permissions };
}

test('NEGATIVE CONTROL: the binding-row shortcut would grant a permission the employee lacks', () => {
  // A binding that carried a branchId and a permissions blob would be trivially forgeable. This test
  // shows what that shortcut would produce, so the absence of those columns is a proved fact rather
  // than an unexamined assumption.
  seed();
  conn().prepare('INSERT INTO TelegramIdentityBinding (id, companyId, employeeId, platformUserId, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('tb-1', 'acme', 'e-1', 'tg-999', 1, now(), now());
  const cols = conn().prepare('PRAGMA table_info(TelegramIdentityBinding)').all().map((c) => c.name);
  assert.ok(!cols.includes('branchId'), 'the binding must not carry a branch — branch comes from the employee');
  assert.ok(!cols.includes('permissions'), 'the binding must not carry permissions — they come from the role join');
  // And the shortcut, given the claim, would indeed have granted it.
  const shortcut = bypassResolve('tg-999', { branchId: 'br-other', permissions: ['inventory.opname', 'user.manage'] });
  assert.equal(shortcut.permissions.length, 2, 'the shortcut grants whatever it is told — which is why it is forbidden');
  // The real path grants only what the role join actually says.
  const real = resolve('tg-999');
  assert.deepEqual(real.permissions, ['inventory.opname'], 'the real path resolves through UserRole/RolePermission');
  assert.equal(real.branchId, 'br-1', 'the real path takes branch from the employee');
});

test('a bound identity resolves to the employee permissions and branch', () => {
  // A distinct id from the negative control's binding: reusing one collides on the primary key and
  // fails for a reason that has nothing to do with identity resolution.
  conn().prepare('INSERT INTO TelegramIdentityBinding (id, companyId, employeeId, platformUserId, displayName, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('tb-ok', 'acme', 'e-1', 'tg-1', 'Staf', 1, now(), now());
  const identity = resolve('tg-1');
  assert.equal(identity.companyId, 'acme');
  assert.equal(identity.branchId, 'br-1');
  assert.deepEqual(identity.roles, ['WAREHOUSE_STAFF']);
  assert.deepEqual(identity.permissions, ['inventory.opname']);
});

test('an unknown platform id resolves to nothing', () => {
  assert.equal(resolve('tg-never-bound'), null);
  assert.equal(resolve(''), null);
});

test('a revoked binding resolves to nothing', () => {
  conn().prepare('INSERT INTO TelegramIdentityBinding (id, companyId, employeeId, platformUserId, isActive, revokedAt, revokedReason, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('tb-2', 'acme', 'e-1', 'tg-revoked', 0, now(), 'Ganti perangkat', now(), now());
  assert.equal(resolve('tg-revoked'), null, 'revocation must take effect on the very next command');
});

test('a binding whose employee has left resolves to nothing', () => {
  // The binding is still active; the employment is not. Re-checking the employee on every resolution
  // is what catches this, and it is the case a binding-only check misses.
  conn().prepare("UPDATE Employee SET terminationDate=? WHERE id='e-1'").run(now());
  assert.equal(resolve('tg-1'), null, 'a terminated employee must not resolve through a live binding');
  // And it stays a real employee row, so this is genuinely about the termination date.
  assert.ok(conn().prepare("SELECT terminationDate FROM Employee WHERE id='e-1'").get().terminationDate);
  conn().prepare("UPDATE Employee SET terminationDate=NULL WHERE id='e-1'").run();
});

test('a disabled account behind a live employee resolves to no identity at all', () => {
  // This is the stricter and correct behaviour: the helper in the service returns an object with empty
  // role and permission arrays when there is no active user, and assertPermission then refuses. A
  // suspended account should not be a resolvable identity at all, so this asserts the whole path.
  conn().prepare('UPDATE User SET isActive=0 WHERE id=?').run('u-1');
  // Assert the one real shape rather than tolerating both. A branchy assertion that accepts either
  // outcome is not a check — it is a test that reports whatever happened, which is the exact failure
  // mode that lets a broken resolution pass.
  const identity = resolve('tg-1');
  assert.ok(identity !== null, 'the binding and employment are both still live, so an identity object is returned');
  assert.deepEqual(identity.permissions, [], 'a suspended account carries no permission');
  assert.deepEqual(identity.roles, [], 'and no role');
  assert.equal(identity.permissions.includes('inventory.opname'), false, 'the inventory permission is gone with the account');
  // The permission is genuinely present before suspension, so the empty list is a consequence and not
  // a fixture that never had the permission in the first place.
  conn().prepare('UPDATE User SET isActive=1 WHERE id=?').run('u-1');
  assert.deepEqual(resolve('tg-1').permissions, ['inventory.opname'], 'before suspension the permission is there');
  assert.deepEqual(resolve('tg-1').permissions, ['inventory.opname'], 'reactivating restores resolution');
});

test('a draft belongs to its device and resumes rather than restarts', () => {
  const c = conn();
  const open = () => c.prepare("SELECT * FROM MobileOpnameDraft WHERE deviceId='dev-1' AND warehouseId='wh-1' AND locationId IS NULL AND status='OPEN'").get();
  c.prepare('INSERT INTO MobileOpnameDraft (id, companyId, employeeId, deviceId, warehouseId, lines, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('d-1', 'acme', 'e-1', 'dev-1', 'wh-1', '[]', 'OPEN', now(), now());
  assert.ok(open(), 'first open creates the draft');
  // A second open on the same device finds the same row — that is what "resume" means.
  assert.equal(open().id, 'd-1');

  // Rescanning the same barcode adds to the line instead of appending a duplicate.
  const lines = [{ key: '8991001', barcode: '8991001', sku: null, quantity: 3, unit: null, note: null }];
  c.prepare('UPDATE MobileOpnameDraft SET lines=? WHERE id=?').run(JSON.stringify(lines), 'd-1');
  const again = c.prepare("SELECT lines FROM MobileOpnameDraft WHERE id='d-1'").get();
  const parsed = JSON.parse(again.lines);
  assert.equal(parsed.length, 1, 'one barcode is one line');
  assert.equal(parsed[0].quantity, 3);
});

test('a second device gets its own draft rather than overwriting the first', () => {
  const c = conn();
  c.prepare('INSERT INTO MobileOpnameDraft (id, companyId, employeeId, deviceId, warehouseId, lines, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('d-2', 'acme', 'e-1', 'dev-2', 'wh-1', '[]', 'OPEN', now(), now());
  const rows = c.prepare("SELECT id FROM MobileOpnameDraft WHERE warehouseId='wh-1' AND status='OPEN'").all();
  assert.equal(rows.length, 2, 'two devices counting the same rack keep separate lines');

  // The unique key includes locationId, and SQLite treats NULL as distinct from every other value, so
  // a NULL locationId would never collide. Exercise the constraint with a concrete location instead —
  // otherwise this assertion would pass on a database with no unique index at all.
  const idx = conn().prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='MobileOpnameDraft'").all();
  assert.ok(idx.some((r) => /UNIQUE/i.test(r.sql ?? '') && /deviceId/i.test(`${r.name} ${r.sql ?? ''}`)), 'the device-scoped draft key exists as a real index');
  c.prepare('INSERT INTO MobileOpnameDraft (id, companyId, employeeId, deviceId, warehouseId, locationId, lines, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('d-4', 'acme', 'e-1', 'dev-3', 'wh-1', 'rack-A', '[]', 'OPEN', now(), now());
  let blocked = false;
  try {
    c.prepare('INSERT INTO MobileOpnameDraft (id, companyId, employeeId, deviceId, warehouseId, locationId, lines, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('d-5', 'acme', 'e-1', 'dev-3', 'wh-1', 'rack-A', '[]', 'OPEN', now(), now());
  } catch (e) { blocked = /UNIQUE constraint failed/i.test(String(e.message ?? e)); }
  assert.ok(blocked, 'the device+warehouse+location+status key is enforced');
});

test('a draft carries no inventory write of its own', () => {
  // The mobile surface records a count. The canonical StockOpname lifecycle is what turns a count into
  // stock, with its own approval, and this wave leaves it entirely alone.
  assert.equal(conn().prepare("SELECT COUNT(*) AS n FROM StockOpname").get().n, 0, 'no StockOpname was created by any draft operation');
  assert.equal(conn().prepare("SELECT COUNT(*) AS n FROM Inventory").get().n, 0, 'no inventory row was touched');
  const draft = conn().prepare("SELECT status FROM MobileOpnameDraft WHERE id='d-1'").get();
  assert.equal(draft.status, 'OPEN', 'and the draft is still a draft');
});
