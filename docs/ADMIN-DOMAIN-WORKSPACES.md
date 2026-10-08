# Admin Domain Workspaces — UI-P2

UI-P2 memecah Admin dari satu level workspace menjadi information architecture dua tingkat tanpa menduplikasi business logic.

## Route model

Top-level workspace tetap canonical dari UI-P1. Domain yang mempunyai workflow besar mendapat nested operator workspace:

- `/master-data/{catalog|organization|locations|references}`
- `/procurement/{requests|orders|receipts|inventory}`
- `/commerce/{orders|fulfillment|returns|channels}`
- `/inventory-control/{traceability|returns|transfers|stocktake}`
- `/operations-control/{inspections|evidence|gate-pass|delivery}`
- `/finance/{ledger|payables|receivables|banking|reports}`
- `/people/{employees|attendance|payroll|compliance}`
- `/assets-fleet/{assets|maintenance|vehicles|trips}`
- `/extensions/{loyalty|devices|notifications|integrations}`
- `/platform/{features|users|security|api-keys}`

## Invariants

- Nested route adalah information architecture, bukan security boundary.
- API permission/tenant guard tetap authoritative.
- Existing forms, tables, mutations, idempotency, accounting, inventory, payroll, dan audit flow tidak dipindahkan ke client logic baru.
- Invalid nested route fail-safe kembali ke root domain, bukan membuka arbitrary page.
- Direct reload memakai authenticated Admin shell yang sama.
- Runtime module/feature/role/permission/UiSchemaDefinition dari UI-P1 tetap menentukan top-level visibility.

## Operator experience

Admin shell menyediakan:

- breadcrumb tiga tingkat;
- sticky secondary domain navigation;
- overview deck untuk masuk ke area kerja;
- contextual title/description per sub-workspace;
- stable deep links yang dapat dibookmark dan dibagikan di dalam organisasi.

UI-P2 sengaja tidak mengubah database, endpoint, atau business transaction behavior.
