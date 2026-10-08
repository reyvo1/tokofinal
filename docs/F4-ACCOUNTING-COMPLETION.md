# F4 Accounting Enterprise — Source Completion

Status: **SOURCE IMPLEMENTATION COMPLETE — runtime/browser/human UAT deferred by operator instruction**.

F4 memperkuat accounting core yang sudah authoritative tanpa membuat ledger kedua.

## Operator capability

- Chart of Accounts branch-scoped: create, rename, activate/deactivate.
- Account type yang sudah memiliki histori journal tidak dapat diubah.
- Akun yang masih dipakai posting rule ACTIVE tidak dapat dinonaktifkan.
- Posting rule tersedia sebagai konfigurasi versioned di Admin.
- Draft version boleh diedit selama belum pernah aktif/dipakai posting.
- Rule ACTIVE/INACTIVE atau rule yang sudah dipakai posting tidak dapat ditimpa; koreksi wajib version baru.
- Aktivasi rule memvalidasi debit+credit shape, literal account mapping, effective date, dan overlap eventType/priority.
- Accounting event drill-down mengikat source → event → posting rule version → journal entry → account lines.
- Fiscal OPEN/SOFT_CLOSED/CLOSED yang sudah ada tetap menjadi canonical posting lock.

## Safety / tenant contract

- Company dan branch berasal dari authenticated user.
- Account CRUD dibatasi branch aktif.
- Rule company-scoped; literal account mapping divalidasi ke account aktif branch operator.
- Cross-tenant reads/mutations fail-closed dan diaudit.
- Audit action `UPSERT_ACCOUNTING_POSTING_RULE` dipertahankan untuk backward compatibility; operation versioning ada pada payload.
- Existing posting engine, idempotency, debit-credit balance, period lock, tax ledger, dan journal append behavior tidak diganti.

## Verification

- F4 targeted + accounting tenant regression: **11/11 PASS**.
- `npm run workflow:validate`: PASS.
- `npm run validate:repo`: PASS.
- Full dependency-free regression: **762/762 PASS**.
- Runtime/browser/human UAT: deferred.

## Next phase

F5 Tax workspace dinamis.
