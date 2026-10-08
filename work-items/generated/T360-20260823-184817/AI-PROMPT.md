# Prompt Pelaksana — T360-20260823-184817

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-184817
- Judul: Menyelesaikan inspeksi barang masuk supplier sampai posting
- Modul: inbound-inspection
- Wave: W5
- Risk: HIGH
- Work item file: work-items/active/T360-20260823-184817-menyelesaikan-inspeksi-barang-masuk-supplier-sampai-posting.json

## Instruksi wajib
1. Baca docs/DEVELOPMENT-KIT.md, docs/DEVELOPMENT-WORKFLOW.md, work item, dan dokumen sumbernya.
2. Audit source yang ada sebelum mengedit.
3. Kerjakan hanya scope work item dan pertahankan kompatibilitas.
4. Semua data harus company/branch scoped.
5. Semua mutasi yang dapat diulang harus idempotent.
6. Stok hanya berubah melalui inventory movement; jurnal melalui accounting core; pajak melalui tax core.
7. Tambahkan permission, audit, validation, pagination/index bila relevan.
8. Tambahkan test sesuai test plan dan jalankan quality gate.
9. Perbarui work item dengan evidence, perubahan, known issues, dan rollback.
10. Jangan memakai database production, credential, atau data pelanggan nyata.

## Acceptance criteria
- PO, scan, kondisi, batch, bukti, approval, stok, utang, pajak, dan jurnal terhubung.
- Selisih blocking menahan posting sampai disetujui.

## Test plan
- Integration test PO-inspection-stock movement-payable-journal-tax.
- Inventory test barang rusak tidak menambah available stock.
- Journal debit-credit dan tax period test.
- Idempotency retry test konfirmasi penerimaan.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
