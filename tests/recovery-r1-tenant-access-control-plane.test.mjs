import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(file)=>fs.readFileSync(file,'utf8');
const schema=read('apps/api/prisma/schema.prisma');
const sqlite=read('apps/api/prisma/schema.sqlite.prisma');
const postgres=read('apps/api/prisma/schema.postgresql.prisma');
const authService=read('apps/api/src/auth/auth.service.ts');
const guard=read('apps/api/src/auth/jwt-auth.guard.ts');
const authController=read('apps/api/src/auth/auth.controller.ts');
const platformController=read('apps/api/src/platform/platform.controller.ts');
const platformService=read('apps/api/src/platform/platform.service.ts');
const page=read('apps/admin/app/page.tsx');
const shell=read('apps/admin/app/app-shell.tsx');
const domains=read('apps/admin/app/domain-workspaces.ts');
const org=read('apps/admin/app/modules/organization-admin.tsx');
const access=read('apps/admin/app/modules/access-control.tsx');
const control=read('apps/admin/app/modules/platform-control.tsx');
const pkg=JSON.parse(read('package.json'));
const order=JSON.parse(read('config/expand-migration-order.json'));
const recovery=JSON.parse(read('config/recovery-finding-matrix.json'));

for(const [name,text] of [['canonical',schema],['sqlite',sqlite],['postgres',postgres]]){
  test(`R1 ${name} AuthSession preserves active branch context`,()=>{
    assert.match(text,/model AuthSession \{[\s\S]*activeBranchId\s+String\?/);
    assert.match(text,/@@index\(\[activeBranchId, revokedAt, expiresAt\]\)/);
  });
}

test('R1 branch switch is session-scoped, same-company and permission-gated',()=>{
  assert.match(authController,/@Permissions\('branch\.switch'\)[\s\S]*@Post\('branch-context'\)/);
  assert.match(authService,/companyId: user\.companyId, isActive: true/);
  assert.match(authService,/authSession\.updateMany\([\s\S]*activeBranchId: target\.id/);
  assert.doesNotMatch(authService,/switchBranchContext[\s\S]{0,2500}user\.update\(/);
  assert.match(guard,/session\?\.activeBranchId \?\? persistedUser\.branchId/);
  assert.match(guard,/companyId: homeCompanyId, isActive: true/);
});

test('R1 current tenant profile is operator-manageable without arbitrary company provisioning',()=>{
  assert.match(platformController,/@Permissions\('platform\.configure'\) @Get\('tenant'\)/);
  assert.match(platformController,/@Permissions\('platform\.configure'\) @Patch\('tenant'\)/);
  assert.match(platformService,/provisioningMode: 'BOOTSTRAP_ONLY'/);
  assert.match(platformService,/UPDATE_TENANT_PROFILE/);
  assert.doesNotMatch(platformController,/@Post\('tenant'\)/);
  assert.match(org,/\/platform\/tenant/);
  assert.match(org,/\/master-data\/branches/);
});

test('R1 Admin exposes branch switch, complete access control and control-plane surfaces',()=>{
  assert.match(shell,/Ganti cabang aktif/);
  assert.match(page,/onBranchChange=\{\(branchId\) => void switchBranch\(branchId\)\}/);
  assert.match(page,/AccessControlView/);
  assert.match(page,/PlatformControlView/);
  for(const key of ['System Settings','Custom Fields','Approval Control','Webhooks','UI Runtime','Audit & Ops']) assert.match(domains,new RegExp(key));
  for(const route of ['/users/permissions','/users/roles','/platform/settings','/platform/custom-fields','/platform/webhooks','/platform/approval-policies','/platform/audit-logs','/platform/outbox','/platform/ui-schemas','/platform/ops-health']){
    assert.ok(`${access}\n${control}`.includes(route),`UI harus memakai ${route}`);
  }
});

test('R1 sensitive control-plane routes are explicitly permissioned',()=>{
  for(const permission of ['platform.configure','custom_field.manage','webhook.manage','approval.manage','audit.view','ui_schema.manage']) assert.match(platformController,new RegExp(`Permissions\\('${permission.replace('.','\\.')}\\'`));
  assert.match(platformController,/@Roles\('SUPER_ADMIN','OWNER','ADMIN'\) @Permissions\('platform\.configure'\) @Post\('outbox\/:id\/replay'\)/);
});

test('R1 expand migration is provider-parity and ordered after F11',()=>{
  const sq=read('database/migrations/T360-20260924-r1-session-branch-context/sqlite-expand.sql');
  const pg=read('database/migrations/T360-20260924-r1-session-branch-context/postgresql-expand.sql');
  assert.match(sq,/ADD COLUMN "activeBranchId" TEXT/);
  assert.match(pg,/ADD COLUMN IF NOT EXISTS "activeBranchId" TEXT/);
  const r1Index=order.migrations.indexOf('T360-20260924-r1-session-branch-context');
  const f11Index=order.migrations.indexOf('T360-20260923-f11-transaction-uom');
  assert.ok(r1Index>f11Index,'R1 migration must remain ordered after F11');
});


test('R1 branch deactivation cannot invalidate current context or strand active users',()=>{
  const master=read('apps/api/src/master-data/master-data.service.ts');
  assert.match(master,/id === scope\.branchId[\s\S]*Cabang aktif saat ini tidak dapat dinonaktifkan/);
  assert.match(master,/user\.count\(\{ where: \{ branchId: id, isActive: true \} \}\)/);
  assert.match(master,/Cabang masih memiliki user aktif/);
});

test('R1 GitHub runtime probe is mandatory in both full workflows and aggregate evidence',()=>{
  assert.equal(pkg.scripts['ci:r1:probe'],'node scripts/ci-r1-tenant-access-probe.mjs');
  const probe=read('scripts/ci-r1-tenant-access-probe.mjs');
  assert.match(probe,/foreignBranchDenied:true/);
  assert.match(probe,/foreignCompanyDenied:true/);
  assert.match(probe,/\/auth\/branch-context/);
  for(const wf of ['.github/workflows/full-system-simulation.yml','.github/workflows/toko360-full-uat.yml']){
    const text=read(wf);assert.match(text,/id: r1_tenant_access/);assert.match(text,/npm run ci:r1:probe/);
  }
  const summary=read('scripts/ci-write-full-system-summary.mjs');
  assert.match(summary,/r1TenantAccess/);
  assert.match(summary,/T360_CI_STEP_R1_TENANT_ACCESS/);
});

test('R1 recovery findings remain mapped and no finding is falsely runtime-closed before GitHub evidence',()=>{
  const rows=recovery.findings.filter((row)=>['F07','F08','F09','F10'].includes(row.id));
  assert.equal(rows.length,4);
  for(const row of rows){assert.equal(row.primaryWave,'R1');assert.equal(row.runtimeEvidenceRequired,true);assert.notEqual(row.status,'CLOSED');}
});


test('R1 GitHub evidence harness follows current Admin navigation and normalizes Swagger global prefix',()=>{
  const browser=read('scripts/browser-uat.mjs');
  const sweep=read('scripts/ci-runtime-api-sweep.mjs');
  assert.match(browser,/aside\[aria-label=.*Navigasi Admin.*\] \.navItem/);
  assert.match(browser,/navigateAdminContext\(cdp, '\/operations-control\/delivery'/);
  assert.match(browser,/navigateAdminContext\(cdp, '\/people\/payroll'/);
  assert.match(browser,/navigateAdminContext\(cdp, '\/people\/employees'/);
  assert.match(browser,/navigateAdminContext\(cdp, '\/integrations\/notifications'/);
  assert.doesNotMatch(browser,/textContent\?\.trim\(\)===['\"]Employees['\"]/);
  assert.doesNotMatch(browser,/Aset & Fleet/);
  assert.match(sweep,/function runtimePath\(route\)/);
  assert.match(sweep,/pathname\.startsWith\(`\$\{apiPath\}\/`\)/);
  assert.match(sweep,/const pathname=runtimePath\(op\.route\); const url=`\$\{api\}\$\{pathname\}`/);
});

test('R1 manual Full UAT configures deterministic CI secret encryption key for provider simulation',()=>{
  const workflow=read('.github/workflows/toko360-full-uat.yml');
  assert.match(workflow,/SECRET_MASTER_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/);
  assert.match(workflow,/npm run ci:provider:probe/);
});
