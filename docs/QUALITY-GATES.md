# Quality Gates Toko360

## Fast gate

```bash
npm run quality:fast
```

Digunakan sebelum commit dan mencakup workflow manifest, validasi repository, lint, dan test cepat.

## Full gate

```bash
npm run quality:full
```

Digunakan sebelum PR siap review dan mencakup fast gate, persiapan database lokal, database smoke test, serta build seluruh aplikasi.

## Release gate

```bash
npm run release:check
```

Release gate tidak menggantikan PostgreSQL CI, staging UAT, migration rehearsal, backup, dan observasi setelah deployment.

## Invariant wajib

- Inventory: tidak ada perubahan saldo tanpa movement dan reference.
- Accounting: jumlah debit sama dengan kredit.
- Tax: rule memiliki versi dan periode berlaku.
- Payment: callback/retry tidak membuat pembayaran ganda.
- Payroll: result posted immutable dan adjustment auditable.
- Asset: perubahan nilai buku berasal dari transaction/depreciation event.
- Fleet: dispatch memerlukan kendaraan/pengemudi/manifest yang valid.
- Inspection: barang tidak posted/keluar sebelum policy terpenuhi.
- Sync: operation ID unik dan receipt dapat dikirim ulang.
