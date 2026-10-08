import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProductUnitPrice } from './product-pricing';

type DbClient = Prisma.TransactionClient | PrismaService;
export type TransactionTenantScope = { companyId: string; branchId: string };

export type TransactionUomProduct = {
  id: string;
  unit: string;
  salePrice: Prisma.Decimal | number | string;
};

export type TransactionUomInput = {
  quantity: number;
  barcodeCode?: string;
  productUnitId?: string;
  variantId?: string;
};

export type TransactionUomSnapshot = {
  variantId: string | null;
  productUnitId: string | null;
  unitCode: string;
  unitQuantity: number;
  quantityFactor: number;
  baseQuantity: number;
  sourceBarcode: string | null;
  sellingUnitPrice: Prisma.Decimal;
  baseUnitPrice: Prisma.Decimal;
};

/**
 * Canonical selling-UOM resolver shared by POS and online ordering.
 *
 * ProductUnit is the authority for conversion factors. Barcode is only a
 * shortcut that may point at the same ProductUnit. The returned snapshot is
 * safe to persist on transaction rows so historical fulfillment/returns never
 * need to reconstruct conversion semantics from current master data.
 */
export async function resolveSellingUnitLine(
  client: DbClient,
  scope: TransactionTenantScope,
  product: TransactionUomProduct,
  input: TransactionUomInput,
  segmentCode?: string | null,
  occurredAt?: Date,
): Promise<TransactionUomSnapshot> {
  const baseUnit = product.unit.trim().toUpperCase();
  if (!baseUnit) throw new BadRequestException('Base unit produk belum dikonfigurasi dari master UNIT.');
  const activeBaseUnit = await client.masterReference.findFirst({
    where: { companyId: scope.companyId, branchId: null, type: 'UNIT', code: baseUnit, isActive: true },
    select: { id: true },
  });
  if (!activeBaseUnit) throw new BadRequestException(`Base unit ${baseUnit} tidak aktif pada master UNIT perusahaan.`);
  let unitCode = baseUnit;
  let quantityFactor = 1;
  let sourceBarcode: string | null = null;
  let productUnitId: string | null = null;
  let variantId: string | null = input.variantId?.trim() || null;
  let variantSalePrice: Prisma.Decimal | null = null;

  if (input.productUnitId?.trim()) {
    const unit = await client.productUnit.findFirst({
      where: { id: input.productUnitId.trim(), productId: product.id, isActive: true },
      select: {
        id: true,
        variantId: true,
        unitCode: true,
        quantityFactor: true,
        variant: { select: { isActive: true, salePrice: true } },
      },
    });
    if (!unit) throw new BadRequestException('ProductUnit tidak valid/aktif untuk produk yang dipilih.');
    if (variantId && unit.variantId !== variantId) throw new BadRequestException('Variant tidak cocok dengan ProductUnit yang dipilih.');
    if (unit.variantId && !unit.variant?.isActive) throw new BadRequestException('Variant ProductUnit sudah tidak aktif.');
    productUnitId = unit.id;
    variantId = unit.variantId ?? variantId;
    unitCode = unit.unitCode.trim().toUpperCase();
    quantityFactor = Number(unit.quantityFactor);
    variantSalePrice = unit.variant?.salePrice ? new Prisma.Decimal(unit.variant.salePrice) : null;
  }

  if (input.barcodeCode?.trim()) {
    sourceBarcode = input.barcodeCode.trim();
    const barcode = await client.productBarcode.findUnique({
      where: { code: sourceBarcode },
      select: {
        productId: true,
        variantId: true,
        productUnitId: true,
        unitCode: true,
        quantityFactor: true,
        variant: { select: { isActive: true, salePrice: true } },
        productUnit: { select: { id: true, variantId: true, unitCode: true, quantityFactor: true, isActive: true, variant: { select: { isActive: true, salePrice: true } } } },
      },
    });
    if (!barcode || barcode.productId !== product.id) {
      throw new BadRequestException(`Barcode ${sourceBarcode} tidak valid untuk produk yang dipilih.`);
    }
    if (barcode.productUnitId) {
      if (!barcode.productUnit?.isActive) throw new BadRequestException(`ProductUnit untuk barcode ${sourceBarcode} sudah tidak aktif.`);
      if (productUnitId && productUnitId !== barcode.productUnit.id) throw new BadRequestException('Barcode tidak cocok dengan ProductUnit yang dipilih.');
      productUnitId = barcode.productUnit.id;
      unitCode = barcode.productUnit.unitCode.trim().toUpperCase();
      quantityFactor = Number(barcode.productUnit.quantityFactor);
      variantId = barcode.productUnit.variantId ?? barcode.variantId ?? variantId;
      if (barcode.productUnit.variantId && !barcode.productUnit.variant?.isActive) throw new BadRequestException(`Variant ProductUnit untuk barcode ${sourceBarcode} sudah tidak aktif.`);
      if (barcode.productUnit.variant?.salePrice) variantSalePrice = new Prisma.Decimal(barcode.productUnit.variant.salePrice);
    } else {
      quantityFactor = Number(barcode.quantityFactor);
      unitCode = barcode.unitCode?.trim().toUpperCase() || baseUnit;
      variantId = barcode.variantId ?? variantId;
    }
    if (barcode.variantId && variantId && barcode.variantId !== variantId) {
      throw new BadRequestException('Barcode tidak cocok dengan variant yang dipilih.');
    }
    if (barcode.variantId && !barcode.variant?.isActive) throw new BadRequestException(`Variant barcode ${sourceBarcode} sudah tidak aktif.`);
    if (barcode.variant?.salePrice) variantSalePrice = new Prisma.Decimal(barcode.variant.salePrice);
  } else if (variantId) {
    const variant = await client.productVariant.findFirst({
      where: { id: variantId, productId: product.id, isActive: true },
      select: { id: true, salePrice: true },
    });
    if (!variant) throw new BadRequestException('Variant tidak valid/aktif untuk produk yang dipilih.');
    if (variant.salePrice) variantSalePrice = new Prisma.Decimal(variant.salePrice);
  }

  if (unitCode !== baseUnit) {
    const activeSellingUnit = await client.masterReference.findFirst({
      where: { companyId: scope.companyId, branchId: null, type: 'UNIT', code: unitCode, isActive: true },
      select: { id: true },
    });
    if (!activeSellingUnit) throw new BadRequestException(`Unit jual ${unitCode} tidak aktif pada master UNIT perusahaan.`);
  }

  if (!Number.isSafeInteger(quantityFactor) || quantityFactor < 1) {
    throw new BadRequestException('Konversi unit tidak aman untuk stok integer.');
  }
  if (quantityFactor > 1 && unitCode === baseUnit) {
    throw new BadRequestException(`Unit dengan factor > 1 wajib berbeda dari base unit ${baseUnit}.`);
  }
  const unitQuantity = input.quantity;
  const baseQuantity = unitQuantity * quantityFactor;
  if (!Number.isSafeInteger(unitQuantity) || unitQuantity < 1 || !Number.isSafeInteger(baseQuantity) || baseQuantity < 1) {
    throw new BadRequestException('Hasil konversi unit melebihi batas quantity integer yang aman.');
  }

  const packageFallback = new Prisma.Decimal(variantSalePrice ?? product.salePrice).mul(quantityFactor);
  const sellingUnitPrice = await resolveProductUnitPrice(client, {
    companyId: scope.companyId,
    branchId: scope.branchId,
    product: { id: product.id, salePrice: packageFallback },
    quantity: unitQuantity,
    segmentCode,
    unitCode,
    unitFactor: quantityFactor,
    variantId,
    variantSalePrice: packageFallback,
    occurredAt,
  });
  const baseUnitPrice = sellingUnitPrice.div(quantityFactor).toDecimalPlaces(6);

  return {
    variantId,
    productUnitId,
    unitCode,
    unitQuantity,
    quantityFactor,
    baseQuantity,
    sourceBarcode,
    sellingUnitPrice,
    baseUnitPrice,
  };
}
