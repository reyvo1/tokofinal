# W2 PPOB cash prepayment + settlement — 2026-10-09

## Authority and scope

Work item `T360-20261009-033700`, `docs/DEVELOPMENT-KIT.md`, accounting posting core, exact tenant `AuthUser`, P5 four-view POS, existing Digiflazz worker. Only CASH tender; no unsupported bank/card/offline tender. No weakening of official quality gates, product matrix, P5 or Human Stage-20 status.

## State machine

1. Admin/Finance verifies tax treatment of the exact provider product. This milestone permits only explicitly documented `NO_TAX_VERIFIED`; other taxable products MUST NOT be sold pending Tax Core integration. Verification is not tax advice and must reference a real policy decision.
2. Admin configures connected Digiflazz encrypted secrets, active tenant/branch provider `ASSET` account and **explicit** `integration.config.ppobCashEnabled=true`. Default OFF. Admin must verify chart accounts 1101 Cash, 2105 Customer Advances, 4104 Service Revenue, 5101 COGS and active rules `DIGITAL_SERVICE_PREPAYMENT`, `DIGITAL_SERVICE_FULFILLED`, `DIGITAL_SERVICE_REFUND`.
3. Cashier opens shift; sees current provider catalog; confirms receipt of physical cash and accurate destination; server validates positive bounded provider cost and maxPrice, tax classification, posting rules, provider asset account and tenant scope **before writing cash**.
4. One SERIALIZABLE DB transaction creates immutable request with operator-scoped idempotency, POSTED Accounting Core event `DIGITAL_SERVICE_PREPAYMENT` (Dr cash 1101 / Cr advances 2105), shift binding, and provider outbox. Failure rolls all of them back. Identical retry returns original paid row; changed payload rejects.
5. Worker rejects any historical unpaid queue row, mismatched prepayment event, provider mismatch or missing credentials BEFORE networking. Digiflazz reference number is stable on retry. `PENDING` remains pending when provider response is unrecognized. No early refund for an unknown network outcome.
6. Admin/Finance confirms SUCCESS, final provider cost and `ASSET` provider balance, then posts `DIGITAL_SERVICE_FULFILLED` (Dr advance / Cr service revenue, Dr COGS / Cr provider ASSET). FINANCE-led operation is idempotent.
7. For unequivocal provider FAILED only, Admin/Finance can refund to an OPEN shift whose physically available drawer balance covers the total; Accounting Core posts `DIGITAL_SERVICE_REFUND` (Dr customer advance / Cr cash 1101), records refund shift and timestamps atomically.

## Safety, boundaries and evidence

- API/POS do not accept arbitrary tenant identifiers, claims of paid state or direct sales ledger lines from clients. Tax, price and shift come from current server state.
- Product tax-verification metadata is trusted only if written by Finance, not from provider catalog; sync keeps it only while product name/category/type remain unchanged.
- Captured/refunded amounts are included in `shiftCashSummary` to avoid double counting or hiding drawer shortages.
- Existing legacy rows without POSTED prepayment are **blocked from provider dispatch** and must be reconciled manually (do not forge payment evidence).
- Scope deliberately excludes automatic bank settlement, provider-wallet topups, reconciliation with external Digiflazz statements, provider refund callbacks, on-account PPOB, detailed Tax Core computation for taxable products, and standalone CashMovement/shift variance general-ledger posting. They remain release blockers or separate work items.
- Default-off tenant feature flag is safe rollback for new orders; do **not** delete immutable posted journals or auto-reverse provider success. Paid outbox already queued must be reconciled before any rollback/downgrade.
- SQLite/PostgreSQL migration is strictly additive: new nullable receipt/shift reference fields and indexes; no forced backfill; test on disposable snapshots, never push/reset production databases.
- Required: full dependent TypeScript/Prisma local gate on Ubuntu, SQLite+PostgreSQL migration rehearsal, real HTTP/DB/worker/Browser UAT, real provider certification, exact-commit GitHub Full System Simulation + Automated UAT, separate visual acceptance and Human Stage-20.
- No external provider network call or GitHub push was performed when generating this candidate. Source-only passing tests **do not** mean UAT final.

- POS must show the customer's change when cash received exceeds the server sale price, and require cashier acknowledgement that change was returned. The journal records the **net sale price**, not the banknote face value.
- Ambiguous provider `error` statuses are PENDING, not proof of terminal failure eligible for a cash refund; only explicit `gagal`/`failed` is treated as FAILED.
- The cashier's maximum provider cost cannot exceed the customer sale price unless a separate approved loss policy is implemented (not included here).
