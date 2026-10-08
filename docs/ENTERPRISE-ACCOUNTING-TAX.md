# Enterprise Accounting and Tax Architecture

## Tujuan

Seluruh domain Toko360 wajib memakai satu mesin accounting event, posting rule, tax code, tax transaction, tax document, approval, audit, dan close control. Tidak boleh ada modul yang langsung membuat jurnal dengan rumus sendiri kecuali melalui `AccountingCoreService`.

## Cakupan lintas modul

| Domain | Accounting event | Pajak | Posting utama |
|---|---|---|---|
| POS dan penjualan | `SALE_CASH`, `SALE_BANK` | Pajak keluaran | Kas/bank, penjualan, pajak, HPP, persediaan |
| Pesanan online prepaid | `ONLINE_ORDER_PREPAYMENT` lalu `ONLINE_ORDER_PREPAID_FULFILLED` | Pajak keluaran saat fulfillment | Kas/bank → uang muka pelanggan, lalu revenue/pajak/HPP/persediaan saat ship |
| Pesanan online COD/Invoice | `ONLINE_ORDER_CREDIT_FULFILLED`, `CUSTOMER_RECEIPT` | Pajak keluaran saat fulfillment | Piutang pelanggan/COD, revenue, pajak, HPP, persediaan; settlement saat diterima |
| Penerimaan supplier | `PURCHASE_RECEIPT_CREDIT` | Pajak masukan | Persediaan, pajak masukan, utang supplier |
| Pembayaran supplier | `SUPPLIER_PAYMENT` | Tidak membuat pajak baru | Utang supplier, kas/bank |
| Retur pelanggan | `SALE_RETURN` | Pembalik pajak keluaran | Retur penjualan, refund, persediaan, pembalik HPP |
| Retur supplier | `PURCHASE_RETURN`, `SUPPLIER_REFUND` | Pembalik pajak masukan pada retur | Pengurang utang atau piutang refund supplier, persediaan, pajak masukan; settlement refund terpisah |
| Transfer gudang | `STOCK_TRANSFER_SHIPPED/RECEIVED` | Tidak kena pajak internal | Persediaan dan persediaan dalam perjalanan |
| Stock opname | `STOCK_OPNAME_ADJUSTMENT` | Tidak otomatis kena pajak | Keuntungan/kerugian dan persediaan |
| Biaya umum | `OPERATING_EXPENSE` | Pajak masukan/withholding configurable | Beban, pajak, kas/bank/utang |
| Pendapatan lain | `OTHER_INCOME` | Pajak keluaran configurable | Kas/bank/piutang, pendapatan, pajak |
| Mutasi kas/bank | `BALANCE_TRANSFER` | Tidak ada kecuali dikonfigurasi | Debit akun tujuan, kredit akun asal |
| Payroll | `PAYROLL_POSTED` | Pemotongan payroll | Beban gaji, utang gaji, pajak/iuran |
| Aset | Acquisition/depreciation/maintenance | Pajak masukan dan pajak aset | Aset, akumulasi, beban, kas/utang |
| Armada | Fuel/maintenance/delivery expense | Pajak biaya configurable | Beban kendaraan, pajak, kas/utang |

## Komponen data

- `AccountingEvent`: fakta bisnis immutable/idempotent.
- `AccountingEventLine`: detail item, kuantitas, net, pajak, gross, dan dimensi.
- `AccountingPostingRule`: aturan debit/kredit berversi, bertanggal efektif, dan dapat berbeda per perusahaan.
- `AccountingPosting`: jejak event → rule → journal.
- `TaxCode`: tarif, inclusive/exclusive, scope, akun, periode berlaku, status, dan referensi aturan.
- `TaxTransaction`: ledger pajak input, output, withholding, atau self-assessed.
- `TaxDocument`: nomor, counterparty, periode, status, dan file/evidence.
- `OperationalFinanceTransaction`: pintu masuk biaya, pendapatan lain, penerimaan/pembayaran, dan transfer kas/bank.
- `FiscalPeriod` dan `AccountingCloseControl`: mencegah posting ke periode terkunci.

## Prinsip wajib

1. Semua mutasi memakai `idempotencyKey`.
2. Debit harus sama dengan kredit sebelum commit.
3. Tarif pajak tidak ditanam di service; tarif adalah master data berversi.
4. Tax code DRAFT tidak boleh dipakai transaksi production.
5. Semua angka transaksi disimpan sebagai snapshot agar perubahan master tidak mengubah histori.
6. Jurnal posted tidak diedit; koreksi memakai reversal/adjustment event.
7. Period close memblokir posting atau mewajibkan approval khusus.
8. Dimensi minimal: company, branch, source type, source ID, business date, counterparty, dan currency.
9. Posting, stok, pajak, audit, dan outbox untuk satu transaksi wajib berada dalam satu database transaction.
10. Export pajak dan integrasi akuntansi eksternal memakai plugin adapter, bukan mengubah core.

## Tax engine dinamis

Tax engine mendukung:

- tarif nol maupun tarif persentase;
- inclusive dan exclusive;
- pajak masukan recoverable/non-recoverable;
- output tax;
- withholding;
- effective date dan versioning;
- tax category produk/supplier/customer;
- override per transaksi dengan permission;
- pembalik pajak pada retur;
- tax period, tax document, calculation trace, dan audit.

Nilai resmi, kewajiban dokumen, format ekspor, dan aturan pembulatan harus dikonfigurasi serta diverifikasi tenaga pajak sebelum production.

## API utama

`POST /api/v1/finance-operations` wajib menerima operation key stabil dari klien melalui `Idempotency-Key` atau `idempotencyKey`; server tidak boleh membuat random fallback untuk mutasi yang dapat di-retry.

```text
GET/POST /api/v1/accounting-core/tax-codes
GET/POST /api/v1/accounting-core/posting-rules
GET      /api/v1/accounting-core/events
POST     /api/v1/accounting-core/events/manual
GET/POST /api/v1/finance-operations
GET      /api/v1/finance-operations/supplier-payables
GET      /api/v1/finance-operations/supplier-refunds
GET      /api/v1/finance-operations/customer-receivables
POST     /api/v1/finance-operations/{id}/approve
POST     /api/v1/finance-operations/{id}/post
```

## Skalabilitas

- ledger memakai cursor pagination dan indeks tenant/date/source;
- laporan memakai SQL aggregation dan summary tables;
- ekspor besar memakai `ReportJob` worker;
- ledger besar dipartisi bulanan/tahunan di PostgreSQL;
- audit/outbox mempunyai retention dan archive policy;
- read replica hanya untuk laporan, bukan posting transaksi.
