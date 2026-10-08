import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schemas = ['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma'].map((name) => readFileSync(`apps/api/prisma/${name}`, 'utf8'));
const reportsController = readFileSync('apps/api/src/reports/reports.controller.ts', 'utf8');
const reportsService = readFileSync('apps/api/src/reports/reports.service.ts', 'utf8');
const platformController = readFileSync('apps/api/src/platform/platform.controller.ts', 'utf8');
const platformService = readFileSync('apps/api/src/platform/platform.service.ts', 'utf8');
const worker = readFileSync('apps/worker/src/index.ts', 'utf8');
const admin = readFileSync('apps/admin/app/modules/automation-workspace.tsx', 'utf8');
const domains = readFileSync('apps/admin/app/domain-workspaces.ts', 'utf8');

for (const [index, schema] of schemas.entries()) {
  test(`F8 report schedule schema parity profile ${index + 1}`, () => {
    assert.match(schema, /model ReportSchedule \{/);
    assert.match(schema, /frequency\s+String/);
    assert.match(schema, /localTime\s+String/);
    assert.match(schema, /timezone\s+String/);
    assert.match(schema, /nextRunAt\s+DateTime/);
    assert.match(schema, /scheduleId\s+String\?/);
    assert.match(schema, /@@unique\(\[scheduleId, scheduledFor\]\)/);
  });
}

test('F8 scheduled report API is branch scoped and uses validated canonical ReportJob', () => {
  assert.match(reportsController, /@Get\('schedules'\)/);
  assert.match(reportsController, /@Post\('schedules'\)/);
  assert.match(reportsController, /@Patch\('schedules\/:id'\)/);
  assert.match(reportsController, /@Post\('schedules\/:id\/run-now'\)/);
  assert.match(reportsService, /where: \{ companyId: scope\.companyId, branchId: scope\.branchId \}/);
  assert.match(reportsService, /validateReportFilters\(scope, dto\.reportType, dto\.filters\)/);
  assert.match(reportsService, /company\.timezone/);
  assert.match(reportsService, /nextScheduledReportRun/);
  assert.match(reportsService, /scheduleId: schedule\.id, scheduledFor: now/);
});

test('F8 worker atomically materializes due schedules into idempotent report jobs', () => {
  assert.match(worker, /async function processReportSchedules/);
  assert.match(worker, /where: \{ isActive: true, nextRunAt: \{ lte: now \} \}/);
  assert.match(worker, /nextReportScheduleRun/);
  assert.match(worker, /updateMany\([\s\S]*nextRunAt: scheduledFor/);
  assert.match(worker, /scheduleId: current\.id, scheduledFor/);
  assert.match(worker, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(worker, /await processReportSchedules\(\);[\s\S]*await processReportJobs\(\);/);
});

test('F8 report job completion feeds schedule health without duplicating export engine', () => {
  assert.match(worker, /if \(job\.scheduleId\) await tx\.reportSchedule\.updateMany/);
  assert.match(worker, /lastError: message/);
  assert.match(worker, /buildReportCsv\(job\)/);
  assert.match(worker, /renderReportOutput\(csv, job\.format, job\.reportType\)/);
});

test('F8 business rule lifecycle validates actions and exposes execution history controls', () => {
  assert.match(platformController, /@Patch\('business-rules\/:id'\)/);
  assert.match(platformController, /@Get\('automation-jobs'\)/);
  assert.match(platformController, /@Post\('automation-jobs\/:id\/cancel'\)/);
  assert.match(platformController, /@Post\('automation-jobs\/:id\/replay'\)/);
  assert.match(platformService, /validateBusinessRuleDefinition/);
  assert.match(platformService, /UPDATE_BUSINESS_RULE/);
  assert.match(platformService, /CANCEL_AUTOMATION_JOB/);
  assert.match(platformService, /Hanya automation job PENDING\/RETRYING/);
  assert.match(platformService, /Hanya automation job FAILED\/CANCELLED/);
});

test('F8 business rules can enqueue canonical asynchronous reports', () => {
  assert.match(worker, /type === 'report\.enqueue'/);
  assert.match(worker, /return 'CREATE_REPORT_JOB'/);
  assert.match(worker, /current\.actionType === 'CREATE_REPORT_JOB'/);
  assert.match(worker, /tx\.reportJob\.create/);
  assert.match(platformService, /report\.enqueue wajib memiliki reportType/);
});

test('F8 Admin exposes rule management, execution history and report schedules', () => {
  assert.match(domains, /key: 'automation'/);
  assert.match(admin, /Business rule baru/);
  assert.match(admin, /Automation jobs/);
  assert.match(admin, /Scheduled reports/);
  assert.match(admin, /\/platform\/automation-jobs/);
  assert.match(admin, /\/reports\/schedules/);
  assert.match(admin, /Jalankan sekarang/);
});

test('F8 migration is expand-only for SQLite and PostgreSQL', () => {
  const sqlite = readFileSync('database/migrations/T360-20260923-f8-report-schedule/sqlite-expand.sql', 'utf8');
  const postgres = readFileSync('database/migrations/T360-20260923-f8-report-schedule/postgresql-expand.sql', 'utf8');
  for (const sql of [sqlite, postgres]) {
    assert.match(sql, /ReportSchedule/);
    assert.match(sql, /ReportJob/);
    assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  }
});
