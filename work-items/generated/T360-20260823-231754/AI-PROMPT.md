# Prompt Pelaksana — T360-20260823-231754

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-231754
- Judul: Menerapkan partitioning retention summary queue dan performance budget
- Modul: performance
- Wave: W7
- Risk: HIGH
- Work item file: work-items/active/T360-20260823-231754-menerapkan-partitioning-retention-summary-queue-dan-performa.json

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
- Target jutaan transaksi memenuhi performance budget.
- Archive dapat direstorasi dan direkonsiliasi dengan ledger.

## Test plan
- Load test produk, sale, inventory movement, journal, tax, payroll, dan sync.
- Archive/restore test.
- Query plan dan index regression test.
- Backpressure dan worker retry test.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
