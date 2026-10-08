import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildGate = fs.readFileSync('scripts/run-build-gate.mjs', 'utf8');
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');

test('build gate generates schema-specific PostgreSQL Prisma Client before TypeScript lint', () => {
  const generate = buildGate.indexOf('PRISMA_GENERATE_POSTGRES_FOR_TYPECHECK');
  const lint = buildGate.indexOf('TYPESCRIPT_LINT');
  const sqlitePrepare = buildGate.indexOf('SQLITE_DB_PREPARE');
  const finalGenerate = buildGate.indexOf('PRISMA_GENERATE_POSTGRES_FINAL');
  const build = buildGate.indexOf('SIX_APP_PRODUCTION_BUILD');
  // `indexOf` akan mengenai kemunculan pertama, termasuk di dalam komentar. Yang harus diukur
  // adalah baris kode yang benar-benar menjalankan `npm test`, bukan prosa yang menyebutnya.
  const regression = buildGate.indexOf("runNpm(['test'], 'REGRESSION_TESTS'");
  assert.ok(generate > 0, 'typecheck Prisma generation missing');
  assert.ok(lint > generate, 'lint must run after Prisma Client generation');

  // Diperbaiki setelah UAT GitHub 2026-10-01 (clean clone, commit 095e42a): `npm test` instantiate
  // PrismaClient lewat URL SQLite, tapi client aktif saat itu hasil PRISMA_GENERATE_POSTGRES_FOR_
  // TYPECHECK. Akibatnya 59 test gagal dengan "the URL must start with the protocol
  // postgresql://" - HANYA di checkout bersih. Assertion lama justru MENGUNCI urutan salah ini
  // (`sqlitePrepare > lint`), jadi ia menjaga bug, bukan mencegahnya.
  //
  // Dua client dipakai untuk dua keperluan berbeda, keduanya tetap wajib:
  //   - typecheck terhadap skema produksi  -> PostgreSQL client, sebelum lint
  //   - runtime test lewat URL SQLite     -> SQLite client, sebelum `npm test`
  assert.ok(sqlitePrepare > lint, 'SQLite Client must be generated after typecheck');
  assert.ok(regression > sqlitePrepare,
    'regression tests must run AFTER the SQLite Client is generated, atau PrismaClient akan ' +
    'dibuat dengan protocol postgresql:// dan test runtime gagal');
  assert.ok(build > finalGenerate, 'production build must use final PostgreSQL Client');
  assert.ok(finalGenerate > regression,
    'PostgreSQL Client untuk produksi dipulihkan setelah test runtime SQLite selesai, dan ' +
    'sebelum production build');

  // Diketemukan saat UAT GitHub (clean clone): `npm test` berjalan sebelum SIX_APP_PRODUCTION_BUILD,
  // tapi `tests/post1c-telegram-polling.test.mjs` meng-import `apps/worker/dist/telegram-polling.js`.
  // Di checkout bersih file itu belum ada -> ERR_MODULE_NOT_FOUND. Di laptop `dist/` selalu ada.
  // Test-nya tidak diubah (menguji transport nyata lewat HTTP server itu memang bukti yang benar);
  // gate yang harus menyediakan artefaknya.
  const workerBuild = buildGate.indexOf('WORKER_BUILD_FOR_TRANSPORT_TESTS');
  assert.ok(workerBuild > 0, 'build gate harus build worker untuk test transport Telegram');
  assert.ok(regression > workerBuild,
    'worker build harus mendahului REGRESSION_TESTS, atau test yang mengimpor dist/ akan ' +
    'gagal dengan ERR_MODULE_NOT_FOUND di checkout bersih');
});

test('PR CI does not test/build against an ungenerated or SQLite-generated Prisma Client', () => {
  assert.match(ci, /Generate PostgreSQL Prisma Client for repository tests[\s\S]*npm run db:postgres:generate[\s\S]*npm test/);
  assert.match(ci, /npm run db:local:prepare[\s\S]*npm run test:db:smoke[\s\S]*Restore PostgreSQL Prisma Client for production build typing[\s\S]*npm run db:postgres:generate[\s\S]*npm run build/);
});
