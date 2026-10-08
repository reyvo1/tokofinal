import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { indexCovers, readEnvFile, splitSqlStatements, validateNonProductionConfig } from './run-stage20-release-readiness.mjs';

const args = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
const envFile = path.resolve(process.cwd(), envIndex >= 0 ? args[envIndex + 1] : 'stage20-release-readiness.env');
const values = { ...process.env, ...readEnvFile(envFile) };
const config = validateNonProductionConfig(values);
process.env.DATABASE_URL = config.databaseUrl;

const migrationFile = path.resolve(
  process.cwd(),
  'database/migrations/T360-20260802-145524-release-readiness-indexes/postgresql-expand.sql',
);
if (!fs.existsSync(migrationFile)) throw new Error('SQL critical indexes Tahap 20 tidak ditemukan.');

const statements = splitSqlStatements(fs.readFileSync(migrationFile, 'utf8'));

const requirements = [
  { key: 'product_list', table: 'Product', columns: ['companyId', 'isActive', 'name', 'id'] },
  { key: 'warehouse_branch_lookup', table: 'Warehouse', columns: ['branchId'] },
  { key: 'inventory_list', table: 'Inventory', columns: ['warehouseId', 'updatedAt', 'id'] },
  { key: 'accounting_event_list', table: 'AccountingEvent', columns: ['companyId', 'branchId', 'createdAt', 'id'] },
  { key: 'payroll_run_list', table: 'PayrollRun', columns: ['companyId', 'branchId', 'createdAt'] },
];

const prisma = new PrismaClient();
try {
  const identity = await prisma.$queryRawUnsafe('SELECT current_database() AS database, inet_server_addr()::text AS host');
  const currentDatabase = String(identity?.[0]?.database || '');
  if (currentDatabase !== config.connection.database) throw new Error('Database aktif tidak cocok dengan identitas staging yang dikonfirmasi.');

  for (const statement of statements) await prisma.$executeRawUnsafe(statement);

  const indexRows = await prisma.$queryRawUnsafe(
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Product','Inventory','Warehouse','AccountingEvent','PayrollRun') ORDER BY tablename,indexname`,
  );
  const missing = requirements.filter((requirement) => !indexRows.some(
    (row) => row.tablename === requirement.table && indexCovers(row.indexdef, requirement.columns),
  ));
  if (missing.length) throw new Error(`Critical index belum lengkap: ${missing.map((item) => item.key).join(', ')}.`);
  console.log(`OK: ${requirements.length} critical index Tahap 20 tersedia pada PostgreSQL ${config.target}.`);
} finally {
  await prisma.$disconnect().catch(() => {});
}
