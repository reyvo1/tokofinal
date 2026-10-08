#!/usr/bin/env node
// Retention cleanup — jalankan berkala (cron). Konfigurasi: config/performance-budget.json -> retentionDays.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../../..');
const budget = JSON.parse(fs.readFileSync(path.join(root, 'config', 'performance-budget.json'), 'utf8'));
const days = budget.retentionDays ?? {};
const prisma = new PrismaClient();

function retentionDays(name) {
  const value = days[name];
  if (value == null || value === 0) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error(`retentionDays.${name} harus integer 1-3650 hari atau 0/absent untuk disabled.`);
  }
  return value;
}

const cutoff = (d) => new Date(Date.now() - d * 86400000);

async function main() {
  const results = [];
  const completedOutbox = retentionDays('completedOutbox');
  if (completedOutbox) {
    const r = await prisma.eventOutbox.deleteMany({ where: { status: 'PUBLISHED', publishedAt: { lt: cutoff(completedOutbox) } } });
    results.push(['eventOutbox', r.count]);
  }
  const successfulWebhookDelivery = retentionDays('successfulWebhookDelivery');
  if (successfulWebhookDelivery) {
    const r = await prisma.webhookDelivery.deleteMany({ where: { status: 'SUCCESS', deliveredAt: { lt: cutoff(successfulWebhookDelivery) } } });
    results.push(['webhookDelivery', r.count]);
  }
  const technicalNotificationLog = retentionDays('technicalNotificationLog');
  if (technicalNotificationLog) {
    const r = await prisma.notification.deleteMany({ where: { status: 'SENT', createdAt: { lt: cutoff(technicalNotificationLog) } } });
    results.push(['notification', r.count]);
  }
  for (const [name, count] of results) console.log(`${name}: ${count} rows purged`);
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e.message); process.exit(1); });
