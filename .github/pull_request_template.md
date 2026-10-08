## Work item

T360-YYYYMMDD-HHMMSS

## Perubahan

Jelaskan perubahan yang benar-benar dilakukan dan batas yang sengaja tidak dikerjakan.

## Dampak lintas modul

- Database: NONE/LOW/MEDIUM/HIGH — penjelasan
- Inventory: NONE/LOW/MEDIUM/HIGH — invariant/movement
- Accounting: NONE/LOW/MEDIUM/HIGH — event/posting/reversal
- Tax: NONE/LOW/MEDIUM/HIGH — rule/version/period
- Payment/Payroll/Asset/Fleet: penjelasan
- Sync/Integration: idempotency/retry/conflict
- Security/Privacy: permission/tenant/data sensitif/audit
- Performance: pagination/index/query/queue

## Database dan migrasi

- Migration:
- Backfill:
- Compatibility:
- SQLite/PostgreSQL parity:

## Pengujian

Tuliskan perintah dan hasil unit, integration, database, concurrency, UAT, serta performance yang relevan.

## Rollback

Jelaskan feature flag, rollback aplikasi/migration, compensating operation, dan rekonsiliasi data.

## Checklist

- [ ] Work item valid dan fase minimal VERIFICATION
- [ ] Scope company/branch/warehouse/employee diuji
- [ ] Permission dan audit log diuji
- [ ] Inventory movement invariant diuji bila terdampak
- [ ] Debit = kredit dan idempotent posting diuji bila terdampak
- [ ] Versi/periode/reversal pajak diuji bila terdampak
- [ ] Retry/duplicate/offline/conflict diuji bila terdampak
- [ ] Pagination, indeks, dan performance budget diperiksa
- [ ] Migration dan rollback terdokumentasi
- [ ] Dokumentasi API/operasional diperbarui
- [ ] `npm run quality:full` lulus
