# Prompt Pelaksana — T360-20260823-230058

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-230058
- Judul: Membangun sinkronisasi dua arah server toko dan pusat
- Modul: sync-protocol
- Wave: W6
- Risk: CRITICAL
- Work item file: work-items/active/T360-20260823-230058-membangun-sinkronisasi-dua-arah-server-toko-dan-pusat.json

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
- Server toko tetap beroperasi offline dan menyinkronkan transaksi saat koneksi kembali.
- Master data pusat turun ke toko tanpa menimpa transaksi lokal yang sah.

## Test plan
- Offline 8 jam lalu sync retry/idempotency test.
- Conflict test harga, customer, inventory movement, journal, tax, payroll, dan payment.
- Security test signature replay dan credential rotation.
- Performance test batch sync besar.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
