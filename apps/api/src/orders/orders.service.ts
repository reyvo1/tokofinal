import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AccountingCoreService, OperationalTaxLineInput } from '../accounting-core/accounting-core.service';
import { AuthUser } from '../auth/auth.types';
import { nextDocumentNumber } from '../common/numbering';
import { consumeLocationReservations, releaseLocationReservations, reserveLocationStock } from '../common/location-inventory';
import { serializableTx } from '../common/serializable-tx';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { resolveLoyaltyTier } from '../common/loyalty-tier';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { resolveSellingUnitLine } from '../common/transaction-uom';
import { PrismaService } from '../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { StorefrontCustomerService } from '../storefront-customer/storefront-customer.service';
import { CancelOrderDto, ConfirmOrderPaymentDto, CreateOrderDto, DispatchOrderDto, PayOrderDto } from './dto/create-order.dto';

type TenantScope = { companyId: string; branchId: string };
type PublicOrderAccess = { id: string; number: string; branchId: string };

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingCoreService,
    private readonly config: ConfigService,
    private readonly storefrontCustomers: StorefrontCustomerService,
    private readonly promotions: PromotionsService,
  ) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException('Pengguna belum memiliki company dan branch yang valid.');
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private normalizeBranchCode(branchCode?: string): string {
    const normalized = branchCode?.trim().toUpperCase();
    if (!normalized) throw new NotFoundException('Pesanan tidak ditemukan.');
    return normalized;
  }

  private orderAccessSecret(): string {
    return this.config.get<string>('ORDER_ACCESS_SECRET')
      ?? this.config.get<string>('JWT_SECRET')
      ?? 'development-secret-change-me';
  }

  private createOrderAccessToken(order: PublicOrderAccess): string {
    return createHmac('sha256', this.orderAccessSecret())
      .update(`v1:${order.id}:${order.number}:${order.branchId}`)
      .digest('base64url');
  }

  private hasValidAccessToken(order: PublicOrderAccess, accessToken?: string): boolean {
    if (!accessToken) return false;
    const expected = Buffer.from(this.createOrderAccessToken(order));
    const supplied = Buffer.from(accessToken.trim());
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  }

  private async recordPublicAccessDenied(
    companyId: string,
    orderId: string,
    requestedBranchCode?: string,
    reason = 'INVALID_PUBLIC_ORDER_ACCESS',
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        action: 'TENANT_ACCESS_DENIED',
        entityType: 'Order',
        entityId: orderId,
        payload: { requestedBranchCode, reason },
      },
    });
  }

  private withAccessToken<T extends PublicOrderAccess>(order: T): T & { accessToken: string } {
    return { ...order, accessToken: this.createOrderAccessToken(order) };
  }

  async list(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<{ createdAt: string; id: string }>(cursorValue);
    const cursorFilter: Prisma.OrderWhereInput | undefined = cursor ? {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ],
    } : undefined;
    const rows = await this.prisma.order.findMany({
      where: {
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
        items: { every: { product: { companyId: scope.companyId } } },
        AND: cursorFilter ? [cursorFilter] : undefined,
      },
      include: { items: { include: { product: true } }, payments: true, warehouse: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(rows, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  async getByNumber(number: string, branchCode?: string, accessToken?: string) {
    const normalizedBranchCode = this.normalizeBranchCode(branchCode);
    const order = await this.prisma.order.findUnique({
      where: { number },
      include: {
        items: { include: { product: true } },
        payments: true,
        branch: { select: { id: true, code: true, companyId: true } },
      },
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan.');
    if (order.branch.code.toUpperCase() !== normalizedBranchCode || !this.hasValidAccessToken(order, accessToken)) {
      await this.recordPublicAccessDenied(order.branch.companyId, order.id, branchCode);
      throw new NotFoundException('Pesanan tidak ditemukan.');
    }
    if (order.items.some((item) => item.product.companyId !== order.branch.companyId)) {
      await this.recordPublicAccessDenied(order.branch.companyId, order.id, branchCode, 'PUBLIC_ORDER_PRODUCT_COMPANY_MISMATCH');
      throw new NotFoundException('Pesanan tidak ditemukan.');
    }
    const { branch: _branch, ...result } = order;
    return this.withAccessToken({
      ...result,
      items: result.items.map((item) => {
        const { companyId: _companyId, ...product } = item.product;
        return { ...item, product };
      }),
    });
  }

  async create(dto: CreateOrderDto, headerIdempotencyKey?: string, customerSessionToken?: string) {
    if (!dto.items.length) throw new BadRequestException('Pesanan harus memiliki barang.');
    const bodyIdempotencyKey = dto.idempotencyKey?.trim();
    const headerKey = headerIdempotencyKey?.trim();
    if (bodyIdempotencyKey && headerKey && bodyIdempotencyKey !== headerKey) {
      throw new BadRequestException('Idempotency key pada body dan header harus sama.');
    }
    const idemKey = bodyIdempotencyKey || headerKey;
    if (!idemKey) {
      throw new BadRequestException('Idempotency key wajib untuk checkout. Kirim idempotencyKey atau header Idempotency-Key dan gunakan key yang sama saat retry.');
    }
    if (idemKey.length > 200) throw new BadRequestException('Idempotency key maksimal 200 karakter.');
    const branchCode = this.normalizeBranchCode(dto.branchCode);
    const customerIdentity = customerSessionToken
      ? await this.storefrontCustomers.authenticate(branchCode, customerSessionToken)
      : null;

    return serializableTx(this.prisma, async (tx) => {
      const branch = await tx.branch.findUnique({
        where: { code: branchCode },
        select: { id: true, companyId: true, isActive: true },
      });
      if (!branch?.isActive) throw new NotFoundException('Cabang storefront tidak ditemukan.');
      if (customerIdentity && (customerIdentity.companyId !== branch.companyId || customerIdentity.branchId !== branch.id)) {
        throw new ForbiddenException('Sesi pelanggan tidak berlaku pada cabang storefront ini.');
      }
      const scopeKey = `order:create:${branch.id}:${customerIdentity?.customerId ?? 'guest'}`;
      const { idempotencyKey: _bodyKey, ...idempotencyPayload } = dto;
      const gate = await beginIdempotent(tx, { companyId: branch.companyId, scope: scopeKey, key: idemKey, payload: idempotencyPayload });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response as never;

      const warehouse = dto.warehouseId
        ? await tx.warehouse.findFirst({
            where: { id: dto.warehouseId, branchId: branch.id, isActive: true },
            include: { branch: true },
          })
        : await tx.warehouse.findFirst({
            where: { branchId: branch.id, isDefault: true, isActive: true },
            include: { branch: true },
          }) ?? await tx.warehouse.findFirst({
            where: { branchId: branch.id, isActive: true },
            include: { branch: true },
          });
      if (!warehouse) throw new NotFoundException('Gudang storefront belum tersedia pada cabang ini.');

      const fulfillmentType = dto.fulfillmentType ?? 'DELIVERY';
      const courierRows = await tx.masterReference.findMany({
        where: { companyId: branch.companyId, type: 'COURIER', isActive: true, OR: [{ branchId: null }, { branchId: branch.id }] },
        orderBy: [{ code: 'asc' }],
      });
      const requestedShippingCode = dto.shippingMethodCode?.trim().toUpperCase();
      const selectedCourier = requestedShippingCode
        ? courierRows.find((row) => row.code.toUpperCase() === requestedShippingCode)
        : courierRows.find((row) => {
            const meta = (row.metadata as Record<string, unknown> | null) ?? {};
            const rowType = String(meta.fulfillmentType ?? (row.code === 'PICKUP' ? 'PICKUP' : 'DELIVERY')).toUpperCase();
            return rowType === fulfillmentType;
          });
      if (!selectedCourier) throw new BadRequestException(`Metode fulfillment ${fulfillmentType} belum dikonfigurasi untuk cabang ini.`);
      const courierMeta = (selectedCourier.metadata as Record<string, unknown> | null) ?? {};
      const courierFulfillment = String(courierMeta.fulfillmentType ?? (selectedCourier.code === 'PICKUP' ? 'PICKUP' : 'DELIVERY')).toUpperCase();
      if (courierFulfillment !== fulfillmentType) throw new BadRequestException('Metode pengiriman tidak sesuai dengan tipe fulfillment yang dipilih.');
      const configuredShippingCost = Number(courierMeta.price ?? 0);
      if (!Number.isFinite(configuredShippingCost) || configuredShippingCost < 0) throw new BadRequestException('Konfigurasi biaya pengiriman tidak valid.');
      const shippingCost = new Prisma.Decimal(fulfillmentType === 'PICKUP' ? 0 : configuredShippingCost).toDecimalPlaces(2);

      let resolvedAddress = dto.address?.trim() || '';
      let resolvedCustomerAddressId: string | null = null;
      let resolvedCustomerName = customerIdentity?.customer.name ?? dto.customerName;
      let resolvedCustomerPhone = customerIdentity?.customer.phone ?? dto.customerPhone;
      if (fulfillmentType === 'PICKUP') {
        resolvedAddress = warehouse.address?.trim() || warehouse.branch.address?.trim() || `${warehouse.name} (${warehouse.code})`;
      } else if (dto.customerAddressId) {
        if (!customerIdentity) throw new BadRequestException('customerAddressId hanya dapat dipakai oleh pelanggan yang login.');
        const savedAddress = await tx.customerAddress.findFirst({ where: { id: dto.customerAddressId, customerId: customerIdentity.customerId, isActive: true } });
        if (!savedAddress) throw new BadRequestException('Alamat tersimpan tidak ditemukan pada akun pelanggan.');
        resolvedCustomerAddressId = savedAddress.id;
        resolvedCustomerName = savedAddress.recipientName;
        resolvedCustomerPhone = savedAddress.phone;
        resolvedAddress = [savedAddress.addressLine, savedAddress.district, savedAddress.city, savedAddress.province, savedAddress.postalCode].map((value) => value?.trim()).filter(Boolean).join(', ');
      } else if (!resolvedAddress && customerIdentity?.customer.address) {
        resolvedAddress = customerIdentity.customer.address.trim();
      }
      if (fulfillmentType === 'DELIVERY' && !resolvedAddress) throw new BadRequestException('Alamat pengiriman wajib untuk fulfillment DELIVERY.');

      const ids = [...new Set(dto.items.map((item) => item.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: ids }, companyId: branch.companyId, isActive: true },
      });
      if (products.length !== ids.length) {
        const accepted = new Set(products.map((product) => product.id));
        const missingIds = ids.filter((id) => !accepted.has(id));
        const crossTenant = await tx.product.findFirst({ where: { id: { in: missingIds } }, select: { id: true } });
        if (crossTenant) {
          await tx.auditLog.create({
            data: {
              companyId: branch.companyId,
              action: 'TENANT_ACCESS_DENIED',
              entityType: 'Product',
              entityId: crossTenant.id,
              payload: { requestedBranchCode: branchCode, reason: 'PUBLIC_PRODUCT_COMPANY_MISMATCH' },
            },
          });
        }
        throw new BadRequestException('Produk tidak ditemukan.');
      }

      const requestedTaxCodeIds = [...new Set(dto.items
        .map((input) => input.taxCodeId ?? products.find((product) => product.id === input.productId)?.salesTaxCodeId)
        .filter((value): value is string => Boolean(value)))];
      if (requestedTaxCodeIds.length) {
        const availableTaxCodes = await tx.taxCode.count({
          where: { id: { in: requestedTaxCodeIds }, companyId: branch.companyId, status: 'ACTIVE' },
        });
        if (availableTaxCodes !== requestedTaxCodeIds.length) {
          throw new BadRequestException('Tax code tidak tersedia untuk company storefront.');
        }
      }

      let rawSubtotal = new Prisma.Decimal(0);
      let netTotal = new Prisma.Decimal(0);
      let taxTotal = new Prisma.Decimal(0);
      let total = new Prisma.Decimal(0);
      const transactionAt = new Date();
      const raw = [] as Array<{
        input: (typeof dto.items)[number];
        product: (typeof products)[number];
        line: Prisma.Decimal;
        conversion: Awaited<ReturnType<typeof resolveSellingUnitLine>>;
      }>;
      const prepared = [] as Array<{
        productId: string;
        variantId: string | null;
        productUnitId: string | null;
        unitCode: string;
        unitQuantity: number;
        quantityFactor: number;
        sourceBarcode: string | null;
        quantity: number;
        unitPrice: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        subtotal: Prisma.Decimal;
        netSubtotal: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        grossSubtotal: Prisma.Decimal;
        taxCodeId?: string;
      }>;

      for (const input of dto.items) {
        const product = products.find((value) => value.id === input.productId)!;
        const conversion = await resolveSellingUnitLine(
          tx,
          { companyId: branch.companyId, branchId: branch.id },
          product,
          input,
          customerIdentity?.customer.customerType ?? 'RETAIL',
          transactionAt,
        );
        const inventory = await tx.inventory.findUnique({
          where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } },
        });
        if ((!inventory || inventory.available < conversion.baseQuantity) && !product.allowNegativeStock) {
          throw new BadRequestException(
            `Stok ${product.name} tidak mencukupi untuk ${conversion.unitQuantity} ${conversion.unitCode} (${conversion.baseQuantity} ${product.unit}).`,
          );
        }
        const line = conversion.sellingUnitPrice.mul(conversion.unitQuantity);
        rawSubtotal = rawSubtotal.add(line);
        raw.push({ input, product, line, conversion });
      }

      const promotion = await this.promotions.resolveSalePromotion(
        tx,
        { companyId: branch.companyId, branchId: branch.id },
        rawSubtotal,
        dto.promoCode,
        transactionAt,
        customerIdentity?.customerId,
        {
          channel: 'STOREFRONT',
          lines: raw.map((item) => ({
            productId: item.product.id,
            quantity: item.conversion.unitQuantity,
            unitPrice: item.conversion.sellingUnitPrice,
          })),
        },
      );
      const promoDiscount = promotion.discount;
      let allocatedDiscount = new Prisma.Decimal(0);
      for (const [index, item] of raw.entries()) {
        const share = rawSubtotal.isZero()
          ? new Prisma.Decimal(0)
          : index === raw.length - 1
            ? promoDiscount.sub(allocatedDiscount)
            : promoDiscount.mul(item.line).div(rawSubtotal).toDecimalPlaces(2);
        allocatedDiscount = allocatedDiscount.add(share);
        const discountedBase = item.line.sub(share);
        const calc = await this.accounting.calculateTax(
          tx,
          item.input.taxCodeId ?? item.product.salesTaxCodeId ?? undefined,
          discountedBase,
          branch.companyId,
          transactionAt,
          ['SALE', 'OTHER'],
        );
        netTotal = netTotal.add(calc.net);
        taxTotal = taxTotal.add(calc.tax);
        total = total.add(calc.gross);
        prepared.push({
          productId: item.product.id,
          variantId: item.conversion.variantId,
          productUnitId: item.conversion.productUnitId,
          unitCode: item.conversion.unitCode,
          unitQuantity: item.conversion.unitQuantity,
          quantityFactor: item.conversion.quantityFactor,
          sourceBarcode: item.conversion.sourceBarcode,
          quantity: item.conversion.baseQuantity,
          unitPrice: item.conversion.sellingUnitPrice,
          unitCost: item.product.costPrice,
          subtotal: calc.gross,
          netSubtotal: calc.net,
          taxAmount: calc.tax,
          grossSubtotal: calc.gross,
          taxCodeId: calc.taxCode?.id,
        });
      }

      total = total.add(shippingCost);

      const order = await tx.order.create({
        data: {
          number: await nextDocumentNumber(tx, { companyId: branch.companyId, branchId: branch.id, documentType: 'ORDER', prefix: 'ORD' }),
          branchId: branch.id,
          warehouseId: warehouse.id,
          customerId: customerIdentity?.customerId,
          customerName: resolvedCustomerName,
          customerEmail: customerIdentity?.customer.email ?? dto.customerEmail,
          customerPhone: resolvedCustomerPhone,
          address: resolvedAddress,
          fulfillmentType,
          customerAddressId: resolvedCustomerAddressId,
          shippingMethodCode: selectedCourier.code,
          shippingMethodName: selectedCourier.name,
          pickupWarehouseId: fulfillmentType === 'PICKUP' ? warehouse.id : null,
          subtotal: netTotal,
          shippingCost,
          discount: promoDiscount,
          tax: taxTotal,
          total,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          items: { create: prepared },
        },
      });
      if (promotion.rule && promoDiscount.greaterThan(0)) {
        await this.promotions.recordRedemption(tx, { companyId: branch.companyId, branchId: branch.id }, promotion.rule.id, customerIdentity?.customerId, 'Order', order.id, promoDiscount);
      }

      const reservationQuantities = new Map<string, number>();
      for (const item of prepared) reservationQuantities.set(item.productId, (reservationQuantities.get(item.productId) ?? 0) + item.quantity);
      for (const [productId, quantity] of reservationQuantities) {
        await reserveLocationStock(tx, { warehouseId: warehouse.id, productId, quantity, sourceType: 'Order', sourceId: order.id });
        const reserved_ = await tx.inventory.updateMany({
          where: { warehouseId: warehouse.id, productId, available: { gte: quantity } },
          data: { reserved: { increment: quantity }, available: { decrement: quantity } },
        });
        if (reserved_.count !== 1) throw new BadRequestException('Stok tidak mencukupi untuk reservasi pesanan.');
      }

      await tx.payment.create({
        data: {
          number: await nextDocumentNumber(tx, { companyId: branch.companyId, branchId: branch.id, documentType: 'PAYMENT', prefix: 'PAY' }),
          orderId: order.id,
          method: 'UNSELECTED',
          amount: order.total,
          status: 'PENDING',
        },
      });
      await tx.eventOutbox.create({
        data: {
          companyId: branch.companyId,
          eventType: 'commerce.order.created',
          aggregateType: 'Order',
          aggregateId: order.id,
          payload: { orderId: order.id, companyId: branch.companyId, branchId: branch.id, fulfillmentType, shippingMethodCode: selectedCourier.code, shippingCost, tax: taxTotal, total, promo: promotion.rule ? { ...promotion.rule, discount: promoDiscount.toFixed(2) } : null },
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: branch.companyId,
          action: 'CREATE_PUBLIC_ORDER',
          entityType: 'Order',
          entityId: order.id,
          payload: { branchId: branch.id, warehouseId: warehouse.id, fulfillmentType, shippingMethodCode: selectedCourier.code, shippingCost, promo: promotion.rule ? { ...promotion.rule, discount: promoDiscount.toFixed(2) } : null },
        },
      });

      const result = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: { include: { product: true } }, payments: true },
      });
      const publicResult = this.withAccessToken(result);
      await completeIdempotent(tx, { companyId: branch.companyId, scope: scopeKey, key: idemKey, resourceType: 'Order', resourceId: order.id, response: publicResult });
      return publicResult;
    });
  }

  private async ensureOutboundWorkflow(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, warehouse: { include: { branch: true } } },
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan.');
    const companyId = order.warehouse.branch.companyId;

    let shipment = await tx.shipment.findFirst({ where: { orderId: order.id } });
    if (!shipment) {
      shipment = await tx.shipment.create({ data: {
        number: await nextDocumentNumber(tx, { companyId, branchId: order.branchId, documentType: 'SHIPMENT', prefix: 'SHP' }),
        orderId: order.id,
        warehouseId: order.warehouseId,
        status: 'DRAFT',
        recipient: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, address: order.address, fulfillmentType: order.fulfillmentType },
        carrier: order.fulfillmentType === 'PICKUP' ? 'STORE_PICKUP' : order.shippingMethodName,
        service: order.shippingMethodCode,
        shippingCost: order.shippingCost,
        packages: {
          uomSnapshotVersion: 1,
          itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
          transactionItemCount: order.items.reduce((sum, item) => sum + (item.unitQuantity ?? item.quantity), 0),
          items: order.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            productUnitId: item.productUnitId,
            unitCode: item.unitCode ?? item.product.unit,
            unitQuantity: item.unitQuantity ?? item.quantity,
            quantityFactor: item.quantityFactor,
            baseQuantity: item.quantity,
          })),
        },
      } });
    }

    let inspection = shipment.outboundInspectionId
      ? await tx.operationalInspection.findFirst({ where: { id: shipment.outboundInspectionId, companyId, branchId: order.branchId } })
      : await tx.operationalInspection.findFirst({ where: { companyId, branchId: order.branchId, sourceType: 'Shipment', sourceId: shipment.id, type: 'ORDER_OUTBOUND' } });
    if (!inspection) {
      const template = await tx.inspectionTemplate.findFirst({
        where: { companyId, code: 'OUTBOUND-STANDARD', status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        include: { items: true },
      });
      inspection = await tx.operationalInspection.create({ data: {
        companyId,
        branchId: order.branchId,
        number: await nextDocumentNumber(tx, { companyId, branchId: order.branchId, documentType: 'INSPECTION', prefix: 'INSP' }),
        type: 'ORDER_OUTBOUND',
        sourceType: 'Shipment',
        sourceId: shipment.id,
        templateId: template?.id,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        metadata: { orderId: order.id, generatedBy: 'storefront-fulfillment' },
        results: { create: [
          ...(template?.items.map((item) => ({ templateItemId: item.id, code: item.code, label: item.label, result: 'OBSERVATION' as const, value: Prisma.JsonNull })) ?? []),
          ...order.items.map((item) => ({
            code: `PRODUCT:${item.productId}`,
            label: `${item.product.name} (${item.product.sku})`,
            result: 'OBSERVATION' as const,
            productId: item.productId,
            expectedQty: item.quantity,
            scannedQty: 0,
            acceptedQty: item.quantity,
          })),
        ] },
      } });
      shipment = await tx.shipment.update({ where: { id: shipment.id }, data: { outboundInspectionId: inspection.id } });
    } else if (shipment.outboundInspectionId !== inspection.id) {
      shipment = await tx.shipment.update({ where: { id: shipment.id }, data: { outboundInspectionId: inspection.id } });
    }

    const confirmation = await tx.operationalConfirmation.findFirst({
      where: { companyId, branchId: order.branchId, sourceType: 'Shipment', sourceId: shipment.id, confirmationType: 'OUTBOUND_PICK_PACK_CONFIRMATION' },
    });
    if (!confirmation) {
      await tx.operationalConfirmation.create({ data: {
        companyId,
        branchId: order.branchId,
        sourceType: 'Shipment',
        sourceId: shipment.id,
        confirmationType: 'OUTBOUND_PICK_PACK_CONFIRMATION',
        status: 'PENDING',
        inspectionId: inspection.id,
        conditions: { inspectionType: 'ORDER_OUTBOUND', requireBarcodeScan: true, requireGatePassForOwnFleet: true },
      } });
    }
    return { shipment, inspection };
  }

  private async postPrepayment(
    tx: Prisma.TransactionClient,
    order: any,
    payment: { id: string; method: string; amount: Prisma.Decimal },
    paymentMethod: string,
    provider?: string,
    externalRef?: string,
  ) {
    const companyId = order.warehouse.branch.companyId as string;
    const existing = await tx.accountingEvent.findUnique({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey: `order-prepayment:${order.id}` } },
    });
    const event = existing ?? await this.accounting.postOperationalEvent(tx, {
      companyId,
      branchId: order.branchId,
      eventType: 'ONLINE_ORDER_PREPAYMENT',
      sourceType: 'Payment',
      sourceId: payment.id,
      idempotencyKey: `order-prepayment:${order.id}`,
      amounts: { gross: order.total, settlement: order.total, customerAdvance: order.total },
      accountCodes: { settlement: '1102', customerAdvance: '2105' },
      context: { orderId: order.id, paymentId: payment.id, paymentMethod, provider, externalRef },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { method: paymentMethod, provider, externalRef, status: 'PAID', paidAt: new Date(), accountingEventId: event.id },
    });
    await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
    await this.ensureOutboundWorkflow(tx, order.id);
    return event;
  }

  async selectPayment(number: string, dto: PayOrderDto, branchCode?: string, accessToken?: string) {
    const normalizedBranchCode = this.normalizeBranchCode(branchCode);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({
        where: { number },
        include: { items: { include: { product: true } }, warehouse: { include: { branch: true } }, payments: true },
      });
      if (!order) throw new NotFoundException('Pesanan tidak ditemukan.');
      if (order.warehouse.branch.code.toUpperCase() !== normalizedBranchCode || !this.hasValidAccessToken(order, accessToken)) {
        await tx.auditLog.create({ data: {
          companyId: order.warehouse.branch.companyId, action: 'TENANT_ACCESS_DENIED', entityType: 'Order', entityId: order.id,
          payload: { requestedBranchCode: branchCode, reason: 'INVALID_PUBLIC_ORDER_PAYMENT_ACCESS' },
        } });
        throw new NotFoundException('Pesanan tidak ditemukan.');
      }
      const payment = order.payments[0];
      if (!payment) throw new BadRequestException('Data pembayaran pesanan tidak ditemukan.');
      const method = (dto.paymentMethod ?? 'MOCK_QRIS').toUpperCase();

      if (order.status !== 'PENDING_PAYMENT') {
        if (payment.method === method && ['PAID','PROCESSING','PACKED','SHIPPED','COMPLETED'].includes(order.status)) {
          const replay = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { product: true } }, payments: true } });
          return this.withAccessToken(replay);
        }
        throw new BadRequestException(`Pesanan berstatus ${order.status}.`);
      }

      if (method === 'MOCK_QRIS') {
        const allowMock = this.config.get<string>('ALLOW_MOCK_PAYMENTS') === 'true' && this.config.get<string>('NODE_ENV') !== 'production';
        if (!allowMock) throw new BadRequestException('MOCK_QRIS dinonaktifkan pada production. Gunakan callback/konfirmasi provider pembayaran.');
        await this.postPrepayment(tx, order as never, payment, method, 'mock', `mock:${order.id}`);
      } else if (method === 'COD') {
        await tx.payment.update({ where: { id: payment.id }, data: { method, status: 'PENDING', paidAt: null, accountingEventId: null } });
        await tx.order.update({ where: { id: order.id }, data: { status: 'PROCESSING' } });
        await this.ensureOutboundWorkflow(tx, order.id);
      } else if (method === 'INVOICE') {
        // Permintaan termin membutuhkan otorisasi backoffice sebelum barang dilepas ke fulfillment.
        await tx.payment.update({ where: { id: payment.id }, data: { method, status: 'PENDING', paidAt: null, accountingEventId: null } });
      } else if (['QRIS','TRANSFER','CARD'].includes(method)) {
        // Pemilihan metode elektronik bukan bukti pembayaran. Jangan pernah mengakui PAID tanpa konfirmasi provider/manual yang terotorisasi.
        await tx.payment.update({ where: { id: payment.id }, data: { method, status: 'PENDING', paidAt: null } });
      } else {
        throw new BadRequestException('Metode pembayaran storefront tidak didukung.');
      }

      await tx.eventOutbox.create({ data: {
        companyId: order.warehouse.branch.companyId,
        eventType: method === 'MOCK_QRIS' ? 'commerce.order.prepaid' : method === 'COD' ? 'commerce.order.fulfillment_released' : method === 'INVOICE' ? 'commerce.order.credit_requested' : 'commerce.order.payment_selected',
        aggregateType: 'Order', aggregateId: order.id,
        payload: { orderId: order.id, companyId: order.warehouse.branch.companyId, branchId: order.branchId, paymentMethod: method },
      } });
      await tx.auditLog.create({ data: {
        companyId: order.warehouse.branch.companyId, action: 'SELECT_PUBLIC_ORDER_PAYMENT', entityType: 'Order', entityId: order.id,
        payload: { branchId: order.branchId, paymentMethod: method },
      } });
      const result = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { product: true } }, payments: true } });
      return this.withAccessToken(result);
    });
  }

  async confirmPayment(id: string, dto: ConfirmOrderPaymentDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } },
        include: { items: { include: { product: true } }, warehouse: { include: { branch: true } }, payments: true },
      });
      if (!order) throw new NotFoundException('Pesanan tidak ditemukan pada branch pengguna.');
      const payment = order.payments[0];
      if (!payment) throw new BadRequestException('Data pembayaran pesanan tidak ditemukan.');
      if (payment.status === 'PAID') return order;
      if (order.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Pesanan berstatus ${order.status}.`);
      const method = (dto.paymentMethod ?? payment.method).toUpperCase();
      if (!['QRIS','TRANSFER','CARD'].includes(method)) throw new BadRequestException('Konfirmasi provider hanya untuk QRIS, TRANSFER, atau CARD.');
      if (!dto.externalRef?.trim()) throw new BadRequestException('Referensi pembayaran provider wajib diisi.');
      const duplicate = await tx.payment.findFirst({ where: { externalRef: dto.externalRef.trim(), id: { not: payment.id }, status: 'PAID' }, select: { id: true } });
      if (duplicate) throw new BadRequestException('Referensi pembayaran provider sudah pernah dipakai.');
      await this.postPrepayment(tx, order as never, payment, method, dto.provider?.trim() || 'manual-confirmation', dto.externalRef.trim());
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'CONFIRM_ORDER_PAYMENT', entityType: 'Order', entityId: order.id,
        payload: { branchId: scope.branchId, paymentMethod: method, provider: dto.provider, externalRef: dto.externalRef },
      } });
      await tx.eventOutbox.create({ data: {
        companyId: scope.companyId, eventType: 'commerce.order.prepaid', aggregateType: 'Order', aggregateId: order.id,
        payload: { companyId: scope.companyId, branchId: scope.branchId, orderId: order.id, paymentMethod: method },
      } });
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { product: true } }, payments: true } });
    });
  }


  async confirmProviderPayment(input: {
    companyId: string;
    branchId?: string | null;
    provider: string;
    paymentNumber?: string;
    orderNumber?: string;
    externalRef: string;
    amount: Prisma.Decimal;
    status: 'PAID' | 'FAILED' | 'CANCELLED';
  }) {
    if (!input.paymentNumber && !input.orderNumber) {
      throw new BadRequestException('Callback provider wajib menyertakan paymentNumber atau orderNumber.');
    }
    return serializableTx(this.prisma, async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          ...(input.paymentNumber ? { number: input.paymentNumber } : {}),
          ...(input.orderNumber ? { order: { number: input.orderNumber } } : {}),
          order: {
            ...(input.orderNumber ? { number: input.orderNumber } : {}),
            branch: { companyId: input.companyId },
            ...(input.branchId ? { branchId: input.branchId } : {}),
          },
        },
        include: { order: { include: { items: { include: { product: true } }, warehouse: { include: { branch: true } }, payments: true } } },
      });
      if (!payment?.order) throw new NotFoundException('Pembayaran/order callback tidak ditemukan pada scope integrasi.');
      const order = payment.order;
      if (!['QRIS','TRANSFER','CARD'].includes(payment.method.toUpperCase())) {
        throw new BadRequestException(`Payment ${payment.number} bukan pembayaran elektronik provider.`);
      }
      if (!payment.amount.equals(input.amount)) {
        throw new BadRequestException(`Nominal callback ${input.amount.toFixed(2)} tidak sama dengan payment ${payment.amount.toFixed(2)}.`);
      }

      if (payment.status === 'PAID') {
        if (input.status === 'PAID' && payment.externalRef === input.externalRef && payment.provider === input.provider) {
          return { order, payment, idempotent: true };
        }
        throw new BadRequestException('Payment sudah PAID dengan referensi/provider berbeda.');
      }
      if (payment.status !== 'PENDING' && input.status === 'PAID') {
        throw new BadRequestException(`Payment berstatus ${payment.status}; callback PAID ditolak.`);
      }

      if (input.status !== 'PAID') {
        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: { status: input.status, provider: input.provider, externalRef: input.externalRef },
        });
        await tx.eventOutbox.create({ data: {
          companyId: input.companyId,
          eventType: input.status === 'FAILED' ? 'commerce.order.payment_failed' : 'commerce.order.payment_cancelled',
          aggregateType: 'Order', aggregateId: order.id,
          payload: { companyId: input.companyId, branchId: order.branchId, orderId: order.id, paymentId: payment.id, provider: input.provider, externalRef: input.externalRef },
        } });
        return { order, payment: updatedPayment, idempotent: false };
      }

      const duplicate = await tx.payment.findFirst({
        where: { externalRef: input.externalRef, id: { not: payment.id }, status: 'PAID' },
        select: { id: true },
      });
      if (duplicate) throw new BadRequestException('Referensi pembayaran provider sudah pernah dipakai.');
      if (order.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Pesanan berstatus ${order.status}; callback PAID ditolak.`);

      await this.postPrepayment(tx, order as never, payment, payment.method.toUpperCase(), input.provider, input.externalRef);
      await tx.eventOutbox.create({ data: {
        companyId: input.companyId, eventType: 'commerce.order.prepaid', aggregateType: 'Order', aggregateId: order.id,
        payload: { companyId: input.companyId, branchId: order.branchId, orderId: order.id, paymentId: payment.id, paymentMethod: payment.method, provider: input.provider, externalRef: input.externalRef },
      } });
      const updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const updatedOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
      return { order: updatedOrder, payment: updatedPayment, idempotent: false };
    });
  }

  async authorizeInvoice(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({ where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } }, include: { payments: true } });
      if (!order) throw new NotFoundException('Pesanan tidak ditemukan pada branch pengguna.');
      if (order.status === 'PROCESSING') return order;
      if (order.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Pesanan tidak dapat diberi termin dari status ${order.status}.`);
      const payment = order.payments[0];
      if (!payment || payment.method !== 'INVOICE' || payment.status !== 'PENDING') throw new BadRequestException('Pesanan tidak sedang meminta metode INVOICE.');
      const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'PROCESSING' } });
      await this.ensureOutboundWorkflow(tx, order.id);
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'AUTHORIZE_ORDER_CREDIT', entityType: 'Order', entityId: order.id, payload: { branchId: scope.branchId, paymentMethod: 'INVOICE' } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'commerce.order.credit_authorized', aggregateType: 'Order', aggregateId: order.id, payload: { companyId: scope.companyId, branchId: scope.branchId, orderId: order.id } } });
      return updated;
    });
  }

  async pack(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({ where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } } });
      if (!order) throw new NotFoundException('Pesanan tidak ditemukan pada branch pengguna.');
      if (order.status === 'PACKED') return order;
      if (!['PAID','PROCESSING'].includes(order.status)) throw new BadRequestException(`Pesanan tidak dapat dipacking dari status ${order.status}.`);
      const shipment = await tx.shipment.findFirst({ where: { orderId: order.id, warehouseId: order.warehouseId } });
      if (!shipment?.outboundInspectionId) throw new BadRequestException('Shipment/inspeksi outbound belum tersedia.');
      const inspection = await tx.operationalInspection.findFirst({ where: { id: shipment.outboundInspectionId, companyId: scope.companyId, branchId: scope.branchId } });
      if (!inspection || inspection.status !== 'APPROVED' || inspection.mismatchCount !== 0 || inspection.blockingFailureCount !== 0) throw new BadRequestException('Inspeksi outbound harus APPROVED tanpa mismatch/failure sebelum packing.');
      const now = new Date();
      await tx.shipment.update({ where: { id: shipment.id }, data: { status: 'READY', confirmedAt: now, confirmedById: user.sub } });
      await tx.operationalConfirmation.updateMany({
        where: { companyId: scope.companyId, branchId: scope.branchId, sourceType: 'Shipment', sourceId: shipment.id, confirmationType: 'OUTBOUND_PICK_PACK_CONFIRMATION', status: 'PENDING' },
        data: { status: 'APPROVED', confirmedById: user.sub, confirmedAt: now, decision: { inspectionId: inspection.id, result: 'APPROVED' } },
      });
      const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'PACKED' } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'PACK_ORDER', entityType: 'Order', entityId: order.id, payload: { branchId: scope.branchId, shipmentId: shipment.id } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'commerce.order.packed', aggregateType: 'Order', aggregateId: order.id, payload: { companyId: scope.companyId, branchId: scope.branchId, orderId: order.id, shipmentId: shipment.id } } });
      return updated;
    });
  }

  private async consumeBatches(tx: Prisma.TransactionClient, warehouseId: string, productId: string, quantity: number) {
    let remaining = quantity;
    const now = new Date();
    const expiringBatches = await tx.inventoryBatch.findMany({
      where: { warehouseId, productId, quantity: { gt: 0 }, expiryDate: { gt: now } },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });
    const nonExpiringBatches = await tx.inventoryBatch.findMany({
      where: { warehouseId, productId, quantity: { gt: 0 }, expiryDate: null },
      orderBy: { createdAt: 'asc' },
    });
    const batches = [...expiringBatches, ...nonExpiringBatches];
    for (const batch of batches) {
      if (remaining <= 0) break;
      const free = Math.max(0, batch.quantity - batch.reserved);
      if (!free) continue;
      const take = Math.min(free, remaining);
      const changed = await tx.inventoryBatch.updateMany({
        where: { id: batch.id, quantity: { gte: batch.reserved + take } },
        data: { quantity: { decrement: take } },
      });
      if (changed.count !== 1) throw new BadRequestException('Stok batch berubah saat fulfillment. Ulangi proses pengiriman.');
      remaining -= take;
    }
    if (remaining > 0) throw new BadRequestException('Stok batch bebas tidak mencukupi untuk pengiriman.');
  }

  async ship(id: string, dto: DispatchOrderDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } },
        include: { items: { include: { product: true } }, warehouse: { include: { branch: true } }, payments: true },
      });
      if (!order) throw new NotFoundException('Pesanan tidak ditemukan pada branch pengguna.');
      if (order.status === 'SHIPPED' || order.status === 'COMPLETED') return order;
      if (order.status !== 'PACKED') throw new BadRequestException(`Pesanan tidak dapat dikirim dari status ${order.status}.`);
      const shipment = await tx.shipment.findFirst({ where: { orderId: order.id, warehouseId: order.warehouseId } });
      if (!shipment || shipment.status !== 'READY') throw new BadRequestException('Shipment harus READY sebelum pengiriman.');

      const isPickup = order.fulfillmentType === 'PICKUP';
      if (isPickup) {
        if (dto.ownFleet || dto.gatePassId) throw new BadRequestException('Pickup toko tidak menggunakan armada/gate pass pengiriman.');
      } else if (dto.ownFleet) {
        if (!dto.gatePassId) throw new BadRequestException('Pengiriman armada sendiri wajib memiliki gate pass outbound.');
        const gate = await tx.gatePass.findFirst({ where: {
          id: dto.gatePassId, companyId: scope.companyId, branchId: scope.branchId,
          sourceType: 'Shipment', sourceId: shipment.id, direction: 'OUTBOUND', status: { in: ['APPROVED','EXITED'] },
        } });
        if (!gate) throw new BadRequestException('Gate pass outbound belum APPROVED/EXITED untuk shipment ini.');
        if (!gate.vehicleId && !gate.plateNumber?.trim()) throw new BadRequestException('Pengiriman armada sendiri wajib memiliki kendaraan/nomor polisi pada gate pass.');
      } else if (!dto.carrier?.trim() || !dto.trackingNumber?.trim()) {
        throw new BadRequestException('Carrier dan nomor resi wajib untuk pengiriman eksternal.');
      }

      const payment = order.payments[0];
      if (!payment) throw new BadRequestException('Pembayaran pesanan tidak ditemukan.');
      const prepaid = payment.status === 'PAID';
      const deferred = ['COD','INVOICE'].includes(payment.method);
      if (!prepaid && !deferred) throw new BadRequestException('Pesanan elektronik belum terkonfirmasi dibayar dan tidak dapat dikirim.');

      const costTotal = order.items.reduce((sum, item) => sum.add(new Prisma.Decimal(item.unitCost).mul(item.quantity)), new Prisma.Decimal(0));
      const taxGroups = new Map<string, { base: Prisma.Decimal; tax: Prisma.Decimal }>();
      const fulfillmentQuantities = new Map<string, { quantity: number; productName: string }>();
      for (const item of order.items) {
        const current = fulfillmentQuantities.get(item.productId);
        fulfillmentQuantities.set(item.productId, { quantity: (current?.quantity ?? 0) + item.quantity, productName: item.product.name });
      }
      for (const [productId, value] of fulfillmentQuantities) {
        const allocations = await consumeLocationReservations(tx, { sourceType: 'Order', sourceId: order.id, warehouseId: order.warehouseId, productId, quantity: value.quantity });
        const changed = await tx.inventory.updateMany({
          where: { warehouseId: order.warehouseId, productId, quantity: { gte: value.quantity }, reserved: { gte: value.quantity } },
          data: { quantity: { decrement: value.quantity }, reserved: { decrement: value.quantity } },
        });
        if (changed.count !== 1) throw new BadRequestException(`Stok/reservasi ${value.productName} tidak lagi mencukupi.`);
        const inventory = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: order.warehouseId, productId } } });
        for (const allocation of allocations) await tx.inventoryMovement.create({ data: {
          warehouseId: order.warehouseId, productId, locationId: allocation.locationId, type: 'ONLINE_ORDER', quantity: -allocation.quantity,
          balanceAfter: inventory.quantity, referenceType: 'Order', referenceId: order.id,
        } });
      }
      for (const item of order.items) {
        if (item.product.trackBatch) await this.consumeBatches(tx, order.warehouseId, item.productId, item.quantity);
        if (item.product.trackSerial) {
          const serials = await tx.inventorySerial.findMany({ where: { warehouseId: order.warehouseId, productId: item.productId, status: 'RESERVED', referenceType: 'Shipment', referenceId: shipment.id }, take: item.quantity + 1 });
          if (serials.length !== item.quantity) throw new BadRequestException(`Serial ${item.product.name} harus discan tepat ${item.quantity} unit sebelum shipment.`);
          const serialUpdate = await tx.inventorySerial.updateMany({ where: { id: { in: serials.map((row) => row.id) }, status: 'RESERVED', referenceType: 'Shipment', referenceId: shipment.id }, data: { status: 'SOLD' } });
          if (serialUpdate.count !== serials.length) throw new BadRequestException('Status serial berubah saat fulfillment. Ulangi proses pengiriman.');
        }
        if (item.taxCodeId && new Prisma.Decimal(item.taxAmount).greaterThan(0)) {
          const group = taxGroups.get(item.taxCodeId) ?? { base: new Prisma.Decimal(0), tax: new Prisma.Decimal(0) };
          group.base = group.base.add(item.netSubtotal); group.tax = group.tax.add(item.taxAmount); taxGroups.set(item.taxCodeId, group);
        }
      }

      const taxLines: OperationalTaxLineInput[] = [...taxGroups.entries()].map(([taxCodeId, value]) => ({
        taxCodeId, direction: 'OUTPUT', taxableBase: value.base, taxAmount: value.tax,
        counterpartyType: 'CUSTOMER', documentNumber: order.number,
      }));
      const eventType = prepaid ? 'ONLINE_ORDER_PREPAID_FULFILLED' : 'ONLINE_ORDER_CREDIT_FULFILLED';
      const accountCodes: Record<string, string> = prepaid
        ? { customerAdvance: '2105', revenue: '4101', outputTax: '2201', cogs: '5101', inventory: '1301' }
        : { receivable: payment.method === 'COD' ? '1203' : '1201', revenue: '4101', outputTax: '2201', cogs: '5101', inventory: '1301' };
      const event = await this.accounting.postOperationalEvent(tx, {
        companyId: scope.companyId, branchId: scope.branchId, eventType, sourceType: 'Order', sourceId: order.id,
        idempotencyKey: `order-fulfilled:${order.id}`,
        amounts: { gross: order.total, customerAdvance: order.total, receivable: order.total, revenue: new Prisma.Decimal(order.subtotal).add(order.shippingCost), outputTax: order.tax, cogs: costTotal, inventory: costTotal },
        accountCodes,
        lines: order.items.map((item) => ({
          itemType: 'Product', itemId: item.productId, description: `${item.product.name} · ${item.unitCode ?? item.product.unit}`, quantity: item.unitQuantity ?? item.quantity, unitAmount: item.unitPrice,
          netAmount: item.netSubtotal, taxAmount: item.taxAmount, grossAmount: item.grossSubtotal, taxCodeId: item.taxCodeId ?? undefined,
        })),
        taxLines,
        context: { warehouseId: order.warehouseId, shipmentId: shipment.id, paymentId: payment.id, paymentMethod: payment.method },
      });

      let taxDocumentId: string | undefined;
      if (new Prisma.Decimal(order.tax).greaterThan(0)) {
        const existingTax = await tx.taxDocument.findFirst({ where: { companyId: scope.companyId, branchId: scope.branchId, sourceType: 'Order', sourceId: order.id } });
        const doc = existingTax ?? await tx.taxDocument.create({ data: {
          companyId: scope.companyId, branchId: scope.branchId,
          number: await nextDocumentNumber(tx, { companyId: scope.companyId, branchId: scope.branchId, documentType: 'TAX_ORDER', prefix: 'TAX-ORD' }),
          documentType: 'SALES_TAX_DOCUMENT', status: 'ISSUED', sourceType: 'Order', sourceId: order.id,
          counterpartyName: order.customerName, netAmount: new Prisma.Decimal(order.subtotal).add(order.shippingCost), taxAmount: order.tax, grossAmount: order.total,
          taxPeriod: new Date().toISOString().slice(0, 7),
        } });
        taxDocumentId = doc.id;
      }
      const now = new Date();
      await tx.shipment.update({ where: { id: shipment.id }, data: {
        status: isPickup ? 'PICKED_UP' : 'IN_TRANSIT', carrier: isPickup ? 'STORE_PICKUP' : (dto.carrier?.trim() || (dto.ownFleet ? 'OWN_FLEET' : shipment.carrier)), service: isPickup ? (order.shippingMethodCode ?? 'PICKUP') : (dto.service?.trim() || shipment.service),
        trackingNumber: isPickup ? `PICKUP-${order.number}` : dto.trackingNumber?.trim(), gatePassId: isPickup ? null : dto.gatePassId, pickedUpAt: now,
        metadata: { ...((shipment.metadata as Record<string, unknown> | null) ?? {}), fulfillmentType: order.fulfillmentType, ownFleet: isPickup ? false : (dto.ownFleet ?? false) },
      } });
      const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'SHIPPED', accountingEventId: event.id, taxDocumentId } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'SHIP_ORDER', entityType: 'Order', entityId: order.id, payload: { branchId: scope.branchId, shipmentId: shipment.id, eventId: event.id, fulfillmentType: order.fulfillmentType } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'commerce.order.shipped', aggregateType: 'Order', aggregateId: order.id, payload: { companyId: scope.companyId, branchId: scope.branchId, orderId: order.id, shipmentId: shipment.id, fulfillmentType: order.fulfillmentType, accountingEventId: event.id, taxDocumentId } } });
      return updated;
    });
  }

  async cancel(id: string, dto: CancelOrderDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } },
        include: { items: { include: { product: true } }, payments: true },
      });
      if (!order) throw new NotFoundException('Pesanan tidak ditemukan pada branch pengguna.');
      if (order.status === 'CANCELLED') return order;
      if (['SHIPPED','COMPLETED','REFUNDED'].includes(order.status)) {
        throw new BadRequestException(`Pesanan tidak dapat dibatalkan dari status ${order.status}; gunakan alur retur/refund yang sesuai.`);
      }
      if (order.payments.some((payment) => payment.status === 'PAID')) {
        throw new BadRequestException('Pesanan sudah menerima pembayaran. Refund harus diproses sebelum pembatalan agar uang muka pelanggan tetap terlacak.');
      }

      const claim = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: 'CANCELLED' },
      });
      if (claim.count !== 1) throw new BadRequestException('Status order berubah saat pembatalan. Muat ulang lalu coba lagi.');

      const releaseQuantities = new Map<string, { quantity: number; productName: string }>();
      for (const item of order.items) {
        const current = releaseQuantities.get(item.productId);
        releaseQuantities.set(item.productId, { quantity: (current?.quantity ?? 0) + item.quantity, productName: item.product.name });
      }
      for (const [productId, value] of releaseQuantities) {
        await releaseLocationReservations(tx, { sourceType: 'Order', sourceId: order.id, warehouseId: order.warehouseId, productId, quantity: value.quantity });
        const released = await tx.inventory.updateMany({
          where: { warehouseId: order.warehouseId, productId, reserved: { gte: value.quantity } },
          data: { reserved: { decrement: value.quantity }, available: { increment: value.quantity } },
        });
        if (released.count !== 1) throw new BadRequestException(`Reservasi stok ${value.productName} tidak konsisten; pembatalan dibatalkan untuk menjaga integritas stok.`);
      }

      const shipment = await tx.shipment.findFirst({ where: { orderId: order.id, warehouseId: order.warehouseId } });
      if (shipment) {
        await tx.inventorySerial.updateMany({
          where: { status: 'RESERVED', referenceType: 'Shipment', referenceId: shipment.id },
          data: { status: 'AVAILABLE', referenceType: null, referenceId: null },
        });
        await tx.shipment.update({ where: { id: shipment.id }, data: { status: 'CANCELLED', metadata: { ...((shipment.metadata as Record<string, unknown> | null) ?? {}), cancelReason: dto.reason.trim() } } });
        await tx.operationalInspection.updateMany({
          where: { companyId: scope.companyId, branchId: scope.branchId, sourceType: 'Shipment', sourceId: shipment.id, status: { in: ['DRAFT','IN_PROGRESS','PASSED','PARTIAL','FAILED','REVIEW_REQUIRED'] } },
          data: { status: 'CANCELLED' },
        });
        await tx.operationalConfirmation.updateMany({
          where: { companyId: scope.companyId, branchId: scope.branchId, sourceType: 'Shipment', sourceId: shipment.id, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
      }
      await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await tx.promoRedemption.deleteMany({ where: { referenceType: 'Order', referenceId: order.id, companyId: scope.companyId, branchId: scope.branchId } });
      await tx.auditLog.create({ data: {
        companyId: scope.companyId, userId: user.sub, action: 'CANCEL_ORDER', entityType: 'Order', entityId: order.id,
        payload: { branchId: scope.branchId, reason: dto.reason.trim(), releasedReservation: true, shipmentId: shipment?.id },
      } });
      await tx.eventOutbox.create({ data: {
        companyId: scope.companyId, eventType: 'commerce.order.cancelled', aggregateType: 'Order', aggregateId: order.id,
        payload: { companyId: scope.companyId, branchId: scope.branchId, orderId: order.id, reason: dto.reason.trim(), releasedReservation: true },
      } });
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { product: true } }, payments: true } });
    });
  }

  async deliver(id: string, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return serializableTx(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({ where: { id, branchId: scope.branchId, branch: { companyId: scope.companyId } } });
      if (!order) throw new NotFoundException('Pesanan tidak ditemukan pada branch pengguna.');
      if (order.status === 'COMPLETED') return order;
      if (order.status !== 'SHIPPED') throw new BadRequestException(`Pesanan tidak dapat diselesaikan dari status ${order.status}.`);
      const shipment = await tx.shipment.findFirst({ where: { orderId: order.id, warehouseId: order.warehouseId } });
      if (!shipment || !['IN_TRANSIT','PICKED_UP'].includes(shipment.status)) throw new BadRequestException('Shipment belum dalam perjalanan.');
      const now = new Date();
      await tx.shipment.update({ where: { id: shipment.id }, data: { status: 'DELIVERED', deliveredAt: now } });
      const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
      let loyaltyEarned = 0;
      let loyaltyTier: string | null = null;
      if (order.customerId) {
        const program = await tx.loyaltyProgram.findFirst({
          where: { companyId: scope.companyId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, earnRate: true, pointsExpireDays: true, tiers: true },
        });
        if (program) {
          const existingEarn = await tx.loyaltyTransaction.findFirst({ where: { type: 'EARN', referenceType: 'Order', referenceId: order.id }, select: { id: true, points: true } });
          if (!existingEarn) {
            loyaltyEarned = Math.max(0, Math.floor(Number(order.total) * Number(program.earnRate)));
            if (loyaltyEarned > 0) {
              const account = await tx.loyaltyAccount.upsert({
                where: { programId_customerId: { programId: program.id, customerId: order.customerId } },
                create: { programId: program.id, customerId: order.customerId },
                update: {},
                select: { id: true, points: true, lifetimePoints: true },
              });
              const nextPoints = account.points + loyaltyEarned;
              const nextLifetime = account.lifetimePoints + loyaltyEarned;
              loyaltyTier = resolveLoyaltyTier(program.tiers, nextLifetime).code;
              await tx.loyaltyAccount.update({ where: { id: account.id }, data: { points: nextPoints, lifetimePoints: nextLifetime, tier: loyaltyTier } });
              await tx.loyaltyTransaction.create({ data: {
                accountId: account.id, type: 'EARN', points: loyaltyEarned, balanceAfter: nextPoints,
                referenceType: 'Order', referenceId: order.id,
                expiresAt: program.pointsExpireDays ? new Date(now.getTime() + program.pointsExpireDays * 86_400_000) : null,
                notes: `Poin dari order storefront ${order.number}`,
              } });
            }
          } else {
            loyaltyEarned = existingEarn.points;
          }
        }
      }
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'DELIVER_ORDER', entityType: 'Order', entityId: order.id, payload: { branchId: scope.branchId, shipmentId: shipment.id, loyaltyEarned, loyaltyTier } } });
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'commerce.order.delivered', aggregateType: 'Order', aggregateId: order.id, payload: { companyId: scope.companyId, branchId: scope.branchId, orderId: order.id, shipmentId: shipment.id, loyaltyEarned, loyaltyTier } } });
      return { ...updated, loyaltyEarned, loyaltyTier };
    });
  }
}
