import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const controller = fs.readFileSync('apps/api/src/finance-operations/finance-operations.controller.ts', 'utf8');
const service = fs.readFileSync('apps/api/src/finance-operations/finance-operations.service.ts', 'utf8');
const ui = fs.readFileSync('apps/admin/app/modules/finance-depth-workspace.tsx', 'utf8');
const accounting = fs.readFileSync('apps/admin/app/modules/accounting.tsx', 'utf8');

test('F7 exposes tenant-scoped AR/AP aging endpoints', () => {
  assert.match(controller, /@Get\('ar-aging'\)/);
  assert.match(controller, /@Get\('ap-aging'\)/);
  assert.match(service, /customerReceivableAging\(user: AuthUser/);
  assert.match(service, /supplierPayableAging\(user: AuthUser/);
  assert.match(service, /paymentTermDays/);
  assert.match(service, /agingBucket/);
  assert.match(service, /90_PLUS/);
});

test('F7 cash bank position is journal backed and statement comparable', () => {
  assert.match(controller, /@Get\('cash-bank-position'\)/);
  assert.match(service, /async cashBankPosition\(user: AuthUser\)/);
  assert.match(service, /journalLine\.findMany/);
  assert.match(service, /bookBalance/);
  assert.match(service, /latestStatementBalance/);
  assert.match(service, /statementDelta/);
});

test('F7 settlement trace connects operational settlement to accounting and journal', () => {
  assert.match(controller, /@Get\('settlement-trace'\)/);
  assert.match(service, /referenceType dan referenceId wajib diisi/);
  assert.match(service, /operationalFinanceTransaction\.findMany/);
  assert.match(service, /accountingEvent\.findMany/);
  assert.match(service, /journalEntry\.findMany/);
  assert.match(service, /include: \{ lines: \{ include: \{ account: true \} \} \}/);
});

test('F7 admin provides aging cash-bank and settlement drill-down operator surfaces', () => {
  assert.match(accounting, /FinanceDepthWorkspace/);
  assert.match(ui, /AR AGING/);
  assert.match(ui, /AP AGING/);
  assert.match(ui, /CASH \/ BANK POSITION/);
  assert.match(ui, /SETTLEMENT TRACE/);
  assert.match(ui, /\/finance-operations\/ar-aging/);
  assert.match(ui, /\/finance-operations\/ap-aging/);
  assert.match(ui, /\/finance-operations\/cash-bank-position/);
  assert.match(ui, /\/finance-operations\/settlement-trace/);
});
