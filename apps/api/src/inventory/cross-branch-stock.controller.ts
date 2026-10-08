import { Controller, ForbiddenException, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cross-branch stock inquiry for the POS.
 *
 * Click & Collect starts with a question the cashier has to answer at the counter: "is it in stock
 * at the other branch?" Without this the only honest answer is "I don't know", and the customer
 * drives to find out.
 *
 * Tenant-scoped on purpose: a company sees its own branches and nothing else. The scope is applied
 * through `branch.companyId` rather than by listing branches and filtering afterwards, so a company
 * id can never leak through a mistake in the filter.
 */
@Controller('inventory/cross-branch-stock')
export class CrossBranchStockController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':productId')
  async stock(@CurrentUser() user: AuthUser, @Param('productId') productId: string, @Query('companyId') companyId?: string) {
    const scopeCompanyId = companyId ?? user.companyId;
    // A caller may only ask about its OWN company. Accepting the parameter and then checking is what
    // lets a shared endpoint be reused by the Admin without becoming a cross-tenant inventory oracle.
    if (!scopeCompanyId || (user.companyId && user.companyId !== scopeCompanyId)) {
      throw new ForbiddenException('Hanya boleh melihat stok cabang dalam perusahaan sendiri.');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId: scopeCompanyId },
      select: { id: true, name: true, sku: true },
    });
    if (!product) throw new NotFoundException('Produk tidak ditemukan pada perusahaan ini.');

    // The operator's own branch is resolved from the session, not from a query parameter, so "which
    // branch am I?" cannot be spoofed to hide a branch that has the stock.
    const [rows, currentBranch] = await Promise.all([
      this.prisma.inventory.findMany({
        where: { productId, warehouse: { branch: { companyId: scopeCompanyId } } },
        select: { available: true, warehouseId: true, warehouse: { select: { name: true, code: true, branch: { select: { id: true, code: true, name: true } } } } },
        orderBy: { available: 'desc' },
      }),
      user.branchId ? this.prisma.branch.findFirst({ where: { id: user.branchId, companyId: scopeCompanyId }, select: { id: true } }) : Promise.resolve(null),
    ]);

    return {
      product,
      // One row per branch, summing every warehouse inside it: a branch with three shelves holding
      // 2 each has 6, and reporting per-warehouse would make the cashier think it is out of stock.
      branches: Object.values(
        rows.reduce<Record<string, { branchId: string; branchCode: string; branchName: string; warehouseId: string | null; available: number; isCurrent: boolean }>>((acc, row) => {
          const branch = row.warehouse.branch;
          const existing = acc[branch.id];
          if (existing) existing.available += row.available;
          else acc[branch.id] = {
            branchId: branch.id,
            branchCode: branch.code,
            branchName: branch.name,
            // Null when stock is spread over several warehouses: there is no single place to collect
            // from, and pretending otherwise sends the customer to the wrong shelf.
            warehouseId: null,
            available: row.available,
            isCurrent: branch.id === currentBranch?.id,
          };
          return acc;
        }, {}),
      ).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.available - a.available),
    };
  }
}
