import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

const packageJson = JSON.parse(read('package.json'));
const numbering = read('apps/api/src/common/numbering.ts');
const businessTime = read('apps/api/src/common/business-time.ts');
const reports = read('apps/api/src/reports/reports.service.ts');
const digest = read('apps/api/src/reports/daily-digest.service.ts');
const multiOutlet = read('apps/api/src/reports/multi-outlet.service.ts');
const cashierTarget = read('apps/api/src/sales/cashier-target.service.ts');
const stockAlert = read('apps/api/src/sales/stock-alert.service.ts');
const extensions = read('apps/api/src/extensions/extensions.service.ts');
const mobileOps = read('apps/api/src/mobile-ops/mobile-ops.service.ts');
const mobileController = read('apps/api/src/mobile-ops/mobile-ops.controller.ts');
const stockCount = read('apps/pos/public/stock-count/app.js');
const stockCountHtml = read('apps/pos/public/stock-count/index.html');
const platformControl = read('apps/admin/app/modules/platform-control.tsx');
const accessControl = read('apps/admin/app/modules/access-control.tsx');
const hr = read('apps/api/src/hr/hr.service.ts');
const attendance = read('apps/api/src/attendance/attendance.service.ts');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const accounting = read('apps/api/src/accounting-core/accounting-core.service.ts');
const branchSyncDto = read('apps/api/src/branch-sync/dto/branch-sync.dto.ts');
const reorderForecast = read('apps/api/src/advanced-inventory/reorder-forecast.ts');
const advancedInventory = read('apps/api/src/advanced-inventory/advanced-inventory.service.ts');
const storefront = read('apps/storefront/app/page.tsx');
const apiKeys = read('apps/admin/app/modules/api-keys.tsx');


test('pre-GitHub local gate generates Prisma before runtime-backed regression without mutating DB', () => {
  const preflight = packageJson.scripts['ci:preflight:local'];
  assert.match(preflight, /db:local:generate/);
  assert.match(preflight, /test:dependency-free/);
  assert.ok(preflight.indexOf('db:local:generate') < preflight.indexOf('test:dependency-free'));
  assert.doesNotMatch(preflight, /db:local:push|db:local:seed/);
});

test('business date utilities are timezone-aware and document numbering uses company timezone', () => {
  assert.match(businessTime, /Intl\.DateTimeFormat\('en-CA',[\s\S]*timeZone/);
  assert.match(businessTime, /parseBusinessDateBoundary/);
  assert.match(numbering, /select: \{ timezone: true \}/);
  assert.match(numbering, /zonedDateParts\(observedAt, company\.timezone\)/);
  assert.match(numbering, /zonedDateParts\(row\.lastResetAt, company\.timezone\)/);
  assert.match(numbering, /lastResetAt: observedAt/);
});

test('finance/report day boundaries use company timezone rather than process-local midnight', () => {
  assert.match(reports, /businessDayBounds/);
  assert.match(reports, /businessMonthStart/);
  assert.match(reports, /parseBusinessDateBoundary/);
  assert.match(digest, /businessDateKey/);
  assert.match(extensions, /companyTimeZone/);
  assert.match(extensions, /parseBusinessDateBoundary\(dto\.startDate/);
  assert.match(extensions, /zonedLocalToUtc/);
  assert.match(extensions, /createdAt: \{ gte: rangeStart, lt: nextDate \}/);
  assert.doesNotMatch(extensions, /function boundaryDate\(/);
  assert.match(accounting, /taxDateRange\(companyId/);
  assert.match(accounting, /parseBusinessDateBoundary/);
  assert.doesNotMatch(accounting, /T00:00:00\.000Z|T23:59:59\.999Z/);
  assert.match(finance, /parseAsOf\(companyId/);
  assert.match(finance, /parseBusinessDateBoundary/);
  assert.doesNotMatch(finance, /T23:59:59\.999Z/);
});

test('low-stock decisions use product configuration and verified notification bindings', () => {
  assert.match(multiOutlet, /minStock/);
  assert.doesNotMatch(multiOutlet, /available\s*<=\s*5/);
  assert.match(stockAlert, /recipientBindingIds/);
  assert.match(stockAlert, /employeeChannelBinding\.findMany/);
  assert.doesNotMatch(stockAlert, /config\.recipients/);
});

test('cashier targets are branch-scoped and restricted to active cashiers', () => {
  assert.match(cashierTarget, /branchId: scope\.branchId/);
  assert.match(cashierTarget, /roles:[\s\S]*role:[\s\S]*name: 'CASHIER'/);
  assert.match(cashierTarget, /businessDayBounds/);
  assert.match(cashierTarget, /companyId: scope\.companyId/);
});

test('mobile stock count resolves alternate barcode quantity factors and refuses ambiguous tracked batches', () => {
  assert.match(mobileOps, /productBarcode\.findFirst/);
  assert.match(mobileOps, /quantityFactor/);
  assert.match(mobileOps, /Number\.isSafeInteger/);
  assert.match(mobileOps, /memiliki beberapa batch/i);
  assert.match(mobileOps, /existing\.employeeId !== user\.sub/);
  assert.match(mobileOps, /draft OPEN milik operator lain/);
  assert.match(mobileController, /cursor/);
  assert.match(mobileController, /limit/);
});

test('stock-count PWA never uses native confirm and never converts authoritative load failure into empty lines', () => {
  assert.doesNotMatch(stockCount, /\bconfirm\s*\(/);
  assert.match(stockCountHtml, /id="submit-confirm"/);
  assert.match(stockCount, /showModal\(\)/);
  assert.match(stockCount, /Gagal memuat isi draft/);
  assert.match(stockCount, /throw error/);
});

test('optional Admin reads degrade authorization only; server/network failures remain visible', () => {
  for (const source of [platformControl, accessControl]) {
    assert.match(source, /HTTP \$\{response\.status\}/);
    assert.match(source, /optionalAuthorization/);
    assert.match(source, /\\b\(401\|403\)\\b/);
    assert.match(source, /throw error/);
  }
  assert.doesNotMatch(platformControl, /\.catch\(\(\)=>\[\]\)/);
  assert.doesNotMatch(accessControl, /\.catch\(\(\)=>null\)/);
});

test('raw status query filters reject invalid enum values before Prisma', () => {
  assert.match(hr, /validatedHrRequestStatus/);
  assert.match(hr, /Status pengajuan HR tidak valid/);
  assert.match(attendance, /validatedCorrectionStatus/);
  assert.match(attendance, /Status koreksi absensi tidak valid/);
  assert.match(finance, /validatedFinanceStatus/);
  assert.match(finance, /Status transaksi keuangan tidak valid/);
  assert.doesNotMatch(hr, /\.\.\.\(status \? \{ status: status as never \}/);
  assert.doesNotMatch(attendance, /\.\.\.\(status \? \{ status: status as never \}/);
  assert.doesNotMatch(finance, /\.\.\.\(status \? \{ status: status as never \}/);
});


test('branch-sync literal choices use IsIn rather than passing arrays to IsEnum', () => {
  assert.doesNotMatch(branchSyncDto, /@IsEnum\(\[/);
  assert.match(branchSyncDto, /@IsIn\(\['CENTRAL', 'BRANCH'\]\)/);
  assert.match(branchSyncDto, /@IsIn\(\['PUSH', 'PULL', 'BIDIRECTIONAL'\]\)/);
  assert.match(branchSyncDto, /@IsIn\(\['KEEP_LOCAL', 'KEEP_REMOTE', 'MANUAL_REVIEW'\]\)/);
});

test('attendance logical workDate follows company timezone while preserving DATE-like UTC storage', () => {
  assert.match(attendance, /businessDateKey\(occurredAt, timeZone\)/);
  assert.match(attendance, /companyTimeZone\(scope\)/);
  assert.match(attendance, /zonedDateParts\(new Date\(\), timeZone\)/);
  assert.match(attendance, /function logicalWorkDate/);
  assert.match(attendance, /Tanggal kerja tidak valid/);
  assert.doesNotMatch(attendance, /occurredAt\.getUTCFullYear\(\)/);
});

test('reorder demand-day buckets use company timezone instead of UTC calendar dates', () => {
  assert.match(reorderForecast, /businessDateKey\(row\.date, input\.timeZone\)/);
  assert.doesNotMatch(reorderForecast, /row\.date\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(advancedInventory, /select: \{ timezone: true \}/);
  assert.match(advancedInventory, /timeZone: company\.timezone/);
});

test('customer logout clears local state but never falsely reports server revocation success', () => {
  assert.doesNotMatch(storefront, /logout[^\n]*\.catch\(\(\) => undefined\)/);
  assert.match(storefront, /if \(!response\.ok\) throw new Error\(`HTTP \$\{response\.status\}`\)/);
  assert.match(storefront, /pencabutan sesi server tidak dapat dipastikan/);
});

test('API key branch bootstrap surfaces request failure instead of pretending the branch list is empty', () => {
  assert.match(apiKeys, /HTTP \$\{r\.status\}/);
  assert.match(apiKeys, /Daftar cabang gagal dimuat:/);
  assert.doesNotMatch(apiKeys, /master-data\/branches'\)\.then\(setBranches\)\.catch\(\(\)=>setBranches\(\[\]\)\)/);
});


test('employee timezone defaults to company configuration instead of a hardcoded region', () => {
  assert.match(hr, /tx\.company\.findUnique\(\{ where: \{ id: scope\.companyId \}, select: \{ timezone: true \} \}\)/);
  assert.match(hr, /timezone: dto\.timezone\?\.trim\(\) \|\| company\.timezone/);
  assert.doesNotMatch(hr, /timezone: dto\.timezone \?\? 'Asia\/Makassar'/);
  const employeeUi = read('apps/admin/app/modules/employee-master.tsx');
  assert.doesNotMatch(employeeUi, /timezone:\s*'Asia\/Makassar'/);
});

test('sync idempotency only suppresses unique races; unrelated persistence failures stay fatal', () => {
  const branchTransfer = read('apps/api/src/branch-continuity/branch-transfer.service.ts');
  const branchSync = read('apps/api/src/branch-sync/branch-sync.service.ts');
  assert.doesNotMatch(extensions, /offlineTransaction\.findMany\([\s\S]{0,350}\.catch\(\(\) => \[\]\)/);
  assert.match(branchTransfer, /syncOutbox\.create\([\s\S]{0,700}code\?: string[\s\S]{0,120}P2002[\s\S]{0,100}throw error/);
  assert.match(branchSync, /syncConflict\.create\([\s\S]{0,550}P2002[\s\S]{0,100}throw error/);
  assert.match(branchSync, /syncCursor\.upsert\([\s\S]{0,260}nodeId_peerNodeId/);
  assert.match(branchSync, /syncInbox\.create\([\s\S]{0,500}P2002[\s\S]{0,100}throw error/);
});

test('all report date-only validation uses company-timezone boundaries and has no dangling parseDate call', () => {
  assert.doesNotMatch(reports, /parseDate\(/);
  assert.match(reports, /balanceSheet[\s\S]{0,700}companyTimeZone\(scope\.companyId\)[\s\S]{0,300}parseBusinessDateBoundary\(asOfValue/);
  assert.match(reports, /financialIntegrity[\s\S]{0,500}companyTimeZone\(scope\.companyId\)[\s\S]{0,300}parseBusinessDateBoundary\(asOfValue/);
  assert.match(reports, /validateReportFilters[\s\S]{0,450}companyTimeZone\(scope\.companyId\)[\s\S]{0,550}parseBusinessDateBoundary\(value/);
});
