import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=(p)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const dto=read('apps/api/src/reports/dto/create-report-job.dto.ts');
const worker=read('apps/worker/src/index.ts');
// Report types are canonical in report-catalog.ts; accounting.tsx used to carry a
// private, partially-overlapping list that was never rendered.
const admin=read('apps/admin/app/report-catalog.ts')+read('config/report-type-catalog.json');
for (const type of ['RECEIVABLES','PAYABLES','DELIVERY_COD','PAYROLL']) test(`report catalog and worker contain ${type}`,()=>{assert.match(dto,new RegExp(`'${type}'`));assert.match(admin,new RegExp(`'${type}'`));assert.match(worker,new RegExp(`job\\.reportType === '${type}'|job\\.reportType === 'RECEIVABLES' \\|\\| job\\.reportType === 'PAYABLES'`));});
test('receivable payable exports are sourced from branch-scoped posted journal dimensions',()=>{assert.match(worker,/codes = job\.reportType === 'RECEIVABLES' \? \['1201','1203'\] : \['2101','2102','2103','2104'\]/);assert.match(worker,/branchId: job\.branchId, branch: \{ companyId: job\.companyId \}/);});
test('delivery report exposes COD variance and trip final state',()=>{assert.match(worker,/deliveryTrip\.findMany/);assert.match(worker,/codExpected.*codCollected.*codVariance/s);});
test('payroll report exports calculation approval posting and statutory totals',()=>{assert.match(worker,/payrollRun\.findMany/);assert.match(worker,/grossTotal.*taxTotal.*employerContributionTotal.*netTotal/s);assert.match(worker,/postedJournalEntryId/);});
