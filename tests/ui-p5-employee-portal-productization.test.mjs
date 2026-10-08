import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('apps/employee-portal/app/employee-portal-app.tsx', 'utf8');
const shell = fs.readFileSync('apps/employee-portal/app/employee-portal-shell.tsx', 'utf8');
const route = fs.readFileSync('apps/employee-portal/app/[view]/page.tsx', 'utf8');
const css = fs.readFileSync('apps/employee-portal/app/globals.css', 'utf8');

test('UI-P5 exposes reusable employee portal shell and canonical self-service routes', () => {
  assert.match(shell, /export function EmployeePortalShell/);
  for (const view of ['attendance', 'leave', 'overtime', 'payslips', 'history', 'profile']) {
    assert.match(shell, new RegExp(`id: '${view}'`));
  }
  assert.match(route, /isEmployeePortalView/);
  assert.match(route, /EmployeePortalApp initialView=\{view\}/);
});

test('UI-P5 preserves existing Employee Portal browser and authentication contract', () => {
  assert.match(page, /TOKO360 HR/);
  assert.match(page, /Portal Karyawan/);
  assert.match(page, /Employee Portal authenticated self-service/);
  assert.match(page, /employeeAuthFetch/);
  assert.match(page, /toko360:employee-auth-refreshed/);
  assert.match(page, /toko360:employee-auth-expired/);
  assert.match(page, /localStorage\.getItem\('employeeToken'\)/);
});

test('UI-P5 keeps attendance evidence flow server-authoritative', () => {
  assert.match(page, /\/attendance\/events/);
  assert.match(page, /operationId: crypto\.randomUUID\(\)/);
  assert.match(page, /latitude: position\.latitude/);
  assert.match(page, /longitude: position\.longitude/);
  assert.match(page, /accuracyMeters: position\.accuracy/);
  assert.match(page, /geofenceId/);
  assert.match(page, /photoObjectKey/);
  assert.match(page, /companyId: employee\.companyId/);
  assert.match(page, /branchId: employee\.branchId/);
});

test('UI-P5 keeps leave overtime payslip and employee self-scope APIs unchanged', () => {
  for (const contract of [
    '/employee/me',
    '/employee/me/attendance?limit=31',
    '/employee/me/payslips?limit=12',
    '/employee/me/leave-types',
    '/employee/me/leave-requests',
    '/employee/me/overtime-requests',
  ]) {
    assert.match(page, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('UI-P5 provides responsive desktop and mobile workspace navigation', () => {
  assert.match(shell, /className="employeeV4[^"]*lg:grid-cols-\[250px_minmax\(0,1fr\)\]/);
  assert.match(shell, /<aside className="hidden[^"]*lg:flex/);
  assert.match(css, /\.employeeMobileNav/);
  assert.match(css, /\.employeeViewBody/);
  assert.match(css, /prefers-reduced-motion/);
});
