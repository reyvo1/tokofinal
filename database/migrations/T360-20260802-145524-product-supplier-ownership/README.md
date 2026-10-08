# Product dan Supplier Company Ownership

Work item: `T360-20260802-145524`

## Urutan aman

1. Buat backup dan restore point; uji restore pada TEST/STAGING.
2. Jalankan file `*-expand.sql` sesuai provider. Kolom masih nullable dan tidak menghapus constraint lama.
3. Jalankan query kandidat/backfill pada salinan data terlebih dahulu.
4. Rekonsiliasi record dengan lebih dari satu kandidat company atau tanpa kandidat.
5. Jalankan file `*-backfill.sql` pada maintenance window.
6. Pastikan hasil query evidence tidak memiliki `unresolved_product` atau `unresolved_supplier` sebelum deploy aplikasi Tahap 16.
7. Generate Prisma Client dan deploy aplikasi.
8. Contract migration untuk `companyId NOT NULL` dan perubahan uniqueness hanya boleh dibuat pada work item terpisah setelah observasi.

## Batasan

- `sku`, `barcode`, dan `Supplier.code` masih memakai uniqueness global selama fase expand agar migration tidak destruktif.
- Jangan menjalankan `prisma db push` pada production.
- Jangan mengaktifkan enforcement aplikasi sebelum backfill dan rekonsiliasi selesai.
- Rollback aplikasi tidak memerlukan penghapusan kolom; biarkan kolom/index additive tetap ada.
