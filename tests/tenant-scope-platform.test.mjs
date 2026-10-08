import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const controller = read('apps/api/src/platform/platform.controller.ts');
const service = read('apps/api/src/platform/platform.service.ts');
const dto = read('apps/api/src/platform/dto/platform.dto.ts');
const guard = read('apps/api/src/auth/jwt-auth.guard.ts');
const storefront = read('apps/storefront/app/page.tsx');
const mobile = read('apps/customer-mobile/lib/core/runtime_manifest.dart');

test('platform configuration endpoints receive authenticated tenant context', () => {
  for (const method of [
    'features', 'setFeature', 'settings', 'setSetting', 'customFields', 'createCustomField',
    'setCustomFieldValue', 'integrations', 'createIntegration', 'webhooks', 'createWebhook',
    'rules', 'createRule', 'approvalPolicies', 'createApprovalPolicy', 'approvalRequests',
    'createApprovalRequest', 'decideApproval', 'uiSchemas', 'createUiSchema', 'outbox',
  ]) {
    assert.match(controller, new RegExp(`${method}\\([^;]*user`, 's'));
  }
  assert.match(controller, /@CurrentUser\(\) user: AuthUser/g);
});

test('platform service requires tenant context and audits denied access', () => {
  assert.match(service, /private requireTenantScope\(user: AuthUser\): TenantScope/);
  assert.match(service, /code: 'TENANT_CONTEXT_REQUIRED'/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(service, /assertRequestedScope\(this\.prisma, user, scope/);
});

test('public runtime manifest uses branch code while authenticated manifest uses token tenant', () => {
  assert.match(controller, /@Public\(\) @Get\('manifest'\)/);
  assert.match(controller, /@Query\('branchCode'\) branchCode\?: string/);
  assert.match(service, /resolveManifestTenant\(/);
  assert.match(service, /branchCode\?\.trim\(\)\.toUpperCase\(\)/);
  assert.match(service, /code: 'STOREFRONT_BRANCH_REQUIRED'/);
  assert.match(service, /Runtime manifest publik tidak menerima companyId atau branchId bebas/);
  assert.match(service, /id: scope\.branchId, companyId: scope\.companyId, isActive: true/);
  assert.doesNotMatch(service, /findFirst\(\{ where: \{ \}, orderBy: \{ createdAt: 'asc' \} \}\)/);
});

test('public routes optionally authenticate valid bearer tokens', () => {
  assert.match(guard, /if \(isPublic && !authorization && !apiKey\) return true/);
  assert.match(guard, /tokenUser = await this\.jwt\.verifyAsync<AuthUser>\(token\)/);
  assert.match(guard, /request\.user = \{/);
  assert.match(guard, /throw new UnauthorizedException\('Token tidak valid atau sudah kedaluwarsa\.'\)/);
});

test('feature flags settings and ui schemas preserve global company and current branch hierarchy', () => {
  for (const model of ['featureFlag', 'systemSetting', 'uiSchemaDefinition']) assert.match(service, new RegExp(`this\\.prisma\\.${model}\\.findMany`));
  assert.match(service, /\{ companyId: scope\.companyId, branchId: scope\.branchId, userId: null \}/);
  assert.match(service, /const targetBranchId = dto\.branchId \? scope\.branchId : null/g);
  assert.match(service, /companyId: scope\.companyId, branchId: targetBranchId/);
  assert.doesNotMatch(service, /companyId:\s*dto\.companyId/);
});

test('custom fields integrations webhooks rules and policies are company scoped and audited', () => {
  assert.match(service, /customFieldDefinition\.findMany\(\{ where: \{ companyId: scope\.companyId/);
  assert.match(service, /customFieldDefinition\.findFirst\(\{ where: \{ id: dto\.definitionId, companyId: scope\.companyId/);
  assert.match(service, /integrationConnection\.findMany\(\{[\s\S]*companyId: scope\.companyId[\s\S]*branchId: scope\.branchId/);
  assert.match(service, /webhookEndpoint\.findMany\(\{ where: \{ companyId: scope\.companyId \}/);
  assert.match(service, /businessRule\.findMany\(\{ where: \{ companyId: scope\.companyId \}/);
  assert.match(service, /approvalPolicy\.findMany\(\{ where: \{ companyId: scope\.companyId \}/);
  for (const action of ['CREATE_CUSTOM_FIELD', 'UPSERT_CUSTOM_FIELD_VALUE', 'CREATE_INTEGRATION', 'CREATE_WEBHOOK', 'CREATE_BUSINESS_RULE', 'CREATE_APPROVAL_POLICY']) {
    assert.match(service, new RegExp(`'${action}'`));
  }
});

test('approval requests and outbox are filtered to the authenticated branch', () => {
  assert.match(service, /branchRequesterIds\(scope: TenantScope\)/);
  assert.match(service, /where: \{ branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \} \}/);
  assert.match(service, /requesterId: \{ in: requesterIds \}/g);
  assert.match(service, /context: this\.branchContext\(dto\.context, scope\.branchId\)/);
  assert.match(service, /where: \{ companyId: scope\.companyId \}/);
  assert.match(service, /!payload\?\.branchId \|\| payload\.branchId === scope\.branchId/);
  assert.match(service, /'CREATE_APPROVAL_REQUEST'/);
  assert.match(service, /'DECIDE_APPROVAL_REQUEST'/);
});

test('legacy platform tenant fields are compatibility-only', () => {
  assert.match(dto, /Kompatibilitas lama; company tetap berasal dari token\./g);
  assert.match(dto, /branch lain ditolak\./g);
  assert.match(dto, /companyId\?: string/g);
  assert.match(dto, /branchId\?: string/g);
  assert.doesNotMatch(dto, /companyId!:\s*string/);
  assert.doesNotMatch(dto, /branchId!:\s*string/);
});

test('storefront and mobile pass branch code to public manifest', () => {
  assert.match(storefront, /platform\/manifest\?branchCode=\$\{encodeURIComponent\(branchCode\)\}/);
  assert.match(storefront, /platform\/storefront-branches\?branchCode=\$\{encodeURIComponent\(branchCode\)\}/);
  assert.match(mobile, /required String branchCode/);
  assert.match(mobile, /queryParameters: \{'branchCode': branchCode\}/);
});

test('platform mutations create structured audit evidence', () => {
  for (const action of [
    'UPSERT_FEATURE_FLAG', 'UPSERT_SYSTEM_SETTING', 'CREATE_CUSTOM_FIELD', 'UPSERT_CUSTOM_FIELD_VALUE',
    'CREATE_INTEGRATION', 'CREATE_WEBHOOK', 'CREATE_BUSINESS_RULE', 'CREATE_APPROVAL_POLICY',
    'CREATE_APPROVAL_REQUEST', 'DECIDE_APPROVAL_REQUEST', 'CREATE_UI_SCHEMA',
  ]) assert.match(service, new RegExp(`'${action}'`));
});
