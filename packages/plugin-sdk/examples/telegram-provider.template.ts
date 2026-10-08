import type { JsonObject, NotificationPlugin, PluginContext } from '../src/index';

export class TelegramProviderTemplate implements NotificationPlugin {
  readonly id = 'telegram-bot-api';
  readonly type = 'notification' as const;
  readonly version = '1.0.0';
  capabilities() { return ['text', 'secure-link', 'delivery-response']; }
  validateConfig(config: JsonObject) { if (!config.botTokenSecretRef) throw new Error('botTokenSecretRef is required'); }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Resolve bot secret and call getMe.' }; }
  async send(_context: PluginContext, message: JsonObject) { return { status: 'QUEUED', provider: 'telegram', message }; }
}
