import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingCoreService, OperationalTaxLineInput } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { nextDocumentNumber } from '../common/numbering';
import { depositLocationStock } from '../common/location-inventory';
import { serializableTx } from '../common/serializable-tx';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { OperationsControlService } from '../operations-control/operations-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmGoodsReceiptDto, CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';

type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingCoreService,
    private readonly operations: OperationsControlService,
  ) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException('Pengguna belum memiliki company dan branch yang valid.');
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(user: AuthUser, scope: TenantScope, entityType: string, entityId?: string): Promise<never> {
    await this.prisma.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user.sub,
        action: 'TENANT_ACCESS_DENIED',
        entityType,
        entityId,
        payload: { authenticatedBranchId: scope.branchId },
      },
    });
    throw new ForbiddenException(`${entityType} tidak tersedia dalam company dan branch pengguna.`);
  }

  async list(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ receivedAt: string; id: string }>(cursorValue);
    const cursorFilter: Prisma.GoodsReceiptWhereInput | undefined = cursor ? {
      OR: [
        { receivedAt: { lt: new Date(cursor.receivedAt) } },
        { receivedAt: new Date(cursor.receivedAt), id: { lt: cursor.id } },
      ],
    } : undefined;
    const rows = await this.prisma.goodsReceipt.findMany({
      where: {
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
        AND: cursorFilter ? [cursorFilter] : undefined,
      },
      include: { supplier: true, warehouse: true, purchaseOrder: true, items: { include: { product: true } } },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ receivedAt: item.receivedAt.toISOString(), id: item.id }));
  }

  async create(dto: CreateGoodsReceiptDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (!dto.items.length) throw new BadRequestException('Penerimaan harus memiliki minimal satu barang.');
    const poHeader = await this.prisma.purchaseOrder.findFirst({
      where: {
        id: dto.purchaseOrderId,
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
      },
      include: { warehouse: { include: { branch: true } } },
    });
    if (!poHeader) return this.denyTenantAccess(user, scope, 'PurchaseOrder', dto.purchaseOrderId);
    const policy = await this.operations.resolvePolicy(poHeader.warehouse.branch.companyId, poHeader.warehouse.branchId, 'PURCHASE_RECEIPT');

    const idempotencyScope = dto.idempotencyKey ? 'goods-receipt:create' : null;
    const receipt = await serializableTx(this.prisma, async (tx) => {
      if (idempotencyScope) {
        const gate = await beginIdempotent(tx, { companyId: scope.companyId, scope: idempotencyScope, key: dto.idempotencyKey!, payload: dto });
        if (gate.replay && gate.status === 'COMPLETED') return gate.response as never;
      }
      const po = await tx.purchaseOrder.findFirst({
        where: {
          id: dto.purchaseOrderId,
          warehouse: {
            branchId: scope.branchId,
            branch: { companyId: scope.companyId },
          },
          supplier: { companyId: scope.companyId },
          items: { every: { product: { companyId: scope.companyId } } },
        },
        include: { items: { include: { product: true } }, warehouse: { include: { branch: true } } },
      });
      if (!po) throw new ForbiddenException('Purchase order tidak tersedia dalam company dan branch pengguna.');
      if (['CANCELLED','RECEIVED'].includes(po.status)) throw new BadRequestException(`PO berstatus ${po.status} dan tidak dapat diterima lagi.`);
      let taxTotal = new Prisma.Decimal(0), grossTotal = new Prisma.Decimal(0);
      const requestedByPoItem = new Map<string, number>();
      const prepared: Array<{ poItemId: string; productId: string; productName: string; variantId: string | null; productUnitId: string | null; unitCode: string; unitQuantity: number; damagedUnitQuantity: number; quantityFactor: number; quantityReceived: number; damaged: number; accepted: number; unitCost: Prisma.Decimal; net: Prisma.Decimal; tax: Prisma.Decimal; gross: Prisma.Decimal; taxCodeId?: string; batchNumber?: string; expiryDate?: Date; serialNumbers: string[] }> = [];
      for (const input of dto.items) {
        const poItem = po.items.find((item) => item.id === input.purchaseOrderItemId);
        if (!poItem) throw new BadRequestException(`Item PO ${input.purchaseOrderItemId} tidak ditemukan.`);
        const factor = Number(poItem.quantityFactor ?? 1);
        if (!Number.isSafeInteger(factor) || factor < 1) throw new BadRequestException(`Konversi UOM PO ${poItem.product.name} tidak valid.`);
        const unitQuantity = input.quantityReceived;
        const damagedUnitQuantity = input.quantityDamaged ?? 0;
        if (damagedUnitQuantity > unitQuantity) throw new BadRequestException(`Jumlah rusak untuk ${poItem.product.name} melebihi jumlah diterima.`);
        const quantityReceived = unitQuantity * factor;
        const damaged = damagedUnitQuantity * factor;
        if (!Number.isSafeInteger(quantityReceived) || !Number.isSafeInteger(damaged)) throw new BadRequestException(`Konversi penerimaan ${poItem.product.name} tidak aman.`);
        const receivedForLine = (requestedByPoItem.get(poItem.id) ?? 0) + quantityReceived;
        requestedByPoItem.set(poItem.id, receivedForLine);
        const remaining = poItem.orderedQty - poItem.receivedQty;
        if (receivedForLine > remaining) {
          const remainingUnits = Math.floor(remaining / factor);
          throw new BadRequestException(`Penerimaan ${poItem.product.name} melebihi sisa PO (${remainingUnits} ${poItem.unitCode ?? poItem.product.unit}).`);
        }
        const accepted = quantityReceived - damaged;
        const batchNumber = input.batchNumber?.trim();
        const expiryDate = input.expiryDate ? new Date(input.expiryDate) : undefined;
        if (accepted > 0 && poItem.product.trackBatch && !batchNumber) {
          throw new BadRequestException(`Nomor batch wajib untuk ${poItem.product.name}.`);
        }
        if (accepted > 0 && poItem.product.trackExpiry) {
          if (!batchNumber) throw new BadRequestException(`Produk ${poItem.product.name} dengan tracking expiry wajib memiliki batch.`);
          if (!expiryDate) throw new BadRequestException(`Tanggal kedaluwarsa wajib untuk ${poItem.product.name}.`);
        }
        if (expiryDate && Number.isNaN(expiryDate.getTime())) throw new BadRequestException(`Tanggal kedaluwarsa ${poItem.product.name} tidak valid.`);
        if (expiryDate && expiryDate <= new Date()) throw new BadRequestException(`Batch ${batchNumber ?? poItem.product.name} sudah kedaluwarsa dan tidak boleh diterima sebagai stok sellable.`);
        const serialNumbers = (input.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean);
        if (new Set(serialNumbers).size !== serialNumbers.length) throw new BadRequestException(`Nomor serial ${poItem.product.name} tidak boleh duplikat dalam satu penerimaan.`);
        if (poItem.product.trackSerial && serialNumbers.length !== accepted) {
          throw new BadRequestException(`Produk ${poItem.product.name} wajib memiliki tepat ${accepted} serial untuk acceptedQty ${accepted}.`);
        }
        if (!poItem.product.trackSerial && serialNumbers.length) {
          throw new BadRequestException(`Produk ${poItem.product.name} tidak memakai serial; serialNumbers tidak boleh dikirim.`);
        }
        const base = new Prisma.Decimal(poItem.unitCost).mul(accepted);
        const tax = await this.accounting.calculateTax(
          tx,
          input.taxCodeId ?? poItem.product.purchaseTaxCodeId ?? undefined,
          base,
          scope.companyId,
          new Date(),
          ['PURCHASE', 'OTHER'],
        );
        taxTotal = taxTotal.add(tax.tax); grossTotal = grossTotal.add(tax.gross);
        prepared.push({
          poItemId: poItem.id, productId: poItem.productId, productName: poItem.product.name,
          variantId: poItem.variantId ?? null, productUnitId: poItem.productUnitId ?? null,
          unitCode: poItem.unitCode ?? poItem.product.unit, unitQuantity, damagedUnitQuantity, quantityFactor: factor,
          quantityReceived, damaged, accepted, unitCost: poItem.unitCost,
          net: tax.net, tax: tax.tax, gross: tax.gross, taxCodeId: tax.taxCode?.id, batchNumber, expiryDate, serialNumbers,
        });
      }
      const inspectionRequired = policy?.requireInspection ?? true;
      const created = await tx.goodsReceipt.create({ data: {
        number: await nextDocumentNumber(tx, { companyId: po.warehouse.branch.companyId, branchId: po.warehouse.branchId, documentType: 'GOODS_RECEIPT', prefix: 'GRN' }), purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: po.warehouseId,
        supplierInvoice: dto.supplierInvoice, deliveryNote: dto.deliveryNote, notes: dto.notes,
        operationalStatus: inspectionRequired ? 'PENDING_INSPECTION' : 'READY_TO_CONFIRM', inspectionRequired,
        taxTotal, grossTotal,
        items: { create: prepared.map((item) => ({
          purchaseOrderItemId: item.poItemId, productId: item.productId, variantId: item.variantId, productUnitId: item.productUnitId,
          unitCode: item.unitCode, unitQuantity: item.unitQuantity, damagedUnitQuantity: item.damagedUnitQuantity, quantityFactor: item.quantityFactor,
          quantityReceived: item.quantityReceived, quantityDamaged: item.damaged, acceptedQty: item.accepted, unitCost: item.unitCost, subtotal: item.net,
          taxCodeId: item.taxCodeId, taxAmount: item.tax, grossSubtotal: item.gross, batchNumber: item.batchNumber, expiryDate: item.expiryDate, serialNumbers: item.serialNumbers,
        })) },
      } });
      let inspectionId: string | undefined;
      if (inspectionRequired) {
        const inspectionTemplate = policy?.inspectionTemplateCode
          ? await tx.inspectionTemplate.findFirst({
              where: { companyId: po.warehouse.branch.companyId, code: policy.inspectionTemplateCode, status: 'ACTIVE' },
              orderBy: { version: 'desc' },
              include: { items: { orderBy: { sequence: 'asc' } } },
            })
          : null;
        const inspection = await tx.operationalInspection.create({ data: {
          companyId: po.warehouse.branch.companyId, branchId: po.warehouse.branchId, number: await nextDocumentNumber(tx, { companyId: po.warehouse.branch.companyId, branchId: po.warehouse.branchId, documentType: 'INSPECTION_IN', prefix: 'INSP-IN' }), type: 'PURCHASE_INBOUND',
          sourceType: 'GoodsReceipt', sourceId: created.id, templateId: inspectionTemplate?.id, status: 'IN_PROGRESS', inspectedById: user?.sub,
          startedAt: new Date(), mismatchCount: prepared.filter((item) => item.damaged > 0).length,
          results: { create: [
            ...(inspectionTemplate?.items.map((item) => ({
              templateItemId: item.id, code: item.code, label: item.label, result: 'OBSERVATION' as const, value: Prisma.JsonNull,
            })) ?? []),
            ...prepared.map((item) => ({
              code: `PRODUCT-${item.productId}`, label: item.productName, result: item.damaged > 0 ? 'OBSERVATION' as const : 'PASS' as const, productId: item.productId,
              expectedQty: item.quantityReceived, scannedQty: 0, acceptedQty: item.accepted,
              rejectedQty: item.damaged, damagedQty: item.damaged, missingQty: 0, extraQty: 0,
              notes: item.damaged > 0 ? `${item.damaged} unit rusak/ditolak.` : 'Jumlah dan kondisi awal sesuai.',
            })),
          ] },
        } });
        inspectionId = inspection.id;
        await tx.goodsReceipt.update({ where: { id: created.id }, data: { inspectionId } });
      }
      await tx.operationalConfirmation.create({ data: {
        companyId: po.warehouse.branch.companyId, branchId: po.warehouse.branchId, sourceType: 'GoodsReceipt', sourceId: created.id,
        confirmationType: 'GOODS_RECEIPT_CONFIRMATION', status: 'PENDING', requestedById: user?.sub, inspectionId,
        conditions: policy ? { policyCode: policy.code, requiredConfirmations: policy.requiredConfirmations } : { policyCode: 'DEFAULT' },
      } });
      await tx.auditLog.create({ data: { companyId: po.warehouse.branch.companyId, userId: user?.sub, action: 'CREATE_GOODS_RECEIPT_DRAFT', entityType: 'GoodsReceipt', entityId: created.id, payload: dto as unknown as Prisma.InputJsonValue } });
      const result = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: created.id }, include: { supplier: true, warehouse: true, purchaseOrder: true, items: { include: { product: true } } } });
      if (idempotencyScope) await completeIdempotent(tx, { companyId: scope.companyId, scope: idempotencyScope, key: dto.idempotencyKey!, resourceType: 'GoodsReceipt', resourceId: result.id, response: result });
      return result;
    });

    if (dto.autoConfirm && !receipt.inspectionRequired && (policy?.autoPostInventory ?? true) && (policy?.autoPostAccounting ?? true)) return this.confirm(receipt.id, {}, user);
    return receipt;
  }

  async confirm(id: string, dto: ConfirmGoodsReceiptDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const scopedReceipt = await this.prisma.goodsReceipt.findFirst({
      where: {
        id,
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
      },
      select: { id: true },
    });
    if (!scopedReceipt) return this.denyTenantAccess(user, scope, 'GoodsReceipt', id);

    return serializableTx(this.prisma, async (tx) => {
      const receipt = await tx.goodsReceipt.findFirst({ where: {
        id,
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
      }, include: {
        items: { include: { product: true, purchaseOrderItem: true } }, purchaseOrder: { include: { items: true } },
        warehouse: { include: { branch: true } }, supplier: true,
      } });
      if (!receipt) throw new NotFoundException('Penerimaan barang tidak ditemukan.');
      if (receipt.operationalStatus === 'CONFIRMED' || receipt.operationalStatus === 'PARTIALLY_ACCEPTED') return receipt;
      if (['REJECTED','CANCELLED'].includes(receipt.operationalStatus)) throw new BadRequestException(`Penerimaan berstatus ${receipt.operationalStatus}.`);
      const inspectionId = dto.inspectionId ?? receipt.inspectionId ?? undefined;
      if (receipt.inspectionRequired) {
        if (!inspectionId) throw new BadRequestException('Pemeriksaan barang wajib.');
        const inspection = await tx.operationalInspection.findFirst({ where: {
          id: inspectionId,
          companyId: scope.companyId,
          branchId: scope.branchId,
          sourceType: 'GoodsReceipt',
          sourceId: receipt.id,
        } });
        if (!inspection) throw new BadRequestException('Pemeriksaan tidak sesuai penerimaan.');
        if (!['PASSED','PARTIAL','APPROVED'].includes(inspection.status)) throw new BadRequestException(`Pemeriksaan berstatus ${inspection.status} dan belum dapat dikonfirmasi.`);
        const policy = await tx.operationPolicy.findFirst({
          where: { companyId: scope.companyId, operationType: 'PURCHASE_RECEIPT', enabled: true, OR: [{ branchId: scope.branchId }, { branchId: null }] },
          orderBy: [{ branchId: 'desc' }, { updatedAt: 'desc' }],
        });
        if ((policy?.blockOnMismatch ?? true) && inspection.status === 'PARTIAL') {
          throw new BadRequestException('Penerimaan memiliki mismatch dan harus disetujui terlebih dahulu sebelum stok/jurnal diposting.');
        }
      }
      const serialsByItem = new Map<string, string[]>();
      const allInboundSerials = new Set<string>();
      for (const item of receipt.items) {
        const raw = Array.isArray(item.serialNumbers) ? item.serialNumbers : [];
        const serialNumbers = raw.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
        if (item.product.trackSerial) {
          if (serialNumbers.length !== item.acceptedQty) throw new BadRequestException(`Serial ${item.product.name} tidak lengkap: butuh ${item.acceptedQty}, tersimpan ${serialNumbers.length}.`);
          for (const serialNumber of serialNumbers) {
            if (allInboundSerials.has(serialNumber)) throw new BadRequestException(`Serial ${serialNumber} duplikat dalam dokumen penerimaan.`);
            allInboundSerials.add(serialNumber);
          }
        } else if (serialNumbers.length) {
          throw new BadRequestException(`Produk ${item.product.name} tidak memakai serial tetapi dokumen menyimpan serialNumbers.`);
        }
        serialsByItem.set(item.id, serialNumbers);
      }
      if (allInboundSerials.size) {
        const existingSerials = await tx.inventorySerial.findMany({ where: { serialNumber: { in: [...allInboundSerials] } }, select: { serialNumber: true } });
        if (existingSerials.length) throw new BadRequestException(`Serial sudah terdaftar: ${existingSerials.map((row) => row.serialNumber).join(', ')}.`);
      }

      const acceptedByPoItem = new Map<string, number>();
      for (const item of receipt.items) acceptedByPoItem.set(item.purchaseOrderItemId, (acceptedByPoItem.get(item.purchaseOrderItemId) ?? 0) + item.acceptedQty);
      for (const [poItemId, acceptedQty] of acceptedByPoItem) {
        const poItem = receipt.purchaseOrder.items.find((item) => item.id === poItemId);
        if (!poItem) throw new BadRequestException(`Item PO ${poItemId} tidak ditemukan saat konfirmasi.`);
        const remaining = poItem.orderedQty - poItem.receivedQty;
        if (acceptedQty > remaining) throw new BadRequestException(`Jumlah diterima untuk item PO ${poItemId} melebihi sisa PO (${remaining}). Buat penerimaan baru sesuai sisa yang valid.`);
      }
      let net = new Prisma.Decimal(0), tax = new Prisma.Decimal(0), gross = new Prisma.Decimal(0);
      const taxGroups = new Map<string, { base: Prisma.Decimal; tax: Prisma.Decimal }>();
      for (const item of receipt.items) {
        net = net.add(item.subtotal); tax = tax.add(item.taxAmount); gross = gross.add(item.grossSubtotal);
        await tx.purchaseOrderItem.update({ where: { id: item.purchaseOrderItemId }, data: { receivedQty: { increment: item.acceptedQty } } });
        if (item.acceptedQty > 0) {
          const locationStock = await depositLocationStock(tx, { warehouseId: receipt.warehouseId, productId: item.productId, quantity: item.acceptedQty });
          const inventory = await tx.inventory.upsert({
            where: { warehouseId_productId: { warehouseId: receipt.warehouseId, productId: item.productId } },
            create: { warehouseId: receipt.warehouseId, productId: item.productId, quantity: item.acceptedQty, available: item.acceptedQty },
            update: { quantity: { increment: item.acceptedQty }, available: { increment: item.acceptedQty } },
          });
          await tx.inventoryMovement.create({ data: {
            warehouseId: receipt.warehouseId, productId: item.productId, locationId: locationStock.locationId, type: 'PURCHASE_RECEIPT', quantity: item.acceptedQty,
            balanceAfter: inventory.quantity, referenceType: 'GoodsReceipt', referenceId: receipt.id,
            notes: item.quantityDamaged ? `${item.quantityDamaged} unit rusak/ditolak dan tidak masuk stok.` : dto.notes,
          } });
          if (item.batchNumber) {
            const existingBatch = await tx.inventoryBatch.findUnique({
              where: { warehouseId_productId_batchNumber: { warehouseId: receipt.warehouseId, productId: item.productId, batchNumber: item.batchNumber } },
            });
            if (existingBatch?.expiryDate && item.expiryDate && existingBatch.expiryDate.getTime() !== item.expiryDate.getTime()) {
              throw new BadRequestException(`Tanggal kedaluwarsa batch ${item.batchNumber} berbeda dari batch yang sudah terdaftar.`);
            }
            await tx.inventoryBatch.upsert({
              where: { warehouseId_productId_batchNumber: { warehouseId: receipt.warehouseId, productId: item.productId, batchNumber: item.batchNumber } },
              create: { warehouseId: receipt.warehouseId, productId: item.productId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, quantity: item.acceptedQty, metadata: { goodsReceiptId: receipt.id } },
              update: { quantity: { increment: item.acceptedQty }, ...(existingBatch?.expiryDate ? {} : item.expiryDate ? { expiryDate: item.expiryDate } : {}) },
            });
          }
          if (item.product.trackSerial) {
            for (const serialNumber of serialsByItem.get(item.id) ?? []) {
              await tx.inventorySerial.create({ data: {
                warehouseId: receipt.warehouseId,
                productId: item.productId,
                serialNumber,
                status: 'AVAILABLE',
                referenceType: 'GoodsReceiptItem',
                referenceId: item.id,
                metadata: { goodsReceiptId: receipt.id },
              } });
            }
          }
        }
        if (item.taxCodeId && new Prisma.Decimal(item.taxAmount).greaterThan(0)) {
          const current = taxGroups.get(item.taxCodeId) ?? { base: new Prisma.Decimal(0), tax: new Prisma.Decimal(0) };
          current.base = current.base.add(item.subtotal); current.tax = current.tax.add(item.taxAmount); taxGroups.set(item.taxCodeId, current);
        }
      }
      const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: receipt.purchaseOrderId } });
      const complete = updatedItems.every((item) => item.receivedQty >= item.orderedQty);
      await tx.purchaseOrder.update({ where: { id: receipt.purchaseOrderId }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
      const taxLines: OperationalTaxLineInput[] = [...taxGroups.entries()].map(([taxCodeId, value]) => ({ taxCodeId, direction: 'INPUT', taxableBase: value.base, taxAmount: value.tax, counterpartyType: 'SUPPLIER', counterpartyId: receipt.supplierId, documentNumber: receipt.supplierInvoice ?? undefined }));
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: receipt.warehouse.branch.companyId, branchId: receipt.warehouse.branchId, eventType: 'PURCHASE_RECEIPT_CREDIT',
        sourceType: 'GoodsReceipt', sourceId: receipt.id, idempotencyKey: `goods-receipt-confirm:${receipt.id}`,
        amounts: { inventory: net, inputTax: tax, payable: gross, gross, net, tax },
        accountCodes: { inventory: '1301', inputTax: '1205', payable: '2101' },
        lines: receipt.items.map((item) => ({ itemType: 'Product', itemId: item.productId, description: item.product.name, quantity: item.acceptedQty, unitAmount: item.unitCost, netAmount: item.subtotal, taxAmount: item.taxAmount, grossAmount: item.grossSubtotal, taxCodeId: item.taxCodeId ?? undefined, dimensions: { warehouseId: receipt.warehouseId } })),
        taxLines, context: { supplierId: receipt.supplierId, purchaseOrderId: receipt.purchaseOrderId, inspectionId },
      });
      const partial = receipt.items.some((item) => item.quantityDamaged > 0);
      await tx.operationalConfirmation.updateMany({ where: { sourceType: 'GoodsReceipt', sourceId: receipt.id, confirmationType: 'GOODS_RECEIPT_CONFIRMATION', status: 'PENDING' }, data: { status: 'APPROVED', confirmedById: user?.sub, confirmedAt: new Date(), inspectionId, decision: { accepted: true, partial } } });
      await tx.eventOutbox.create({ data: { companyId: receipt.warehouse.branch.companyId, eventType: 'procurement.goods_receipt.confirmed', aggregateType: 'GoodsReceipt', aggregateId: receipt.id, payload: { receiptId: receipt.id, accountingEventId: event.id, partial } } });
      await tx.auditLog.create({ data: { companyId: receipt.warehouse.branch.companyId, userId: user?.sub, action: 'CONFIRM_GOODS_RECEIPT', entityType: 'GoodsReceipt', entityId: receipt.id, payload: { inspectionId, notes: dto.notes } } });
      return tx.goodsReceipt.update({ where: { id: receipt.id }, data: {
        operationalStatus: partial ? 'PARTIALLY_ACCEPTED' : 'CONFIRMED', inspectionId, confirmedAt: new Date(), confirmedById: user?.sub,
        accountingEventId: event.id, taxTotal: tax, grossTotal: gross, notes: dto.notes ?? receipt.notes,
      }, include: { supplier: true, warehouse: true, purchaseOrder: true, items: { include: { product: true } } } });
    });
  }

  async reject(id: string, reason: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: {
        id,
        warehouse: {
          branchId: scope.branchId,
          branch: { companyId: scope.companyId },
        },
        supplier: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
      },
      include: { warehouse: { include: { branch: true } } },
    });
    if (!receipt) return this.denyTenantAccess(user, scope, 'GoodsReceipt', id);
    if (['CONFIRMED','PARTIALLY_ACCEPTED'].includes(receipt.operationalStatus)) throw new BadRequestException('Penerimaan yang sudah diposting harus diretur/reversal, bukan ditolak.');
    return this.prisma.$transaction(async (tx) => {
      await tx.operationalConfirmation.updateMany({ where: { sourceType: 'GoodsReceipt', sourceId: id, status: 'PENDING' }, data: { status: 'REJECTED', confirmedById: user?.sub, confirmedAt: new Date(), decision: { reason } } });
      await tx.auditLog.create({ data: { companyId: receipt.warehouse.branch.companyId, userId: user?.sub, action: 'REJECT_GOODS_RECEIPT', entityType: 'GoodsReceipt', entityId: id, payload: { reason } } });
      return tx.goodsReceipt.update({ where: { id }, data: { operationalStatus: 'REJECTED', notes: reason } });
    });
  }
}
