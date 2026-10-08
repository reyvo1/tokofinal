# Runtime Finalization — Dependency & Seed Safety

Tanggal: 2026-09-11

Tahap ini menutup dua risiko yang ditemukan saat mencoba menjalankan runtime/build nyata dari baseline UI Final Cleanup.

## 1. Dependency installer fail-fast dan deterministic

`scripts/install-dependencies.mjs` sekarang:

- mewajibkan `package-lock.json`;
- memakai `npm ci`, bukan `npm install`;
- memeriksa registry npm dan DNS sebelum menyentuh dependency tree;
- menjalankan `npm ping` dengan timeout pendek sebelum `npm ci`;
- menghentikan instalasi lebih awal bila registry/DNS/proxy tidak tersedia;
- tetap menyimpan log diagnosis dengan credential registry disensor;
- hanya mencoba `npm ci --legacy-peer-deps` jika error memang merupakan konflik peer dependency.

Rehearsal di environment kerja ini menghasilkan `EAI_AGAIN registry.npmjs.org` dan installer berhenti dalam sekitar 0,20 detik sebelum `npm ci`. Karena registry tidak tersedia, full workspace dependency install dan production build belum dapat diklaim PASS di environment ini.

Recheck continuation pada 2026-09-11 16:09 Asia/Makassar kembali menghasilkan `EAI_AGAIN registry.npmjs.org` dan berhenti sekitar 1,27 detik sebelum `npm ci`. `node_modules` tidak ada dan cache npm terverifikasi kosong (0 byte content), sehingga tidak ada jalur offline yang sah untuk menjalankan production build.

Recheck berikutnya setelah hardening runtime pada 2026-09-11 17:56 Asia/Makassar kembali gagal aman karena `EAI_AGAIN` dalam sekitar 0,22 detik. `node_modules` tetap tidak dibuat dan SHA-256 `package-lock.json` tetap sama, sehingga tidak ada partial dependency mutation.

## 2. Seed mode dipisahkan antara lokal/demo dan PostgreSQL bootstrap

### Lokal / SQLite

`.env.local.example` menetapkan:

```text
SEED_MODE=demo
```

Mode ini mempertahankan pengalaman local development: akun contoh, produk, supplier, stok awal, dan fixture karyawan dapat dibuat.

### PostgreSQL / staging / production

PostgreSQL sekarang default ke `bootstrap` bila `SEED_MODE` tidak diisi. Pada `staging` atau `production`, `SEED_MODE=demo` ditolak.

Bootstrap mewajibkan nilai eksplisit:

```text
SEED_COMPANY_ID
SEED_COMPANY_NAME
SEED_COMPANY_SLUG
SEED_BRANCH_CODE
SEED_BRANCH_NAME
SEED_WAREHOUSE_CODE
SEED_WAREHOUSE_NAME
SEED_ADMIN_EMAIL
SEED_ADMIN_PASSWORD
```

`SEED_ADMIN_PASSWORD` minimal 14 karakter dan tidak boleh memakai password demo/default. `SEED_ADMIN_EMAIL` tidak boleh memakai domain demo `@toko360.local`.

Mode bootstrap tidak membuat:

- kasir demo;
- produk/supplier contoh;
- opening stock contoh;
- user/karyawan demo;
- assignment payroll demo.

Password seed tidak pernah dicetak ke log oleh `seed.ts`.

## 3. Permission seed diperbaiki

`promotion.view` dan `promotion.manage` sebelumnya dipakai controller/role matrix tetapi tidak ada pada canonical `permissionCodes`. Keduanya sekarang selalu di-upsert sebelum role-permission assignment.

## 4. CI PostgreSQL menggunakan bootstrap

Workflow PostgreSQL CI dan release-candidate sekarang memasok bootstrap company/admin eksplisit. `scripts/smoke-db.mjs` juga seed-mode-aware:

- `demo`: tetap mengharuskan product dan supplier fixture;
- `bootstrap`: hanya mengharuskan company, branch, warehouse, admin user, feature flags, dan tidak memaksa fixture demo.


## 5. Protected environment hardening

`staging` dan `production` sekarang diperlakukan sebagai protected runtime environments untuk bootstrap keamanan utama:

- `JWT_SECRET` wajib eksplisit, bukan placeholder, dan minimal 32 karakter;
- `CORS_ORIGINS` wajib eksplisit dan wildcard `*` ditolak;
- `SECRET_MASTER_KEY`/`ENCRYPTION_KEY` wajib valid 32-byte untuk API dan worker;
- webhook boleh tetap tidak digunakan, tetapi saat worker benar-benar mengirim delivery pada staging/production, `WEBHOOK_SIGNING_SECRET` wajib unik, bukan placeholder, dan minimal 32 karakter;
- `.env.postgres.example` tidak lagi membawa placeholder rahasia yang bisa tampak valid; secret/CORS sengaja kosong agar deployment gagal aman sampai diisi;
- runner release-readiness staging memasok key sementara yang valid dan origin eksplisit untuk rehearsal terisolasi.

Load-test tooling juga diperketat: seluruh argumen numerik divalidasi sebagai finite number dengan range yang benar sebelum request pertama. Threshold `NaN`, negatif, `max-error-rate > 1`, atau timeout di bawah batas minimum sekarang menghasilkan exit code 1 alih-alih false PASS.

Evidence lokal untuk tooling: full static suite **333/333 PASS**; load runner mock **300/300 sukses, 0 error**; staging certification mock **6/6 check PASS**, termasuk logout yang membuat token lama mendapat HTTP 401.

## 6. Gate yang masih membutuhkan TEST/STAGING nyata

Belum diklaim PASS di environment ini:

- `npm ci` selesai penuh dari registry;
- NestJS/Prisma production build;
- empat Next.js production build;
- PostgreSQL bootstrap seed nyata;
- full staging E2E dan visual browser QA;
- 2 API + 2 worker concurrency;
- webhook response-loss receiver test;
- load/index profile pada data representatif;
- PostgreSQL backup/restore rehearsal dan cutover/rollback.

Begitu registry/dependency tersedia di TEST/STAGING, jalankan gate tersebut dan hanya perbaiki defect yang benar-benar muncul.


## 7. DR and webhook integrity hardening

A follow-up destructive-recovery rehearsal found three additional local safety defects and closed them without schema changes:

- restore target isolation now compares canonical SQLite paths and normalized PostgreSQL host/port/database identity, not raw URL strings;
- SQLite backup fails closed if WAL/rollback-journal data is present or the main database changes during copy; a real proof showed the previous checksum-valid copy could omit a committed WAL row;
- webhook endpoint custom headers cannot collide case-insensitively with Toko360 content type, user agent, event/delivery id, `Idempotency-Key`, or signature headers.

Post-fix focused regression is **20/20 PASS** and the full dependency-free suite is **337/337 PASS**. These local proofs do not replace the remaining real PostgreSQL/webhook/multi-instance runtime gates.

## Local demo seed UUID correction — 2026-09-11

The local/demo company ID is deterministic and must also satisfy the same UUID version/variant guard applied by `seed.ts`. The canonical demo ID is `00000000-0000-4000-8000-000000000001`. A failed validation occurs before `main()`, so a checkout that already completed dependency installation and `db push` may continue directly with `npm run db:local:seed`.

## Local API TypeScript compile correction — 2026-09-11

Real Windows startup progressed past dependency install, SQLite generation/push, and frontend serving, then exposed seven API compile errors. The fixes keep runtime behavior intact while aligning strict TypeScript and generated Prisma types:

- maintenance-parts JSON context uses Prisma JSON-safe object types;
- Nest rate limiting returns explicit HTTP 429 without an unavailable exception export;
- the Express bootstrap is typed as `NestExpressApplication` before `useBodyParser`;
- conditional order account maps are concrete string records;
- `PayrollPayment.settlementAccountCode` and `accountingEventId` are aligned across canonical/SQLite/PostgreSQL schemas;
- offline receipt payload uses an explicit strict-TypeScript Prisma JSON cast.

The existing checkout must regenerate Prisma Client and run SQLite `db push` before rebuilding the API. Jalur canonical sekarang adalah `node --test tests/api-local-compile-regression.test.mjs && npm run db:local:generate && npm run db:local:push && npm run build -w @toko360/api`, tanpa reinstall dependency. The added payroll fields are nullable; no local database reset is required. Focused regression is **7/7 PASS** and full dependency-free regression is **350/350 PASS**. Real corrected API build remains a user-local runtime gate.

