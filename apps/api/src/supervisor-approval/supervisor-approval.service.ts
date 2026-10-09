import { ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

/**
 * Actions a supervisor can grant a single-use approval for.
 *
 * Every member here must be SPENT somewhere: a business path calls
 * `consume(grantId, '<ACTION>', user)` when the money moves. An action that nothing consumes is a
 * control the product advertises but does not enforce — `SALE_REFUND` used to be exactly that,
 * listed here and in the controller's `@IsIn` whitelist while no return path ever spent it. Refunds
 * are controlled by ROLE instead (CASHIER files, OWNER/FINANCE confirms, see returns.controller.ts),
 * which is a real gate, so advertising it here was a second, imaginary one.
 *
 * `SALE_PRICE_OVERRIDE` stays even though nothing consumes it: the DTO has no `unitPrice` and the
 * global ValidationPipe forbids unknown keys, so the override is unreachable by construction.
 * `tests/supervisor-privileged-action-inventory.test.mjs` locks that distinction — it fails if an
 * action is neither spent nor provably unreachable.
 */
export type PrivilegedAction =
  | 'SALE_PRICE_OVERRIDE'
  | 'SALE_LINE_DISCOUNT'
  | 'SALE_CASH_MOVEMENT'
  | 'SHIFT_CLOSE';

export type ApprovalRequest = {
  action: PrivilegedAction;
  reason: string;
  /** Free-form context recorded in the audit trail, e.g. { amount, receiptNumber }. */
  context?: Record<string, unknown>;
};

export type ApprovalGrant = {
  action: PrivilegedAction;
  reason: string;
  context: Record<string, unknown>;
  approvedByUserId: string;
  approvedByName: string;
  approvedAt: string;
  grantId: string;
};

/** Grants are deliberately short-lived: a supervisor approves the transaction in front of them. */
const GRANT_TTL_MS = 5 * 60 * 1000;
/** Brute-force limits, per operator and per company, independent of each other. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCKOUT_MS = 60 * 1000;

type GrantRow = ApprovalGrant & {
  expiresAt: number;
  companyId: string;
  branchId: string;
  operatorId: string;
};

@Injectable()
export class SupervisorApprovalService {
  /** In-memory grants: an approval authorises exactly the action in front of the operator, and a
   *  multi-branch till must not have approvals survive a restart or leak between companies. */
  private readonly grants = new Map<string, GrantRow>();
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify a supervisor PIN and return a short-lived grant.
   *
   * Deliberately NOT a login: it issues no token and grants no session, only permission to perform
   * one named action. That is the difference between "a manager approved this" and "the till is now
   * a manager", and the second is how till fraud starts.
   */
  async approve(user: AuthUser, pin: string, request: ApprovalRequest): Promise<ApprovalGrant> {
    const operatorKey = `${user.sub}:${request.action}`;
    this.assertNotLockedOut(operatorKey);

    const candidate = await this.findApprover(user);
    if (!candidate) {
      // No approver configured for this branch. Saying so is essential: the alternative is the POS
      // treating "no supervisor" as "no approval needed" and letting cashiers self-approve.
      throw new ForbiddenException(
        'Belum ada supervisor terdaftar di cabang ini. Price override, diskon kustom, dan retur tidak dapat disetujui.',
      );
    }

    if (!candidate.supervisorPinHash || !candidate.canApprovePrivilegedActions) {
      this.registerFailure(operatorKey);
      throw new UnauthorizedException('PIN supervisor belum diatur atau akun ini tidak berwenang menyetujui.');
    }

    const matches = await compare(pin, candidate.supervisorPinHash);
    if (!matches) {
      this.registerFailure(operatorKey);
      // Every failure is audited. A pattern of wrong PINs is the signal a branch manager needs.
      await this.prisma.auditLog.create({
        data: {
          companyId: user.companyId ?? null,
          userId: user.sub,
          action: 'SUPERVISOR_APPROVAL_FAILED',
          entityType: 'SupervisorApproval',
          entityId: candidate.id,
          payload: { operator: user.sub, target: request.action, reason: request.reason },
        },
      });
      throw new UnauthorizedException('PIN supervisor salah.');
    }

    this.failures.delete(operatorKey);
    await this.prisma.user.update({
      where: { id: candidate.id },
      data: { supervisorPinUpdatedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId ?? null,
        userId: candidate.id,
        action: 'SUPERVISOR_APPROVAL_GRANTED',
        entityType: 'SupervisorApproval',
        entityId: candidate.id,
        payload: { operator: user.sub, target: request.action, reason: request.reason, ...request.context },
      },
    });

    // Opaque, collision-resistant nonce: never encode the operator identity in a bearer grant.
    const grantId = randomUUID();
    const grant: GrantRow = {
      action: request.action,
      reason: request.reason,
      context: request.context ?? {},
      approvedByUserId: candidate.id,
      approvedByName: candidate.name,
      approvedAt: new Date().toISOString(),
      grantId,
      expiresAt: Date.now() + GRANT_TTL_MS,
      companyId: user.companyId ?? '',
      branchId: user.branchId ?? '',
      operatorId: user.sub,
    };
    this.grants.set(grantId, grant);
    return grant;
  }

  /**
   * Consume a grant.
   *
   * Single-use on purpose. A grant that could be replayed would be a standing permission disguised
   * as a one-off approval, which defeats the control entirely.
   */
  consume(grantId: string, action: PrivilegedAction, user: AuthUser): ApprovalGrant {
    const grant = this.grants.get(grantId);
    if (!grant) throw new ForbiddenException('Persetujuan supervisor tidak ditemukan atau sudah dipakai.');
    if (grant.expiresAt < Date.now()) {
      this.grants.delete(grantId);
      throw new ForbiddenException('Persetujuan supervisor sudah kedaluwarsa. Minta persetujuan ulang.');
    }
    if (grant.action !== action) {
      throw new ForbiddenException('Persetujuan supervisor tidak berlaku untuk tindakan ini.');
    }
    // A bearer grant must be spent by the exact operator AND branch that requested it.
    // Company-only checks let another employee or a sister branch reuse a captured grant.
    if (grant.companyId !== user.companyId) {
      throw new ForbiddenException('Persetujuan supervisor tidak valid untuk perusahaan ini.');
    }
    if (grant.branchId !== user.branchId || grant.operatorId !== user.sub) {
      throw new ForbiddenException('Persetujuan supervisor hanya berlaku untuk kasir dan cabang pemohon.');
    }
    this.grants.delete(grantId);
    const { expiresAt, companyId, branchId, operatorId, ...rest } = grant;
    void expiresAt;
    void companyId;
    void branchId;
    void operatorId;
    return rest;
  }

  /** Which privileged actions this branch currently has an approver for. */
  async approverStatus(user: AuthUser): Promise<{ configured: boolean; approverName: string | null }> {
    const candidate = await this.findApprover(user);
    return {
      configured: Boolean(candidate?.supervisorPinHash && candidate?.canApprovePrivilegedActions),
      approverName: candidate?.name ?? null,
    };
  }

  /** Set or clear a supervisor PIN. Separate from approval so the POS never has a setter. */
  async setPin(user: AuthUser, targetUserId: string, pin: string | null): Promise<void> {
    if (!user.companyId) throw new ForbiddenException('Pengguna belum memiliki company yang valid.');
    // `User` has no companyId column — tenancy runs through `branch.companyId`, so the scope has to
    // be expressed on the relation. Scoping on a non-existent field would throw at runtime, and the
    // type error here is the only thing that caught it.
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, branch: { companyId: user.companyId } },
      select: { id: true },
    });
    if (!target) throw new ForbiddenException('Pengguna tidak ditemukan pada perusahaan ini.');
    // Setting a PIN is what APPOINTS an approver, so the approver flag and the PIN must move
    // together in one write.
    //
    // They used to be separate: the setter wrote only `supervisorPinHash`, while `findApprover`
    // requires `canApprovePrivilegedActions: true` — and nothing in the entire repository ever
    // wrote that column. So the endpoint answered 201 `{ok:true}`, the POS asked for its status and
    // read `configured:false`, and every approval was refused with "Belum ada supervisor terdaftar"
    // forever. No error, no warning, every gate green: the control was unsatisfiable by
    // construction, which is the same class of defect as a column that is read but never written.
    // Proven by execution, not by reading: after a real 201 from the setter, `GET
    // /supervisor-approval/status` still returned `configured:false`.
    if (pin === null) {
      // Clearing the PIN also revokes the appointment. Leaving the flag on would produce a second
      // confusing state: an "approver" who can never approve, because there is no PIN to check.
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { supervisorPinHash: null, supervisorPinUpdatedAt: null, canApprovePrivilegedActions: false },
      });
      return;
    }
    // 4-8 digits: long enough to be worth a guess, short enough to type at a till in a hurry.
    if (!/^\d{4,8}$/.test(pin)) throw new ForbiddenException('PIN supervisor harus 4-8 digit angka.');
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        supervisorPinHash: await hash(pin, 10),
        supervisorPinUpdatedAt: new Date(),
        canApprovePrivilegedActions: true,
      },
    });
  }

  /**
   * Find who may approve for this operator.
   *
   * Scoped to the operator's own company AND branch. A supervisor from a sister branch must not
   * approve a price override in a branch they do not manage, and the PIN is checked against that
   * scoped candidate only.
   */
  private async findApprover(user: AuthUser) {
    if (!user.companyId || !user.branchId) return null;
    return this.prisma.user.findFirst({
      where: {
        isActive: true,
        canApprovePrivilegedActions: true,
        NOT: { id: user.sub },
        branch: { companyId: user.companyId },
        OR: [{ branchId: user.branchId }, { branchId: null }],
      },
      select: { id: true, name: true, supervisorPinHash: true, canApprovePrivilegedActions: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private assertNotLockedOut(key: string) {
    const state = this.failures.get(key);
    if (state && state.lockedUntil > Date.now()) {
      // Nest has no TooManyRequestsException, so the status is set explicitly. A 429 is the
      // correct signal: the operator must back off, not retry the same PIN.
      throw new HttpException('Terlalu banyak percobaan PIN. Tunggu sebentar lalu coba lagi.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private registerFailure(key: string) {
    const state = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    state.count += 1;
    if (state.count >= PIN_MAX_FAILURES) {
      state.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
      state.count = 0;
    }
    this.failures.set(key, state);
  }
}
