import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

type UpdatedCursor = { updatedAt: string; id: string };
type CreatedCursor = { createdAt: string; id: string };
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException('Pengguna belum memiliki company dan branch yang valid.');
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async assertWarehouseAccess(user: AuthUser, warehouseId: string, scope: TenantScope): Promise<void> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
      },
      select: { id: true },
    });

    if (warehouse) return;

    await this.prisma.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'TENANT_ACCESS_DENIED',
        entityType: 'Warehouse',
        entityId: warehouseId,
        payload: {
          requestedWarehouseId: warehouseId,
          authenticatedBranchId: scope.branchId,
        },
      },
    });

    throw new ForbiddenException('Gudang tidak tersedia dalam company dan branch pengguna.');
  }

  async list(user: AuthUser, warehouseId?: string, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    if (warehouseId) await this.assertWarehouseAccess(user, warehouseId, scope);

    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<UpdatedCursor>(cursorValue);
    const cursorFilter: Prisma.InventoryWhereInput | undefined = cursor ? {
      OR: [
        { updatedAt: { lt: new Date(cursor.updatedAt) } },
        { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } },
      ],
    } : undefined;

    const rows = await this.prisma.inventory.findMany({
      where: {
        warehouseId,
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        AND: cursorFilter ? [cursorFilter] : undefined,
      },
      include: { product: { include: { category: true } }, warehouse: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ updatedAt: item.updatedAt.toISOString(), id: item.id }));
  }

  async movements(
    user: AuthUser,
    productId?: string,
    warehouseId?: string,
    limitValue?: string,
    cursorValue?: string,
  ) {
    const scope = this.requireTenantScope(user);
    if (warehouseId) await this.assertWarehouseAccess(user, warehouseId, scope);

    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<CreatedCursor>(cursorValue);
    const cursorFilter: Prisma.InventoryMovementWhereInput | undefined = cursor ? {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ],
    } : undefined;

    const rows = await this.prisma.inventoryMovement.findMany({
      where: {
        productId,
        warehouseId,
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        AND: cursorFilter ? [cursorFilter] : undefined,
      },
      include: { product: true, warehouse: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  warehouses(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.warehouse.findMany({
      where: {
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
      },
      include: { branch: true },
      orderBy: { name: 'asc' },
    });
  }
}
