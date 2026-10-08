import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { EdgeDeviceAuthService } from './edge-device-auth.service';
import { EdgeSyncController } from './edge-sync.controller';
import { ExtensionsController } from './extensions.controller';
import { ExtensionsService } from './extensions.service';

@Module({ imports: [PlatformModule], controllers: [ExtensionsController, EdgeSyncController], providers: [ExtensionsService, EdgeDeviceAuthService] })
export class ExtensionsModule {}
