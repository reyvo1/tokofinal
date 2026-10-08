import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const advancedInventory = fs.readFileSync('apps/api/src/advanced-inventory/advanced-inventory.service.ts', 'utf8');
const payroll = fs.readFileSync('apps/api/src/payroll/payroll.service.ts', 'utf8');
const returns = fs.readFileSync('apps/api/src/returns/returns.service.ts', 'utf8');
const worker = fs.readFileSync('apps/worker/src/index.ts', 'utf8');

// GitHub run 96403546724 compile failures: keep guards close to the exact schema contracts.
test('run2 advanced inventory uses Product.unit from current Prisma schema', () => {
  assert.match(advancedInventory, /select: \{ id: true, sku: true, name: true, unit: true \}/);
  assert.doesNotMatch(advancedInventory, /select: \{ id: true, sku: true, name: true, baseUnit: true \}/);
});

test('run2 payroll omits optional receivable account instead of passing undefined into Record<string,string>', () => {
  assert.match(payroll, /accountCodes: \{[\s\S]*payrollExpense: accounts\.payrollExpense[\s\S]*\.\.\.\(accounts\.payrollReceivable \? \{ payrollReceivable: accounts\.payrollReceivable \} : \{\}\)[\s\S]*\}/);
});

test('run2 sale return inventory movement uses SALE_RETURN enum', () => {
  assert.match(returns, /referenceType: 'OrderReturn'[\s\S]{0,220}type: 'SALE_RETURN'|type: 'SALE_RETURN'[\s\S]{0,220}referenceType: 'OrderReturn'/);
  assert.doesNotMatch(returns, /type: 'ORDER_RETURN'/);
});

test('run2 loyalty expiry does not request a nonexistent LoyaltyAccount.program relation', () => {
  assert.match(worker, /loyaltyAccount\.findUnique\(\{ where: \{ id: candidate\.accountId \} \}\)/);
  assert.doesNotMatch(worker, /loyaltyAccount\.findUnique\([^\n]*program: false/);
});

test('run2 return report scopes by explicit branch warehouse IDs because return models have warehouseId only', () => {
  assert.match(worker, /const branchWarehouseIds = branchWarehouses\.map\(\(row\) => row\.id\)/);
  assert.match(worker, /saleReturn\.findMany\(\{ where: \{ warehouseId: \{ in: branchWarehouseIds \}/);
  assert.match(worker, /purchaseReturn\.findMany\(\{ where: \{ warehouseId: \{ in: branchWarehouseIds \}/);
  assert.doesNotMatch(worker, /saleReturn\.findMany\(\{ where: \{ warehouse:/);
  assert.doesNotMatch(worker, /purchaseReturn\.findMany\(\{ where: \{ warehouse:/);
});
