import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const financeController = read('apps/api/src/finance-operations/finance-operations.controller.ts');
const financeDto = read('apps/api/src/finance-operations/dto/finance-operations.dto.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const orderDto = read('apps/api/src/orders/dto/create-order.dto.ts');
const storefront = read('apps/storefront/app/page.tsx');
const pos = read('apps/pos/app/page.tsx');
const payroll = read('apps/api/src/payroll/payroll.service.ts');
const payrollController = read('apps/api/src/payroll/payroll.controller.ts');
const payrollUi = read('apps/admin/app/modules/hr-payroll.tsx');
const tenantProbe = read('scripts/run-tenant-http-db-integration.mjs');

test('public order creation requires a stable operation key and persists idempotent completion', () => {
  assert.match(orderDto, /idempotencyKey\?: string/);
  assert.match(orderDto, /@MaxLength\(200\)[^\n]*idempotencyKey\?: string/);
  assert.match(orders, /if \(!idemKey\)[\s\S]{0,180}Idempotency key wajib untuk checkout/);
  assert.match(orders, /beginIdempotent\(tx,[\s\S]{0,260}scope: scopeKey/);
  assert.match(orders, /await completeIdempotent\(tx, \{ companyId: branch\.companyId, scope: scopeKey, key: idemKey/);
});

test('storefront and POS pickup reuse the same operation key for an unchanged retry', () => {
  assert.match(storefront, /checkoutOperationRef/);
  assert.match(storefront, /pending\?\.fingerprint === fingerprint \? pending\.key : newCheckoutOperationKey\(\)/);
  assert.match(storefront, /'Idempotency-Key': idempotencyKey/);
  assert.match(pos, /pickupOperationRef/);
  assert.match(pos, /pending\?\.fingerprint === fingerprint \? pending\.key : `pos-pickup:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(pos, /headers: \{ 'Idempotency-Key': idempotencyKey \}/);
  assert.match(tenantProbe, /Replay public order/);
  assert.match(tenantProbe, /replay\.body\.id !== order\.body\.id/);
});

test('finance creation is fail-closed without a caller operation key', () => {
  assert.match(financeController, /@Headers\('idempotency-key'\) idempotencyKey\?: string/);
  assert.match(financeDto, /@MaxLength\(200\)[^\n]*idempotencyKey\?: string/);
  assert.match(finance, /if \(!idempotencyKey\)[\s\S]{0,220}Idempotency key wajib untuk membuat transaksi keuangan/);
  assert.doesNotMatch(finance, /randomUUID/);
  assert.match(finance, /scope: `finance:\$\{scope\.companyId\}:\$\{scope\.branchId\}`/);
  assert.match(finance, /await completeIdempotent\(tx,[\s\S]{0,240}resourceType: 'OperationalFinanceTransaction'/);
});

test('payroll catalogue and employee assignments expose bounded cursor pagination', () => {
  assert.match(payrollController, /listComponents[\s\S]{0,180}@Query\('limit'\) limit\?: string, @Query\('cursor'\) cursor\?: string/);
  assert.match(payrollController, /listEmployeeComponents[\s\S]{0,180}@Query\('limit'\) limit\?: string, @Query\('cursor'\) cursor\?: string/);
  const catalogue = payroll.slice(payroll.indexOf('async listComponents'), payroll.indexOf('async listEmployeeComponents'));
  assert.match(catalogue, /parsePageLimit\(limitValue\)/);
  assert.match(catalogue, /take: limit \+ 1/);
  assert.match(catalogue, /toCursorPage\(rows, limit/);
  const assignments = payroll.slice(payroll.indexOf('async listEmployeeComponents'), payroll.indexOf('async createComponent'));
  assert.match(assignments, /take: scanTake/);
  assert.match(assignments, /id: \{ in: employeeIds \}[\s\S]*branchId: scope\.branchId/);
  assert.match(assignments, /toCursorPage\(collected, limit/);
});

test('admin payroll exposes continuation controls instead of silently truncating data', () => {
  assert.match(payrollUi, /\/hr\/employees\?limit=50/);
  assert.match(payrollUi, /\/payroll\/components\?limit=50/);
  assert.match(payrollUi, /\/payroll\/employee-components\?limit=50/);
  assert.match(payrollUi, /loadMoreEmployees/);
  assert.match(payrollUi, /Muat karyawan berikutnya/);
  assert.match(payrollUi, /Muat komponen berikutnya/);
  assert.match(payrollUi, /Muat assignment berikutnya/);
});
