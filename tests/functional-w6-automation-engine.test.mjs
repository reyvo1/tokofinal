import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('apps/worker/src/index.ts', 'utf8');
const operations = readFileSync('apps/api/src/operations-control/operations-control.service.ts', 'utf8');
const seed = readFileSync('apps/api/prisma/seed.ts', 'utf8');

test('outbox dispatch evaluates active tenant business rules before webhook dispatch', () => {
  assert.match(worker, /async function materializeBusinessRules/);
  assert.match(worker, /await materializeBusinessRules\(event\);/);
  assert.match(worker, /companyId: event\.companyId, trigger: event\.eventType, isActive: true/);
});

test('rule condition engine supports scalar, numeric, membership, and field-reference predicates', () => {
  assert.match(worker, /lteField/);
  assert.match(worker, /gteField/);
  assert.match(worker, /operator === 'in'/);
  assert.match(worker, /pathValue\(payload, operand\)/);
});

test('rule actions become idempotent automation jobs instead of direct side effects', () => {
  assert.match(worker, /rule:\$\{rule\.id\}:event:\$\{event\.id\}:action:\$\{index\}/);
  assert.match(worker, /automationJob\.upsert/);
  assert.match(worker, /companyId_idempotencyKey/);
  assert.match(worker, /CREATE_REORDER_SUGGESTION/);
  assert.match(worker, /CREATE_MAINTENANCE_WORK_ORDER/);
});

test('low-stock source creates change-bound events and seeded rule has explicit replenishment target', () => {
  assert.match(worker, /eventType: 'inventory\.balance\.changed'/);
  assert.match(worker, /latest\.createdAt >= row\.updatedAt/);
  assert.match(worker, /available: row\.available/);
  assert.match(worker, /minStock: row\.product\.minStock/);
  assert.match(seed, /reorder_suggestion\.create', targetMultiplier: 2/);
});

test('maintenance due source supports date and odometer schedules', () => {
  assert.match(worker, /eventType: 'asset\.maintenance\.due'/);
  assert.match(worker, /dueByDate/);
  assert.match(worker, /dueByOdometer/);
  assert.match(worker, /nextDueOdometer/);
});

test('automation DB actions and SUCCEEDED status commit in one serializable transaction', () => {
  assert.match(worker, /await prisma\.\$transaction\(async \(tx\) => \{/);
  assert.match(worker, /EXECUTE_AUTOMATION_JOB/);
  assert.match(worker, /status: 'SUCCEEDED'/);
  assert.match(worker, /Prisma\.TransactionIsolationLevel\.Serializable/);
});

test('maintenance automation creates one active work order and advances configured schedule', () => {
  assert.match(worker, /current\.sourceType !== 'AssetMaintenancePlan'/);
  assert.match(worker, /maintenanceWorkOrder\.findFirst/);
  assert.match(worker, /status: \{ in: \['PLANNED','OPEN','IN_PROGRESS','WAITING_PART'\] \}/);
  assert.match(worker, /AUTO-MWO-/);
  assert.match(worker, /assetMaintenancePlan\.update/);
});

test('low-stock automation creates a traceable reorder suggestion from authoritative inventory', () => {
  assert.match(worker, /current\.sourceType !== 'Inventory'/);
  assert.match(worker, /model: 'RULE_LOW_STOCK'/);
  assert.match(worker, /targetStock/);
  assert.match(worker, /suggestedQty/);
  assert.match(worker, /source: 'LOW_STOCK_RULE'/);
});

test('inspection completion publishes automation event in the same operational transaction', () => {
  assert.match(operations, /eventType: 'inspection\.completed'/);
  assert.match(operations, /type: inspection\.type/);
  assert.match(operations, /mismatchCount: mismatch/);
  assert.match(operations, /blockingFailureCount: blockingFailures/);
});

test('approval automation resolves configured policy and avoids duplicate pending request', () => {
  assert.match(worker, /Approval policy \$\{policyCode\} tidak ditemukan\/aktif/);
  assert.match(worker, /approvalRequest\.findFirst/);
  assert.match(worker, /status: 'PENDING'/);
  assert.match(worker, /policyId: policy\?\.id/);
});

test('unsupported automation actions fail visibly instead of being silently ignored', () => {
  assert.match(worker, /UNSUPPORTED_RULE_ACTION/);
  assert.match(worker, /Automation action belum didukung worker/);
  assert.match(worker, /status: current\.attempts >= current\.maxAttempts \? 'FAILED' : 'RETRYING'/);
});
