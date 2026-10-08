import { Injectable } from '@nestjs/common';

export interface RegisteredAdapter {
  id: string;
  type: 'payment' | 'shipping' | 'marketplace' | 'notification' | 'accounting' | 'device' | 'custom';
  version: string;
  capabilities: string[];
  productionReady: boolean;
  description: string;
}

@Injectable()
export class PluginRegistryService {
  private readonly adapters = new Map<string, RegisteredAdapter>();

  constructor() {
    this.register({
      id: 'manual-payment', type: 'payment', version: '1.0.0', productionReady: true,
      capabilities: ['cash', 'bank-transfer-manual', 'mark-paid'],
      description: 'Pembayaran manual bawaan untuk kasir dan verifikasi transfer.',
    });
    this.register({
      id: 'payment-provider-template', type: 'payment', version: '0.1.0', productionReady: false,
      capabilities: ['create-payment', 'webhook', 'refund'],
      description: 'Template adapter payment gateway; tambahkan SDK dan credential provider pilihan.',
    });
    this.register({
      id: 'shipping-provider-template', type: 'shipping', version: '0.1.0', productionReady: false,
      capabilities: ['quote', 'create-shipment', 'tracking', 'label'],
      description: 'Template adapter ekspedisi untuk provider yang dipilih.',
    });
    this.register({
      id: 'marketplace-template', type: 'marketplace', version: '0.1.0', productionReady: false,
      capabilities: ['pull-orders', 'push-stock', 'push-products'],
      description: 'Template sinkronisasi marketplace.',
    });
    this.register({
      id: 'whatsapp-template', type: 'notification', version: '0.1.0', productionReady: false,
      capabilities: ['send-template', 'send-text', 'delivery-status'],
      description: 'Template WhatsApp Business API; butuh provider dan template yang disetujui.',
    });
    this.register({
      id: 'device-bridge-template', type: 'device', version: '0.1.0', productionReady: false,
      capabilities: ['scale.read', 'printer.print', 'cash-drawer.open', 'barcode.scan'],
      description: 'Kontrak bridge perangkat lokal POS melalui service yang dipercaya.',
    });
    this.register({
      id: 'fingerprint-device-template', type: 'device', version: '0.1.0', productionReady: false,
      capabilities: ['attendance.pull-events', 'attendance.enroll', 'attendance.revoke', 'incremental-cursor'],
      description: 'Template bridge fingerprint/face attendance; vendor SDK/API harus diimplementasikan.',
    });
    this.register({
      id: 'telegram-bot-api', type: 'notification', version: '0.1.0', productionReady: false,
      capabilities: ['send-text', 'secure-link'],
      description: 'Worker mendukung Telegram Bot token; binding chat ID karyawan wajib diverifikasi.',
    });
    this.register({
      id: 'attendance-media-storage-template', type: 'custom', version: '0.1.0', productionReady: false,
      capabilities: ['signed-upload', 'secure-download', 'retention-delete'],
      description: 'Private object storage untuk foto absensi dan slip gaji.',
    });
  }

  register(adapter: RegisteredAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  list(): RegisteredAdapter[] {
    return [...this.adapters.values()];
  }

  find(id: string): RegisteredAdapter | undefined {
    return this.adapters.get(id);
  }
}
