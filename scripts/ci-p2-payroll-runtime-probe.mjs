#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient, Prisma } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-p2-payroll-runtime-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential P2 Payroll runtime probe tidak tersedia.');
if (!/^postgres(?:ql)?:\/\//i.test(String(process.env.DATABASE_URL || ''))) throw new Error('P2 Payroll runtime probe wajib berjalan pada PostgreSQL non-production runtime.');
if (/\b(prod|production|live)\b/i.test(String(process.env.DATABASE_URL || ''))) throw new Error('P2 Payroll runtime probe menolak database production/live.');

const prisma = new PrismaClient();
const stamp = Date.now();
const suffix = String(stamp).slice(-9);
const checks = {};
let originalActiveEmployeeIds = [];
let probeEmployeeId = null;

async function request(route, { method = 'GET', body, token, expect } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expect !== undefined) {
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0, 1200)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 1200)}`);
  return data;
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function decimal(value) { return new Prisma.Decimal(value ?? 0); }
function money(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function dateOnly(date) { return date.toISOString().slice(0, 10); }
function utcDate(year, month, day) { return new Date(Date.UTC(year, month - 1, day)); }
function endOfMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

async function assertBalancedJournal(journalEntryId, label) {
  assert(journalEntryId, `${label} tidak memiliki journal entry.`);
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId } });
  assert(lines.length >= 2, `${label} journal lines tidak lengkap.`);
  const debit = lines.reduce((sum, line) => sum.add(line.debit), new Prisma.Decimal(0));
  const credit = lines.reduce((sum, line) => sum.add(line.credit), new Prisma.Decimal(0));
  assert(debit.equals(credit), `${label} journal tidak seimbang debit=${debit.toFixed(2)} credit=${credit.toFixed(2)}.`);
  return { debit: debit.toFixed(2), credit: credit.toFixed(2), lineCount: lines.length };
}

try {
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.accessToken;
  assert(token, 'Login P2 Payroll runtime probe tidak menghasilkan token.');
  const manifest = await request('/platform/manifest', { token });
  const companyId = manifest?.company?.id;
  const branchId = manifest?.branch?.id;
  assert(companyId && branchId, 'Manifest P2 Payroll tidak memiliki company/branch aktif.');

  const activeEmployees = await prisma.employee.findMany({ where: { companyId, branchId, isActive: true }, select: { id: true } });
  originalActiveEmployeeIds = activeEmployees.map((item) => item.id);
  if (originalActiveEmployeeIds.length) await prisma.employee.updateMany({ where: { id: { in: originalActiveEmployeeIds } }, data: { isActive: false } });

  const year = 2090 + Number(suffix.slice(-1));
  const month = 1 + (Number(suffix.slice(-2)) % 12);
  const lastDay = endOfMonth(year, month);
  const start = utcDate(year, month, 1);
  const end = utcDate(year, month, lastDay);
  const day10 = utcDate(year, month, 10);
  const day11 = utcDate(year, month, 11);
  const day15 = utcDate(year, month, 15);
  const day16 = utcDate(year, month, 16);
  const day20 = utcDate(year, month, 20);
  const day21 = utcDate(year, month, 21);

  const employee = await prisma.employee.create({ data: {
    companyId, branchId, employeeNumber: `P2-${suffix}`, fullName: `P2 Payroll Runtime ${suffix}`,
    email: `p2-payroll-${suffix}@example.test`, employmentStatus: 'PERMANENT', hireDate: start,
    timezone: 'Asia/Makassar', isActive: true, metadata: { runtimeProbe: 'P2_PAYROLL' },
  } });
  probeEmployeeId = employee.id;

  const existingFiscal = await prisma.fiscalPeriod.findFirst({ where: { companyId, branchId, startDate: { lte: end }, endDate: { gte: start } } });
  if (!existingFiscal) await prisma.fiscalPeriod.create({ data: { companyId, branchId, name: `P2 Payroll ${year}-${String(month).padStart(2, '0')}`, startDate: start, endDate: new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999)), status: 'OPEN' } });

  const period = await request('/payroll/periods', { method: 'POST', token, body: {
    code: `P2-${year}-${String(month).padStart(2, '0')}-${suffix}`,
    year, month, startDate: dateOnly(start), endDate: dateOnly(end),
  } });
  assert(period?.id, 'PayrollPeriod P2 gagal dibuat.');

  const earning = await request('/payroll/components', { method: 'POST', token, body: {
    code: `P2BASE${suffix}`, name: `P2 Split Salary ${suffix}`, componentType: 'EARNING', calculationType: 'FIXED',
    taxable: true, affectsGross: true, affectsNet: true, proratable: true, attendanceBased: false,
  } });
  assert(earning?.id && earning.proratable === true, 'Komponen proratable P2 gagal dibuat.');
  const firstAssignment = await request('/payroll/employee-components', { method: 'POST', token, body: {
    employeeId: employee.id, componentId: earning.id, amount: 3100000, effectiveFrom: dateOnly(start), effectiveTo: dateOnly(day15),
  } });
  const secondAssignment = await request('/payroll/employee-components', { method: 'POST', token, body: {
    employeeId: employee.id, componentId: earning.id, amount: 6200000, effectiveFrom: dateOnly(day16), effectiveTo: dateOnly(end),
  } });
  assert(firstAssignment?.id && secondAssignment?.id, 'Split-period EmployeePayrollComponent P2 gagal dibuat.');

  const ruleCode = `P2TAX${suffix}`;
  const taxRule1 = await request('/payroll/tax-rule-sets', { method: 'POST', token, body: {
    code: ruleCode, name: `P2 Tax V1 ${suffix}`, effectiveFrom: dateOnly(start), effectiveTo: dateOnly(day15), calculationMode: 'LOOKUP_TABLE',
    parameters: { requiresOfficialRateImport: false, defaultCategory: 'TK0', categories: { TK0: [{ rate: 0.10 }] } }, legalReference: 'P2 runtime synthetic verified rate',
  } });
  await request(`/payroll/tax-rule-sets/${taxRule1.id}/approve`, { method: 'POST', token });
  const taxRule2 = await request('/payroll/tax-rule-sets', { method: 'POST', token, body: {
    code: ruleCode, name: `P2 Tax V2 ${suffix}`, effectiveFrom: dateOnly(day16), effectiveTo: dateOnly(end), calculationMode: 'LOOKUP_TABLE',
    parameters: { requiresOfficialRateImport: false, defaultCategory: 'TK0', categories: { TK0: [{ rate: 0.20 }] } }, legalReference: 'P2 runtime synthetic verified rate',
  } });
  await request(`/payroll/tax-rule-sets/${taxRule2.id}/approve`, { method: 'POST', token });
  checks.midPeriodRuleVersioning = true;

  const grossProfile = await request('/payroll/employee-tax-profiles', { method: 'POST', token, body: {
    employeeId: employee.id, taxStatusCode: 'TK0', taxMethod: 'GROSS', effectiveFrom: dateOnly(start), effectiveTo: dateOnly(day10), attributes: { runtimeProbe: 'P2', segment: 'GROSS' },
  } });
  const grossUpProfile = await request('/payroll/employee-tax-profiles', { method: 'POST', token, body: {
    employeeId: employee.id, taxStatusCode: 'TK0', taxMethod: 'GROSS_UP', effectiveFrom: dateOnly(day11), effectiveTo: dateOnly(day20), attributes: { runtimeProbe: 'P2', segment: 'GROSS_UP' },
  } });
  const netProfile = await request('/payroll/employee-tax-profiles', { method: 'POST', token, body: {
    employeeId: employee.id, taxStatusCode: 'TK0', taxMethod: 'NET', effectiveFrom: dateOnly(day21), effectiveTo: dateOnly(end), attributes: { runtimeProbe: 'P2', segment: 'NET' },
  } });
  assert(grossProfile?.taxMethod === 'GROSS' && grossUpProfile?.taxMethod === 'GROSS_UP' && netProfile?.taxMethod === 'NET', 'Tiga tax method executable tidak dapat dikonfigurasi.');
  const profiles = await request(`/payroll/employee-profiles/${employee.id}`, { token });
  assert(['GROSS','GROSS_UP','NET'].every((method) => profiles?.supportedTaxMethods?.includes(method)), 'Employee profile tidak mengiklankan tiga tax method executable.');
  checks.supportedTaxMethods = true;

  const run = await request('/payroll/runs', { method: 'POST', token, body: { payrollPeriodId: period.id, taxRuleSetId: taxRule1.id, notes: 'P2 full payroll runtime' } });
  assert(run?.id, 'PayrollRun P2 gagal dibuat.');
  const calculated = await request(`/payroll/runs/${run.id}/calculate`, { method: 'POST', token });
  assert(calculated?.status === 'REVIEW', `Payroll run tidak REVIEW setelah calculate: ${calculated?.status}.`);
  const results = await request(`/payroll/runs/${run.id}/results`, { token });
  assert(Array.isArray(results) && results.length === 1, `Payroll P2 harus menghasilkan tepat 1 employee result, actual=${results?.length}.`);
  const result = results[0];
  assert(result.status === 'CALCULATED', `PayrollResult masih ${result.status}.`);
  const trace = result.calculationTrace || {};
  assert(trace.status === 'CALCULATED', `CalculationTrace masih ${trace.status}.`);
  const taxSegments = Array.isArray(trace?.tax?.segments) ? trace.tax.segments : [];
  const methods = new Set(taxSegments.map((item) => item.method).filter(Boolean));
  assert(['GROSS','GROSS_UP','NET'].every((method) => methods.has(method)), `Trace tax method tidak lengkap: ${[...methods].join(',')}.`);
  const ruleIds = new Set(taxSegments.map((item) => item.taxRuleSetId).filter(Boolean));
  assert(ruleIds.has(taxRule1.id) && ruleIds.has(taxRule2.id), 'Trace tidak memakai dua approved tax rule version pada effective segment masing-masing.');
  const grossSegment = taxSegments.find((item) => item.method === 'GROSS');
  const grossUpSegments = taxSegments.filter((item) => item.method === 'GROSS_UP');
  const netSegment = taxSegments.find((item) => item.method === 'NET');
  assert(grossSegment?.employeeTaxDeduction > 0 && grossSegment?.employerBorneTax === 0, 'GROSS tidak memotong pajak dari take-home secara benar.');
  assert(grossUpSegments.length && grossUpSegments.every((item) => item.grossAdjustment > 0 && item.employeeTaxDeduction > 0), 'GROSS_UP tidak menghasilkan taxable allowance yang konvergen.');
  assert(netSegment?.employerBorneTax > 0 && netSegment?.employeeTaxDeduction === 0, 'NET tidak memindahkan pajak ke employer-borne cost secara benar.');
  checks.taxMethodDifferences = true;

  const lines = await prisma.payrollLine.findMany({ where: { payrollResultId: result.id }, orderBy: { createdAt: 'asc' } });
  const componentLines = lines.filter((line) => line.componentId === earning.id);
  assert(componentLines.length === 2, `Split component seharusnya 2 line, actual=${componentLines.length}.`);
  assert(componentLines.every((line) => line.metadata?.proration?.applied === true), 'Split component tidak menyimpan proration applied.');
  const firstLine = componentLines.find((line) => line.metadata?.proration?.activeFrom?.startsWith(dateOnly(start)));
  const secondLine = componentLines.find((line) => line.metadata?.proration?.activeFrom?.startsWith(dateOnly(day16)));
  assert(firstLine && secondLine && Number(firstLine.amount) !== Number(secondLine.amount), 'Proration tidak mempertahankan perubahan amount efektif di pertengahan periode.');
  const allowanceLine = lines.find((line) => line.code === 'TAX_GROSS_UP_ALLOWANCE');
  const taxLine = lines.find((line) => line.code === 'INCOME_TAX');
  assert(allowanceLine && decimal(allowanceLine.amount).greaterThan(0), 'Generated GROSS_UP allowance line tidak ada.');
  assert(taxLine && decimal(taxLine.employerAmount).greaterThan(0), 'Income tax line tidak merekam employer-borne NET tax.');
  checks.splitPeriodProration = true;

  const approved = await request(`/payroll/runs/${run.id}/approve`, { method: 'POST', token });
  assert(approved?.status === 'APPROVED', 'Payroll P2 gagal APPROVED tanpa REQUIRES_REVIEW.');
  const posted = await request(`/payroll/runs/${run.id}/post-accounting`, { method: 'POST', token });
  assert(['POSTED','PAID'].includes(posted?.status) && posted?.postedJournalEntryId, 'Payroll P2 gagal posting accounting.');
  const sourceJournal = await assertBalancedJournal(posted.postedJournalEntryId, 'P2 payroll source');
  checks.accountingPosting = true;

  const sourcePayments = await request(`/payroll/runs/${run.id}/payments`, { token });
  const outbound = sourcePayments.find((item) => item.direction === 'OUTBOUND' && item.status === 'PENDING');
  assert(outbound?.id && Number(outbound.amount) > 0, 'Payroll source tidak menghasilkan outbound salary payment.');
  const cash = await prisma.account.findFirst({ where: { branchId, code: '1101', type: 'ASSET', isActive: true } }).catch(() => null);
  const settlement = cash || await prisma.account.findFirst({ where: { branchId, type: 'ASSET', isActive: true }, orderBy: { code: 'asc' } });
  assert(settlement?.code, 'Akun settlement aset tidak tersedia.');
  await request(`/payroll/payments/${outbound.id}/settle`, { method: 'POST', token, body: {
    settlementAccountCode: settlement.code, paymentMethod: settlement.code === '1101' ? 'CASH' : 'BANK_TRANSFER',
    ...(settlement.code === '1101' ? {} : { externalReference: `P2-SAL-${suffix}` }), paidAt: dateOnly(end),
  } });
  const paidRun = (await request('/payroll/runs', { token })).find((item) => item.id === run.id);
  assert(paidRun?.status === 'PAID', 'Payroll source tidak menjadi PAID setelah salary settlement.');

  const deduction = await request('/payroll/components', { method: 'POST', token, body: {
    code: `P2ADJ${suffix}`, name: `P2 Recovery Deduction ${suffix}`, componentType: 'DEDUCTION', calculationType: 'FIXED',
    defaultAmount: 100000, taxable: false, affectsGross: false, affectsNet: true, proratable: false, attendanceBased: false,
  } });
  await request('/payroll/employee-components', { method: 'POST', token, body: {
    employeeId: employee.id, componentId: deduction.id, amount: 100000, effectiveFrom: dateOnly(start), effectiveTo: dateOnly(end),
  } });
  const adjustment = await request(`/payroll/runs/${run.id}/adjustments`, { method: 'POST', token, body: {
    reason: 'P2 runtime verifies post-payment recovery path', postingDate: dateOnly(end),
  } });
  await request(`/payroll/runs/${adjustment.id}/calculate`, { method: 'POST', token });
  const adjustmentResults = await request(`/payroll/runs/${adjustment.id}/results`, { token });
  assert(adjustmentResults.length === 1 && Number(adjustmentResults[0].netPay) < 0, 'Adjustment P2 tidak menghasilkan differential net negatif untuk recovery.');
  const adjustedApproved = await request(`/payroll/runs/${adjustment.id}/approve`, { method: 'POST', token });
  assert(adjustedApproved?.status === 'APPROVED', 'Payroll adjustment P2 gagal APPROVED.');
  const adjustedPosted = await request(`/payroll/runs/${adjustment.id}/post-accounting`, { method: 'POST', token });
  assert(['POSTED','PAID'].includes(adjustedPosted?.status) && adjustedPosted?.postedJournalEntryId, 'Payroll adjustment P2 gagal posting.');
  const adjustmentJournal = await assertBalancedJournal(adjustedPosted.postedJournalEntryId, 'P2 payroll adjustment');
  const adjustmentPayments = await request(`/payroll/runs/${adjustment.id}/payments`, { token });
  const recovery = adjustmentPayments.find((item) => item.direction === 'RECOVERY' && item.status === 'PENDING');
  assert(recovery?.id && money(recovery.amount) === 100000, `Recovery payroll expected 100000, actual=${recovery?.amount}.`);
  await request(`/payroll/payments/${recovery.id}/settle`, { method: 'POST', token, body: {
    settlementAccountCode: settlement.code, paymentMethod: settlement.code === '1101' ? 'CASH' : 'BANK_TRANSFER',
    ...(settlement.code === '1101' ? {} : { externalReference: `P2-REC-${suffix}` }), paidAt: dateOnly(end),
  } });
  const liabilities = await request('/payroll/liabilities', { token });
  const liability = liabilities.find((item) => item.payrollRunId === run.id);
  assert(liability && Number(liability.recovery?.recognized) >= 100000 && Number(liability.recovery?.paid) >= 100000, 'Payroll liability snapshot tidak merekam recovery yang sudah disettle.');
  checks.adjustmentRecovery = true;

  const evidence = {
    generatedAt: new Date().toISOString(), status: 'PASS', sourceIdentity: sourceFingerprint(root), productionTouched: false,
    payrollRunId: run.id, adjustmentRunId: adjustment.id, employeeId: employee.id, periodId: period.id,
    taxRuleSetIds: [taxRule1.id, taxRule2.id], taxProfileIds: [grossProfile.id, grossUpProfile.id, netProfile.id],
    journals: { source: sourceJournal, adjustment: adjustmentJournal }, checks,
    note: 'P2 Payroll PostgreSQL runtime proof executes GROSS, GROSS_UP, NET, actual temporal split allocation, mid-period rule versioning, balanced accounting, paid salary, differential adjustment, employee-receivable recovery and recovery settlement on exact source.',
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`P2 Payroll runtime probe PASS: run=${run.id}, adjustment=${adjustment.id}, employee=${employee.id}.`);
} catch (error) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), status: 'FAIL', sourceIdentity: sourceFingerprint(root), productionTouched: false, checks, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
  throw error;
} finally {
  try {
    if (probeEmployeeId) await prisma.employee.updateMany({ where: { id: probeEmployeeId }, data: { isActive: false } });
    if (originalActiveEmployeeIds.length) await prisma.employee.updateMany({ where: { id: { in: originalActiveEmployeeIds } }, data: { isActive: true } });
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}
