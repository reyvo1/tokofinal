# Asset, Fleet, and Delivery Operations

Dokumen ini menjelaskan perilaku yang benar-benar tersedia pada baseline Asset/Fleet reconciliation. Prinsipnya: perubahan nilai aset, biaya maintenance/BBM, stok part, utang supplier, pajak, dan operasi armada harus mempunyai sumber transaksi yang dapat ditelusuri dan tidak boleh dibukukan dua kali.

## Aset

Toko360 menyimpan aset per company/branch dengan kategori, gudang/lokasi, supplier, tanggal perolehan/capitalization, acquisition cost, residual value, accumulated depreciation, book value, assignment, inspection, dan histori transaksi.

### Akuisisi

- `acquisitionDate` menjadi business date pajak, capitalization, accounting event, dan histori aset.
- `CASH` menggunakan Kas `1101`, `BANK` menggunakan Bank `1102`, dan `CREDIT` menggunakan Utang Usaha `2101`.
- Akuisisi `CREDIT` wajib mempunyai supplier agar liability dapat direkonsiliasi dan dibayar dari modul Finance.
- Tax code harus valid untuk company dan business date melalui accounting/tax core.

### Depresiasi

Baseline ini hanya memposting metode `STRAIGHT_LINE`. Metode lain dihentikan untuk review, bukan dihitung dengan asumsi.

- Run memakai rentang business date dan menolak overlap dengan run `POSTED` sebelumnya.
- Jumlah bulan dihitung dari rentang run dan capitalization date.
- Book value tidak boleh turun di bawah residual value.
- Kategori aset wajib mempunyai depreciation expense account dan accumulated depreciation account.
- Run tanpa aset yang benar-benar dapat didepresiasi ditolak agar tidak menghasilkan dokumen nol.

### Maintenance dan part

Maintenance completion berjalan dalam satu transaksi database:

- work order yang sudah `COMPLETED` aman terhadap retry;
- inspection, bila dipakai, harus `PASSED`/`APPROVED`;
- odometer kendaraan tidak boleh mundur;
- biaya vendor memakai business date `completedAt` dan tax engine;
- maintenance kredit wajib mempunyai supplier pada work order;
- part mengurangi inventory fisik dan, bila batch-tracked, batch sumbernya;
- stok batch yang masih reserved tidak boleh dikonsumsi;
- biaya part diposting `Dr maintenance expense / Cr inventory` melalui `ASSET_MAINTENANCE_PARTS`;
- part serial **belum** boleh dikonsumsi dari endpoint maintenance ini. Sistem menolak transaksi sampai workflow serial-specific tersedia, sehingga trace serial tidak hilang.

### Transfer aset

`POST /assets/:id/transfer` adalah transfer custody/lokasi **di dalam branch terautentikasi**. Ia membutuhkan inspection Asset yang lulus dan menolak aset yang masih mempunyai maintenance aktif atau kendaraan yang sedang digunakan. Retry dengan inspection yang sama tidak membuat transfer kedua. Transfer intra-branch tidak membuat jurnal karena tidak mengubah nilai ekonomis aset.

Cross-branch transfer bukan bagian dari endpoint ini dan harus menggunakan workflow antar-cabang yang mempunyai approval/handover terpisah.

### Sale / disposal

Pelepasan aset membutuhkan inspection yang lulus dan rekonsiliasi:

`acquisition cost - accumulated depreciation = book value`.

Jika invariant tidak cocok, disposal dihentikan dengan `ASSET_BOOK_VALUE_RECONCILIATION_REQUIRED`.

Posting `ASSET_DISPOSAL` menangani asset cost, accumulated depreciation, output tax bila ada, serta gain (`4202`) / loss (`6202`). Settlement SALE pada baseline ini hanya `CASH` atau `BANK`. Penjualan aset kredit sengaja ditolak sampai ada workflow customer/counterparty AR yang dapat menelusuri Piutang Usaha secara benar.

## Fleet

Kendaraan dapat direlasikan ke Asset bertipe `VEHICLE`. Satu Asset tidak boleh terhubung ke dua vehicle master pada branch yang sama.

### Delivery trip dan COD

- start odometer tidak boleh lebih kecil dari current odometer kendaraan;
- planned return tidak boleh lebih awal dari planned departure;
- loading/dispatch tetap tunduk pada manifest, inspection, dan gate-pass yang berlaku;
- COD per stop tidak boleh melebihi `codExpected` dan hanya dapat dicatat untuk hasil pengiriman yang valid;
- COD dari semua stop diringkas ke `DeliveryTrip.codCollected`, sehingga summary armada dapat menghitung expected, collected, dan variance;
- close trip memerlukan post-trip inspection dan end odometer yang monotonic.

### BBM

Fuel entry menggunakan `transactionDate` sebagai business date pajak/jurnal.

- wajib mempunyai `receiptNumber` atau `evidenceReference` sebagai trace/retry key;
- retry identik mengembalikan transaksi yang sama; evidence/receipt yang sama dengan nilai berbeda ditolak;
- odometer tidak boleh mundur dari vehicle/trip;
- `CASH` → Kas, `BANK` → Bank, `CREDIT` → Utang Usaha;
- BBM kredit wajib mempunyai `supplierId`;
- supplier/date disimpan pada `FuelTransaction` untuk reconciliation AP.

## Supplier payable

Daftar `GET /finance-operations/supplier-payables` sekarang dapat menggabungkan liability dari:

- `GoodsReceipt`;
- `Asset` acquisition credit;
- `MaintenanceWorkOrder` credit;
- `FuelTransaction` credit.

Settlement supplier tetap memakai `SUPPLIER_PAYMENT` dan melakukan pengecekan available outstanding saat create maupun saat posting, sehingga draft/pembayaran concurrent tidak boleh overpay.

## Read models untuk Admin

Backend menyediakan:

- `GET /assets/summary`
- `GET /assets/maintenances`
- `GET /fleet/summary`
- `GET /fleet/trips`
- `GET /fleet/fuel`

Admin Asset & Fleet menggunakan endpoint nyata tersebut; nilai aset memakai `acquisitionCost`, `accumulatedDepreciation`, dan `bookValue`, bukan field UI buatan.

## Deployment existing database

Lihat `database/migrations/T360-20260911-asset-fleet-reconciliation/README.md`. Existing database harus menerima expand migration `FuelTransaction.supplierId`, lalu canonical configuration seed/upsert yang aman agar akun `4202`, `6202` serta posting rule `ASSET-MAINTENANCE-PARTS` dan `ASSET-DISPOSAL` tersedia.

Historical `FLEET_FUEL_CREDIT` yang dibuat sebelum supplier trace tersedia tidak boleh otomatis dianggap payable supplier sampai evidence/supplier-nya direkonsiliasi.
