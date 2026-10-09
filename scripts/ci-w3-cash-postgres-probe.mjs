#!/usr/bin/env node
/**
 * W3 REAL PostgreSQL/HTTP cashier-journal probe. Runs only on a disposable, locked
 * CI staging database and loopback API. Never connects to a provider or hardware.
 * Failed attempts produce source-bound FAIL evidence (not a silent missing file).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-w3-cash-postgres-probe-latest.json');
const sourceIdentity = sourceFingerprint(root);
const checks = {};
const api = String(process.env.T360_API_URL || '').replace(/\/$/, '');

function requireSafeTarget(env = process.env) {
  const url = new URL(String(env.DATABASE_URL || ''));
  const targetHost = String(env.T360_CI_EXPECTED_HOST || env.T360_UAT_EXPECTED_HOST || '').trim();
  const targetDatabase = String(env.T360_CI_EXPECTED_DATABASE || env.T360_UAT_EXPECTED_DATABASE || '').trim();
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !targetHost || !targetDatabase
      || url.hostname !== targetHost || dbName !== targetDatabase
      || !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
      || !/^toko360_(staging|test|ci)(?:_[a-z0-9_-]+)?$/i.test(dbName)
      || /(prod|production|live)/i.test(dbName)) {
    throw new Error('W3 menolak target DB: wajib PostgreSQL TEST/STAGING lokal dengan identitas host/database terkunci.');
  }
  const apiUrl = new URL(api);
  if (apiUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(apiUrl.hostname)
      || apiUrl.port !== '4000' || apiUrl.pathname !== '/api/v1') {
    throw new Error('W3 menolak API: wajib runtime localhost:4000/api/v1.');
  }
  if (env.T360_EXPECTED_SOURCE_FINGERPRINT && env.T360_EXPECTED_SOURCE_FINGERPRINT !== sourceIdentity.value) {
    throw new Error('Source W3 berbeda dari fingerprint exact-built GitHub.');
  }
  return { host: url.hostname, database: dbName };
}

function writeEvidence(status, extra = {}) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const result = { generatedAt: new Date().toISOString(), status, sourceIdentity,
    checks, productionTouched: false, humanStage20: 'PENDING', ...extra };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}

async function request(route, { token, method = 'GET', body, allowError = false } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const content = await res.text();
  let data;
  try { data = content ? JSON.parse(content) : null; } catch { data = null; }
  if (!res.ok && !allowError) throw new Error(`${method} ${route} HTTP ${res.status}: ${String(data?.message || 'request rejected').slice(0, 250)}`);
  return { status: res.status, data };
}
function ensure(value, message) { if (!value) throw new Error(message); }
function cents(value) { return BigInt(Math.round(Number(value) * 100)); }

async function run() {
  const target = requireSafeTarget();
  // Import Prisma only after target lock; the source-only tests do not require a generated client.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const stamp = `${process.env.GITHUB_RUN_ID || 'local'}-${Date.now()}`;
  const suffix = String(Date.now()).slice(-9);
  const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
  const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  ensure(email && password, 'W3 requires CI bootstrap admin credentials.');
  let actorId = null;
  try {
    const admin = (await request('/auth/login', { method: 'POST', body: { email, password } })).data.accessToken;
    ensure(admin, 'W3 admin authentication failed.');
    const manifest = (await request('/platform/manifest', { token: admin })).data;
    const companyId = manifest?.company?.id;
    const branchId = manifest?.branch?.id;
    ensure(companyId && branchId, 'W3 did not resolve trusted tenant and branch.');
    const drawer = await prisma.account.findFirst({ where: { branchId, code: '1101', type: 'ASSET', isActive: true } });
    ensure(drawer, 'W3 cash drawer account 1101 ASSET missing from bootstrap; no account guessed.');
    checks.nonProductionTargetLocked = target.database.startsWith('toko360_');
    checks.trustedTenant = true;

    // Own a dedicated cashier instead of depending on an existing shift/operator state.
    const cashierPassword = `W3-${suffix}-Ci!Aa92`;
    const cashierEmail = `w3-probe-${stamp.replace(/[^a-z0-9-]/gi, '').toLowerCase()}@example.invalid`;
    const created = (await request('/users', { method: 'POST', token: admin,
      body: { name: `W3 PostgreSQL Probe ${suffix}`, email: cashierEmail, password: cashierPassword, roleNames: ['CASHIER'] } })).data;
    actorId = created?.id;
    ensure(actorId, 'W3 dedicated CASHIER account not created.');
    const cashier = (await request('/auth/login', { method: 'POST', body: { email: cashierEmail, password: cashierPassword } })).data.accessToken;
    ensure(cashier, 'W3 cashier authentication failed.');
    checks.realCashierRole = true;

    // Real HTTP authorization negatives: the cashier role must not configure ledger accounts
    // or event rules even if the request body otherwise uses accepted API fields.
    const forbiddenAccountCode = `W3DENY${suffix}`;
    const forbiddenAccount = await request('/accounting-core/accounts', { method: 'POST', token: cashier, allowError: true,
      body: { code: forbiddenAccountCode, name: 'MUST NOT CREATE', type: 'ASSET' } });
    ensure(forbiddenAccount.status === 403, `Cashier could create GL accounts, or permission failure changed: HTTP ${forbiddenAccount.status}.`);
    const forbiddenRule = await request('/accounting-core/posting-rules', { method: 'POST', token: cashier, allowError: true,
      body: { code: `W3DENYRULE${suffix}`, name: 'MUST NOT CREATE', eventType: 'CASH_DRAWER_TRANSFER_IN',
        status: 'ACTIVE', journalLines: [
          { accountCode: '1101', side: 'DEBIT', amountKey: 'gross' },
          { accountCode: forbiddenAccountCode, side: 'CREDIT', amountKey: 'gross' },
        ] } });
    ensure(forbiddenRule.status === 403, `Cashier could create GL posting rules, or permission failure changed: HTTP ${forbiddenRule.status}.`);
    ensure(await prisma.account.count({ where: { branchId, code: forbiddenAccountCode } }) === 0,
      'Cashier GL account denial left a real account row.');
    ensure(await prisma.accountingPostingRule.count({ where: { companyId, code: `W3DENYRULE${suffix}` } }) === 0,
      'Cashier posting rule denial left a real rule row.');
    checks.cashierCannotMutateFinanceConfiguration = true;

    // This CI target is disposable and seeded in bootstrap mode. If another fixture created
    // W3 rules already, abort rather than silently accepting cash against unknown mappings.
    const eventTypes = ['CASH_DRAWER_TRANSFER_IN', 'CASH_DRAWER_TRANSFER_OUT', 'CASHIER_SHIFT_SHORT', 'CASHIER_SHIFT_OVER'];
    ensure(await prisma.accountingPostingRule.count({ where: { companyId, eventType: { in: eventTypes }, status: 'ACTIVE' } }) === 0,
      'W3 probe requires a clean, fixture-owned finance rule set.');
    const shift = (await request('/sales/shifts/open', { method: 'POST', token: cashier, body: { openingCash: 200000 } })).data;
    ensure(shift?.id && shift.status === 'OPEN', 'W3 shift OPEN failed.');
    const noRuleReceipt = await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier, allowError: true,
      body: { type: 'CASH_IN', amount: 50, reason: 'W3 missing rule must reject', idempotencyKey: `w3-no-rule-${stamp}` } });
    ensure(noRuleReceipt.status === 400, `W3 cash accepted without finance rule: HTTP ${noRuleReceipt.status}.`);
    ensure(await prisma.cashierCashMovement.count({ where: { cashierShiftId: shift.id } }) === 0,
      'W3 missing finance rule created physical drawer movement.');
    const noRuleClose = await request('/sales/shifts/close', { method: 'POST', token: cashier, allowError: true,
      body: { closingCash: 200050 } });
    ensure(noRuleClose.status === 400, `W3 shift variance accepted without finance rule: HTTP ${noRuleClose.status}.`);
    ensure((await prisma.cashierShift.findUnique({ where: { id: shift.id }, select: { status: true } }))?.status === 'OPEN',
      'W3 missing finance rule incorrectly closed cashier shift.');
    checks.missingFinanceRulesFailClosedWithoutCashMutation = true;

    const accounts = {};
    for (const [name, type] of [['asset', 'ASSET'], ['expense', 'EXPENSE'], ['revenue', 'REVENUE']]) {
      const code = `W3${name[0].toUpperCase()}${suffix}`;
      const value = (await request('/accounting-core/accounts', { method: 'POST', token: admin,
        body: { code, name: `CI W3 ${name} ${suffix}`, type } })).data;
      ensure(value?.code === code && value.type === type, `W3 ${name} account failed.`);
      accounts[name] = code;
    }
    const rules = [
      ['CASH_DRAWER_TRANSFER_IN', 'CREDIT', 'asset', 'DEBIT'],
      ['CASH_DRAWER_TRANSFER_OUT', 'DEBIT', 'asset', 'CREDIT'],
      ['CASHIER_SHIFT_SHORT', 'DEBIT', 'expense', 'CREDIT'],
      ['CASHIER_SHIFT_OVER', 'CREDIT', 'revenue', 'DEBIT'],
    ];
    for (const [eventType, oppositeSide, type, drawerSide] of rules) {
      const current = await prisma.accountingPostingRule.findMany({ where: { companyId, eventType, status: 'ACTIVE' }, select: { priority: true } });
      const priority = current.length ? Math.min(...current.map((r) => r.priority)) - 1 : 100;
      const code = `W3CI_${eventType}_${suffix}`;
      const posting = (await request('/accounting-core/posting-rules', { method: 'POST', token: admin,
        body: { code, name: `CI W3 ${eventType}`, eventType, version: 1, priority, status: 'ACTIVE',
          journalLines: [
            { accountCode: '1101', side: drawerSide, amountKey: 'gross' },
            { accountCode: accounts[type], side: oppositeSide, amountKey: 'gross' },
          ] } })).data;
      ensure(posting?.eventType === eventType && posting?.status === 'ACTIVE', `W3 ${eventType} rule not ACTIVE.`);
    }
    checks.financeConfiguredFourRules = true;

    async function journal(eventType, sourceType, sourceId, amount, expectedDebit, expectedCredit) {
      const events = await prisma.accountingEvent.findMany({
        where: { companyId, branchId, eventType, sourceType, sourceId, status: 'POSTED' },
        select: { id: true, journalEntryId: true },
      });
      ensure(events.length === 1, `${eventType}/${sourceId}: expected exactly one POSTED event, got ${events.length}.`);
      ensure(events[0].journalEntryId, `${eventType}: POSTED event has no journalEntryId.`);
      const lines = await prisma.journalLine.findMany({
        where: { journalEntryId: events[0].journalEntryId }, include: { account: true },
      });
      ensure(lines.length === 2, `${eventType}: journal must have exactly two lines.`);
      const debit = lines.reduce((sum, line) => sum + cents(line.debit), 0n);
      const credit = lines.reduce((sum, line) => sum + cents(line.credit), 0n);
      ensure(debit === credit && debit === cents(amount), `${eventType}: debit/credit mismatch.`);
      ensure(lines.some((line) => line.account.code === expectedDebit && cents(line.debit) === cents(amount))
        && lines.some((line) => line.account.code === expectedCredit && cents(line.credit) === cents(amount)),
      `${eventType}: wrong account-side allocation.`);
      return events[0];
    }
    const invalid = await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier, allowError: true,
      body: { type: 'CASH_IN', amount: 5.555, reason: 'REJECT precision', idempotencyKey: `w3-invalid-${suffix}` } });
    ensure(invalid.status === 400, `W3 invalid precision accepted HTTP ${invalid.status}.`);
    const countBefore = await prisma.cashierCashMovement.count({ where: { cashierShiftId: shift.id } });
    ensure(countBefore === 0, 'W3 rejected precision still wrote cash movement.');
    checks.precisionRejectedNoMovement = true;

    const operationKey = `w3-movement-in-${stamp}`;
    const inBody = { type: 'CASH_IN', amount: 5000, reason: 'CI drawer transfer IN', idempotencyKey: operationKey };
    const cashIn = (await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier, body: inBody })).data;
    ensure(cashIn?.id, 'W3 CASH_IN did not return movement id.');
    await journal('CASH_DRAWER_TRANSFER_IN', 'CashierCashMovement', cashIn.id, 5000, '1101', accounts.asset);
    checks.cashInPostedBalanced = true;
    const replay = (await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier, body: inBody })).data;
    ensure(replay?.id === cashIn.id, 'W3 same-payload replay duplicated cash movement.');
    const changed = await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier, allowError: true,
      body: { ...inBody, amount: 6000 } });
    ensure(changed.status >= 400 && changed.status < 500, 'W3 changed-payload replay not rejected.');
    ensure(await prisma.cashierCashMovement.count({ where: { cashierShiftId: shift.id } }) === 1, 'W3 replay created movement.');
    await journal('CASH_DRAWER_TRANSFER_IN', 'CashierCashMovement', cashIn.id, 5000, '1101', accounts.asset);
    checks.cashInIdempotentAndPayloadBound = true;

    // Even a correctly posted rule cannot bypass single-use supervisor authorization.
    // 15,000 of 205,000 in the drawer is greater than the fixed five-percent threshold.
    const missingSupervisor = await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier, allowError: true,
      body: { type: 'CASH_OUT', amount: 15000, reason: 'W3 must require supervisor', idempotencyKey: `w3-no-grant-${stamp}` } });
    ensure(missingSupervisor.status === 403, `W3 >5% cash-out without supervisor grant returned HTTP ${missingSupervisor.status}.`);
    ensure(await prisma.cashierCashMovement.count({ where: { cashierShiftId: shift.id } }) === 1,
      'W3 denied supervisor cash-out persisted movement.');
    checks.supervisorThresholdRejectsBeforeCommit = true;

    const out = (await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier,
      body: { type: 'CASH_OUT', amount: 2000, reason: 'CI drawer transfer OUT', idempotencyKey: `w3-movement-out-${stamp}` } })).data;
    await journal('CASH_DRAWER_TRANSFER_OUT', 'CashierCashMovement', out.id, 2000, accounts.asset, '1101');
    const overdraft = await request('/sales/shifts/cash-movements', { method: 'POST', token: cashier, allowError: true,
      body: { type: 'CASH_OUT', amount: 900000, reason: 'CI reject overdraft', idempotencyKey: `w3-overdraft-${stamp}` } });
    ensure(overdraft.status === 400, `W3 overdraft not rejected HTTP ${overdraft.status}.`);
    ensure(await prisma.cashierCashMovement.count({ where: { cashierShiftId: shift.id } }) === 2, 'W3 overdraft created movement.');
    checks.cashOutPostedOverdraftBlocked = true;

    const closed = (await request('/sales/shifts/close', { method: 'POST', token: cashier, body: { closingCash: 203000 } })).data;
    ensure(closed?.id === shift.id && closed.status === 'CLOSED' && cents(closed.difference) === 0n, 'W3 exact close incorrect.');
    ensure(await prisma.accountingEvent.count({ where: { companyId, branchId, sourceType: 'CashierShift', sourceId: shift.id } }) === 0,
      'W3 exact close wrote spurious variance journal.');
    checks.zeroVarianceNoPosting = true;

    const shortShift = (await request('/sales/shifts/open', { method: 'POST', token: cashier, body: { openingCash: 100000 } })).data;
    const shortage = (await request('/sales/shifts/close', { method: 'POST', token: cashier, body: { closingCash: 99900 } })).data;
    ensure(shortage?.status === 'CLOSED' && cents(shortage.difference) === -10000n, 'W3 shortage sign wrong.');
    await journal('CASHIER_SHIFT_SHORT', 'CashierShift', shortShift.id, 100, accounts.expense, '1101');
    checks.shortagePostedBeforeClose = true;

    const overShift = (await request('/sales/shifts/open', { method: 'POST', token: cashier, body: { openingCash: 100000 } })).data;
    const overage = (await request('/sales/shifts/close', { method: 'POST', token: cashier, body: { closingCash: 100100 } })).data;
    ensure(overage?.status === 'CLOSED' && cents(overage.difference) === 10000n, 'W3 overage sign wrong.');
    await journal('CASHIER_SHIFT_OVER', 'CashierShift', overShift.id, 100, '1101', accounts.revenue);
    checks.overagePostedBeforeClose = true;

    const secondClose = await request('/sales/shifts/close', { method: 'POST', token: cashier, allowError: true,
      body: { closingCash: 100100 } });
    ensure(secondClose.status === 400, 'W3 repeated shift close accepted.');
    ensure(await prisma.accountingEvent.count({ where: { companyId, branchId, sourceType: 'CashierShift', sourceId: overShift.id, status: 'POSTED' } }) === 1,
      'W3 repeated close double-posted journal.');
    checks.shiftCloseReplayBlocked = true;

    const evidence = { target, checks: { ...checks }, actorId, recordIds: { cashIn: cashIn.id, cashOut: out.id, shortShift: shortShift.id, overShift: overShift.id },
      note: 'Real authenticated PostgreSQL transactions and POSTED GL journal lines. CI-only fixture retained in disposable staging database for audit.' };
    writeEvidence('PASS', evidence);
    console.log(`W3 PostgreSQL financial runtime PASS — ${Object.keys(checks).length} checks; human Stage-20 pending.`);
  } finally {
    await prisma.$disconnect();
  }
}

writeEvidence('FAIL', { failure: 'Probe not completed.' });
try { await run(); }
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeEvidence('FAIL', { failure: message.slice(0, 500), note: 'W3 PostgreSQL verification failed closed. Do not claim runtime closure.' });
  console.error(`W3_POSTGRES_PROBE_FAIL: ${message}`);
  process.exitCode = 1;
}
