# Prompt Pelaksana — T360-20260823-103757

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-103757
- Judul: Menerapkan permission guard pada seluruh endpoint mutasi
- Modul: security
- Wave: W0
- Risk: HIGH
- Work item file: work-items/active/T360-20260823-103757-menerapkan-permission-guard-pada-seluruh-endpoint-mutasi.json

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
- Tidak ada endpoint mutasi tanpa permission metadata.
- Role dinamis dapat diberi atau dicabut permission tanpa perubahan source code.

## Test plan
- Unit test permission mapping.
- Integration test akses ditolak pada stock adjustment, journal posting, tax posting, payment refund, dan payroll approval.
- Sync idempotency, retry, offline, dan conflict test sesuai scope pekerjaan.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
