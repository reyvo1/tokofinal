# Prompt Pelaksana — T360-20260823-190003

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-190003
- Judul: Menstabilkan POS shift pembayaran refund dan rekonsiliasi
- Modul: pos
- Wave: W2
- Risk: CRITICAL
- Work item file: work-items/active/T360-20260823-190003-menstabilkan-pos-shift-pembayaran-refund-dan-rekonsiliasi.json

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
- Tunai, transfer, QRIS, kartu, split payment, hold, refund, dan close shift tercatat konsisten.
- Transaksi lokal dapat disinkronkan tanpa duplikasi.

## Test plan
- E2E POS sale-payment-stock-journal-tax.
- Payment callback replay test.
- Offline sync retry/conflict test.
- Concurrency dan performance test banyak kasir.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
