import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { resolveProductUnitPrice } from '../common/product-pricing';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BulkImportProductsDto, BulkProductRowDto } from './dto/bulk-products.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type ProductCursor = { name: string; id: string };
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Pengguna belum memiliki company dan branch yang valid.',
      });
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(
    client: DbClient,
    user: AuthUser | undefined,
    scope: TenantScope,
    entityType: string,
    entityId?: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<never> {
    await client.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user?.sub,
        action: 'TENANT_ACCESS_DENIED',
        entityType,
        entityId,
        payload: payload ?? {
          authenticatedCompanyId: scope.companyId,
          authenticatedBranchId: scope.branchId,
        },
      },
    });
    throw new ForbiddenException({
      code: 'TENANT_ACCESS_DENIED',
      message: `${entityType} tidak tersedia dalam company dan branch yang diminta.`,
    });
  }

  private async resolveScope(
    user: AuthUser | undefined,
    branchCode?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ): Promise<TenantScope> {
    if (user) {
      const scope = this.requireTenantScope(user);
      if ((requestedCompanyId && requestedCompanyId !== scope.companyId)
        || (requestedBranchId && requestedBranchId !== scope.branchId)) {
        return this.denyTenantAccess(this.prisma, user, scope, 'ProductCatalog', undefined, {
          authenticatedCompanyId: scope.companyId,
          authenticatedBranchId: scope.branchId,
          ...(requestedCompanyId ? { requestedCompanyId } : {}),
          ...(requestedBranchId ? { requestedBranchId } : {}),
        });
      }
      if (branchCode) {
        const branch = await this.prisma.branch.findFirst({
          where: { id: scope.branchId, companyId: scope.companyId, code: branchCode, isActive: true },
          select: { id: true },
        });
        if (!branch) {
          return this.denyTenantAccess(this.prisma, user, scope, 'Branch', scope.branchId, { requestedBranchCode: branchCode });
        }
      }
      return scope;
    }

    const normalizedCode = branchCode?.trim();
    if (!normalizedCode) {
      throw new BadRequestException({
        code: 'BRANCH_CODE_REQUIRED',
        message: 'branchCode wajib disertakan untuk katalog produk publik.',
      });
    }
    const branch = await this.prisma.branch.findFirst({
      where: { code: normalizedCode, isActive: true },
      select: { id: true, companyId: true },
    });
    if (!branch) {
      throw new NotFoundException({ code: 'STOREFRONT_BRANCH_NOT_FOUND', message: 'Cabang storefront tidak ditemukan atau tidak aktif.' });
    }
    const scope = { companyId: branch.companyId, branchId: branch.id };
    if ((requestedCompanyId && requestedCompanyId !== scope.companyId)
      || (requestedBranchId && requestedBranchId !== scope.branchId)) {
      return this.denyTenantAccess(this.prisma, undefined, scope, 'ProductCatalog', undefined, {
        requestedBranchCode: normalizedCode,
        ...(requestedCompanyId ? { requestedCompanyId } : {}),
        ...(requestedBranchId ? { requestedBranchId } : {}),
      });
    }
    return scope;
  }

  private inventoryScope(scope: TenantScope): Prisma.InventoryWhereInput {
    return {
      warehouse: {
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
      },
    };
  }

  private normalizeRequiredUnit(value: string | undefined | null, label = 'Base unit') {
    const unit = value?.trim().toUpperCase() ?? '';
    if (!unit) throw new BadRequestException(`${label} wajib dipilih dari master UNIT aktif.`);
    return unit;
  }

  private async requireActiveUnit(client: DbClient, companyId: string, value: string) {
    const unit = this.normalizeRequiredUnit(value);
    const master = await client.masterReference.findFirst({
      where: { companyId, branchId: null, type: 'UNIT', code: unit, isActive: true },
      select: { id: true },
    });
    if (!master) throw new BadRequestException(`Unit ${unit} belum terdaftar pada master UNIT perusahaan yang aktif.`);
    return unit;
  }

  private async assertBaseUnitChangeSafe(client: DbClient, productId: string, currentUnit: string, nextUnit: string) {
    if (currentUnit === nextUnit) return;
    const blockers = await Promise.all([
      client.inventory.findFirst({ where: { productId }, select: { id: true } }),
      client.inventoryMovement.findFirst({ where: { productId }, select: { id: true } }),
      client.inventoryLocationBalance.findFirst({ where: { productId }, select: { id: true } }),
      client.inventoryReservation.findFirst({ where: { productId }, select: { id: true } }),
      client.inventoryConditionBalance.findFirst({ where: { productId }, select: { id: true } }),
      client.inventoryConditionMovement.findFirst({ where: { productId }, select: { id: true } }),
      client.purchaseOrderItem.findFirst({ where: { productId }, select: { id: true } }),
      client.goodsReceiptItem.findFirst({ where: { productId }, select: { id: true } }),
      client.saleItem.findFirst({ where: { productId }, select: { id: true } }),
      client.orderItem.findFirst({ where: { productId }, select: { id: true } }),
      client.stockTransferItem.findFirst({ where: { productId }, select: { id: true } }),
      client.stockOpnameItem.findFirst({ where: { productId }, select: { id: true } }),
      client.inventoryBatch.findFirst({ where: { productId }, select: { id: true } }),
      client.inventorySerial.findFirst({ where: { productId }, select: { id: true } }),
      client.orderReturnItem.findFirst({ where: { productId }, select: { id: true } }),
      client.saleReturnItem.findFirst({ where: { productId }, select: { id: true } }),
      client.purchaseReturnItem.findFirst({ where: { productId }, select: { id: true } }),
      client.productUnit.findFirst({ where: { productId }, select: { id: true } }),
      client.productPrice.findFirst({ where: { productId }, select: { id: true } }),
      client.productVariant.findFirst({ where: { productId }, select: { id: true } }),
      client.productionRecipe.findFirst({ where: { outputProductId: productId }, select: { id: true } }),
      client.productionRecipeItem.findFirst({ where: { componentProductId: productId }, select: { id: true } }),
      client.productionOrderComponent.findFirst({ where: { productId }, select: { id: true } }),
      client.productBarcode.findFirst({
        where: {
          productId,
          OR: [
            { productUnitId: { not: null } },
            { isPrimary: false },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (blockers.some(Boolean)) {
      throw new BadRequestException(
        `Base unit tidak dapat diubah dari ${currentUnit} ke ${nextUnit} karena produk sudah memiliki histori transaksi/stok/konversi. Buat produk baru atau lakukan migrasi unit terkontrol agar histori tidak berubah makna.`,
      );
    }
  }

  async list(
    user: AuthUser | undefined,
    branchCode?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
    search?: string,
    limitValue?: string,
    cursorValue?: string,
    includeInactiveValue?: string,
  ) {
    const scope = await this.resolveScope(user, branchCode, requestedCompanyId, requestedBranchId);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<ProductCursor>(cursorValue);
    const filters: Prisma.ProductWhereInput[] = [];
    const query = search?.trim();
    const canManageProducts = Boolean(user?.roles.some((role) => ['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(role)));
    const includeInactive = includeInactiveValue === 'true' && canManageProducts;

    if (query) {
      filters.push({
        OR: [
          { barcode: query },
          { sku: query },
          { sku: { startsWith: query } },
          { name: { contains: query } },
          { variants: { some: { OR: [{ sku: query }, { code: query }, { name: { contains: query } }], isActive: true } } },
          { barcodes: { some: { code: query } } },
        ],
      });
    }
    if (cursor) {
      if (typeof cursor.name !== 'string' || typeof cursor.id !== 'string') throw new Error('invalid product cursor');
      filters.push({ OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }] });
    }

    const rows = await this.prisma.product.findMany({
      where: {
        companyId: scope.companyId,
        ...(includeInactive ? {} : { isActive: true }),
        AND: filters.length ? filters : undefined,
      },
      include: {
        category: true,
        variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] },
        units: { where: { isActive: true }, orderBy: [{ variantId: 'asc' }, { isDefaultSale: 'desc' }, { quantityFactor: 'asc' }], include: { variant: true } },
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], include: { variant: true, productUnit: true } },
        inventories: {
          where: this.inventoryScope(scope),
          select: {
            available: true,
            warehouseId: true,
            warehouse: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = toCursorPage(rows, limit, (item) => ({ name: item.name, id: item.id }));
    const pricedItems = await Promise.all(page.items.map(async (item) => ({
      ...item,
      effectiveSalePrice: await resolveProductUnitPrice(this.prisma, {
        companyId: scope.companyId, branchId: scope.branchId, product: item, quantity: 1, segmentCode: 'RETAIL', unitCode: item.unit,
      }),
      units: await Promise.all(item.units.map(async (unit) => ({
        ...unit,
        effectiveSalePrice: await resolveProductUnitPrice(this.prisma, {
          companyId: scope.companyId, branchId: scope.branchId, product: item, quantity: 1, segmentCode: 'RETAIL',
          unitCode: unit.unitCode, unitFactor: Number(unit.quantityFactor), variantId: unit.variantId,
          variantSalePrice: unit.variant?.salePrice ? new Prisma.Decimal(unit.variant.salePrice).mul(Number(unit.quantityFactor)) : undefined,
        }),
      }))),
    })));
    if (user) return { ...page, items: pricedItems };
    return {
      ...page,
      items: pricedItems.map(({ companyId: _companyId, ...item }) => item),
    };
  }

  async create(dto: CreateProductDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (dto.trackExpiry && !dto.trackBatch) throw new BadRequestException('Pelacakan expiry membutuhkan pelacakan batch.');
    if (dto.retailCeilingPrice != null && dto.salePrice > dto.retailCeilingPrice) throw new BadRequestException('Harga jual tidak boleh melebihi HET produk.');
    return this.prisma.$transaction(async (tx) => {
      if (dto.categoryId) {
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, companyId: scope.companyId }, select: { id: true } });
        if (!category) throw new BadRequestException('Kategori produk tidak ditemukan.');
      }
      const product = await tx.product.create({
        data: {
          ...dto,
          companyId: scope.companyId,
          costPrice: new Prisma.Decimal(dto.costPrice),
          salePrice: new Prisma.Decimal(dto.salePrice),
          retailCeilingPrice: dto.retailCeilingPrice == null ? null : new Prisma.Decimal(dto.retailCeilingPrice),
          unit: await this.requireActiveUnit(tx, scope.companyId, dto.unit),
          minStock: dto.minStock ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
      if (dto.barcode) {
        await tx.productBarcode.create({ data: { productId: product.id, code: dto.barcode, unitCode: product.unit, quantityFactor: new Prisma.Decimal(1), isPrimary: true } });
      }
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_PRODUCT',
          entityType: 'Product',
          entityId: product.id,
          payload: { branchId: scope.branchId, sku: product.sku },
        },
      });
      return product;
    });
  }

  async exportCsv(user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const rows = await this.prisma.product.findMany({
      where: { companyId: scope.companyId }, include: { category: { select: { slug: true } } }, orderBy: [{ sku: 'asc' }, { id: 'asc' }], take: 10000,
    });
    const escape = (value: unknown) => { const raw = value == null ? '' : String(value); return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw; };
    const headers = ['sku','name','barcode','unit','costPrice','salePrice','retailCeilingPrice','minStock','brandCode','categorySlug','productType','trackBatch','trackExpiry','trackSerial','isActive'];
    const content = [headers.join(','), ...rows.map((row) => [row.sku,row.name,row.barcode,row.unit,row.costPrice,row.salePrice,row.retailCeilingPrice,row.minStock,row.brandCode,row.category?.slug,row.productType,row.trackBatch,row.trackExpiry,row.trackSerial,row.isActive].map(escape).join(','))].join('\n');
    return { fileName: `products-${new Date().toISOString().slice(0,10)}.csv`, mimeType: 'text/csv;charset=utf-8', content: `\uFEFF${content}` };
  }

  private normalizeBulkRow(row: BulkProductRowDto) {
    const sku = row.sku.trim().toUpperCase();
    const name = row.name.trim();
    const unit = this.normalizeRequiredUnit(row.unit, `Base unit produk ${sku || '(tanpa SKU)'}`);
    const barcode = row.barcode?.trim() || null;
    const productType = (row.productType ?? 'PHYSICAL').trim().toUpperCase();
    if (!sku || !name) throw new BadRequestException('SKU dan nama produk wajib diisi.');
    if (!['PHYSICAL','SERVICE'].includes(productType)) throw new BadRequestException(`productType ${productType} tidak valid untuk ${sku}.`);
    if (row.trackExpiry && !row.trackBatch) throw new BadRequestException(`Produk ${sku}: expiry membutuhkan batch.`);
    if (row.retailCeilingPrice != null && row.salePrice > row.retailCeilingPrice) throw new BadRequestException(`Produk ${sku}: harga jual melebihi HET.`);
    return { ...row, sku, name, unit, barcode, productType, brandCode: row.brandCode?.trim().toUpperCase() || null, categorySlug: row.categorySlug?.trim() || null };
  }

  async bulkImport(dto: BulkImportProductsDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const normalized = dto.rows.map((row) => this.normalizeBulkRow(row));
    const duplicateSku = normalized.find((row, index) => normalized.findIndex((other) => other.sku === row.sku) !== index);
    if (duplicateSku) throw new BadRequestException(`SKU duplikat dalam file: ${duplicateSku.sku}.`);
    const barcodeValues = normalized.map((row) => row.barcode).filter((value): value is string => Boolean(value));
    const duplicateBarcode = barcodeValues.find((value, index) => barcodeValues.indexOf(value) !== index);
    if (duplicateBarcode) throw new BadRequestException(`Barcode duplikat dalam file: ${duplicateBarcode}.`);
    const [categories, activeUnits] = await Promise.all([
      this.prisma.category.findMany({ where: { companyId: scope.companyId }, select: { id: true, slug: true } }),
      this.prisma.masterReference.findMany({ where: { companyId: scope.companyId, branchId: null, type: 'UNIT', isActive: true }, select: { code: true } }),
    ]);
    const categoryMap = new Map(categories.map((category) => [category.slug, category.id]));
    const unitSet = new Set(activeUnits.map((unit) => unit.code.trim().toUpperCase()));
    const existing = await this.prisma.product.findMany({ where: { companyId: scope.companyId, sku: { in: normalized.map((row) => row.sku) } }, select: { id: true, sku: true, costPrice: true, salePrice: true, retailCeilingPrice: true, unit: true } });
    const existingMap = new Map(existing.map((product) => [product.sku, product]));
    const errors: Array<{ row: number; sku: string; message: string }> = [];
    normalized.forEach((row, index) => {
      if (row.categorySlug && !categoryMap.has(row.categorySlug)) errors.push({ row: index + 2, sku: row.sku, message: `categorySlug ${row.categorySlug} tidak ditemukan.` });
      if (!unitSet.has(row.unit)) errors.push({ row: index + 2, sku: row.sku, message: `unit ${row.unit} belum terdaftar pada master UNIT perusahaan yang aktif.` });
      const prior = existingMap.get(row.sku);
      if (prior && !dto.updateExisting) errors.push({ row: index + 2, sku: row.sku, message: 'SKU sudah ada; aktifkan updateExisting untuk memperbarui.' });
      if (prior && prior.unit.trim().toUpperCase() !== row.unit) errors.push({ row: index + 2, sku: row.sku, message: `Base unit produk existing (${prior.unit}) tidak boleh diubah lewat bulk import menjadi ${row.unit}. Gunakan edit produk setelah pemeriksaan histori.` });
    });
    if (errors.length || dto.dryRun !== false) return { dryRun: true, total: normalized.length, valid: normalized.length - errors.length, errors, creates: normalized.filter((row) => !existingMap.has(row.sku)).length, updates: normalized.filter((row) => existingMap.has(row.sku)).length };
    return this.prisma.$transaction(async (tx) => {
      let created = 0; let updated = 0;
      for (const row of normalized) {
        const prior = existingMap.get(row.sku);
        const data = { name: row.name, barcode: row.barcode, categoryId: row.categorySlug ? categoryMap.get(row.categorySlug)! : null, brandCode: row.brandCode, productType: row.productType, trackBatch: row.trackBatch ?? false, trackExpiry: row.trackExpiry ?? false, trackSerial: row.trackSerial ?? false, costPrice: new Prisma.Decimal(row.costPrice), salePrice: new Prisma.Decimal(row.salePrice), retailCeilingPrice: row.retailCeilingPrice == null ? null : new Prisma.Decimal(row.retailCeilingPrice), minStock: Math.trunc(row.minStock ?? 0), isActive: row.isActive ?? true };
        let productId: string;
        if (prior) {
          const product = await tx.product.update({ where: { id: prior.id }, data }); productId = product.id; updated += 1;
          const priceChanges = [
            !new Prisma.Decimal(row.costPrice).equals(prior.costPrice) ? { field: 'costPrice', oldValue: prior.costPrice, newValue: new Prisma.Decimal(row.costPrice) } : null,
            !new Prisma.Decimal(row.salePrice).equals(prior.salePrice) ? { field: 'salePrice', oldValue: prior.salePrice, newValue: new Prisma.Decimal(row.salePrice) } : null,
          ].filter((change): change is { field: string; oldValue: Prisma.Decimal; newValue: Prisma.Decimal } => Boolean(change));
          if (priceChanges.length) await tx.productPriceHistory.createMany({ data: priceChanges.map((change) => ({ companyId: scope.companyId, productId, field: change.field, oldValue: change.oldValue, newValue: change.newValue, changedById: user.sub })) });
        } else {
          const product = await tx.product.create({ data: { companyId: scope.companyId, sku: row.sku, unit: row.unit, ...data } }); productId = product.id; created += 1;
        }
        if (row.barcode) {
          const primary = await tx.productBarcode.findFirst({ where: { productId, isPrimary: true } });
          if (primary) await tx.productBarcode.update({ where: { id: primary.id }, data: { code: row.barcode, unitCode: row.unit } });
          else await tx.productBarcode.create({ data: { productId, code: row.barcode, unitCode: row.unit, quantityFactor: new Prisma.Decimal(1), isPrimary: true } });
        }
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'BULK_IMPORT_PRODUCTS', entityType: 'Product', payload: { branchId: scope.branchId, total: normalized.length, created, updated } } });
      return { dryRun: false, total: normalized.length, created, updated, errors: [] };
    });
  }

  // T360-20260829 value pack 2 — update produk + pencatatan riwayat harga otomatis.
  async update(id: string, dto: UpdateProductDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id, companyId: scope.companyId } });
      if (!product) return this.denyTenantAccess(tx, user, scope, 'Product', id);
      if (dto.categoryId) {
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, companyId: scope.companyId }, select: { id: true } });
        if (!category) throw new BadRequestException('Kategori produk tidak ditemukan pada perusahaan ini.');
      }
      const nextTrackBatch = dto.trackBatch ?? product.trackBatch;
      const nextTrackExpiry = dto.trackExpiry ?? product.trackExpiry;
      if (nextTrackExpiry && !nextTrackBatch) throw new BadRequestException('Pelacakan expiry membutuhkan pelacakan batch.');
      const nextSalePrice = dto.salePrice ?? Number(product.salePrice);
      const nextHet = dto.retailCeilingPrice !== undefined ? dto.retailCeilingPrice : (product.retailCeilingPrice == null ? undefined : Number(product.retailCeilingPrice));
      if (nextHet != null && nextSalePrice > nextHet) throw new BadRequestException('Harga jual tidak boleh melebihi HET produk.');
      const currentUnit = await this.requireActiveUnit(tx, scope.companyId, product.unit);
      const nextUnit = dto.unit !== undefined ? await this.requireActiveUnit(tx, scope.companyId, dto.unit) : currentUnit;
      await this.assertBaseUnitChangeSafe(tx, product.id, currentUnit, nextUnit);
      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          ...(dto.sku != null ? { sku: dto.sku.trim() } : {}),
          ...(dto.name != null ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description || null } : {}),
          ...(dto.unit !== undefined ? { unit: nextUnit } : {}),
          ...(dto.barcode !== undefined ? { barcode: dto.barcode || null } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
          ...(dto.brandCode !== undefined ? { brandCode: dto.brandCode?.trim().toUpperCase() || null } : {}),
          ...(dto.productType !== undefined ? { productType: dto.productType } : {}),
          ...(dto.taxCategoryCode !== undefined ? { taxCategoryCode: dto.taxCategoryCode?.trim().toUpperCase() || null } : {}),
          ...(dto.salesTaxCodeId !== undefined ? { salesTaxCodeId: dto.salesTaxCodeId || null } : {}),
          ...(dto.purchaseTaxCodeId !== undefined ? { purchaseTaxCodeId: dto.purchaseTaxCodeId || null } : {}),
          ...(dto.trackBatch !== undefined ? { trackBatch: dto.trackBatch } : {}),
          ...(dto.trackExpiry !== undefined ? { trackExpiry: dto.trackExpiry } : {}),
          ...(dto.trackSerial !== undefined ? { trackSerial: dto.trackSerial } : {}),
          ...(dto.allowNegativeStock !== undefined ? { allowNegativeStock: dto.allowNegativeStock } : {}),
          ...(dto.minStock != null ? { minStock: dto.minStock } : {}),
          ...(dto.isActive != null ? { isActive: dto.isActive } : {}),
          ...(dto.costPrice != null ? { costPrice: new Prisma.Decimal(dto.costPrice) } : {}),
          ...(dto.salePrice != null ? { salePrice: new Prisma.Decimal(dto.salePrice) } : {}),
          ...(dto.retailCeilingPrice !== undefined ? { retailCeilingPrice: dto.retailCeilingPrice == null ? null : new Prisma.Decimal(dto.retailCeilingPrice) } : {}),
        },
      });
      if (nextUnit !== currentUnit) {
        await tx.productBarcode.updateMany({
          where: { productId: product.id, productUnitId: null, quantityFactor: new Prisma.Decimal(1), unitCode: currentUnit },
          data: { unitCode: nextUnit },
        });
      }
      if (dto.barcode !== undefined && dto.barcode) {
        const primary = await tx.productBarcode.findFirst({ where: { productId: product.id, isPrimary: true } });
        if (primary) await tx.productBarcode.update({ where: { id: primary.id }, data: { code: dto.barcode, unitCode: (dto.unit ?? updated.unit).trim().toUpperCase() } });
        else await tx.productBarcode.create({ data: { productId: product.id, code: dto.barcode, unitCode: (dto.unit ?? updated.unit).trim().toUpperCase(), quantityFactor: new Prisma.Decimal(1), isPrimary: true } });
      }
      const priceChanges: Array<{ field: string; oldValue: Prisma.Decimal; newValue: Prisma.Decimal }> = [];
      if (dto.costPrice != null && !new Prisma.Decimal(dto.costPrice).equals(product.costPrice)) {
        priceChanges.push({ field: 'costPrice', oldValue: product.costPrice, newValue: new Prisma.Decimal(dto.costPrice) });
      }
      if (dto.salePrice != null && !new Prisma.Decimal(dto.salePrice).equals(product.salePrice)) {
        priceChanges.push({ field: 'salePrice', oldValue: product.salePrice, newValue: new Prisma.Decimal(dto.salePrice) });
      }
      if (priceChanges.length) {
        await tx.productPriceHistory.createMany({
          data: priceChanges.map((change) => ({
            companyId: scope.companyId,
            productId: product.id,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedById: user.sub,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'UPDATE_PRODUCT',
          entityType: 'Product',
          entityId: product.id,
          payload: { branchId: scope.branchId, priceChanged: priceChanges.length > 0 },
        },
      });
      return updated;
    });
  }

  // T360-20260829 value pack 2 — riwayat perubahan harga produk.
  async priceHistory(id: string, user: AuthUser, limitValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = Math.min(Math.max(Number(limitValue ?? 50) || 50, 1), 200);
    const product = await this.prisma.product.findFirst({ where: { id, companyId: scope.companyId }, select: { id: true } });
    if (!product) return this.denyTenantAccess(this.prisma, user, scope, 'Product', id);
    return this.prisma.productPriceHistory.findMany({
      where: { companyId: scope.companyId, productId: id },
      orderBy: [{ changedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async findOne(
    id: string,
    user: AuthUser | undefined,
    branchCode?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    const scope = await this.resolveScope(user, branchCode, requestedCompanyId, requestedBranchId);
    const product = await this.prisma.product.findFirst({
      where: { id, companyId: scope.companyId, isActive: true },
      include: {
        category: true,
        variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] },
        units: { where: { isActive: true }, orderBy: [{ variantId: 'asc' }, { isDefaultSale: 'desc' }, { quantityFactor: 'asc' }], include: { variant: true } },
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], include: { variant: true, productUnit: true } },
        inventories: {
          where: this.inventoryScope(scope),
          include: { warehouse: true },
        },
      },
    });
    if (product) {
      const effectiveSalePrice = await resolveProductUnitPrice(this.prisma, { companyId: scope.companyId, branchId: scope.branchId, product, quantity: 1, segmentCode: 'RETAIL', unitCode: product.unit });
      const units = await Promise.all(product.units.map(async (unit) => ({
        ...unit,
        effectiveSalePrice: await resolveProductUnitPrice(this.prisma, {
          companyId: scope.companyId, branchId: scope.branchId, product, quantity: 1, segmentCode: 'RETAIL',
          unitCode: unit.unitCode, unitFactor: Number(unit.quantityFactor), variantId: unit.variantId,
          variantSalePrice: unit.variant?.salePrice ? new Prisma.Decimal(unit.variant.salePrice).mul(Number(unit.quantityFactor)) : undefined,
        }),
      })));
      const pricedProduct = { ...product, units, effectiveSalePrice };
      if (user) return pricedProduct;
      const { companyId: _companyId, ...publicProduct } = pricedProduct;
      return publicProduct;
    }
    const exists = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (exists) return this.denyTenantAccess(this.prisma, user, scope, 'Product', id);
    throw new NotFoundException('Produk tidak ditemukan.');
  }
}
