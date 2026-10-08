# Prompt Pelaksana — T360-20260823-224136

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-224136
- Judul: Menyelesaikan absensi fingerprint foto GPS dan geofence
- Modul: attendance
- Wave: W4
- Risk: HIGH
- Work item file: work-items/active/T360-20260823-224136-menyelesaikan-absensi-fingerprint-foto-gps-dan-geofence.json

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
- Fingerprint, selfie, GPS, geofence, shift, koreksi, dan approval menghasilkan attendance record konsisten.
- Karyawan hanya melihat data absensi sendiri.

## Test plan
- Device adapter contract test.
- Offline sync retry/idempotency test.
- Payroll attendance input integration test.
- Security test foto privat dan employee self-scope.
- Journal debit-credit dan idempotent posting test sesuai event pekerjaan.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
