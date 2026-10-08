import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../apps/admin/app/modules/extensions.tsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/extensions/extensions.controller.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/api/src/extensions/extensions.service.ts', import.meta.url), 'utf8');
const dto = readFileSync(new URL('../apps/api/src/extensions/dto/extensions.dto.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../apps/worker/src/index.ts', import.meta.url), 'utf8');

test('admin can register devices, rotate one-time credentials and deactivate a node', () => {
  assert.match(admin, /writeJson\(`\$\{API\}\/devices`, token, 'POST'/);
  assert.match(admin, /\/credentials\/rotate/);
  assert.match(admin, /SECRET SEKALI TAMPIL/);
  assert.match(admin, /\/status`, token, 'PATCH'/);
  assert.match(controller, /@Patch\('devices\/:id\/status'\)/);
  assert.match(dto, /export class SetDeviceStatusDto[\s\S]*isActive!: boolean/);
  assert.match(service, /async setDeviceStatus\(deviceId: string, isActive: boolean, user: AuthUser\)/);
  assert.match(service, /deviceCredential\.updateMany\([\s\S]*status: 'REVOKED'/);
  assert.match(service, /DEACTIVATE_DEVICE/);
});

test('admin manages provider-neutral notification templates and queue', () => {
  assert.match(admin, /\/notifications\/templates/);
  assert.match(admin, /Template provider-neutral/);
  assert.match(admin, /\['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM'\]/);
  assert.match(admin, /Masukkan antrean/);
  assert.match(controller, /@Post\('notifications\/templates'\)/);
  assert.match(controller, /@Post\('notifications'\)/);
  assert.match(service, /renderNotificationTemplate\(bodySource, renderData\)/);
  assert.match(worker, /EXTERNAL_NOTIFICATION_CHANNELS = \['TELEGRAM', 'WHATSAPP', 'EMAIL', 'SMS', 'PUSH'\]/);
  assert.match(worker, /Integration NOTIFICATION CONNECTED/);
});
