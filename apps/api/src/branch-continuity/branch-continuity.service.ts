import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { SecretProtectorService } from '../platform/secret-protector.service';
import type { BranchConnectionState } from '@prisma/client';

// POST-1B — local-first branch continuity.
//
// The rule the roadmap states in one line and that this entire service exists to enforce:
// "No flow may silently pretend it is globally current when a branch is disconnected."
//
// That rules out the tempting design where a disconnected branch just serves whatever it has. Every
// answer this service produces therefore carries its authority: which snapshot it came from, how far
// behind that snapshot is, and what the operator loses by acting on it. A price read that cannot say
// when it was last synchronized is a wrong price with extra steps.
//
// A second rule follows from the first: offline capability is declared, never inferred from whether
// the network happens to be down at the moment. A branch selling perishables must be refused a blind
// sale even on a day the link is fine, and allowed one on a policy that says so.

@Injectable()
export class BranchContinuityService {
  private readonly logger = new Logger(BranchContinuityService.name);

  // Beyond this a read is not merely stale, it is misleading, so the answer is refused outright
  // rather than served with a warning nobody reads.
  private readonly maxStalenessMs = 24 * 60 * 60_000;

  constructor(private readonly prisma: PrismaService, private readonly secrets: SecretProtectorService) {}

  private tenant(user: AuthUser) {
    if (!user.companyId) throw new ForbiddenException('Continuity cabang harus punya tenant.');
    return user.companyId;
  }

  // ---------------------------------------------------------------- capability contract

  async listCapabilities(user: AuthUser) {
    const companyId = this.tenant(user);
    return this.prisma.offlineCapability.findMany({ where: { companyId, isActive: true }, orderBy: { flowCode: 'asc' } });
  }

  async declareCapability(user: AuthUser, dto: { flowCode: string; label: string; offlineCapable: boolean; degradedImpact?: string; localAuthoritative?: boolean }) {
    const companyId = this.tenant(user);
    // A flow declared offline-capable must say what is lost. Without that, "offline-capable" is a
    // blank cheque the operator cashes without knowing.
    if (dto.offlineCapable && !dto.degradedImpact?.trim()) {
      throw new BadRequestException('Flow offline-capable wajib menyebut degradedImpact: operator harus tahu apa yang ia korbankan.');
    }
    const saved = await this.prisma.offlineCapability.upsert({
      where: { companyId_flowCode: { companyId, flowCode: dto.flowCode } },
      create: { companyId, flowCode: dto.flowCode, label: dto.label, offlineCapable: dto.offlineCapable, degradedImpact: dto.degradedImpact ?? null, localAuthoritative: dto.localAuthoritative ?? false },
      update: { label: dto.label, offlineCapable: dto.offlineCapable, degradedImpact: dto.degradedImpact ?? null, localAuthoritative: dto.localAuthoritative ?? false, isActive: true },
    });
    return saved;
  }

  // The effective policy for a node: the node override wins over the company default. This is what
  // gates a write, so it must be a single resolved answer, not two rows the caller has to reconcile.
  async effectivePolicy(user: AuthUser, nodeId: string, flowCode: string) {
    const companyId = this.tenant(user);
    const node = await this.prisma.syncNode.findFirst({ where: { id: nodeId, companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');
    const override = await this.prisma.nodeCapabilityPolicy.findFirst({ where: { nodeId, flowCode } });
    const fallback = await this.prisma.offlineCapability.findFirst({ where: { companyId, flowCode, isActive: true } });
    if (override) {
      return { flowCode, offlineCapable: override.offlineCapable, degradedImpact: override.degradedImpact, localAuthoritative: false, source: 'NODE_OVERRIDE' as const };
    }
    if (!fallback) {
      // Undeclared means not permitted. Defaulting to "allowed" would let any new flow go offline by
      // simply never being registered.
      return { flowCode, offlineCapable: false, degradedImpact: null, localAuthoritative: false, source: 'UNDECLARED' as const };
    }
    return { flowCode, offlineCapable: fallback.offlineCapable, degradedImpact: fallback.degradedImpact, localAuthoritative: fallback.localAuthoritative, source: 'COMPANY_DEFAULT' as const };
  }

  async setNodePolicy(user: AuthUser, nodeId: string, dto: { flowCode: string; offlineCapable: boolean; degradedImpact?: string }) {
    const companyId = this.tenant(user);
    const node = await this.prisma.syncNode.findFirst({ where: { id: nodeId, companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');
    if (dto.offlineCapable && !dto.degradedImpact?.trim()) {
      throw new BadRequestException('Override offline-capable wajib menyebut degradedImpact.');
    }
    return this.prisma.nodeCapabilityPolicy.upsert({
      where: { nodeId_flowCode: { nodeId, flowCode: dto.flowCode } },
      create: { companyId, nodeId, flowCode: dto.flowCode, offlineCapable: dto.offlineCapable, degradedImpact: dto.degradedImpact ?? null },
      update: { offlineCapable: dto.offlineCapable, degradedImpact: dto.degradedImpact ?? null },
    });
  }

  // ---------------------------------------------------------------- the gate

  // Decide whether a flow may proceed right now, and hand back the answer in a form the caller must
  // show the operator. It never silently returns "fine".
  async assertMayProceed(user: AuthUser, nodeId: string, flowCode: string) {
    const policy = await this.effectivePolicy(user, nodeId, flowCode);
    const state = await this.connectionState(user, nodeId);
    const online = state.state === 'ONLINE';
    if (online) return { ...policy, connection: state, permitted: true, reason: null as string | null };
    if (!policy.offlineCapable) {
      throw new ForbiddenException(
        `Flow ${flowCode} tidak dinyatakan offline-capable dan node sedang ${state.state}. Fail-closed: transaksi ditolak, bukan dipalsukan.`,
      );
    }
    return {
      ...policy, connection: state, permitted: true,
      reason: `${flowCode} berjalan pada state lokal. ${policy.degradedImpact ?? ''}`.trim(),
    };
  }

  // ---------------------------------------------------------------- reads carry their authority

  // A read must be able to say how old it is. Beyond the staleness bound the answer is refused rather
  // than served: a day-old price with a freshness badge is still a price nobody agreed to sell at.
  async readWithAuthority(user: AuthUser, nodeId: string, resource: string) {
    const companyId = this.tenant(user);
    const node = await this.prisma.syncNode.findFirst({ where: { id: nodeId, companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');
    const watermark = await this.prisma.syncReadWatermark.findFirst({ where: { nodeId, resource } });
    const state = await this.connectionState(user, nodeId);
    if (!watermark) {
      throw new NotFoundException(`Belum ada snapshot tersinkron untuk ${resource} pada node ini; tidak boleh disajikan sebagai data terkini.`);
    }
    const ageMs = Date.now() - watermark.lastSyncedAt.getTime();
    const stale = ageMs > this.maxStalenessMs;
    return {
      resource,
      lastSyncedAt: watermark.lastSyncedAt,
      sourceCursor: watermark.sourceCursor,
      ageMs,
      stale,
      connection: state,
      // The caller is expected to render this. A read that is stale and silent is the exact failure
      // this roadmap forbids.
      requiredNotice: state.state === 'ONLINE' && !stale ? null : `Data ${resource} per ${watermark.lastSyncedAt.toISOString()} — ${state.state}, tertinggal ${Math.round(ageMs / 60000)} menit dari sinkronisasi terakhir.`,
    };
  }

  async markSynced(user: AuthUser, nodeId: string, dto: { resource: string; sourceCursor?: string }) {
    const companyId = this.tenant(user);
    const node = await this.prisma.syncNode.findFirst({ where: { id: nodeId, companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');
    return this.prisma.syncReadWatermark.upsert({
      where: { nodeId_resource: { nodeId, resource: dto.resource } },
      create: { companyId, nodeId, resource: dto.resource, lastSyncedAt: new Date(), sourceCursor: dto.sourceCursor ?? null },
      update: { lastSyncedAt: new Date(), sourceCursor: dto.sourceCursor ?? null },
    });
  }

  // ---------------------------------------------------------------- connectivity

  // Connectivity is reported centrally so a branch that is unreachable can still be shown as such.
  // The alternative — asking the branch — can only report on branches that answer.
  async connectionState(user: AuthUser, nodeId: string) {
    const companyId = this.tenant(user);
    const node = await this.prisma.syncNode.findFirst({ where: { id: nodeId, companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');
    const recorded = await this.prisma.branchConnectivity.findFirst({ where: { companyId, branchId: node.branchId ?? node.id } });
    const state = recorded?.state ?? 'UNKNOWN';
    // A heartbeat inside the window downgrades ONLINE to DEGRADED. Deriving the verdict from data
    // rather than from a stored label means a node that stops reporting cannot keep claiming ONLINE.
    if (recorded && state === 'ONLINE' && node.lastHeartbeatAt) {
      const age = Date.now() - node.lastHeartbeatAt.getTime();
      if (age > 5 * 60_000) return { state: 'DEGRADED' as const, lastSeenAt: node.lastHeartbeatAt, lastSyncAt: recorded.lastSyncAt, lagCount: recorded.lagCount, reason: `Heartbeat terakhir ${Math.round(age / 1000)} detik lalu.` };
    }
    return { state, lastSeenAt: recorded?.lastSeenAt ?? node.lastHeartbeatAt, lastSyncAt: recorded?.lastSyncAt, lagCount: recorded?.lagCount ?? 0, reason: recorded?.reason ?? null };
  }

  async reportConnectivity(user: AuthUser, dto: { branchId: string; state: BranchConnectionState; lagCount?: number; reason?: string }) {
    const companyId = this.tenant(user);
    if (dto.state === 'ONLINE' && (dto.lagCount ?? 0) > 0) {
      // Online with a backlog is not ONLINE. Recording it as such would make the dashboard claim a
      // branch is current while it is silently days behind.
      throw new BadRequestException('Node dengan backlog tidak boleh dilaporkan ONLINE; gunakan DEGRADED.');
    }
    return this.prisma.branchConnectivity.upsert({
      where: { companyId_branchId: { companyId, branchId: dto.branchId } },
      create: { companyId, branchId: dto.branchId, state: dto.state, lastSeenAt: dto.state === 'OFFLINE' ? null : new Date(), lagCount: dto.lagCount ?? 0, reason: dto.reason ?? null },
      update: { state: dto.state, lastSeenAt: dto.state === 'OFFLINE' ? null : new Date(), lagCount: dto.lagCount ?? 0, reason: dto.reason ?? null },
    });
  }

  // The consolidated view. Every branch appears, including ones that have never been heard from —
  // a dashboard that only lists responding branches hides exactly the branch that needs attention.
  async consolidatedStatus(user: AuthUser) {
    const companyId = this.tenant(user);
    const nodes = await this.prisma.syncNode.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    const rows = [];
    for (const node of nodes) {
      const [recorded, pending, deadLettered, conflicts] = await Promise.all([
        this.prisma.branchConnectivity.findFirst({ where: { companyId, branchId: node.branchId ?? node.id } }),
        this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'PENDING' } }),
        this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'DEAD_LETTER' } }),
        this.prisma.syncConflict.count({ where: { nodeId: node.id, strategy: 'PENDING' } }),
      ]);
      let state: BranchConnectionState = recorded?.state ?? 'UNKNOWN';
      if (state === 'ONLINE' && node.lastHeartbeatAt && Date.now() - node.lastHeartbeatAt.getTime() > 5 * 60_000) state = 'DEGRADED';
      rows.push({
        nodeId: node.id, code: node.code, name: node.name, role: node.role, state,
        lastSeenAt: node.lastHeartbeatAt, lastSyncAt: recorded?.lastSyncAt ?? null,
        pending, deadLettered, unresolvedConflicts: conflicts, reason: recorded?.reason ?? null,
      });
    }
    return { branches: rows, totalPending: rows.reduce((sum, r) => sum + r.pending, 0), totalDeadLettered: rows.reduce((sum, r) => sum + r.deadLettered, 0), generatedAt: new Date().toISOString() };
  }

  // ---------------------------------------------------------------- LAN discovery

  // LAN discovery advertises a server to approved clients on the local network. It is deliberately
  // unauthenticated in shape and therefore deliberately narrow: it reveals node code, role and
  // reachability for a company the caller must already belong to, and nothing about inventory, price
  // or any business data. A discovery endpoint that leaked business state would be a data leak with a
  // friendly name.
  async discover(user: AuthUser) {
    const companyId = this.tenant(user);
    const nodes = await this.prisma.syncNode.findMany({ where: { companyId, isActive: true }, orderBy: { code: 'asc' } });
    return {
      protocolVersion: 1,
      nodes: nodes.map((n) => ({
        code: n.code, role: n.role,
        reachable: n.lastHeartbeatAt ? Date.now() - n.lastHeartbeatAt.getTime() < 5 * 60_000 : false,
        // Exposed deliberately: a client needs to know which server to talk to.
        endpoint: `/api/v1/branch-sync`,
      })),
    };
  }

  // ---------------------------------------------------------------- backup metadata

  // Central records what a branch reported about its own backup. It does not fetch, store, or proxy
  // the data: a central that mirrors branch backups becomes a second copy of every business record,
  // which is the opposite of what backup metadata is for.
  async recordBackupMetadata(user: AuthUser, dto: { nodeId: string; completedAt: string; checksum: string; sizeBytes: number; kind?: 'LOCAL' | 'CENTRAL' }) {
    const companyId = this.tenant(user);
    const node = await this.prisma.syncNode.findFirst({ where: { id: dto.nodeId, companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');
    if (!/^[0-9a-f]{64}$/i.test(dto.checksum)) {
      throw new BadRequestException('Checksum backup harus SHA-256 hex agar dapat diverifikasi saat restore.');
    }
    await this.prisma.auditLog.create({
      data: {
        companyId, action: 'BRANCH_BACKUP_RECORDED', entityType: 'SyncNode', entityId: node.id,
        payload: { completedAt: dto.completedAt, checksum: dto.checksum, sizeBytes: dto.sizeBytes, kind: dto.kind ?? 'LOCAL', note: 'Metadata only; central does not hold branch backup data.' },
      },
    });
    return { recorded: true, nodeId: node.id, checksum: dto.checksum, completedAt: dto.completedAt };
  }

  async listBackupMetadata(user: AuthUser) {
    const companyId = this.tenant(user);
    return this.prisma.auditLog.findMany({
      where: { companyId, action: 'BRANCH_BACKUP_RECORDED' },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { entityId: true, createdAt: true, payload: true },
    });
  }

  /**
   * Verify a backup before it is restored, against the checksum central already recorded.
   *
   * The recorded checksum was promised to be "verifiable at restore time" and until now nothing could
   * verify it. That promise is kept WITHOUT central holding any backup data: the caller — the operator
   * or the branch node doing the restore — supplies the SHA-256 it computed from the file in hand, and
   * central only compares. Mirroring the file here instead would rebuild the second copy of every
   * business record that `recordBackupMetadata` exists to avoid.
   *
   * Three decisions that keep this from being a rubber stamp:
   *
   *   1. **A node with no recorded backup cannot pass.** "There is nothing to compare against" is a
   *      refusal, not a silent success — otherwise an unbacked-up node would restore happily.
   *   2. **The newest record for that node wins.** A branch that backed up three times is compared
   *      against the latest, which is the one an operator would actually restore.
   *   3. **The comparison itself is audited.** The refusal is the event worth having later, and a
   *      verification nobody can read afterwards is not a verification.
   */
  async verifyRestoreChecksum(user: AuthUser, dto: { nodeId: string; checksum: string }) {
    const companyId = this.tenant(user);
    if (!/^[0-9a-f]{64}$/i.test(dto.checksum)) {
      throw new BadRequestException('Checksum harus SHA-256 hex agar dapat dibandingkan.');
    }
    const node = await this.prisma.syncNode.findFirst({ where: { id: dto.nodeId, companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');

    const recorded = await this.prisma.auditLog.findFirst({
      where: { companyId, action: 'BRANCH_BACKUP_RECORDED', entityId: node.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!recorded) {
      await this.prisma.auditLog.create({
        data: {
          companyId, action: 'BRANCH_RESTORE_CHECKSUM_REJECTED', entityType: 'SyncNode', entityId: node.id,
          payload: { reason: 'NO_RECORDED_BACKUP', supplied: dto.checksum, rejoinAllowed: false },
        },
      });
      throw new BadRequestException('Node ini belum punya metadata backup tercatat; tidak ada yang dapat diverifikasi.');
    }

    const payload = (typeof recorded.payload === 'string' ? JSON.parse(recorded.payload) : recorded.payload) as
      { checksum?: string; completedAt?: string; sizeBytes?: number } | null;
    const expected = payload?.checksum ?? '';
    const matches = typeof expected === 'string'
      && expected.toLowerCase() === dto.checksum.toLowerCase();

    if (!matches) {
      await this.prisma.auditLog.create({
        data: {
          companyId, action: 'BRANCH_RESTORE_CHECKSUM_REJECTED', entityType: 'SyncNode', entityId: node.id,
          payload: {
            reason: 'CHECKSUM_MISMATCH', supplied: dto.checksum, recordedChecksum: expected,
            recordedCompletedAt: payload?.completedAt ?? null, rejoinAllowed: false,
          },
        },
      });
      throw new BadRequestException('Checksum tidak cocok dengan backup terakhir yang tercatat; restore ditolak.');
    }

    await this.prisma.auditLog.create({
      data: {
        companyId, action: 'BRANCH_RESTORE_CHECKSUM_VERIFIED', entityType: 'SyncNode', entityId: node.id,
        payload: {
          checksum: dto.checksum, recordedCompletedAt: payload?.completedAt ?? null,
          recordedSizeBytes: payload?.sizeBytes ?? null, rejoinAllowed: true,
        },
      },
    });
    return {
      verified: true, nodeId: node.id, checksum: dto.checksum,
      recordedCompletedAt: payload?.completedAt ?? null,
      next: 'Lanjutkan restore, lalu rejoin dengan code node yang sama agar cursor tetap bermakna.',
    };
  }

  // Re-registration after a branch server is replaced. Reusing the same node code adopts the existing
  // identity, which is what keeps the sync cursors meaningful across the swap.
  //
  // Rejoin deliberately does NOT require a verified checksum. A node that has never recorded a backup
  // still has to be able to come back, and refusing it would strand the branch permanently — the
  // verification endpoint exists so the decision is *visible and audited*, not to gate reconnection.
  async rejoinBranch(user: AuthUser, dto: { code: string; name: string; role: 'CENTRAL' | 'BRANCH'; branchId?: string }) {
    const node = await this.prisma.syncNode.findFirst({ where: { companyId: this.tenant(user), code: dto.code } });
    if (!node) throw new NotFoundException('Node dengan code ini belum pernah terdaftar; gunakan registrasi normal.');
    const reactivated = await this.prisma.syncNode.update({ where: { id: node.id }, data: { isActive: true, lastHeartbeatAt: new Date() } });
    return {
      nodeId: reactivated.id, code: reactivated.code,
      next: 'Daftarkan ulang peer dan secret, lalu tarik per peer dari cursor terakhir. Jangan menyalin tabel lintas node.',
    };
  }
}
