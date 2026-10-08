# Pengembangan Lokal Tanpa Docker

## Tujuan

Semua aplikasi Toko360 dapat dikembangkan langsung di Ubuntu/Linux tanpa Docker atau mesin virtual. Komputer lokal hanya menjalankan proses Node.js dan satu file database SQLite.

## Prasyarat

- Node.js 20.9 atau lebih baru.
- npm yang ikut terpasang bersama Node.js.
- Git hanya diperlukan ketika akan push ke GitHub.
- Flutter SDK hanya diperlukan ketika mengembangkan `apps/customer-mobile`.

## Setup Satu Kali

```bash
npm run setup
```

Setup akan memasang dependency, memilih profil SQLite, membuat database, menjalankan seed, memvalidasi repository, dan menjalankan smoke test.

## Menjalankan Aplikasi

```bash
npm run dev
```

## Lokasi Database

```text
apps/api/prisma/data/toko360.db
```

File database tidak ikut dipush ke GitHub. Untuk memindahkan data demo ke komputer lain, tutup aplikasi terlebih dahulu lalu salin file tersebut secara manual.

## Membuka Database

```bash
npm run db:local:studio
```

## Reset Database

```bash
npm run db:local:reset
```

Reset menghapus database lokal, membuat ulang schema, menjalankan seed, dan smoke test.

## Menjalankan Satu Aplikasi Saja

```bash
npm run dev -w @toko360/api
npm run dev -w @toko360/worker
npm run dev -w @toko360/storefront
npm run dev -w @toko360/admin
npm run dev -w @toko360/pos
```

## Worker Lokal

Worker memakai polling database sehingga tidak membutuhkan Redis. Redis atau message broker dapat dipasang kemudian pada staging/production sebagai adapter queue tanpa mengubah domain transaksi.

## Troubleshooting lokal

### Port dipakai aplikasi lain

Ubah port pada `.env` atau hentikan program yang menggunakan port 3000, 3001, 3002, 3003, atau 4000.

### Database terkunci

Pastikan tidak ada API, worker, atau Prisma Studio yang masih membuka database sebelum menjalankan reset.

### Ingin kembali dari profil PostgreSQL

```bash
npm run profile:local
npm run db:local:prepare
```
