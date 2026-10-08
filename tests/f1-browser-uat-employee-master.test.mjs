import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../scripts/browser-uat.mjs', import.meta.url), 'utf8');

test('F1 UAT-01 browser coverage enters Employee Master and can exercise real mutations', () => {
  assert.match(script, /ADMIN_EMPLOYEE_MASTER/);
  assert.match(script, /T360_UAT_HR_MUTATIONS/);
  assert.match(script, /ADMIN_EMPLOYEE_MASTER_MUTATIONS/);
  assert.match(script, /'create', 'edit', 'deactivate', 'reactivate'/);
  assert.match(script, /employeeNumber = `UAT-\$\{Date\.now\(\)\}`/);
});
