import type { AttendanceDevicePlugin, JsonObject, PluginContext } from '../src/index';

export class FingerprintDeviceTemplate implements AttendanceDevicePlugin {
  readonly id = 'replace-with-fingerprint-vendor';
  readonly type = 'device' as const;
  readonly version = '1.0.0';
  capabilities() { return ['attendance-events', 'employee-enrollment', 'incremental-sync']; }
  validateConfig(config: JsonObject) {
    if (!config.endpoint || !config.deviceCode) throw new Error('endpoint and deviceCode are required');
  }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Implement device health check.' }; }
  async discover(_context: PluginContext) { return []; }
  async read(_context: PluginContext, _deviceId: string, _command: string, _input?: JsonObject) { return {}; }
  async execute(_context: PluginContext, _deviceId: string, _command: string, _input?: JsonObject) { return {}; }
  async pullAttendanceEvents(_context: PluginContext, cursor?: string) { return { events: [], nextCursor: cursor }; }
  async enrollEmployee(_context: PluginContext, input: { employeeId: string; deviceUserCode: string; templateReference?: string }) { return { status: 'PENDING_IMPLEMENTATION', input }; }
  async revokeEmployee(_context: PluginContext, input: { deviceUserCode: string }) { return { status: 'PENDING_IMPLEMENTATION', input }; }
}
