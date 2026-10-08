#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';
import { businessDateKeyInTimeZone, companyTimeZoneFromBranchContext } from './lib/business-date-key.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-r2-hr-payroll-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential R2 probe tidak tersedia.');

async function request(route, { method = 'GET', body, token, expect } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expect !== undefined) {
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0, 600)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 800)}`);
  return data;
}

const login = await request('/auth/login', { method: 'POST', body: { email, password } });
const token = login.accessToken;
if (!token || !login.user?.sub) throw new Error('Login R2 tidak menghasilkan token/user identity.');
const stamp = Date.now();
const branchContext = await request('/auth/branch-context', { token });
const companyTimeZone = companyTimeZoneFromBranchContext(branchContext);
const today = businessDateKeyInTimeZone(new Date(), companyTimeZone);

let employee = await request('/employee/me', { token, expect: 200 }).catch(async (error) => {
  if (!String(error?.message || '').includes('expected 200, got 404')) throw error;
  return request('/hr/employees', {
    method: 'POST', token,
    body: { userId: login.user.sub, employeeNumber: `R2-${String(stamp).slice(-8)}`, fullName: 'R2 Runtime Employee', email: login.user.email || email, employmentStatus: 'PERMANENT', hireDate: today, timezone: 'Asia/Makassar' },
  });
});
if (!employee?.id) throw new Error('Employee R2 runtime tidak tersedia.');

const shift = await request('/attendance/work-shifts', {
  method: 'POST', token,
  body: { code: `R2${String(stamp).slice(-7)}`, name: `R2 Shift ${stamp}`, startMinute: 480, endMinute: 1020, breakMinutes: 60, lateToleranceMinutes: 10, earlyLeaveToleranceMinutes: 10, minimumWorkMinutes: 420, overtimeAfterMinutes: 540 },
});
await request('/attendance/schedules', { method: 'POST', token, body: { employeeId: employee.id, workDate: today, shiftId: shift.id, isDayOff: false, notes: 'R2 GitHub runtime roster' } });
const policy = await request('/attendance/policies', {
  method: 'POST', token,
  body: { code: `R2P${String(stamp).slice(-7)}`, name: `R2 Policy ${stamp}`, allowedMethods: ['MANUAL', 'WEB'], requirePhoto: false, requireLocation: false, requireLiveness: false, allowOutsideGeofence: false, duplicateWindowSeconds: 30, offlineAllowed: false },
});

const assignment = await request('/hr/assignments', { method: 'POST', token, body: { employeeId: employee.id, effectiveFrom: today, isPrimary: true } });
if (!assignment?.id) throw new Error('EmployeeAssignment runtime tidak dibuat.');

const device = await request('/attendance/devices', { method: 'POST', token, body: { code: `R2D${String(stamp).slice(-7)}`, name: `R2 Device ${stamp}`, deviceType: 'FINGERPRINT', vendor: 'CI', model: 'R2' } });
await request(`/attendance/devices/${device.id}`, { method: 'PATCH', token, body: { name: `${device.name} verified`, status: 'ACTIVE' } });
const geofence = await request('/attendance/geofences', { method: 'POST', token, body: { code: `R2G${String(stamp).slice(-7)}`, name: `R2 Geofence ${stamp}`, latitude: 1.4748, longitude: 124.8421, radiusMeters: 250, allowedAccuracyMeters: 100 } });
await request(`/attendance/geofences/${geofence.id}`, { method: 'PATCH', token, body: { radiusMeters: 300, isActive: true } });
const biometric = await request('/attendance/biometrics/enroll', { method: 'POST', token, body: { employeeId: employee.id, attendanceDeviceId: device.id, biometricType: 'FINGERPRINT', deviceUserCode: `R2-${String(stamp).slice(-6)}`, templateHash: `ci-r2-${stamp}` } });
await request(`/attendance/biometrics/${biometric.id}`, { method: 'PATCH', token, body: { revoke: true } });

await request('/attendance/events', { method: 'POST', token, body: { employeeId: employee.id, eventType: 'CHECK_IN', method: 'MANUAL', occurredAt: `${today}T08:00:00.000Z`, workDate: today, operationId: `r2-checkin-${stamp}` } });
const attendancePage = await request(`/attendance/employee?employeeId=${encodeURIComponent(employee.id)}&limit=20`, { token });
const record = (attendancePage?.items || []).find((item) => String(item.workDate || '').slice(0, 10) === today) || attendancePage?.items?.[0];
if (!record?.id) throw new Error('AttendanceRecord R2 runtime tidak materialize dari event nyata.');
const correction = await request('/employee/me/attendance-corrections', { method: 'POST', token, body: { attendanceRecordId: record.id, reason: 'R2 runtime correction evidence', proposedData: { status: 'PRESENT', workedMinutes: 480, notes: 'R2 correction approved by CI runtime' } } });
await request(`/attendance/corrections/${correction.id}/review`, { method: 'POST', token, body: { status: 'APPROVED', reviewNotes: 'R2 GitHub runtime approval' } });

const telegramId = `r2-ci-${stamp}`;
const binding = await request('/employee/me/channels/request-verification', { method: 'POST', token, body: { channel: 'TELEGRAM', externalUserId: telegramId } });
if (!binding?.developmentCode) throw new Error('R2 CI channel verification tidak mengembalikan developmentCode pada non-production runtime.');
await request('/employee/me/channels/verify', { method: 'POST', token, body: { channel: 'TELEGRAM', externalUserId: telegramId, code: binding.developmentCode } });
await request('/employee/me/notification-preferences', { method: 'POST', token, body: { eventCode: 'PAYSLIP_PUBLISHED', channel: 'TELEGRAM', enabled: true } });

const taxProfile = await request('/payroll/employee-tax-profiles', { method: 'POST', token, body: { employeeId: employee.id, taxStatusCode: 'TK0', taxMethod: 'GROSS', effectiveFrom: today, attributes: { runtimeProbe: true } } });
const socialProfile = await request('/payroll/employee-social-security-profiles', { method: 'POST', token, body: { employeeId: employee.id, wageBase: 5000000, programs: ['HEALTH', 'EMPLOYMENT'], effectiveFrom: today } });
const accounts = await request('/accounting-core/accounts', { token });
const expense = accounts.find((item) => item.isActive && item.type === 'EXPENSE');
const liability = accounts.find((item) => item.isActive && item.type === 'LIABILITY');
if (!expense?.id || !liability?.id) throw new Error('Akun expense/liability runtime untuk PayrollAccountingMapping tidak tersedia.');
const mapping = await request('/payroll/accounting-mappings', { method: 'POST', token, body: { componentCode: '__PAYROLL_EXPENSE__', debitAccountId: expense.id, isActive: true, rules: { runtimeProbe: true } } });
await request('/payroll/accounting-mappings', { method: 'POST', token, body: { componentCode: '__SALARY_PAYABLE__', creditAccountId: liability.id, isActive: true, rules: { runtimeProbe: true } } });

const [shifts, schedules, policies, corrections, devices, geofences, biometrics, assignments, profiles, mappings, channels, preferences] = await Promise.all([
  request('/attendance/work-shifts', { token }),
  request(`/attendance/schedules?employeeId=${employee.id}`, { token }),
  request('/attendance/policies', { token }),
  request(`/attendance/corrections?employeeId=${employee.id}`, { token }),
  request('/attendance/devices', { token }),
  request('/attendance/geofences', { token }),
  request(`/attendance/biometrics?employeeId=${employee.id}`, { token }),
  request(`/hr/employees/${employee.id}/assignments`, { token }),
  request(`/payroll/employee-profiles/${employee.id}`, { token }),
  request('/payroll/accounting-mappings', { token }),
  request('/employee/me/channels', { token }),
  request('/employee/me/notification-preferences', { token }),
]);

const checks = {
  workShift: shifts.some((item) => item.id === shift.id), roster: schedules.some((item) => item.employeeId === employee.id), attendancePolicy: policies.some((item) => item.id === policy.id),
  correctionApproved: corrections.some((item) => item.id === correction.id && item.status === 'APPROVED'), device: devices.some((item) => item.id === device.id), geofence: geofences.some((item) => item.id === geofence.id),
  biometricRevoked: biometrics.some((item) => item.id === biometric.id && item.status === 'REVOKED'), assignment: assignments.some((item) => item.id === assignment.id),
  grossTaxProfile: profiles?.taxProfiles?.some((item) => item.id === taxProfile.id && item.taxMethod === 'GROSS'), socialProfile: profiles?.socialSecurityProfiles?.some((item) => item.id === socialProfile.id),
  accountingMapping: mappings.some((item) => item.id === mapping.id), telegramVerified: channels.some((item) => item.channel === 'TELEGRAM' && item.verifiedAt),
  notificationPreference: preferences.some((item) => item.eventCode === 'PAYSLIP_PUBLISHED' && item.channel === 'TELEGRAM' && item.enabled),
  supportedTaxMethods: ['GROSS', 'GROSS_UP', 'NET'].every((method) => profiles?.supportedTaxMethods?.includes(method)),
};
for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`R2 runtime check gagal: ${name}`);

const result = {
  generatedAt: new Date().toISOString(), status: 'PASS', sourceIdentity: sourceFingerprint(root), employeeId: employee.id, checks,
  note: 'R2 runtime probe exercises real WorkShift/roster/policy/correction approval, assignment, device/geofence/biometric lifecycle, verified Telegram preference, employee tax/social profile management, payroll accounting mapping, and executable GROSS/GROSS_UP/NET capability discovery on live PostgreSQL runtime. The dedicated P2 payroll runtime gate is authoritative for method calculation, split-period, posting, adjustment, and recovery lifecycle.',
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`R2 HR/payroll probe PASS: employee=${employee.id}, shift=${shift.id}, correction=${correction.id}.`);
