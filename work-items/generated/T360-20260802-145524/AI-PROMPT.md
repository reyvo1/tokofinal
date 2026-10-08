# Prompt Pelaksana — T360-20260802-145524

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260802-145524
- Judul: Menegakkan isolasi company dan branch di seluruh endpoint
- Modul: tenant
- Wave: W0
- Risk: CRITICAL
- Work item file: work-items/active/T360-20260802-145524-menegakkan-isolasi-company-dan-branch-di-seluruh-endpoint.json

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
- Seluruh endpoint operasional menerapkan company/branch scope.
- Pengguna cabang A tidak dapat membaca atau mengubah data cabang B.
- Worker dan report job tidak memproses data di luar tenant context.

## Test plan
- Integration test akses silang tenant pada produk, stok, jurnal, pajak, payroll, dan pembayaran.
- Security test token tanpa branch assignment.
- Sync retry test memastikan envelope tenant tetap idempotent.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
