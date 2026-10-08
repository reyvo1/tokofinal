#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnNpmSync } from './lib/process-runner.mjs';
import { buildExpectedSchemaContract, compareSchemaContract } from './lib/postgres-schema-contract.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const provider = readArg('--provider') || process.env.T360_MIGRATION_PROVIDER || 'sqlite';
const baseRef = readArg('--base-ref') || process.env.T360_MIGRATION_BASE_REF || 'HEAD';
const manifestPath = path.join(root, 'config', 'expand-migration-order.json');
const migrationRoot = path.join(root, 'database', 'migrations');
const schemaRelative = provider === 'postgresql'
  ? 'apps/api/prisma/schema.postgresql.prisma'
  : 'apps/api/prisma/schema.sqlite.prisma';

if (!['sqlite', 'postgresql'].includes(provider)) {
  throw new Error(`Provider tidak didukung: ${provider}`);
}
if (!fs.existsSync(manifestPath)) throw new Error('config/expand-migration-order.json tidak ditemukan.');

function readArg(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return args[index + 1] || null;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(`${command} ${commandArgs.join(' ')} gagal (${result.status}). ${stderr || stdout}`.trim());
  }
  return String(result.stdout || '');
}

function gitShow(ref, relativePath, { optional = false } = {}) {
  const result = spawnSync('git', ['show', `${ref}:${relativePath.replaceAll('\\', '/')}`], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    if (optional) return null;
    throw new Error(`Tidak dapat membaca ${relativePath} dari Git ref ${ref}.`);
  }
  return String(result.stdout || '');
}

function verifyBaseRef() {
  const result = spawnSync('git', ['cat-file', '-e', `${baseRef}^{commit}`], {
    cwd: root,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`T360_MIGRATION_BASE_REF tidak valid: ${baseRef}`);
}

function currentMigrationFiles(order) {
  const suffix = provider === 'postgresql' ? 'postgresql-expand.sql' : 'sqlite-expand.sql';
  return order.map((name) => ({
    name,
    relative: `database/migrations/${name}/${suffix}`,
    absolute: path.join(migrationRoot, name, suffix),
  }));
}

function changedMigrations(files) {
  const selected = [];
  for (const item of files) {
    if (!fs.existsSync(item.absolute)) throw new Error(`Migration manifest menunjuk file yang tidak ada: ${item.relative}`);
    const current = fs.readFileSync(item.absolute, 'utf8');
    const previous = gitShow(baseRef, item.relative, { optional: true });
    if (previous === null) {
      selected.push(item);
      continue;
    }
    if (previous !== current) {
      throw new Error(`Migration yang sudah ada di baseline berubah: ${item.relative}. Buat migration baru; jangan mutate migration lama.`);
    }
  }
  return selected;
}

function npmPrisma(args, env) {
  const result = spawnNpmSync(['exec', '--workspace', '@toko360/api', '--', 'prisma', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`Prisma ${args.join(' ')} gagal. ${String(result.stderr || result.stdout || '').trim()}`);
  }
}


function schemaWithScratchClient(schemaSource, outputDir) {
  const normalizedOutput = path.resolve(outputDir).replaceAll('\\', '/').replaceAll('"', '\\"');
  const generatorPattern = /generator\s+client\s*\{([\s\S]*?)\}/m;
  const match = schemaSource.match(generatorPattern);
  if (!match) throw new Error('Generator Prisma client tidak ditemukan pada schema saat ini.');
  const body = match[1].replace(/^\s*output\s*=.*$/m, '').trimEnd();
  return schemaSource.replace(generatorPattern, `generator client {${body}\n  output = "${normalizedOutput}"\n}`);
}

async function generateScratchClient(tempDir, databaseUrl) {
  const currentSchemaSource = fs.readFileSync(path.join(root, schemaRelative), 'utf8');
  const scratchClientDir = path.join(tempDir, `prisma-client-${provider}`);
  const verificationSchema = path.join(tempDir, `verification-${provider}.prisma`);
  fs.writeFileSync(verificationSchema, schemaWithScratchClient(currentSchemaSource, scratchClientDir));
  npmPrisma(['generate', '--schema', verificationSchema], {
    DATABASE_URL: databaseUrl,
    DATABASE_PROFILE: provider,
  });
  const entry = path.join(scratchClientDir, 'index.js');
  if (!fs.existsSync(entry)) throw new Error('Scratch Prisma Client tidak terbentuk untuk verifikasi migration rehearsal.');
  return import(`${pathToFileURL(entry).href}?t=${Date.now()}`);
}

function sqliteUrl(file) {
  return `file:${path.resolve(file).replaceAll('\\', '/')}`;
}

async function verifySqlite(databaseFile, verificationClient) {
  const { DatabaseSync } = await import('node:sqlite');
  const { Prisma } = verificationClient;
  const db = new DatabaseSync(databaseFile);
  try {
    const tables = db.prepare("SELECT name AS table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const columns = [];
    for (const row of tables) {
      const escaped = String(row.table_name).replaceAll('"', '""');
      for (const column of db.prepare(`PRAGMA table_info("${escaped}")`).all()) {
        columns.push({ table_name: row.table_name, column_name: column.name });
      }
    }
    const expected = buildExpectedSchemaContract(Prisma.dmmf);
    const actualTableSet = new Set(tables.map((row) => String(row.table_name)));
    const actualColumnSet = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
    const missingTables = [];
    const missingColumns = [];
    for (const model of expected.models) {
      if (!actualTableSet.has(model.table)) missingTables.push(model.table);
      for (const column of model.columns) {
        if (!actualColumnSet.has(`${model.table}.${column}`)) missingColumns.push(`${model.table}.${column}`);
      }
    }
    if (missingTables.length || missingColumns.length) {
      throw new Error(`SQLite migration rehearsal belum mencapai schema sekarang: missingTables=${missingTables.length}, missingColumns=${missingColumns.length}.`);
    }
  } finally {
    db.close();
  }
}

async function applySqlite(files, databaseFile) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(databaseFile);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    for (const item of files) {
      db.exec(fs.readFileSync(item.absolute, 'utf8'));
      console.log(`APPLIED sqlite ${item.name}`);
    }
  } finally {
    db.close();
  }
}

function postgresConnection(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('T360_MIGRATION_DATABASE_URL tidak valid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('T360_MIGRATION_DATABASE_URL wajib PostgreSQL.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !url.username || !database) throw new Error('PostgreSQL URL wajib memuat host, user, dan database.');
  return {
    raw,
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

function applyPostgres(files, target) {
  for (const item of files) {
    const result = spawnSync('psql', [
      '-X', '-v', 'ON_ERROR_STOP=1',
      '-h', target.host,
      '-p', target.port,
      '-U', target.user,
      '-d', target.database,
      '-f', item.absolute,
    ], {
      cwd: root,
      env: { ...process.env, PGPASSWORD: target.password },
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`PostgreSQL migration gagal ${item.relative}: ${String(result.stderr || result.stdout || '').trim()}`);
    }
    console.log(`APPLIED postgresql ${item.name}`);
  }
}

async function verifyPostgres(targetUrl, verificationClient) {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = targetUrl;
  let prisma;
  try {
    const { Prisma, PrismaClient } = verificationClient;
    prisma = new PrismaClient();
    const expected = buildExpectedSchemaContract(Prisma.dmmf);
    const [tables, columns, enums, indexes] = await Promise.all([
      prisma.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name"),
      prisma.$queryRawUnsafe('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,column_name'),
      prisma.$queryRawUnsafe("SELECT t.typname AS enum_name,e.enumlabel AS enum_value FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema() ORDER BY t.typname,e.enumsortorder"),
      prisma.$queryRawUnsafe('SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY tablename,indexname'),
    ]);
    const contract = compareSchemaContract(expected, { tables, columns, enums, indexes });
    if (!contract.passed) {
      throw new Error(`PostgreSQL migration rehearsal belum mencapai schema sekarang: tables=${contract.missingTables.length}, columns=${contract.missingColumns.length}, enums=${contract.enumMismatches.length}, criticalIndexes=${contract.missingCriticalIndexes.length}.`);
    }
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
}

async function main() {
  verifyBaseRef();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.migrations) || !manifest.migrations.length) throw new Error('Migration manifest kosong.');
  const files = currentMigrationFiles(manifest.migrations);
  const pending = changedMigrations(files);
  console.log(`Migration rehearsal provider=${provider} baseRef=${baseRef} pending=${pending.length}`);
  if (!pending.length) {
    console.log('Migration rehearsal PASS — tidak ada expand migration baru terhadap baseline ini.');
    return;
  }

  const apiWorkspace = path.join(root, 'apps', 'api');
  const tempDir = fs.mkdtempSync(path.join(apiWorkspace, '.t360-migration-rehearsal-'));
  try {
    const baseSchema = gitShow(baseRef, schemaRelative);
    const baseSchemaFile = path.join(tempDir, path.basename(schemaRelative));
    fs.writeFileSync(baseSchemaFile, baseSchema);

    if (provider === 'sqlite') {
      const databaseFile = path.join(tempDir, 'baseline.sqlite');
      const databaseUrl = sqliteUrl(databaseFile);
      npmPrisma(['db', 'push', '--schema', baseSchemaFile, '--skip-generate'], { DATABASE_URL: databaseUrl, DATABASE_PROFILE: 'sqlite' });
      await applySqlite(pending, databaseFile);
      const verificationClient = await generateScratchClient(tempDir, databaseUrl);
      await verifySqlite(databaseFile, verificationClient);
    } else {
      const raw = process.env.T360_MIGRATION_DATABASE_URL;
      if (!raw) throw new Error('T360_MIGRATION_DATABASE_URL wajib untuk PostgreSQL rehearsal.');
      const target = postgresConnection(raw);
      npmPrisma(['db', 'push', '--schema', baseSchemaFile, '--skip-generate'], { DATABASE_URL: raw, DATABASE_PROFILE: 'postgresql' });
      applyPostgres(pending, target);
      const verificationClient = await generateScratchClient(tempDir, raw);
      await verifyPostgres(raw, verificationClient);
    }

    console.log(`Migration rehearsal PASS — ${pending.length} migration(s) membawa baseline ${baseRef} ke schema saat ini.`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Migration rehearsal FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
