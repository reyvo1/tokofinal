import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hrController = readFileSync('apps/api/src/hr/hr.controller.ts', 'utf8');
const hrService = readFileSync('apps/api/src/hr/hr.service.ts', 'utf8');
const hrDto = readFileSync('apps/api/src/hr/dto/hr.dto.ts', 'utf8');
const payrollController = readFileSync('apps/api/src/payroll/payroll.controller.ts', 'utf8');
const payrollService = readFileSync('apps/api/src/payroll/payroll.service.ts', 'utf8');
const payrollDto = readFileSync('apps/api/src/payroll/dto/payroll.dto.ts', 'utf8');

test('HR endpoints derive company and branch from authenticated user', () => {
  assert.match(hrController, /@CurrentUser\(\) user: AuthUser/);
  assert.match(hrController, /listEmployees\(user, limit, cursor, branchId, search, companyId\)/);
  assert.match(hrController, /createEmployee\(dto, user\)/);
  assert.match(hrController, /updateEmployee\(id, dto, user\)/);
  assert.match(hrService, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(hrService, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(hrDto, /companyId\?: string/);
});

test('employee reads and mutations are company and branch scoped', () => {
  assert.match(hrService, /companyId: scope\.companyId,\s*branchId: scope\.branchId/);
  assert.match(hrService, /where: \{ id, companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(hrService, /companyId: scope\.companyId,\s*branchId: scope\.branchId,\s*userId: dto\.userId/);
  assert.match(hrService, /assertRequestedScope\(this\.prisma, user, scope, dto\.companyId, dto\.branchId, 'Employee'\)/);
  assert.doesNotMatch(hrService, /companyId: dto\.companyId/);
});

test('HR foreign references are validated inside token tenant', () => {
  assert.match(hrService, /where: \{ id: departmentId, companyId: scope\.companyId, isActive: true \}/);
  assert.match(hrService, /where: \{ id: positionId, companyId: scope\.companyId, isActive: true \}/);
  assert.match(hrService, /where: \{ id: userId, branchId: scope\.branchId, isActive: true \}/);
  assert.match(hrService, /CREATE_EMPLOYEE/);
  assert.match(hrService, /UPDATE_EMPLOYEE/);
});

test('payroll endpoints pass authenticated user through every operation', () => {
  assert.match(payrollController, /listRuns\(user, companyId\)/);
  assert.match(payrollController, /createPeriod\(dto, user\)/);
  assert.match(payrollController, /assignComponent\(dto, user\)/);
  assert.match(payrollController, /calculateRun\(id, user\)/);
  assert.match(payrollController, /postAccounting\(id, user\)/);
  assert.match(payrollController, /publishPayslips\(id, dto, user\)/);
  assert.match(payrollService, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(payrollService, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(payrollDto, /branchId\?: string/);
});

test('payroll run creation and list force token company and branch', () => {
  assert.match(payrollService, /companyId: scope\.companyId,\s*branchId: scope\.branchId,\s*payrollPeriodId: dto\.payrollPeriodId/);
  assert.match(payrollService, /where: \{ companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(payrollService, /assertPeriod\(tx, user, scope, dto\.payrollPeriodId\)/);
  assert.match(payrollService, /assertTaxRuleSet\(tx, user, scope, dto\.taxRuleSetId\)/);
  assert.match(payrollService, /assertSocialRuleSet\(tx, user, scope, dto\.socialSecurityRuleSetId\)/);
  assert.doesNotMatch(payrollService, /companyId: dto\.companyId/);
  assert.doesNotMatch(payrollService, /branchId: dto\.branchId/);
});



test('tenant guard helpers return never on missing payroll run or period', () => {
  assert.match(payrollService, /if \(!run\) return this\.denyTenantAccess\(client, user, scope, 'PayrollRun', runId\);/);
  assert.match(payrollService, /if \(!period\) return this\.denyTenantAccess\(client, user, scope, 'PayrollPeriod', periodId\);/);
  assert.doesNotMatch(payrollService, /if \(!run\) await this\.denyTenantAccess/);
  assert.doesNotMatch(payrollService, /if \(!period\) await this\.denyTenantAccess/);
});

test('payroll calculation scopes employees, attendance, components, and profiles', () => {
  assert.match(payrollService, /where: \{ companyId: scope\.companyId, branchId: scope\.branchId, isActive: true \}/);
  assert.match(payrollService, /companyId: scope\.companyId,\s*employeeId: employee\.id/);
  assert.match(payrollService, /companyId: scope\.companyId,\s*branchId: scope\.branchId,\s*employeeId: employee\.id/);
  assert.match(payrollService, /employeeTaxProfile\.findMany\(\{ where: \{[\s\S]*?employeeId: employee\.id, companyId: scope\.companyId,[\s\S]*?effectiveFrom: \{ lte: period\.endDate \}[\s\S]*?effectiveTo: \{ gte: period\.startDate \}/);
  assert.match(payrollService, /employeeSocialSecurityProfile\.findMany\(\{ where: \{[\s\S]*?employeeId: employee\.id, companyId: scope\.companyId,[\s\S]*?effectiveFrom: \{ lte: period\.endDate \}[\s\S]*?effectiveTo: \{ gte: period\.startDate \}/);
  assert.match(payrollService, /private buildEffectiveSegments/);
  assert.match(payrollService, /private allocateTemporalAmounts/);
});

test('payroll approval, accounting posting, and payslip publication remain branch scoped and audited', () => {
  assert.match(payrollService, /scopedRun\(tx, user, scope, runId\)/);
  assert.match(payrollService, /companyId: scope\.companyId, branchId: scope\.branchId, eventType: 'PAYROLL_POSTED'/);
  assert.match(payrollService, /where: \{ payrollRunId: runId, companyId: scope\.companyId \}/);
  assert.match(payrollService, /where: \{ id: result\.employeeId, companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(payrollService, /APPROVE_PAYROLL_RUN/);
  assert.match(payrollService, /POST_PAYROLL_ACCOUNTING/);
  assert.match(payrollService, /PUBLISH_PAYSLIPS/);
});

test('employee self-service resolves employee and records inside token tenant', () => {
  const controller = readFileSync('apps/api/src/employee-self-service/employee-self-service.controller.ts', 'utf8');
  const service = readFileSync('apps/api/src/employee-self-service/employee-self-service.service.ts', 'utf8');
  assert.match(controller, /this\.hr\.byUserId\(user\)/);
  assert.match(controller, /companyId: employee\.companyId,\s*branchId: employee\.branchId,\s*employeeId: employee\.id/);
  assert.match(controller, /where: \{ id, companyId: employee\.companyId, employeeId: employee\.id \}/);
  assert.match(service, /requestBinding\(user: AuthUser/);
  assert.match(service, /companyId: employee\.companyId, employeeId: employee\.id/);
  assert.match(hrService, /userId: user\.sub, companyId: scope\.companyId, branchId: scope\.branchId/);
});
