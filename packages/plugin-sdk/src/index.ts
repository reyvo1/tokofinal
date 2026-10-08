export type JsonObject = Record<string, unknown>;

export interface PluginContext {
  companyId: string;
  branchId?: string;
  correlationId: string;
  settings: JsonObject;
}

export interface HealthResult {
  ok: boolean;
  message?: string;
  details?: JsonObject;
}

export interface BasePlugin {
  readonly id: string;
  readonly type: 'payment' | 'shipping' | 'marketplace' | 'notification' | 'accounting' | 'device' | 'custom';
  readonly version: string;
  capabilities(): string[];
  validateConfig(config: JsonObject): Promise<void> | void;
  healthCheck(context: PluginContext): Promise<HealthResult>;
}

export interface PaymentRequest {
  reference: string;
  amount: number;
  currency: string;
  customer?: JsonObject;
  metadata?: JsonObject;
}

export interface PaymentResult {
  externalReference: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  redirectUrl?: string;
  qrString?: string;
  expiresAt?: string;
  raw?: JsonObject;
}

export interface PaymentPlugin extends BasePlugin {
  type: 'payment';
  createPayment(context: PluginContext, request: PaymentRequest): Promise<PaymentResult>;
  refund(context: PluginContext, externalReference: string, amount?: number): Promise<JsonObject>;
  verifyWebhook(payload: unknown, signature?: string): Promise<boolean> | boolean;
}

export interface ShippingQuoteRequest {
  origin: JsonObject;
  destination: JsonObject;
  packages: JsonObject[];
}

export interface ShippingPlugin extends BasePlugin {
  type: 'shipping';
  quote(context: PluginContext, request: ShippingQuoteRequest): Promise<JsonObject[]>;
  createShipment(context: PluginContext, request: JsonObject): Promise<JsonObject>;
  track(context: PluginContext, trackingNumber: string): Promise<JsonObject>;
}

export interface MarketplacePlugin extends BasePlugin {
  type: 'marketplace';
  pullOrders(context: PluginContext, cursor?: string): Promise<{ orders: JsonObject[]; nextCursor?: string }>;
  pushInventory(context: PluginContext, items: JsonObject[]): Promise<JsonObject>;
  pushProducts(context: PluginContext, products: JsonObject[]): Promise<JsonObject>;
}

export interface NotificationPlugin extends BasePlugin {
  type: 'notification';
  send(context: PluginContext, message: JsonObject): Promise<JsonObject>;
}


export interface DevicePlugin extends BasePlugin {
  type: 'device';
  discover(context: PluginContext): Promise<JsonObject[]>;
  read(context: PluginContext, deviceId: string, command: string, input?: JsonObject): Promise<JsonObject>;
  execute(context: PluginContext, deviceId: string, command: string, input?: JsonObject): Promise<JsonObject>;
}

export interface PluginRegistryEntry {
  plugin: BasePlugin;
  enabled: boolean;
}

export class PluginRegistry {
  private readonly entries = new Map<string, PluginRegistryEntry>();

  register(plugin: BasePlugin, enabled = true): void {
    if (this.entries.has(plugin.id)) throw new Error(`Plugin ${plugin.id} already registered`);
    this.entries.set(plugin.id, { plugin, enabled });
  }

  get<T extends BasePlugin = BasePlugin>(id: string): T {
    const entry = this.entries.get(id);
    if (!entry || !entry.enabled) throw new Error(`Plugin ${id} is not enabled`);
    return entry.plugin as T;
  }

  list(): Array<{ id: string; type: BasePlugin['type']; version: string; enabled: boolean; capabilities: string[] }> {
    return [...this.entries.values()].map(({ plugin, enabled }) => ({
      id: plugin.id,
      type: plugin.type,
      version: plugin.version,
      enabled,
      capabilities: plugin.capabilities(),
    }));
  }
}

export interface AttendanceDeviceEvent {
  externalEventId: string;
  deviceCode: string;
  deviceUserCode: string;
  eventType: 'CHECK_IN' | 'CHECK_OUT' | 'BREAK_START' | 'BREAK_END';
  occurredAt: string;
  biometricType?: 'FINGERPRINT' | 'FACE';
  payload?: JsonObject;
}

export interface AttendanceDevicePlugin extends BasePlugin {
  type: 'device';
  pullAttendanceEvents(context: PluginContext, cursor?: string): Promise<{ events: AttendanceDeviceEvent[]; nextCursor?: string }>;
  enrollEmployee(context: PluginContext, input: { employeeId: string; deviceUserCode: string; templateReference?: string }): Promise<JsonObject>;
  revokeEmployee(context: PluginContext, input: { deviceUserCode: string }): Promise<JsonObject>;
}

export interface MediaStoragePlugin extends BasePlugin {
  type: 'custom';
  createUploadTicket(context: PluginContext, input: { purpose: 'ATTENDANCE_PHOTO' | 'PAYSLIP'; contentType: string; contentLength?: number }): Promise<{ objectKey: string; uploadUrl: string; expiresAt: string; headers?: Record<string, string> }>;
  createSecureDownloadUrl(context: PluginContext, objectKey: string, expiresInSeconds: number): Promise<string>;
  deleteObject(context: PluginContext, objectKey: string): Promise<void>;
}
