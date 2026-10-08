import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('GitHub browser UAT prepares a CI-only employee binding and renders authenticated Employee Portal', () => {
  const browser = fs.readFileSync('scripts/browser-uat.mjs', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');
  assert.match(workflow, /T360_UAT_PREPARE_EMPLOYEE_SELF: 'true'/);
  assert.match(browser, /T360_UAT_PREPARE_EMPLOYEE_SELF/);
  assert.match(browser, /\/employee\/me/);
  assert.match(browser, /\/hr\/employees/);
  assert.match(browser, /employeeNumber: 'CI-UAT-ADMIN'/);
  assert.match(browser, /localStorage\.setItem\('employeeToken'/);
  assert.match(browser, /Employee Portal authenticated self-service/);
  assert.match(browser, /EMPLOYEE_PORTAL_AUTHENTICATED_RUNTIME/);
});

test('employee fixture preparation is opt-in and therefore does not mutate normal/manual browser UAT', () => {
  const browser = fs.readFileSync('scripts/browser-uat.mjs', 'utf8');
  assert.match(browser, /if \(String\(process\.env\.T360_UAT_PREPARE_EMPLOYEE_SELF \|\| ''\)\.toLowerCase\(\) === 'true'\)/);
});
