# Runbook — Product/Supplier Ownership Migration Gate

Work item: `T360-20260802-145524`  
Scope: Tahap 17 — rehearsal migration SQLite lokal/test dan kesiapan staging PostgreSQL.

## Tujuan

Membuktikan expand migration dan backfill dapat dijalankan tanpa mengubah database sumber, menghasilkan ownership yang konsisten, dapat diulang, memiliki restore point yang dapat dibaca, serta tidak meninggalkan record unresolved sebelum deployment aplikasi.

## Rehearsal SQLite lokal/test

Jalankan:

```bash
npm run db:ownership:rehearse:sqlite
```

Runner menggunakan SQLite backup API untuk membuat snapshot konsisten, lalu:

1. membuat restore point dan restore-test;
2. menjalankan `sqlite-expand.sql` hanya pada salinan;
3. menjalankan `sqlite-backfill.sql` dua kali untuk menguji idempotensi;
4. memeriksa unresolved ownership, multi-company candidate, mismatch, foreign key, index, query plan, dan integrity;
5. menulis evidence ke `logs/stage17-product-supplier-ownership/`.

Database sumber tidak diubah. Gate gagal bila unresolved atau mismatch tidak nol.

## Staging PostgreSQL

Tahap 17 tidak menjalankan SQL PostgreSQL otomatis. DBA wajib menjalankan urutan berikut pada database staging yang memiliki restore point teruji:

1. review dan jalankan `postgresql-expand.sql`;
2. jalankan query kandidat/backfill pada salinan atau transaksi staging;
3. jalankan `postgresql-backfill.sql`;
4. jalankan `postgresql-reconciliation.sql`;
5. pastikan seluruh issue nol dan empat index ownership tersedia;
6. jalankan HTTP/DB integration lintas tenant serta `quality:full` terhadap staging.

Jangan memakai `prisma db push` pada production. Contract migration `companyId NOT NULL` dan uniqueness per-company tetap merupakan work item terpisah.

## Rollback

- Rehearsal SQLite: hapus salinan rehearsal; database sumber tidak berubah.
- Staging PostgreSQL sebelum deploy: rollback transaksi bila masih terbuka atau restore dari restore point yang sudah diuji.
- Setelah expand ter-commit: kolom/index additive boleh tetap ada; rollback aplikasi tidak membutuhkan drop column.

## Keputusan ownership administratif eksplisit

Record tanpa kandidat transaksi tidak boleh dipetakan otomatis. Runner menerima `--decisions-file <json>` hanya untuk keputusan administratif yang telah direview. Setiap keputusan wajib:

- menunjuk ID Product/Supplier dan company secara eksplisit;
- memverifikasi kode/nama record serta identitas company yang diharapkan;
- dapat mewajibkan database hanya memiliki satu company;
- dapat mewajibkan record benar-benar tidak memiliki kandidat transaksi;
- diterapkan hanya pada snapshot rehearsal dan dicatat dalam evidence;
- tetap idempoten saat rehearsal dijalankan ulang.

File keputusan paket tidak di-commit. Mapping dan alasan yang digunakan disalin ke evidence work item agar audit trail tetap tersedia.

## Tahap 18 — PostgreSQL TEST/STAGING

Tahap 18 menyediakan runner yang **menolak production/live**, memerlukan identitas host/database yang cocok persis, membuat backup `pg_dump`, melakukan restore drill pada database scratch terpisah, lalu menjalankan expand, backfill, keputusan administratif, dan reconciliation dalam satu transaksi PostgreSQL.

1. Salin `stage18-postgres.env.example` menjadi `stage18-postgres.env`.
2. Isi target TEST/STAGING dan database scratch restore yang khusus untuk Tahap 18.
3. Pastikan `psql`, `pg_dump`, dan `pg_restore` tersedia pada `PATH` atau isi lokasi executable pada file env.
4. Jalankan `npm run db:ownership:stage:postgres`.

Gate hanya lulus bila:

- target dan database restore bukan production/live dan cocok dengan expected identity;
- backup custom-format dapat dibaca dan benar-benar direstore ke database scratch;
- Product/Supplier unresolved dan mismatch bernilai nol;
- foreign-key ownership valid dan empat index ownership tersedia;
- eksekusi transaksi kedua tidak mengubah state ownership;
- credential dan raw database URL tidak ditulis ke evidence.

Evidence tersimpan di `logs/stage18-product-supplier-postgres/`. Backup dan database scratch tidak di-commit. Runner tidak memakai `prisma db push` dan tidak memiliki mode production.
