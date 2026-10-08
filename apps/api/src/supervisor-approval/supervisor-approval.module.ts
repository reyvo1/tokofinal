import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SupervisorApprovalController } from './supervisor-approval.controller';
import { SupervisorApprovalService } from './supervisor-approval.service';

// Supervisor override for privileged cashier actions: price override, custom discount, refund,
// cash movement out, and blind-closing a shift with a variance.
//
// Exports the service because SalesService and ReturnsService consume the grants. A grant is a
// short-lived, single-use, company-scoped capability issued by a branch manager's PIN — it is not
// a token and grants no session.
@Module({
  imports: [PrismaModule],
  controllers: [SupervisorApprovalController],
  providers: [SupervisorApprovalService],
  exports: [SupervisorApprovalService],
})
export class SupervisorApprovalModule {}
