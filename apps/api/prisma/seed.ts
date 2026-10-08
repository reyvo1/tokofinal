import { PrismaClient, AccountType, Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const environment = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
const protectedEnvironment = environment === 'production' || environment === 'staging';
const databaseProfile = (process.env.DATABASE_PROFILE ?? '').trim().toLowerCase();
const postgresProfile = databaseProfile === 'postgresql' || /^postgres(?:ql)?:/i.test(process.env.DATABASE_URL ?? '');
const seedMode = (process.env.SEED_MODE ?? ((protectedEnvironment || postgresProfile) ? 'bootstrap' : 'demo')).trim().toLowerCase();
const demoSeed = seedMode === 'demo';
// Mode `uat` = bootstrap yang diberi fixture transaksi.
//
// Alasan mode ini ada: gate browser UAT mewajibkan donut product-mix pada dashboard,
// padahal seed TIDAK PERNAH membuat Sale/SaleItem. Di runner CI (SEED_MODE=bootstrap)
// tidak ada satu pun penjualan, jadi donut mustahil muncul dan gate mustahil dipenuhi.
//
// Yang salah adalah memperbaiki GEJALANYA dengan melonggarkan gate menjadi "kalau donut
// tidak ada, cukup ada empty state" - itu membiarkan donut rusak lolos begitu ada data.
// Yang benar adalah membuat lingkungan memenuhi gate: seed harus punya penjualan.
//
// Produksi dan staging TIDAK boleh memakai mode ini - keduanya memakai `bootstrap`, dan
// `uat` tidak akan pernah menjadi default. Transaksi palsu tidak boleh masuk sistem nyata.
const uatSeed = seedMode === 'uat';
const fixtureSeed = demoSeed || uatSeed;

if (!['demo', 'bootstrap', 'uat'].includes(seedMode)) {
  throw new Error(`SEED_MODE tidak valid: ${seedMode}. Gunakan demo, bootstrap, atau uat.`);
}
// Pengaman: mode `uat` hanya untuk lingkungan uji. Produksi/staging memakai NODE_ENV
// production|staging, dan transaksi contoh tidak boleh masuk sistem nyata.
if (uatSeed && protectedEnvironment) {
  throw new Error(`SEED_MODE=uat tidak boleh dipakai pada NODE_ENV=${environment}.`);
}
if (protectedEnvironment && demoSeed) {
  throw new Error('SEED_MODE=demo ditolak pada staging/production. Gunakan SEED_MODE=bootstrap dengan konfigurasi eksplisit.');
}

function requiredSeedEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib diisi saat SEED_MODE=bootstrap.`);
  return value;
}

function bootstrapPassword(name: string) {
  const value = requiredSeedEnv(name);
  const weak = new Set(['Admin123!', 'Kasir123!', 'Employee123!', 'password', 'changeme']);
  if (value.length < 14 || weak.has(value)) {
    throw new Error(`${name} harus minimal 14 karakter dan tidak boleh memakai password demo/default.`);
  }
  return value;
}

const bootstrapConfig = demoSeed ? {
  companyId: '00000000-0000-4000-8000-000000000001',
  companyName: 'Toko360 Demo',
  companySlug: 'toko360-demo',
  branchCode: 'PUSAT',
  branchName: 'Cabang Pusat',
  branchAddress: 'Alamat toko Anda',
  warehouseCode: 'GDG-UTAMA',
  warehouseName: 'Gudang Utama',
  adminEmail: 'admin@toko360.local',
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!',
} : {
  companyId: requiredSeedEnv('SEED_COMPANY_ID'),
  companyName: requiredSeedEnv('SEED_COMPANY_NAME'),
  companySlug: requiredSeedEnv('SEED_COMPANY_SLUG'),
  branchCode: requiredSeedEnv('SEED_BRANCH_CODE'),
  branchName: requiredSeedEnv('SEED_BRANCH_NAME'),
  branchAddress: process.env.SEED_BRANCH_ADDRESS?.trim() || null,
  warehouseCode: requiredSeedEnv('SEED_WAREHOUSE_CODE'),
  warehouseName: requiredSeedEnv('SEED_WAREHOUSE_NAME'),
  adminEmail: requiredSeedEnv('SEED_ADMIN_EMAIL').toLowerCase(),
  adminPassword: bootstrapPassword('SEED_ADMIN_PASSWORD'),
};

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bootstrapConfig.companyId)) {
  throw new Error('SEED_COMPANY_ID harus UUID valid.');
}
if (!bootstrapConfig.adminEmail.includes('@') || (!demoSeed && bootstrapConfig.adminEmail.endsWith('@toko360.local'))) {
  throw new Error('SEED_ADMIN_EMAIL harus alamat email bootstrap yang valid dan bukan domain demo @toko360.local.');
}

async function main() {
  const company = await prisma.company.upsert({
    where: { id: bootstrapConfig.companyId },
    update: { name: bootstrapConfig.companyName, slug: bootstrapConfig.companySlug, timezone: 'Asia/Makassar', currency: 'IDR' },
    create: { id: bootstrapConfig.companyId, name: bootstrapConfig.companyName, slug: bootstrapConfig.companySlug, timezone: 'Asia/Makassar', currency: 'IDR' },
  });
  const branch = await prisma.branch.upsert({
    where: { code: bootstrapConfig.branchCode },
    update: { companyId: company.id, name: bootstrapConfig.branchName, address: bootstrapConfig.branchAddress },
    create: { companyId: company.id, code: bootstrapConfig.branchCode, name: bootstrapConfig.branchName, address: bootstrapConfig.branchAddress },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: bootstrapConfig.warehouseCode },
    update: { branchId: branch.id, name: bootstrapConfig.warehouseName, isDefault: true },
    create: { branchId: branch.id, code: bootstrapConfig.warehouseCode, name: bootstrapConfig.warehouseName, isDefault: true },
  });
  const defaultLocation = await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: warehouse.id, code: 'DEFAULT' } },
    update: { name: 'Lokasi Default', type: 'PICK_FACE', isDefault: true, isActive: true },
    create: { warehouseId: warehouse.id, code: 'DEFAULT', name: 'Lokasi Default', type: 'PICK_FACE', isDefault: true },
  });
  await prisma.warehouseLocation.updateMany({ where: { warehouseId: warehouse.id, id: { not: defaultLocation.id }, isDefault: true }, data: { isDefault: false } });

  const roleNames = ['SUPER_ADMIN','OWNER','ADMIN','CASHIER','WAREHOUSE','PURCHASING','FINANCE','AUDITOR','HR','PAYROLL','MANAGER','EMPLOYEE'];
  for (const name of roleNames) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name, description: `Role ${name}` } });
  }
  const permissionCodes = [
    'product.view','product.create','product.update','product.delete',
    'master_data.view','master_data.manage','customer.view','customer.manage',
    'supplier.view','supplier.create','supplier.update',
    'purchase.view','purchase.create','purchase.approve','purchase.receive','purchase.return',
    'inventory.view','inventory.adjust','inventory.transfer','inventory.opname','inventory.batch','inventory.serial',
    'sale.view','sale.create','sale.cancel','sale.return','sale.refund',
    'order.view','order.manage','order.cancel','shipment.manage',
    'payment.view','payment.manage','payment.refund','payment.reconcile',
    'finance.view','finance.create','finance.post','finance.journal','finance.expense','finance.approve','finance.close_period','finance.reconcile',
    'loyalty.view','loyalty.manage','promotion.view','promotion.manage','forecast.view','forecast.run','assistant.use','assistant.manage',
    'integration.view','integration.manage','webhook.manage','notification.manage','api_key.view','api_key.manage',
    'platform.configure','branch.switch','approval.manage','custom_field.manage','ui_schema.manage',
    'user.manage','role.manage','report.view','report.export','audit.view',
    'employee.view','employee.manage','employee.self',
    'attendance.view','attendance.manage','attendance.record','attendance.device_ingest','attendance.approve',
    'leave.view','leave.manage','leave.approve','overtime.view','overtime.manage','overtime.approve',
    'payroll.view','payroll.manage','payroll.calculate','payroll.approve','payroll.post','payroll.publish',
    'tax.view','tax.manage','tax.document.issue','accounting.event.view','accounting.rule.manage',
    'asset.view','asset.manage','asset.acquire','asset.assign','asset.maintenance','asset.depreciate',
    'fleet.view','fleet.manage','fleet.expense','delivery.trip.manage','delivery.loading.confirm','delivery.dispatch','delivery.proof',
    'inspection.view','inspection.record','inspection.manage','inspection.approve','gate_pass.manage','gate_pass.approve',
    'operations.policy.view','operations.policy.manage','operations.confirm','automation.manage',
    'goods_receipt.confirm','goods_receipt.reject',
    'manufacturing.view','manufacturing.manage','digital_service.view','digital_service.manage',
    // POST-1D. Deliberately read-only and deliberately narrow. A kiosk key carries this scope and
    // nothing else, so the device cannot reach a single Admin or POS mutation even if it is stolen
    // and the key is pasted into another client. It is granted to no role by default — an operator
    // attaches it to a device, not to a person.
    'kiosk.price.read',
  ];
  for (const code of permissionCodes) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: code } });
  }
  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
  const allPermissions = await prisma.permission.findMany();
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: permission.id } },
      update: {}, create: { roleId: superAdminRole.id, permissionId: permission.id },
    });
  }

  const admin = await prisma.user.upsert({
    where: { email: bootstrapConfig.adminEmail },
    update: { branchId: branch.id, isActive: true },
    create: {
      name: demoSeed ? 'Administrator Toko360' : 'Administrator Bootstrap', email: bootstrapConfig.adminEmail,
      passwordHash: await hash(bootstrapConfig.adminPassword, 12), branchId: branch.id,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdminRole.id } },
    update: {}, create: { userId: admin.id, roleId: superAdminRole.id },
  });

  // Akun kasir contoh hanya dibuat pada seed lokal/demo.
  const masterRefs = [
    ['UNIT','PCS','Pieces',null,null],
    ['PAYMENT_METHOD','CASH','Tunai',null,{ kind: 'CASH', settlementAccountCode: '1101', settlementBehavior: 'IMMEDIATE', requiresProvider: false, requiresReference: false, refundBehavior: 'CASH', refundAccountCode: '1101', allowOffline: true, allowCashChange: true, feeRatePercent: 0 }],
    ['PAYMENT_METHOD','QRIS','QRIS',null,{ kind: 'SETTLEMENT', settlementAccountCode: '1102', settlementBehavior: 'CLEARING', requiresProvider: false, requiresReference: false, refundBehavior: 'SETTLEMENT', allowOffline: false, allowCashChange: false, feeRatePercent: 0 }],
    ['PAYMENT_METHOD','TRANSFER','Transfer Bank',null,{ kind: 'SETTLEMENT', settlementAccountCode: '1102', settlementBehavior: 'IMMEDIATE', requiresProvider: false, requiresReference: false, refundBehavior: 'SETTLEMENT', allowOffline: false, allowCashChange: false, feeRatePercent: 0 }],
    ['PAYMENT_METHOD','CARD','Kartu',null,{ kind: 'SETTLEMENT', settlementAccountCode: '1102', settlementBehavior: 'CLEARING', requiresProvider: false, requiresReference: false, refundBehavior: 'SETTLEMENT', allowOffline: false, allowCashChange: false, feeRatePercent: 0 }],
    ['COURIER','PICKUP','Ambil di Toko',null,null],
  ] as const;
  for (const [type, code, name, refBranchId, metadata] of masterRefs) {
    await prisma.masterReference.upsert({
      where: { companyId_type_code: { companyId: company.id, type, code } },
      update: { name, metadata: metadata ?? undefined, isActive: true },
      create: { companyId: company.id, branchId: refBranchId, type, code, name, metadata: metadata ?? undefined },
    });
  }
  const starterUnitCode = masterRefs.find(([type]) => type === 'UNIT')?.[1];
  if (!starterUnitCode) throw new Error('Seed harus memiliki minimal satu starter UNIT.');
  await prisma.masterReference.update({
    where: { companyId_type_code: { companyId: company.id, type: 'COURIER', code: 'PICKUP' } },
    data: { branchId: branch.id, metadata: { fulfillmentType: 'PICKUP', price: 0, requiresAddress: false } },
  });
  await prisma.masterReference.upsert({
    where: { companyId_type_code: { companyId: company.id, type: 'COURIER', code: 'LOCAL_DELIVERY' } },
    update: { name: 'Kurir Lokal', branchId: branch.id, metadata: { fulfillmentType: 'DELIVERY', price: 15000, requiresAddress: true }, isActive: true },
    create: { companyId: company.id, branchId: branch.id, type: 'COURIER', code: 'LOCAL_DELIVERY', name: 'Kurir Lokal', metadata: { fulfillmentType: 'DELIVERY', price: 15000, requiresAddress: true } },
  });

  if (demoSeed) {
    const cashierRole = await prisma.role.findUniqueOrThrow({ where: { name: 'CASHIER' } });
    const cashier = await prisma.user.upsert({
      where: { email: 'kasir@toko360.local' },
      update: { branchId: branch.id, isActive: true },
      create: {
        name: 'Kasir Toko360', email: 'kasir@toko360.local',
        passwordHash: await hash(process.env.SEED_CASHIER_PASSWORD ?? 'Kasir123!', 12), branchId: branch.id,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: cashier.id, roleId: cashierRole.id } },
      update: {}, create: { userId: cashier.id, roleId: cashierRole.id },
    });
  }

  const accounts: Array<[string,string,AccountType]> = [
    ['1101','Kas',AccountType.ASSET], ['1102','Bank',AccountType.ASSET],
    ['1201','Piutang Usaha',AccountType.ASSET], ['1202','Piutang Refund Supplier',AccountType.ASSET], ['1204','Piutang Karyawan / Payroll Recovery',AccountType.ASSET], ['1301','Persediaan Barang',AccountType.ASSET],
    ['2101','Utang Usaha',AccountType.LIABILITY], ['2105','Uang Muka Pelanggan',AccountType.LIABILITY], ['3101','Modal Pemilik',AccountType.EQUITY],
    ['4101','Penjualan',AccountType.REVENUE], ['4103','Pendapatan Lain-lain',AccountType.REVENUE], ['4104','Pendapatan Jasa',AccountType.REVENUE], ['5101','Harga Pokok Penjualan',AccountType.EXPENSE],
    ['6101','Beban Operasional',AccountType.EXPENSE],
    ['6102','Beban Gaji dan Tunjangan',AccountType.EXPENSE],
    ['2102','Utang Gaji',AccountType.LIABILITY],
    ['2103','Utang Pajak Penghasilan Karyawan',AccountType.LIABILITY],
    ['2104','Utang Jaminan Sosial dan Potongan Payroll',AccountType.LIABILITY],
    ['1103','Kas Kurir / COD',AccountType.ASSET], ['1203','Piutang COD',AccountType.ASSET],
    ['1205','Pajak Masukan / Pajak Dibayar Dimuka',AccountType.ASSET], ['1302','Persediaan Dalam Perjalanan',AccountType.ASSET], ['1303','Barang Dalam Proses (WIP)',AccountType.ASSET],
    ['1401','Aset Tetap Umum',AccountType.ASSET], ['1402','Kendaraan',AccountType.ASSET],
    ['1403','Bangunan',AccountType.ASSET], ['1404','Tanah',AccountType.ASSET],
    ['1491','Akumulasi Penyusutan Aset',AccountType.ASSET], ['1492','Akumulasi Penyusutan Kendaraan',AccountType.ASSET],
    ['1493','Akumulasi Penyusutan Bangunan',AccountType.ASSET],
    ['2201','Pajak Keluaran',AccountType.LIABILITY], ['2202','Utang Pajak Lainnya',AccountType.LIABILITY],
    ['4102','Retur dan Potongan Penjualan',AccountType.REVENUE], ['4201','Keuntungan Penyesuaian Persediaan',AccountType.REVENUE], ['4202','Keuntungan Pelepasan Aset',AccountType.REVENUE],
    ['5102','Kerugian Penyesuaian Persediaan',AccountType.EXPENSE],
    ['5201','Beban Pengiriman',AccountType.EXPENSE], ['5202','Beban Bahan Bakar Kendaraan',AccountType.EXPENSE],
    ['5203','Beban Perawatan Kendaraan dan Aset',AccountType.EXPENSE], ['6201','Beban Penyusutan',AccountType.EXPENSE], ['6202','Kerugian Pelepasan Aset',AccountType.EXPENSE],
  ];
  for (const [code,name,type] of accounts) {
    await prisma.account.upsert({
      where: { branchId_code: { branchId: branch.id, code } },
      update: { name, type }, create: { branchId: branch.id, code, name, type },
    });
  }

  // Payroll accounting mappings are branch-specific and canonical; posting resolves accounts through these mappings.
  const payrollMappingSpecs: Array<{ componentCode: string; debitCode?: string; creditCode?: string }> = [
    { componentCode: '__PAYROLL_EXPENSE__', debitCode: '6102' },
    { componentCode: '__SALARY_PAYABLE__', creditCode: '2102' },
    { componentCode: '__PAYROLL_TAX_PAYABLE__', creditCode: '2103' },
    { componentCode: '__PAYROLL_OTHER_PAYABLE__', creditCode: '2104' },
    { componentCode: '__PAYROLL_RECEIVABLE__', debitCode: '1204' },
  ];
  for (const spec of payrollMappingSpecs) {
    const debitAccount = spec.debitCode ? await prisma.account.findUniqueOrThrow({ where: { branchId_code: { branchId: branch.id, code: spec.debitCode } } }) : null;
    const creditAccount = spec.creditCode ? await prisma.account.findUniqueOrThrow({ where: { branchId_code: { branchId: branch.id, code: spec.creditCode } } }) : null;
    const existing = await prisma.payrollAccountingMapping.findFirst({ where: { companyId: company.id, branchId: branch.id, componentCode: spec.componentCode } });
    const data = { companyId: company.id, branchId: branch.id, componentCode: spec.componentCode, debitAccountId: debitAccount?.id, creditAccountId: creditAccount?.id, isActive: true };
    if (existing) await prisma.payrollAccountingMapping.update({ where: { id: existing.id }, data });
    else await prisma.payrollAccountingMapping.create({ data });
  }

  if (fixtureSeed) {
    const category = await prisma.category.upsert({
      where: { companyId_slug: { companyId: company.id, slug: 'produk-umum' } }, update: { name: 'Produk Umum' }, create: { companyId: company.id, name: 'Produk Umum', slug: 'produk-umum' },
    });
    const supplier = await prisma.supplier.upsert({
      where: { code: 'SUP-001' }, update: { companyId: company.id },
      create: { companyId: company.id, code: 'SUP-001', name: 'PT Sumber Makmur', phone: '081234567890', paymentTermDays: 30 },
    });
    const products = [
      { sku: 'SKU-001', barcode: '899000000001', name: 'Kopi Premium 250g', cost: 35000, sale: 50000, stock: 30 },
      { sku: 'SKU-002', barcode: '899000000002', name: 'Teh Melati 100g', cost: 18000, sale: 28000, stock: 40 },
      { sku: 'SKU-003', barcode: '899000000003', name: 'Gula Aren 500g', cost: 22000, sale: 32000, stock: 25 },
    ];
    const seededProducts: Array<{ id: string; sku: string; sale: number; cost: number }> = [];
    for (const item of products) {
      const product = await prisma.product.upsert({
        where: { sku: item.sku },
        update: { companyId: company.id, name: item.name, unit: starterUnitCode, costPrice: new Prisma.Decimal(item.cost), salePrice: new Prisma.Decimal(item.sale) },
        create: {
          companyId: company.id, categoryId: category.id, sku: item.sku, barcode: item.barcode, name: item.name,
          unit: starterUnitCode, costPrice: new Prisma.Decimal(item.cost), salePrice: new Prisma.Decimal(item.sale), minStock: 5,
        },
      });
      if (item.barcode) {
        await prisma.productBarcode.upsert({
          where: { code: item.barcode },
          update: { productId: product.id, unitCode: product.unit, quantityFactor: new Prisma.Decimal(1), isPrimary: true },
          create: { productId: product.id, code: item.barcode, unitCode: product.unit, quantityFactor: new Prisma.Decimal(1), isPrimary: true },
        });
      }
      const retailPrice = await prisma.productPrice.findFirst({ where: { productId: product.id, branchId: branch.id, segmentCode: 'RETAIL', minQty: new Prisma.Decimal(1) } });
      if (retailPrice) await prisma.productPrice.update({ where: { id: retailPrice.id }, data: { price: new Prisma.Decimal(item.sale), isActive: true } });
      else await prisma.productPrice.create({ data: { productId: product.id, branchId: branch.id, segmentCode: 'RETAIL', minQty: new Prisma.Decimal(1), price: new Prisma.Decimal(item.sale) } });
      const inventory = await prisma.inventory.upsert({
        where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } },
        update: {}, create: { warehouseId: warehouse.id, productId: product.id, quantity: item.stock, available: item.stock },
      });
      const existingMovement = await prisma.inventoryMovement.findFirst({
        where: { warehouseId: warehouse.id, productId: product.id, type: 'OPENING_STOCK' },
      });
      if (!existingMovement) {
        await prisma.inventoryMovement.create({
          data: { warehouseId: warehouse.id, productId: product.id, type: 'OPENING_STOCK', quantity: item.stock, balanceAfter: inventory.quantity, referenceType: 'Seed', referenceId: product.id },
        });
      }
      seededProducts.push({ id: product.id, sku: item.sku, sale: item.sale, cost: item.cost });
    }
  }

  // Platform dinamis: modul, feature flags, settings, UI schema, approval, dan business rules.
  const modules = [
    ['catalog','Katalog Produk','CORE',true,null],
    ['storefront','Website Pelanggan','CHANNEL',true,null],
    ['pos','Kasir / POS','CHANNEL',true,null],
    ['orders','Pesanan Omnichannel','COMMERCE',true,null],
    ['suppliers','Supplier dan Pembelian','PROCUREMENT',true,null],
    ['goods-receipts','Penerimaan Barang','PROCUREMENT',true,null],
    ['inventory','Stok dan Kartu Stok','INVENTORY',true,null],
    ['stock-transfer','Transfer Antar Gudang','INVENTORY',false,'stock_transfer'],
    ['stock-opname','Stock Opname','INVENTORY',false,'stock_opname'],
    ['batch-expiry','Batch dan Kedaluwarsa','INVENTORY',false,'batch_expiry'],
    ['serial-number','Serial Number','INVENTORY',false,'serial_number'],
    ['sales-return','Retur Penjualan','COMMERCE',false,'sales_return'],
    ['purchase-return','Retur Pembelian','PROCUREMENT',false,'purchase_return'],
    ['loyalty','Loyalitas dan Membership','CRM',false,'loyalty'],
    ['accounting','Akuntansi','FINANCE',true,null],
    ['bank-reconciliation','Rekonsiliasi Bank','FINANCE',false,'bank_reconciliation'],
    ['approval','Approval Bertingkat','PLATFORM',false,'approval_workflow'],
    ['integrations','Integration Hub','PLATFORM',false,'third_party_api'],
    ['marketplace','Marketplace Hub','CHANNEL',false,'marketplace'],
    ['shipping','Pengiriman dan Tracking','FULFILLMENT',false,'shipping'],
    ['notifications','Notification Hub','PLATFORM',false,'whatsapp'],
    ['offline-pos','POS Offline Sync','CHANNEL',false,'pos_offline'],
    ['forecasting','Forecasting Stok','ANALYTICS',false,'forecasting'],
    ['reorder','Rekomendasi Pembelian','ANALYTICS',false,'reorder_suggestions'],
    ['bi','Business Intelligence','ANALYTICS',false,'business_intelligence'],
    ['hris','Data Karyawan dan Organisasi','HR',false,'hris'],
    ['attendance','Absensi, Shift dan Geofence','HR',false,'attendance'],
    ['payroll','Penggajian dan Slip Gaji','HR',false,'payroll'],
    ['employee-portal','Portal Mandiri Karyawan','CHANNEL',false,'employee_portal'],
    ['tax-payroll','Perpajakan Penggajian','FINANCE',false,'payroll_tax'],
    ['biometric-attendance','Fingerprint dan Face Device','INTEGRATION',false,'biometric_attendance'],
    ['accounting-core','Accounting Event dan Posting Rules','FINANCE',true,'accounting_full'],
    ['system-tax','Perpajakan Seluruh Transaksi','FINANCE',false,'system_tax'],
    ['fixed-assets','Aset Bergerak dan Tidak Bergerak','ASSET',false,'fixed_assets'],
    ['fleet','Armada dan Kendaraan Pengiriman','FULFILLMENT',false,'fleet_delivery'],
    ['quality-inspection','Pemeriksaan Barang Masuk/Keluar','OPERATIONS',false,'quality_inspection'],
    ['gate-pass','Kontrol Kendaraan dan Barang di Gerbang','OPERATIONS',false,'gate_pass'],
    ['operations-automation','Otomatisasi Operasional','PLATFORM',false,'operations_automation'],
    ['finance-operations','Transaksi Keuangan Lintas Modul','FINANCE',true,'accounting_full'],
    ['manufacturing','Resep, BOM dan Produksi','OPERATIONS',false,'manufacturing'],
    ['digital-services','PPOB dan Produk Digital','INTEGRATION',false,'ppob'],
  ] as const;
  for (const [code, name, category, isCore, featureKey] of modules) {
    await prisma.moduleDefinition.upsert({
      where: { code },
      update: { name, category, isCore, featureKey, isActive: true },
      create: {
        code, name, category, isCore, featureKey, isActive: true,
        description: `Modul ${name}`,
        capabilities: { extensible: true, apiVersion: 'v1' },
        navigation: [{ label: name, href: `/modules/${code}`, featureKey }],
      },
    });
  }

  const featureDefaults: Array<[string, boolean, string]> = [
    ['multi_branch', true, 'implemented'], ['multi_warehouse', true, 'implemented'],
    ['payment_gateway', false, 'adapter-ready'], ['marketplace', false, 'adapter-ready'],
    ['shipping', false, 'adapter-ready'], ['whatsapp', false, 'adapter-ready'],
    ['customer_app', false, 'api-ready'], ['pos_offline', true, 'implemented-safe-replay'],
    ['batch_expiry', true, 'foundation'], ['serial_number', true, 'foundation'],
    ['loyalty', true, 'foundation'], ['accounting_full', false, 'foundation'],
    ['bank_reconciliation', true, 'foundation'], ['approval_workflow', true, 'foundation'],
    ['forecasting', true, 'moving-average'], ['reorder_suggestions', true, 'moving-average'],
    ['business_intelligence', false, 'data-model-ready'], ['scale_integration', false, 'adapter-ready'],
    ['third_party_api', true, 'plugin-sdk'], ['stock_transfer', true, 'implemented'],
    ['stock_opname', true, 'implemented'], ['sales_return', true, 'implemented-core-workflow'],
    ['purchase_return', true, 'foundation'],
    ['hris', true, 'foundation'], ['attendance', true, 'implemented-foundation'],
    ['payroll', true, 'implemented-foundation'], ['employee_portal', true, 'implemented-foundation'],
    ['payroll_tax', true, 'versioned-rule-engine'], ['biometric_attendance', false, 'adapter-ready'],
    ['attendance_photo', false, 'object-storage-required'], ['attendance_geofence', true, 'implemented-foundation'],
    ['telegram_payslip', false, 'adapter-ready'], ['whatsapp_payslip', false, 'adapter-ready'],
    ['system_tax', true, 'versioned-configurable-engine'], ['fixed_assets', true, 'implemented-foundation'],
    ['fleet_delivery', true, 'implemented-foundation'], ['quality_inspection', true, 'implemented-foundation'],
    ['gate_pass', true, 'implemented-foundation'], ['operations_automation', true, 'worker-ready'],
    ['fleet_gps', false, 'adapter-ready'], ['manufacturing', true, 'implemented-production-ledger'], ['ppob', true, 'adapter-ready-digiflazz'],
  ];
  const maturityTruth = (maturity: string) => {
    const normalized = maturity.toLowerCase();
    if (normalized.includes('adapter-ready') || normalized.includes('object-storage-required')) return {
      maturityClass: 'ADAPTER_REQUIRED',
      operatorVisibility: 'CONFIGURATION_ONLY',
      ownership: 'EXTERNAL_ADAPTER',
      helpText: 'Fondasi/adapter tersedia, tetapi capability memerlukan provider atau storage eksternal sebelum dapat dianggap operasional.',
    };
    if (normalized.includes('foundation') || normalized.includes('api-ready') || normalized.includes('data-model-ready') || normalized.includes('data-ready') || normalized.includes('plugin-sdk') || normalized.includes('worker-ready')) return {
      maturityClass: 'FOUNDATION',
      operatorVisibility: 'FOUNDATION_ONLY',
      ownership: 'PLATFORM_FOUNDATION',
      helpText: 'Fondasi source tersedia. Status ini tidak berarti workflow operator dan runtime acceptance sudah lengkap.',
    };
    if (normalized.includes('moving-average') || normalized.includes('baseline')) return {
      maturityClass: 'LIMITED',
      operatorVisibility: 'OPERATOR_VISIBLE_LIMITED',
      ownership: 'TOKO360_RUNTIME',
      helpText: 'Capability operasional dengan metode terbatas yang dijelaskan eksplisit; bukan klaim AI/advanced analytics penuh.',
    };
    return {
      maturityClass: 'OPERATIONAL',
      operatorVisibility: 'OPERATOR_VISIBLE',
      ownership: 'TOKO360_RUNTIME',
      helpText: 'Capability memiliki implementasi runtime; product-completeness tetap mengikuti matrix canonical dan evidence phase.',
    };
  };
  for (const [key, enabled, maturity] of featureDefaults) {
    const existing = await prisma.featureFlag.findFirst({ where: { companyId: company.id, branchId: null, userId: null, key } });
    const data = { companyId: company.id, key, enabled, config: { maturity, configurable: true, ...maturityTruth(maturity) } };
    if (existing) await prisma.featureFlag.update({ where: { id: existing.id }, data });
    else await prisma.featureFlag.create({ data });
  }

  const settings = [
    ['general','timezone','Asia/Makassar'], ['general','currency','IDR'], ['general','locale','id-ID'],
    ['inventory','costing_method','MOVING_AVERAGE'], ['inventory','negative_stock',false],
    ['orders','reservation_minutes',30], ['pos','receipt_footer','Terima kasih telah berbelanja.'],
    ['finance','auto_journal',true], ['finance','approval_threshold',1000000],
    ['attendance','default_method','SELFIE_GPS'], ['attendance','photo_retention_days',180],
    ['attendance','max_location_accuracy_meters',100], ['attendance','raw_biometric_storage',false],
    ['payroll','payslip_delivery_mode','SECURE_LINK'], ['payroll','require_approval_before_publish',true],
    ['payroll','tax_rule_requires_approval',true], ['payroll','accounting_auto_post',false],
    ['accounting','event_driven_posting',true], ['accounting','require_balanced_journal',true],
    ['tax','require_active_code',true], ['tax','document_delivery_mode','SECURE_LINK'],
    ['assets','depreciation_method','STRAIGHT_LINE'], ['assets','maintenance_auto_work_order',true],
    ['fleet','require_pretrip_inspection',true], ['fleet','require_gate_pass',true],
    ['operations','block_on_quantity_mismatch',true], ['operations','require_receiving_confirmation',true],
  ] as const;
  for (const [namespace, key, value] of settings) {
    const existing = await prisma.systemSetting.findFirst({ where: { companyId: company.id, branchId: null, userId: null, namespace, key } });
    const data = { companyId: company.id, namespace, key, value };
    if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data });
    else await prisma.systemSetting.create({ data });
  }

  await prisma.uiSchemaDefinition.upsert({
    where: { companyId_branchId_code_version: { companyId: company.id, branchId: branch.id, code: 'pos.main', version: 1 } },
    update: {},
    create: {
      companyId: company.id, branchId: branch.id, code: 'pos.main', surface: 'POS', version: 1,
      schema: { layout: 'two-column', quickCategories: true, customerPanel: true, paymentButtons: ['CASH','QRIS','TRANSFER','CARD'], widgets: ['cart','totals','held-sales'] },
    },
  });

  await prisma.leaveType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ANNUAL' } },
    update: {},
    create: { companyId: company.id, code: 'ANNUAL', name: 'Cuti Tahunan', paid: true, annualQuota: new Prisma.Decimal(12), requiresDocument: false },
  });
  await prisma.leaveType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SICK' } },
    update: {},
    create: { companyId: company.id, code: 'SICK', name: 'Sakit', paid: true, requiresDocument: true },
  });
  await prisma.approvalPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'LEAVE_REQUEST' } },
    update: {},
    create: { companyId: company.id, code: 'LEAVE_REQUEST', name: 'Persetujuan Cuti', entityType: 'LeaveRequest', steps: [{ step: 1, roles: ['HR','MANAGER'], minApprovals: 1 }] },
  });
  await prisma.approvalPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'OVERTIME_REQUEST' } },
    update: {},
    create: { companyId: company.id, code: 'OVERTIME_REQUEST', name: 'Persetujuan Lembur', entityType: 'OvertimeRequest', steps: [{ step: 1, roles: ['HR','MANAGER'], minApprovals: 1 }] },
  });

  await prisma.approvalPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'EXPENSE_HIGH_VALUE' } },
    update: {},
    create: { companyId: company.id, code: 'EXPENSE_HIGH_VALUE', name: 'Persetujuan pengeluaran besar', entityType: 'Expense', conditions: { amount: { gteSetting: 'finance.approval_threshold' } }, steps: [{ step: 1, roles: ['OWNER','FINANCE'], minApprovals: 1 }] },
  });
  await prisma.businessRule.upsert({
    where: { companyId_code: { companyId: company.id, code: 'LOW_STOCK_ALERT' } },
    update: {},
    create: { companyId: company.id, code: 'LOW_STOCK_ALERT', name: 'Peringatan stok minimum', trigger: 'inventory.balance.changed', conditions: { available: { lteField: 'product.minStock' } }, actions: [{ type: 'notification.enqueue', template: 'LOW_STOCK' }, { type: 'reorder_suggestion.create', targetMultiplier: 2 }] },
  });

  const loyalty = await prisma.loyaltyProgram.findFirst({ where: { companyId: company.id, name: 'Toko360 Rewards' } });
  if (!loyalty) await prisma.loyaltyProgram.create({ data: { companyId: company.id, name: 'Toko360 Rewards', earnRate: new Prisma.Decimal(1), redemptionRate: new Prisma.Decimal(100), minimumRedeem: 100, tiers: [{ code: 'MEMBER', minPoints: 0 }, { code: 'GOLD', minPoints: 5000 }] } });




  // Enterprise accounting and tax configuration. Rates are data, never hard-coded in services.
  const taxCodes = [
    { code: 'NO_TAX', name: 'Tidak Dipungut Pajak', scope: 'OTHER', rate: 0, inclusive: false, recoverable: false, status: 'ACTIVE' },
    { code: 'SALES_TAX_CONFIG', name: 'Pajak Penjualan Konfigurabel', scope: 'SALE', rate: 0, inclusive: false, recoverable: false, status: 'DRAFT', payableAccountCode: '2201' },
    { code: 'PURCHASE_TAX_CONFIG', name: 'Pajak Pembelian Konfigurabel', scope: 'PURCHASE', rate: 0, inclusive: false, recoverable: true, status: 'DRAFT', receivableAccountCode: '1205' },
    { code: 'PAYROLL_WITHHOLDING', name: 'Pemotongan Pajak Payroll', scope: 'WITHHOLDING', rate: 0, inclusive: false, recoverable: false, status: 'ACTIVE', payableAccountCode: '2103' },
  ] as const;
  for (const item of taxCodes) await prisma.taxCode.upsert({
    where: { companyId_code_version: { companyId: company.id, code: item.code, version: 1 } },
    update: { ...item, scope: item.scope as never, rate: new Prisma.Decimal(item.rate) },
    create: { companyId: company.id, version: 1, ...item, scope: item.scope as never, rate: new Prisma.Decimal(item.rate), legalReference: 'Isi dan verifikasi sesuai aturan perpajakan yang berlaku sebelum aktivasi.' },
  });

  const postingRules: Array<{ code: string; eventType: string; lines: Array<Record<string, unknown>> }> = [
    { code: 'SALE-CASH', eventType: 'SALE_CASH', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'settlement' },
      { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
      { accountCodeKey: 'serviceRevenue', side: 'CREDIT', amountKey: 'serviceRevenue', skipIfZero: true },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'SALE-BANK', eventType: 'SALE_BANK', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'settlement' },
      { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
      { accountCodeKey: 'serviceRevenue', side: 'CREDIT', amountKey: 'serviceRevenue', skipIfZero: true },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'SALE-SPLIT', eventType: 'SALE_SPLIT', lines: [
      { accountCodeKey: 'cashSettlement', side: 'DEBIT', amountKey: 'cashSettlement', skipIfZero: true },
      { accountCodeKey: 'bankSettlement', side: 'DEBIT', amountKey: 'bankSettlement', skipIfZero: true },
      { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
      { accountCodeKey: 'serviceRevenue', side: 'CREDIT', amountKey: 'serviceRevenue', skipIfZero: true },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'ONLINE-ORDER-PREPAYMENT', eventType: 'ONLINE_ORDER_PREPAYMENT', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'customerAdvance', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'ONLINE-ORDER-PREPAID-FULFILLED', eventType: 'ONLINE_ORDER_PREPAID_FULFILLED', lines: [
      { accountCodeKey: 'customerAdvance', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'ONLINE-ORDER-CREDIT-FULFILLED', eventType: 'ONLINE_ORDER_CREDIT_FULFILLED', lines: [
      { accountCodeKey: 'receivable', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'CUSTOMER-RECEIPT', eventType: 'CUSTOMER_RECEIPT', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'receivable', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'ONLINE-ORDER-PAID', eventType: 'ONLINE_ORDER_PAID', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'settlement' },
      { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'revenue' },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'DEBIT', amountKey: 'cogs' },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'PRODUCTION-CONSUME', eventType: 'PRODUCTION_CONSUME', lines: [
      { accountCodeKey: 'wip', side: 'DEBIT', amountKey: 'inventory' },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'PRODUCTION-COMPLETE', eventType: 'PRODUCTION_COMPLETE', lines: [
      { accountCodeKey: 'inventory', side: 'DEBIT', amountKey: 'inventory' },
      { accountCodeKey: 'wip', side: 'CREDIT', amountKey: 'inventory' },
    ] },
    { code: 'PURCHASE-RECEIPT-CREDIT', eventType: 'PURCHASE_RECEIPT_CREDIT', lines: [
      { accountCodeKey: 'inventory', side: 'DEBIT', amountKey: 'inventory' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'payable', side: 'CREDIT', amountKey: 'payable' },
    ] },
    { code: 'ASSET-ACQUISITION-CREDIT', eventType: 'ASSET_ACQUISITION_CREDIT', lines: [
      { accountCodeKey: 'asset', side: 'DEBIT', amountKey: 'asset' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'settlement' },
    ] },
    { code: 'ASSET-ACQUISITION-CASH', eventType: 'ASSET_ACQUISITION_CASH', lines: [
      { accountCodeKey: 'asset', side: 'DEBIT', amountKey: 'asset' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'settlement' },
    ] },
    { code: 'ASSET-MAINTENANCE-CASH', eventType: 'ASSET_MAINTENANCE_CASH', lines: [
      { accountCodeKey: 'expense', side: 'DEBIT', amountKey: 'expense' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'settlement' },
    ] },
    { code: 'ASSET-MAINTENANCE-CREDIT', eventType: 'ASSET_MAINTENANCE_CREDIT', lines: [
      { accountCodeKey: 'expense', side: 'DEBIT', amountKey: 'expense' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'settlement' },
    ] },
    { code: 'ASSET-DEPRECIATION', eventType: 'ASSET_DEPRECIATION', lines: [
      { accountCodeKey: 'debit', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'credit', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'ASSET-MAINTENANCE-PARTS', eventType: 'ASSET_MAINTENANCE_PARTS', lines: [
      { accountCodeKey: 'debit', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'credit', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'ASSET-DISPOSAL', eventType: 'ASSET_DISPOSAL', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'settlement', skipIfZero: true },
      { accountCodeKey: 'accumulatedDepreciation', side: 'DEBIT', amountKey: 'accumulatedDepreciation', skipIfZero: true },
      { accountCodeKey: 'loss', side: 'DEBIT', amountKey: 'loss', skipIfZero: true },
      { accountCodeKey: 'asset', side: 'CREDIT', amountKey: 'assetCost' },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'gain', side: 'CREDIT', amountKey: 'gain', skipIfZero: true },
    ] },
    { code: 'FLEET-FUEL-CASH', eventType: 'FLEET_FUEL_CASH', lines: [
      { accountCodeKey: 'expense', side: 'DEBIT', amountKey: 'expense' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'settlement' },
    ] },
    { code: 'FLEET-FUEL-CREDIT', eventType: 'FLEET_FUEL_CREDIT', lines: [
      { accountCodeKey: 'expense', side: 'DEBIT', amountKey: 'expense' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'settlement' },
    ] },
    { code: 'PAYROLL-POSTED', eventType: 'PAYROLL_POSTED', lines: [
      { accountCodeKey: 'payrollExpense', side: 'DEBIT', amountKey: 'payrollExpense' },
      { accountCodeKey: 'salaryPayable', side: 'CREDIT', amountKey: 'salaryPayable' },
      { accountCodeKey: 'payrollTaxPayable', side: 'CREDIT', amountKey: 'payrollTaxPayable', skipIfZero: true },
      { accountCodeKey: 'payrollOtherPayable', side: 'CREDIT', amountKey: 'payrollOtherPayable', skipIfZero: true },
    ] },
    { code: 'PAYROLL-SALARY-PAYMENT', eventType: 'PAYROLL_SALARY_PAYMENT', lines: [
      { accountCodeKey: 'salaryPayable', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'PAYROLL-EMPLOYEE-RECOVERY', eventType: 'PAYROLL_EMPLOYEE_RECOVERY', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'payrollReceivable', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'PAYROLL-LIABILITY-PAYMENT', eventType: 'PAYROLL_LIABILITY_PAYMENT', lines: [
      { accountCodeKey: 'payrollLiability', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'STOCK-TRANSFER-SHIPPED', eventType: 'STOCK_TRANSFER_SHIPPED', lines: [
      { accountCodeKey: 'debit', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'credit', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'STOCK-TRANSFER-RECEIVED', eventType: 'STOCK_TRANSFER_RECEIVED', lines: [
      { accountCodeKey: 'debit', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'credit', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'STOCK-OPNAME-ADJUSTMENT', eventType: 'STOCK_OPNAME_ADJUSTMENT', lines: [
      { accountCodeKey: 'inventoryGain', side: 'DEBIT', amountKey: 'inventoryGain', skipIfZero: true },
      { accountCodeKey: 'gain', side: 'CREDIT', amountKey: 'gain', skipIfZero: true },
      { accountCodeKey: 'loss', side: 'DEBIT', amountKey: 'loss', skipIfZero: true },
      { accountCodeKey: 'inventoryLoss', side: 'CREDIT', amountKey: 'inventoryLoss', skipIfZero: true },
    ] },
    { code: 'OPERATING-EXPENSE', eventType: 'OPERATING_EXPENSE', lines: [
      { accountCodeKey: 'expense', side: 'DEBIT', amountKey: 'net' },
      { accountCodeKey: 'inputTax', side: 'DEBIT', amountKey: 'inputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'OTHER-INCOME', eventType: 'OTHER_INCOME', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'revenue', side: 'CREDIT', amountKey: 'net' },
      { accountCodeKey: 'outputTax', side: 'CREDIT', amountKey: 'outputTax', skipIfZero: true },
    ] },
    { code: 'BALANCE-TRANSFER', eventType: 'BALANCE_TRANSFER', lines: [
      { accountCodeKey: 'debit', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'credit', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'SUPPLIER-PAYMENT', eventType: 'SUPPLIER_PAYMENT', lines: [
      { accountCodeKey: 'payable', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'SALE-RETURN', eventType: 'SALE_RETURN', lines: [
      { accountCodeKey: 'returns', side: 'DEBIT', amountKey: 'net' },
      { accountCodeKey: 'outputTax', side: 'DEBIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross' },
      { accountCodeKey: 'inventory', side: 'DEBIT', amountKey: 'inventory', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'CREDIT', amountKey: 'cogs', skipIfZero: true },
    ] },
    { code: 'ORDER-RETURN', eventType: 'ORDER_RETURN', lines: [
      { accountCodeKey: 'returns', side: 'DEBIT', amountKey: 'net' },
      { accountCodeKey: 'outputTax', side: 'DEBIT', amountKey: 'outputTax', skipIfZero: true },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'settlement', skipIfZero: true },
      { accountCodeKey: 'receivable', side: 'CREDIT', amountKey: 'receivable', skipIfZero: true },
      { accountCodeKey: 'inventory', side: 'DEBIT', amountKey: 'inventory', skipIfZero: true },
      { accountCodeKey: 'cogs', side: 'CREDIT', amountKey: 'cogs', skipIfZero: true },
    ] },
    { code: 'PURCHASE-RETURN', eventType: 'PURCHASE_RETURN', lines: [
      { accountCodeKey: 'payable', side: 'DEBIT', amountKey: 'payableOffset', skipIfZero: true },
      { accountCodeKey: 'supplierReceivable', side: 'DEBIT', amountKey: 'supplierReceivable', skipIfZero: true },
      { accountCodeKey: 'inventory', side: 'CREDIT', amountKey: 'net' },
      { accountCodeKey: 'inputTax', side: 'CREDIT', amountKey: 'inputTax', skipIfZero: true },
    ] },
    { code: 'SUPPLIER-REFUND', eventType: 'SUPPLIER_REFUND', lines: [
      { accountCodeKey: 'settlement', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'supplierReceivable', side: 'CREDIT', amountKey: 'gross' },
    ] },
    { code: 'TAX-PAYMENT', eventType: 'TAX_PAYMENT', lines: [
      { accountCodeKey: 'taxPayable', side: 'DEBIT', amountKey: 'gross' },
      { accountCodeKey: 'settlement', side: 'CREDIT', amountKey: 'gross' },
    ] },
  ];
  for (const rule of postingRules) await prisma.accountingPostingRule.upsert({
    where: { companyId_code_version: { companyId: company.id, code: rule.code, version: 1 } },
    update: { eventType: rule.eventType, status: 'ACTIVE', journalLines: rule.lines as Prisma.InputJsonValue },
    create: { companyId: company.id, code: rule.code, version: 1, name: rule.code, eventType: rule.eventType, status: 'ACTIVE', journalLines: rule.lines as Prisma.InputJsonValue },
  });

  // Assets and fleet classifications.
  const assetCategories = [
    { code: 'GENERAL', name: 'Aset Tetap Umum', assetType: 'MOVABLE', usefulLifeMonths: 48, assetAccountCode: '1401', accumulatedDepreciationCode: '1491', depreciationExpenseCode: '6201', maintenanceExpenseCode: '5203' },
    { code: 'VEHICLE', name: 'Kendaraan', assetType: 'VEHICLE', usefulLifeMonths: 60, assetAccountCode: '1402', accumulatedDepreciationCode: '1492', depreciationExpenseCode: '6201', maintenanceExpenseCode: '5203' },
    { code: 'BUILDING', name: 'Bangunan', assetType: 'BUILDING', usefulLifeMonths: 240, assetAccountCode: '1403', accumulatedDepreciationCode: '1493', depreciationExpenseCode: '6201', maintenanceExpenseCode: '5203' },
    { code: 'LAND', name: 'Tanah', assetType: 'LAND', usefulLifeMonths: null, assetAccountCode: '1404', accumulatedDepreciationCode: null, depreciationExpenseCode: null, maintenanceExpenseCode: '5203' },
  ] as const;
  for (const categoryData of assetCategories) await prisma.assetCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: categoryData.code } },
    update: { ...categoryData, assetType: categoryData.assetType as never },
    create: { companyId: company.id, ...categoryData, assetType: categoryData.assetType as never },
  });

  // Inspection templates and branch policies.
  const receivingTemplate = await prisma.inspectionTemplate.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'RECEIVING-STANDARD', version: 1 } },
    update: {}, create: { companyId: company.id, code: 'RECEIVING-STANDARD', version: 1, name: 'Pemeriksaan Penerimaan Supplier', type: 'PURCHASE_INBOUND', appliesTo: 'GoodsReceipt', items: { create: [
      { code: 'DOCUMENT', label: 'PO, surat jalan, dan invoice sesuai', sequence: 1, failureSeverity: 'BLOCKING' },
      { code: 'BARCODE_QTY', label: 'Barcode dan jumlah barang sesuai', sequence: 2, failureSeverity: 'BLOCKING' },
      { code: 'CONDITION', label: 'Kondisi barang baik dan kemasan utuh', sequence: 3, failureSeverity: 'BLOCKING' },
      { code: 'BATCH_EXPIRY', label: 'Batch dan kedaluwarsa sudah diperiksa', sequence: 4, failureSeverity: 'WARNING' },
      { code: 'PHOTO', label: 'Foto bukti penerimaan tersedia', sequence: 5, failureSeverity: 'WARNING' },
    ] } },
  });
  await prisma.inspectionTemplate.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'OUTBOUND-STANDARD', version: 1 } },
    update: {}, create: { companyId: company.id, code: 'OUTBOUND-STANDARD', version: 1, name: 'Pemeriksaan Barang Keluar', type: 'ORDER_OUTBOUND', appliesTo: 'Shipment', items: { create: [
      { code: 'BARCODE_QTY', label: 'Barang discan dan jumlah sesuai manifest', sequence: 1, failureSeverity: 'BLOCKING' },
      { code: 'PACKAGING', label: 'Kemasan aman dan label tujuan benar', sequence: 2, failureSeverity: 'BLOCKING' },
      { code: 'SERIAL_BATCH', label: 'Serial/batch sesuai bila diwajibkan', sequence: 3, failureSeverity: 'BLOCKING' },
      { code: 'SEAL', label: 'Segel kendaraan/paket tercatat', sequence: 4, failureSeverity: 'WARNING' },
    ] } },
  });
  await prisma.inspectionTemplate.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'RETURN-INBOUND-STANDARD', version: 1 } },
    update: {}, create: { companyId: company.id, code: 'RETURN-INBOUND-STANDARD', version: 1, name: 'Pemeriksaan Retur Pelanggan', type: 'RETURN_INBOUND', appliesTo: 'SaleReturn', items: { create: [
      { code: 'SALE_REFERENCE', label: 'Transaksi penjualan asal valid', sequence: 1, failureSeverity: 'BLOCKING' },
      { code: 'BARCODE_QTY', label: 'Produk dan jumlah retur sesuai', sequence: 2, failureSeverity: 'BLOCKING' },
      { code: 'CONDITION', label: 'Kondisi barang menentukan restock atau karantina', sequence: 3, failureSeverity: 'BLOCKING' },
      { code: 'PHOTO', label: 'Foto bukti retur tersedia', sequence: 4, failureSeverity: 'WARNING' },
    ] } },
  });
  await prisma.inspectionTemplate.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'RETURN-OUTBOUND-STANDARD', version: 1 } },
    update: {}, create: { companyId: company.id, code: 'RETURN-OUTBOUND-STANDARD', version: 1, name: 'Pemeriksaan Retur Supplier', type: 'OTHER', appliesTo: 'PurchaseReturn', items: { create: [
      { code: 'RECEIPT_REFERENCE', label: 'Penerimaan dan supplier asal valid', sequence: 1, failureSeverity: 'BLOCKING' },
      { code: 'BARCODE_QTY', label: 'Produk dan jumlah retur sesuai', sequence: 2, failureSeverity: 'BLOCKING' },
      { code: 'PACKAGING', label: 'Kemasan dan dokumen retur lengkap', sequence: 3, failureSeverity: 'BLOCKING' },
      { code: 'GATE_PASS', label: 'Gate pass barang keluar tersedia', sequence: 4, failureSeverity: 'WARNING' },
    ] } },
  });
  await prisma.inspectionTemplate.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'VEHICLE-PRETRIP', version: 1 } },
    update: {}, create: { companyId: company.id, code: 'VEHICLE-PRETRIP', version: 1, name: 'Pemeriksaan Kendaraan Sebelum Jalan', type: 'VEHICLE_PRETRIP', appliesTo: 'DeliveryTrip', items: { create: [
      { code: 'TIRE', label: 'Ban dan tekanan angin aman', sequence: 1, failureSeverity: 'BLOCKING' },
      { code: 'BRAKE', label: 'Rem berfungsi baik', sequence: 2, failureSeverity: 'BLOCKING' },
      { code: 'LIGHT', label: 'Lampu dan indikator berfungsi', sequence: 3, failureSeverity: 'BLOCKING' },
      { code: 'DOCUMENT', label: 'Dokumen kendaraan dan pengemudi lengkap', sequence: 4, failureSeverity: 'BLOCKING' },
      { code: 'ODOMETER_FUEL', label: 'Odometer dan bahan bakar dicatat', sequence: 5, failureSeverity: 'WARNING' },
    ] } },
  });
  await prisma.inspectionTemplate.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'DELIVERY-PROOF', version: 1 } },
    update: {}, create: { companyId: company.id, code: 'DELIVERY-PROOF', version: 1, name: 'Bukti Serah Terima Pelanggan', type: 'DELIVERY_PROOF', appliesTo: 'DeliveryStop', items: { create: [
      { code: 'RECIPIENT', label: 'Identitas penerima dikonfirmasi', sequence: 1, failureSeverity: 'BLOCKING' },
      { code: 'QUANTITY', label: 'Jumlah barang diterima sesuai', sequence: 2, failureSeverity: 'BLOCKING' },
      { code: 'PHOTO_SIGNATURE', label: 'Foto/tanda tangan bukti serah terima', sequence: 3, failureSeverity: 'BLOCKING' },
      { code: 'COD', label: 'COD diterima dan dicatat bila berlaku', sequence: 4, failureSeverity: 'BLOCKING' },
    ] } },
  });

  const policies = [
    { code: 'PURCHASE-RECEIPT-DEFAULT', operationType: 'PURCHASE_RECEIPT', name: 'Penerimaan Supplier Terverifikasi', requireInspection: true, requirePhoto: true, requireBarcodeScan: true, requireBatchScan: false, requireSerialScan: false, requireVehicle: false, requireGatePass: false, requiredConfirmations: 1, blockOnMismatch: true, autoPostInventory: true, autoPostAccounting: true, autoCalculateTax: true, inspectionTemplateCode: receivingTemplate.code },
    { code: 'ORDER-OUTBOUND-DEFAULT', operationType: 'ORDER_OUTBOUND', name: 'Barang Keluar Terverifikasi', requireInspection: true, requirePhoto: true, requireBarcodeScan: true, requireBatchScan: false, requireSerialScan: false, requireVehicle: false, requireGatePass: false, requiredConfirmations: 1, blockOnMismatch: true, autoPostInventory: false, autoPostAccounting: false, autoCalculateTax: false, inspectionTemplateCode: 'OUTBOUND-STANDARD' },
    { code: 'VEHICLE-DISPATCH-DEFAULT', operationType: 'VEHICLE_DISPATCH', name: 'Kendaraan Wajib Layak Jalan', requireInspection: true, requirePhoto: true, requireBarcodeScan: false, requireBatchScan: false, requireSerialScan: false, requireVehicle: true, requireGatePass: true, requiredConfirmations: 1, blockOnMismatch: true, autoPostInventory: false, autoPostAccounting: false, autoCalculateTax: false, inspectionTemplateCode: 'VEHICLE-PRETRIP' },
    { code: 'ASSET-HANDOVER-DEFAULT', operationType: 'ASSET_HANDOVER', name: 'Serah Terima Aset', requireInspection: true, requirePhoto: true, requireBarcodeScan: true, requireBatchScan: false, requireSerialScan: true, requireVehicle: false, requireGatePass: false, requiredConfirmations: 1, blockOnMismatch: true, autoPostInventory: false, autoPostAccounting: false, autoCalculateTax: false, inspectionTemplateCode: null },
  ] as const;
  for (const policy of policies) await prisma.operationPolicy.upsert({
    where: { companyId_branchId_code: { companyId: company.id, branchId: branch.id, code: policy.code } },
    update: policy, create: { companyId: company.id, branchId: branch.id, ...policy },
  });

  await prisma.approvalPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'GOODS_RECEIPT_MISMATCH' } },
    update: {}, create: { companyId: company.id, code: 'GOODS_RECEIPT_MISMATCH', name: 'Persetujuan Selisih Penerimaan', entityType: 'GoodsReceipt', conditions: { mismatchCount: { gt: 0 } }, steps: [{ step: 1, roles: ['WAREHOUSE','MANAGER'], minApprovals: 1 }, { step: 2, roles: ['FINANCE','OWNER'], minApprovals: 1 }] },
  });
  await prisma.approvalPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ASSET_HIGH_VALUE' } },
    update: {}, create: { companyId: company.id, code: 'ASSET_HIGH_VALUE', name: 'Persetujuan Perolehan Aset Bernilai Besar', entityType: 'Asset', conditions: { amount: { gteSetting: 'finance.approval_threshold' } }, steps: [{ step: 1, roles: ['FINANCE'], minApprovals: 1 }, { step: 2, roles: ['OWNER'], minApprovals: 1 }] },
  });
  await prisma.approvalPolicy.upsert({
    where: { companyId_code: { companyId: company.id, code: 'FLEET_EXCEPTION' } },
    update: {}, create: { companyId: company.id, code: 'FLEET_EXCEPTION', name: 'Persetujuan Pengecualian Armada/Pengiriman', entityType: 'DeliveryTrip', conditions: { hasBlockingException: true }, steps: [{ step: 1, roles: ['MANAGER'], minApprovals: 1 }] },
  });

  await prisma.businessRule.upsert({
    where: { companyId_code: { companyId: company.id, code: 'VEHICLE-MAINTENANCE-DUE' } }, update: {},
    create: { companyId: company.id, code: 'VEHICLE-MAINTENANCE-DUE', name: 'Buat work order saat servis jatuh tempo', trigger: 'asset.maintenance.due', conditions: { assetType: 'VEHICLE' }, actions: [{ type: 'automation.enqueue', actionType: 'CREATE_MAINTENANCE_WORK_ORDER' }, { type: 'notification.enqueue', template: 'VEHICLE_MAINTENANCE_DUE' }] },
  });
  await prisma.businessRule.upsert({
    where: { companyId_code: { companyId: company.id, code: 'RECEIVING-MISMATCH-APPROVAL' } }, update: {},
    create: { companyId: company.id, code: 'RECEIVING-MISMATCH-APPROVAL', name: 'Approval selisih penerimaan', trigger: 'inspection.completed', conditions: { type: 'PURCHASE_INBOUND', mismatchCount: { gt: 0 } }, actions: [{ type: 'approval.create', policyCode: 'GOODS_RECEIPT_MISMATCH' }, { type: 'notification.enqueue', template: 'GOODS_RECEIPT_MISMATCH' }] },
  });

  // Permission matrix per role (w0-permission-guard-coverage).
  // SUPER_ADMIN otomatis full via loop di atas; matrix ini untuk role operasional.
  const rolePermissionMatrix: Array<[string, string[]]> = [
    ['OWNER', ['*']],
    ['ADMIN', [
      'product.view','product.create','product.update','product.delete',
      'master_data.view','master_data.manage','customer.view','customer.manage',
      'supplier.view','supplier.create','supplier.update',
      'purchase.view','purchase.create','purchase.approve','purchase.receive','purchase.return',
      'inventory.view','inventory.adjust','inventory.transfer','inventory.opname','inventory.batch','inventory.serial',
      'sale.view','sale.create','sale.cancel','sale.return','sale.refund',
      'order.view','order.manage','order.cancel','shipment.manage',
      'payment.view','payment.manage','payment.refund','payment.reconcile',
      'finance.view','finance.create','finance.post','finance.journal','finance.expense','finance.approve','finance.close_period','finance.reconcile',
      'loyalty.view','loyalty.manage','forecast.view','forecast.run','assistant.use','assistant.manage',
      'promotion.view','promotion.manage',
      'integration.view','integration.manage','webhook.manage','notification.manage','api_key.view','api_key.manage',
      'platform.configure','branch.switch','approval.manage','custom_field.manage','ui_schema.manage',
      'user.manage','report.view','report.export','audit.view',
      'employee.view','employee.manage',
      'attendance.view','attendance.manage','attendance.record','attendance.approve',
      'leave.view','leave.manage','leave.approve','overtime.view','overtime.manage','overtime.approve',
      'payroll.view','payroll.manage','payroll.calculate','payroll.approve','payroll.post','payroll.publish',
      'tax.view','tax.manage','accounting.event.view','accounting.rule.manage',
      'asset.view','asset.manage','asset.acquire','asset.assign','asset.maintenance','asset.depreciate',
      'fleet.view','fleet.manage','fleet.expense','delivery.trip.manage','delivery.loading.confirm','delivery.dispatch','delivery.proof',
      'inspection.view','inspection.record','inspection.manage','inspection.approve','gate_pass.manage','gate_pass.approve',
      'operations.policy.view','operations.policy.manage','operations.confirm','automation.manage',
      'goods_receipt.confirm','goods_receipt.reject','manufacturing.view','manufacturing.manage','digital_service.view','digital_service.manage',
    ]],
    ['CASHIER', ['product.view','inventory.view','sale.view','sale.create','sale.return','order.view','loyalty.view','loyalty.manage','promotion.view','customer.view','customer.manage','digital_service.view','digital_service.manage']],
    ['WAREHOUSE', [
      'master_data.view','master_data.manage',
      'product.view','supplier.view','purchase.view','purchase.receive','purchase.return',
      'inventory.view','inventory.adjust','inventory.transfer','inventory.opname','inventory.batch','inventory.serial',
      'sale.view','sale.return','order.view','shipment.manage',
      'asset.view','asset.maintenance','fleet.view','fleet.expense',
      'delivery.trip.manage','delivery.loading.confirm','delivery.dispatch','delivery.proof',
      'inspection.view','inspection.record','inspection.manage','inspection.approve',
      'gate_pass.manage','gate_pass.approve','goods_receipt.confirm','goods_receipt.reject',
      'operations.confirm','attendance.record','manufacturing.view','manufacturing.manage',
    ]],
    ['PURCHASING', ['master_data.view','product.view','supplier.view','supplier.create','supplier.update','purchase.view','purchase.create','purchase.approve','purchase.receive','purchase.return','inventory.view','inventory.batch','inspection.view','inspection.record','goods_receipt.confirm','goods_receipt.reject']],
    ['FINANCE', [
      'product.view','supplier.view','purchase.view','sale.view','order.view',
      'payment.view','payment.manage','payment.refund','payment.reconcile',
      'finance.view','finance.create','finance.post','finance.journal','finance.expense','finance.approve','finance.close_period','finance.reconcile',
      'tax.view','tax.manage','accounting.event.view','accounting.rule.manage',
      'payroll.view','payroll.approve','payroll.post','payroll.publish',
      'report.view','report.export','audit.view','inventory.view','asset.view','asset.depreciate','fleet.view',
      'inspection.view','operations.confirm','goods_receipt.confirm','goods_receipt.reject','sale.return','purchase.return',
    ]],
    ['AUDITOR', ['product.view','supplier.view','purchase.view','sale.view','order.view','inventory.view','finance.view','tax.view','accounting.event.view','payroll.view','report.view','report.export','audit.view','inspection.view','asset.view','fleet.view','payment.view','manufacturing.view','digital_service.view']],
    ['HR', ['employee.view','employee.manage','attendance.view','attendance.manage','attendance.approve','leave.view','leave.manage','leave.approve','overtime.view','overtime.manage','overtime.approve','payroll.view','report.view']],
    ['PAYROLL', ['employee.view','attendance.view','attendance.approve','payroll.view','payroll.manage','payroll.calculate','payroll.approve','payroll.post','payroll.publish','tax.view','tax.manage','accounting.event.view','report.view']],
    ['MANAGER', [
      'product.view','supplier.view','purchase.view','purchase.approve','inventory.view','inventory.adjust',
      'sale.view','order.view','payment.view','finance.view','finance.approve','report.view','report.export','audit.view',
      'employee.view','attendance.view','attendance.approve','payroll.view','payroll.approve',
      'inspection.view','inspection.approve','gate_pass.approve','operations.policy.view','operations.confirm',
      'asset.view','fleet.view','delivery.trip.manage','delivery.dispatch','manufacturing.view','manufacturing.manage','digital_service.view',
    ]],
    ['EMPLOYEE', ['employee.self','attendance.record','attendance.view','leave.view','overtime.view','payroll.view']],
  ];
  for (const [roleName, codes] of rolePermissionMatrix) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const resolved = codes.includes('*') ? allPermissions.map((p) => p.id) : (await prisma.permission.findMany({ where: { code: { in: codes } } })).map((p) => p.id);
    for (const permissionId of resolved) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {}, create: { roleId: role.id, permissionId },
      });
    }
  }

  // HRIS demo and configurable payroll foundations.
  const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
  const employeePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'employee.self' } });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: employeeRole.id, permissionId: employeePermission.id } },
    update: {}, create: { roleId: employeeRole.id, permissionId: employeePermission.id },
  });
  const attendanceRecordPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'attendance.record' } });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: employeeRole.id, permissionId: attendanceRecordPermission.id } },
    update: {}, create: { roleId: employeeRole.id, permissionId: attendanceRecordPermission.id },
  });

  const bootstrapEmployeeEmail = process.env.SEED_EMPLOYEE_EMAIL?.trim().toLowerCase();
  const bootstrapEmployeePasswordRaw = process.env.SEED_EMPLOYEE_PASSWORD?.trim();
  if (!demoSeed && Boolean(bootstrapEmployeeEmail) !== Boolean(bootstrapEmployeePasswordRaw)) {
    throw new Error('SEED_EMPLOYEE_EMAIL dan SEED_EMPLOYEE_PASSWORD harus diberikan berpasangan.');
  }
  if (!demoSeed && bootstrapEmployeeEmail && bootstrapEmployeePasswordRaw) {
    if (!bootstrapEmployeeEmail.includes('@') || bootstrapEmployeeEmail.endsWith('@toko360.local')) {
      throw new Error('SEED_EMPLOYEE_EMAIL harus alamat email bootstrap yang valid dan bukan domain demo @toko360.local.');
    }
    const employeePassword = bootstrapPassword('SEED_EMPLOYEE_PASSWORD');
    const employeeUser = await prisma.user.upsert({
      where: { email: bootstrapEmployeeEmail },
      update: {
        name: 'Karyawan Bootstrap',
        passwordHash: await hash(employeePassword, 12),
        branchId: branch.id,
        isActive: true,
      },
      create: {
        name: 'Karyawan Bootstrap',
        email: bootstrapEmployeeEmail,
        passwordHash: await hash(employeePassword, 12),
        branchId: branch.id,
        isActive: true,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: employeeUser.id, roleId: employeeRole.id } },
      update: {},
      create: { userId: employeeUser.id, roleId: employeeRole.id },
    });
    await prisma.employee.upsert({
      where: { companyId_employeeNumber: { companyId: company.id, employeeNumber: 'CI-EMP-0001' } },
      update: {
        userId: employeeUser.id,
        branchId: branch.id,
        fullName: 'Karyawan Bootstrap',
        email: employeeUser.email,
        employmentStatus: 'PERMANENT',
        timezone: 'Asia/Makassar',
        isActive: true,
      },
      create: {
        companyId: company.id,
        branchId: branch.id,
        userId: employeeUser.id,
        employeeNumber: 'CI-EMP-0001',
        fullName: 'Karyawan Bootstrap',
        email: employeeUser.email,
        employmentStatus: 'PERMANENT',
        hireDate: new Date('2026-01-01T00:00:00.000Z'),
        timezone: 'Asia/Makassar',
        isActive: true,
      },
    });
  }

  if (demoSeed) {
    const employeeUser = await prisma.user.upsert({
      where: { email: 'karyawan@toko360.local' }, update: { branchId: branch.id, isActive: true },
      create: { name: 'Karyawan Demo', email: 'karyawan@toko360.local', passwordHash: await hash(process.env.SEED_EMPLOYEE_PASSWORD ?? 'Employee123!', 12), branchId: branch.id },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: employeeUser.id, roleId: employeeRole.id } },
      update: {}, create: { userId: employeeUser.id, roleId: employeeRole.id },
    });
    const department = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: 'OPERASIONAL' } },
      update: {}, create: { companyId: company.id, code: 'OPERASIONAL', name: 'Operasional Toko' },
    });
    const position = await prisma.position.upsert({
      where: { companyId_code: { companyId: company.id, code: 'STORE-STAFF' } },
      update: {}, create: { companyId: company.id, departmentId: department.id, code: 'STORE-STAFF', name: 'Staf Toko', grade: 'STAFF' },
    });
    const employee = await prisma.employee.upsert({
      where: { companyId_employeeNumber: { companyId: company.id, employeeNumber: 'EMP-0001' } },
      update: { userId: employeeUser.id, branchId: branch.id, departmentId: department.id, positionId: position.id, isActive: true },
      create: {
        companyId: company.id, branchId: branch.id, userId: employeeUser.id, departmentId: department.id, positionId: position.id,
        employeeNumber: 'EMP-0001', fullName: 'Karyawan Demo', email: employeeUser.email,
        employmentStatus: 'PERMANENT', hireDate: new Date('2026-01-01T00:00:00.000Z'), timezone: 'Asia/Makassar',
      },
    });
    const shift = await prisma.workShift.upsert({
      where: { companyId_code: { companyId: company.id, code: 'REGULER' } },
      update: {}, create: { companyId: company.id, branchId: branch.id, code: 'REGULER', name: 'Shift Reguler', startMinute: 480, endMinute: 1020, breakMinutes: 60, lateToleranceMinutes: 10 },
    });
    await prisma.attendancePolicy.upsert({
      where: { companyId_code: { companyId: company.id, code: 'DEFAULT' } },
      update: {}, create: {
        companyId: company.id, branchId: branch.id, code: 'DEFAULT', name: 'Kebijakan Absensi Default',
        allowedMethods: ['FINGERPRINT','SELFIE_GPS','MOBILE_GPS'], requirePhoto: false, requireLocation: true,
        allowOutsideGeofence: false, maxLocationAccuracyMeters: 100, offlineAllowed: true,
        rules: { shiftId: shift.id, photoRetentionDays: 180, requireDeviceIntegrity: true },
      },
    });

    const salaryComponent = await prisma.payrollComponentDefinition.upsert({
      where: { companyId_code: { companyId: company.id, code: 'BASIC_SALARY' } },
      update: {}, create: {
        companyId: company.id, code: 'BASIC_SALARY', name: 'Gaji Pokok', componentType: 'EARNING',
        calculationType: 'FIXED', defaultAmount: new Prisma.Decimal(5000000), taxable: true, affectsGross: true, affectsNet: true,
      },
    });
    const componentAssignment = await prisma.employeePayrollComponent.findFirst({ where: { employeeId: employee.id, componentId: salaryComponent.id, isActive: true } });
    if (!componentAssignment) await prisma.employeePayrollComponent.create({
      data: { companyId: company.id, employeeId: employee.id, componentId: salaryComponent.id, amount: new Prisma.Decimal(5000000), effectiveFrom: new Date('2026-01-01T00:00:00.000Z') },
    });
    const demoTaxProfileEffectiveFrom = new Date('2026-01-01T00:00:00.000Z');
    await prisma.employeeTaxProfile.upsert({
      where: { employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom: demoTaxProfileEffectiveFrom } }, update: {},
      create: { companyId: company.id, employeeId: employee.id, countryCode: 'ID', taxStatusCode: 'A', taxMethod: 'GROSS', effectiveFrom: demoTaxProfileEffectiveFrom },
    });
  }
  await prisma.taxRuleSet.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'ID-PPh21-CONFIG', version: 1 } },
    update: {}, create: {
      companyId: company.id, countryCode: 'ID', code: 'ID-PPh21-CONFIG', name: 'Konfigurasi PPh 21 Indonesia',
      legalReference: 'PP 58/2023 dan PMK 168/2023 - verifikasi pembaruan sebelum aktivasi',
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'), calculationMode: 'LOOKUP_TABLE', status: 'DRAFT',
      parameters: { defaultCategory: 'A', categories: { A: [], B: [], C: [] }, requiresOfficialRateImport: true, finalPeriodAnnualReconciliation: true },
    },
  });
  await prisma.socialSecurityRuleSet.upsert({
    where: { companyId_code_version: { companyId: company.id, code: 'ID-BPJS-CONFIG', version: 1 } },
    update: {}, create: {
      companyId: company.id, countryCode: 'ID', code: 'ID-BPJS-CONFIG', name: 'Konfigurasi Jaminan Sosial Indonesia',
      legalReference: 'BPJS Kesehatan dan BPJS Ketenagakerjaan - verifikasi tarif/batas upah resmi sebelum aktivasi',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), status: 'DRAFT',
      parameters: { programs: [], requiresOfficialRateImport: true },
    },
  });
  await prisma.notificationTemplate.upsert({
    where: { companyId_code_channel: { companyId: company.id, code: 'PAYSLIP_PUBLISHED', channel: 'TELEGRAM' } },
    update: {}, create: { companyId: company.id, code: 'PAYSLIP_PUBLISHED', channel: 'TELEGRAM', body: 'Slip gaji {{period}} tersedia: {{secureLink}}', variables: ['period','secureLink'] },
  });
  await prisma.notificationTemplate.upsert({
    where: { companyId_code_channel: { companyId: company.id, code: 'PAYSLIP_PUBLISHED', channel: 'WHATSAPP' } },
    update: {}, create: { companyId: company.id, code: 'PAYSLIP_PUBLISHED', channel: 'WHATSAPP', body: 'Slip gaji {{period}} tersedia: {{secureLink}}', variables: ['period','secureLink'] },
  });
  await prisma.notificationTemplate.upsert({
    where: { companyId_code_channel: { companyId: company.id, code: 'CUSTOMER_VERIFY_EMAIL', channel: 'EMAIL' } },
    update: { subject: 'Kode verifikasi akun Toko360', body: 'Halo {{customer.name}}, kode verifikasi email Anda adalah {{code}}. Berlaku {{expiresMinutes}} menit.', variables: ['customer.name','code','expiresMinutes'], isActive: true },
    create: { companyId: company.id, code: 'CUSTOMER_VERIFY_EMAIL', channel: 'EMAIL', subject: 'Kode verifikasi akun Toko360', body: 'Halo {{customer.name}}, kode verifikasi email Anda adalah {{code}}. Berlaku {{expiresMinutes}} menit.', variables: ['customer.name','code','expiresMinutes'] },
  });
  await prisma.notificationTemplate.upsert({
    where: { companyId_code_channel: { companyId: company.id, code: 'CUSTOMER_VERIFY_PHONE', channel: 'SMS' } },
    update: { body: 'Kode verifikasi Toko360 Anda: {{code}}. Berlaku {{expiresMinutes}} menit.', variables: ['code','expiresMinutes'], isActive: true },
    create: { companyId: company.id, code: 'CUSTOMER_VERIFY_PHONE', channel: 'SMS', body: 'Kode verifikasi Toko360 Anda: {{code}}. Berlaku {{expiresMinutes}} menit.', variables: ['code','expiresMinutes'] },
  });

  console.log(`Seed selesai dalam mode ${seedMode}.`);
  console.log(`Admin bootstrap: ${bootstrapConfig.adminEmail}`);
  console.log(`Company/branch: ${company.name} / ${branch.name}`);
  console.log(`Gudang: ${warehouse.name}`);
  if (demoSeed) console.log('Data contoh lokal (kasir, produk, supplier, karyawan) dibuat. Password tidak ditampilkan ke log.');
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => prisma.$disconnect());
