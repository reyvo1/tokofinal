// Acceptance #10 (audit half): a Telegram command attempt leaves an AuditLog row.
//
// #10 was PARTIAL because the scoping was proven but NOTHING was audited. `TelegramCommandService` had
// no Prisma dependency at all — only a Nest `logger`, which writes to stdout and is therefore not a
// record anyone can query or hand to an auditor. Every chat refusal left no trace.
//
// This runs the REAL `TelegramCommandService` and the REAL `MobileOpsService` against a real pushed
// SQLite database, because the failure mode here is precisely "the row is absent" — which a
// source-level assertion can never detect and which no gate in the repo was watching for.
//
// What each test pins down, and why:
//   - a bound, permitted command writes TELEGRAM_COMMAND with real scope
//   - a refusal writes TELEGRAM_REFUSED and carries the domain reason the chat refuses to show
//   - an unknown platform id still writes a row, with empty scope but the chat id in the payload
//   - /bantuan writes NOTHING, because it is the one command that resolves no identity
//   - an audit WRITE FAILURE must not replace the operator's answer with an error
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { load } from './helpers/import-ts.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't360-tg-audit-')), 'audit.db');
const prismaFml = path.join(ROOT, 'apps/api/prisma/schema.sqlite.prisma');
const env = { ...process.env, DATABASE_URL: `file:${DB}` };
const now = () => new Date().toISOString();

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', prismaFml],
  { cwd: ROOT, env, stdio: 'pipe' });

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } });
const conn = () => new DatabaseSync(DB);

const opts = { platform: 'node', external: ['@prisma/client'] };
const { MobileOpsService } = await load('apps/api/src/mobile-ops/mobile-ops.service.ts', opts);
const { TelegramCommandService } = await load('apps/api/src/mobile-ops/telegram-command.service.ts', opts);

const mobileOps = new MobileOpsService(prisma);
const commands = new TelegramCommandService(mobileOps, prisma);

function seed() {
  const c = conn();
  c.exec('DELETE FROM AuditLog; DELETE FROM TelegramIdentityBinding; DELETE FROM Employee;'
    + ' DELETE FROM UserRole; DELETE FROM RolePermission; DELETE FROM Role; DELETE FROM Permission;'
    + ' DELETE FROM User; DELETE FROM Product; DELETE FROM MasterReference; DELETE FROM Warehouse; DELETE FROM Branch; DELETE FROM Company;');

  c.prepare('INSERT INTO Company (id, name, timezone, currency, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('acme', 'Acme', 'Asia/Makassar', 'IDR', now(), now());
  c.prepare('INSERT INTO Branch (id, companyId, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('br-1', 'acme', 'BR1', 'Cabang 1', 1, now(), now());
  c.prepare('INSERT INTO MasterReference (id, companyId, branchId, type, code, name, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('unit-pcs', 'acme', null, 'UNIT', 'PCS', 'Pieces', 1, now(), now());
  c.prepare('INSERT INTO Warehouse (id, code, name, branchId, isActive, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('wh-1', 'W1', 'Gudang 1', 'br-1', 1, 1, now(), now());
  c.prepare('INSERT INTO Product (id, companyId, sku, barcode, name, costPrice, salePrice, unit, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('p-1', 'acme', 'SKU-1', 'BC-1', 'Kopi 250g', 1000, 15000, 'PCS', 1, now(), now());

  // An employee whose role actually carries inventory.opname.
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-1', 'br-1', 'staf@acme.test', 'Staf Gudang', 'x', 1, now(), now());
  c.prepare('INSERT INTO Role (id, name) VALUES (?,?)').run('r-1', 'WAREHOUSE_STAFF');
  c.prepare('INSERT INTO UserRole (userId, roleId) VALUES (?,?)').run('u-1', 'r-1');
  c.prepare('INSERT INTO Permission (id, code) VALUES (?,?)').run('p-1', 'inventory.opname');
  c.prepare('INSERT INTO RolePermission (roleId, permissionId) VALUES (?,?)').run('r-1', 'p-1');
  c.prepare('INSERT INTO Employee (id, companyId, branchId, userId, employeeNumber, fullName, employmentStatus, hireDate, timezone, workLocationType, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e-1', 'acme', 'br-1', 'u-1', 'EMP-1', 'Staf Gudang', 'PERMANENT', now(), 'Asia/Makassar', 'WAREHOUSE', 1, now(), now());

  // Same tenant, no such permission — the refusal that matters most.
  c.prepare('INSERT INTO User (id, branchId, email, name, passwordHash, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('u-2', 'br-1', 'spv@acme.test', 'Supervisor', 'x', 1, now(), now());
  c.prepare('INSERT INTO Role (id, name) VALUES (?,?)').run('r-2', 'SALES_STAFF');
  c.prepare('INSERT INTO UserRole (userId, roleId) VALUES (?,?)').run('u-2', 'r-2');
  c.prepare('INSERT INTO Employee (id, companyId, branchId, userId, employeeNumber, fullName, employmentStatus, hireDate, timezone, workLocationType, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e-2', 'acme', 'br-1', 'u-2', 'EMP-2', 'Supervisor', 'PERMANENT', now(), 'Asia/Makassar', 'OFFICE', 1, now(), now());

  const bind = (id, employeeId, platformUserId, isActive = 1) => c.prepare(
    'INSERT INTO TelegramIdentityBinding (id, companyId, employeeId, platformUserId, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
  ).run(id, 'acme', employeeId, platformUserId, isActive, now(), now());
  bind('tb-1', 'e-1', 'tg-allowed');
  bind('tb-2', 'e-2', 'tg-nopermission');
}

const auditRows = () => prisma.auditLog.findMany({ where: { entityType: 'TelegramCommand' }, orderBy: { createdAt: 'asc' } });
const payloadOf = (row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);

test('a permitted command writes one TELEGRAM_COMMAND row carrying the real scope', async () => {
  seed();
  const result = await commands.execute('tg-allowed', '/stok BC-1');
  assert.equal(result.ok, true, 'the command itself must still succeed');

  const rows = await auditRows();
  assert.equal(rows.length, 1, 'exactly one row per attempt');
  const row = rows[0];
  assert.equal(row.action, 'TELEGRAM_COMMAND');
  assert.equal(row.entityType, 'TelegramCommand');
  assert.equal(row.companyId, 'acme', 'scope must come from the employee, never from the chat text');
  assert.equal(row.userId, 'u-1');

  const payload = payloadOf(row);
  assert.equal(payload.command, 'stok');
  assert.deepEqual(payload.args, ['BC-1']);
  assert.equal(payload.ok, true);
  assert.equal(payload.platformUserId, 'tg-allowed');
  assert.equal(payload.employeeId, 'e-1');
  // AuditLog has no branchId column, so branch scope can only live in the payload — and an audit that
  // cannot say WHICH branch acted is much weaker than one that can.
  assert.equal(payload.branchId, 'br-1');
  assert.equal(payload.refusalReason, null);
});

test('a permission refusal is audited with the reason the chat refuses to disclose', async () => {
  seed();
  const result = await commands.execute('tg-nopermission', '/stok BC-1');
  assert.equal(result.ok, false);

  const rows = await auditRows();
  assert.equal(rows.length, 1, 'a refusal is exactly the row a supervisor needs — it must be written');
  assert.equal(rows[0].action, 'TELEGRAM_REFUSED');
  const payload = payloadOf(rows[0]);
  assert.equal(payload.platformUserId, 'tg-nopermission');
  assert.equal(payload.ok, false);
  // The chat answers with one constant so the bot cannot be used as an oracle for which ids exist.
  // The AUDIT row is where the real reason belongs, and this is the assertion that keeps them apart.
  assert.match(result.reply, /tidak terikat ke employee aktif/i,
    'the chat must keep using the constant refusal');
  assert.match(payload.refusalReason, /inventory\.manage|tidak memiliki izin/i,
    `the audit row must carry the real reason, got: ${payload.refusalReason}`);
});

test('an unknown platform id is still audited, with empty scope and the chat id kept', async () => {
  seed();
  const result = await commands.execute('tg-never-heard-of-it', '/stok BC-1');
  assert.equal(result.ok, false);

  const rows = await auditRows();
  assert.equal(rows.length, 1, 'an attempt from an unbound chat is precisely what an audit exists for');
  const payload = payloadOf(rows[0]);
  assert.equal(payload.platformUserId, 'tg-never-heard-of-it', 'without this the row identifies nothing');
  assert.equal(rows[0].companyId, null);
  assert.equal(rows[0].userId, null);
  assert.equal(payload.employeeId, null);
});

test('an unknown command name is audited too', async () => {
  seed();
  const result = await commands.execute('tg-allowed', '/entah 123');
  assert.equal(result.ok, false);

  const rows = await auditRows();
  assert.equal(rows.length, 1, 'a typo is still an attempt, and a typo can be a probe');
  assert.equal(payloadOf(rows[0]).command, 'entah');
});

test('/bantuan writes nothing, because it is the one command that resolves no identity', async () => {
  seed();
  const result = await commands.execute('tg-allowed', '/bantuan');
  assert.equal(result.ok, true);
  assert.equal((await auditRows()).length, 0,
    'help reveals nothing but syntax; auditing it would only add noise');
});

test('an audit write failure must not replace the operator answer with an error', async () => {
  seed();
  let attempted = 0;
  // A client whose auditLog.create always fails, but which otherwise forwards to the real one — so
  // the command still performs its REAL work and only the bookkeeping is broken.
  const failing = new Proxy(prisma, {
    get(target, prop) {
      if (prop === 'auditLog') {
        return { create: async () => { attempted += 1; throw new Error('audit store is down'); } };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const fragile = new TelegramCommandService(mobileOps, failing);

  const result = await fragile.execute('tg-allowed', '/stok BC-1');
  assert.equal(result.ok, true, 'a broken audit sink must not turn a working command into a failure');
  assert.match(result.reply, /Kopi 250g/, 'the real answer must still reach the operator');
  // Without this the test passes vacuously whenever the audit call is removed outright: nothing
  // fails, so nothing throws, so the operator's answer looks fine. The counter is what makes this a
  // test of tolerance rather than a test of "the command still works".
  assert.equal(attempted, 1, 'the audit write must actually be attempted, or this test proves nothing');
  assert.equal((await auditRows()).length, 0, 'a failed write must not fabricate a row');
});

test('consecutive attempts each leave their own row, in order', async () => {
  seed();
  await commands.execute('tg-allowed', '/stok BC-1');
  await commands.execute('tg-nopermission', '/stok BC-1');
  await commands.execute('tg-never-heard-of-it', '/stok BC-1');

  const rows = await auditRows();
  assert.equal(rows.length, 3, 'one row per attempt — not one row per chat, and not a single shared row');
  assert.deepEqual(rows.map((r) => payloadOf(r).platformUserId),
    ['tg-allowed', 'tg-nopermission', 'tg-never-heard-of-it']);
});

test.after(async () => {
  await prisma.$disconnect();
});