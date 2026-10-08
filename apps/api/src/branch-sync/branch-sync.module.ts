import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformModule } from '../platform/platform.module';
import { BranchSyncAuthGuard } from './branch-sync-auth.guard';
import { BranchSyncAuthService } from './branch-sync-auth.service';
import { BranchSyncController } from './branch-sync.controller';
import { BranchSyncService } from './branch-sync.service';

@Module({
  imports: [PrismaModule, PlatformModule],
  controllers: [BranchSyncController],
  providers: [BranchSyncService, BranchSyncAuthService, BranchSyncAuthGuard],
})
export class BranchSyncModule {}
