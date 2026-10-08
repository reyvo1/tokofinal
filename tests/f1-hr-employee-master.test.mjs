import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const admin = await readFile(new URL('../apps/admin/app/modules/employee-master.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../apps/admin/app/page.tsx', import.meta.url), 'utf8');
const dto = await readFile(new URL('../apps/api/src/hr/dto/hr.dto.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../apps/api/src/hr/hr.service.ts', import.meta.url), 'utf8');

test('F1 HR-01 employee master exposes real create edit and lifecycle actions', () => {
  assert.match(admin, /api<Employee>\('\/hr\/employees'/);
  assert.match(admin, /method: 'POST'/);
  assert.match(admin, /`\/hr\/employees\/\$\{editingId\}`/);
  assert.match(admin, /method: 'PATCH'/);
  assert.match(admin, /toggleActive/);
  assert.match(admin, /Aktifkan/);
  assert.match(admin, /Nonaktifkan/);
  assert.match(page, /activeWorkspace\.key === 'people'[\s\S]*EmployeeMasterView/);
  assert.match(page, /activeDomainView\?\.key === 'employees'/);
});

test('F1 HR-01 employee edit can clear optional organization links without changing tenant scope', () => {
  assert.match(dto, /departmentId\?: string \| null/);
  assert.match(dto, /positionId\?: string \| null/);
  assert.match(service, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(admin, /departmentId: form\.departmentId \|\| null/);
  assert.match(admin, /positionId: form\.positionId \|\| null/);
  assert.doesNotMatch(admin, /companyId:/);
  assert.doesNotMatch(admin, /branchId:/);
});
