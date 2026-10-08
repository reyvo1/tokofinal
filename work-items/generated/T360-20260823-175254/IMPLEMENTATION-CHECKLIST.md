# Implementation Checklist — T360-20260823-175254

## Analysis

- [ ] Baca work item dan seluruh dokumen sumber.
- [ ] Audit implementasi yang sudah ada; jangan membuat modul duplikat.
- [ ] Tetapkan system of record, state machine, invariant, dan failure modes.
- [ ] Konfirmasi dampak database, inventory, accounting, tax, payment, payroll, sync, security, dan performance.

## Design

- [ ] Tetapkan API/DTO/event contract.
- [ ] Tetapkan permission dan tenant/branch scope.
- [ ] Tetapkan idempotency key serta retry behavior.
- [ ] Tetapkan migration, index, pagination, retention, dan rollback.
- [ ] Tetapkan accounting/tax posting rule bila relevan.

## Implementation

- [ ] Implementasi kecil dan modular.
- [ ] Hindari jurnal, pajak, stok, atau notification logic tersebar di modul.
- [ ] Tambahkan audit event dan structured error.
- [ ] Perbarui dokumentasi dan feature flag.

## Verification

- [ ] Idempotency test penjualan dan inventory movement.
- [ ] Retry test payment webhook dan sync offline.
- [ ] Journal debit-credit test memastikan tidak ada posting ganda.
- [ ] Tax transaction replay test berdasarkan versi aturan berlaku.
- [ ] Jalankan `npm run quality:fast`.
- [ ] Jalankan `npm run quality:full` sebelum release.
- [ ] Catat evidence dan known issues pada work item/handoff.

## Release

- [ ] UAT atau staging selesai.
- [ ] Rollback plan telah diuji atau direview.
- [ ] Monitoring aktif.
- [ ] Work item dipindahkan ke RELEASE_READY, RELEASED, lalu CLOSED sesuai evidence.
