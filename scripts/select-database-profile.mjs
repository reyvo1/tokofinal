import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const profile = process.argv[2];
const source = profile === 'local' ? '.env.local.example' : profile === 'postgres' ? '.env.postgres.example' : null;
if (!source) {
  console.error('Gunakan: node scripts/select-database-profile.mjs local|postgres');
  process.exit(1);
}
const root = process.cwd();
const envPath = resolve(root, '.env');
if (existsSync(envPath)) copyFileSync(envPath, resolve(root, '.env.backup'));
copyFileSync(resolve(root, source), envPath);
console.log(`Profil database ${profile} dipilih. File .env lama disimpan sebagai .env.backup bila sebelumnya ada.`);
