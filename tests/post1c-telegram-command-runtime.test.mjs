// POST-1C executable proof: the Telegram command surface, executed.
//
// The roadmap lists Telegram commands as NOT BUILT, and the service underneath was written with a
// comment saying `assertPermission` is "called by every command handler" while no handler existed. The
// wave therefore had no functional path on the platform it was designed for — and that is invisible to
// any gate, because nothing was missing at runtime; nothing was there.
//
// This test loads the REAL `TelegramCommandService` and the REAL `MobileOpsService` and runs them
// against a real pushed SQLite database. That is deliberate: the two existing POST-1C runtime suites
// transcribe their logic, so they cannot catch a service that drifted from the transcription. Here the
// code under test is the code that ships.
//
// PRAGMA is read rather than assumed: a wrong column name fails as a SQL error and breaks the fixture
// instead of the behaviour under test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-p1c-cmd-')), 'proof.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const prisma = (args) => execFileSync('npx', ['prisma', ...args, '--schema', prismaFml], { cwd: ROOT, env, encoding: 'utf8' });
const conn = () => new DatabaseSync(DB);
const now = () => new Date().toISOString();

test('schema applies, and the seeded employmentStatus is a real enum value', () => {
  prisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  // EmploymentStatus has no 'ACTIVE' — it is PROBATION/PERMANENT/CONTRACT/... The first run of this
  // suite seeded 'ACTIVE' and every command failed inside resolveIdentity with a Prisma enum error,
  // which reads as "the feature is broken" rather than "the fixture is wrong".
  //
  // SQLite has no enum type, so the constraint is not in the database and PRAGMA cannot find it. The
  // real list lives in the Prisma schema, so read it there and assert the fixture against it — which
  // still catches drift, and fails as a clear fixture error instead of an error inside the behaviour.
  const schema = fs.readFileSync(prismaFml, 'utf8');
  const block = schema.match(/enum EmploymentStatus\s*{([^}]*)}/)?.[1] ?? '';
  // Newline-separated, not comma-separated: splitting on ',' silently yields one value and the
  // assertion below then fails for a reason that has nothing to do with the enum.
  const values = block.split(/\s+/).map((v) => v.trim()).filter(Boolean);
  assert.ok(values.includes('PERMANENT'), `EmploymentStatus must contain PERMANENT, got ${values.join('/')}`);
  assert.ok(values.includes('TERMINATED'), 'the terminated-employee case depends on this value existing');
  assert.ok(!values.includes('ACTIVE'), 'ACTIVE is not a value — do not seed it');
  const cols = conn().prepare('PRAGMA table_info(Employee)').all().map((r) => r.name);
  for (const col of ['employmentStatus', 'terminationDate', 'branchId', 'userId']) {
    assert.ok(cols.includes(col), `Employee must carry ${col}`);
  }
});

function seed() {
  const c = conn();
  c.exec('DELETE FROM AuditLog; DELETE FROM StockOpnameItem; DELETE FROM StockOpname; DELETE FROM MobileOpnameDraft;'
    + ' DELETE FROM TelegramIdentityBinding; DELETE FROM Employee; DELETE FROM UserRole; DELETE FROM RolePermission;'
    + ' DELETE FROM Role; DELETE FROM Permission; DELETE FROM User; DELETE FROM Product; DELETE FROM MasterReference;'
    + ' DELETE FROM WarehouseLocation; DELETE FROM Warehouse; DELETE FROM Branch; DELETE FROM Company;');
  c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('acme', 'Acme', 'Asia/Makassar', 'IDR', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-1', 'acme', 'BR1', 'Cabang 1', 1, now(), now());
  c.prepare('INSERT INTO MasterReference (id, companyId, branchId, type, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('unit-pcs', 'acme', null, 'UNIT', 'PCS', 'Pieces', 1, now(), now());
  // A second company, so cross-tenant refusal is tested against a real foreign row and not a guess.
  c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('other', 'Other', 'Asia/Makassar', 'IDR', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-2', 'other', 'BR2', 'Cabang 2', 1, now(), now());
  c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('wh-1', 'W1', 'Gudang 1', 'br-1', 1, 1, now(), now());
  c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('wh-foreign', 'W2', 'Gudang Asing', 'br-2', 1, 1, now(), now());
  // The command path intentionally uses a concrete rack. Since MobileOps now validates that every
  // location belongs to the selected warehouse, the fixture must materialize that production
  // invariant instead of relying on a free-form location id.
  c.prepare('INSERT INTO WarehouseLocation (id, warehouseId, code, name, type, isDefault, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('rak-A', 'wh-1', 'RAK-A', 'Rak A', 'BIN', 0, 1, now(), now());

  const product = (id, sku, barcode, name, price, isActive = 1) => c.prepare(
    'INSERT INTO Product (id, companyId, sku, barcode, name, costPrice, salePrice, unit, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, 'acme', sku, barcode, name, 1000, price, 'PCS', isActive, now(), now());
  product('p-1', 'SKU-1', 'BC-1', 'Kopi 250g', 15000);
  product('p-2', 'SKU-2', 'BC-2', 'Teh 250g', 8000);
  product('p-off', 'SKU-OFF', 'BC-OFF', 'Produk lama', 5000, 0);

  // Employee WITH the permission.
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-1', 'br-1', 'staf@acme.test', 'Staf Gudang', 'x', 1, now(), now());
  c.prepare('INSERT INTO Role (id, name) VALUES (?,?)').run('r-1', 'WAREHOUSE_STAFF');
  c.prepare('INSERT INTO UserRole (userId, roleId) VALUES (?,?)').run('u-1', 'r-1');
  c.prepare('INSERT INTO Permission (id, code) VALUES (?,?)').run('p-1', 'inventory.opname');
  c.prepare('INSERT INTO RolePermission (roleId, permissionId) VALUES (?,?)').run('r-1', 'p-1');
  c.prepare('INSERT INTO Employee (id, companyId, branchId, userId, employeeNumber, fullName, employmentStatus, hireDate, timezone, workLocationType, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e-1', 'acme', 'br-1', 'u-1', 'EMP-1', 'Staf Gudang', 'PERMANENT', now(), 'Asia/Makassar', 'WAREHOUSE', 1, now(), now());

  // Employee WITHOUT the permission — same tenant, different role.
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-2', 'br-1', 'spv@acme.test', 'Supervisor', 'x', 1, now(), now());
  c.prepare('INSERT INTO Role (id, name) VALUES (?,?)').run('r-2', 'SALES_STAFF');
  c.prepare('INSERT INTO UserRole (userId, roleId) VALUES (?,?)').run('u-2', 'r-2');
  c.prepare('INSERT INTO Employee (id, companyId, branchId, userId, employeeNumber, fullName, employmentStatus, hireDate, timezone, workLocationType, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e-2', 'acme', 'br-1', 'u-2', 'EMP-2', 'Supervisor', 'PERMANENT', now(), 'Asia/Makassar', 'OFFICE', 1, now(), now());

  c.prepare('INSERT INTO Employee (id, companyId, branchId, userId, employeeNumber, fullName, employmentStatus, hireDate, timezone, workLocationType, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e-4', 'acme', 'br-1', null, 'EMP-4', 'Tanpa User', 'PERMANENT', now(), 'Asia/Makassar', 'WAREHOUSE', 1, now(), now());

  const bind = (id, employeeId, platformUserId, isActive = 1) => c.prepare(
    'INSERT INTO TelegramIdentityBinding (id, companyId, employeeId, platformUserId, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
  ).run(id, 'acme', employeeId, platformUserId, isActive, now(), now());
  bind('tb-1', 'e-1', 'tg-allowed');
  bind('tb-2', 'e-2', 'tg-nopermission');
  bind('tb-3', 'e-1', 'tg-revoked', 0);
  // A binding that is still ACTIVE but whose employee has been terminated: revoking the binding alone
  // is not enough, and this is the row that proves resolveIdentity re-checks employment.
  // Its own user: Employee is unique on (companyId, userId), so reusing u-1 fails as a constraint
  // error and takes the whole fixture down — which looks like every command being broken.
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-3', 'br-1', 'keluar@acme.test', 'Staff Keluar', 'x', 1, now(), now());
  c.prepare('INSERT INTO UserRole (userId, roleId) VALUES (?,?)').run('u-3', 'r-1');
  c.prepare('INSERT INTO Employee (id, companyId, branchId, userId, employeeNumber, fullName, employmentStatus, hireDate, terminationDate, timezone, workLocationType, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e-3', 'acme', 'br-1', 'u-3', 'EMP-3', 'Staff Keluar', 'TERMINATED', now(), now(), 'Asia/Makassar', 'WAREHOUSE', 1, now(), now());
  bind('tb-4', 'e-3', 'tg-terminated');
  bind('tb-5', 'e-4', 'tg-nouser');

  c.prepare('INSERT INTO StockOpname (id, number, warehouseId, locationId, status, startedAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('so-1', 'SO-1', 'wh-1', 'rak-A', 'COUNTING', now(), now(), now());
  c.prepare('INSERT INTO StockOpnameItem (id, opnameId, productId, batchNumber, systemQty, countedQty) VALUES (?,?,?,?,?,?)')
    .run('i-1', 'so-1', 'p-1', null, 10, null);
  c.prepare('INSERT INTO StockOpnameItem (id, opnameId, productId, batchNumber, systemQty, countedQty) VALUES (?,?,?,?,?,?)')
    .run('i-2', 'so-1', 'p-2', null, 5, null);
}

let service;
let CommandClass;
test('the real command service loads against the real mobile-ops service', async () => {
  const { MobileOpsService } = await load('apps/api/src/mobile-ops/mobile-ops.service.ts', { platform: 'node' });
  const mod = await load('apps/api/src/mobile-ops/telegram-command.service.ts', { platform: 'node' });
  const { TelegramCommandService } = mod;
  CommandClass = TelegramCommandService;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } });
  const mobileOps = new MobileOpsService(prisma);
  // Two dependencies since the command surface began writing an audit row per attempt. Passing the
  // same Prisma client the service already uses for identity resolution is deliberate: the audit must
  // land in the same transaction-visible database as the command it describes.
  service = new TelegramCommandService(mobileOps, prisma);
  await prisma.$disconnect();
  assert.ok(service, 'the command service must be constructible');
});

// ---------------------------------------------------------------- the functional path

test('a bound, permitted employee runs the whole count from a chat', async () => {
  seed();
  const help = await service.execute('tg-allowed', '/bantuan');
  assert.equal(help.ok, true);
  assert.match(help.reply, /\/stok/);

  const opened = await service.execute('tg-allowed', '/buka dev-1 wh-1 rak-A');
  assert.equal(opened.ok, true, opened.reply);
  const draftId = opened.reply.match(/([0-9a-f-]{36})/)?.[1];
  assert.ok(draftId, `expected a draft id in the reply, got: ${opened.reply}`);

  const scanned = await service.execute('tg-allowed', `/scan ${draftId} BC-1 8`);
  assert.equal(scanned.ok, true, scanned.reply);
  const again = await service.execute('tg-allowed', `/scan ${draftId} BC-1 2`);
  assert.equal(again.ok, true, again.reply);
  // Repeating a barcode increments; it must not append a second line.
  assert.match(again.reply, /1 baris, 10 unit/, again.reply);

  // Before the draft is attached to an opname there is no snapshot to measure against, and `difference`
  // must read as "unknown" rather than 0. "No snapshot" and "counted and matched" are different
  // statements, and collapsing them would make a count look approved before it was ever reviewed.
  const blind = await service.execute('tg-allowed', `/selisih ${draftId}`);
  assert.equal(blind.ok, true, blind.reply);
  assert.match(blind.reply, /belum ada snapshot/, blind.reply);
  assert.doesNotMatch(blind.reply, /\(\+?0\)/, 'an absent snapshot must never render as a zero difference');

  // Re-opening with the opname attaches it (resume, not restart) and gives the comparison something
  // real to measure against.
  const attached = await service.execute('tg-allowed', `/buka dev-1 wh-1 rak-A so-1`);
  assert.equal(attached.ok, true, attached.reply);
  assert.match(attached.reply, /Draft dilanjutkan/, 'the same device must resume, not create a second draft');

  const review = await service.execute('tg-allowed', `/selisih ${draftId}`);
  assert.equal(review.ok, true, review.reply);
  assert.match(review.reply, /sistem 10 \/ hitung 10/, review.reply);

  const sent = await service.execute('tg-allowed', `/kirim ${draftId} so-1`);
  assert.equal(sent.ok, true, sent.reply);
  const item = conn().prepare('SELECT countedQty FROM StockOpnameItem WHERE id=?').get('i-1');
  assert.equal(item.countedQty, 10, 'the count must reach the canonical opname item, not just the draft');
  const audits = conn().prepare("SELECT action FROM AuditLog WHERE entityId=?").all(draftId).map((r) => r.action);
  assert.ok(audits.includes('MOBILE_OPNAME_DRAFT_SUBMITTED'), `submit must be audited, got ${JSON.stringify(audits)}`);
});

test('/stok resolves a price and hides an inactive product', async () => {
  seed();
  const hit = await service.execute('tg-allowed', '/stok BC-1');
  assert.equal(hit.ok, true, hit.reply);
  assert.match(hit.reply, /Kopi 250g/);
  assert.match(hit.reply, /15000/);
  assert.doesNotMatch(hit.reply, /1000|cost/i, 'cost price must never reach a chat');

  const off = await service.execute('tg-allowed', '/stok BC-OFF');
  assert.equal(off.ok, false);
  assert.match(off.reply, /tidak ditemukan/i);
});

// ---------------------------------------------------------------- the security invariants

test('an unbound chat is refused, and told the same thing as a revoked binding', async () => {
  seed();
  const unknown = await service.execute('tg-unknown', '/stok BC-1');
  const revoked = await service.execute('tg-revoked', '/stok BC-1');
  assert.equal(unknown.ok, false);
  assert.equal(revoked.ok, false);
  // Assert the SPECIFIC refusal first. This test was green on its first run only because every error
  // collapsed into one generic sentence, which made "both replies are equal" trivially true — a
  // vacuous pass over a branch that was never actually reached. Equality alone proves nothing.
  assert.match(unknown.reply, /tidak terikat ke employee aktif/,
    `expected the real refusal, got: ${unknown.reply}`);
  assert.match(revoked.reply, /tidak terikat ke employee aktif/);
  // Distinguishing them would make the bot an oracle for which platform ids exist.
  assert.equal(unknown.reply, revoked.reply, 'an unknown chat and a revoked binding must be indistinguishable');
});

test('an employee without the permission cannot run any command', async () => {
  seed();
  // EVERY command. An earlier version of this list omitted /scan and /kirim, and a negative control
  // that removed the permission check from /scan alone stayed GREEN — the test was checking four of
  // six commands and reporting coverage.
  for (const text of ['/stok BC-1', '/buka dev-1 wh-1', '/scan d-1 BC-1 1', '/selisih d-1', '/kirim d-1 so-1', '/batal d-1 alasan']) {
    const r = await service.execute('tg-nopermission', text);
    assert.equal(r.ok, false, `${text} must be refused`);
    assert.match(r.reply, /tidak terikat ke employee aktif/);
  }
  assert.equal(conn().prepare('SELECT COUNT(*) AS n FROM MobileOpnameDraft').get().n, 0,
    'a refused command must not have created anything');
});

test('a command cannot reach another tenant', async () => {
  seed();
  // A warehouse id from another company, named straight in the command.
  const r = await service.execute('tg-allowed', '/buka dev-1 wh-foreign');
  assert.equal(r.ok, false, r.reply);
  assert.match(r.reply, /tidak ditemukan pada tenant/);
  assert.equal(conn().prepare('SELECT COUNT(*) AS n FROM MobileOpnameDraft').get().n, 0);
});

test('malformed commands are refused with usage, not guessed at', async () => {
  seed();
  const cases = [
    ['/stok', /Gunakan: \/stok/],
    ['/buka', /Gunakan: \/buka/],
    // `/buka dev-1 wh-1` is VALID — location and opname are optional. The genuinely incomplete form is
    // missing the warehouse. Asserting the valid one is refused would be a test that encodes a wrong
    // belief about the command.
    ['/buka dev-1', /Gunakan: \/buka/],
    ['/scan d-1 BC-1', /Gunakan: \/scan/],
    ['/batal d-1', /Alasan pembatalan wajib/],
    ['/ngawur', /tidak dikenal/],
    ['', /Perintah kosong/],
  ];
  for (const [text, pattern] of cases) {
    const r = await service.execute('tg-allowed', text);
    assert.equal(r.ok, false, `"${text}" must be refused`);
    assert.match(r.reply, pattern, `"${text}" -> ${r.reply}`);
  }
});

test('a non-numeric quantity is refused before it reaches the service', async () => {
  seed();
  const opened = await service.execute('tg-allowed', '/buka dev-1 wh-1');
  const draftId = opened.reply.match(/([0-9a-f-]{36})/)?.[1];
  const r = await service.execute('tg-allowed', `/scan ${draftId} BC-1 banyak`);
  assert.equal(r.ok, false);
  assert.match(r.reply, /harus berupa angka/);
  const row = conn().prepare('SELECT lines FROM MobileOpnameDraft WHERE id=?').get(draftId);
  assert.equal(row.lines, '[]', 'a refused scan must leave the draft untouched');
});

test('an employee with no linked platform user cannot act', async () => {
  seed();
  // resolveIdentity returns this employee with no roles and no permissions, so the role join refuses
  // them before asUser is reached. The asUser guard is a SECOND line — a tenant scope with no subject
  // is not an authority — so it is exercised here too rather than left as an untested assumption.
  const r = await service.execute('tg-nouser', '/stok BC-1');
  assert.equal(r.ok, false, 'an employee with no platform user must not act');
  assert.match(r.reply, /tidak terikat ke employee aktif/);
  assert.equal(conn().prepare('SELECT COUNT(*) AS n FROM MobileOpnameDraft').get().n, 0);
});

test('an active binding to a TERMINATED employee is still refused', async () => {
  seed();
  const r = await service.execute('tg-terminated', '/stok BC-1');
  assert.equal(r.ok, false, 'a terminated employee must not act through a still-active binding');
  assert.match(r.reply, /tidak terikat ke employee aktif/);
});

test('/bantuan works without an identity, and reveals nothing but syntax', async () => {
  seed();
  const r = await service.execute('tg-unknown', '/bantuan');
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.reply, /Rp \d|cost|employee|gudang \d/i, 'help text must carry no tenant data');
});

// ---------------------------------------------------------------- structural

test('asUser refuses an identity with no platform user, tested in isolation', () => {
  // Through execute() this guard is unobservable: assertPermission refuses such an employee first, so
  // removing the guard changed nothing and a negative control stayed GREEN. That is defence in depth
  // working, not a test proving the line exists — so exercise the line directly.
  const instance = new CommandClass({ assertPermission: async () => ({}) });
  assert.throws(
    () => instance.asUser({ userId: null, employeeId: 'e-9', companyId: 'acme', branchId: 'br-1', employeeName: 'X', roles: [], permissions: [] }),
    /tidak tertaut ke user platform/,
    'a tenant scope with no subject is not an authority',
  );
  const ok = instance.asUser({ userId: 'u-1', employeeId: 'e-1', companyId: 'acme', branchId: 'br-1', employeeName: 'X', roles: [], permissions: [] });
  assert.equal(ok.sub, 'u-1');
  assert.equal(ok.companyId, 'acme');
  assert.equal(ok.branchId, 'br-1');
});

test('the /kirim reply does not overstate what happened', () => {
  // A reply claiming "stok diperbarui" would be the most damaging thing this surface could say: the
  // whole design is that a count never posts inventory without supervisor approval. Nothing asserted
  // the wording until a negative control changed it and stayed GREEN.
  const source = fs.readFileSync(path.join(ROOT, 'apps/api/src/mobile-ops/telegram-command.service.ts'), 'utf8');
  const submit = source.slice(source.search(/async submit\s*\(/), source.search(/async discard\s*\(/));
  assert.match(submit, /persetujuan/i, 'the reply must say approval is still required');
  assert.match(submit, /kanonik/i, 'and name the canonical flow that owns it');
  assert.doesNotMatch(submit, /langsung diperbarui|sudah diperbarui|stok Updated/i,
    'never claim the stock moved — the canonical completeOpname owns that, behind approval');
  // And no command may say it either.
  assert.doesNotMatch(source, /langsung diperbarui/i);
});

test('the tenant is derived from the employee, never from the command text', () => {
  // A negative control that hardcoded `companyId: 'acme'` stayed GREEN, because the fixture's tenant
  // is also 'acme' — the test could not tell the two apart. So assert the mechanism, not the value:
  // the AuthUser handed to the service may only carry identity fields, and no command may parse one.
  const source = fs.readFileSync(path.join(ROOT, 'apps/api/src/mobile-ops/telegram-command.service.ts'), 'utf8');
  // Slice by the member NAME, not by the `private` keyword: making asUser public so it could be
  // tested directly silently emptied this range, and the assertion below passed for the wrong reason
  // (empty string matches nothing, and the neighbouring test reported it).
  const asUserStart = source.search(/asUser\s*\(\s*identity\s*:/);
  const explainStart = source.search(/explain\s*\(\s*error\s*:/);
  assert.ok(asUserStart > 0 && explainStart > asUserStart, 'asUser and explain must both be locatable');
  const asUser = source.slice(asUserStart, explainStart);
  assert.match(asUser, /companyId: identity\.companyId/,
    'company must come from the resolved identity');
  assert.match(asUser, /branchId: identity\.branchId/,
    'branch must come from the resolved identity, never from the command');
  assert.doesNotMatch(asUser, /companyId:\s*'|branchId:\s*'/,
    'a literal tenant in asUser is the forbidden shortcut');
  // And the command grammar has no slot for one.
  const grammar = source.slice(source.indexOf('const [rawCommand'), source.indexOf("case 'stok'"));
  assert.doesNotMatch(grammar, /company|branch|cabang|tenant/i,
    'the command surface must not accept a tenant or branch from the chat');
});

test('an unknown platform id and a revoked binding are refused by the SAME constant', () => {
  // Asserted on the source because the property is structural: both reach `UNBOUND`, so there is no
  // wording to distinguish them with. The earlier negative control here checked `!platformUserId`,
  // which is never true for a real id — a negative control that changes nothing proves nothing.
  const source = fs.readFileSync(path.join(ROOT, 'apps/api/src/mobile-ops/telegram-command.service.ts'), 'utf8');
  const explain = source.slice(source.search(/explain\s*\(\s*error\s*:/));
  assert.match(explain, /return UNBOUND;/, 'every authorization refusal must return one constant');
  assert.doesNotMatch(explain, /tidak ditemukan di sistem|tidak dikenal/i,
    'a distinct "no such identity" wording would be an enumeration oracle');
});
