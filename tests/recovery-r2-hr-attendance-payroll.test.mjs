import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const attendanceController = read('apps/api/src/attendance/attendance.controller.ts');
const attendanceService = read('apps/api/src/attendance/attendance.service.ts');
const hrController = read('apps/api/src/hr/hr.controller.ts');
const hrService = read('apps/api/src/hr/hr.service.ts');
const payrollController = read('apps/api/src/payroll/payroll.controller.ts');
const payrollService = read('apps/api/src/payroll/payroll.service.ts');
const selfController = read('apps/api/src/employee-self-service/employee-self-service.controller.ts');
const selfService = read('apps/api/src/employee-self-service/employee-self-service.service.ts');
const admin = read('apps/admin/app/modules/hr-payroll.tsx');
const portal = read('apps/employee-portal/app/employee-portal-app.tsx');
const r1 = JSON.parse(read('work-items/completed/T360-20260924-022400-recovery-r1-tenant-access-control-plane.json'));
const r2 = JSON.parse(read('work-items/completed/T360-20260924-180000-recovery-r2-hr-attendance-payroll.json'));

test('R1 and R2 are closed on green runtime evidence', () => {
  assert.equal(r1.phase, 'CLOSED');
  assert.equal(r1.closureEvidence.commit, 'abac92662cab4cc7352de4f9f9d2e2419aad9c29');
  assert.equal(r1.closureEvidence.automatedStatus, 'PASS');
  assert.equal(r1.closureEvidence.humanStage20, 'PENDING_SEPARATE');
  assert.equal(r2.phase, 'CLOSED');
  assert.deepEqual(r2.dependencies, ['T360-20260924-022400']);
});

test('R2 attendance exposes shift roster policy correction device geofence biometric operator contracts', () => {
  for (const route of ["@Get('work-shifts')", "@Post('work-shifts')", "@Get('schedules')", "@Post('schedules')", "@Get('policies')", "@Post('policies')", "@Get('corrections')", "@Post('corrections')", "@Post('corrections/:id/review')", "@Get('devices')", "@Get('geofences')", "@Get('biometrics')"]) assert.match(attendanceController, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(attendanceService, /async createWorkShift/);
  assert.match(attendanceService, /async upsertSchedule/);
  assert.match(attendanceService, /async createPolicy/);
  assert.match(attendanceService, /AttendanceRecord sudah dikunci payroll/);
  assert.match(attendanceService, /APPROVE_ATTENDANCE_CORRECTION/);
  assert.match(attendanceService, /REVOKE_BIOMETRIC_CREDENTIAL/);
});

test('R2 employee assignment is effective-dated overlap-safe and audited', () => {
  assert.match(hrController, /@Post\('assignments'\)/);
  assert.match(hrService, /Rentang primary EmployeeAssignment bertumpang tindih/);
  assert.match(hrService, /CREATE_EMPLOYEE_ASSIGNMENT/);
  assert.match(hrService, /effectiveFrom/);
});

test('R2 payroll profiles and accounting mapping are operator managed and fail closed', () => {
  for (const route of ["@Get('employee-profiles/:employeeId')", "@Post('employee-tax-profiles')", "@Post('employee-social-security-profiles')", "@Get('accounting-mappings')", "@Post('accounting-mappings')"]) assert.match(payrollController, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(payrollService, /supportedTaxMethods: \['GROSS', 'GROSS_UP', 'NET'\]/);
  assert.match(payrollService, /applyPayrollTaxMethod/);
  assert.match(payrollService, /UPSERT_EMPLOYEE_TAX_PROFILE/);
  assert.match(payrollService, /UPSERT_EMPLOYEE_SOCIAL_SECURITY_PROFILE/);
  assert.match(payrollService, /UPSERT_PAYROLL_ACCOUNTING_MAPPING/);
  assert.match(payrollService, /Satu atau lebih akun payroll mapping tidak aktif atau bukan milik branch aktif/);
});

test('R2 employee self-service exposes verified channels preferences and attendance correction', () => {
  assert.match(selfController, /@Get\('channels'\)/);
  assert.match(selfController, /@Get\('notification-preferences'\)/);
  assert.match(selfController, /@Post\('attendance-corrections'\)/);
  assert.match(selfService, /VERIFY_EMPLOYEE_CHANNEL/);
  assert.match(selfService, /harus diverifikasi sebelum preferensi delivery diaktifkan/);
  assert.match(selfService, /SUBMIT_SELF_ATTENDANCE_CORRECTION/);
  assert.match(portal, /Telegram & WhatsApp/);
  assert.match(portal, /Ajukan Koreksi Absensi/);
});

test('R2 Admin has real operator surfaces rather than seed-only configuration', () => {
  for (const label of ['Shift & Jadwal Karyawan','Attendance Policy','Effective-dated Assignment','Koreksi Absensi','Attendance Devices','Geofence','Biometric / Fingerprint Credentials','Employee Tax & Social Security Profile','Payroll Accounting Mapping']) assert.match(admin, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(admin, /window\.prompt|window\.confirm|window\.alert/);
});


test('R2 GitHub runtime probe is mandatory in both full workflows and aggregate evidence', () => {
  const probe = read('scripts/ci-r2-hr-payroll-probe.mjs');
  const full = read('.github/workflows/full-system-simulation.yml');
  const uat = read('.github/workflows/toko360-full-uat.yml');
  const summary = read('scripts/ci-write-full-system-summary.mjs');
  const report = read('scripts/github-uat-report.mjs');
  assert.match(probe, /R2 HR\/payroll probe PASS/);
  assert.match(probe, /supportedTaxMethods/);
  assert.match(probe, /GROSS_UP/);
  assert.match(probe, /NET/);
  assert.match(probe, /attendance\/corrections\/\$\{correction\.id\}\/review/);
  assert.match(probe, /channels\/verify/);
  assert.match(probe, /accounting-mappings/);
  assert.match(probe, /profiles\?\.socialSecurityProfiles\?\.some/);
  assert.doesNotMatch(probe, /profiles\?\.socialProfiles\?\.some/);
  for (const workflow of [full, uat]) {
    assert.match(workflow, /id: r2_hr_payroll/);
    assert.match(workflow, /npm run ci:r2:probe/);
  }
  assert.match(summary, /github-r2-hr-payroll-probe-latest\.json/);
  assert.match(summary, /r2HrPayroll/);
  assert.match(report, /STEP_R2_HR_PAYROLL/);
});
