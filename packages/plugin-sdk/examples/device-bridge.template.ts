import type { DevicePlugin, JsonObject, PluginContext } from '../src/index';

export class DeviceBridgeTemplate implements DevicePlugin {
  readonly id = 'local-device-bridge';
  readonly type = 'device' as const;
  readonly version = '1.0.0';
  capabilities() { return ['scale.read', 'printer.print', 'cash-drawer.open', 'barcode.scan']; }
  validateConfig(config: JsonObject) { if (!config.bridgeUrl) throw new Error('bridgeUrl is required'); }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Connect to a trusted local bridge.' }; }
  async discover(_context: PluginContext) { return []; }
  async read(_context: PluginContext, deviceId: string, command: string, input?: JsonObject) { return { deviceId, command, input, value: null }; }
  async execute(_context: PluginContext, deviceId: string, command: string, input?: JsonObject) { return { deviceId, command, input, accepted: false }; }
}
