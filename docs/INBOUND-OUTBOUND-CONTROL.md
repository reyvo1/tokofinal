# Inbound, Outbound, Inspection, and Confirmation Control

## Prinsip

Barang tidak boleh langsung mengubah stok hanya karena dokumen dibuat. Setiap alur mempunyai tahap draft, scan, inspeksi, konfirmasi, posting, dan audit. Kebijakan ditentukan per perusahaan/cabang melalui `OperationPolicy`.

## Penerimaan supplier

```text
PO disetujui
→ Kendaraan/barang tiba dan gate pass inbound (opsional)
→ Goods receipt DRAFT
→ Scan barcode/SKU/batch/serial
→ Bandingkan ordered, delivered, accepted, damaged, rejected, missing, extra
→ Verifikasi surat jalan, invoice, tanggal kedaluwarsa, kondisi dan foto
→ Inspeksi PASSED/PARTIAL/FAILED
→ Konfirmasi petugas/supervisor
→ Stok accepted bertambah
→ Batch/serial dibuat
→ PO diperbarui
→ Utang, pajak masukan, jurnal, audit, dan outbox diposting atomik
```

Barang rusak/ditolak tidak masuk stok tersedia. Barang dapat masuk karantina atau dibuatkan purchase return.

## Barang keluar pelanggan

```text
Order/penjualan valid
→ Picking list
→ Scan item, batch, serial dan kuantitas
→ Packing dan label tujuan
→ Manifest kendaraan
→ Inspeksi outbound
→ Approval selisih bila ada
→ Gate pass outbound
→ Inventory movement dan shipment status
→ Proof of delivery
```

## Retur

- Retur pelanggan wajib terkait transaksi asli dan inspeksi kondisi.
- Barang GOOD dapat direstock; DAMAGED/QUARANTINE tidak masuk available stock.
- Refund, pembalik penjualan/HPP, dan pembalik pajak diposting melalui accounting core.
- Retur supplier wajib terkait penerimaan/PO, inspeksi outbound, stok cukup, dan gate pass bila diwajibkan.
- Pengurangan persediaan, pengurangan utang/kredit supplier, dan pembalik pajak masukan diposting atomik.

## Data kontrol

- `InspectionTemplate` dan item checklist berversi.
- `OperationalInspection`, result item, evidence, GPS, hash, dan reviewer.
- `OperationalConfirmation` untuk multi-confirmation.
- `GatePass` untuk barang/kendaraan masuk dan keluar.
- `OperationPolicy` untuk wajib scan, foto, batch, serial, kendaraan, geofence, tolerance, approval, dan auto-post.
- `AutomationJob` untuk tindakan asynchronous.

## Contoh kebijakan dinamis

Gudang kecil:

```json
{
  "requireInspection": true,
  "requireBarcodeScan": true,
  "requiredConfirmations": 1,
  "autoPostInventory": true
}
```

Gudang pusat:

```json
{
  "requireInspection": true,
  "requirePhoto": true,
  "requireBarcodeScan": true,
  "requireBatchScan": true,
  "requireSerialScan": true,
  "requireGatePass": true,
  "requiredConfirmations": 2,
  "blockOnMismatch": true,
  "autoPostAccounting": true,
  "autoCalculateTax": true
}
```
