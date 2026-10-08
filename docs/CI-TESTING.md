# GitHub CI dan Pengujian Container

## Kebijakan

Docker tidak diperlukan di komputer pengembang. Container dipakai hanya pada runner GitHub untuk memvalidasi kompatibilitas deployment dan transaksi PostgreSQL.

## Workflow

File:

```text
.github/workflows/ci.yml
```

### Job 1 — Repository Tests

- validasi JSON dan TypeScript/TSX;
- validasi struktur repository;
- test profil lokal;
- validasi schema SQLite;
- validasi konfigurasi Docker Compose khusus CI.

### Job 2 — SQLite Integration

- membuat database SQLite dari nol;
- menjalankan seed;
- menjalankan smoke test data;
- build API, worker, storefront, admin, dan POS.

Job ini membuktikan setup tanpa Docker tetap berjalan.

### Job 3 — PostgreSQL Integration

- GitHub menjalankan PostgreSQL service container;
- memvalidasi schema PostgreSQL;
- membuat tabel dan seed;
- menjalankan smoke test database;
- build seluruh aplikasi.

## CI-only Docker Files

```text
.github/ci/docker-compose.ci.yml
```

File tersebut bukan panduan lokal. Tidak ada `docker-compose.yml` di root repository agar developer tidak menganggap Docker sebagai persyaratan.

## Smoke Test

```text
scripts/smoke-db.mjs
```

Smoke test memastikan seed memiliki company, branch, warehouse, user, product, supplier, dan feature flag. Test yang lebih lengkap dapat ditambahkan untuk goods receipt, stok, jurnal, transfer, retur, dan idempotency.

## Status Pull Request

Branch protection disarankan mewajibkan tiga job CI berhasil sebelum merge ke `main`:

- Repository and local-profile tests;
- No-Docker local SQLite integration;
- GitHub container PostgreSQL integration.
