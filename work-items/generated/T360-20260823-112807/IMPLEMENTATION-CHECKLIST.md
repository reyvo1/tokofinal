# Implementation Checklist — T360-20260823-112807

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

- [ ] Concurrency test 100 generator nomor pada branch yang sama.
- [ ] Idempotency retry test untuk operation yang sama.
- [ ] Migration test expand-only pada SQLite dan PostgreSQL.
- [ ] Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.
- [ ] Journal debit-credit dan idempotent posting test sesuai event pekerjaan.
- [ ] Jalankan `npm run quality:fast`.
- [ ] Jalankan `npm run quality:full` sebelum release.
- [ ] Catat evidence dan known issues pada work item/handoff.

## Release

- [ ] UAT atau staging selesai.
- [ ] Rollback plan telah diuji atau direview.
- [ ] Monitoring aktif.
- [ ] Work item dipindahkan ke RELEASE_READY, RELEASED, lalu CLOSED sesuai evidence.
