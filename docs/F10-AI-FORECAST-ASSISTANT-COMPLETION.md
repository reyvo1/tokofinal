# F10 AI / Forecasting / Operator Assistant — Source Completion

Status: **SOURCE IMPLEMENTATION COMPLETE — runtime/browser/human UAT deferred**.

## Canonical foundations preserved

- `ForecastRun` and `ReorderSuggestion` remain the forecasting source of truth.
- No second inventory, purchasing, accounting, reporting, or automation engine was introduced.
- Operator Assistant is read-only. It cannot create PO, change inventory, post journal, settle payment, or replay automation.

## Explainable forecast

Each reorder suggestion records:

- moving-average model;
- lookback, horizon, and lead time;
- sold units, available/reserved stock, and minimum stock inputs;
- explicit reorder formula;
- confidence score;
- source references to sale history and current inventory.

Forecast uses `Inventory.available` for replenishment decisions so non-sellable/reserved semantics are not silently treated as free stock.

## Operator insights

`OperatorInsight` stores source-linked observations for permitted domains:

- stock/reorder;
- failed accounting events;
- failed/retrying automation jobs;
- failed report jobs.

Insights are company/branch scoped and support OPEN → ACKNOWLEDGED/DISMISSED lifecycle with audit evidence.

## Operator Assistant

The assistant classifies a question into STOCK, FINANCE, AUTOMATION, REPORTING, or AUTO and only reads sources the authenticated user has permission to access. Every answer includes source links and a confidence value. If no permitted source exists, the response says so instead of fabricating context.

Recommendations carry `HUMAN_CONFIRMATION_REQUIRED`; business mutations stay in their canonical operator workspaces.

## Database

Expand-only migration:

`database/migrations/T360-20260923-f10-operator-ai/`

Adds:

- `OperatorInsight`
- `AssistantInteraction`

Migration is intentionally not auto-applied by the patch.

## Verification

- focused F10 + tenant regression: **20/20 PASS**
- `workflow:validate`: **PASS**
- `validate:repo`: **PASS** — 180 Prisma models, SQLite/PostgreSQL parity
- dependency-free regression: **805/805 PASS**
