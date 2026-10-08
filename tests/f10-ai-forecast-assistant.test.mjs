import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const schemas = ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);
const service = read('apps/api/src/extensions/extensions.service.ts');
const controller = read('apps/api/src/extensions/extensions.controller.ts');
const dto = read('apps/api/src/extensions/dto/extensions.dto.ts');
const admin = read('apps/admin/app/modules/ai-workspace.tsx');
const seed = read('apps/api/prisma/seed.ts');

for (const [index, schema] of schemas.entries()) {
  test(`F10 operator insight and assistant history schema parity ${index + 1}`, () => {
    assert.match(schema, /model OperatorInsight \{/);
    assert.match(schema, /model AssistantInteraction \{/);
    assert.match(schema, /@@index\(\[companyId, branchId, status, severity\]\)/);
    assert.match(schema, /@@index\(\[companyId, branchId, userId, createdAt\]\)/);
  });
}

test('F10 forecast stores explainable formula inputs confidence and source evidence', () => {
  assert.match(service, /currentStock: inventory\.available/);
  assert.match(service, /formula: 'target=ceil\(avgDailySales\*\(horizonDays\+leadTimeDays\)\)\+safetyStock; suggested=max\(0,target-available\)'/);
  assert.match(service, /inputs: \{ soldUnits:/);
  assert.match(service, /confidence: Math\.min\(0\.95/);
  assert.match(service, /sources: \[\{ type: 'SaleItem'/);
});

test('F10 assistant is permission-scoped, source-linked and read-only', () => {
  assert.match(service, /this\.hasPermission\(user, 'forecast\.view'\)/);
  assert.match(service, /this\.hasPermission\(user, 'finance\.view'\)/);
  assert.match(service, /this\.hasPermission\(user, 'automation\.manage'\)/);
  assert.match(service, /this\.hasPermission\(user, 'report\.view'\)/);
  assert.match(service, /HUMAN_CONFIRMATION_REQUIRED/);
  assert.match(service, /Assistant deterministik hanya merangkum sumber tenant\/branch yang diizinkan; tidak memakai model AI\/LLM eksternal dan tidak mengeksekusi mutasi bisnis/);
  assert.doesNotMatch(service.slice(service.indexOf('async operatorAssistantQuery'), service.indexOf('async shipments')), /purchaseOrder\.create|journalEntry\.create|inventory\.update/);
});

test('F10 insights are tenant scoped and auditable with human lifecycle', () => {
  assert.match(service, /operatorInsight\.findMany\([\s\S]*companyId: scope\.companyId, branchId: scope\.branchId/);
  assert.match(service, /REFRESH_OPERATOR_INSIGHTS/);
  assert.match(service, /OPERATOR_INSIGHT_\$\{status\}/);
  assert.match(service, /status: 'OPEN'/);
  assert.match(dto, /ACKNOWLEDGED','DISMISSED/);
});

test('F10 API permissions separate forecast read-run and assistant use-manage', () => {
  assert.match(controller, /Get\('forecasts'\)[\s\S]*Permissions\('forecast\.view'\)/);
  assert.match(controller, /Post\('forecasts\/run'\)[\s\S]*Permissions\('forecast\.run'\)/);
  assert.match(controller, /Get\('operator-insights'\)[\s\S]*Permissions\('assistant\.use'\)/);
  assert.match(controller, /Post\('operator-insights\/refresh'\)[\s\S]*Permissions\('assistant\.manage'\)/);
  assert.match(seed, /'assistant\.use','assistant\.manage'/);
});

test('F10 Admin exposes forecast insight assistant and interaction history', () => {
  assert.match(admin, /Explainable stock forecast/);
  assert.match(admin, /Operator insights/);
  assert.match(admin, /Tanya berdasarkan rule & sumber/);
  assert.match(admin, /Interaction history/);
  assert.match(admin, /\/operator-assistant\/query/);
  assert.match(admin, /\/operator-insights\/refresh/);
});

test('F10 expand migrations exist for SQLite and PostgreSQL', () => {
  const sqlite = read('database/migrations/T360-20260923-f10-operator-ai/sqlite-expand.sql');
  const pg = read('database/migrations/T360-20260923-f10-operator-ai/postgresql-expand.sql');
  for (const sql of [sqlite, pg]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "OperatorInsight"/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "AssistantInteraction"/);
  }
});
