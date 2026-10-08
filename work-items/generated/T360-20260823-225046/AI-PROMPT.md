# Prompt Pelaksana — T360-20260823-225046

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-225046
- Judul: Menyelesaikan trip manifest outbound inspection gate pass COD dan retur
- Modul: delivery-trip
- Wave: W5
- Risk: CRITICAL
- Work item file: work-items/active/T360-20260823-225046-menyelesaikan-trip-manifest-outbound-inspection-gate-pass-co.json

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
- Trip, driver, vehicle, manifest, loading, gate pass, proof of delivery, COD, dan return terhubung.
- Inventory movement mengikuti setiap perubahan custody barang.

## Test plan
- E2E order-outbound inventory movement-trip-delivery-COD-journal.
- Vehicle blocking inspection test.
- Offline sync retry/conflict test.
- Payment dan accounting idempotency test.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
