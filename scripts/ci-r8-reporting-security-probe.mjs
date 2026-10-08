#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-r8-reporting-security-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential R8 reporting/security probe tidak tersedia.');

const prisma = new PrismaClient();
const stamp = Date.now();
const artifacts = { companyId: null, roleId: null, userId: null, employeeId: null, createdEmployee: false, bindingId: null, productId: null, inventoryId: null, warehouseId: null, createdWarehouse: false, settingId: null, settingExisted: false, originalSettingValue: null };

async function request(route, { method = 'GET', body, token, expect } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expect !== undefined) {
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0, 500)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 700)}`);
  return data;
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

let result;
try {
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.accessToken;
  if (!token) throw new Error('Login R8 tidak menghasilkan access token.');
  const tenant = await request('/platform/tenant', { token });
  const companyId = tenant?.company?.id;
  const branchId = tenant?.activeBranchId;
  artifacts.companyId = companyId ?? null;
  if (!companyId || !branchId) throw new Error('Tenant/branch R8 tidak lengkap.');

  const existingSetting = await prisma.systemSetting.findFirst({ where: { companyId, namespace: 'reports', key: 'daily_digest' } });
  artifacts.settingExisted = Boolean(existingSetting);
  artifacts.settingId = existingSetting?.id ?? null;
  artifacts.originalSettingValue = existingSetting?.value ?? null;

  const roleName = `R8_RESTRICTED_${String(stamp).slice(-8)}`;
  const restrictedPassword = 'R8-CI-Restricted-Password-2026!';
  const role = await request('/users/roles', { method: 'POST', token, body: { name: roleName, description: 'R8 reporting denial probe', permissionCodes: ['audit.view'] } });
  artifacts.roleId = role.id;
  const user = await request('/users', { method: 'POST', token, body: { name: 'R8 Restricted Operator', email: `r8-restricted-${stamp}@example.invalid`, password: restrictedPassword, roleNames: [roleName] } });
  artifacts.userId = user.id;
  const restrictedLogin = await request('/auth/login', { method: 'POST', body: { email: `r8-restricted-${stamp}@example.invalid`, password: restrictedPassword } });
  if (!restrictedLogin?.accessToken) throw new Error('Restricted R8 login gagal.');
  await request('/reports/daily-digest/config', { method: 'POST', token: restrictedLogin.accessToken, body: { enabled: false, hour: 21, recipientBindingIds: [] }, expect: 403 });

  await request('/reports/daily-digest/config', { method: 'POST', token, body: { enabled: false, hour: 21, recipientBindingIds: [] } });
  await request('/reports/daily-digest/send', { method: 'POST', token, body: {}, expect: 400 });

  let employee = await prisma.employee.findFirst({ where: { companyId, isActive: true }, orderBy: { createdAt: 'asc' } });
  if (!employee) {
    employee = await prisma.employee.create({ data: { companyId, branchId, employeeNumber: `R8-${String(stamp).slice(-9)}`, fullName: 'R8 Runtime Recipient', employmentStatus: 'PERMANENT', hireDate: new Date(), timezone: 'Asia/Makassar' } });
    artifacts.createdEmployee = true;
    artifacts.employeeId = employee.id;
  }
  const externalUserId = `r8-telegram-${stamp}`;
  const binding = await prisma.employeeChannelBinding.create({ data: { companyId, employeeId: employee.id, channel: 'TELEGRAM', addressHash: sha256(`TELEGRAM:${externalUserId}`), externalUserId, verifiedAt: null, isPrimary: false } });
  artifacts.bindingId = binding.id;
  await request('/reports/daily-digest/config', { method: 'POST', token, body: { enabled: true, hour: 21, recipientBindingIds: [binding.id] }, expect: 400 });
  await prisma.employeeChannelBinding.update({ where: { id: binding.id }, data: { verifiedAt: new Date() } });
  const accepted = await request('/reports/daily-digest/config', { method: 'POST', token, body: { enabled: true, hour: 21, recipientBindingIds: [binding.id] } });
  if (!Array.isArray(accepted?.recipientBindingIds) || accepted.recipientBindingIds.length !== 1 || accepted.recipientBindingIds[0] !== binding.id) throw new Error('Verified binding tidak menjadi canonical digest recipient.');
  const config = await request('/reports/daily-digest/config', { token });
  if (!config?.availableRecipients?.some((item) => item.id === binding.id && item.externalUserId === externalUserId && item.verifiedAt)) throw new Error('Verified owner recipient tidak tersedia pada runtime config.');
  if ('recipients' in config || 'recipient' in config) throw new Error('Daily digest masih mengekspos raw recipient config contract.');

  let warehouse = await prisma.warehouse.findFirst({ where: { branchId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({ data: { branchId, code: `R8WH${String(stamp).slice(-8)}`, name: `R8 CI Warehouse ${stamp}`, isDefault: false } });
    artifacts.createdWarehouse = true;
    artifacts.warehouseId = warehouse.id;
  }
  const baseUnit = await prisma.masterReference.findFirst({ where: { companyId, branchId: null, type: 'UNIT', isActive: true }, orderBy: [{ code: 'asc' }, { id: 'asc' }], select: { code: true } });
  if (!baseUnit?.code) throw new Error('Master UNIT aktif tingkat perusahaan tidak tersedia untuk fixture R8.');
  const productName = `R8 Low Stock ${stamp}`;
  const product = await prisma.product.create({ data: { companyId, sku: `R8SKU${stamp}`, name: productName, unit: baseUnit.code, costPrice: 1000, salePrice: 2000, minStock: 10, isActive: true } });
  artifacts.productId = product.id;
  const inventory = await prisma.inventory.create({ data: { warehouseId: warehouse.id, productId: product.id, quantity: 2, reserved: 0, available: 2 } });
  artifacts.inventoryId = inventory.id;
  const preview = await request('/reports/daily-digest/preview', { token });
  const expectedLowStockLine = `sisa 2 ${baseUnit.code} (min 10 ${baseUnit.code})`;
  if (!String(preview?.text || '').includes(productName) || !String(preview?.text || '').includes(expectedLowStockLine)) {
    throw new Error(`Low-stock digest tidak membandingkan available/minStock dalam base unit dinamis. expected=${expectedLowStockLine}`);
  }
  if (!(Number(preview?.summary?.lowStockCount) >= 1)) throw new Error('Low-stock summary count tidak mencerminkan fixture R8.');

  result = {
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    sourceIdentity: sourceFingerprint(root),
    checks: {
      F23_digestMutationDeniedWithoutAuthorizedRole: true,
      F24_disabledDigestBlocksManualSend: true,
      F25_lowStockUsesProductMinStockAtRuntime: true,
      F44_unverifiedBindingRejected: true,
      F44_verifiedBindingAcceptedWithoutRawRecipientConfig: true,
    },
    tenant: { companyId, branchId },
    runtime: { restrictedUserId: user.id, verifiedBindingId: binding.id, lowStockProductId: product.id, lowStockAvailable: 2, lowStockMinStock: 10 },
    productionTouched: false,
    note: 'R8 runtime probe proves digest mutation denial, authoritative enabled flag, minStock-aware low-stock preview, and verified recipient binding on exact PostgreSQL runtime.',
  };
} finally {
  try {
    if (artifacts.settingExisted && artifacts.settingId) {
      await prisma.systemSetting.update({ where: { id: artifacts.settingId }, data: { value: artifacts.originalSettingValue } });
    } else {
      if (artifacts.companyId) await prisma.systemSetting.deleteMany({ where: { companyId: artifacts.companyId, namespace: 'reports', key: 'daily_digest' } });
    }
    if (artifacts.inventoryId) await prisma.inventory.deleteMany({ where: { id: artifacts.inventoryId } });
    if (artifacts.productId) await prisma.product.deleteMany({ where: { id: artifacts.productId } });
    if (artifacts.bindingId) await prisma.employeeChannelBinding.deleteMany({ where: { id: artifacts.bindingId } });
    if (artifacts.createdEmployee && artifacts.employeeId) await prisma.employee.deleteMany({ where: { id: artifacts.employeeId } });
    if (artifacts.createdWarehouse && artifacts.warehouseId) await prisma.warehouse.deleteMany({ where: { id: artifacts.warehouseId } });
    if (artifacts.userId) await prisma.user.deleteMany({ where: { id: artifacts.userId } });
    if (artifacts.roleId) await prisma.role.deleteMany({ where: { id: artifacts.roleId } });
  } finally {
    await prisma.$disconnect();
  }
}

if (!result) throw new Error('R8 reporting/security probe gagal sebelum evidence terbentuk.');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`R8 reporting/security probe PASS: ${Object.keys(result.checks).length} checks.`);
