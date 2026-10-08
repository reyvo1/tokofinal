import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { MobileOpsService } from './mobile-ops.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * POST-1C — the Telegram command surface.
 *
 * The service below it was written with a comment saying `assertPermission` is "called by every
 * command handler", and no command handler existed. Every capability the roadmap lists for Telegram
 * (lookup, price, draft capture) was reachable only by calling HTTP routes with a session token, so
 * the wave had no functional path on the platform it was designed for.
 *
 * Three decisions worth stating, because each one closes a way this could become a hole:
 *
 *   1. **Transport-agnostic.** This class knows nothing about Telegram's API — no webhook secret, no
 *      bot token, no HTTP client. It takes a platform user id and a line of text, and returns a
 *      string. That is what makes it executable in a test against a real database instead of
 *      asserted in source, and it means the worker can add a polling loop without this file ever
 *      gaining the ability to write to a database directly.
 *
 *   2. **Company and branch are never parsed from the command.** They come from the resolved
 *      employee, inside `assertPermission`. A chat that says `/buka dev-1 <other-branch-warehouse>`
 *      is refused by the service's own tenant scoping — not by a check here that could be forgotten.
 *
 *   3. **An unbound chat and a revoked binding get the same words.** Distinguishing them would turn
 *      the bot into an oracle for which platform ids exist in the system.
 */
export type CommandResult = { ok: boolean; reply: string };

const HELP = [
  'Perintah stok:',
  '/stok <barcode|sku> — nama produk, satuan, harga jual',
  '/buka <perangkat> <gudang> [lokasi] [opnameId] — buka atau lanjut draft hitungan',
  '/scan <draftId> <barcode|sku> <jumlah> — tambah hitungan',
  '/selisih <draftId> — bandingkan hitungan dengan snapshot',
  '/kirim <draftId> <opnameId> — kirim hitungan ke opname kanonik',
  '/batal <draftId> <alasan> — batalkan draft',
].join('\n');

/** One refusal for every way a chat can fail to be an authorized employee. */
const UNBOUND = 'Identitas Telegram tidak terikat ke employee aktif. Perintah ditolak.';

@Injectable()
export class TelegramCommandService {
  private readonly logger = new Logger(TelegramCommandService.name);

  constructor(
    private readonly mobileOps: MobileOpsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Run one command. Never throws: a transport adapter must not have to know which failures are
   * refusals and which are bugs, and a thrown exception out of a chat handler is how a stack trace
   * ends up in front of an operator.
   */
  async execute(platformUserId: string, text: string): Promise<CommandResult> {
    const line = (text ?? '').trim();
    if (!line) return { ok: false, reply: 'Perintah kosong. Kirim /bantuan untuk daftar perintah.' };

    const [rawCommand, ...rest] = line.split(/\s+/);
    const command = rawCommand.replace(/^\/+/, '').toLowerCase();
    const args = rest.filter(Boolean);

    // Help is deliberately the only command that does not resolve an identity. It reveals nothing but
    // syntax, and refusing it would leave a legitimately bound operator with no way to learn the
    // vocabulary when they have just been bound.
    if (command === 'bantuan' || command === 'help') return { ok: true, reply: HELP };

    try {
      const result = await this.dispatch(command, platformUserId, args);
      await this.audit(platformUserId, command, args, result, null);
      return result;
    } catch (error) {
      // A refusal is exactly the event an auditor wants to see, so it is recorded before the generic
      // wording is applied. The audit row carries the real reason; the chat never does.
      const reason = error instanceof Error ? error.message : String(error);
      await this.audit(platformUserId, command, args, { ok: false, reply: reason }, reason);
      return { ok: false, reply: this.explain(error) };
    }
  }

  private async dispatch(command: string, platformUserId: string, args: string[]): Promise<CommandResult> {
    switch (command) {
      case 'stok': return await this.lookup(platformUserId, args);
      case 'buka': return await this.openDraft(platformUserId, args);
      case 'scan': return await this.scan(platformUserId, args);
      case 'selisih': return await this.discrepancy(platformUserId, args);
      case 'kirim': return await this.submit(platformUserId, args);
      case 'batal': return await this.discard(platformUserId, args);
      default:
        return { ok: false, reply: `Perintah /${command} tidak dikenal. Kirim /bantuan.` };
    }
  }

  /**
   * One row per command attempt, successful or not.
   *
   * Four things this is built to get right, each of which a naive "log it and move on" gets wrong:
   *
   *   1. **Refusals are the interesting ones.** An unbound chat and a revoked binding are the events a
   *      supervisor needs to see after the fact, so they are written even though no scope exists yet.
   *      `companyId` and `userId` stay null there; the platform id in the payload is what identifies
   *      the chat.
   *   2. **Args are recorded, but never secrets.** A barcode or an opname id is evidence. The command
   *      text itself is not stored — it could carry anything the operator typed, and an audit trail
   *      should not become a second copy of unvetted input.
   *   3. **An audit failure cannot break the operator.** This is called after the command already ran;
   *      throwing here would replace a real answer with an error and leave the command's effect
   *      unexplained. The write is caught and logged.
   *   4. **The reply is not stored verbatim.** It can contain product names and stock figures. The
   *      outcome is recorded as ok/failed plus the reason on refusal.
   */
  private async audit(
    platformUserId: string,
    command: string,
    args: string[],
    result: CommandResult,
    refusalReason: string | null,
  ): Promise<void> {
    try {
      const scope = await this.resolveScope(platformUserId);
      await this.prisma.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: scope.userId,
          action: `TELEGRAM_${result.ok ? 'COMMAND' : 'REFUSED'}`,
          entityType: 'TelegramCommand',
          payload: {
            command,
            args,
            ok: result.ok,
            platformUserId,
            employeeId: scope.employeeId,
            branchId: scope.branchId,
            // The reason is domain text only; `explain()` already keeps stack traces out of chats,
            // and this row is the same class of record.
            refusalReason: refusalReason ?? null,
          },
        },
      });
    } catch (error) {
      this.logger.error(`Gagal menulis audit perintah Telegram: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Scope for the audit row. Deliberately the same resolution the commands use, and deliberately
   * tolerant: an unbound chat still deserves a row.
   *
   * `resolveIdentity` returns null — it does not throw — for an unknown, unbound, or terminated
   * identity, and that is the common case here, so null is handled explicitly rather than being left
   * to a catch. An empty scope is not an error: the platform id in the payload is what identifies the
   * chat, and the refusal reason is what the supervisor reads.
   */
  private async resolveScope(platformUserId: string): Promise<{
    companyId: string | null;
    userId: string | null;
    employeeId: string | null;
    branchId: string | null;
  }> {
    const EMPTY = { companyId: null, userId: null, employeeId: null, branchId: null };
    try {
      const identity = await this.mobileOps.resolveIdentity(platformUserId);
      if (!identity) return EMPTY;
      return {
        companyId: identity.companyId ?? null,
        userId: identity.userId ?? null,
        employeeId: identity.employeeId ?? null,
        branchId: identity.branchId ?? null,
      };
    } catch {
      return EMPTY;
    }
  }

  // ---------------------------------------------------------------- commands

  private async lookup(platformUserId: string, args: string[]): Promise<CommandResult> {
    const code = args[0];
    if (!code) return { ok: false, reply: 'Gunakan: /stok <barcode|sku>' };
    const identity = await this.mobileOps.assertPermission(platformUserId, 'inventory.opname');
    const user = this.asUser(identity);
    const product = await this.mobileOps.findProductForLookup(user, code);
    if (!product) return { ok: false, reply: `Produk ${code} tidak ditemukan atau tidak aktif.` };
    return {
      ok: true,
      reply: [
        product.name,
        `SKU ${product.sku}${product.barcode ? ` · barcode ${product.barcode}` : ''}`,
        `Satuan ${product.unit} · Harga jual Rp ${product.salePrice}`,
      ].join('\n'),
    };
  }

  private async openDraft(platformUserId: string, args: string[]): Promise<CommandResult> {
    const [deviceId, warehouseId, locationId, opnameId] = args;
    if (!deviceId || !warehouseId) return { ok: false, reply: 'Gunakan: /buka <perangkat> <gudang> [lokasi] [opnameId]' };
    const identity = await this.mobileOps.assertPermission(platformUserId, 'inventory.opname');
    const draft = await this.mobileOps.openDraft(this.asUser(identity), { deviceId, warehouseId, locationId, opnameId });
    return {
      ok: true,
      reply: `${draft.resumed ? 'Draft dilanjutkan' : 'Draft dibuat'}: ${draft.id} (${draft.lineCount} baris)`
        + (draft.opnameId ? ` · opname ${draft.opnameId}` : ' · belum terikat opname'),
    };
  }

  private async scan(platformUserId: string, args: string[]): Promise<CommandResult> {
    const [draftId, code, quantity] = args;
    if (!draftId || !code || !quantity) return { ok: false, reply: 'Gunakan: /scan <draftId> <barcode|sku> <jumlah>' };
    const count = Number(quantity);
    if (!Number.isFinite(count)) return { ok: false, reply: 'Jumlah harus berupa angka.' };
    const identity = await this.mobileOps.assertPermission(platformUserId, 'inventory.opname');
    const saved = await this.mobileOps.addScan(this.asUser(identity), draftId, { barcode: code, quantity: count });
    return { ok: true, reply: `Tercatat. Draft ${saved.id}: ${saved.lineCount} baris, ${saved.totalUnits} unit.` };
  }

  private async discrepancy(platformUserId: string, args: string[]): Promise<CommandResult> {
    const [draftId] = args;
    if (!draftId) return { ok: false, reply: 'Gunakan: /selisih <draftId>' };
    const identity = await this.mobileOps.assertPermission(platformUserId, 'inventory.opname');
    const review = await this.mobileOps.reviewDiscrepancy(this.asUser(identity), draftId);
    // Field names come from reviewDiscrepancy itself (counted/system/difference, not quantity/systemQty):
    // a guess here would render "undefined" into a chat and still look like a working feature.
    const lines = review.lines.map((l) =>
      `  ${l.productName ?? l.key}: sistem ${l.system ?? '-'} / hitung ${l.counted}`
      + (l.difference === null ? ' (belum ada snapshot)' : ` (${l.difference > 0 ? '+' : ''}${l.difference})`));
    return {
      ok: true,
      reply: [
        `Draft ${review.draftId} — selisih${review.opnameId ? ` · opname ${review.opnameId}` : ''}`,
        ...(lines.length ? lines : ['  (belum ada baris)']),
        ...(review.unresolved ? [`${review.unresolved} baris tidak dapat dipetakan ke produk.`] : []),
      ].join('\n'),
    };
  }

  private async submit(platformUserId: string, args: string[]): Promise<CommandResult> {
    const [draftId, opnameId] = args;
    if (!draftId || !opnameId) return { ok: false, reply: 'Gunakan: /kirim <draftId> <opnameId>' };
    const identity = await this.mobileOps.assertPermission(platformUserId, 'inventory.opname');
    const result = await this.mobileOps.submitDraft(this.asUser(identity), draftId, opnameId);
    return {
      ok: true,
      reply: `Terkirim ke opname ${result.opnameId}: ${result.filledItems} item terisi.`
        + ' Pengajuan dan persetujuan tetap lewat alur StockOpname kanonik.',
    };
  }

  private async discard(platformUserId: string, args: string[]): Promise<CommandResult> {
    const [draftId, ...reasonParts] = args;
    if (!draftId) return { ok: false, reply: 'Gunakan: /batal <draftId> <alasan>' };
    const reason = reasonParts.join(' ').trim();
    if (!reason) return { ok: false, reply: 'Alasan pembatalan wajib diisi.' };
    const identity = await this.mobileOps.assertPermission(platformUserId, 'inventory.opname');
    await this.mobileOps.discardDraft(this.asUser(identity), draftId, reason);
    return { ok: true, reply: `Draft ${draftId} dibatalkan.` };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Build the AuthUser the existing service methods take.
   *
   * `userId` is asserted, not assumed. An employee with no linked platform user resolves with no roles
   * and no permissions, so `assertPermission` already refuses them — but that coupling is implicit and
   * a future permission change could invert it. A tenant scope with no subject is not an authority.
   */
  asUser(identity: { userId: string | null; employeeId: string; companyId: string; branchId: string | null; employeeName: string; roles: string[]; permissions: string[] }): AuthUser {
    if (!identity.userId) throw new BadRequestException('Employee tidak tertaut ke user platform.');
    return {
      sub: identity.userId,
      email: '',
      name: identity.employeeName,
      companyId: identity.companyId,
      branchId: identity.branchId,
      roles: identity.roles,
      permissions: identity.permissions,
    };
  }

  /**
   * Turn a refusal into words an operator can act on, without leaking internals. Known domain
   * refusals keep their message; anything else is logged here and reported as a generic failure, so a
   * Prisma error can never reach a chat.
   */
  private explain(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/tidak terikat ke employee aktif|tidak memiliki izin/i.test(message)) {
      this.logger.warn(`Perintah Telegram ditolak: ${message}`);
      return UNBOUND;
    }
    if (/tidak ditemukan pada tenant ini/i.test(message)) return message;
    if (/wajib diisi|mustahil|harus|perlu server|tidak dapat|sudah berstatus/i.test(message)) return message;
    this.logger.error(`Kesalahan tidak terduga pada perintah Telegram: ${message}`);
    return 'Perintah gagal diproses. Coba lagi atau hubungi supervisor.';
  }
}
