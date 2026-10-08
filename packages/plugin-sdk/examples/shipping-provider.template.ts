import type { JsonObject, PluginContext, ShippingPlugin, ShippingQuoteRequest } from '../src/index';

export class ShippingProviderTemplate implements ShippingPlugin {
  readonly id = 'replace-with-shipping-provider';
  readonly type = 'shipping' as const;
  readonly version = '1.0.0';
  capabilities() { return ['quote', 'shipment', 'tracking', 'label']; }
  validateConfig(config: JsonObject) { if (!config.baseUrl) throw new Error('baseUrl is required'); }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Implement provider health endpoint.' }; }
  async quote(_context: PluginContext, _request: ShippingQuoteRequest) { return []; }
  async createShipment(_context: PluginContext, request: JsonObject) { return { status: 'DRAFT', request }; }
  async track(_context: PluginContext, trackingNumber: string) { return { trackingNumber, events: [] }; }
}
