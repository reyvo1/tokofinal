# Toko360 Development Kit

Dokumen ini adalah acuan produk, UI/UX, backend, frontend, mobile/POS, database, QA, DevOps, keamanan, dan pengembangan lanjutan. Repository dirancang modular sehingga fitur dapat diaktifkan per perusahaan/cabang melalui feature flag tanpa mengubah modul inti.

## 1. Gambaran Umum

Toko360 menghubungkan website pelanggan, POS, dashboard admin, supplier, pembelian, penerimaan barang, multi-gudang, pembayaran, pengiriman, CRM, loyalitas, dan akuntansi dalam satu platform. Semua transaksi memakai API dan database terpusat; POS offline memakai antrean sinkronisasi idempoten.

## 2. Tujuan

- Pemesanan pelanggan melalui web atau kanal eksternal.
- Transaksi kasir cepat dengan barcode, diskon, split payment, dan struk.
- Stok real-time per cabang, gudang, lokasi, batch, dan serial.
- Pembelian supplier, penerimaan, retur, utang, dan jurnal otomatis.
- Pemasukan, pengeluaran, piutang, utang, rekonsiliasi, dan laporan.
- Role, permission, approval, audit log, dan keamanan.
- Penambahan modul/provider tanpa mengubah core domain.

## 3. Platform

1. **Storefront**: katalog, keranjang, checkout, pembayaran, pengiriman, akun pelanggan.
2. **Admin**: master data, pembelian, gudang, keuangan, konfigurasi, integrasi, laporan.
3. **POS**: kasir web/PWA; dapat dikembangkan menjadi Flutter/Electron.
4. **API**: NestJS, Prisma, SQLite untuk lokal tanpa Docker, PostgreSQL untuk staging/production, dan Swagger.
5. **Worker**: outbox, webhook delivery, notification, marketplace sync, offline sync, forecasting.
6. **Plugin SDK**: kontrak provider payment, shipping, marketplace, notification, accounting, dan custom.

## 4. Arsitektur

```text
Storefront ─┐
Admin ──────┼── API Gateway / NestJS ── SQLite lokal / PostgreSQL produksi
POS ────────┤            │
Mobile ─────┤            ├── Database-polling worker lokal / Queue production
Marketplace ┤            ├── Object Storage
Provider ───┘            ├── Event Outbox/Webhook
                         └── Plugin Adapters
```

Prinsip:

- Modular monolith dahulu, dapat dipisah menjadi service kemudian.
- Database transaction untuk stok dan jurnal.
- Transactional outbox untuk integrasi yang andal.
- Idempotency untuk webhook, pembayaran, dan POS offline.
- Feature flag dan settings bertingkat.
- Custom field dan UI schema untuk kebutuhan bisnis berbeda.
- Provider-neutral adapter.

## 5. Pengguna dan Role

Role awal: `SUPER_ADMIN`, `OWNER`, `ADMIN`, `CASHIER`, `WAREHOUSE`, `PURCHASING`, `FINANCE`, `AUDITOR`. Role baru dapat ditambahkan dari database. Permission granular menggunakan format `domain.action`, misalnya `inventory.adjust`, `sale.refund`, `finance.close_period`, `integration.manage`.

## 6. Autentikasi

- Login JWT, refresh token pada pengembangan berikutnya.
- Reset password, verifikasi email/telepon, 2FA.
- Sesi perangkat, revoke token, rate limit, lockout.
- API key dengan scope untuk integrasi.
- Audit login dan perubahan hak akses.

## 7. Master Data

Produk, varian, kategori, merek, satuan, konversi satuan, barcode, harga per cabang/segmen, supplier, pelanggan, cabang, gudang, lokasi rak/bin, bank, akun keuangan, pajak, kurir, dan metode pembayaran.

Produk memiliki pengaturan `productType`, `trackBatch`, `trackSerial`, `allowNegativeStock`, `metadata`, dan custom fields.

## 8. Website Pelanggan

- Home, banner, kategori, rekomendasi.
- Pencarian/filter/sort.
- Detail produk dan varian.
- Keranjang dan voucher.
- Checkout, alamat, pickup/delivery.
- Payment gateway melalui adapter.
- Riwayat, tracking, retur, favorit, ulasan, poin.
- Runtime manifest untuk menampilkan fitur sesuai konfigurasi.

## 9. POS

- Scan barcode, pencarian, kategori cepat.
- Hold/recall, customer, diskon, pajak.
- Tunai, QRIS, transfer, kartu, voucher, poin, split payment.
- Shift, modal awal, kas masuk/keluar, closing, selisih.
- Retur/refund dengan approval.
- Printer, cash drawer, display, timbangan melalui adapter/device bridge.
- Offline queue dengan `Device` dan `OfflineTransaction`.

## 10. Pesanan

Status dapat dikonfigurasi tetapi status inti meliputi pending payment, paid, processing, packed, shipped, completed, cancelled, returned, refunded. Pesanan menyimpan kanal, gudang pemroses, reservasi stok, pembayaran, shipment, dan external mapping.

## 11. Stok dan Gudang

- Stok `quantity`, `reserved`, `available`.
- Inventory movement sebagai ledger tunggal.
- Multi-gudang dan lokasi penyimpanan.
- Transfer stok dengan request, approval, ship, partial receive, receive.
- Stock opname dengan snapshot, count, approval, adjustment.
- Batch, produksi, kedaluwarsa, FIFO/FEFO.
- Serial number.
- Stok rusak, karantina, hilang, dalam perjalanan.
- Peringatan stok minimum dan reorder suggestion.

## 12. Pembelian dan Supplier

- Purchase request.
- Purchase order.
- Approval bertingkat.
- Goods receipt parsial.
- Jumlah baik/rusak, batch, expiry, invoice, surat jalan.
- Stok dan utang terbentuk atomik.
- Purchase return dan debit note.
- Riwayat harga supplier dan lead time.

## 13. Pembayaran

- Tunai, transfer manual, virtual account, QRIS, e-wallet, kartu, COD, piutang, voucher, poin.
- Adapter provider di `packages/plugin-sdk`.
- IntegrationConnection menyimpan konfigurasi dan secret terenkripsi.
- Callback/webhook harus diverifikasi, idempoten, dan dicatat.
- Refund penuh/sebagian.
- Rekonsiliasi pembayaran.

## 14. Promosi dan Loyalitas

- Persentase, nominal, bundle, quantity break, BOGO, segment pricing.
- Voucher dengan masa berlaku, quota, minimum, channel, dan produk.
- Loyalty program, account, tier, earn, redeem, adjustment, expiry, refund.
- Business rule memungkinkan promosi baru tanpa hard-code seluruh alur.

## 15. Keuangan

- Chart of accounts.
- Double-entry journal.
- Kas/bank, pemasukan/pengeluaran, piutang/utang.
- Harga pokok, persediaan, penjualan, refund.
- Fiscal period: open, soft closed, closed.
- Rekonsiliasi bank.
- Cost center dan laporan per cabang.
- Approval pengeluaran.

## 16. Laporan

Penjualan, produk, kasir, kanal, pelanggan, diskon, retur, stok, mutasi, batch, expiry, opname, pembelian, supplier, utang/piutang, laba rugi, neraca, arus kas, jurnal, buku besar, perputaran stok, margin, cabang, dan audit log. Ekspor PDF/Excel/CSV diletakkan sebagai adapter/report worker.

## 17. Dashboard

Dashboard owner, kasir, gudang, purchasing, finance, dan customer service. Layout dapat dikontrol lewat `UiSchemaDefinition`, sehingga widget dan navigasi dapat berbeda per perusahaan/cabang.

**UI-P1 Admin shell (2026-09-22):** Admin sekarang mempunyai canonical workspace routes, sidebar collapsible/searchable, breadcrumb, company/branch context, serta navigation resolver yang menggabungkan ModuleDefinition, effective feature flags, JWT role/permission visibility, dan `UiSchemaDefinition` surface `admin`. Business authorization tetap fail-closed di API.

## 18. Notifikasi

`NotificationTemplate` dan `Notification` mendukung email, WhatsApp, SMS, push, dan in-app. Pengiriman melalui adapter dan worker, dengan retry, status, dan error log.

## 19. Database Inti

Kelompok tabel:

- Identity: users, roles, permissions, API keys.
- Organization: companies, branches, warehouses, locations, devices.
- Catalog: products, categories, prices, barcode, custom fields.
- Procurement: suppliers, PO, receipts, returns.
- Inventory: balances, movements, transfer, opname, batch, serial.
- Commerce: carts, orders, sales, returns, shipment, marketplace order.
- Payment: payments, provider references, refunds, reconciliation.
- Finance: accounts, journal entries/lines, fiscal periods, bank statements.
- Platform: flags, settings, modules, UI schemas, rules, approvals, integrations, webhooks, outbox.
- Analytics: forecast runs and reorder suggestions.

## 20. Aturan Database

- UUID untuk ID internal.
- Nomor dokumen user-facing terpisah.
- Soft delete untuk master data; transaksi tidak dihapus.
- Foreign key atau validasi service untuk referensi penting.
- Decimal untuk uang; jangan gunakan float.
- Timestamp dan audit.
- Unique/idempotency keys untuk event eksternal.
- Row locking/serializable transaction pada stok.
- Debit harus sama dengan kredit.
- Secret tidak disimpan plaintext di produksi.

## 21. Nomor Dokumen

`NumberSequence` mendukung format dinamis per perusahaan/cabang, prefix, padding, dan reset harian/bulanan/tahunan. Contoh: `POS-PUSAT-202607-000001`, `GRN-202607-000001`, `TRF-202607-000001`.

## 22. API

API menggunakan `/api/v1`, Swagger di `/docs`. Modul lanjutan meliputi:

- `/platform/manifest`, flags, settings, custom fields, UI schemas, integrations, webhooks, rules, approvals.
- `/stock-transfers`, `/stock-opnames`.
- `/inventory-batches`, `/inventory-serials`.
- Canonical returns: `/returns/sales*`, `/returns/purchases*`, `/returns/orders*`; legacy `/sale-returns*` and `/purchase-returns*` are removed after P4 compatibility verification.
- `/loyalty/*`.
- `/finance/fiscal-periods`, bank statements, reconciliations.
- `/devices/:id/offline-transactions`.
- `/forecasts/run`.
- `/shipments`, `/marketplace-orders/import`, `/notifications`.

## 23. Struktur Project

```text
apps/api          API dan Prisma
apps/worker       asynchronous outbox/webhook/notification processor
apps/storefront   website pelanggan
apps/customer-mobile starter Flutter pelanggan
apps/admin        dashboard admin
apps/pos          POS web
packages/contracts kontrak data lintas aplikasi
packages/config    feature keys dan shared configuration
packages/plugin-sdk kontrak integrasi provider
docs               development kit dan panduan
scripts            setup lokal tanpa Docker, profile database, validation, push GitHub
```

## 24. Teknologi

- TypeScript, NestJS, Next.js, Prisma, SQLite lokal, dan PostgreSQL staging/production.
- Worker lokal menggunakan database polling; Redis/BullMQ bersifat adapter opsional untuk produksi.
- Flutter/Electron dapat menggunakan API/contracts yang sama.
- Docker hanya untuk validasi GitHub/deployment; Nginx, CI/CD, Sentry, Prometheus/Grafana, dan object storage bersifat deployment concern.

## 24A. Profil Pengembangan Tanpa Docker

- Komputer developer hanya memerlukan Node.js dan npm.
- SQLite menjadi database lokal bawaan dalam satu file.
- Worker lokal memakai polling database dan tidak membutuhkan Redis.
- PostgreSQL dipilih melalui profil terpisah untuk staging/production.
- Schema SQLite dan PostgreSQL harus memiliki model dan enum yang sama.
- GitHub Actions menguji kedua profil; container hanya berjalan pada runner GitHub.
- File `docker-compose.yml` tidak ditempatkan di root agar tidak menjadi ketergantungan lokal.
- Ubuntu/Linux memakai `npm run setup`, `npm run dev`, dan `npm run db:local:reset` sebagai jalur canonical; launcher OS khusus tidak diperlukan.

## 25. Keamanan

HTTPS, Argon2/bcrypt, JWT pendek, refresh rotation, 2FA, RBAC/ABAC, validation, CORS, CSRF untuk cookie, CSP, rate limit, webhook signature, encrypted secrets, audit log, backup terenkripsi, least privilege, dependency scanning, SAST/DAST, dan penetration test sebelum go-live.

## 26. POS Offline

- Device terdaftar.
- Local transaction memiliki `localId` dan sequence unik.
- Server menerima secara idempoten.
- Worker memvalidasi versi harga, stok, dan permission.
- Konflik disimpan, tidak ditimpa diam-diam.
- Pembayaran online tetap memerlukan koneksi/provider.

## 27. Alur Website

Produk → keranjang → validasi harga/stok → reservasi → order → payment → picking → packing → shipment/pickup → completion → loyalty/journal/event.

## 28. Alur POS

Open shift → scan → pricing/promotion → customer → payment → sale transaction → stock ledger → journal → receipt → outbox/notification.

## 29. Aturan Bisnis

- Tidak menjual stok kosong kecuali flag mengizinkan.
- Semua perubahan stok melalui movement.
- Retur mengacu transaksi asli atau memiliki approval pengecualian.
- Transaksi selesai tidak dihapus; gunakan reversal.
- Periode tertutup tidak menerima jurnal baru.
- Diskon/refund/pengeluaran besar mengikuti approval policy.
- Reservasi dilepas saat order expired/cancelled.
- Akses dibatasi perusahaan/cabang/role.

## 30. MVP

Core yang tersedia: auth, role dasar, produk, supplier, PO, goods receipt, stok, POS/sales, storefront/order, pembayaran dasar, jurnal, laporan sederhana, audit, SQLite lokal tanpa Docker, PostgreSQL profile, Swagger, dan GitHub CI.

## 31. Pengembangan Tahap Lanjutan

Seluruh fondasi berikut sudah dimasukkan ke schema, API, feature flag, module catalog, atau plugin contract:

1. Multi-cabang.
2. Multi-gudang.
3. Payment gateway adapter.
4. Marketplace adapter dan staging order.
5. Shipping adapter dan shipment.
6. WhatsApp/notification adapter.
7. Customer app melalui API/runtime manifest.
8. POS offline device queue.
9. Batch dan kedaluwarsa.
10. Serial number.
11. Loyalty dan membership.
12. Akuntansi lanjutan dan fiscal period.
13. Rekonsiliasi bank.
14. Approval bertingkat.
15. Forecasting.
16. Reorder suggestion.
17. Business intelligence data foundation.
18. Timbangan/device adapter.
19. Third-party API/plugin SDK.
20. Transfer antar gudang.
21. Stock opname.
22. Retur penjualan.
23. Retur pembelian.
24. Custom field.
25. Server-driven UI.
26. Business rules.
27. Webhook/outbox.
28. API keys.
29. Dynamic numbering.
30. Feature flags/settings.
31. External mappings.

Provider eksternal tidak dapat aktif tanpa akun, credential, SDK, dan aturan bisnis provider yang dipilih; repository menyediakan kontrak dan titik pemasangannya.

## 32. Tim

Product manager, analyst, UI/UX, backend, frontend, POS/mobile, QA, DevOps/SRE, security, data/BI, dan finance domain reviewer. Gunakan CODEOWNERS dan review wajib untuk inventory/finance/security.

## 33. Acceptance Criteria

- Order web dan sale POS tercatat.
- Stok dan jurnal konsisten.
- Goods receipt menambah stok dan utang.
- Transfer/opname menghasilkan movement.
- Retur memperbarui stok dan event.
- Feature flag mengontrol modul.
- Custom fields dapat ditambahkan tanpa migration.
- Provider baru mengikuti plugin contract.
- Audit dan approval tersedia.
- Build/test/migration berjalan di CI.

## 34. Test Case

Unit test business rules; integration test database transaction; contract test plugin; E2E storefront/POS; concurrency test stok; idempotency webhook/offline; permission test; financial balance test; migration test; load test; backup restore test; security test.

## 35. Deliverables

Development kit, ERD/schema SQLite dan PostgreSQL, API/Swagger, source code aplikasi, plugin SDK, seed, local no-Docker setup, CI container validation, test strategy, deployment guide, security guide, extension guide, runtime configuration, dan production checklist.

## 36. Kesimpulan

Toko360 merupakan fondasi platform commerce yang dapat tumbuh dari satu toko menjadi multi-cabang dan multi-kanal. Fleksibilitas dicapai melalui modul terpisah, feature flags, settings, custom fields, UI schema, business rules, approval, events, dan adapter provider; bukan melalui satu kode besar yang sulit diubah.

## 37. Arsitektur Data Skala Jutaan

Toko360 harus dirancang agar pertumbuhan data tidak memerlukan penulisan ulang aplikasi. Target desain meliputi ratusan ribu hingga satu juta produk, jutaan transaksi, serta puluhan sampai ratusan juta baris detail, movement, jurnal, audit, dan event.

### 37.1 Standar wajib

1. Production memakai PostgreSQL; SQLite hanya untuk development/perangkat tunggal darurat.
2. Semua endpoint daftar menggunakan cursor pagination dengan default 50 dan maksimum publik 100.
3. Tidak boleh ada query seluruh tabel tanpa limit pada request interaktif.
4. Pencarian barcode dan SKU menggunakan exact/prefix index; pencarian nama memakai indeks pencarian PostgreSQL.
5. Tabel transaksi utama memiliki indeks gabungan berdasarkan tenant/cabang, status, dan waktu.
6. Pengurangan stok dilakukan atomik dan memiliki retry untuk serialization/deadlock.
7. Semua mutasi penting memakai operation ID/idempotency key.
8. Nomor dokumen dibuat dari sequence atomik per cabang dan jenis dokumen, bukan angka acak.
9. Dashboard dan laporan historis memakai daily summary atau agregasi SQL.
10. Ekspor/import besar berjalan melalui worker secara streaming/chunked.
11. Tabel append-only besar disiapkan untuk partitioning waktu ketika volume menuntut.
12. Outbox, webhook, notification, dan log teknis memiliki retention dan cleanup policy.
13. Server pusat dan toko menyinkronkan movement/event menggunakan batch, checkpoint, receipt, dan conflict queue.
14. Connection pooling, query timeout, slow-query logging, dan monitoring wajib di production.
15. Setiap fitur baru harus melewati concurrency test, pagination test, dan load test relevan.

### 37.2 Tingkat skala

| Tingkat | Produk | Transaksi | Detail/ledger/jurnal | Strategi utama |
|---|---:|---:|---:|---|
| Awal | sampai 10 ribu | sampai 100 ribu | sampai 1 juta | indeks, pagination, backup |
| Berkembang | sampai 100 ribu | sampai 5 juta | sampai 50 juta | summary, worker, pooling, retention |
| Besar | sampai 1 juta | 50 juta+ | 500 juta+ | partitioning, replica, archive, reporting store |

Angka ini merupakan target arsitektur, bukan jaminan performa. Kapasitas aktual harus dibuktikan melalui benchmark pada infrastruktur yang akan digunakan.

### 37.3 Data lifecycle

- **Hot:** transaksi baru dan data aktif, indeks lengkap serta akses cepat.
- **Warm:** data historis yang masih sering dipakai untuk laporan.
- **Cold:** arsip terenkripsi yang dapat dipulihkan untuk audit/kepatuhan.

Transaksi dan jurnal tidak dihapus untuk koreksi; gunakan reversal. Log operasional yang sudah final dapat dibersihkan sesuai retention policy.

### 37.4 Reporting

Gunakan tabel agregat:

- `DailySalesSummary`;
- `DailyFinanceSummary`;
- `DailyInventorySummary`.

Worker memperbarui agregat secara incremental dan menjalankan rekonsiliasi berkala. Laporan besar dibuat melalui `ReportJob` agar request web tidak kehabisan memori atau timeout.

### 37.5 Definition of done skala besar

Fitur belum dianggap selesai jika:

- daftar belum dipaginasi;
- query belum tenant/cabang scoped;
- mutasi belum idempotent;
- belum ada indeks untuk filter utama;
- laporan menghitung seluruh tabel di memori aplikasi;
- data lifecycle belum ditentukan;
- belum ada metrik dan load test;
- proses berat masih berjalan langsung pada request kasir.

Rincian teknis, tahap implementasi, query budget, partisi, archiving, hybrid edge-central, dan skenario uji tersedia pada `docs/LARGE-SCALE-DATA.md`. Checklist pull request tersedia pada `docs/PERFORMANCE-CHECKLIST.md`.

## 38. HRIS, Absensi, Payroll, Akuntansi Gaji, dan Perpajakan

Toko360 menyediakan domain SDM sebagai modul terpisah yang tetap menggunakan perusahaan, cabang, user, role, approval, accounting, notification, outbox, dan plugin SDK yang sama.

### 38.1 Data karyawan

- Master karyawan, nomor induk, departemen, jabatan, atasan, cabang, status kerja, kontrak, mutasi, dan tanggal efektif.
- Setiap karyawan dapat dihubungkan ke satu akun `User` untuk Employee Self-Service.
- Data sensitif seperti rekening, identitas pajak, dan nomor kepesertaan disimpan sebagai secret/token reference, bukan teks terbuka.
- Karyawan hanya dapat melihat data miliknya; HR, payroll, finance, dan manager memiliki permission berbeda.

### 38.2 Absensi multi-metode

Metode yang disiapkan: fingerprint, face device, selfie + GPS, mobile GPS, QR, web, manual, dan import API. `AttendancePolicy` menentukan metode yang diizinkan, kewajiban foto/lokasi/liveness, akurasi GPS, geofence, toleransi duplikasi, serta mode offline.

Fingerprint terhubung melalui device bridge pada server fisik toko. Core tidak menyimpan fingerprint mentah; database hanya menyimpan device user code, reference template, dan hash. Event perangkat memakai external event ID serta operation ID agar pengiriman ulang tidak membuat absensi ganda.

Foto absensi disimpan pada private object storage melalui signed upload. `AttendancePhotoEvidence` menyimpan object key, hash, waktu, lokasi, skor liveness/face match, persetujuan, enkripsi, dan retention date.

### 38.3 Geofence dan lokasi

Setiap cabang dapat memiliki lebih dari satu `AttendanceGeofence`. Server menghitung jarak koordinat absensi terhadap pusat geofence dan menolak atau menandai review apabila:

- berada di luar radius;
- akurasi GPS melebihi batas;
- lokasi tidak tersedia padahal diwajibkan;
- waktu perangkat tidak wajar;
- bukti foto/liveness tidak memenuhi kebijakan.

Lokasi tidak digunakan untuk pelacakan terus-menerus. Sistem hanya menyimpan bukti yang diperlukan pada saat event absensi sesuai kebijakan dan masa retensi.

### 38.4 Jadwal, cuti, dan lembur

- Shift lintas tengah malam, waktu istirahat, toleransi terlambat/pulang cepat, minimum jam kerja, dan awal lembur.
- Roster karyawan harian, hari libur, off day, dan perubahan shift.
- Cuti, izin, sakit, lembur, serta koreksi absensi memakai approval workflow.
- Attendance record merupakan hasil kalkulasi event mentah dan dapat dibangun ulang.

### 38.5 Payroll dinamis

Komponen payroll tidak di-hard-code. `PayrollComponentDefinition` mendukung earning, deduction, reimbursement, employer contribution, tax, fixed amount, percentage, formula, attendance, overtime, tax engine, social security, dan manual adjustment.

Payroll menyimpan periode, run, result per karyawan, line detail, snapshot absensi, rule version, calculation trace, approval, jurnal, pembayaran, serta slip. Payroll yang sudah posted tidak diedit; koreksi dibuat sebagai adjustment run.

### 38.6 Akuntansi penggajian

Posting payroll membuat jurnal berpasangan untuk beban gaji, utang gaji, utang pajak, dan utang jaminan sosial/potongan. Pelunasan gaji, pajak, serta iuran dibuat sebagai jurnal terpisah. Mapping akun dapat berbeda per perusahaan/cabang melalui `PayrollAccountingMapping`.

### 38.7 Perpajakan dan jaminan sosial

`TaxRuleSet`, `TaxRule`, dan `SocialSecurityRuleSet` bersifat berversi, bertanggal efektif, memiliki status draft/approved, legal reference, checksum, approval, parameter, dan calculation trace. Engine generik mendukung lookup table serta progressive annual calculation.

Seed Indonesia hanya menyediakan kerangka `DRAFT`; tarif resmi PPh 21, BPJS Kesehatan, dan BPJS Ketenagakerjaan wajib diimpor dan diverifikasi sebelum activation. Perubahan aturan membuat versi baru agar hasil payroll lama tidak berubah.

### 38.8 Portal dan notifikasi karyawan

Aplikasi `apps/employee-portal` berjalan pada port 3003. Karyawan dapat melihat profil, absensi, dan slip gaji miliknya serta melakukan absensi berbasis GPS/foto sesuai policy.

Slip gaji diterbitkan sebagai snapshot. Default pengiriman WhatsApp/Telegram adalah pemberitahuan dengan secure link, bukan membuka detail gaji di chat. Binding nomor/chat ID harus diverifikasi, kanal dapat dipilih karyawan, dan delivery/retry dicatat.

### 38.9 Skala besar HR

Attendance event, attendance record, payroll line, payslip, notification delivery, serta audit log harus memakai pagination, indeks tanggal/tenant, batch processing, summary, retention, dan partitioning ketika volume meningkat. Perhitungan payroll, pembuatan slip, dan pengiriman notifikasi besar dijalankan worker per batch, bukan satu request web panjang.

Dokumentasi rinci tersedia pada:

- `docs/HRIS-ATTENDANCE-PAYROLL.md`
- `docs/BIOMETRIC-LOCATION-SECURITY.md`
- `docs/FINGERPRINT-INTEGRATION.md`
- `docs/PAYROLL-TAX-INDONESIA.md`

## 39. Akuntansi dan Perpajakan Seluruh Sistem

Akuntansi dan pajak tidak hanya berlaku pada payroll. Semua transaksi penjualan, pesanan online, pembayaran, pembelian, penerimaan supplier, retur, stok, biaya, pendapatan lain, kas/bank, aset, armada, pengiriman, dan payroll menggunakan `AccountingEvent`, `AccountingPostingRule`, `TaxCode`, `TaxTransaction`, `TaxDocument`, journal entry, approval, dan audit yang sama.

Setiap modul menerbitkan fakta bisnis dan amount keys. Posting rule berversi menentukan akun debit/kredit berdasarkan konfigurasi. Tarif pajak, inclusive/exclusive, input/output/withholding, akun pajak, tanggal efektif, pembulatan, dokumen, dan counterparty disimpan sebagai data, bukan hard-code.

Jurnal dan tax ledger harus idempotent, seimbang, tenant-scoped, period-aware, reversible, dan atomik dengan transaksi operasional. Transaksi biaya/penerimaan/pembayaran umum memakai `OperationalFinanceTransaction` agar fungsi baru tetap dapat masuk ke accounting core tanpa membuat service jurnal baru.

Rincian: `docs/ENTERPRISE-ACCOUNTING-TAX.md`.

## 40. Manajemen Aset dan Armada

Aset mencakup movable, immovable, vehicle, land, building, equipment, furniture, IT, software, dan tipe tambahan. Sistem menyimpan acquisition, capitalization, assignment, location, condition, depreciation, maintenance, transfer, impairment, disposal, evidence, tax, serta accounting event.

Kendaraan pengiriman merupakan aset yang memiliki data armada tambahan: kapasitas, plat, pengemudi, odometer, fuel, work order, pre/post-trip inspection, trip, stop, manifest, loading scan, gate pass, GPS adapter, proof of delivery, COD, dan return-to-store.

Rincian: `docs/ASSET-FLEET-OPERATIONS.md`.

## 41. Pemeriksaan Barang Masuk dan Keluar

Penerimaan supplier dan barang keluar tidak langsung mem-posting stok. Sistem memakai draft → scan → inspeksi → approval/confirmation → posting. Template checklist, operation policy, evidence, mismatch, tolerance, batch/serial, gate pass, dan multi-confirmation dapat berbeda per cabang.

Penerimaan supplier yang dikonfirmasi mem-posting accepted stock, batch/serial, PO, utang, pajak masukan, jurnal, audit, dan outbox dalam satu transaction. Outbound memastikan manifest, scan, packing, vehicle inspection, gate pass, dan proof of delivery. Retur pelanggan/supplier juga melewati inspeksi serta pembalik stok, accounting, dan pajak.

Rincian: `docs/INBOUND-OUTBOUND-CONTROL.md`.

## 42. Otomatisasi Fleksibel dan Dinamis

Feature flags, settings, custom fields, UI schema, business rules, operation policies, approval workflow, accounting posting rules, tax rules, integration adapters, outbox, worker, webhook, dan automation jobs membentuk lapisan konfigurasi bersama.

Fitur baru harus menambahkan event dan adapter, bukan menanam integrasi vendor pada core. Proses eksternal, notifikasi, approval, report, maintenance reminder, tax validation, low-stock action, delivery exception, dan provider sync berjalan asynchronous dengan retry, idempotency, dead-letter, serta audit.

Rincian: `docs/AUTOMATION-RULEBOOK.md`.

## 43. Workflow Pengembangan Resmi

Seluruh pengembangan wajib mengikuti `docs/DEVELOPMENT-WORKFLOW.md`.

Komponen workflow:

- Delivery wave dan dependency map: `config/module-delivery-map.json`.
- Kebijakan fase, risiko, branch, dan PR: `config/workflow-policy.json`.
- Manifest pekerjaan: `work-items/active/` dan `work-items/completed/`.
- Workflow CLI: `scripts/workflow.mjs`.
- Quality gates: `docs/QUALITY-GATES.md`.
- Roadmap implementasi: `docs/IMPLEMENTATION-ROADMAP.md`.
- Checkpoint resmi: `docs/PROJECT-CHECKPOINTS.md`.
- GitHub governance: issue forms, PR policy, CI, performance smoke, dan release candidate workflow.

Setiap fungsi baru harus melewati fase:

```text
INTAKE
→ ANALYSIS
→ DESIGN
→ IMPLEMENTATION
→ VERIFICATION
→ STAGING
→ RELEASE_READY
→ RELEASED
→ CLOSED
```

Perubahan berisiko tinggi wajib mempunyai feature flag, migration plan, rollback/compensating operation, monitoring plan, security notes, serta test domain terkait. Fitur tidak dinyatakan selesai hanya karena source code telah ditulis.

## 44. Otomatisasi Pekerjaan Satu Klik

Repository menyediakan `npm run work:auto` dan `npm run work:custom` untuk menyiapkan pekerjaan secara otomatis berdasarkan Development Kit dan roadmap machine-readable.

Otomatisasi melakukan:

- memilih backlog READY berdasarkan dependency dan priority;
- membuat work item lengkap pada fase ANALYSIS;
- membuat branch Git bila working tree aman;
- menghasilkan `TASK.md`, implementation checklist, AI prompt, dan session handoff;
- menjalankan workflow validation;
- membuka paket pekerjaan di editor;
- menyediakan hook coding agent eksternal yang nonaktif secara default.

Backlog berada pada `config/implementation-backlog.json`, sedangkan kebijakan launcher berada pada `config/work-automation.json`. Status penyelesaian tidak disimpan di backlog, tetapi ditentukan dari work item aktif dan completed agar riwayat tetap auditable.

Otomatisasi tidak boleh melewati quality gate atau menutup pekerjaan tanpa evidence. Detail penggunaan berada pada `docs/AUTOMATED-WORK-STARTER.md`.

## 45. Instruksi Tertanam dan Handoff Chat Dinamis

Instruksi sistem resmi berada pada `instructions/SYSTEM-INSTRUCTIONS.md` dan dibatasi maksimal 8.000 karakter oleh validasi mesin. File tersebut menjadi sumber tunggal; `AGENTS.md`, Copilot instructions, ChatGPT adapter, dan output clipboard harus identik dengan sumber canonical.

Sebelum berpindah chat, jalankan `npm run chat:handoff`; untuk akun baru jalankan `npm run chat:system` terlebih dahulu. Generator membaca checkpoint, version, fingerprint, Git branch/commit/status, database profile yang telah disensor, work item aktif, backlog READY, dan hasil quality gate. Output berada pada `handoff/generated/` dan terdiri atas instruksi sistem, chat pertama siap-tempel, konteks JSON, serta daftar file yang aman untuk dibawa.

Generator dilarang memasukkan credential, URL database, token, password, secret, biometric mentah, atau data pribadi. Output dinamis tidak boleh menjadi sumber kebenaran baru; ia hanya snapshot dari Project State, work item, Git, dan konfigurasi resmi.

Paket konteks diregenerasi dengan `npm run chat:generate` atau `npm run chat:handoff`. Platform chat eksternal tidak dapat dideteksi otomatis, sehingga perpindahan dipicu eksplisit dari terminal; pembentukan checkpoint dan konteks tetap source-bound.

Rincian: `docs/CHAT-HANDOFF-AUTOMATION.md`.

## UI-P2 — Admin Domain Workspaces (2026-09-22)

Admin information architecture memakai dua tingkat: workspace domain dan nested operator workspace. Nested route hanya mengatur navigasi/context; backend domain service, permission guard, tenant scope, idempotency, accounting, inventory, tax, payroll, dan audit tetap authoritative. Canonical route dan invariant tercatat di `docs/ADMIN-DOMAIN-WORKSPACES.md`.

### UI-P3 POS modernization
POS presentation dibagi ke workspace Penjualan, Shift & Kas, Retur, dan Sinkronisasi melalui `apps/pos/app/pos-shell.tsx`. Semua business mutation tetap memakai API/guard/idempotency/offline replay yang sudah ada; workspace bukan security boundary.


## UI-P4 Storefront Productization

Storefront menggunakan reusable shell dan customer journey terpisah untuk home, catalog, product detail, cart/checkout, dan account/order tracking. Route UI bukan security boundary; seluruh pricing, promo, stock reservation, fulfillment, payment, return, review, favorite, loyalty, dan customer-session validation tetap authoritative di API.

## UI-P5 Employee Portal productization — 2026-09-22
Employee Portal memakai reusable shell dan route self-service terpisah untuk home, attendance, leave, overtime, payslips, history, dan profile. UI hanya mengatur presentation/progressive disclosure; employee self-scope, attendance evidence, approval, dan payslip authorization tetap authoritative di backend.

## UI-P6 Server-driven Admin UI
Admin runtime manifest sekarang mengendalikan tidak hanya top-level workspace, tetapi juga nested domain visibility/presentation. Canonical route/action tetap source-owned; UiSchema hanya hide/relabel/reorder, sedangkan module/feature/role/permission hanya mengurangi visibility UI. Backend authorization tetap authoritative.

### UI-P7 — final interface hardening
Empat operator-facing app memakai accessibility/responsive baseline yang sama: skip-link, focus-visible, reduced-motion, coarse-pointer touch target, semantic active navigation, dan focusable primary workspace. Layer ini presentation-only; backend tetap authoritative.

## 46. F12R3 Tailwind UI + Deep GitHub Full-System UAT

Empat operator-facing application memakai Tailwind CSS v4 sebagai presentation foundation: Admin, POS, Storefront, dan Employee Portal. Migrasi ini presentation-only terhadap business authority: API, permission, tenant context, idempotency, inventory, accounting, tax, payroll, outbox, worker, dan audit tidak dipindahkan ke client.

Admin information architecture wajib memperjelas Tenant/User/System, Telegram/WhatsApp/owner reporting, dan AI/forecast assistant. Fitur backend tidak dianggap selesai secara produk bila operator tidak memiliki route/menu/configuration flow yang jelas.

Full GitHub UAT wajib menjalankan structural repo audit, UI interaction inventory, PostgreSQL migration rehearsal, exact build, browser route/workspace + responsive geometry sweep, seluruh documented OpenAPI runtime sweep, Telegram/WhatsApp/owner-digest provider simulation, worker/report probe, tenant integration, Stage-18/19/20, staging/load/index/DR, dan evidence aggregation. Optional live Telegram test memakai protected `provider-uat` GitHub Environment. Detail canonical berada di `docs/FULL-GITHUB-UAT.md`.


## P5 Full Visual Product Rebuild

P5 is a single four-product visual wave. Canonical coverage is `config/p5-visual-surface-map.json`. Local/source verification includes `npm run audit:p5:visual` and `node --test tests/product-completion-p5-visual-rebuild.test.mjs`. Exact-source GitHub browser verification uses `npm run ci:p5:probe` and writes `handoff/quality/github-p5-visual-rebuild-probe-latest.json`. Automated P5 evidence must keep `humanAcceptance=PENDING`; human UI acceptance is a distinct required gate.
