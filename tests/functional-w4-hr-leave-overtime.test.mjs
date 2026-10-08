import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const hr = read('apps/api/src/hr/hr.service.ts');
const hrController = read('apps/api/src/hr/hr.controller.ts');
const ess = read('apps/api/src/employee-self-service/employee-self-service.controller.ts');
const portal = [
  read('apps/employee-portal/app/page.tsx'),
  read('apps/employee-portal/app/employee-portal-app.tsx'),
].join('\n');
const payroll = read('apps/api/src/payroll/payroll.service.ts');
const seed = read('apps/api/prisma/seed.ts');
const sqlite = read('apps/api/prisma/schema.sqlite.prisma');
const postgres = read('apps/api/prisma/schema.postgresql.prisma');
const canonical = read('apps/api/prisma/schema.prisma');

test('W4 leave and overtime models exist consistently in all Prisma profiles', () => {
  for (const schema of [sqlite, postgres, canonical]) {
    assert.match(schema, /model LeaveType \{/);
    assert.match(schema, /model LeaveRequest \{/);
    assert.match(schema, /model OvertimeRequest \{/);
    assert.match(schema, /approvalRequestId\s+String\?/);
  }
});

test('W4 seed provides leave/overtime approval policies and safe demo leave types', () => {
  assert.match(seed, /code: 'ANNUAL'.*Cuti Tahunan/s);
  assert.match(seed, /code: 'SICK'.*Sakit/s);
  assert.match(seed, /code: 'LEAVE_REQUEST'/);
  assert.match(seed, /code: 'OVERTIME_REQUEST'/);
});

test('employee can submit leave with overlap, document and annual quota controls', () => {
  assert.match(hr, /async submitLeave\(/);
  assert.match(hr, /requiresDocument/);
  assert.match(hr, /Rentang cuti bertumpang tindih/);
  assert.match(hr, /annualQuota/);
  assert.match(hr, /Kuota .* tidak mencukupi/);
  assert.match(hr, /entityType: 'LeaveRequest'/);
});

test('employee can submit overtime with duration and overlap controls', () => {
  assert.match(hr, /async submitOvertime\(/);
  assert.match(hr, /maksimal 24 jam/);
  assert.match(hr, /Rentang lembur bertumpang tindih/);
  assert.match(hr, /entityType: 'OvertimeRequest'/);
});

test('HR approval endpoints are permissioned and update linked ApprovalRequest', () => {
  assert.match(hrController, /@Permissions\('leave\.approve'\).*leave-requests\/:id\/review/s);
  assert.match(hrController, /@Permissions\('overtime\.approve'\).*overtime-requests\/:id\/review/s);
  assert.match(hr, /approvalDecision\.create/);
  assert.match(hr, /approvalRequest\.update/);
  assert.match(hr, /APPROVE_LEAVE_REQUEST/);
  assert.match(hr, /APPROVE_OVERTIME_REQUEST/);
});

test('employee self-service API exposes leave types, leave requests and overtime requests', () => {
  assert.match(ess, /@Get\('leave-types'\)/);
  assert.match(ess, /@Post\('leave-requests'\)/);
  assert.match(ess, /@Get\('leave-requests'\)/);
  assert.match(ess, /@Post\('overtime-requests'\)/);
  assert.match(ess, /@Get\('overtime-requests'\)/);
});

test('employee portal executes leave and overtime workflows instead of display-only HR', () => {
  assert.match(portal, /api\('\/employee\/me\/leave-types'\)/);
  assert.match(portal, /api\('\/employee\/me\/leave-requests'/);
  assert.match(portal, /api\('\/employee\/me\/overtime-requests'/);
  assert.match(portal, /function submitLeave/);
  assert.match(portal, /function submitOvertime/);
  assert.match(portal, /Kirim Pengajuan Cuti/);
  assert.match(portal, /Kirim Pengajuan Lembur/);
});

test('payroll attendance lock fails closed while leave/overtime approvals are pending', () => {
  assert.match(payroll, /leaveRequest\.count\([\s\S]*status: 'SUBMITTED'/);
  assert.match(payroll, /overtimeRequest\.count\([\s\S]*status: 'SUBMITTED'/);
  assert.match(payroll, /Absensi belum dapat dikunci: correction=.*leave=.*overtime=/);
});
