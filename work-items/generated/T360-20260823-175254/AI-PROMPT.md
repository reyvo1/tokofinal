# Prompt Pelaksana — T360-20260823-175254

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-175254
- Judul: Menerapkan idempotency pada seluruh transaksi mutasi utama
- Modul: platform
- Wave: W0
- Risk: CRITICAL
- Work item file: work-items/active/T360-20260823-175254-menerapkan-idempotency-pada-seluruh-transaksi-mutasi-utama.json

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
- Penjualan, penerimaan supplier, pembayaran, retur, payroll, aset, dan inspeksi aman terhadap retry.
- Duplicate request menghasilkan respons konsisten tanpa stock movement atau journal baru.

## Test plan
- Idempotency test penjualan dan inventory movement.
- Retry test payment webhook dan sync offline.
- Journal debit-credit test memastikan tidak ada posting ganda.
- Tax transaction replay test berdasarkan versi aturan berlaku.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
