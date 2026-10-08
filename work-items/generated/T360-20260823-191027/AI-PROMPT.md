# Prompt Pelaksana — T360-20260823-191027

Kerjakan work item Toko360 berikut pada repository ini. Jangan membangun ulang modul yang sudah ada dan jangan mengubah alur stabil tanpa bukti.

## Identitas
- ID: T360-20260823-191027
- Judul: Menyelesaikan order website reservasi fulfillment dan pengiriman
- Modul: orders
- Wave: W2
- Risk: HIGH
- Work item file: work-items/active/T360-20260823-191027-menyelesaikan-order-website-reservasi-fulfillment-dan-pengir.json

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
- Order dari website masuk ke branch pemroses dan menghasilkan picking sampai delivery.
- Pembayaran dan pajak diposting tepat satu kali.

## Test plan
- E2E checkout-payment-reservation-fulfillment-stock-journal-tax.
- Idempotency webhook dan offline sync test.
- Performance test checkout paralel.

Berikan hasil berupa perubahan source code, migration aman bila diperlukan, test, dokumentasi, dan ringkasan evidence.
