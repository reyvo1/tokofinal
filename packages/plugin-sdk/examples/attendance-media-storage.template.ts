import type { JsonObject, MediaStoragePlugin, PluginContext } from '../src/index';

export class AttendanceMediaStorageTemplate implements MediaStoragePlugin {
  readonly id = 'replace-with-s3-compatible-storage';
  readonly type = 'custom' as const;
  readonly version = '1.0.0';
  capabilities() { return ['signed-upload', 'secure-download', 'retention-delete']; }
  validateConfig(config: JsonObject) { if (!config.bucket) throw new Error('bucket is required'); }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Implement storage health check.' }; }
  async createUploadTicket(_context: PluginContext, input: { purpose: 'ATTENDANCE_PHOTO' | 'PAYSLIP'; contentType: string; contentLength?: number }) {
    return { objectKey: `pending/${crypto.randomUUID()}`, uploadUrl: 'IMPLEMENT_PROVIDER', expiresAt: new Date(Date.now() + 300000).toISOString(), headers: { 'content-type': input.contentType } };
  }
  async createSecureDownloadUrl(_context: PluginContext, objectKey: string) { return `IMPLEMENT_PROVIDER/${objectKey}`; }
  async deleteObject(_context: PluginContext, _objectKey: string) {}
}
