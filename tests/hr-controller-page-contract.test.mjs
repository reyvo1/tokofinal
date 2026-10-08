import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes, createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const source = read('apps/admin/app/hr-api-contract.ts');
const contract = vm.runInNewContext(`${stripTypeScriptTypes(source).replace(/export /g, '')}\n;({canReadHrPath, hrReadPermission, shiftStatusPayload, payrollRulePayload})`);
const require = createRequire(new URL('apps/api/package.json', root));
require('reflect-metadata');
const ts = require('typescript');
const { validateSync } = require('class-validator');
function loadDto(file) {
  const exports = {};
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText;
  vm.runInNewContext(code, { require, exports, Reflect });
  return exports;
}
const payroll = loadDto('apps/api/src/payroll/dto/payroll.dto.ts');
const attendance = loadDto('apps/api/src/attendance/dto/attendance.dto.ts');
const validate = (Dto, payload) => validateSync(Object.assign(new Dto(), JSON.parse(JSON.stringify(payload))), { whitelist: true, forbidNonWhitelisted: true });

test('HR reads match actual controller permission decorators, including cross-domain dependencies', () => {
  for (const [file, prefix] of [['hr/hr.controller.ts','hr'], ['attendance/attendance.controller.ts','attendance'], ['payroll/payroll.controller.ts','payroll']]) {
    const text = read(`apps/api/src/${file}`);
    for (const [, permission, route] of text.matchAll(/@Permissions\('([^']+)'\)\s*@Get\('([^']+)'\)/g)) {
      if (route === 'config') continue; // employee recording config is not used by the Admin HR page
      assert.equal(contract.hrReadPermission(`/${prefix}/${route}`), permission, route);
    }
  }
  const actor = { roles: ['PAYROLL'], permissions: ['payroll.view'] };
  assert.equal(contract.canReadHrPath(actor, '/payroll/runs'), true);
  for (const path of ['/hr/employees', '/payroll/tax-rule-sets', '/hr/leave-types', '/attendance/work-shifts', '/accounting-core/accounts']) assert.equal(contract.canReadHrPath(actor, path), false, path);
  assert.equal(contract.canReadHrPath({ roles: ['HR'], permissions: ['finance.view'] }, '/accounting-core/accounts'), false);
  assert.equal(contract.canReadHrPath({ roles: ['FINANCE'], permissions: ['finance.view'] }, '/accounting-core/accounts'), true);
});

test('shift toggle passes the real DTO whitelist and preserves overnight and tolerance settings', () => {
  const row = { id: 'server-id', companyId: 'tenant', branchId: 'branch', code: 'NIGHT', name: 'Malam', startMinute: 1320, endMinute: 360, crossesMidnight: true, breakMinutes: 45, lateToleranceMinutes: 10, earlyLeaveToleranceMinutes: 5, minimumWorkMinutes: null, overtimeAfterMinutes: 420, isActive: true, createdAt: 'server-time' };
  const payload = contract.shiftStatusPayload(row);
  assert.deepEqual(validate(attendance.UpdateWorkShiftDto, payload), []);
  assert.equal(payload.crossesMidnight, true);
  assert.equal(payload.breakMinutes, 45);
  assert.equal(payload.isActive, false);
  assert.ok(!('companyId' in payload));
  assert.ok(validate(attendance.UpdateWorkShiftDto, { ...row, isActive: false }).length > 0, 'old payload must reproduce whitelist rejection');
});

test('tax and social forms send different DTOs accepted by the actual validation rules', () => {
  const fields = { code: 'TEST', name: 'Fixture only', effectiveFrom: '2026-01-01', calculationMode: 'LOOKUP_TABLE', parameters: '{"categories":{"TEST":[{"upTo":null,"rate":0}]}}' };
  const tax = contract.payrollRulePayload('tax', fields);
  assert.deepEqual(validate(payroll.CreateRuleSetDto, tax), []);
  const social = contract.payrollRulePayload('social', { ...fields, parameters: '{"programs":[{"code":"TEST","employeeRate":0,"employerRate":0}]}' });
  assert.deepEqual(validate(payroll.CreateSocialSecurityRuleSetDto, social), []);
  assert.ok(!('calculationMode' in social));
  assert.ok(validate(payroll.CreateSocialSecurityRuleSetDto, tax).length > 0, 'old shared payload must reproduce rejection');
  assert.throws(() => contract.payrollRulePayload('tax', { ...fields, parameters: '[]' }));
  assert.throws(() => contract.payrollRulePayload('tax', { ...fields, parameters: 'invalid' }));
});

test('page uses supported calculation modes, per-rule approval, stable form references and safe payload builder', () => {
  const page = read('apps/admin/app/modules/hr-payroll.tsx');
  const service = read('apps/api/src/payroll/payroll.service.ts');
  for (const mode of ['LOOKUP_TABLE','ANNUAL_PROGRESSIVE']) {
    assert.ok(page.includes(`value="${mode}"`));
    assert.ok(service.includes(`calculationMode === '${mode}'`));
  }
  assert.ok(page.includes("canAll(kind === 'tax' ? 'tax.manage' : 'payroll.approve')"));
  assert.ok(page.includes('JSON.stringify(shiftStatusPayload(shift))'));
  assert.ok(page.includes('payrollRulePayload(kind,'));
  assert.ok(!page.includes('event.currentTarget.reset()'));
  assert.ok(!page.includes('value="BRACKET"'));
});
