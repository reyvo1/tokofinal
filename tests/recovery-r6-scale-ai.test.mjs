import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('R6 F26 exposes deterministic capability truth instead of overstating AI provider capability', () => {
  const service = read('apps/api/src/extensions/extensions.service.ts');
  const ui = read('apps/admin/app/modules/ai-workspace.tsx');
  const nav = read('apps/admin/app/navigation.ts');
  assert.match(service, /capabilityType: 'DETERMINISTIC_RULE_BASED'/);
  assert.match(service, /aiProvider: null/);
  assert.match(service, /tidak memakai model AI\/LLM eksternal/);
  assert.match(ui, /DETERMINISTIC ASSISTANT/);
  assert.match(ui, /tanpa LLM/);
  assert.match(nav, /label: 'Forecast & Otomasi'/);
  assert.doesNotMatch(nav, /label: 'AI & Otomasi'/);
});

test('R6 F27 materializes and reads DailySalesSummary and DailyFinanceSummary from canonical source rows', () => {
  const controller = read('apps/api/src/extensions/extensions.controller.ts');
  const service = read('apps/api/src/extensions/extensions.service.ts');
  assert.match(controller, /analytics\/daily-summaries\/materialize/);
  assert.match(controller, /analytics\/daily-summaries/);
  assert.match(service, /dailySalesSummary\.createMany/);
  assert.match(service, /dailyFinanceSummary\.createMany/);
  assert.match(service, /tx\.sale\.findMany/);
  assert.match(service, /tx\.journalLine\.findMany/);
  assert.match(service, /MATERIALIZE_DAILY_SUMMARIES/);
});

test('R6 F28 implements tenant-scoped retention policy and durable local archive lifecycle fail-closed by provider config', () => {
  const dto = read('apps/api/src/extensions/dto/extensions.dto.ts');
  const controller = read('apps/api/src/extensions/extensions.controller.ts');
  const service = read('apps/api/src/extensions/extensions.service.ts');
  assert.match(dto, /AUDIT_LOG','ASSISTANT_INTERACTION','OPERATOR_INSIGHT/);
  assert.match(controller, /retention\/policies/);
  assert.match(controller, /retention\/archive-runs/);
  assert.match(service, /DATA_ARCHIVE_STORAGE_PROVIDER/);
  assert.match(service, /provider !== 'local'/);
  assert.match(service, /dataArchiveRun\.create/);
  assert.match(service, /status: 'COMPLETED'/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(service, /local:\/\/data\/archives/);
});

test('R6 F29 makes ExternalMapping a managed lifecycle and marketplace adapter contract', () => {
  const controller = read('apps/api/src/extensions/extensions.controller.ts');
  const service = read('apps/api/src/extensions/extensions.service.ts');
  assert.match(controller, /integrations\/:id\/mappings/);
  assert.match(controller, /Delete\('integrations\/:id\/mappings\/:mappingId'\)/);
  assert.match(service, /async externalMappings\(/);
  assert.match(service, /async upsertExternalMapping\(/);
  assert.match(service, /async deleteExternalMapping\(/);
  assert.match(service, /entityType: 'MarketplaceOrder'/);
  assert.match(service, /externalMapping\.upsert/);
});

test('R6 recognizes AccountingCloseControl as canonical runtime control already proven by R4', () => {
  const accounting = read('apps/api/src/accounting-core/accounting-core.service.ts');
  const r4 = read('scripts/ci-r4-core-business-probe.mjs');
  assert.match(accounting, /accountingCloseControl\.findFirst/);
  assert.match(accounting, /Accounting close control/);
  assert.match(r4, /Posting tidak diblok oleh AccountingCloseControl/);
  assert.match(r4, /close-controls\/\$\{closeControl\.id\}\/reopen/);
});

test('R6 exact-source PostgreSQL probe is wired into both GitHub workflows and aggregate evidence', () => {
  const full = read('.github/workflows/full-system-simulation.yml');
  const uat = read('.github/workflows/toko360-full-uat.yml');
  const summary = read('scripts/ci-write-full-system-summary.mjs');
  const report = read('scripts/github-uat-report.mjs');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['ci:r6:probe'], 'node scripts/ci-r6-scale-ai-probe.mjs');
  assert.match(full, /DATA_ARCHIVE_STORAGE_PROVIDER: local/);
  assert.match(full, /npm run ci:r6:probe/);
  assert.match(uat, /DATA_ARCHIVE_STORAGE_PROVIDER: local/);
  assert.match(uat, /npm run ci:r6:probe/);
  const probe = read('scripts/ci-r6-scale-ai-probe.mjs');
  assert.match(probe, /path\.resolve\(root, 'apps\/api', archiveRelativePath\)/);
  assert.match(probe, /companyTimeZoneFromBranchContext/);
  assert.match(probe, /businessDateKeyInTimeZone/);
  assert.doesNotMatch(probe, /now\.toISOString\(\)\.slice\(0,\s*10\)/);
  assert.match(summary, /r6ScaleAi/);
  assert.match(report, /R6 scale\/summary\/archive\/capability runtime probe/);
});
