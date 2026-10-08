import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const schema = readFileSync('apps/api/prisma/schema.postgresql.prisma', 'utf8');
const kit = readFileSync('docs/DEVELOPMENT-KIT.md', 'utf8');
const appModule = readFileSync('apps/api/src/app.module.ts', 'utf8');
const worker = readFileSync('apps/worker/src/index.ts', 'utf8');

for (const file of [
  'docs/HRIS-ATTENDANCE-PAYROLL.md',
  'docs/BIOMETRIC-LOCATION-SECURITY.md',
  'docs/FINGERPRINT-INTEGRATION.md',
  'docs/PAYROLL-TAX-INDONESIA.md',
  'apps/employee-portal/app/page.tsx',
  'packages/plugin-sdk/examples/fingerprint-device.template.ts',
  'packages/plugin-sdk/examples/telegram-provider.template.ts',
  'packages/plugin-sdk/examples/attendance-media-storage.template.ts',
  'database/postgresql/large-scale/hr-partitioning-template.sql',
]) test(`HR artifact exists: ${file}`, () => assert.equal(existsSync(file), true));

test('development kit contains HRIS section', () => {
  assert.match(kit, /## 38\. HRIS, Absensi, Payroll/);
  assert.match(kit, /fingerprint/i);
  assert.match(kit, /geofence/i);
  assert.match(kit, /perpajakan/i);
  assert.match(kit, /(Telegram\/WhatsApp|WhatsApp\/Telegram)/i);
});

test('HR, attendance, payroll and secure delivery models exist', () => {
  for (const model of [
    'Employee','Department','Position','WorkShift','EmployeeSchedule','AttendancePolicy','AttendanceGeofence',
    'AttendanceDevice','EmployeeBiometricCredential','AttendanceEvent','AttendancePhotoEvidence','AttendanceRecord',
    'LeaveRequest','OvertimeRequest','PayrollComponentDefinition','PayrollPeriod','PayrollRun','PayrollResult',
    'PayrollLine','Payslip','PayrollPayment','PayrollAccountingMapping','TaxRuleSet','TaxRule',
    'EmployeeTaxProfile','SocialSecurityRuleSet','EmployeeSocialSecurityProfile','EmployeeChannelBinding',
    'EmployeeNotificationPreference','EmployeeNotificationDelivery','DailyAttendanceSummary','PayrollPeriodSummary',
  ]) assert.match(schema, new RegExp(`model\\s+${model}\\s*\\{`));
});

test('API modules are wired', () => {
  for (const moduleName of ['HrModule','AttendanceModule','PayrollModule','EmployeeSelfServiceModule']) assert.match(appModule, new RegExp(moduleName));
});

test('fingerprint ingest requires permission and no public decorator', () => {
  const controller = readFileSync('apps/api/src/attendance/attendance.controller.ts', 'utf8');
  assert.match(controller, /attendance\.device_ingest/);
  assert.doesNotMatch(controller, /@Public\(\).*fingerprint/);
});

test('notification worker supports Telegram and configurable WhatsApp provider', () => {
  assert.match(worker, /TELEGRAM_BOT_TOKEN/);
  assert.match(worker, /WHATSAPP_PROVIDER_URL/);
  assert.match(worker, /processExternalNotifications/);
});
