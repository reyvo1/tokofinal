import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { PaymentProviderCallbackDto } from './dto/provider-callback.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @ApiHeader({ name: 'x-toko360-signature', required: true, description: 'HMAC-SHA256 signature (hex atau sha256=<hex>) dari canonical callback.' })
  @Post('providers/:integrationId/callback')
  providerCallback(
    @Param('integrationId') integrationId: string,
    @Body() dto: PaymentProviderCallbackDto,
    @Headers('x-toko360-signature') signature?: string,
  ) {
    return this.payments.providerCallback(integrationId, dto, signature);
  }

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','AUDITOR')
  @Permissions('payment.reconcile')
  @Get('provider-events')
  listProviderEvents(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payments.listProviderEvents(user, { status, provider, limit });
  }
}
