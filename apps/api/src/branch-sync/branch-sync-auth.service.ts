import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SecretProtectorService } from '../platform/secret-protector.service';

// POST-1A — peer transport security.
//
// This mirrors apps/api/src/extensions/edge-device-auth.service.ts, which authenticates a POS device
// talking to a server. The difference is the trust shape: a device is a leaf credential of one
// server, while a branch server is a long-lived peer that retries in bulk. That is why the nonce
// ledger here is keyed on the peer registration rather than a device credential.
//
// The signature covers the payload hash, not just the operation name, so a signature captured on a
// small pull cannot be replayed to inject a different batch of events. Combined with the nonce
// ledger, a replayed request is rejected twice over: the digest will not match, and the nonce is
// already spent.

export type SyncPeerIdentity = {
  companyId: string;
  nodeId: string;
  peerNodeId: string;
  peerId: string;
};

type HeaderMap = Record<string, string | string[] | undefined>;

@Injectable()
export class BranchSyncAuthService {
  // Matches the device path. A branch on a slow WAN can be a second or two behind, but a five minute
  // window is already generous for an authenticated JSON request.
  private readonly maxClockSkewMs = 5 * 60_000;

  constructor(private readonly prisma: PrismaService, private readonly secrets: SecretProtectorService) {}

  // Key order must not change the digest, or the same request signed twice would not verify.
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
    if (!normalized?.trim()) throw new UnauthorizedException(`Header ${name} wajib untuk peer sync.`);
    return normalized.trim();
  }

  // Reject anything that is not a 64-char hex digest before touching timingSafeEqual, which throws
  // on length mismatch and would otherwise turn a malformed header into a 500.
  private safeEqualHex(left: string, right: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
    const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async authenticate(headers: HeaderMap, operation: string, payload: unknown): Promise<SyncPeerIdentity> {
    const nodeCode = this.header(headers, 'x-toko360-node-code');
    const peerNodeCode = this.header(headers, 'x-toko360-peer-node-code');
    const timestampRaw = this.header(headers, 'x-toko360-timestamp');
    const nonce = this.header(headers, 'x-toko360-nonce');
    const signature = this.header(headers, 'x-toko360-signature').toLowerCase();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new UnauthorizedException('Nonce peer sync tidak valid.');

    const requestAt = new Date(timestampRaw);
    if (Number.isNaN(requestAt.getTime()) || Math.abs(Date.now() - requestAt.getTime()) > this.maxClockSkewMs) {
      throw new UnauthorizedException('Timestamp peer sync kedaluwarsa atau di luar toleransi clock.');
    }
    if (nodeCode === peerNodeCode) throw new UnauthorizedException('Node tidak boleh menandatangani dirinya sendiri.');

    const node = await this.prisma.syncNode.findFirst({ where: { code: nodeCode, isActive: true } });
    const peerNode = await this.prisma.syncNode.findFirst({ where: { code: peerNodeCode, isActive: true } });
    if (!node || !peerNode) throw new UnauthorizedException('Node atau peer tidak aktif.');
    // Cross-tenant peers are refused here rather than filtered later: a signature from another
    // company's node must never reach a business mutation, even a correctly signed one.
    if (node.companyId !== peerNode.companyId) throw new UnauthorizedException('Peer berada pada tenant berbeda.');

    const registration = await this.prisma.syncPeer.findFirst({
      where: { nodeId: node.id, peerNodeId: peerNode.id, isActive: true },
    });
    if (!registration) throw new UnauthorizedException('Peer tidak terdaftar aktif pada node pengirim.');

    const payloadHash = createHash('sha256').update(this.stableJson(payload)).digest('hex');
    const canonical = ['v1', node.id, peerNode.id, requestAt.toISOString(), nonce, operation, payloadHash].join('\n');
    // An unresolvable secret is a configuration failure, not a valid request.
    let secret: string;
    try {
      secret = this.secrets.decryptText(registration.sharedSecretRef);
    } catch {
      throw new UnauthorizedException('Secret peer tidak dapat didekode; credential perlu dirotasi.');
    }
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    if (!this.safeEqualHex(signature, expected)) throw new UnauthorizedException('Signature peer sync tidak valid.');
    const requestHash = createHash('sha256').update(canonical).digest('hex');

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.syncPeerNonce.deleteMany({ where: { peerId: registration.id, createdAt: { lt: new Date(Date.now() - this.maxClockSkewMs * 2) } } });
        await tx.syncPeerNonce.create({ data: { peerId: registration.id, nonce, requestHash, requestAt } });
        await tx.syncNode.update({ where: { id: node.id }, data: { lastHeartbeatAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // The unique constraint on (peerId, nonce) is the real replay defence; a second delivery of the
      // same nonce hits it even if the signature still verifies.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new UnauthorizedException('Nonce peer sync sudah pernah dipakai (replay ditolak).');
      }
      throw error;
    }
    return { companyId: node.companyId, nodeId: node.id, peerNodeId: peerNode.id, peerId: registration.id };
  }
}
