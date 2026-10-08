# Procurement and Supplier Payable Integrity

Dokumen ini mencatat alur canonical procurement Toko360 setelah hardening integritas transaksi.

## Alur canonical

```text
Purchase Order APPROVED
  -> Goods Receipt DRAFT / PENDING_INSPECTION
  -> Inspection PASSED atau PARTIAL lalu APPROVED
  -> Goods Receipt confirm
       -> stok agregat bertambah
       -> batch penerimaan bertambah
       -> receivedQty Purchase Order bertambah
       -> accounting event PURCHASE_RECEIPT_CREDIT
       -> tax input tercatat
       -> outbox + audit tercatat
  -> Supplier Payable read model
       = gross receipt - completed supplier returns - posted supplier payments
  -> Supplier Payment DRAFT
  -> Supplier Payment POSTED
       -> Dr 2101 Utang Usaha
       -> Cr akun kas/bank yang dipilih

Supplier Return
  -> harus menunjuk Goods Receipt yang sudah diposting
  -> cumulative return tidak boleh melebihi acceptedQty sumber
  -> stok agregat dan source batch berkurang
  -> accounting/tax reversal + audit/outbox satu transaksi database
```

## Guard integritas

- Purchase Order dan Goods Receipt menerima `idempotencyKey` untuk retry jaringan aman.
- Perhitungan nilai Purchase Order menggunakan `Prisma.Decimal`, bukan floating arithmetic JavaScript.
- Quantity Goods Receipt divalidasi saat draft dan divalidasi ulang ketika posting sehingga dua draft paralel tidak dapat membuat over-receipt.
- Inspection Goods Receipt harus memakai quantity yang konsisten dengan Goods Receipt. Status `PARTIAL` yang diblokir policy harus di-approve sebelum posting.
- Pembuatan supplier return, inspeksi, audit, dan receipt idempotency berada dalam satu serializable transaction; retry jaringan tidak membuat dokumen yatim/ganda.
- Supplier return divalidasi secara kumulatif pada create dan confirm; source batch juga wajib mempunyai quantity tidak-reserved yang cukup.
- Supplier return membagi nilai retur menjadi pengurang AP (`2101`) sebesar utang yang masih terbuka dan, bila invoice sudah terbayar, Piutang Refund Supplier (`1202`). Bagian piutang supplier wajib mempunyai nomor credit note sebelum retur diposting sehingga Utang Usaha tidak pernah menjadi negatif.
- Supplier payment wajib menunjuk Goods Receipt dan tidak boleh melebihi saldo utang yang masih tersedia setelah return, payment posted, dan draft payment lain.
- Posting supplier payment memakai event `SUPPLIER_PAYMENT`, bukan `BALANCE_TRANSFER`.

## Evidence penerimaan

- Foto evidence diunggah sebagai data ke API, diperiksa MIME + file signature, dibatasi 8 MiB, dihitung SHA-256, lalu disimpan oleh server. Client tidak dapat menyatakan `storageKey` arbitrary sebagai evidence terverifikasi.
- Barcode/SKU harus cocok dengan produk pada Goods Receipt. Setiap scan menaikkan `scannedQty` secara atomik dan finalisasi ditolak sampai jumlah scan memenuhi `expectedQty`.
- Checklist template penerimaan dimaterialisasi ke inspection result. Item wajib harus diputuskan `PASS` atau `FAIL`; item warning yang gagal masuk `REVIEW_REQUIRED`, sedangkan blocking failure masuk `FAILED`.

## Deployment

Tahap commerce/refund menambah field supplier credit-note/refund pada `PurchaseReturn` dan enum `SUPPLIER_REFUND`. Environment existing wajib menjalankan migration `database/migrations/T360-20260911-commerce-refund-integrity` sesuai provider lalu menjalankan seed/upsert resmi agar akun `1202`, `1203`, `2105` dan posting rule terbaru tersedia.
