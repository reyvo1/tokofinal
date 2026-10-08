import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const controller = read('apps/api/src/users/users.controller.ts');
const service = read('apps/api/src/users/users.service.ts');
const dto = read('apps/api/src/users/dto/create-user.dto.ts');
const guard = read('apps/api/src/auth/jwt-auth.guard.ts');
const auth = read('apps/api/src/auth/auth.service.ts');

test('user administration endpoints receive authenticated user context', () => {
  for (const method of ['list', 'roles', 'permissions', 'createRole', 'setRolePermissions', 'setUserRoles', 'setUserStatus', 'create']) {
    assert.match(controller, new RegExp(`${method}\\([^;]*@CurrentUser\\(\\) user: AuthUser`, 's'));
  }
  assert.match(controller, /@Permissions\('user\.manage'\)[\s\S]*@Post\(\)[\s\S]*create\(/);
});

test('user reads and mutations are scoped to token company and branch', () => {
  assert.match(service, /private requireTenantScope\(user: AuthUser\): TenantScope/);
  assert.match(service, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(service, /where: \{ branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \} \}/g);
  assert.match(service, /branchId: scope\.branchId/g);
  assert.doesNotMatch(service, /branchId:\s*dto\.branchId/);
});

test('cross-tenant users and branch overrides are rejected and audited', () => {
  assert.match(service, /assertRequestedBranch\(/);
  assert.match(service, /requestedBranchId && requestedBranchId !== scope\.branchId/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(service, /client\.user\.findUnique\(\{ where: \{ id: userId \}/);
  assert.match(service, /return this\.denyTenantAccess\(client, actor, scope, 'User', userId\)/);
});

test('global role and permission mutations require super admin', () => {
  assert.match(controller, /@Roles\('SUPER_ADMIN'\)[\s\S]*@Post\('roles'\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN'\)[\s\S]*@Patch\('roles\/:id\/permissions'\)/);
  assert.match(service, /private async requireSuperAdmin/);
  assert.match(service, /Katalog role dan permission global hanya dapat diubah oleh SUPER_ADMIN/);
  assert.match(service, /action: 'ACCESS_CONTROL_DENIED'/);
});

test('tenant administrators cannot assign protected roles or modify protected accounts', () => {
  assert.match(service, /const protectedRoles = new Set\(\['SUPER_ADMIN', 'OWNER'\]\)/);
  assert.match(service, /normalized\.some\(\(name\) => protectedRoles\.has\(name\)\)/);
  assert.match(service, /targetRoleNames\.some\(\(name\) => protectedRoles\.has\(name\)\)/);
  assert.match(service, /Role SUPER_ADMIN dan OWNER hanya dapat diberikan oleh SUPER_ADMIN/);
  assert.match(service, /Akun dengan role SUPER_ADMIN atau OWNER hanya dapat diubah oleh SUPER_ADMIN/);
});

test('self role and status changes are blocked to prevent administrative lockout', () => {
  assert.match(service, /if \(target\.id === actor\.sub\)/);
  assert.match(service, /Role atau status akun sendiri tidak dapat diubah dari endpoint administrasi/);
});

test('user and role mutations emit structured audit evidence', () => {
  for (const action of ['CREATE_USER', 'CREATE_ROLE', 'SET_ROLE_PERMISSIONS', 'SET_USER_ROLES', 'SET_USER_STATUS']) {
    assert.match(service, new RegExp(`'${action}'`));
  }
  assert.match(service, /companyId: scope\.companyId/);
  assert.match(service, /userId: user\.sub/);
  assert.match(service, /branchId: scope\.branchId/);
});

test('legacy create-user branch field is compatibility-only', () => {
  assert.match(dto, /Kompatibilitas lama; branch tetap berasal dari token\./);
  assert.match(dto, /branchId\?: string/);
  assert.doesNotMatch(dto, /branchId!:\s*string/);
});

test('JWT guard reloads active user branch roles and permissions from database', () => {
  assert.match(guard, /private readonly prisma: PrismaService/);
  assert.match(guard, /this\.prisma\.user\.findUnique/);
  assert.match(guard, /!persistedUser \|\| !persistedUser\.isActive/);
  assert.match(guard, /persistedUser\.branchId && \(!persistedUser\.branch \|\| !persistedUser\.branch\.isActive\)/);
  assert.match(guard, /const homeCompanyId = persistedUser\.branch\?\.companyId \?\? null/);
  assert.match(guard, /const activeBranchId = session\?\.activeBranchId \?\? persistedUser\.branchId/);
  assert.match(guard, /where: \{ id: activeBranchId, companyId: homeCompanyId, isActive: true \}/);
  assert.match(guard, /companyId: homeCompanyId/);
  assert.match(guard, /branchId: activeBranch\?\.id \?\? null/);
  assert.match(guard, /roles = persistedUser\.roles\.map/);
  assert.match(guard, /permissions = \[\.\.\.new Set/);
  assert.doesNotMatch(guard, /request\.user = await this\.jwt\.verifyAsync<AuthUser>\(token\)/);
});

test('login rejects inactive branch and records tenant-aware audit', () => {
  assert.match(auth, /branch: \{ select: \{ companyId: true, isActive: true \} \}/);
  assert.match(auth, /user\.branchId && \(!user\.branch \|\| !user\.branch\.isActive\)/);
  assert.match(auth, /companyId: user\.branch\?\.companyId/);
  assert.match(auth, /payload: \{ branchId: user\.branchId \}/);
  assert.match(auth, /entityType: 'AuthSession'/);
});
