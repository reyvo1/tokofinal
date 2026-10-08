import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformModule } from '../platform/platform.module';
import { BranchContinuityController } from './branch-continuity.controller';
import { BranchContinuityService } from './branch-continuity.service';
import { BranchTransferController } from './branch-transfer.controller';
import { BranchTransferService } from './branch-transfer.service';

// POST-1B — local-first branch continuity. Depends on branch-sync models, which live in the same
// Prisma client, so no cross-module import is needed; both read SyncNode.
//
// PlatformModule is required, not optional: both services inject SecretProtectorService, which
// PlatformModule provides and exports. It is not a @Global module, so a module injecting the service
// must import the provider itself. Without it the whole API fails to boot at runtime with
// UnknownDependenciesException, and NOTHING catches it — Nest resolves dependencies at start, not at
// compile time, so tsc, the full test suite and the six-app production build were all green while the
// server could not start. Every sibling module that injects SecretProtectorService (branch-sync,
// extensions, auth, payments) imports PlatformModule for the same reason.
@Module({
  imports: [PrismaModule, PlatformModule],
  controllers: [BranchContinuityController, BranchTransferController],
  providers: [BranchContinuityService, BranchTransferService],
})
export class BranchContinuityModule {}
