import type { JsonObject, MarketplacePlugin, PluginContext } from '../src/index';

export class MarketplaceProviderTemplate implements MarketplacePlugin {
  readonly id = 'replace-with-marketplace';
  readonly type = 'marketplace' as const;
  readonly version = '1.0.0';
  capabilities() { return ['orders.pull', 'inventory.push', 'products.push']; }
  validateConfig(config: JsonObject) { if (!config.shopId) throw new Error('shopId is required'); }
  async healthCheck(_context: PluginContext) { return { ok: false, message: 'Implement provider health endpoint.' }; }
  async pullOrders(_context: PluginContext, _cursor?: string) { return { orders: [] }; }
  async pushInventory(_context: PluginContext, items: JsonObject[]) { return { accepted: items.length }; }
  async pushProducts(_context: PluginContext, products: JsonObject[]) { return { accepted: products.length }; }
}
