import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PluginRegistryService } from './plugin-registry.service';
import { SecretProtectorService } from './secret-protector.service';

@Module({ controllers: [PlatformController], providers: [PlatformService, PluginRegistryService, SecretProtectorService], exports: [PlatformService, PluginRegistryService, SecretProtectorService] })
export class PlatformModule {}
