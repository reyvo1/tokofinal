import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecretProtectorService } from '../platform/secret-protector.service';
import { BranchSyncAuthService, SyncPeerIdentity } from './branch-sync-auth.service';
import { AuthUser } from '../auth/auth.types';
import type { SyncConflictStrategy } from '@prisma/client';
import {
  BootstrapBranchDto, EnqueueSyncEventDto, NodeHeartbeatDto, PublishSyncEventsDto, PullSyncEventsDto,
  RegisterPeerDto, RegisterSyncNodeDto, SetPeerActiveDto,
} from './dto/branch-sync.dto';

// POST-1A — edge topology and sync foundation.
//
// The invariant this service exists to hold: a business mutation that crosses a node boundary is
// applied AT MOST ONCE per eventId, and a payload it cannot fully understand is refused rather
// than partially applied.
//
// Three rules drive every method here:
//
//   1. Idempotency is enforced by a unique constraint on (nodeId, eventId), not by a read-then-
//      write check. Two peers can push the same event concurrently; only the database can settle
//      that, and a SELECT followed by INSERT will happily create a duplicate under a race.
//   2. Unknown schemaVersion fails closed. Forwarding an event the receiver cannot parse would
//      apply a business mutation under a schema nobody validated, which is how inventory and
//      journal postings get duplicated or silently dropped.
//   3. Every applied event writes an audit row naming the originating node. "Where did this stock
//      movement come from" must be answerable after the fact, including across a WAN partition.

const MAX_SUPPORTED_SCHEMA_VERSION = 1;

// POST-1A conflict policy.
//
// The rule is deliberately conservative: a conflict is never auto-resolved in favour of the writer.
// Two branches that each believe they own the last unit must both escalate, because picking a winner
// automatically means silently discarding one branch's completed sale — a customer walked out of a
// store with goods that then do not exist anywhere in the system.
//
// A conflict is therefore RECORDED as PENDING: undecided, waiting for a human. It used to be recorded
// as MANUAL_REVIEW, which made the escalation path a dead end — `resolveConflict` only accepts a
// PENDING conflict, nothing anywhere ever wrote PENDING, and `recoveryPlan` counted PENDING. So every
// conflict escalated to a state that could not be resolved, and the operator queue reported zero
// outstanding conflicts no matter how many were sitting there. `post1a-conflict-escalation-runtime`
// now executes that path; the previous coverage was source regex that pinned the broken guard in
// place.
//
// MANUAL_REVIEW is a legitimate DECISION (the operator examined it and decided a human should keep
// looking), which is a different thing from the undecided state it was being used as.
const RESOLUTION_STRATEGIES = new Set<SyncConflictStrategy>(['KEEP_LOCAL', 'KEEP_REMOTE', 'MANUAL_REVIEW']);
const DEAD_LETTER_THRESHOLD = 8;
const BASE_RETRY_MS = 1000;

@Injectable()
export class BranchSyncService {
  private readonly logger = new Logger(BranchSyncService.name);

  constructor(private readonly prisma: PrismaService, private readonly secrets: SecretProtectorService) {}

  // The shared secret is stored encrypted, never plaintext. A plaintext secret in SyncPeer would be
  // readable by anyone with database access and would let them impersonate a branch node.
  private sealSecret(sharedSecretRef: string): string {
    return /^\{.*\}$/.test(sharedSecretRef.trim()) ? sharedSecretRef : this.secrets.encryptText(sharedSecretRef);
  }

  // ------------------------------------------------------------------ scope

  private requireTenantScope(user: AuthUser) {
    if (!user.companyId) throw new ForbiddenException('Node sinkronisasi harus punya tenant.');
    return { companyId: user.companyId, branchId: user.branchId ?? null };
  }

  // A node may only speak for itself. Cross-node impersonation is the failure mode that would let
  // one branch post inventory under another branch's identity.
  private async requireOwnNode(user: AuthUser, nodeId: string) {
    const scope = this.requireTenantScope(user);
    const node = await this.prisma.syncNode.findFirst({ where: { id: nodeId, companyId: scope.companyId, isActive: true } });
    if (!node) throw new NotFoundException('Node tidak ditemukan pada tenant ini.');
    if (node.branchId && scope.branchId && node.branchId !== scope.branchId) {
      throw new ForbiddenException('Node ini milik branch lain.');
    }
    return { scope, node };
  }

  // ------------------------------------------------------------------ node identity

  async registerNode(user: AuthUser, dto: RegisterSyncNodeDto) {
    const scope = this.requireTenantScope(user);
    if (dto.role === 'BRANCH' && !dto.branchId) throw new BadRequestException('Node BRANCH wajib menunjuk branch.');
    // CENTRAL is unique per tenant. Two central hosts would both consolidate and double-post.
    if (dto.role === 'CENTRAL') {
      const existing = await this.prisma.syncNode.findFirst({ where: { companyId: scope.companyId, role: 'CENTRAL', isActive: true } });
      if (existing && existing.code !== dto.code) throw new ConflictException('Tenant ini sudah punya node CENTRAL aktif.');
    }
    const node = await this.prisma.syncNode.upsert({
      where: { companyId_code: { companyId: scope.companyId, code: dto.code } },
      create: {
        companyId: scope.companyId, code: dto.code, name: dto.name, role: dto.role,
        branchId: dto.branchId ?? null, protocolVersion: dto.protocolVersion ?? 1, metadata: dto.metadata as object | undefined,
      },
      update: { name: dto.name, role: dto.role, branchId: dto.branchId ?? null, protocolVersion: dto.protocolVersion ?? 1, isActive: true, metadata: dto.metadata as object | undefined },
    });
    await this.audit(scope, 'SYNC_NODE_REGISTERED', 'SyncNode', node.id, { code: node.code, role: node.role }, user.sub);
    return node;
  }

  async listNodes(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.syncNode.findMany({ where: { companyId: scope.companyId }, orderBy: { code: 'asc' } });
  }

  async heartbeat(user: AuthUser, nodeId: string, dto: NodeHeartbeatDto) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    // pendingCount is recomputed here, not taken from the caller. A self-reported queue depth is a
    // claim, not evidence; the outbox is the only thing that knows the real number.
    const pending = await this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'PENDING' } });
    const deadLettered = await this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'DEAD_LETTER' } });
    const updated = await this.prisma.syncNode.update({
      where: { id: node.id },
      data: { lastHeartbeatAt: new Date(), metadata: { ...(node.metadata as Record<string, unknown> | null ?? {}), ...(dto.health ?? {}), serverPending: pending, serverDeadLettered: deadLettered } },
    });
    await this.audit(scope, 'SYNC_NODE_HEARTBEAT', 'SyncNode', node.id, { pending, deadLettered }, user.sub);
    return { nodeId: updated.id, serverPending: pending, serverDeadLettered: deadLettered, lastHeartbeatAt: updated.lastHeartbeatAt };
  }

  // ------------------------------------------------------------------ peer registry

  async registerPeer(user: AuthUser, nodeId: string, dto: RegisterPeerDto) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    if (dto.peerNodeId === node.id) throw new BadRequestException('Node tidak boleh menjadi peer dirinya sendiri.');
    const peer = await this.prisma.syncNode.findFirst({ where: { id: dto.peerNodeId, companyId: scope.companyId, isActive: true } });
    if (!peer) throw new NotFoundException('Peer node tidak ditemukan pada tenant ini.');
    const saved = await this.prisma.syncPeer.upsert({
      where: { nodeId_peerNodeId: { nodeId: node.id, peerNodeId: peer.id } },
      create: { companyId: scope.companyId, nodeId: node.id, peerNodeId: peer.id, direction: dto.direction ?? 'BIDIRECTIONAL', sharedSecretRef: this.sealSecret(dto.sharedSecretRef) },
      update: { direction: dto.direction ?? 'BIDIRECTIONAL', sharedSecretRef: this.sealSecret(dto.sharedSecretRef), isActive: true, lastError: null },
    });
    await this.audit(scope, 'SYNC_PEER_REGISTERED', 'SyncPeer', saved.id, { nodeCode: node.code, peerCode: peer.code, direction: saved.direction }, user.sub);
    return saved;
  }

  async listPeers(user: AuthUser, nodeId: string) {
    const { node } = await this.requireOwnNode(user, nodeId);
    // sharedSecretRef is stripped on the way out: a peer listing is an operator screen, and echoing a
    // credential there is how secrets end up in a screenshot or a support ticket.
    return this.prisma.syncPeer.findMany({ where: { nodeId: node.id }, orderBy: { createdAt: 'asc' } }).then((rows) =>
      rows.map(({ sharedSecretRef: _secret, ...rest }) => rest));
  }

  async setPeerActive(user: AuthUser, nodeId: string, peerId: string, dto: SetPeerActiveDto) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    const peer = await this.prisma.syncPeer.findFirst({ where: { id: peerId, nodeId: node.id, companyId: scope.companyId } });
    if (!peer) throw new NotFoundException('Peer tidak ditemukan pada node ini.');
    const updated = await this.prisma.syncPeer.update({ where: { id: peer.id }, data: { isActive: dto.isActive, lastError: dto.isActive ? null : (dto.reason ?? 'Dinonaktifkan operator') } });
    await this.audit(scope, dto.isActive ? 'SYNC_PEER_ENABLED' : 'SYNC_PEER_REVOKED', 'SyncPeer', peer.id, { reason: dto.reason }, user.sub);
    return updated;
  }

  // ------------------------------------------------------------------ outbox

  // Enqueue is the only way a business event enters the sync pipeline. It is deliberately a
  // separate call rather than an interceptor: an interceptor would capture reads and derived
  // values too, and POST-1 section 4 class 4 requires derived data to stay non-authoritative.
  async enqueueEvent(user: AuthUser, nodeId: string, dto: EnqueueSyncEventDto) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    this.assertSchemaVersion(dto.schemaVersion);
    const existing = await this.prisma.syncOutbox.findFirst({ where: { eventId: dto.eventId } });
    if (existing) {
      // Same eventId, same content: a retry, report the original. Same eventId, different content:
      // a genuine protocol violation, never silently overwrite.
      if (this.digest(existing.payload as Record<string, unknown>) !== this.digest(dto.payload)) {
        throw new ConflictException('eventId sudah dipakai dengan payload berbeda.');
      }
      return { eventId: existing.eventId, status: existing.status, duplicate: true };
    }
    const created = await this.prisma.syncOutbox.create({
      data: {
        companyId: scope.companyId, nodeId: node.id, eventId: dto.eventId,
        aggregateType: dto.aggregateType, aggregateId: dto.aggregateId, eventType: dto.eventType,
        schemaVersion: dto.schemaVersion, payload: dto.payload as object,
      },
    });
    return { eventId: created.eventId, status: created.status, duplicate: false };
  }

  // Hand unpublished events to a peer and advance that peer's cursor. Retrying a pull returns the
  // same events: they stay PENDING until the peer acknowledges, so a lost ACK re-delivers rather
  // than dropping the event.
  async pullEvents(user: AuthUser, nodeId: string, dto: PullSyncEventsDto, auth?: BranchSyncAuthService, headers?: Record<string, string | string[] | undefined>) {
    await this.verifyPeerSignature('POST /branch-sync/nodes/:nodeId/pull', { peerNodeId: dto.peerNodeId, cursor: dto.cursor ?? null, limit: dto.limit ?? 200 }, auth, headers);
    const { node } = await this.requireOwnNode(user, nodeId);
    const peer = await this.prisma.syncPeer.findFirst({ where: { nodeId: node.id, peerNodeId: dto.peerNodeId, isActive: true } });
    if (!peer) throw new ForbiddenException('Peer tidak terdaftar aktif pada node ini.');
    if (peer.direction === 'PUSH') throw new BadRequestException('Peer ini hanya push; node tidak boleh menarik darinya.');
    const cursor = await this.prisma.syncCursor.findFirst({ where: { nodeId: node.id, peerNodeId: peer.peerNodeId } });
    // `cursor` is the timestamp position; `lastEventId` is only a label for the operator screen. Reading
    // lastEventId here fed an eventId into Date.parse, so the fallback silently became the epoch and a
    // peer that never sent a cursor re-read the node's entire history on every pull.
    const after = dto.cursor ?? cursor?.cursor ?? null;
    const events = await this.prisma.syncOutbox.findMany({
      where: { nodeId: node.id, status: { in: ['PENDING', 'PUBLISHING'] }, ...(after ? { createdAt: { gte: new Date(Date.parse(after) || 0) } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: dto.limit ?? 200,
    });
    const lag = await this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'PENDING' } });
    return { events, cursor: events.at(-1)?.createdAt.toISOString() ?? after, pendingOnNode: lag };
  }

  // Mark delivered events as published. Only an event the peer actually saw may be acknowledged.
  async publishEvents(user: AuthUser, nodeId: string, dto: PublishSyncEventsDto, auth?: BranchSyncAuthService, headers?: Record<string, string | string[] | undefined>) {
    await this.verifyPeerSignature('POST /branch-sync/nodes/:nodeId/publish', dto, auth, headers);
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    // An ACK names events that were ALREADY pulled from this node, so the authoritative version is the
    // one in the outbox row — not whatever the peer echoed back. Validating the echoed field instead
    // meant a peer that sent a minimal `{eventId}` body (which SyncEventDto declares optional) was
    // rejected with "schemaVersion undefined belum didukung", so the documented minimal ACK could not
    // be sent. Fail-closed still holds: a stored event at an uninterpretable version is refused.
    const acked: string[] = [];
    for (const event of dto.events) {
      const row = await this.prisma.syncOutbox.findFirst({ where: { nodeId: node.id, eventId: event.eventId } });
      if (!row) throw new NotFoundException(`Event ${event.eventId} tidak ada pada outbox node ini.`);
      this.assertSchemaVersion(row.schemaVersion);
      // A replayed ACK is a no-op, not an error: the peer may retry after a response timeout.
      if (row.status !== 'PUBLISHED') {
        await this.prisma.syncOutbox.update({ where: { id: row.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null, attempts: { increment: 1 } } });
        acked.push(row.eventId);
      }
    }
    await this.advanceCursor(scope, node, dto.events.at(-1)?.eventId ?? null);
    return { acknowledged: acked.length, eventIds: acked };
  }

  // ------------------------------------------------------------------ inbound

  // The receiving side. This is where a duplicate must be provably harmless.
  async receiveEvents(user: AuthUser, nodeId: string, peerNodeId: string, events: EnqueueSyncEventDto[] = [], auth?: BranchSyncAuthService, headers?: Record<string, string | string[] | undefined>) {
    // The guard has already authenticated the signature; re-verifying here keeps the check next to
    // the mutation it protects, and confirms the peer that signed is the peer the body claims.
    const identity = await this.verifyPeerSignature('POST /branch-sync/nodes/:nodeId/receive', { peerNodeId, events }, auth, headers);
    if (identity && identity.peerNodeId !== peerNodeId) {
      throw new ForbiddenException('Peer pengirim pada signature tidak cocok dengan peerNodeId pada body.');
    }
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    const peer = await this.prisma.syncNode.findFirst({ where: { id: peerNodeId, companyId: scope.companyId, isActive: true } });
    if (!peer) throw new NotFoundException('Peer pengirim tidak dikenal pada tenant ini.');
    const registration = await this.prisma.syncPeer.findFirst({ where: { nodeId: node.id, peerNodeId: peer.id, isActive: true } });
    if (!registration) throw new ForbiddenException('Peer tidak terdaftar aktif pada node ini.');

    const results: Array<{ eventId: string; outcome: string; reason?: string }> = [];
    for (const event of events) {
      // Fail closed on a version we cannot interpret. Rejecting one event does not stop the
      // batch: the peer needs to learn which of its events need resending after an upgrade.
      if (this.isUnsupportedVersion(event.schemaVersion)) {
        await this.recordInbox(scope, node, peer, event, 'REJECTED', `unsupported schemaVersion ${event.schemaVersion}`, event.payload);
        results.push({ eventId: event.eventId, outcome: 'REJECTED', reason: `unsupported schemaVersion ${event.schemaVersion}` });
        continue;
      }
      const seen = await this.prisma.syncInbox.findFirst({ where: { nodeId: node.id, eventId: event.eventId } });
      if (seen) {
        // The unique constraint on (nodeId, eventId) is what makes this safe under concurrency.
        // A replay returns the ORIGINAL outcome, so a duplicate is observably a duplicate.
        results.push({ eventId: event.eventId, outcome: 'DUPLICATE', reason: `already ${seen.outcome}` });
        continue;
      }
      const created = await this.prisma.syncInbox.create({
        data: {
          companyId: scope.companyId, nodeId: node.id, peerNodeId: peer.id, eventId: event.eventId,
          eventType: event.eventType, schemaVersion: event.schemaVersion, outcome: 'APPLIED',
          payloadDigest: this.digest(event.payload),
        },
      }).catch((error: unknown) => {
        // P2002 = unique violation. Two concurrent deliveries of the same event; the other one won.
        if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') return null;
        throw error;
      });
      if (!created) { results.push({ eventId: event.eventId, outcome: 'DUPLICATE', reason: 'concurrent delivery' }); continue; }
      // Applying an event IS an observation of that aggregate's version. Skipping this leaves the
      // watermark at whatever the local writer last set, so a later detectConflict compares against a
      // version the receiver never actually reached: a strictly sequential write reads as a conflict,
      // and a real conflict reads as one for the wrong reason. The service comment at advanceVersion
      // warns about the mirror-image failure (nobody advances it, every comparison reads 0); this is
      // the write side of that table going missing on the receiving node.
      const declared = this.readVersion(event.payload as Record<string, unknown>);
      if (declared !== null) await this.advanceWatermark(scope, node.id, event.aggregateType, event.aggregateId, declared);
      results.push({ eventId: event.eventId, outcome: 'APPLIED' });
    }
    await this.prisma.syncPeer.update({ where: { id: registration.id }, data: { lastSyncAt: new Date(), lastError: null } });
    const duplicates = results.filter((r) => r.outcome === 'DUPLICATE').length;
    // The counter lives on the node, incremented only when something was actually suppressed. It was
    // previously derived by counting SyncInbox rows with outcome DUPLICATE — impossible, because that
    // table is uniquely keyed on (nodeId, eventId) and a duplicate never gets a row. The admin panel
    // showed a permanent 0 next to the label "Duplikat ditekan", which reads as "duplication never
    // happens here" no matter how much a peer retried.
    if (duplicates > 0) {
      await this.prisma.syncNode.update({ where: { id: node.id }, data: { duplicatesSuppressed: { increment: duplicates } } });
    }
    await this.audit(scope, 'SYNC_EVENTS_RECEIVED', 'SyncNode', node.id, { peer: peer.code, count: results.length, outcomes: results.map((r) => r.outcome) }, user.sub);
    return { results, applied: results.filter((r) => r.outcome === 'APPLIED').length, duplicates, rejected: results.filter((r) => r.outcome === 'REJECTED').length };
  }

  // ------------------------------------------------------------------ observability

  // Lag, pending, failed and dead-letter counts, computed from the outbox. These are the numbers
  // the roadmap's "observable lag" requirement is about; a caller cannot supply them.
  async syncHealth(user: AuthUser, nodeId?: string) {
    const scope = this.requireTenantScope(user);
    const nodes = await this.prisma.syncNode.findMany({ where: { companyId: scope.companyId, ...(nodeId ? { id: nodeId } : {}) }, orderBy: { code: 'asc' } });
    const perNode = [];
    for (const node of nodes) {
      const [pending, publishing, failed, deadLettered] = await Promise.all([
        this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'PENDING' } }),
        this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'PUBLISHING' } }),
        this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'FAILED' } }),
        this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'DEAD_LETTER' } }),
      ]);
      const cursors = await this.prisma.syncCursor.findMany({ where: { nodeId: node.id } });
      // Read from the node's own counter, incremented by receiveEvents. Deriving it from SyncInbox was
      // structurally impossible: a duplicate is suppressed by the (nodeId, eventId) unique constraint,
      // so no DUPLICATE row is ever created for the count to find.
      const duplicates = node.duplicatesSuppressed;
      perNode.push({
        nodeId: node.id, code: node.code, role: node.role, lastHeartbeatAt: node.lastHeartbeatAt,
        pending, publishing, failed, deadLettered, duplicatesSuppressed: duplicates,
        peers: cursors.map((c) => ({ peerNodeId: c.peerNodeId, lastSyncAt: c.lastSyncAt, lagCount: c.lagCount })),
      });
    }
    return { nodes: perNode, generatedAt: new Date().toISOString() };
  }

  async listDeadLetters(user: AuthUser, nodeId: string) {
    const { node } = await this.requireOwnNode(user, nodeId);
    return this.prisma.syncOutbox.findMany({ where: { nodeId: node.id, status: 'DEAD_LETTER' }, orderBy: { deadLetteredAt: 'desc' }, take: 200 });
  }

  // Requeue a dead-lettered event. The eventId is unchanged on purpose: resending the SAME event
  // id is what proves the receiver's duplicate suppression works.
  async requeueDeadLetter(user: AuthUser, nodeId: string, eventId: string) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    const row = await this.prisma.syncOutbox.findFirst({ where: { nodeId: node.id, eventId } });
    if (!row) throw new NotFoundException('Event tidak ada pada outbox node ini.');
    if (row.status !== 'DEAD_LETTER') throw new BadRequestException(`Event berstatus ${row.status}, bukan DEAD_LETTER.`);
    const updated = await this.prisma.syncOutbox.update({ where: { id: row.id }, data: { status: 'PENDING', attempts: 0, deadLetteredAt: null, lastError: null, nextRetryAt: null } });
    await this.audit(scope, 'SYNC_DEAD_LETTER_REQUEUED', 'SyncOutbox', row.id, { eventId }, user.sub);
    return updated;
  }

  // Record a delivery failure with bounded backoff, dead-lettering after enough attempts so one
  // poisonous event cannot block the queue forever.
  async recordFailure(user: AuthUser, nodeId: string, eventId: string, error: string) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    const row = await this.prisma.syncOutbox.findFirst({ where: { nodeId: node.id, eventId } });
    if (!row) throw new NotFoundException('Event tidak ada pada outbox node ini.');
    const attempts = row.attempts + 1;
    const dead = attempts >= DEAD_LETTER_THRESHOLD;
    const backoffMs = BASE_RETRY_MS * 2 ** Math.min(attempts, 10);
    const updated = await this.prisma.syncOutbox.update({
      where: { id: row.id },
      data: { attempts, status: dead ? 'DEAD_LETTER' : 'FAILED', lastError: error.slice(0, 500), deadLetteredAt: dead ? new Date() : null, nextRetryAt: dead ? null : new Date(Date.now() + backoffMs) },
    });
    if (dead) this.logger.error(`Sync event ${eventId} dead-lettered after ${attempts} attempts: ${error}`);
    await this.audit(scope, dead ? 'SYNC_EVENT_DEAD_LETTERED' : 'SYNC_EVENT_FAILED', 'SyncOutbox', row.id, { eventId, attempts, error: error.slice(0, 200) }, user.sub);
    return updated;
  }

  // ------------------------------------------------------------------ bootstrap

  // A new branch starts from a cursor against the central node. It returns instructions, not raw
  // rows: POST-1 section 2 forbids cross-node table overwrite, so the branch must pull through the
  // same versioned event stream every other sync uses.
  async bootstrapBranch(user: AuthUser, nodeId: string, dto: BootstrapBranchDto) {
    const { node } = await this.requireOwnNode(user, nodeId);
    const peer = await this.prisma.syncNode.findFirst({ where: { id: dto.peerNodeId, companyId: node.companyId, role: 'CENTRAL', isActive: true } });
    if (!peer) throw new NotFoundException('Node CENTRAL aktif tidak ditemukan.');
    const registration = await this.prisma.syncPeer.findFirst({ where: { nodeId: node.id, peerNodeId: peer.id, isActive: true } });
    if (!registration) throw new ForbiddenException('Node ini belum terdaftar sebagai peer dari CENTRAL.');
    const pending = await this.prisma.syncOutbox.count({ where: { nodeId: peer.id, status: 'PENDING' } });
    return {
      nodeId: node.id, centralNodeId: peer.id, fromCursor: dto.fromCursor ?? null,
      protocolVersion: node.protocolVersion, pendingOnCentral: pending,
      instruction: 'Pull /branch-sync/:nodeId/pull dari node CENTRAL, lalu replay per event. Jangan menulis tabel lintas node secara langsung.',
    };
  }

  // Advance the per-aggregate version watermark. This is the write side of conflict detection, and
  // omitting it is a silent failure: detectConflict reads this table, so a watermark nobody advances
  // would make every comparison read 0 and report "no conflict" forever.
  //
  // The watermark is monotonic. A stale write arriving late must NOT lower it, because that would
  // let an old event make a newer one look current and hide the very conflict this exists to catch.
  async advanceVersion(user: AuthUser, nodeId: string, aggregateType: string, aggregateId: string, version: number) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    // Reject rather than coerce. `advanceWatermark` is the lenient internal writer (it drops a bad
    // value silently), but an operator route that accepts -1 must not report success while storing
    // nothing — the caller needs to be told the request was malformed.
    if (!Number.isInteger(version) || version < 0) throw new BadRequestException('Version agregat harus bilangan bulat non-negatif.');
    const existing = await this.prisma.syncAggregateVersion.findFirst({
      where: { nodeId: node.id, aggregateType, aggregateId },
    });
    if (existing && existing.version >= version) return existing; // never regress
    const advanced = await this.prisma.syncAggregateVersion.upsert({
      where: { nodeId_aggregateType_aggregateId: { nodeId: node.id, aggregateType, aggregateId } },
      create: { companyId: scope.companyId, nodeId: node.id, aggregateType, aggregateId, version },
      update: { version },
    });
    await this.audit(scope, 'SYNC_AGGREGATE_VERSION_ADVANCED', 'SyncAggregateVersion', advanced.id, { aggregateType, aggregateId, from: existing?.version ?? 0, to: version }, user.sub);
    return advanced;
  }

  // The same monotonic write, without the operator-scope lookup and without an audit row per event.
  // Two callers use it: the operator route above (audited, because a human decided it) and the inbound
  // apply path, where one batch can carry hundreds of events and an audit row per watermark bump would
  // bury the one SYNC_EVENTS_RECEIVED row that actually matters. The RECEIVED row already names the
  // origin node, so the provenance is not lost.
  //
  // The version guard lives HERE, not only in advanceVersion: this path is fed by a remote payload, so
  // the value arrives from the wire and never passed the operator route's check. A negative or
  // non-integer version written as a watermark would make every later comparison meaningless.
  private async advanceWatermark(scope: { companyId: string }, nodeId: string, aggregateType: string, aggregateId: string, version: number) {
    if (!Number.isInteger(version) || version < 0) return null;
    const existing = await this.prisma.syncAggregateVersion.findFirst({ where: { nodeId, aggregateType, aggregateId } });
    if (existing && existing.version >= version) return existing; // never regress
    return this.prisma.syncAggregateVersion.upsert({
      where: { nodeId_aggregateType_aggregateId: { nodeId, aggregateType, aggregateId } },
      create: { companyId: scope.companyId, nodeId, aggregateType, aggregateId, version },
      update: { version },
    });
  }

  // ------------------------------------------------------------------ conflict

  // Detect a conflict without applying anything. Called by the conflict resolver and by the
  // operator screen; returns the observed version so the caller can decide, never applies silently.
  async detectConflict(user: AuthUser, nodeId: string, eventId: string) {
    const { node } = await this.requireOwnNode(user, nodeId);
    const outbox = await this.prisma.syncOutbox.findFirst({ where: { nodeId: node.id, eventId } });
    if (!outbox) throw new NotFoundException('Event tidak ada pada outbox node ini.');
    const baseVersion = this.readVersion(outbox.payload as Record<string, unknown>);
    const watermark = await this.prisma.syncAggregateVersion.findFirst({
      where: { nodeId: node.id, aggregateType: outbox.aggregateType, aggregateId: outbox.aggregateId },
    });
    const observed = watermark?.version ?? 0;
    // A baseVersion of 0 means the writer did not declare one, so there is nothing to compare and we
    // must not report "no conflict" — that would be an invented clean bill of health.
    if (baseVersion === null) throw new BadRequestException('Event tidak membawa baseVersion; konflik tidak dapat dideteksi.');
    return {
      eventId, aggregateType: outbox.aggregateType, aggregateId: outbox.aggregateId,
      baseVersion, observedVersion: observed, conflicted: baseVersion !== observed,
    };
  }

  // Record a conflict. Idempotent on (nodeId, eventId): re-detecting the same conflict must not
  // create a second review row, or a retry storm would flood the operator queue.
  async recordConflict(user: AuthUser, nodeId: string, eventId: string, remoteVersion: number | null) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    const outbox = await this.prisma.syncOutbox.findFirst({ where: { nodeId: node.id, eventId } });
    if (!outbox) throw new NotFoundException('Event tidak ada pada outbox node ini.');
    const baseVersion = this.readVersion(outbox.payload as Record<string, unknown>);
    if (baseVersion === null) throw new BadRequestException('Event tidak membawa baseVersion; konflik tidak dapat direkam.');

    const existing = await this.prisma.syncConflict.findFirst({ where: { nodeId: node.id, eventId } });
    if (existing) return existing;
    const created = await this.prisma.syncConflict.create({
      data: { companyId: scope.companyId, nodeId: node.id, peerNodeId: '', eventId, aggregateType: outbox.aggregateType, aggregateId: outbox.aggregateId, baseVersion, remoteVersion, strategy: 'PENDING' },
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') return null;
      throw error;
    });
    if (!created) {
      const raced = await this.prisma.syncConflict.findFirst({ where: { nodeId: node.id, eventId } });
      if (raced) return raced;
      throw new ConflictException('Konflik tidak dapat direkam.');
    }
    await this.audit(scope, 'SYNC_CONFLICT_RECORDED', 'SyncConflict', created.id, { eventId, baseVersion, remoteVersion, aggregate: `${created.aggregateType}/${created.aggregateId}` }, user.sub);
    return created;
  }

  // Resolve a conflict. The decision and the operator are both persisted: an inventory discrepancy
  // with no recorded decision is indistinguishable from one nobody looked at.
  async resolveConflict(user: AuthUser, nodeId: string, eventId: string, strategy: SyncConflictStrategy, note?: string) {
    const { scope, node } = await this.requireOwnNode(user, nodeId);
    // This method IS the operator's explicit decision, so KEEP_LOCAL and KEEP_REMOTE are reachable
    // here — refusing them with "resolution harus eksplisit oleh operator" contradicted the caller's
    // own role. What is refused is PENDING, because that is the UNDECIDED state, not a resolution.
    // Nothing in this path resolves a conflict automatically: it requires an authenticated operator,
    // records who decided and when, and writes an audit row.
    if (!RESOLUTION_STRATEGIES.has(strategy)) {
      throw new BadRequestException(`${strategy} bukan sebuah resolution; pilih KEEP_LOCAL, KEEP_REMOTE, atau MANUAL_REVIEW.`);
    }
    const conflict = await this.prisma.syncConflict.findFirst({ where: { nodeId: node.id, eventId } });
    if (!conflict) throw new NotFoundException('Konflik tidak ditemukan untuk event ini.');
    if (conflict.strategy !== 'PENDING') throw new BadRequestException(`Konflik sudah berstatus ${conflict.strategy}.`);
    const resolved = await this.prisma.syncConflict.update({
      where: { id: conflict.id },
      data: { strategy, resolution: { note: note ?? null, decidedBy: user.sub, decidedAt: new Date().toISOString() }, resolvedBy: user.sub, resolvedAt: new Date() },
    });
    await this.audit(scope, 'SYNC_CONFLICT_RESOLVED', 'SyncConflict', conflict.id, { eventId, strategy }, user.sub);
    return resolved;
  }

  async listConflicts(user: AuthUser, nodeId: string, strategy?: SyncConflictStrategy) {
    const { node } = await this.requireOwnNode(user, nodeId);
    return this.prisma.syncConflict.findMany({ where: { nodeId: node.id, ...(strategy ? { strategy } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  // ------------------------------------------------------------------ recovery

  // Recovery after a local server is replaced. The new server comes back with an empty database, so
  // it must re-adopt the same node identity and re-derive its position from a cursor rather than
  // from rows. This reports what a replacement server needs; it never copies a table across nodes.
  async recoveryPlan(user: AuthUser, nodeId: string) {
    const { node } = await this.requireOwnNode(user, nodeId);
    const [outboxCounts, cursors, peers, conflicts] = await Promise.all([
      this.prisma.syncOutbox.groupBy({ by: ['status'], where: { nodeId: node.id }, _count: { _all: true } }),
      this.prisma.syncCursor.findMany({ where: { nodeId: node.id } }),
      this.prisma.syncPeer.findMany({ where: { nodeId: node.id, isActive: true } }),
      this.prisma.syncConflict.count({ where: { nodeId: node.id, strategy: 'PENDING' } }),
    ]);
    return {
      nodeId: node.id, code: node.code, role: node.role,
      outboxByStatus: outboxCounts.map((c) => ({ status: c.status, count: c._count._all })),
      cursors: cursors.map((c) => ({ peerNodeId: c.peerNodeId, lastEventId: c.lastEventId, lastSyncAt: c.lastSyncAt, lagCount: c.lagCount })),
      activePeers: peers.map((p) => ({ peerNodeId: p.peerNodeId, direction: p.direction })),
      unresolvedConflicts: conflicts,
      steps: [
        'Daftarkan ulang node dengan code yang sama; upsert mengadopsi identitas yang ada.',
        'Pulihkan secret peer dan daftarkan ulang kredensial setiap peer.',
        'Tarik per peer dari cursor terakhir; jangan menyalin tabel lintas node.',
        'Verifikasi conflict PENDING sebelum membuka transaksi.',
      ],
    };
  }

  // ------------------------------------------------------------------ internals

  // No auth service wired, or no signature headers: the session guards already ran, so this is a
  // legitimate operator call and there is nothing to verify.
  private async verifyPeerSignature(
    operation: string, payload: unknown, auth?: BranchSyncAuthService, headers?: Record<string, string | string[] | undefined>,
  ): Promise<SyncPeerIdentity | null> {
    if (!auth || !headers) return null;
    const hasSignature = ['x-toko360-signature', 'x-toko360-node-code', 'x-toko360-peer-node-code']
      .some((h) => { const v = headers[h] ?? headers[h.toLowerCase()]; const s = Array.isArray(v) ? v[0] : v; return typeof s === 'string' && s.trim().length > 0; });
    if (!hasSignature) return null;
    return auth.authenticate(headers, operation, payload);
  }

  // The writer's believed version, or null when it declared none. Returning null rather than
  // defaulting to 0 is deliberate: "I did not say" and "I was editing version 0" must not look alike.
  private readVersion(payload: Record<string, unknown>): number | null {
    const raw = payload?.baseVersion;
    return Number.isInteger(raw) ? (raw as number) : null;
  }

  private assertSchemaVersion(version: number) {
    if (this.isUnsupportedVersion(version)) {
      throw new BadRequestException(`schemaVersion ${version} belum didukung; versi maksimum ${MAX_SUPPORTED_SCHEMA_VERSION}.`);
    }
  }

  private isUnsupportedVersion(version: number) {
    return !Number.isInteger(version) || version < 1 || version > MAX_SUPPORTED_SCHEMA_VERSION;
  }

  // Key order must not affect the digest, or the same payload serialised differently would look
  // like a different event and defeat duplicate suppression.
  private digest(payload: Record<string, unknown>): string {
    const canonical = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
      }
      return value;
    };
    return JSON.stringify(canonical(payload));
  }

  // The stored position has to be something `pullEvents` can compare against. It compares with
  // `createdAt >= after`, so an eventId is the wrong type here: `Date.parse('sale-0003-cccc')` is NaN,
  // which collapsed to `new Date(0)` and made every stored cursor mean "from the beginning of time".
  // The column named `cursor` existed for exactly this and was never written; lastEventId stays as the
  // human-readable identity of the last acked event, which is what the operator screens display.
  private async advanceCursor(scope: { companyId: string }, node: { id: string }, lastEventId: string | null) {
    if (!lastEventId) return;
    const acked = await this.prisma.syncOutbox.findFirst({
      where: { nodeId: node.id, eventId: lastEventId }, select: { createdAt: true },
    });
    const position = (acked?.createdAt ?? new Date()).toISOString();
    const cursors = await this.prisma.syncCursor.findMany({ where: { nodeId: node.id } });
    for (const cursor of cursors) {
      const lag = await this.prisma.syncOutbox.count({ where: { nodeId: node.id, status: 'PENDING' } });
      await this.prisma.syncCursor.update({
        where: { id: cursor.id },
        data: { lastEventId, cursor: position, lastSyncAt: new Date(), lagCount: lag },
      });
    }
    await this.prisma.syncCursor.upsert({
      where: { nodeId_peerNodeId: { nodeId: node.id, peerNodeId: node.id } },
      update: { lastEventId, cursor: position, lastSyncAt: new Date() },
      create: { companyId: scope.companyId, nodeId: node.id, peerNodeId: node.id, lastEventId, cursor: position, lastSyncAt: new Date() },
    });
  }

  private async recordInbox(
    scope: { companyId: string }, node: { id: string }, peer: { id: string },
    event: EnqueueSyncEventDto, outcome: 'APPLIED' | 'REJECTED', errorMessage: string, payload: Record<string, unknown>,
  ) {
    await this.prisma.syncInbox.create({
      data: { companyId: scope.companyId, nodeId: node.id, peerNodeId: peer.id, eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion, outcome, errorMessage, payloadDigest: this.digest(payload) },
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') return undefined;
      throw error;
    });
  }

  private async audit(
    scope: { companyId: string; branchId: string | null }, action: string, entityType: string, entityId: string,
    payload: Record<string, unknown>, actorUserId?: string,
  ) {
    // AuditLog has no branchId column. The branch scope travels inside payload so the audit row
    // still records WHERE the mutation happened, which is what makes a cross-node replay auditable.
    await this.prisma.auditLog.create({ data: { companyId: scope.companyId, userId: actorUserId ?? null, action, entityType, entityId, payload: { ...payload, branchId: scope.branchId } as object } }).catch((error: unknown) => {
      this.logger.error(`Audit write failed for ${action}: ${String(error)}`);
    });
  }
}
