# Storefront Fulfillment Integrity

## Lifecycle resmi

```text
Order dibuat
→ stok available direservasi
→ metode pembayaran dipilih
→ (elektronik) provider/backoffice mengonfirmasi pembayaran
   atau (COD) fulfillment langsung dilepas
   atau (INVOICE) finance mengotorisasi termin
→ outbound inspection + foto + barcode/serial scan
→ inspection APPROVED tanpa blocking mismatch
→ PACKED
→ SHIPPED
→ stok fisik/reserved berkurang + HPP/revenue/pajak diposting
→ DELIVERED/COMPLETED
→ COD/INVOICE diselesaikan melalui CUSTOMER_RECEIPT
```

## Payment truth

Memilih `QRIS`, `TRANSFER`, atau `CARD` **bukan bukti pembayaran**. Public endpoint `POST /orders/:number/payment-selection` hanya memilih metode. Status `PAID` untuk metode elektronik hanya dapat dibuat oleh endpoint terautentikasi `POST /orders/:id/confirm-payment` dengan external reference yang sudah diverifikasi.

`MOCK_QRIS` hanya tersedia bila `ALLOW_MOCK_PAYMENTS=true` dan environment bukan production. Default seluruh env example adalah `false`. Route lama `/mock-pay` dipertahankan sebagai alias kompatibilitas dan tidak boleh ditafsirkan sebagai bypass pembayaran.

Pembayaran prepaid diposting terlebih dahulu sebagai `Dr Bank (1102) / Cr Uang Muka Pelanggan (2105)`. Revenue, output tax, HPP, dan inventory baru diposting saat shipment dikirim.

## Inventory truth

Order hanya mengurangi `available` dan menambah `reserved`. Physical `quantity` belum berubah. Shipment hanya dapat mengurangi `quantity` dan `reserved` setelah order `PACKED`, shipment `READY`, serta outbound inspection `APPROVED` tanpa mismatch/blocking failure. Produk batch mengikuti FEFO dari stok batch bebas; produk serial wajib mempunyai serial `RESERVED` untuk shipment dan jumlahnya tepat.

Cancel order sebelum pembayaran melepaskan reservation dan serial. Order `PENDING_PAYMENT` yang kedaluwarsa juga dilepas atomik oleh worker. Order yang sudah menerima pembayaran tidak dapat dibatalkan tanpa workflow refund.

## COD / Invoice

Saat shipment COD/INVOICE dikirim, accounting membentuk piutang (`1203 Piutang COD` atau `1201 Piutang Usaha`). Penerimaan uang menggunakan `CUSTOMER_RECEIPT` dan tidak menciptakan pajak baru. Cash-flow report mengecualikan row Payment COD/INVOICE dan memakai transaksi penerimaan piutang yang posted agar kas tidak dihitung dua kali.

## Outbound control

Outbound inspection memakai template checklist, evidence server-verified, barcode/SKU/serial yang harus cocok dengan order, dan scan count yang atomik. Required checklist harus `PASS` atau `FAIL`. Failure severity `BLOCKING` memblokir; failure warning masuk review. Pengiriman armada sendiri wajib gate pass outbound APPROVED/EXITED beserta kendaraan/plat. Pengiriman eksternal wajib carrier dan tracking number.

## Deployment

1. Terapkan migration `T360-20260911-commerce-refund-integrity` pada database existing.
2. Jalankan canonical seed/upsert untuk account dan accounting posting rule baru.
3. Set `ORDER_ACCESS_SECRET` berbeda dari default.
4. Pastikan `ALLOW_MOCK_PAYMENTS=false` pada production.
5. Atur `INSPECTION_EVIDENCE_DIR` ke storage persisten yang tidak berada di source package.
6. Jalankan regression + runtime integration sebelum rollout production.
