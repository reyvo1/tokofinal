import type { JsonObject, PaymentPlugin, PaymentRequest, PaymentResult, PluginContext } from '../src/index';

export class PaymentProviderTemplate implements PaymentPlugin {
  readonly id = 'replace-with-provider-id';
  readonly type = 'payment' as const;
  readonly version = '1.0.0';
  capabilities() { return ['create-payment', 'refund', 'webhook']; }
  validateConfig(config: JsonObject) { if (!config.baseUrl) throw new Error('baseUrl is required'); }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Implement provider health endpoint.' }; }
  async createPayment(_context: PluginContext, request: PaymentRequest): Promise<PaymentResult> {
    // Map request to provider SDK/API and persist external reference idempotently.
    return { externalReference: `replace-${request.reference}`, status: 'PENDING', raw: {} };
  }
  async refund(_context: PluginContext, externalReference: string, amount?: number) { return { externalReference, amount, status: 'PENDING' }; }
  verifyWebhook(_payload: unknown, _signature?: string) { return false; }
}
