# Profil Database Toko360

Toko360 memiliki dua schema Prisma yang menjaga model domain tetap sama tetapi memakai connector berbeda.

## 1. SQLite Lokal

File schema:

```text
apps/api/prisma/schema.sqlite.prisma
apps/api/prisma/schema.prisma
```

Environment:

```text
.env.local.example
DATABASE_PROFILE=sqlite
DATABASE_URL=file:./data/toko360.db
```

Kegunaan:

- pengembangan lokal;
- demonstrasi;
- UI/UX development;
- unit dan integration test ringan;
- komputer tanpa database server;
- pekerjaan offline satu developer.

Batas penggunaan:

- bukan pilihan utama untuk banyak API server menulis bersamaan;
- concurrency tinggi dan multi-server production menggunakan PostgreSQL;
- backup dilakukan pada file database ketika proses penulis dihentikan atau melalui mekanisme backup SQLite yang aman.

Perintah:

```bash
npm run profile:local
npm run db:local:generate
npm run db:local:push
npm run db:local:seed
npm run db:local:studio
```

## 2. PostgreSQL Staging/Production

File schema:

```text
apps/api/prisma/schema.postgresql.prisma
```

Environment:

```text
.env.postgres.example
NODE_ENV=staging
DATABASE_PROFILE=postgresql
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
SEED_MODE=bootstrap
SEED_COMPANY_ID=<UUID>
SEED_COMPANY_NAME=<nama perusahaan>
SEED_COMPANY_SLUG=<slug unik>
SEED_BRANCH_CODE=PUSAT
SEED_BRANCH_NAME=<nama cabang>
SEED_WAREHOUSE_CODE=GDG-UTAMA
SEED_WAREHOUSE_NAME=<nama gudang>
SEED_ADMIN_EMAIL=<email admin bootstrap>
SEED_ADMIN_PASSWORD=<password kuat minimal 14 karakter>
```

PostgreSQL default ke `bootstrap`; staging/production menolak `SEED_MODE=demo`. Bootstrap tidak membuat produk, supplier, stok awal, kasir, atau karyawan contoh.

Kegunaan:

- staging;
- production;
- multi-server;
- concurrency transaksi tinggi;
- integrasi reporting dan backup terkelola.

Perintah:

```bash
npm run profile:postgres
# edit .env
npm run db:postgres:generate
npm run db:postgres:push
npm run db:postgres:seed
npm run db:postgres:studio
```

Pada production gunakan migration terversi, bukan `db push` sebagai proses deployment permanen.

## Validasi dan Generate Schema Tanpa Mengganti Profile Aktif

`prisma validate` dan `prisma generate` tidak membuka koneksi database. Karena itu perintah schema-only berikut aman dijalankan saat `.env` lokal masih memakai SQLite:

```bash
npm run prisma:validate:sqlite -w @toko360/api
npm run prisma:validate:postgres -w @toko360/api
npm run prisma:generate:sqlite -w @toko360/api
npm run prisma:generate:postgres -w @toko360/api
```

Runner `scripts/run-prisma-schema-command.mjs` memakai `DATABASE_URL` yang sudah diberikan caller hanya bila providernya cocok. Jika tidak cocok, runner memakai URL placeholder non-koneksi sesuai provider dan **tidak menulis atau mengganti `.env`**. Ini membuat quality gate SQLite/PostgreSQL deterministik pada workstation lokal dan CI.

Operasi yang benar-benar menyentuh database (`db push`, `migrate`, `seed`, `studio`) **tidak** memakai placeholder. Untuk operasi tersebut pilih/inject profile dan credential yang benar lebih dahulu; staging/production tetap wajib memakai secret/environment terproteksi.

## Menjaga Kesamaan Schema

`npm run validate:repo` memastikan:

- nama dan urutan model SQLite sama dengan PostgreSQL;
- nama dan urutan enum sama;
- schema SQLite tidak memakai native annotation PostgreSQL;
- schema default tetap SQLite;
- seluruh model platform lanjutan tetap tersedia.

Setiap penambahan model atau field harus diterapkan ke kedua file schema. Pull request akan gagal di GitHub ketika struktur model berbeda.

## Strategi Migrasi Lokal ke Production

Data SQLite lokal dianggap data development, bukan sumber production. Untuk go-live:

1. Buat database PostgreSQL kosong.
2. Pilih profil PostgreSQL.
3. Buat migration production terversi.
4. Jalankan seed master minimum.
5. Jika data lokal perlu dipindahkan, gunakan script import/export yang memvalidasi ID, uang, stok, dan jurnal—jangan menyalin file SQLite menjadi database production.
