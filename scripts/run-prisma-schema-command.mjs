import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [profileArg, actionArg] = process.argv.slice(2);

const profiles = {
  sqlite: {
    databaseProfile: 'sqlite',
    schema: 'prisma/schema.sqlite.prisma',
    accepts: (value) => value.startsWith('file:'),
    fallbackUrl: 'file:./data/toko360-schema-check.db',
  },
  postgres: {
    databaseProfile: 'postgresql',
    schema: 'prisma/schema.postgresql.prisma',
    accepts: (value) => /^postgres(?:ql)?:\/\//i.test(value),
    fallbackUrl: 'postgresql://schema_check:schema_check@127.0.0.1:5432/toko360_schema_check?schema=public',
  },
};

const allowedActions = new Set(['validate', 'generate']);
const profile = profiles[profileArg];

if (!profile || !allowedActions.has(actionArg)) {
  console.error('Gunakan: node scripts/run-prisma-schema-command.mjs sqlite|postgres validate|generate');
  process.exit(1);
}

const inheritedDatabaseUrl = String(process.env.DATABASE_URL || '').trim();
const databaseUrl = profile.accepts(inheritedDatabaseUrl)
  ? inheritedDatabaseUrl
  : profile.fallbackUrl;

if (inheritedDatabaseUrl && !profile.accepts(inheritedDatabaseUrl)) {
  console.log(
    `[prisma-schema] DATABASE_URL aktif bukan provider ${profile.databaseProfile}; ` +
    'schema-only command memakai URL placeholder non-koneksi tanpa mengubah .env.',
  );
}

const prismaExecutable = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const result = spawnSync(
  prismaExecutable,
  [actionArg, '--schema', profile.schema],
  {
    cwd: path.join(root, 'apps', 'api'),
    env: {
      ...process.env,
      DATABASE_PROFILE: profile.databaseProfile,
      DATABASE_URL: databaseUrl,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`[prisma-schema] Gagal menjalankan Prisma: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
