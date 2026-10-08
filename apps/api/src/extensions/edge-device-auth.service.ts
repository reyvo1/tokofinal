import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SecretProtectorService } from '../platform/secret-protector.service';

export type EdgeDeviceIdentity = {
  deviceId: string;
  companyId: string;
  branchId: string;
  credentialId: string;
  keyId: string;
};

type HeaderMap = Record<string, string | string[] | undefined>;

@Injectable()
export class EdgeDeviceAuthService {
  private readonly maxClockSkewMs = 5 * 60_000;

  constructor(private readonly prisma: PrismaService, private readonly secrets: SecretProtectorService) {}

  private stableJson(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return `[${value.map((entry) => this.stableJson(entry)).join(',')}]`;
    if (typeof value === 'object') {
      const row = value as Record<string, unknown>;
      return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${this.stableJson(row[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private header(headers: HeaderMap, name: string): string {
    const value = headers[name] ?? headers[name.toLowerCase()];
    const normalized = Array.isArray(value) ? value[0] : value;
    if (!normalized?.trim()) throw new UnauthorizedException(`Header ${name} wajib untuk edge sync.`);
    return normalized.trim();
  }

  private safeEqualHex(left: string, right: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
    const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async authenticate(headers: HeaderMap, operation: string, payload: unknown): Promise<EdgeDeviceIdentity> {
    const deviceId = this.header(headers, 'x-toko360-device-id');
    const keyId = this.header(headers, 'x-toko360-key-id');
    const timestampRaw = this.header(headers, 'x-toko360-timestamp');
    const nonce = this.header(headers, 'x-toko360-nonce');
    const signature = this.header(headers, 'x-toko360-signature').toLowerCase();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new UnauthorizedException('Nonce edge sync tidak valid.');

    const requestAt = new Date(timestampRaw);
    if (Number.isNaN(requestAt.getTime()) || Math.abs(Date.now() - requestAt.getTime()) > this.maxClockSkewMs) {
      throw new UnauthorizedException('Timestamp edge sync kedaluwarsa atau di luar toleransi clock.');
    }
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, isActive: true } });
    if (!device || !device.branchId) throw new UnauthorizedException('Device edge tidak aktif atau belum terikat branch.');
    const credential = await this.prisma.deviceCredential.findFirst({ where: {
      deviceId: device.id, keyId, status: 'ACTIVE', revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    } });
    if (!credential?.encryptedSecret) throw new UnauthorizedException('Credential edge tidak aktif atau perlu dirotasi ke format signed-sync terbaru.');

    const payloadHash = createHash('sha256').update(this.stableJson(payload)).digest('hex');
    const canonical = ['v1', device.id, credential.keyId, requestAt.toISOString(), nonce, operation, payloadHash].join('\n');
    const secret = this.secrets.decryptText(credential.encryptedSecret);
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    if (!this.safeEqualHex(signature, expected)) throw new UnauthorizedException('Signature edge sync tidak valid.');
    const requestHash = createHash('sha256').update(canonical).digest('hex');

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.deviceAuthNonce.deleteMany({ where: { credentialId: credential.id, createdAt: { lt: new Date(Date.now() - this.maxClockSkewMs * 2) } } });
        await tx.deviceAuthNonce.create({ data: { credentialId: credential.id, nonce, requestHash, requestAt } });
        await tx.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new UnauthorizedException('Nonce edge sync sudah pernah digunakan (replay ditolak).');
      throw error;
    }
    return { deviceId: device.id, companyId: device.companyId, branchId: device.branchId, credentialId: credential.id, keyId: credential.keyId };
  }
}
