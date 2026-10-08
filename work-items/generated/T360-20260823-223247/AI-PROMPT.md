# Prompt Pelaksana — T360-20260823-223247

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-223247
- Judul: Menyelesaikan laporan keuangan period close dan rekonsiliasi
- Modul: financial-reporting
- Wave: W3
- Risk: HIGH
- Work item file: work-items/active/T360-20260823-223247-menyelesaikan-laporan-keuangan-period-close-dan-rekonsiliasi.json

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
- Laba rugi, neraca, arus kas, buku besar, pajak, utang, dan piutang dapat direkonsiliasi.
- Laporan besar berjalan sebagai report job asynchronous.

## Test plan
- Journal-to-report reconciliation test.
- Tax period reconciliation test.
- Security test akses laporan lintas branch.
- Performance test jutaan journal line melalui summary/report job.
- Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.
- Sync idempotency, retry, offline, dan conflict test sesuai scope pekerjaan.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
