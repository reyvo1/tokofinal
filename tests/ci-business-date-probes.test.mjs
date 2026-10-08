import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { businessDateKeyInTimeZone, companyTimeZoneFromBranchContext } from '../scripts/lib/business-date-key.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('business-date helper follows company timezone across UTC day boundary', () => {
  const instant = new Date('2026-10-04T16:22:35.000Z');
  assert.equal(businessDateKeyInTimeZone(instant, 'UTC'), '2026-10-04');
  assert.equal(businessDateKeyInTimeZone(instant, 'Asia/Makassar'), '2026-10-05');
});

test('branch context timezone is mandatory and validated', () => {
  assert.equal(companyTimeZoneFromBranchContext({ company: { timezone: 'Asia/Makassar' } }), 'Asia/Makassar');
  assert.throws(() => companyTimeZoneFromBranchContext({ company: {} }), /company\.timezone/);
  assert.throws(() => companyTimeZoneFromBranchContext({ company: { timezone: 'Mars\/Olympus' } }), /tidak valid/);
});

test('runtime probes that mean today use live company timezone rather than UTC date slicing', () => {
  const probes = [
    'scripts/ci-r2-hr-payroll-probe.mjs',
    'scripts/ci-r4-core-business-probe.mjs',
    'scripts/ci-r5-assets-fleet-probe.mjs',
    'scripts/ci-r6-scale-ai-probe.mjs',
    'scripts/ci-p3-productization-probe.mjs',
  ];
  for (const file of probes) {
    const source = read(file);
    assert.match(source, /companyTimeZoneFromBranchContext/);
    assert.match(source, /businessDateKeyInTimeZone/);
    assert.match(source, /auth\/branch-context/);
    assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  }
});

test('R6 materialization diagnostics expose timezone and source aggregate counts without weakening nonzero assertions', () => {
  const source = read('scripts/ci-r6-scale-ai-probe.mjs');
  assert.match(source, /materialized\.salesChannels < 1/);
  assert.match(source, /materialized\.financeAccounts < 1/);
  assert.match(source, /timezone=\$\{companyTimeZone\}/);
  assert.match(source, /sourceSales=\$\{materialized\.sourceSales\}/);
  assert.match(source, /sourceJournalLines=\$\{materialized\.sourceJournalLines\}/);
});

test('R8 remains fail-closed on real R6 evidence and never synthesizes a fallback', () => {
  const source = read('scripts/ci-r8-release-evidence-probe.mjs');
  assert.match(source, /r6:read\('handoff\/quality\/github-r6-scale-ai-probe-latest\.json'\)/);
  assert.match(source, /evidence\[id\]\?\.status!=='PASS'/);
  assert.doesNotMatch(source, /R6_FALLBACK|syntheticR6|status:\s*'PASS'.*r6/s);
});
test('R5 asset and fleet date-only inputs use company timezone instead of UTC parsing', () => {
  const fleetService = read('apps/api/src/fleet/fleet.service.ts');
  const assetService = read('apps/api/src/assets/assets.service.ts');
  for (const source of [fleetService, assetService]) {
    assert.match(source, /parseBusinessDateBoundary/);
    assert.match(source, /select: \{ timezone: true \}/);
    assert.doesNotMatch(source, /private parseBusinessDate[\s\S]{0,400}?new Date\(value\)/);
  }
  assert.match(fleetService, /this\.parseBusinessDate\(dto\.effectiveFrom, timeZone\)/);
  assert.match(fleetService, /this\.parseBusinessDate\(dto\.effectiveTo, timeZone, true\)/);
  assert.match(fleetService, /this\.parseBusinessDate\(dto\.transactionDate, timeZone\)/);
  assert.match(assetService, /this\.parseBusinessDate\(dto\.periodEnd, timeZone, true\)/);
});
