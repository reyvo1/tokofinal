import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AuthUser } from '../auth/auth.types';
import { OrdersService } from '../orders/orders.service';
import { SecretProtectorService } from '../platform/secret-protector.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderCallbackDto } from './dto/provider-callback.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretProtectorService,
    private readonly orders: OrdersService,
  ) {}

  private scope(user: AuthUser) {
    if (!user.companyId || !user.branchId) throw new ForbiddenException('Tenant scope tidak lengkap.');
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private amount(value: string) {
    try { return new Prisma.Decimal(value).toDecimalPlaces(2); }
    catch { throw new BadRequestException('Nominal callback tidak valid.'); }
  }

  private canonical(dto: PaymentProviderCallbackDto) {
    const amount = this.amount(dto.amount).toFixed(2);
    return [
      'toko360-payment-callback-v1',
      dto.eventId.trim(),
      dto.paymentNumber?.trim() ?? '',
      dto.orderNumber?.trim() ?? '',
      dto.externalRef.trim(),
      dto.status,
      amount,
      (dto.currency ?? 'IDR').trim().toUpperCase(),
      dto.eventType?.trim() ?? '',
    ].join('\n');
  }

  private verifySignature(secret: string, canonical: string, header?: string) {
    if (!header?.trim()) throw new ForbiddenException('Signature callback provider wajib diisi.');
    const raw = header.trim().replace(/^sha256=/i, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(raw)) throw new ForbiddenException('Format signature callback provider tidak valid.');
    const expected = createHmac('sha256', secret).update(canonical, 'utf8').digest();
    const received = Buffer.from(raw, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ForbiddenException('Signature callback provider tidak valid.');
    }
  }

  async providerCallback(integrationId: string, dto: PaymentProviderCallbackDto, signature?: string) {
    const integration = await this.prisma.integrationConnection.findFirst({
      where: { id: integrationId, type: 'PAYMENT' },
    });
    if (!integration) throw new NotFoundException('Integrasi payment provider tidak ditemukan.');
    if (integration.status !== 'CONNECTED') throw new ForbiddenException('Integrasi payment provider belum CONNECTED.');
    if (!integration.encryptedSecrets) throw new ForbiddenException('Webhook secret integrasi payment belum dikonfigurasi.');

    const secret = this.secrets.decryptText(integration.encryptedSecrets);
    if (secret.length < 24) throw new ForbiddenException('Webhook secret integrasi terlalu lemah.');
    const canonical = this.canonical(dto);
    this.verifySignature(secret, canonical, signature);
    const requestHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
    const amount = this.amount(dto.amount);
    const provider = integration.provider.trim().toLowerCase();

    const existing = await this.prisma.paymentProviderEvent.findUnique({
      where: { integrationId_eventId: { integrationId: integration.id, eventId: dto.eventId.trim() } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new BadRequestException('eventId callback sudah pernah dipakai dengan payload berbeda.');
      return { accepted: true, replay: true, eventId: existing.eventId, status: existing.status, paymentId: existing.paymentId, orderId: existing.orderId };
    }

    let event;
    try {
      event = await this.prisma.paymentProviderEvent.create({ data: {
        companyId: integration.companyId,
        branchId: integration.branchId,
        integrationId: integration.id,
        provider,
        eventId: dto.eventId.trim(),
        eventType: dto.eventType?.trim() || `PAYMENT_${dto.status}`,
        externalRef: dto.externalRef.trim(),
        amount,
        requestHash,
        payload: dto as unknown as Prisma.InputJsonValue,
        status: 'RECEIVED',
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.paymentProviderEvent.findUnique({
          where: { integrationId_eventId: { integrationId: integration.id, eventId: dto.eventId.trim() } },
        });
        if (!raced) throw error;
        if (raced.requestHash !== requestHash) throw new BadRequestException('eventId callback sudah pernah dipakai dengan payload berbeda.');
        return { accepted: true, replay: true, eventId: raced.eventId, status: raced.status, paymentId: raced.paymentId, orderId: raced.orderId };
      }
      throw error;
    }

    try {
      const result = await this.orders.confirmProviderPayment({
        companyId: integration.companyId,
        branchId: integration.branchId,
        provider,
        paymentNumber: dto.paymentNumber?.trim(),
        orderNumber: dto.orderNumber?.trim(),
        externalRef: dto.externalRef.trim(),
        amount,
        status: dto.status,
      });
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', paymentId: result.payment.id, orderId: result.order.id, processedAt: new Date(), error: null },
      });
      return { accepted: true, replay: false, eventId: event.eventId, paymentId: result.payment.id, orderId: result.order.id, paymentStatus: result.payment.status };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Payment callback processing failed';
      await this.prisma.paymentProviderEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: message, processedAt: new Date() } });
      throw error;
    }
  }

  async listProviderEvents(user: AuthUser, query: { status?: string; provider?: string; limit?: string }) {
    const scope = this.scope(user);
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? '100', 10) || 100, 1), 500);
    const status = query.status?.trim().toUpperCase();
    const provider = query.provider?.trim();
    return this.prisma.paymentProviderEvent.findMany({
      where: {
        companyId: scope.companyId,
        OR: [{ branchId: scope.branchId }, { branchId: null }],
        ...(status ? { status } : {}),
        ...(provider ? { provider } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      select: { id: true, integrationId: true, provider: true, eventId: true, eventType: true, externalRef: true, paymentId: true, orderId: true, amount: true, status: true, error: true, receivedAt: true, processedAt: true },
    });
  }
}
