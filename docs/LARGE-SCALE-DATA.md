# Toko360 Large-Scale Data Architecture

Dokumen ini menetapkan standar teknis agar Toko360 dapat berkembang dari satu toko menjadi banyak cabang dengan ratusan ribu produk dan jutaan sampai puluhan juta transaksi tanpa mengganti seluruh aplikasi.

## 1. Tujuan kapasitas

Target harus diuji, bukan hanya diasumsikan. Baseline desain:

| Tahap | Produk aktif | Transaksi penjualan | Baris detail/movement/jurnal | Kasir bersamaan |
|---|---:|---:|---:|---:|
| Awal | 10.000 | 100.000 | 1.000.000 | 10 |
| Berkembang | 100.000 | 5.000.000 | 50.000.000 | 100 |
| Besar | 1.000.000 | 50.000.000+ | 500.000.000+ | 1.000+ |

Angka tersebut adalah sasaran arsitektur. Kapasitas nyata ditentukan melalui load test pada server, database, jaringan, dan pola transaksi yang benar-benar digunakan.

## 2. Prinsip utama

1. PostgreSQL menjadi database transaksi production.
2. SQLite hanya untuk development lokal, demo, atau perangkat tunggal darurat.
3. API tidak boleh mengirim seluruh isi tabel.
4. Semua daftar besar memakai cursor pagination dan batas maksimum.
5. Stok dicatat sebagai saldo cepat ditambah ledger pergerakan yang tidak dihapus.
6. Proses berat dijalankan oleh worker, bukan di request kasir.
7. Laporan membaca agregat atau menjalankan SQL agregasi, bukan memuat jutaan baris ke memori Node.js.
8. Data panas, hangat, dan arsip dipisahkan berdasarkan usia serta kebutuhan akses.
9. Setiap transaksi mutasi memiliki idempotency key.
10. Kinerja diukur menggunakan SLO, query budget, tracing, dan load test.

## 3. Pembagian data

### 3.1 Data master

Produk, kategori, supplier, pelanggan, pengguna, harga, promosi, gudang, dan konfigurasi. Data master lebih sering dibaca daripada ditulis. Strategi:

- indeks exact untuk SKU dan barcode;
- indeks pencarian nama;
- cache terukur untuk data yang sering dibaca;
- versioning untuk sinkronisasi server pusat dan toko;
- soft delete/tombstone agar perubahan dapat disinkronkan.

### 3.2 Data transaksi

Penjualan, order, pembayaran, penerimaan supplier, retur, transfer, opname, jurnal, dan pergerakan stok. Strategi:

- append-oriented;
- tidak dihapus permanen;
- koreksi memakai reversal;
- foreign key dan constraint;
- idempotency;
- partisi berdasarkan waktu pada volume besar.

### 3.3 Data operasional sementara

Outbox, webhook delivery, notification queue, offline queue, session, dan temporary reservation. Strategi:

- indeks status dan waktu eksekusi;
- retry bertahap;
- dead-letter queue;
- retention pendek;
- pembersihan berkala setelah berhasil.

### 3.4 Data analitik

Ringkasan penjualan harian, ringkasan keuangan, snapshot persediaan, forecasting, dan BI. Strategi:

- dipisahkan dari query transaksi kasir;
- diperbarui incremental;
- dapat dibangun ulang dari sumber transaksi;
- ekspor besar melalui background job.

## 4. Pagination wajib

Endpoint daftar harus menerima:

```text
limit=50
cursor=<opaque-cursor>
search=<optional>
```

Aturan:

- default 50;
- maksimum publik 100;
- maksimum internal 500 hanya untuk worker yang terpercaya;
- cursor harus opaque;
- response menyediakan `nextCursor` dan `hasMore`;
- jangan memakai `skip` besar untuk jutaan baris;
- urutan harus stabil, misalnya `createdAt DESC, id DESC`.

Contoh response:

```json
{
  "items": [],
  "pageInfo": {
    "limit": 50,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTI4VDEwOjAwOjAwWiIsImlkIjoiLi4uIn0",
    "hasMore": true
  }
}
```

## 5. Strategi pencarian produk

Urutan prioritas pencarian:

1. Barcode exact match.
2. SKU exact match.
3. SKU prefix match.
4. Nama menggunakan PostgreSQL trigram/full-text search.
5. Search engine terpisah hanya ketika PostgreSQL tidak lagi cukup.

Larangan:

- `contains` pada barcode;
- wildcard di awal untuk semua query;
- menggabungkan inventory seluruh gudang pada setiap hasil katalog;
- mengirim gambar penuh dari database transaksi.

## 6. Indeks database

Setiap indeks harus mendukung query nyata. Minimal:

- sale: cabang+waktu, gudang+waktu, status+waktu, pelanggan+waktu;
- sale item: sale, produk+sale;
- order: cabang+status+waktu, gudang+status+waktu, expiration;
- payment: status+waktu, external reference, sale, order;
- inventory movement: gudang+produk+waktu, produk+waktu, referensi;
- purchase order: gudang+status+tanggal, supplier+tanggal;
- goods receipt: gudang+waktu, supplier+waktu, PO;
- journal entry: tanggal, reference type+reference id;
- journal line: journal entry, account+journal entry;
- audit log: company+waktu, user+waktu, entity;
- outbox/queue: status+available time.

Gunakan `EXPLAIN (ANALYZE, BUFFERS)` sebelum menambahkan indeks baru pada production. Indeks yang tidak dipakai harus dievaluasi karena memperberat insert/update.

## 7. Partisi tabel besar

Partisi PostgreSQL dipertimbangkan ketika tabel mencapai puluhan juta baris atau maintenance/index mulai berat. Kandidat:

- inventory_movements;
- sales dan sale_items;
- orders dan order_items;
- journal_entries dan journal_lines;
- audit_logs;
- event_outbox;
- webhook_deliveries;
- notifications.

Strategi umum:

- partisi bulanan untuk volume sangat tinggi;
- partisi triwulan/tahunan untuk volume menengah;
- indeks lokal pada setiap partisi;
- pembuatan partisi ke depan secara otomatis;
- partisi lama dapat dipindah ke storage arsip.

Partisi bukan pengganti indeks dan query yang baik. Penerapan dilakukan lewat migration PostgreSQL khusus dan diuji pada staging.

## 8. Stok dengan concurrency tinggi

Pengurangan stok harus atomik:

```text
UPDATE inventory
SET quantity = quantity - :qty,
    available = available - :qty
WHERE warehouse_id = :warehouse
  AND product_id = :product
  AND available >= :qty;
```

Jika jumlah row yang berubah nol, stok tidak mencukupi atau terjadi persaingan transaksi. Transaksi gagal secara aman.

Aturan:

- gunakan database transaction;
- retry serialization/deadlock maksimal beberapa kali dengan jitter;
- urutkan product ID sebelum mengunci banyak produk;
- jangan menahan transaksi sambil memanggil payment gateway;
- simpan movement dalam transaksi yang sama;
- saldo inventory adalah cache konsisten dari ledger, bukan pengganti ledger.

## 9. Idempotensi

Setiap mutasi penting membawa `operation_id` atau `Idempotency-Key` unik:

- penjualan;
- order;
- pembayaran;
- goods receipt;
- retur;
- transfer;
- stock opname;
- sinkronisasi edge;
- webhook provider.

Server menyimpan receipt berisi request hash, status, entity ID, dan response ringkas. Request yang sama dikembalikan tanpa membuat transaksi baru. Key yang sama dengan payload berbeda harus ditolak.

## 10. Nomor dokumen atomik

Nomor bisnis tidak menggunakan angka acak. Gunakan `NumberSequence` per perusahaan/cabang/jenis dokumen/periode.

```text
POS-TSK01-20260728-000001
GRN-TSK01-20260728-000001
```

Increment dilakukan atomik di dalam transaksi. UUID tetap menjadi primary key internal.

## 11. Laporan dan agregasi

Request laporan tidak boleh mengambil seluruh `JournalLine` atau `Inventory` lalu menghitung di Node.js.

Gunakan tiga tingkat:

1. **Live aggregate SQL** untuk rentang kecil.
2. **Daily summary** untuk dashboard dan laporan bulanan/tahunan.
3. **Asynchronous report job** untuk ekspor sangat besar.

Tabel ringkasan dapat dibangun ulang:

- `DailySalesSummary`;
- `DailyFinanceSummary`;
- `DailyInventorySummary`.

Worker memproses event/outbox dan melakukan upsert agregat. Rekonsiliasi malam membandingkan agregat dengan sumber transaksi.

## 12. Query budget

Baseline yang perlu dipantau:

| Operasi | Target p95 awal |
|---|---:|
| Scan barcode exact | < 100 ms |
| Simpan transaksi POS lokal | < 500 ms |
| Daftar 50 produk | < 300 ms |
| Daftar transaksi 50 item | < 500 ms |
| Dashboard berbasis summary | < 1 detik |
| Laporan interaktif 31 hari | < 3 detik |
| Ekspor jutaan baris | background job |

Target disesuaikan dengan lokasi server dan jaringan. Query yang melewati budget masuk slow-query review.

## 13. Connection management

- gunakan connection pooling;
- batasi connection per instance API;
- gunakan PgBouncer bila banyak instance atau cabang;
- request tidak boleh membuka koneksi baru secara manual;
- worker dan API memiliki pool/batas terpisah;
- timeout query dan statement wajib ditentukan;
- batalkan query laporan yang tidak terkendali.

## 14. Read scaling

Tahap awal menggunakan satu PostgreSQL primary. Ketika beban baca meningkat:

- read replica untuk dashboard dan laporan;
- primary tetap untuk transaksi dan read-after-write;
- aplikasi membedakan koneksi read/write;
- replica lag dipantau;
- data penting setelah transaksi tidak langsung dibaca dari replica yang tertinggal.

## 15. Cache

Cache digunakan untuk mempercepat, bukan menjadi sumber kebenaran.

Cocok untuk:

- runtime manifest;
- kategori;
- feature flags;
- konfigurasi;
- daftar harga yang versioned;
- hasil dashboard singkat.

Tidak cocok sebagai sumber utama untuk:

- stok tersedia pada saat commit penjualan;
- status pembayaran final;
- saldo jurnal;
- permission tanpa invalidasi.

Semua cache memiliki TTL, version, dan strategi invalidasi.

## 16. Worker dan antrean

Proses background:

- notifikasi;
- webhook;
- sinkronisasi pusat-toko;
- agregasi harian;
- ekspor laporan;
- import massal;
- forecasting;
- archiving;
- cleanup;
- rekonsiliasi.

Worker harus idempotent. Job panjang memiliki progress, heartbeat, retry, timeout, dan dead-letter state.

## 17. Import dan ekspor massal

Import jutaan data tidak dilakukan melalui satu request web.

Alur:

1. Upload file ke object storage.
2. Buat import job.
3. Worker membaca streaming/chunk.
4. Validasi per batch.
5. Bulk insert/upsert.
6. Simpan error per baris.
7. Tampilkan progress.
8. Sediakan file hasil validasi.

Ekspor besar juga memakai streaming dan background job. Hindari membuat seluruh file di RAM.

## 18. Retention dan archiving

Kategori data:

- **Hot:** 3–12 bulan, indeks lengkap, akses cepat.
- **Warm:** 1–3 tahun, tetap online dengan indeks selektif.
- **Cold:** lebih lama, arsip terenkripsi dan dapat dipulihkan.

Data finansial dan transaksi mengikuti kebijakan hukum serta akuntansi yang berlaku. Data tidak boleh dihapus hanya untuk mempercepat sistem tanpa persetujuan kebijakan retention.

Outbox, notification delivery, session, dan log teknis dapat memiliki retention lebih pendek setelah status final.

## 19. Hybrid central-edge

Untuk server hosting dan server fisik toko:

- transaksi toko ditulis ke PostgreSQL lokal;
- local outbox mengirim operation ke pusat;
- pusat memberikan receipt;
- master data pusat ditarik memakai change cursor;
- stok disinkronkan sebagai movement, bukan overwrite saldo;
- conflict queue disediakan;
- setiap node memiliki credential dan sequence sendiri;
- sinkronisasi dilakukan batch serta dapat resume.

Gangguan internet tidak boleh menghentikan penjualan lokal.

## 20. Observability

Pantau minimal:

- request rate, error rate, latency;
- CPU, RAM, disk, IOPS;
- active database connections;
- slow queries;
- deadlock dan lock wait;
- replication lag;
- queue depth dan oldest pending job;
- sync lag per toko;
- outbox failure;
- disk growth per tabel/index;
- backup age dan restore test.

Gunakan correlation ID dari API sampai database job dan sinkronisasi.

## 21. Load test

Skenario wajib:

- 100–1.000 kasir membuat transaksi bersamaan;
- banyak kasir menjual SKU yang sama;
- 100.000–1.000.000 produk;
- 10 juta sale item;
- 20 juta inventory movement;
- 20 juta journal line;
- order online dan POS bersamaan;
- internet edge putus dan reconnect;
- backlog sinkronisasi puluhan ribu operasi;
- dashboard dibuka saat beban transaksi tinggi;
- backup dan restore database besar.

Jalankan bertahap pada staging. Jangan melakukan destructive load test pada production.

## 22. Migration tanpa downtime panjang

- schema change dibuat backward-compatible;
- tambah kolom nullable/default aman terlebih dahulu;
- backfill dilakukan chunked oleh worker;
- index besar dibuat secara concurrent pada PostgreSQL;
- deploy kode yang membaca format lama dan baru;
- switch feature flag setelah data siap;
- hapus format lama pada rilis berikutnya;
- setiap migration memiliki rollback/recovery plan.

## 23. Tahapan implementasi

### Tahap A — wajib sebelum production awal

- pagination semua endpoint;
- indeks inti;
- filter tenant/cabang;
- idempotency;
- atomic stock update;
- backup/restore;
- slow query logging;
- load test dasar.

### Tahap B — jutaan baris

- daily summary;
- report job;
- retention queue/log;
- PgBouncer;
- load test jutaan fixture;
- monitoring tabel/index;
- concurrency retry.

### Tahap C — puluhan juta baris

- partitioning;
- read replica;
- hot/warm archive;
- dedicated reporting database/warehouse;
- automated capacity forecasting;
- multi-instance API dan worker autoscaling.

## 24. Definition of done untuk fitur baru

Setiap fitur dianggap siap skala ketika:

- list endpoint dipaginasi;
- query tenant scoped;
- indeks dijelaskan;
- mutasi idempotent;
- transaksi concurrency diuji;
- data lifecycle ditentukan;
- audit tersedia;
- metrik tersedia;
- load test scenario ditambahkan;
- tidak ada query seluruh tabel tanpa limit;
- laporan besar tidak dihitung di memori aplikasi.
