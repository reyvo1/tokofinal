import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { resolveLoyaltyTier } from '../common/loyalty-tier';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmCustomerVerificationDto, CreateCustomerAddressDto, CreateProductReviewDto, LoginStorefrontCustomerDto, RegisterStorefrontCustomerDto, RequestCustomerVerificationDto, UpdateCustomerAddressDto, UpdateStorefrontProfileDto } from './dto/storefront-customer.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
export type StorefrontCustomerIdentity = {
  companyId: string;
  branchId: string;
  customerId: string;
  customer: { id: string; name: string; email: string | null; phone: string | null; emailVerifiedAt: Date | null; phoneVerifiedAt: Date | null; address: string | null; points: number; customerType: string };
};

@Injectable()
export class StorefrontCustomerService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private normalizeBranchCode(value?: string) {
    const code = value?.trim().toUpperCase();
    if (!code) throw new NotFoundException('Storefront tidak ditemukan.');
    return code;
  }

  private normalizeEmail(value: string) { return value.trim().toLowerCase(); }
  private tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private sessionHours() {
    const configured = Number(this.config.get<string>('CUSTOMER_SESSION_TTL_HOURS') ?? 720);
    return Number.isFinite(configured) && configured >= 1 && configured <= 24 * 90 ? configured : 720;
  }

  private assertStrongPassword(password: string) {
    if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      throw new BadRequestException('Password pelanggan minimal 10 karakter dan harus memiliki huruf besar, huruf kecil, dan angka.');
    }
  }

  private async resolveBranch(client: DbClient, branchCode: string) {
    const branch = await client.branch.findUnique({ where: { code: this.normalizeBranchCode(branchCode) }, select: { id: true, companyId: true, isActive: true } });
    if (!branch?.isActive) throw new NotFoundException('Storefront tidak ditemukan.');
    return branch;
  }

  private safeCustomer(customer: { id: string; name: string; email: string | null; phone: string | null; emailVerifiedAt: Date | null; phoneVerifiedAt: Date | null; address: string | null; points: number; customerType: string }) {
    return { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, emailVerifiedAt: customer.emailVerifiedAt, phoneVerifiedAt: customer.phoneVerifiedAt, address: customer.address, points: customer.points, customerType: customer.customerType };
  }

  private contactTarget(type: 'EMAIL' | 'PHONE', customer: { email: string | null; phone: string | null }) {
    const target = type === 'EMAIL' ? customer.email?.trim().toLowerCase() : customer.phone?.trim();
    if (!target) throw new BadRequestException(type === 'EMAIL' ? 'Email pelanggan belum tersedia.' : 'Nomor telepon pelanggan belum tersedia.');
    return target;
  }

  private contactTargetHash(type: 'EMAIL' | 'PHONE', target: string) { return createHash('sha256').update(`${type}:${target}`).digest('hex'); }
  private maskedContact(type: 'EMAIL' | 'PHONE', value: string) {
    if (type === 'EMAIL') { const [name, domain = ''] = value.split('@'); return `${name.slice(0, 2)}***@${domain}`; }
    return value.length <= 4 ? '****' : `${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
  }
  private verificationDebugEnabled() { return this.config.get<string>('NODE_ENV') !== 'production' && this.config.get<string>('CUSTOMER_VERIFICATION_DEBUG_CODE') === 'true'; }
  private renderVerificationTemplate(text: string | null | undefined, values: Record<string, string>) {
    return text?.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => values[key] ?? '');
  }

  private async issueSession(tx: Prisma.TransactionClient, customerId: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionHours() * 60 * 60 * 1000);
    await tx.customerSession.create({ data: { customerId, tokenHash: this.tokenHash(token), expiresAt } });
    return { token, expiresAt };
  }

  async register(dto: RegisterStorefrontCustomerDto) {
    this.assertStrongPassword(dto.password);
    const email = this.normalizeEmail(dto.email);
    return this.prisma.$transaction(async (tx) => {
      const branch = await this.resolveBranch(tx, dto.branchCode);
      const existing = await tx.customer.findFirst({ where: { companyId: branch.companyId, email }, include: { account: true } });
      if (existing) {
        if (existing.account) throw new ConflictException('Akun pelanggan dengan email tersebut sudah terdaftar.');
        throw new ConflictException('Email sudah ada pada master pelanggan. Hubungi toko agar akun ditautkan secara terverifikasi.');
      }
      const customer = await tx.customer.create({ data: {
        companyId: branch.companyId,
        name: dto.name.trim(),
        email,
        phone: dto.phone?.trim() || null,
        address: dto.address?.trim() || null,
        customerType: 'RETAIL',
      } });
      await tx.customerAccount.create({ data: { customerId: customer.id, passwordHash: await hash(dto.password, 12) } });
      const session = await this.issueSession(tx, customer.id);
      await tx.auditLog.create({ data: {
        companyId: branch.companyId, action: 'CUSTOMER_ACCOUNT_REGISTERED', entityType: 'Customer', entityId: customer.id,
        payload: { branchId: branch.id, email },
      } });
      return { customer: this.safeCustomer(customer), sessionToken: session.token, expiresAt: session.expiresAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async login(dto: LoginStorefrontCustomerDto) {
    const branch = await this.resolveBranch(this.prisma, dto.branchCode);
    const email = this.normalizeEmail(dto.email);
    const customer = await this.prisma.customer.findFirst({ where: { companyId: branch.companyId, email }, include: { account: true } });
    const account = customer?.account;
    const genericError = new UnauthorizedException('Email atau password tidak valid.');
    if (!customer || !account || !account.isActive) throw genericError;
    if (account.lockedUntil && account.lockedUntil > new Date()) throw new UnauthorizedException('Akun pelanggan terkunci sementara karena terlalu banyak percobaan login.');
    const valid = await compare(dto.password, account.passwordHash);
    if (!valid) {
      const failedAttempts = account.failedAttempts + 1;
      await this.prisma.customerAccount.update({ where: { id: account.id }, data: {
        failedAttempts,
        ...(failedAttempts >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
      } });
      throw genericError;
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.customerAccount.update({ where: { id: account.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
      const session = await this.issueSession(tx, customer.id);
      await tx.auditLog.create({ data: {
        companyId: branch.companyId, action: 'CUSTOMER_ACCOUNT_LOGIN', entityType: 'Customer', entityId: customer.id,
        payload: { branchId: branch.id },
      } });
      return { customer: this.safeCustomer(customer), sessionToken: session.token, expiresAt: session.expiresAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async authenticate(branchCode?: string, token?: string): Promise<StorefrontCustomerIdentity> {
    const rawToken = token?.trim();
    if (!rawToken) throw new UnauthorizedException('Sesi pelanggan diperlukan.');
    const branch = await this.resolveBranch(this.prisma, branchCode ?? '');
    const session = await this.prisma.customerSession.findUnique({
      where: { tokenHash: this.tokenHash(rawToken) },
      include: { customer: { include: { account: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.customer.account?.isActive || session.customer.companyId !== branch.companyId) {
      throw new UnauthorizedException('Sesi pelanggan tidak valid atau sudah berakhir.');
    }
    if (Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
      await this.prisma.customerSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }
    return { companyId: branch.companyId, branchId: branch.id, customerId: session.customer.id, customer: this.safeCustomer(session.customer) };
  }

  async logout(branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const tokenHash = this.tokenHash(token!.trim());
    await this.prisma.customerSession.updateMany({ where: { tokenHash, customerId: identity.customerId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true };
  }

  async me(branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const program = await this.prisma.loyaltyProgram.findFirst({ where: { companyId: identity.companyId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, tiers: true } });
    if (!program) return { ...identity.customer, points: 0, lifetimePoints: 0, loyaltyTier: 'MEMBER' };
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { programId_customerId: { programId: program.id, customerId: identity.customerId } }, select: { points: true, lifetimePoints: true } });
    const lifetimePoints = account?.lifetimePoints ?? 0;
    return { ...identity.customer, points: account?.points ?? 0, lifetimePoints, loyaltyTier: resolveLoyaltyTier(program.tiers, lifetimePoints).code };
  }

  async updateProfile(dto: UpdateStorefrontProfileDto, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const data: Prisma.CustomerUpdateInput = {};
    if (dto.name !== undefined) { if (!dto.name.trim()) throw new BadRequestException('Nama pelanggan tidak boleh kosong.'); data.name = dto.name.trim(); }
    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      if (email !== identity.customer.email) { data.email = email; data.emailVerifiedAt = null; }
    }
    if (dto.phone !== undefined) {
      const phone = dto.phone.trim() || null;
      if (phone !== identity.customer.phone) { data.phone = phone; data.phoneVerifiedAt = null; }
    }
    if (dto.address !== undefined) data.address = dto.address.trim() || null;
    try {
      const customer = await this.prisma.customer.update({ where: { id: identity.customerId }, data });
      await this.prisma.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_PROFILE_UPDATED', entityType: 'Customer', entityId: customer.id, payload: { branchId: identity.branchId } } });
      return this.safeCustomer(customer);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Email sudah digunakan akun pelanggan lain pada perusahaan ini.');
      throw error;
    }
  }

  async requestVerification(dto: RequestCustomerVerificationDto, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const type = dto.type;
    const target = this.contactTarget(type, identity.customer);
    const targetHash = this.contactTargetHash(type, target);
    const alreadyVerified = type === 'EMAIL' ? identity.customer.emailVerifiedAt : identity.customer.phoneVerifiedAt;
    if (alreadyVerified) return { type, verified: true, recipient: this.maskedContact(type, target) };
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const codeHash = await hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const channel = type === 'EMAIL' ? 'EMAIL' : 'SMS';
    const templateCode = type === 'EMAIL' ? 'CUSTOMER_VERIFY_EMAIL' : 'CUSTOMER_VERIFY_PHONE';
    const template = await this.prisma.notificationTemplate.findFirst({ where: { companyId: identity.companyId, code: templateCode, channel, isActive: true } });
    const values = { code, 'customer.name': identity.customer.name, expiresMinutes: '10' };
    const body = this.renderVerificationTemplate(template?.body, values) ?? `Kode verifikasi Toko360 Anda: ${code}. Berlaku 10 menit.`;
    const subject = type === 'EMAIL' ? (this.renderVerificationTemplate(template?.subject, values) ?? 'Kode verifikasi akun Toko360') : null;
    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.customerVerificationToken.findFirst({ where: { customerId: identity.customerId, type }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (latest && Date.now() - latest.createdAt.getTime() < 60_000) throw new BadRequestException('Tunggu minimal 60 detik sebelum meminta kode verifikasi baru.');
      await tx.customerVerificationToken.updateMany({ where: { customerId: identity.customerId, type, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.customerVerificationToken.create({ data: { customerId: identity.customerId, type, targetHash, codeHash, expiresAt } });
      await tx.notification.create({ data: { companyId: identity.companyId, channel, recipient: target, templateCode: template?.code, subject, body, data: { branchId: identity.branchId, customerId: identity.customerId, verificationType: type }, scheduledAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_CONTACT_VERIFICATION_REQUESTED', entityType: 'Customer', entityId: identity.customerId, payload: { branchId: identity.branchId, type } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { type, verified: false, sent: true, recipient: this.maskedContact(type, target), expiresAt, ...(this.verificationDebugEnabled() ? { debugCode: code } : {}) };
  }

  async confirmVerification(dto: ConfirmCustomerVerificationDto, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const target = this.contactTarget(dto.type, identity.customer);
    const targetHash = this.contactTargetHash(dto.type, target);
    const row = await this.prisma.customerVerificationToken.findFirst({ where: { customerId: identity.customerId, type: dto.type, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!row || row.expiresAt <= new Date() || row.attempts >= 5) throw new BadRequestException('Kode verifikasi tidak tersedia atau sudah kedaluwarsa. Minta kode baru.');
    if (row.targetHash !== targetHash) {
      await this.prisma.customerVerificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      throw new BadRequestException('Kontak berubah setelah kode diterbitkan. Minta kode verifikasi baru.');
    }
    if (!(await compare(dto.code, row.codeHash))) {
      const attempts = row.attempts + 1;
      await this.prisma.customerVerificationToken.update({ where: { id: row.id }, data: { attempts, ...(attempts >= 5 ? { consumedAt: new Date() } : {}) } });
      throw new BadRequestException(attempts >= 5 ? 'Kode salah terlalu banyak. Minta kode baru.' : `Kode verifikasi salah. Sisa percobaan: ${5 - attempts}.`);
    }
    const verifiedAt = new Date();
    const customer = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.customerVerificationToken.updateMany({ where: { id: row.id, customerId: identity.customerId, type: dto.type, consumedAt: null }, data: { consumedAt: verifiedAt } });
      if (claimed.count !== 1) throw new BadRequestException('Kode verifikasi sudah digunakan. Minta kode baru bila kontak belum terverifikasi.');
      const updated = await tx.customer.update({ where: { id: identity.customerId }, data: dto.type === 'EMAIL' ? { emailVerifiedAt: verifiedAt } : { phoneVerifiedAt: verifiedAt } });
      await tx.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_CONTACT_VERIFIED', entityType: 'Customer', entityId: identity.customerId, payload: { branchId: identity.branchId, type: dto.type } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { customer: this.safeCustomer(customer), type: dto.type, verifiedAt };
  }


  private formattedAddress(row: { addressLine: string; district: string | null; city: string | null; province: string | null; postalCode: string | null }) {
    return [row.addressLine, row.district, row.city, row.province, row.postalCode].map((value) => value?.trim()).filter(Boolean).join(', ');
  }

  async fulfillmentOptions(branchCode?: string) {
    const branch = await this.resolveBranch(this.prisma, branchCode ?? '');
    const rows = await this.prisma.masterReference.findMany({
      where: { companyId: branch.companyId, type: 'COURIER', isActive: true, OR: [{ branchId: null }, { branchId: branch.id }] },
      orderBy: [{ code: 'asc' }],
    });
    return {
      branch: { id: branch.id, code: this.normalizeBranchCode(branchCode), pickupAddress: await this.prisma.branch.findUnique({ where: { id: branch.id }, select: { name: true, address: true } }) },
      methods: rows.map((row) => {
        const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
        const fulfillmentType = String(metadata.fulfillmentType ?? (row.code === 'PICKUP' ? 'PICKUP' : 'DELIVERY')).toUpperCase();
        const rawPrice = Number(metadata.price ?? 0);
        return { code: row.code, name: row.name, fulfillmentType: fulfillmentType === 'PICKUP' ? 'PICKUP' : 'DELIVERY', price: Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0, metadata };
      }),
    };
  }

  async addresses(branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    return this.prisma.customerAddress.findMany({ where: { customerId: identity.customerId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
  }

  async createAddress(dto: CreateCustomerAddressDto, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.customerAddress.count({ where: { customerId: identity.customerId, isActive: true } });
      const makeDefault = Boolean(dto.isDefault) || count === 0;
      if (makeDefault) await tx.customerAddress.updateMany({ where: { customerId: identity.customerId, isDefault: true }, data: { isDefault: false } });
      const row = await tx.customerAddress.create({ data: {
        customerId: identity.customerId, label: dto.label.trim(), recipientName: dto.recipientName.trim(), phone: dto.phone.trim(), addressLine: dto.addressLine.trim(),
        district: dto.district?.trim() || null, city: dto.city?.trim() || null, province: dto.province?.trim() || null, postalCode: dto.postalCode?.trim() || null, notes: dto.notes?.trim() || null,
        latitude: dto.latitude === undefined ? undefined : new Prisma.Decimal(dto.latitude), longitude: dto.longitude === undefined ? undefined : new Prisma.Decimal(dto.longitude), isDefault: makeDefault,
      } });
      if (makeDefault) await tx.customer.update({ where: { id: identity.customerId }, data: { address: this.formattedAddress(row) } });
      await tx.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_ADDRESS_CREATED', entityType: 'CustomerAddress', entityId: row.id, payload: { branchId: identity.branchId, customerId: identity.customerId, isDefault: makeDefault } } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateAddress(id: string, dto: UpdateCustomerAddressDto, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.customerAddress.findFirst({ where: { id, customerId: identity.customerId } });
      if (!current) throw new NotFoundException('Alamat pelanggan tidak ditemukan.');
      if (dto.isDefault === true) await tx.customerAddress.updateMany({ where: { customerId: identity.customerId, id: { not: id }, isDefault: true }, data: { isDefault: false } });
      const row = await tx.customerAddress.update({ where: { id }, data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}), ...(dto.recipientName !== undefined ? { recipientName: dto.recipientName.trim() } : {}), ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
        ...(dto.addressLine !== undefined ? { addressLine: dto.addressLine.trim() } : {}), ...(dto.district !== undefined ? { district: dto.district?.trim() || null } : {}), ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
        ...(dto.province !== undefined ? { province: dto.province?.trim() || null } : {}), ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode?.trim() || null } : {}), ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.latitude !== undefined ? { latitude: new Prisma.Decimal(dto.latitude) } : {}), ...(dto.longitude !== undefined ? { longitude: new Prisma.Decimal(dto.longitude) } : {}), ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      } });
      if (row.isDefault && row.isActive) await tx.customer.update({ where: { id: identity.customerId }, data: { address: this.formattedAddress(row) } });
      if ((!row.isActive || dto.isDefault === false) && current.isDefault) {
        const replacement = await tx.customerAddress.findFirst({ where: { customerId: identity.customerId, isActive: true, id: { not: id } }, orderBy: { updatedAt: 'desc' } });
        if (replacement) { await tx.customerAddress.update({ where: { id: replacement.id }, data: { isDefault: true } }); await tx.customer.update({ where: { id: identity.customerId }, data: { address: this.formattedAddress(replacement) } }); }
      }
      await tx.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_ADDRESS_UPDATED', entityType: 'CustomerAddress', entityId: id, payload: { branchId: identity.branchId, customerId: identity.customerId } } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async removeAddress(id: string, branchCode?: string, token?: string) {
    return this.updateAddress(id, { isActive: false } as UpdateCustomerAddressDto, branchCode, token);
  }


  async favorites(branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    return this.prisma.productFavorite.findMany({
      where: { customerId: identity.customerId, product: { companyId: identity.companyId, isActive: true } },
      include: { product: { include: { inventories: { where: { warehouse: { branchId: identity.branchId } }, include: { warehouse: true } }, barcodes: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addFavorite(productId: string, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const product = await this.prisma.product.findFirst({ where: { id: productId, companyId: identity.companyId, isActive: true }, select: { id: true } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan pada toko aktif.');
    const row = await this.prisma.productFavorite.upsert({
      where: { customerId_productId: { customerId: identity.customerId, productId } },
      create: { customerId: identity.customerId, productId }, update: {},
      include: { product: true },
    });
    await this.prisma.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_PRODUCT_FAVORITED', entityType: 'ProductFavorite', entityId: row.id, payload: { branchId: identity.branchId, customerId: identity.customerId, productId } } });
    return row;
  }

  async removeFavorite(productId: string, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    await this.prisma.productFavorite.deleteMany({ where: { customerId: identity.customerId, productId, product: { companyId: identity.companyId } } });
    await this.prisma.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_PRODUCT_UNFAVORITED', entityType: 'Product', entityId: productId, payload: { branchId: identity.branchId, customerId: identity.customerId } } });
    return { success: true };
  }

  async productReviews(productId: string, branchCode?: string) {
    const branch = await this.resolveBranch(this.prisma, branchCode ?? '');
    const product = await this.prisma.product.findFirst({ where: { id: productId, companyId: branch.companyId, isActive: true }, select: { id: true } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan pada toko aktif.');
    const rows = await this.prisma.productReview.findMany({
      where: { productId, status: 'PUBLISHED', product: { companyId: branch.companyId } },
      include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    const average = rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : 0;
    return { productId, averageRating: Number(average.toFixed(2)), count: rows.length, items: rows.map((row) => ({ id: row.id, rating: row.rating, title: row.title, body: row.body, createdAt: row.createdAt, customerName: row.customer.name })) };
  }

  async createReview(dto: CreateProductReviewDto, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, branchId: identity.branchId, customerId: identity.customerId, status: 'COMPLETED', items: { some: { productId: dto.productId, product: { companyId: identity.companyId } } } },
      select: { id: true },
    });
    if (!order) throw new BadRequestException('Review hanya dapat dibuat untuk produk dari pesanan akun yang sudah selesai.');
    const row = await this.prisma.productReview.upsert({
      where: { customerId_productId: { customerId: identity.customerId, productId: dto.productId } },
      create: { customerId: identity.customerId, productId: dto.productId, orderId: order.id, rating: dto.rating, title: dto.title?.trim() || null, body: dto.body?.trim() || null, status: 'PUBLISHED' },
      update: { orderId: order.id, rating: dto.rating, title: dto.title?.trim() || null, body: dto.body?.trim() || null, status: 'PUBLISHED' },
    });
    await this.prisma.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_PRODUCT_REVIEWED', entityType: 'ProductReview', entityId: row.id, payload: { branchId: identity.branchId, customerId: identity.customerId, productId: dto.productId, orderId: order.id, rating: dto.rating } } });
    return row;
  }

  async orders(branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const orders = await this.prisma.order.findMany({
      where: { branchId: identity.branchId, customerId: identity.customerId },
      include: { items: { include: { product: { select: { id: true, sku: true, name: true } } } }, payments: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    });
    const shipments = orders.length ? await this.prisma.shipment.findMany({ where: { orderId: { in: orders.map((order) => order.id) } }, orderBy: { createdAt: 'desc' } }) : [];
    return orders.map((order) => ({ ...order, shipments: shipments.filter((shipment) => shipment.orderId === order.id) }));
  }

  async order(number: string, branchCode?: string, token?: string) {
    const identity = await this.authenticate(branchCode, token);
    const order = await this.prisma.order.findFirst({
      where: { number, branchId: identity.branchId, customerId: identity.customerId },
      include: { items: { include: { product: { select: { id: true, sku: true, name: true } } } }, payments: true },
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan pada akun pelanggan.');
    const shipments = await this.prisma.shipment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
    return { ...order, shipments };
  }
}
