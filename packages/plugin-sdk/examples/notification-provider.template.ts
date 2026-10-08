import type { JsonObject, NotificationPlugin, PluginContext } from '../src/index';

export class NotificationProviderTemplate implements NotificationPlugin {
  readonly id = 'replace-with-notification-provider';
  readonly type = 'notification' as const;
  readonly version = '1.0.0';
  capabilities() { return ['text', 'template', 'delivery-status']; }
  validateConfig(config: JsonObject) { if (!config.sender) throw new Error('sender is required'); }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Implement provider health endpoint.' }; }
  async send(_context: PluginContext, message: JsonObject) { return { status: 'QUEUED', message }; }
}
