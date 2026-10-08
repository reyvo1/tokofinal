#!/usr/bin/env node
import { createCipheriv, randomBytes } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

function parseKey(raw) {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  try { const decoded = Buffer.from(value, 'base64'); return decoded.length === 32 ? decoded : undefined; } catch { return undefined; }
}
const key = parseKey(process.env.SECRET_MASTER_KEY ?? process.env.ENCRYPTION_KEY);
if (!key) throw new Error('SECRET_MASTER_KEY/ENCRYPTION_KEY wajib berupa key 32-byte hex/base64.');
const keyId = process.env.SECRET_KEY_ID ?? 'env-v1';

function encryptText(plainText) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['enc','v1',keyId,iv.toString('base64url'),tag.toString('base64url'),encrypted.toString('base64url')].join(':');
}
function isEnvelope(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.__toko360Encrypted === 'string';
}

const secretSettings = await prisma.systemSetting.findMany({ where: { isSecret: true } });
const integrations = await prisma.integrationConnection.findMany({ where: { encryptedSecrets: { not: null } } });
const webhooks = await prisma.webhookEndpoint.findMany({ where: { headers: { not: Prisma.JsonNull } } });

const pendingSettings = secretSettings.filter((row) => !isEnvelope(row.value));
const pendingIntegrations = integrations.filter((row) => row.encryptedSecrets && !row.encryptedSecrets.startsWith('enc:v1:'));
const pendingWebhooks = webhooks.filter((row) => row.headers && !isEnvelope(row.headers));

const summary = {
  apply,
  pending: {
    systemSettings: pendingSettings.length,
    integrations: pendingIntegrations.length,
    webhookHeaders: pendingWebhooks.length,
  },
};

if (apply) {
  await prisma.$transaction(async (tx) => {
    for (const row of pendingSettings) {
      await tx.systemSetting.update({ where: { id: row.id }, data: { value: { __toko360Encrypted: encryptText(JSON.stringify(row.value)) } } });
    }
    for (const row of pendingIntegrations) {
      await tx.integrationConnection.update({ where: { id: row.id }, data: { encryptedSecrets: encryptText(row.encryptedSecrets) } });
    }
    for (const row of pendingWebhooks) {
      await tx.webhookEndpoint.update({ where: { id: row.id }, data: { headers: { __toko360Encrypted: encryptText(JSON.stringify(row.headers)) } } });
    }
  });
}
console.log(JSON.stringify(summary, null, 2));
await prisma.$disconnect();
