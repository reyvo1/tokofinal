# Prompt Pelaksana — T360-20260823-112807

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-112807
- Judul: Membuat nomor dokumen atomik per company branch dan jenis dokumen
- Modul: database
- Wave: W0
- Risk: HIGH
- Work item file: work-items/active/T360-20260823-112807-membuat-nomor-dokumen-atomik-per-company-branch-dan-jenis-do.json

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
- Tidak terjadi nomor duplikat pada transaksi paralel.
- Format nomor dapat dikonfigurasi tanpa mengubah ID UUID.

## Test plan
- Concurrency test 100 generator nomor pada branch yang sama.
- Idempotency retry test untuk operation yang sama.
- Migration test expand-only pada SQLite dan PostgreSQL.
- Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.
- Journal debit-credit dan idempotent posting test sesuai event pekerjaan.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
