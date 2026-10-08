import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function evaluate(expression, variables) {
  const script = `import { evaluatePayrollFormula } from './apps/api/src/payroll/payroll-formula.ts';\nprocess.stdout.write(JSON.stringify(evaluatePayrollFormula(${JSON.stringify(expression)}, ${JSON.stringify(variables)})));`;
  return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' }));
}
function evaluateError(expression, variables) {
  const script = `import { evaluatePayrollFormula } from './apps/api/src/payroll/payroll-formula.ts';\ntry { evaluatePayrollFormula(${JSON.stringify(expression)}, ${JSON.stringify(variables)}); } catch (error) { process.stdout.write(error.message); process.exit(0); } process.exit(2);`;
  return execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' });
}

test('payroll formula evaluates deterministic arithmetic variables', () => {
  assert.equal(evaluate('configured + overtimeMinutes * ratePerMinute', { configured: 1000, overtimeMinutes: 30, ratePerMinute: 100 }), 4000);
  assert.equal(evaluate('max(base, 1000) * 0.1', { base: 2000 }), 200);
  assert.equal(evaluate('round((workedMinutes / 60) * ratePerHour)', { workedMinutes: 485, ratePerHour: 20000 }), 161667);
});

test('payroll formula supports unary operators and parentheses', () => {
  assert.equal(evaluate('-(a - b) + 10', { a: 4, b: 9 }), 15);
});

test('payroll formula fails closed on unknown variables/functions and unsafe tokens', () => {
  assert.match(evaluateError('missing + 1', {}), /unknown-variable/);
  assert.match(evaluateError('eval(1)', {}), /unknown-function/);
  assert.match(evaluateError('process.exit(1)', {}), /unknown-function|invalid-token|unexpected/);
  assert.match(evaluateError('1 / 0', {}), /division-by-zero/);
});

test('payroll service routes FORMULA components through safe parser', () => {
  const source = fs.readFileSync('apps/api/src/payroll/payroll.service.ts', 'utf8');
  assert.match(source, /evaluatePayrollFormula\(definition\.formula/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new Function\s*\(/);
});
