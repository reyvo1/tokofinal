import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SupervisorApprovalService, type PrivilegedAction } from './supervisor-approval.service';

// Kept in lockstep with the `PrivilegedAction` union in the service. `SALE_REFUND` was removed from
// both: no return path ever spent a refund grant, and refunds are already gated by role in
// returns.controller.ts, so listing it advertised a second control that did not exist.
const PRIVILEGED_ACTIONS: PrivilegedAction[] = [
  'SALE_PRICE_OVERRIDE',
  'SALE_LINE_DISCOUNT',
  'SALE_CASH_MOVEMENT',
  'SHIFT_CLOSE',
];

class ApproveDto {
  @IsString() @Length(4, 8) pin!: string;
  @IsIn(PRIVILEGED_ACTIONS) action!: PrivilegedAction;
  @IsString() @MaxLength(200) reason!: string;
  @IsOptional() @IsString() targetUserId?: string;
}

class SetPinDto {
  // 4-8 digits, or empty to clear. Validated in the service too, so the rule is not only in DTO land.
  @IsString() @Length(0, 8) pin!: string;
  @IsString() targetUserId!: string;
}

class AmountDto {
  @IsInt() @Min(0) amount!: number;
}

// No @UseGuards here on purpose. JwtAuthGuard is registered globally via APP_GUARD in app.module,
// and re-declaring it here makes Nest build a SECOND instance that must resolve ApiKeysService from
// THIS module — which fails at boot with UnknownDependenciesException. Every other controller in the
// codebase relies on the global guard, so this one follows suit.
@Controller('supervisor-approval')
export class SupervisorApprovalController {
  constructor(private readonly service: SupervisorApprovalService) {}

  /** Whether this branch has an approver at all — the POS needs this to disable the override UI. */
  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    return this.service.approverStatus(user);
  }

  @Post('approve')
  async approve(@CurrentUser() user: AuthUser, @Body() dto: ApproveDto) {
    return this.service.approve(user, dto.pin, { action: dto.action, reason: dto.reason });
  }

  /**
   * Administrative: set or clear a supervisor PIN.
   *
   * Restricted to OWNER/ADMIN/SUPER_ADMIN. This is a setter for a credential that gates money, so it
   * must not be reachable by a CASHIER even though `approve` is.
   */
  @Post('pin')
  async setPin(@CurrentUser() user: AuthUser, @Body() dto: SetPinDto) {
    const allowed = user.roles.filter((role) => ['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(role));
    if (!allowed.length) throw new ForbiddenException('Hanya OWNER, ADMIN, atau SUPER_ADMIN yang dapat mengatur PIN supervisor.');
    await this.service.setPin(user, dto.targetUserId, dto.pin === '' ? null : dto.pin);
    return { ok: true };
  }
}
