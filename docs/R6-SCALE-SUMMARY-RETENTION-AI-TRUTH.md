# R6 Scale, Summary, Retention/Archive, and Capability Truth

Baseline: commit `708d34cb7afd259c507844cadf065b23029797ec`, source fingerprint `91f5b3910bed430d5a682fb53a3ce8baf050884674be56269eb39af309781655` (629 files).

## Scope

- F26: product truth now names the feature **Forecast & Otomasi**. The operator assistant is explicitly deterministic/rule-based, source-linked, tenant/permission scoped, read-only, `aiProvider=null`, and makes no LLM/provider claim.
- F27: `POST /analytics/daily-summaries/materialize` rebuilds branch/day `DailySalesSummary` from completed sales and `DailyFinanceSummary` from canonical journal lines. `GET /analytics/daily-summaries` reads the materialized aggregates.
- F28: tenant retention policies are manageable through runtime API. Archive runs are incremental, checksum-bound, auditable, and fail closed until `DATA_ARCHIVE_STORAGE_PROVIDER=local` is deliberately configured. R6 archives source rows but never purges them.
- F29: `ExternalMapping` now has list/upsert/delete runtime lifecycle behind the tenant-owned `IntegrationConnection`; marketplace import automatically creates/updates its `MarketplaceOrder` external mapping.
- F30: `AccountingCloseControl` is canonical and already has exact-runtime proof from R4: closed period blocks posting, reopen restores posting, and audit lifecycle is active.

## Verification rule

F26-F29 remain `SOURCE_IMPLEMENTED_RUNTIME_EVIDENCE_PENDING` until `ci:r6:probe` passes on exact PostgreSQL source in both GitHub full-system workflows. F30 is `RUNTIME_CLOSED_R4`. R5 F31/F32/F33 are now `RUNTIME_CLOSED_R5` from the green exact-runtime evidence on commit `708d34cb...`.

Human Stage-20 remains PENDING and is not changed by R6 automation.
