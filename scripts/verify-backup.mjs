import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const metadataPath = process.argv[2];
if (!metadataPath) throw new Error('Gunakan: node scripts/verify-backup.mjs <backup-file>.json');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
if (!metadata?.artifact || !metadata?.sha256) throw new Error('Metadata backup tidak valid.');
const artifactPath = isAbsolute(metadata.artifact) ? metadata.artifact : resolve(dirname(metadataPath), metadata.artifact);
const bytes = await readFile(artifactPath);
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== metadata.sha256) throw new Error(`Checksum backup tidak cocok. expected=${metadata.sha256} actual=${actual}`);
if (Number(metadata.size) !== bytes.length) throw new Error(`Ukuran backup tidak cocok. expected=${metadata.size} actual=${bytes.length}`);
console.log(JSON.stringify({ ok: true, artifact: artifactPath, size: bytes.length, sha256: actual, createdAt: metadata.createdAt, source: metadata.source }, null, 2));
