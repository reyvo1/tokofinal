import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildGate = fs.readFileSync('scripts/run-build-gate.mjs', 'utf8');
const payrollUi = fs.readFileSync('apps/admin/app/modules/hr-payroll.tsx', 'utf8');

test('GitHub build gate generates Prisma Client before TypeScript lint', () => {
  assert.ok(buildGate.indexOf('PRISMA_GENERATE_POSTGRES_FOR_TYPECHECK') < buildGate.indexOf('TYPESCRIPT_LINT'));
});

test('payroll liability table uses an explicit non-React tuple type before mapping rows', () => {
  assert.match(payrollUi, /Array<\[string, LiabilityBucket, 'payrollTaxLiabilityAccount' | 'socialLiabilityAccount'\]>/);
});
