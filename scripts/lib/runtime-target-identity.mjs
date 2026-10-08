import crypto from 'node:crypto';

export function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function expectedPostgresTarget(host, database) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  const normalizedDatabase = String(database || '').trim();
  if (!normalizedHost || !normalizedDatabase) throw new Error('Expected PostgreSQL host/database wajib tersedia.');
  return { profile: 'postgresql', hostHash: shortHash(normalizedHost), databaseHash: shortHash(normalizedDatabase) };
}

export function assertRuntimeDatabaseTarget(actual, expected, label = 'Runtime database target') {
  if (!actual || actual.profile !== 'postgresql') throw new Error(`${label} bukan PostgreSQL.`);
  if (!actual.hostHash || !actual.databaseHash) throw new Error(`${label} tidak memiliki database identity lengkap.`);
  if (actual.hostHash !== expected.hostHash || actual.databaseHash !== expected.databaseHash) {
    throw new Error(`${label} berbeda dari target database yang diharapkan.`);
  }
  return true;
}
