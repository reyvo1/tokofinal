# Finance, Accounting, Tax & Reporting Reconciliation

Baseline hardening: 2026-09-11.

Dokumen ini menjelaskan sumber kebenaran laporan keuangan Toko360 setelah hardening Finance/Accounting/Tax/Reporting.

## Prinsip utama

1. **Jurnal POSTED adalah sumber kebenaran laporan keuangan.** Status order, payment selection, atau summary materialized tidak boleh menggantikan jurnal untuk revenue, expense, neraca, trial balance, dan cash movement.
2. **Business date menentukan periode.** Input tanggal berbentuk `YYYY-MM-DD` untuk batas akhir report/period diperlakukan sampai `23:59:59.999`, sehingga transaksi pada hari terakhir tidak terpotong.
3. **Double entry wajib seimbang.** Financial integrity dan fiscal close memeriksa debit/credit per journal entry, accounting event gagal/tanpa jurnal, transaksi finance pending, dan tax transaction yang belum POSTED.
4. **Tax rule harus ACTIVE, milik company yang benar, sesuai scope transaksi, dan efektif pada business date transaksi.** Penjualan hanya menerima scope SALE/OTHER, pembelian menerima PURCHASE/OTHER, biaya/aset memakai scope yang sesuai, dan transaksi backdate tidak boleh memakai tarif yang baru berlaku kemudian. Replay transaksi POS offline memakai waktu transaksi asli, bukan waktu koneksi kembali.
5. **Retur menggunakan nilai bertanda negatif pada TaxTransaction.** Karena itu tax summary periode otomatis mengurangi output/input tax sesuai retur yang diposting.
6. **Transfer internal Kas ↔ Bank bukan cash flow perusahaan.** Analytics cash-flow mengambil debit/credit akun kas/bank dari jurnal dan mengecualikan `BALANCE_TRANSFER`.

## Endpoint laporan

- `GET /reports/profit-loss`
- `GET /reports/trial-balance`
- `GET /reports/balance-sheet`
- `GET /reports/general-ledger`
- `GET /reports/tax-summary`
- `GET /reports/financial-integrity`
- `GET /reports/inventory-valuation`

Semua endpoint menggunakan company/branch dari authenticated token. Parameter tenant legacy hanya untuk kompatibilitas dan tidak menjadi sumber otoritas.

## Financial integrity

Status:

- `PASS`: tidak ada structural blocker atau item rekonsiliasi pending.
- `WARN`: double entry tetap sehat, tetapi masih ada accounting event PENDING/VALIDATED, finance transaction DRAFT/WAITING_APPROVAL/APPROVED, atau TaxTransaction CALCULATED.
- `FAIL`: terdapat journal yang tidak seimbang, AccountingEvent FAILED, AccountingEvent POSTED tanpa journal, trial balance berbeda, atau accounting equation tidak seimbang.

Status ini adalah kontrol integritas, bukan pengganti audit eksternal atau kewajiban perpajakan resmi.

## Fiscal close

Periode tidak dapat ditutup jika masih ada:

- journal entry tidak seimbang;
- accounting event `PENDING`, `VALIDATED`, atau `FAILED`;
- accounting event `POSTED` tanpa journal;
- finance transaction `DRAFT`, `WAITING_APPROVAL`, atau `APPROVED`;
- TaxTransaction `CALCULATED` yang belum diposting.

Periode yang tumpang tindih pada company/branch yang sama ditolak.

## TAX_PAYMENT

`TAX_PAYMENT` sekarang mempunyai posting rule sendiri:

- Debit: akun utang pajak aktif (`2103`, `2201`, atau `2202`)
- Credit: akun aset settlement aktif (Kas/Bank)

Pembayaran pajak **tidak** membuat TaxTransaction baru karena kewajiban pajaknya sudah dibentuk oleh transaksi sumber.

### Upgrade database existing

Tahap ini tidak menambah kolom/schema baru. Namun posting rule `TAX_PAYMENT` adalah data konfigurasi. Setelah source diperbarui pada database existing, **jalankan canonical seed** agar rule `TAX-PAYMENT` dan konfigurasi canonical lain di-upsert sebelum menggunakan fitur tersebut.

Contoh sesuai package manager/deployment repo:

```text
npm run db:seed
```

Gunakan command canonical yang didefinisikan repo bila nama script berbeda pada environment deployment.

## Export report

Renderer yang benar-benar tersedia saat baseline ini adalah **CSV**. API tidak lagi mengiklankan XLSX/PDF/JSON sebagai hasil export jika worker belum mempunyai renderer yang sesuai. Report worker mendukung:

- SALES
- PRODUCTS
- PROFIT_LOSS
- TRIAL_BALANCE
- BALANCE_SHEET
- GENERAL_LEDGER
- TAX_SUMMARY

## Inventory valuation

Endpoint inventory valuation tetap pageable untuk detail, tetapi `summary.inventoryValue` dihitung dari seluruh inventory branch yang dipilih, bukan hanya page aktif. Owner Suite menggunakan summary ini agar kartu nilai persediaan tidak salah karena pagination.

## Deployment gate yang disarankan

Sebelum production:

1. Jalankan canonical seed pada database target.
2. Jalankan repository/workflow validator.
3. Jalankan seluruh regression test.
4. Jalankan runtime integration dengan database asli.
5. Buat transaksi uji minimal: POS cash, storefront prepaid, COD/AR + collection, goods receipt/AP + supplier payment, supplier return/refund, sale return, operating expense, other income, dan TAX_PAYMENT.
6. Pastikan `financial-integrity` menghasilkan `PASS` setelah semua draft/pending test diselesaikan.
7. Cocokkan trial balance, balance sheet, profit-loss, tax summary, dan general ledger pada rentang tanggal yang sama.
8. Baru lakukan fiscal close.

Static/regression PASS tidak menggantikan runtime integration dengan database target dan provider pembayaran sebenarnya.
