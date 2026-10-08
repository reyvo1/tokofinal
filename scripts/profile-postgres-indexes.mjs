#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

function shortHash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }

function outputPath() {
  const outputIndex = process.argv.indexOf('--output');
  return path.resolve(process.cwd(), outputIndex >= 0 ? process.argv[outputIndex + 1] : 'handoff/quality/postgres-index-profile-latest.json');
}

function writeEvidence(file, evidence) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
}

async function main() {
  const root = process.cwd();
  const output = outputPath();
  const sourceIdentity = sourceFingerprint(root);
  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'FAIL',
    sourceIdentity,
    target: null,
    database: 'postgresql',
    warnings: null,
    tableStats: [],
    indexStats: [],
    gate: { passed: false },
    error: 'PostgreSQL index profile evidence invalidated at attempt start; a fresh PASS must replace it.',
    note: 'Warnings are investigation candidates, not automatic DROP/CREATE recommendations. Confirm with EXPLAIN (ANALYZE, BUFFERS) on staging before changing indexes.',
  };
  writeEvidence(output, evidence);
  let prisma;
  try {
    const databaseUrl = String(process.env.DATABASE_URL || '');
    if (!databaseUrl.startsWith('postgres')) throw new Error('db:index:profile hanya untuk PostgreSQL staging/production clone.');
    const parsedDatabase = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsedDatabase.pathname.replace(/^\//, ''));
    if (!parsedDatabase.hostname || !databaseName) throw new Error('DATABASE_URL PostgreSQL wajib memuat host dan database.');
    evidence.target = { hostHash: shortHash(parsedDatabase.hostname), databaseHash: shortHash(databaseName) };

    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$connect();
    const tableStats = await prisma.$queryRawUnsafe(`
      SELECT schemaname, relname AS "tableName", seq_scan::bigint AS "seqScan", idx_scan::bigint AS "idxScan",
             n_live_tup::bigint AS "liveRows", n_dead_tup::bigint AS "deadRows"
      FROM pg_stat_user_tables
      ORDER BY seq_scan DESC, n_live_tup DESC
    `);
    const indexStats = await prisma.$queryRawUnsafe(`
      SELECT schemaname, relname AS "tableName", indexrelname AS "indexName", idx_scan::bigint AS "idxScan",
             pg_relation_size(indexrelid)::bigint AS "sizeBytes"
      FROM pg_stat_user_indexes
      ORDER BY pg_relation_size(indexrelid) DESC
    `);

    const normalize = (row) => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, typeof value === 'bigint' ? Number(value) : value]));
    const tables = tableStats.map(normalize);
    const indexes = indexStats.map(normalize);
    const seqScanCandidates = tables.filter((row) => row.liveRows >= 1000 && row.seqScan > Math.max(100, row.idxScan * 3));
    const unusedLargeIndexes = indexes.filter((row) => row.idxScan === 0 && row.sizeBytes >= 10 * 1024 * 1024 && !String(row.indexName).endsWith('_pkey'));
    const deadTupleCandidates = tables.filter((row) => row.liveRows >= 1000 && row.deadRows / Math.max(1,row.liveRows) >= 0.2);

    evidence.status = 'PASS';
    evidence.warnings = { sequentialScanCandidates: seqScanCandidates, unusedLargeIndexes, deadTupleCandidates };
    evidence.tableStats = tables;
    evidence.indexStats = indexes;
    evidence.gate.passed = true;
    evidence.error = null;
    writeEvidence(output, evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    writeEvidence(output, evidence);
    throw error;
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`POSTGRES_INDEX_PROFILE_ERROR: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
