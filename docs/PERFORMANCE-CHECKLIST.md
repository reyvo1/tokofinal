# Performance and Million-Record Checklist

Gunakan checklist ini pada pull request yang mengubah produk, transaksi, stok, pembayaran, jurnal, laporan, sinkronisasi, atau data berukuran besar.

## API

- [ ] Endpoint daftar memakai cursor pagination.
- [ ] Default limit dan maksimum limit diterapkan.
- [ ] Search tidak menjalankan wildcard mahal pada kolom tanpa indeks.
- [ ] Response tidak membawa relasi besar yang tidak dibutuhkan.
- [ ] Date range wajib untuk laporan/transaksi historis.
- [ ] Export besar dijalankan sebagai background job.

## Database

- [ ] Query memiliki tenant/company/branch scope.
- [ ] Index sesuai filter dan order by.
- [ ] Query plan diperiksa pada data representatif.
- [ ] Mutasi stok atomik.
- [ ] Idempotency diterapkan.
- [ ] Transaction timeout wajar.
- [ ] Migration aman dan dapat dipulihkan.
- [ ] Kandidat partition/retention ditentukan.

## Worker

- [ ] Job idempotent.
- [ ] Retry menggunakan backoff dan batas percobaan.
- [ ] Dead-letter state tersedia.
- [ ] Progress/heartbeat tersedia untuk job panjang.
- [ ] Payload antrean tidak memuat file atau objek sangat besar.

## Observability

- [ ] Latency dan error dapat diukur.
- [ ] Slow query dapat ditemukan.
- [ ] Queue depth dapat dipantau.
- [ ] Correlation/operation ID tersedia.
- [ ] Alert threshold ditentukan.

## Pengujian

- [ ] Unit test aturan bisnis.
- [ ] Integration test transaction.
- [ ] Concurrency test stok.
- [ ] Pagination test tanpa duplikasi/kehilangan item.
- [ ] Load test dengan ukuran data realistis.
- [ ] Backup restore test.
