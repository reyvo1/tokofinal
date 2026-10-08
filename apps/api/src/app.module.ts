import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AdvancedInventoryModule } from './advanced-inventory/advanced-inventory.module';
import { ExtensionsModule } from './extensions/extensions.module';
import { PlatformModule } from './platform/platform.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { GoodsReceiptsModule } from './goods-receipts/goods-receipts.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { PromotionsModule } from './promotions/promotions.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { ReportsModule } from './reports/reports.module';
import { SalesModule } from './sales/sales.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { UsersModule } from './users/users.module';
import { HrModule } from './hr/hr.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PayrollModule } from './payroll/payroll.module';
import { EmployeeSelfServiceModule } from './employee-self-service/employee-self-service.module';
import { AccountingCoreModule } from './accounting-core/accounting-core.module';
import { OperationsControlModule } from './operations-control/operations-control.module';
import { AssetsModule } from './assets/assets.module';
// POST-1A — edge topology and sync foundation (central host + branch nodes).
import { BranchSyncModule } from './branch-sync/branch-sync.module';
// POST-1B — local-first branch continuity (offline capability, degraded reads, backup metadata).
import { BranchContinuityModule } from './branch-continuity/branch-continuity.module';
// POST-1C — mobile stock-opname drafts and Telegram identity administration.
import { KioskModule } from './kiosk/kiosk.module';
import { MobileOpsModule } from './mobile-ops/mobile-ops.module';
import { SupervisorApprovalModule } from './supervisor-approval/supervisor-approval.module';
import { FleetModule } from './fleet/fleet.module';
import { FinanceOperationsModule } from './finance-operations/finance-operations.module';
import { ReturnsModule } from './returns/returns.module';
import { MasterDataModule } from './master-data/master-data.module';
import { PaymentsModule } from './payments/payments.module';
import { StorefrontCustomerModule } from './storefront-customer/storefront-customer.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { DigitalServicesModule } from './digital-services/digital-services.module';
import { StaffMemosModule } from './staff-memos/staff-memos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    PrismaModule,
    AuthModule,
    PlatformModule,
    AdvancedInventoryModule,
    ExtensionsModule,
    UsersModule,
    HrModule,
    AttendanceModule,
    PayrollModule,
    EmployeeSelfServiceModule,
    AccountingCoreModule,
    OperationsControlModule,
    AssetsModule,
    BranchSyncModule,
    BranchContinuityModule,
    KioskModule,
    MobileOpsModule,
    SupervisorApprovalModule,
    FleetModule,
    FinanceOperationsModule,
    ReturnsModule,
    MasterDataModule,
    PaymentsModule,
    StorefrontCustomerModule,
    ManufacturingModule,
    DigitalServicesModule,
    StaffMemosModule,
    ProductsModule,
    SuppliersModule,
    PurchaseOrdersModule,
    GoodsReceiptsModule,
    InventoryModule,
    SalesModule,
    OrdersModule,
    ReportsModule,
    PromotionsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
