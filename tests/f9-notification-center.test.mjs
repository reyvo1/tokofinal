import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('apps/api/src/extensions/extensions.service.ts', 'utf8');
const controller = fs.readFileSync('apps/api/src/extensions/extensions.controller.ts', 'utf8');
const platformService = fs.readFileSync('apps/api/src/platform/platform.service.ts', 'utf8');
const platformController = fs.readFileSync('apps/api/src/platform/platform.controller.ts', 'utf8');
const worker = fs.readFileSync('apps/worker/src/index.ts', 'utf8');
const admin = fs.readFileSync('apps/admin/app/modules/extensions.tsx', 'utf8');


test('F9 provider configuration is tenant scoped and secrets stay redacted', () => {
  assert.match(service, /integrationConnection\.findMany\(\{[\s\S]*companyId: scope\.companyId[\s\S]*type: 'NOTIFICATION'[\s\S]*branchId: scope\.branchId/);
  assert.match(service, /rows\.map\(\(\{ encryptedSecrets, \.\.\.row \}\) => \(\{ \.\.\.row, hasSecrets: Boolean\(encryptedSecrets\) \}\)\)/);
  assert.match(controller, /@Get\('notifications\/providers'\)/);
  assert.match(admin, /platform\/integrations/);
  assert.match(platformController, /@Roles\('SUPER_ADMIN','OWNER','ADMIN'\) @Permissions\('integration\.manage'\) @Post\('integrations'\)/);
  assert.match(platformController, /@Roles\('SUPER_ADMIN','OWNER','ADMIN'\) @Permissions\('integration\.manage'\) @Patch\('integrations\/:id'\)/);
  assert.match(admin, /const canManageIntegrations = hasAnyRole\('SUPER_ADMIN', 'OWNER', 'ADMIN'\) && canAll\('integration\.manage'\)/);
  assert.match(admin, /encryptedSecrets: JSON\.stringify\(\{ token:/);
  assert.doesNotMatch(admin, /setProviders\([^)]*encryptedSecrets/);
});

test('F9 worker resolves connected notification integration before env compatibility fallback', () => {
  assert.match(worker, /type: 'NOTIFICATION'/);
  assert.match(worker, /status: 'CONNECTED'/);
  assert.match(worker, /notificationIntegrationMatches/);
  assert.match(worker, /sendTelegramNotification/);
  assert.match(worker, /Secret token Telegram belum dikonfigurasi pada IntegrationConnection/);
  assert.match(worker, /sendGenericNotification/);
  assert.match(worker, /integrationConnection\.update\(\{ where: \{ id: integrationId \}, data: \{ lastHealthCheckAt: new Date\(\), lastError: null \} \}\)/);
  assert.match(worker, /status: 'DEGRADED'/);
});

test('F9 notification history supports safe cancel and replay lifecycle', () => {
  assert.match(platformService, /notification\.status !== 'QUEUED'/);
  assert.match(platformService, /status: 'CANCELLED'/);
  assert.match(platformService, /\['FAILED','CANCELLED'\]\.includes\(notification\.status\)/);
  assert.match(platformService, /status: 'QUEUED', attempts: 0/);
  assert.match(platformController, /notifications\/:id\/cancel/);
  assert.match(platformController, /notifications\/:id\/replay/);
  assert.match(platformController, /@Permissions\('notification\.manage'\)/);
});

test('F9 operator notification center exposes provider template queue and delivery actions', () => {
  assert.match(admin, /WhatsApp \/ Telegram/);
  assert.match(admin, /Notification Center/);
  assert.match(admin, /setProviderStatus/);
  assert.match(admin, /editTemplate/);
  assert.match(admin, /notificationAction\(n, 'cancel'\)/);
  assert.match(admin, /notificationAction\(n, 'replay'\)/);
  assert.match(admin, /lastError/);
  assert.match(admin, /attempts/);
});

test('F9 notification listing validates channel and status and remains branch scoped', () => {
  assert.match(service, /allowedChannels = \['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM'\]/);
  assert.match(service, /allowedStatuses = \['QUEUED','SENT','DELIVERED','FAILED','CANCELLED'\]/);
  assert.match(service, /!data\?\.branchId \|\| data\.branchId === scope\.branchId/);
  assert.match(controller, /@Query\('channel'\) channel\?: string/);
  assert.match(controller, /@Query\('status'\) status\?: string/);
});
