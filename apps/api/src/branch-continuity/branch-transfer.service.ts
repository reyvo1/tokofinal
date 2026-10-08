import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { SecretProtectorService } from '../platform/secret-protector.service';
import { BranchContinuityService } from './branch-continuity.service';

// POST-1B — controlled inter-branch transfer while one branch is offline.
//
// The existing StockTransfer lifecycle is correct and is NOT modified here. shipTransfer already
// decrements the source and moves serials to IN_TRANSIT, which is the honest accounting for goods
// that have physically left: the stock is in the van, not at the destination, and pretending
// otherwise would make the source's inventory lie.
//
// What that lifecycle cannot express is the acknowledgement leg when the destination branch is
// unreachable. So this service adds exactly that, and nothing else:
//
//   - the shipment is recorded locally at the source the moment goods leave, never waiting for a
//     branch that cannot be asked;
//   - the destination confirms later, with the quantity it actually received;
//   - a mismatch is DISCREPANT and escalates, because a silent reconciliation here is how a branch
//     runs out of stock that the paperwork says it has.
//
// One invariant worth stating plainly: this never moves stock. A transfer that has not been received
// by the destination leaves the stock in transit, visible and counted, and no amount of connectivity
// failure is a reason to post it into the destination's inventory as if it arrived.

@Injectable()
export class BranchTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly continuity: BranchContinuityService,
    private readonly secrets: SecretProtectorService,
  ) {}

  private tenant(user: AuthUser) {
    if (!user.companyId) throw new ForbiddenException('Transfer antar-cabang harus punya tenant.');
    return { companyId: user.companyId, branchId: user.branchId ?? null };
  }

  // ---------------------------------------------------------------- departure

  // Called immediately after a successful shipTransfer, while the operator is standing at the source
  // branch with the goods gone. This must not require the destination to be reachable.
  async registerDeparture(user: AuthUser, transferId: string) {
    const scope = this.tenant(user);
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id: transferId, number: { not: '' } },
      include: { items: true },
    });
    if (!transfer) throw new NotFoundException('Transfer tidak ditemukan.');
    // Only a shipped transfer has a departure. Recording one earlier would claim goods are in the van
    // while they are still on the shelf.
    if (transfer.status !== 'SHIPPED' && transfer.status !== 'PARTIALLY_RECEIVED') {
      throw new BadRequestException(`Transfer berstatus ${transfer.status}; baru SHIPPED atau PARTIALLY_RECEIVED yang punya catatan keberangkatan.`);
    }
    const warehouses = await this.prisma.warehouse.findMany({
      where: { id: { in: [transfer.sourceWarehouseId, transfer.destinationWarehouseId] } },
    });
    const source = warehouses.find((w) => w.id === transfer.sourceWarehouseId);
    const destination = warehouses.find((w) => w.id === transfer.destinationWarehouseId);
    if (!source || !destination) throw new NotFoundException('Gudang asal atau tujuan tidak ditemukan.');
    if (source.branchId && scope.branchId && source.branchId !== scope.branchId) {
      throw new ForbiddenException('Transfer ini bukan milik branch aktif Anda.');
    }
    // Cross-tenant guard: a transfer whose branches belong to another company must never be tracked
    // or acknowledged here, or a legitimate-looking id would cross a tenant boundary. Warehouse has no
    // companyId of its own — tenant comes through branchId, so the branch is what must be checked.
    const branchIds = [source.branchId, destination.branchId].filter((id): id is string => Boolean(id));
    if (branchIds.length) {
      const owners = await this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, companyId: true } });
      if (owners.some((b) => b.companyId !== scope.companyId)) {
        throw new NotFoundException('Transfer tidak ditemukan pada tenant ini.');
      }
    }

    const sourceNode = await this.prisma.syncNode.findFirst({ where: { companyId: scope.companyId, branchId: source.branchId, isActive: true } });
    if (!sourceNode) throw new BadRequestException('Cabang asal belum terdaftar sebagai node sinkronisasi; transfer tidak dapat dilacak lintas cabang.');
    const destinationNode = await this.prisma.syncNode.findFirst({ where: { companyId: scope.companyId, branchId: destination.branchId, isActive: true } });

    const sourceQuantity = transfer.items.reduce((sum, item) => sum + (item.shippedQty ?? 0), 0);
    // The event id is derived from the transfer, so re-registering the same departure replays rather
    // than duplicating. That is what lets a caller retry safely after a network hiccup.
    const shippedEventId = `stock-transfer-shipped:${transferId}`;
    const row = await this.prisma.branchTransferSync.upsert({
      where: { transferId },
      create: {
        companyId: scope.companyId, transferId, sourceNodeId: sourceNode.id,
        destinationNodeId: destinationNode?.id ?? null, shippedEventId,
        state: 'AWAITING_DESTINATION', sourceQuantity,
      },
      update: { sourceQuantity, shippedEventId, destinationNodeId: destinationNode?.id ?? null },
    });
    // The outbox entry is what actually reaches the destination when it reconnects. Enqueuing it here
    // means the branch keeps working with no destination connectivity at all.
    await this.prisma.syncOutbox.create({
      data: {
        companyId: scope.companyId, nodeId: sourceNode.id, eventId: shippedEventId,
        aggregateType: 'StockTransfer', aggregateId: transferId, eventType: 'STOCK_TRANSFER_SHIPPED_OFFLINE',
        payload: { transferId, number: transfer.number, sourceWarehouseId: source.id, destinationWarehouseId: destination.id, destinationBranchId: destination.branchId, sourceQuantity, shippedAt: transfer.shippedAt?.toISOString() ?? null },
      },
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') return undefined;
      throw error;
    }); // duplicate eventId is a safe replay; every other persistence failure stays fatal

    await this.prisma.auditLog.create({
      data: {
        companyId: scope.companyId, userId: user.sub, action: 'BRANCH_TRANSFER_DEPARTED',
        entityType: 'StockTransfer', entityId: transferId,
        payload: { sourceBranchId: source.branchId, destinationBranchId: destination.branchId, sourceQuantity, destinationReachable: Boolean(destinationNode) },
      },
    });
    return { transferId, state: row.state, sourceQuantity, destinationReachable: Boolean(destinationNode), eventId: shippedEventId };
  }

  // ---------------------------------------------------------------- arrival

  // The destination side, run when the branch has the goods in front of it. It records what was
  // physically counted; it does not post inventory — that stays with the existing receiveTransfer,
  // which this deliberately does not call or replace.
  async acknowledgeArrival(user: AuthUser, transferId: string, dto: { receivedQuantity: number; note?: string }) {
    const scope = this.tenant(user);
    if (!Number.isInteger(dto.receivedQuantity) || dto.receivedQuantity < 0) {
      throw new BadRequestException('Jumlah diterima harus bilangan bulat non-negatif.');
    }
    const row = await this.prisma.branchTransferSync.findFirst({ where: { companyId: scope.companyId, transferId } });
    if (!row) throw new NotFoundException('Transfer tidak memiliki catatan keberangkatan lintas cabang.');
    if (row.destinationAckedAt) throw new BadRequestException('Kedatangan transfer ini sudah pernah dikonfirmasi.');

    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id: transferId },
      include: { items: true },
    });
    if (!transfer) throw new NotFoundException('Transfer tidak ditemukan.');
    const destination = await this.prisma.warehouse.findFirst({ where: { id: transfer.destinationWarehouseId } });
    // The confirming branch must be the receiving branch. Otherwise a branch could acknowledge goods
    // arriving somewhere else, and the real destination would never know.
    if (destination?.branchId && scope.branchId && destination.branchId !== scope.branchId) {
      throw new ForbiddenException('Hanya cabang tujuan yang dapat mengonfirmasi kedatangan.');
    }
    // A branch with no physical goods cannot receive: the count is the evidence, and there is none.
    if (dto.receivedQuantity === 0 && row.sourceQuantity > 0) {
      throw new BadRequestException('Jumlah diterima nol tidak sah untuk transfer yang sudah berangkat; gunakan pembatalan dengan alasan.');
    }

    const state = dto.receivedQuantity === row.sourceQuantity ? 'CONVERGED' : 'DISCREPANT';
    const updated = await this.prisma.branchTransferSync.update({
      where: { id: row.id },
      data: {
        destinationAckedAt: new Date(), destinationAckedBy: user.sub, destinationQuantity: dto.receivedQuantity,
        state, discrepancyReason: state === 'DISCREPANT' ? `Kirim ${row.sourceQuantity}, terima ${dto.receivedQuantity}. ${dto.note ?? ''}`.trim() : null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: scope.companyId, userId: user.sub, action: state === 'CONVERGED' ? 'BRANCH_TRANSFER_ACKED' : 'BRANCH_TRANSFER_DISCREPANT',
        entityType: 'StockTransfer', entityId: transferId,
        payload: { sourceQuantity: row.sourceQuantity, destinationQuantity: dto.receivedQuantity, state, note: dto.note ?? null },
      },
    });
    return { transferId, state, sourceQuantity: row.sourceQuantity, destinationQuantity: dto.receivedQuantity, needsReview: state === 'DISCREPANT' };
  }

  // ---------------------------------------------------------------- visibility

  // A transfer awaiting acknowledgement is stock that exists in neither place as usable inventory.
  // That has to be visible to an operator, or the totals quietly stop adding up.
  async listPending(user: AuthUser) {
    const scope = this.tenant(user);
    return this.prisma.branchTransferSync.findMany({
      where: { companyId: scope.companyId, state: { in: ['AWAITING_DESTINATION', 'DISCREPANT'] } },
      orderBy: { updatedAt: 'desc' }, take: 200,
    });
  }

  async transferSyncState(user: AuthUser, transferId: string) {
    const scope = this.tenant(user);
    const row = await this.prisma.branchTransferSync.findFirst({ where: { companyId: scope.companyId, transferId } });
    if (!row) throw new NotFoundException('Belum ada catatan keberangkatan lintas cabang untuk transfer ini.');
    return row;
  }

  // A transfer that never arrived must be abandoned explicitly, by a human, with a reason. There is
  // no automatic timeout that quietly returns goods to the source: the source has already decremented
  // and the serials are IN_TRANSIT, and guessing where they are is how stock goes missing permanently.
  async abandon(user: AuthUser, transferId: string, reason: string) {
    const scope = this.tenant(user);
    if (!reason?.trim()) throw new BadRequestException('Pembatalan transfer lintas cabang wajib disertai alasan.');
    const row = await this.prisma.branchTransferSync.findFirst({ where: { companyId: scope.companyId, transferId } });
    if (!row) throw new NotFoundException('Belum ada catatan keberangkatan lintas cabang untuk transfer ini.');
    if (row.state === 'ABANDONED') throw new BadRequestException('Transfer ini sudah dibatalkan sebelumnya.');
    if (row.destinationAckedAt) throw new BadRequestException('Transfer yang sudah dikonfirmasi kedatangan tidak dapat dibatalkan di sini; reversal dilakukan lewat jurnal.');
    const updated = await this.prisma.branchTransferSync.update({ where: { id: row.id }, data: { state: 'ABANDONED', discrepancyReason: reason.trim() } });
    await this.prisma.auditLog.create({
      data: { companyId: scope.companyId, userId: user.sub, action: 'BRANCH_TRANSFER_ABANDONED', entityType: 'StockTransfer', entityId: transferId, payload: { reason: reason.trim(), sourceQuantity: row.sourceQuantity, note: 'Stok tetap IN_TRANSIT; pengembalian memerlukan jurnal manual.' } },
    });
    return { ...updated, note: 'Stok tetap IN_TRANSIT di gudang asal sampai jurnal pengembalian dibuat.' };
  }

  // The continuity state of the destination, so the operator sees WHY a transfer is still pending.
  async pendingWithConnectivity(user: AuthUser) {
    const rows = await this.listPending(user);
    const enriched = [];
    for (const row of rows) {
      let state: string = 'UNKNOWN';
      try {
        state = (await this.continuity.connectionState(user, row.destinationNodeId ?? row.sourceNodeId)).state;
      } catch {
        state = 'UNKNOWN';
      }
      enriched.push({ ...row, destinationState: state });
    }
    return enriched;
  }
}
