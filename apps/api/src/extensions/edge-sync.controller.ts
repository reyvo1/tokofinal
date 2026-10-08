import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { AcknowledgeSyncReceiptDto, EdgeSyncPullDto, SubmitOfflineTransactionsDto } from './dto/extensions.dto';
import { EdgeDeviceAuthService } from './edge-device-auth.service';
import { ExtensionsService } from './extensions.service';

type HeaderMap = Record<string, string | string[] | undefined>;

@ApiTags('edge-sync')
@Controller('edge-sync')
@Public()
@ApiHeader({ name: 'x-toko360-device-id', required: true })
@ApiHeader({ name: 'x-toko360-key-id', required: true })
@ApiHeader({ name: 'x-toko360-timestamp', required: true, description: 'ISO-8601 timestamp; toleransi clock 5 menit.' })
@ApiHeader({ name: 'x-toko360-nonce', required: true, description: 'Nonce unik 16-128 karakter untuk setiap request.' })
@ApiHeader({ name: 'x-toko360-signature', required: true, description: 'HMAC-SHA256 hex atas canonical request v1.' })
export class EdgeSyncController {
  constructor(private readonly auth: EdgeDeviceAuthService, private readonly extensions: ExtensionsService) {}

  @Post('pull')
  async pull(@Headers() headers: HeaderMap, @Body() dto: EdgeSyncPullDto) {
    const identity = await this.auth.authenticate(headers, 'sync.pull', dto);
    return this.extensions.edgeSyncPull(identity, dto.since, dto.cursor);
  }

  @Post('push')
  async push(@Headers() headers: HeaderMap, @Body() dto: SubmitOfflineTransactionsDto) {
    const identity = await this.auth.authenticate(headers, 'sync.push', dto);
    return this.extensions.edgeSubmitOfflineTransactions(identity, dto);
  }

  @Post('ack')
  async ack(@Headers() headers: HeaderMap, @Body() dto: AcknowledgeSyncReceiptDto) {
    const identity = await this.auth.authenticate(headers, 'sync.ack', dto);
    return this.extensions.edgeAcknowledgeSync(identity, dto);
  }
}
