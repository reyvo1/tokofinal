# Contributing to Toko360

Pengembangan Toko360 wajib mengikuti `docs/DEVELOPMENT-WORKFLOW.md` dan Development Kit.

## Aturan utama

1. Satu perubahan bisnis = satu work item.
2. Jangan mengubah transaksi stok, pembayaran, jurnal, pajak, payroll, atau sinkronisasi tanpa analisis dampak dan rollback.
3. Semua endpoint daftar wajib pagination dan tenant/branch scope.
4. Semua mutasi penting wajib idempotent, auditable, dan memakai transaksi database.
5. SQLite dipakai untuk development lokal; PostgreSQL adalah target staging/production.
6. Production memakai migration versioned; `prisma db push` tidak dipakai untuk perubahan production.
7. Fitur berisiko dirilis melalui feature flag.
8. Pull request kecil, fokus, dan tidak mencampur refactor luas dengan perubahan bisnis.

## Alur cepat

```bash
npm run workflow:new -- feature nama-fitur --module inventory --wave W1 --risk HIGH
npm run workflow:status
npm run quality:fast
```

Buat branch sesuai saran CLI, implementasikan perubahan, lengkapi test dan dokumentasi, lalu buka PR memakai template repository.

Sebelum rilis:

```bash
npm run quality:full
npm run release:check
```
## Memulai work item satu klik

Gunakan `mulai-pekerjaan-otomatis.cmd` atau `npm run work:auto`. Bila masih ada work item aktif, selesaikan atau lanjutkan item tersebut sebelum mengambil backlog baru. Paket pekerjaan otomatis berada di `work-items/generated/<ID>/`.

