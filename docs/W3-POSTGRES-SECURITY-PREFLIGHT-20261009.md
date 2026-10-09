# W3 — PostgreSQL money-safety security preflight (2026-10-09)

Authority: active work item `T360-20261009-101100`, current P5 `IMPLEMENTED_RUNTIME_PENDING`. This is an extension of the **existing** `ci:w3:postgres-probe`, not a second financial ledger or alternate UAT runner.

## Executed CI TEST/STAGING checks

Runs on the exact six-app runtime against the same protected, explicitly named local PostgreSQL staging database and API. Existing source fingerprint, target lock, automatic FAIL evidence, four real Finance posting rules, actual POSTED journal lines, idempotent replay, overdraft, variance and no-double-close checks remain mandatory.

Three additional negative groups run before/alongside authorized transactions:

1. A dedicated authenticated `CASHIER` must receive 403 on `POST /accounting-core/accounts` and `POST /accounting-core/posting-rules`. Both attempts must leave **zero** account and posting-rule rows, not merely return an error.
2. Before Finance provisions posting rules, a real shift is opened. `CASH_IN` must return 400, leave the drawer empty and no event. A nonzero variance close must return 400, leaving that same shift OPEN; no hidden journal or synthetic backfill. The check rejects a reused/dirty W3 rule fixture instead of silently omitting the missing-rule case.
3. After Finance activates the four legitimate rules and posts cash in, a greater-than-5% `CASH_OUT` without supervisor grant must return 403 and leave the cash movement count unchanged. The small authorized withdrawal still posts balanced journal lines.

## Financial invariants and test isolation

The probe never runs against production. It creates a unique CI cashier and dedicated asset/expense/revenue accounts on a disposable staging database and retains posted journal history for audit. All unknown/locked target identities fail before importing Prisma or invoking APIs. No real cash is captured and no provider or hardware is contacted. This probe must PASS in *both* heavy GitHub workflows, and the aggregate/R8 summaries must consume source-matching evidence. Human Stage-20 remains PENDING.

## Release/operator steps

Only after the official Ubuntu `npm run uat:pre-github:local` passes may the operator commit/push this W3 source to the verified `reyvo1/tokofinal` origin. GitHub Full System Simulation and Full Automated UAT must then PASS on the exact same commit. No test, assertion, or source identity guard has been weakened.

## Rollback

Rollback source with the checksum-bound local backup before GitHub push if the local gate fails. Any committed Accounting Core journal in CI should be retained as evidence until the whole isolated staging database is discarded; never delete an individual POSTED journal to hide failures. The Finance rule activation guard remains fail-closed.
