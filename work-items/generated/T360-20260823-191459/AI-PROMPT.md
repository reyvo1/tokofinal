# Prompt Pelaksana — T360-20260823-191459

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-191459
- Judul: Menyelesaikan accounting dan tax posting lintas seluruh modul
- Modul: accounting-core
- Wave: W3
- Risk: CRITICAL
- Work item file: work-items/active/T360-20260823-191459-menyelesaikan-accounting-dan-tax-posting-lintas-seluruh-modu.json

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
- Penjualan, pembelian, stok, biaya, payroll, aset, fleet, dan retur memakai posting engine yang sama.
- Subledger dapat direkonsiliasi ke general ledger.

## Test plan
- Journal debit-credit test seluruh event type.
- Tax version/effective period test dan reversal test.
- Idempotent accounting posting retry test.
- Performance test posting batch.
- Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
