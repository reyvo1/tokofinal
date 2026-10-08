# ADR — Company Ownership untuk Product dan Supplier

- Status: Accepted for staged implementation
- Work item: `T360-20260802-145524`
- Risiko: CRITICAL

## Konteks

`Product` dan `Supplier` sebelumnya merupakan record global. Endpoint katalog, pembelian, penjualan, order publik, transfer stok, opname, fleet manifest, dan extensions dapat menemukan record berdasarkan ID tanpa ownership company yang eksplisit. Warehouse dan dokumen transaksi memang memiliki branch, tetapi master data tidak memiliki system of record tenant sendiri.

## Keputusan

1. Tambahkan `companyId` nullable pada `Product` dan `Supplier` sebagai migration expand-only pada SQLite dan PostgreSQL.
2. Semua record baru wajib mengambil `companyId` dari `AuthUser` atau dari branch code storefront yang telah diverifikasi.
3. Katalog produk publik wajib menyertakan `branchCode`; inventory yang dikembalikan hanya berasal dari warehouse branch tersebut.
4. Supplier hanya dapat dibaca dan dibuat dalam company token.
5. Semua jalur transaksi yang menerima `productId` atau `supplierId` memvalidasi company ownership sebelum stok, pajak, accounting, shipment, atau outbox diproses.
6. Backfill hanya otomatis bila seluruh bukti relasi menunjuk tepat satu company. Record tanpa kandidat atau multi-company tetap unresolved dan harus direkonsiliasi manual.
7. Constraint global `sku`, `barcode`, dan `Supplier.code` dipertahankan pada fase expand. Contract migration menuju uniqueness per-company dan `companyId NOT NULL` dilakukan terpisah setelah backfill, staging, dan observasi.

## Invariant

- Product/Supplier baru tidak pernah menerima company dari query/body bebas.
- Product company harus sama dengan company warehouse/dokumen yang menggunakannya.
- Supplier company harus sama dengan company warehouse purchase order/receipt/return.
- Public catalog tidak mengungkap `companyId` dan tidak membaca inventory branch lain.
- Konflik ownership tidak dipilih secara arbitrer.

## Failure modes

- Backfill menemukan lebih dari satu company: hentikan deploy dan rekonsiliasi data.
- Record tidak mempunyai bukti relasi: tetapkan ownership melalui proses data governance, bukan default company.
- Migration/index gagal atau lock terlalu lama: rollback transaksi migration, hentikan deploy, dan gunakan restore point bila perlu.
- Aplikasi baru berjalan sebelum backfill: master data nullable tidak akan terlihat; rollback aplikasi dan selesaikan backfill.

## Deployment

Urutan wajib: backup → expand migration → dry-run/backfill staging → rekonsiliasi → verifikasi zero unresolved → generate client → deploy aplikasi → monitoring. Production tidak boleh menggunakan `prisma db push`.

## Rollback

Rollback aplikasi ke commit sebelumnya. Kolom dan index additive tidak perlu dihapus. Tidak ada compensating journal, tax, atau inventory movement karena migration hanya menambah ownership master data.

## Monitoring

Pantau `TENANT_ACCESS_DENIED` untuk Product/Supplier, error catalog kosong, latency query katalog, unresolved ownership, duplicate key, serta mismatch product/supplier terhadap dokumen transaksi.
