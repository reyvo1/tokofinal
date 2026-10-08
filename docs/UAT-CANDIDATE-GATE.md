# UAT Candidate Gate

Artifact hanya boleh disebut **UAT candidate** ketika evidence runtime berasal dari source fingerprint yang sama dan seluruh gate berikut PASS.

## 1. Production build gate

Siapkan `.env` NON-PRODUCTION yang benar, kemudian jalankan:

```bash
npm run build:gate
```

Default gate menjalankan deterministic `npm ci`, workflow/repository validation, lint, full regression, validasi + generate Prisma SQLite/PostgreSQL, dan production build API + worker + Storefront + Admin + POS + Employee Portal. Setelah build, gate membuat `handoff/quality/build-artifact-manifest-latest.json` yang menghitung SHA-256 agregat runtime output keenam aplikasi. Evidence build: `handoff/quality/build-gate-latest.json`.

Build gate **selalu** menjalankan installer deterministik berbasis `npm ci` dari lockfile. Tidak ada mode skip-install pada jalur kandidat UAT, sehingga evidence build tidak dapat berasal dari dependency tree yang dipasang dengan cara berbeda.

## 2. Payroll adjustment PostgreSQL staging migration

Salin `config/payroll-adjustment-postgres-stage.env.example` menjadi `payroll-adjustment-postgres-stage.env`, isi target TEST/STAGING dan confirmation token persis, lalu jalankan:

```bash
npm run db:payroll-adjustment:stage:postgres
```

Runner menolak production/live, mengikat host + database yang diharapkan, memvalidasi dan generate Prisma PostgreSQL, menerapkan migration expand-only secara transaksional, lalu memverifikasi kolom/index dan `PayrollPayment.direction`. Evidence: `logs/payroll-adjustment-postgres-stage/latest.json`.

Setelah schema migration, jalankan canonical seed/configuration yang disetujui untuk memastikan mapping `__PAYROLL_RECEIVABLE__` dan posting rule `PAYROLL_EMPLOYEE_RECOVERY` tersedia. Jangan mengarang atau mengganti chart of accounts staging tanpa approval.

## 3. Stage-19 current-source HTTP/DB integration

Siapkan `stage19-integration.env` untuk database staging yang sama, lalu jalankan:

```bash
npm run test:tenant:staging
```

Perintah ini sekarang mempersiapkan Prisma/API PostgreSQL lalu menjalankan integration gate. Evidence resmi Stage-19 diperbarui dengan `sourceIdentity` source saat ini. Stage-20 menolak evidence Stage-19 lama atau target database yang berbeda.

## 4. Built browser UAT

Dengan `.env` NON-PRODUCTION, DB yang sudah siap, hasil build yang sama, Chromium/Chrome, dan kredensial Admin UAT di environment:

```bash
export T360_UAT_ADMIN_EMAIL='<uat-admin>'
export T360_UAT_ADMIN_PASSWORD='<password>'
export T360_UAT_ENVIRONMENT=STAGING_UAT
export T360_UAT_EXPECTED_HOST='<host-staging>'
export T360_UAT_EXPECTED_DATABASE='<database-staging>'
npm run uat:browser:built
```

Runner memuat target DB efektif dari `.env` + environment, menolak NODE_ENV/database production/live, memerlukan expected host/database untuk PostgreSQL, memverifikasi ulang build-artifact manifest, lalu menyalakan keenam runtime process dengan `T360_BUILD_ARTIFACT_ID` yang sama dan menjalankan browser gate nyata sebelum mematikannya kembali. Evidence browser: `handoff/quality/browser-uat-latest.json` dan wrapper: `handoff/quality/built-browser-uat-latest.json`.

## 5. Stage-20 + human UAT

Siapkan `stage20-release-readiness.env` dan `stage20-uat-results.json`. Stage-20 sekarang mensyaratkan **12** skenario kritis, termasuk:

- `UAT-11-DELIVERY-LIFECYCLE`;
- `UAT-12-PAYROLL-ADJUSTMENT-RECOVERY`.

Jalankan:

```bash
npm run release:readiness:staging
```

Perintah ini memvalidasi/generate Prisma PostgreSQL, menerapkan critical indexes, menggunakan artifact build yang sudah dimanifestkan, lalu menjalankan observability/query-plan/UAT gate. Stage-20 menolak berjalan bila payroll-adjustment migration evidence belum PASS untuk **source fingerprint, build artifact, dan database target yang sama**.

## 6. Final candidate verification

```bash
npm run uat:candidate:verify
```

Verifier membutuhkan build gate PASS, **build-artifact manifest PASS**, built-browser wrapper PASS, inner browser UAT PASS, dan Stage-20 + human UAT PASS pada source fingerprint **dan build artifact ID yang sama**. Browser evidence yang diperoleh dari dev/external stack tanpa wrapper enam process hasil build tidak memenuhi syarat kandidat UAT. Verifier juga mewajibkan target PostgreSQL built-browser memiliki hash host/database yang sama dengan Stage-20, sehingga browser PASS dari database lokal/target lain tidak dapat digabungkan dengan evidence staging. `PASS` berarti **UAT candidate / release-ready non-production**, bukan production-ready dan bukan izin deploy production.


## CI naming safety

Workflow `.github/workflows/release-candidate.yml` hanya membuktikan build + built-browser runtime gate. Karena Stage-20 dan human UAT tidak dijalankan di workflow tersebut, artifact CI sengaja diberi nama **`toko360-runtime-uat-gate`**, bukan `release-candidate`. Hanya `npm run uat:candidate:verify` setelah Stage-20 PASS yang boleh menetapkan artifact sebagai kandidat UAT.
