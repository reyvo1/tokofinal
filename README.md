# Toko360 Enterprise Workflow Platform 0.5.3

Platform modular untuk toko online, POS, supplier, gudang, pembayaran, akuntansi dan perpajakan lintas sistem, HR/payroll, aset, armada pengiriman, inspeksi barang, approval, serta otomatisasi operasional yang dapat diaktifkan secara dinamis.

## Prinsip Instalasi

**Komputer pengembang tidak memerlukan Docker atau mesin virtual.** Profil lokal bawaan menggunakan SQLite yang tersimpan sebagai satu file di `apps/api/prisma/data/toko360.db`. PostgreSQL tetap tersedia untuk staging/production dan diuji otomatis di GitHub Actions melalui service container milik runner GitHub.

## Isi Repository

- `apps/api`: NestJS API, Prisma, SQLite/PostgreSQL, Swagger.
- `apps/worker`: outbox, webhook delivery, dan notification worker berbasis database polling.
- `apps/storefront`: website pelanggan.
- `apps/customer-mobile`: starter Flutter aplikasi pelanggan.
- `apps/admin`: dashboard admin dan runtime module catalog.
- `apps/pos`: kasir web.
- `apps/employee-portal`: portal absensi, slip gaji, dan layanan mandiri karyawan.
- `packages/contracts`: kontrak data lintas aplikasi.
- `packages/config`: daftar feature keys.
- `packages/plugin-sdk`: kontrak adapter payment, shipping, marketplace, notification, fingerprint, accounting export, tax, vehicle telemetry, dan custom.
- `docs/DEVELOPMENT-KIT.md`: Development Kit lengkap bagian 1–44.
- `docs/LOCAL-NO-DOCKER.md`: panduan lokal tanpa Docker.
- `docs/DATABASE-PROFILES.md`: profil SQLite dan PostgreSQL.
- `docs/CI-TESTING.md`: pengujian otomatis GitHub.

## Kemampuan Utama

### Core

- Login JWT, role, permission, dan audit log.
- Produk, supplier, pengguna, cabang, gudang, dan stok.
- Purchase order dan penerimaan barang supplier.
- Penerimaan atomik: stok, movement, status PO, utang, jurnal, dan audit.
- POS/sales, online order, pembayaran dasar.
- Jurnal double-entry dan laporan sederhana.

### Fleksibilitas Platform

- Feature flag per perusahaan/cabang/user.
- Settings bertingkat.
- Dynamic module catalog dan navigation.
- Custom fields untuk semua entity.
- Server-driven UI schema.
- Configurable business rules.
- Approval policy/request/decision.
- Integration connections, external mappings, dan API keys.
- Transactional outbox dan webhook.
- Plugin SDK agar provider dapat diganti tanpa mengubah core.
- Dua profil database dengan model yang sama: SQLite lokal dan PostgreSQL produksi.


### Enterprise Accounting, Tax, Assets, Fleet, and Controls

- Accounting event dan posting rules untuk seluruh domain, bukan hanya payroll.
- Tax code/transaction/document berversi untuk penjualan, pembelian, biaya, aset, fleet, retur, dan payroll.
- Transaksi biaya, pendapatan lain, penerimaan/pembayaran, serta mutasi kas/bank generik.
- Aset bergerak/tidak bergerak, penyusutan, assignment, maintenance, dan disposal foundation.
- Kendaraan pengiriman, driver, trip, stop, manifest, loading scan, BBM, odometer, gate pass, dan proof of delivery.
- Pemeriksaan inbound/outbound, foto/dokumen evidence, multi-confirmation, mismatch, batch/serial, dan policy per cabang.
- Retur penjualan/pembelian dengan pemeriksaan, stock movement, pembalik accounting, dan pembalik pajak.
- Business rules, automation jobs, outbox, webhook, retry, dan adapter provider.

## Instalasi Lokal Tanpa Docker

### Ubuntu / Linux (jalur utama)

1. Instal Node.js 22 LTS atau minimal 20.9.
2. Ekstrak repository dan buka terminal di root proyek.
3. Jalankan:

```bash
npm run setup
npm run dev
```

Launcher `.cmd`/PowerShell lama sudah dihapus; seluruh workflow lokal memakai npm/Node/Bash.

Perintah setup otomatis:

1. Membuat `.env` lokal.
2. Memverifikasi registry/DNS lalu menjalankan `npm ci` dari `package-lock.json`.
3. Membuat Prisma Client untuk SQLite.
4. Membuat database lokal.
5. Mengisi data awal.
6. Menjalankan validasi dan smoke test.

Akses aplikasi:

- Storefront: http://localhost:3000
- Admin: http://localhost:3001
- POS: http://localhost:3002
- API: http://localhost:4000/api/v1
- Swagger: http://localhost:4000/docs
- Employee portal: http://localhost:3003

Login demo:

```text
admin@toko360.local
Admin123!
```

Ganti password dan `JWT_SECRET` sebelum penggunaan publik.

## Mulai Pekerjaan Otomatis

Setelah setup selesai, gunakan perintah terminal berikut. `npm run work:auto` memilih pekerjaan roadmap berikutnya yang dependency-nya telah siap, membuat work item, branch Git, `TASK.md`, checklist, prompt pelaksana, dan handoff sesi.


```bash
npm run work:auto
npm run work:custom
npm run work:resume
npm run work:status
```

Rincian: `docs/AUTOMATED-WORK-STARTER.md`.

## Perintah Lokal

```bash
npm run dev                 # menjalankan seluruh aplikasi
npm run db:local:studio     # membuka Prisma Studio untuk SQLite
npm run db:local:reset      # menghapus dan membuat ulang database lokal
npm run validate:repo       # memeriksa struktur repository
npm test                    # menjalankan test konfigurasi dan workspace
npm run build               # build seluruh aplikasi
```

## Profil Database

### SQLite — default lokal

```bash
npm run profile:local
npm run db:local:prepare
```

Tidak perlu memasang server database. Database berupa file lokal dan cocok untuk pengembangan satu komputer, demo, serta pengujian fitur.

### PostgreSQL — staging/production

```bash
npm run profile:postgres
# Edit DATABASE_URL dan seluruh SEED_* bootstrap di .env sesuai server PostgreSQL
# PostgreSQL default memakai SEED_MODE=bootstrap; data demo tidak dibuat.
npm run db:postgres:prepare
```

PostgreSQL tidak wajib dipasang di komputer pengembang. Profil ini dapat diarahkan ke server database jaringan, layanan cloud, staging, atau production.

## Docker Hanya untuk GitHub

Tidak ada `docker-compose.yml` di root dan tidak ada perintah Docker pada setup lokal. File container hanya berada di `.github/ci/` untuk validasi konfigurasi dan integration test GitHub. Workflow menguji:

- struktur repository;
- profil SQLite tanpa Docker;
- profil PostgreSQL dengan service container GitHub;
- seed dan smoke test database;
- build seluruh aplikasi.

## Endpoint Dinamis dan Lanjutan

```text
GET/POST /api/v1/platform/features
GET/POST /api/v1/platform/settings
GET/POST /api/v1/platform/custom-fields
GET/POST /api/v1/platform/integrations
GET/POST /api/v1/platform/webhooks
GET/POST /api/v1/platform/business-rules
GET/POST /api/v1/platform/approval-policies
GET/POST /api/v1/platform/approval-requests

GET/POST/PATCH /api/v1/stock-transfers
GET/POST/PATCH /api/v1/stock-opnames
GET/POST /api/v1/inventory-batches
GET/POST /api/v1/inventory-serials
GET/POST/PATCH /api/v1/sale-returns
GET/POST/PATCH /api/v1/purchase-returns
GET/POST /api/v1/loyalty/*
GET/POST/PATCH /api/v1/finance/*
GET/POST /api/v1/devices/*
GET/POST /api/v1/forecasts/*
GET/POST /api/v1/shipments
GET/POST /api/v1/marketplace-orders/*
GET/POST /api/v1/notifications

GET/POST /api/v1/accounting-core/tax-codes
GET/POST /api/v1/accounting-core/posting-rules
GET/POST /api/v1/finance-operations
POST /api/v1/finance-operations/{id}/approve
POST /api/v1/finance-operations/{id}/post
GET/POST /api/v1/assets/*
GET/POST /api/v1/fleet/*
GET/POST /api/v1/operations-control/*
GET/POST /api/v1/returns/*
```

## Membuat Modul Baru

```bash
npm run new:module -- promotions
```

Daftarkan module baru di `AppModule`, schema, permission, feature flag, module catalog, test, dan dokumentasi sesuai `docs/EXTENSION-GUIDE.md`.

## Push ke GitHub

Gunakan terminal Git pada Ubuntu/Linux:

```bash
git init
git add .
git commit -m "feat: initialize Toko360 modular platform"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

Setelah push, tab **Actions** di GitHub akan menjalankan pengujian SQLite dan PostgreSQL secara otomatis.


## Dokumentasi Enterprise 0.5

- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
- `docs/ASSET-FLEET-OPERATIONS.md`
- `docs/INBOUND-OUTBOUND-CONTROL.md`
- `docs/AUTOMATION-RULEBOOK.md`

## Batas Starter

Repository ini adalah fondasi pengembangan, bukan aplikasi final tersertifikasi. Sebelum produksi diperlukan migration terversi, isolation review, concurrency test, secret manager, provider integrations, monitoring, backup/restore drill, load test, dan security audit. Redis/queue dapat ditambahkan pada produksi tanpa menjadi persyaratan lokal.

## Menangani jutaan data

Versi 0.3.3 menambahkan development kit skala besar:

- cursor pagination pada endpoint inti;
- indeks transaksi dan ledger;
- fondasi idempotency receipt;
- daily sales/finance/inventory summaries;
- asynchronous report jobs;
- retention dan archive run;
- performance budget;
- load-test script tanpa dependency tambahan;
- template partitioning PostgreSQL;
- GitHub Actions performance smoke manual.

Baca `docs/LARGE-SCALE-DATA.md` dan `docs/PERFORMANCE-CHECKLIST.md`. Fitur tersebut merupakan fondasi dan standar pengembangan; kapasitas production tetap harus dibuktikan melalui load test pada hardware dan pola data yang digunakan.

Uji health endpoint setelah API berjalan:

```bash
npm run test:load:health
```

Contoh kustom:

```bash
node scripts/load-test.mjs --url http://127.0.0.1:4000/api/v1/health --requests 5000 --concurrency 100
```

## Workflow pengembangan

Repository ini memakai workflow yang terhubung langsung dengan Development Kit.

```bash
npm run workflow:new -- feature nama-fitur --module inventory --wave W1 --risk HIGH
npm run workflow:status
npm run quality:fast
npm run quality:full
```

Baca sebelum mengubah source code:

- `CONTRIBUTING.md`
- `docs/DEVELOPMENT-WORKFLOW.md`
- `docs/IMPLEMENTATION-ROADMAP.md`
- `docs/QUALITY-GATES.md`
- `docs/PROJECT-CHECKPOINTS.md`

GitHub akan memeriksa manifest pekerjaan, format branch/PR, schema parity, test SQLite/PostgreSQL, build, dan release candidate artifact.

Jalur canonical Ubuntu/Linux:

```bash
npm run work:custom
npm run workflow:validate
npm run quality:recorded:fast
npm run quality:recorded:full
```

Untuk perpindahan sesi atau developer, gunakan `docs/SESSION-HANDOFF.md` dan selalu sebutkan checkpoint pada `docs/PROJECT-STATE.md`.

Pengaturan branch protection, status checks, environment, label, dan strategi merge dijelaskan di `docs/GITHUB-SETUP.md`.

## Pindah akun atau chat tanpa kehilangan konteks

Untuk chat baru pada akun yang sama jalankan `npm run chat:handoff`. Untuk akun baru, jalankan `npm run chat:system` untuk menyalin instruksi sistem lalu `npm run chat:handoff` untuk membuat checkpoint ZIP dan chat pertama dinamis.

Dokumentasi: `docs/CHAT-HANDOFF-AUTOMATION.md`.
