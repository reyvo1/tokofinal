import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ConfirmPasswordResetDto, RequestPasswordResetDto } from './dto/password-reset.dto';
import { ConfirmTwoFactorSetupDto, DisableTwoFactorDto, RegenerateRecoveryCodesDto } from './dto/two-factor.dto';
import { SwitchBranchContextDto } from './dto/branch-context.dto';
import { Permissions } from './permissions.decorator';
import { Public } from './public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: any) {
    return this.auth.login(dto, String(request.ip ?? request.socket?.remoteAddress ?? 'unknown'));
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Req() request: any) {
    return this.auth.refresh(dto.refreshToken, String(request.ip ?? request.socket?.remoteAddress ?? 'unknown'));
  }

  @Public()
  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() request: any) {
    return this.auth.requestPasswordReset(dto, String(request.ip ?? request.socket?.remoteAddress ?? 'unknown'));
  }

  @Public()
  @Post('password-reset/confirm')
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto, @Req() request: any) {
    return this.auth.confirmPasswordReset(dto, String(request.ip ?? request.socket?.remoteAddress ?? 'unknown'));
  }

  @ApiBearerAuth()
  @Get('2fa/status')
  twoFactorStatus(@CurrentUser() user: AuthUser) { return this.auth.twoFactorStatus(user); }

  @ApiBearerAuth()
  @Post('2fa/setup')
  startTwoFactorSetup(@CurrentUser() user: AuthUser) { return this.auth.startTwoFactorSetup(user); }

  @ApiBearerAuth()
  @Post('2fa/confirm')
  confirmTwoFactorSetup(@CurrentUser() user: AuthUser, @Body() dto: ConfirmTwoFactorSetupDto) {
    return this.auth.confirmTwoFactorSetup(user, dto.code);
  }

  @ApiBearerAuth()
  @Post('2fa/recovery-codes')
  regenerateRecoveryCodes(@CurrentUser() user: AuthUser, @Body() dto: RegenerateRecoveryCodesDto) {
    return this.auth.regenerateRecoveryCodes(user, dto.code);
  }

  @ApiBearerAuth()
  @Post('2fa/disable')
  disableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: DisableTwoFactorDto) {
    return this.auth.disableTwoFactor(user, dto.password, dto.code);
  }

  @ApiBearerAuth()
  @Get('branch-context')
  branchContext(@CurrentUser() user: AuthUser) {
    return this.auth.branchContext(user);
  }

  @ApiBearerAuth()
  @Permissions('branch.switch')
  @Post('branch-context')
  switchBranchContext(@CurrentUser() user: AuthUser, @Body() dto: SwitchBranchContextDto) {
    return this.auth.switchBranchContext(user, dto.branchId);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.sessions(user);
  }

  @ApiBearerAuth()
  @Post('sessions/:id/revoke')
  revokeSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.auth.revokeSession(id, user);
  }

  @ApiBearerAuth()
  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthUser) {
    return this.auth.logoutAll(user);
  }
}
