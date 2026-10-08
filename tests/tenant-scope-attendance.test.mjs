import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync('apps/api/src/attendance/attendance.controller.ts', 'utf8');
const service = readFileSync('apps/api/src/attendance/attendance.service.ts', 'utf8');
const dto = readFileSync('apps/api/src/attendance/dto/attendance.dto.ts', 'utf8');

test('attendance endpoints derive tenant context from authenticated user', () => {
  assert.match(controller, /import \{ AuthUser \} from '\.\.\/auth\/auth\.types';/);
  assert.match(controller, /import \{ CurrentUser \} from '\.\.\/auth\/current-user\.decorator';/);
  assert.match(controller, /employeeConfig\(user, employeeId\)/);
  assert.match(controller, /uploadLocalPhoto\(user, dto\)/);
  assert.match(controller, /record\(user, dto\)/);
  assert.match(controller, /ingestFingerprint\(user, dto\)/);
  assert.match(controller, /createDevice\(user, dto\)/);
  assert.match(controller, /createGeofence\(user, dto\)/);
  assert.match(controller, /enroll\(user, dto\)/);
  assert.match(controller, /listEmployee\(user, employeeId, limit, cursor\)/);
  assert.match(service, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
});

test('legacy company and branch fields are optional and cannot become tenant authority', () => {
  assert.match(dto, /companyId\?: string/);
  assert.match(dto, /branchId\?: string/);
  assert.doesNotMatch(dto, /companyId!:\s*string/);
  assert.match(service, /assertRequestedScope\(this\.prisma, user, scope, dto\.companyId, dto\.branchId/);
  assert.doesNotMatch(service, /companyId:\s*dto\.companyId/);
  assert.doesNotMatch(service, /branchId:\s*dto\.branchId/);
});

test('employee configuration and record reads remain company and branch scoped', () => {
  assert.match(service, /where: \{ id: employeeId, companyId: scope\.companyId, branchId: scope\.branchId, isActive: true \}/);
  assert.match(service, /companyId: scope\.companyId,[\s\S]*OR: \[\{ branchId: scope\.branchId \}, \{ branchId: null \}\]/);
  assert.match(service, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId,[\s\S]*employeeId: employee\.id/);
  assert.match(service, /take: limit \+ 1/);
});

test('attendance event idempotency never returns another branch event', () => {
  assert.match(service, /existingEventForKey/);
  assert.match(service, /where: \{ companyId: scope\.companyId, \.\.\.key \}/);
  assert.match(service, /if \(prior\.branchId !== scope\.branchId\)/);
  assert.match(service, /entityType: 'AttendanceEvent'/);
  assert.match(service, /existingBranchId: prior\.branchId/);
});

test('attendance foreign references are validated inside token tenant', () => {
  assert.match(service, /id: deviceId, companyId: scope\.companyId, branchId: scope\.branchId, status: 'ACTIVE'/);
  assert.match(service, /companyId: scope\.companyId, branchId: scope\.branchId, code: deviceCode, status: 'ACTIVE'/);
  assert.match(service, /id: geofenceId,[\s\S]*companyId: scope\.companyId,[\s\S]*OR: \[\{ branchId: scope\.branchId \}, \{ branchId: null \}\]/);
  assert.match(service, /attendanceDeviceId: device\.id,[\s\S]*deviceUserCode: dto\.deviceUserCode/);
  assert.match(service, /scopedEmployee\(this\.prisma, user, scope, credential\.employeeId\)/);
});

test('attendance writes, summaries, and local media use token company and branch', () => {
  assert.match(service, /companyId: scope\.companyId,[\s\S]*branchId: scope\.branchId,[\s\S]*employeeId: employee\.id/);
  assert.match(service, /where: \{ companyId: scope\.companyId, branchId: scope\.branchId, workDate \}/);
  assert.match(service, /data: \{ companyId: scope\.companyId, branchId: scope\.branchId, businessDate: workDate/);
  assert.match(service, /attendance-media\/\$\{scope\.companyId\}\/\$\{scope\.branchId\}/);
  assert.match(service, /action: 'RECORD_ATTENDANCE_EVENT'/);
});

test('device, geofence, and biometric mutations are tenant forced and audited', () => {
  assert.match(service, /action: 'CREATE_ATTENDANCE_DEVICE'/);
  assert.match(service, /action: 'CREATE_ATTENDANCE_GEOFENCE'/);
  assert.match(service, /action: 'ENROLL_EMPLOYEE_BIOMETRIC'/);
  assert.match(service, /companyId: scope\.companyId,\s*branchId: scope\.branchId,\s*code: dto\.code/);
  assert.match(service, /companyId: scope\.companyId,\s*employeeId: employee\.id/);
});
