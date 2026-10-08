# P4 — Legacy Surface Cleanup and Canonical Domain Ownership

Status: **IMPLEMENTED_RUNTIME_PENDING**

P4 runs only after P3 exact-source runtime closure. The authoritative machine-readable ownership map is `config/canonical-domain-ownership.json`.

## Legacy return aliases

Repository consumer verification after P3 found no active Admin, POS, Storefront, Employee, Worker, package or runtime-probe consumer of `/sale-returns*` or `/purchase-returns*`. Current clients use `/returns/sales*`, `/returns/purchases*`, and `/returns/orders*`.

P4 therefore removes the legacy controller routes, their compatibility DTOs, the adapter methods in `ExtensionsService`, and the unnecessary `ReturnsModule` dependency from `ExtensionsModule`. The canonical Returns module remains the only public return mutation owner.

| Legacy surface | P4 state | Canonical replacement |
|---|---|---|
| `/sale-returns*` | removed after compatibility verification | `/returns/sales*` |
| `/purchase-returns*` | removed after compatibility verification | `/returns/purchases*` |

The P4 exact-runtime probe must prove the legacy routes are absent from Swagger and return router-level 404 while canonical return list routes remain live.

## Canonical ownership

| Domain | Canonical write owner | Canonical source of truth / ledger |
|---|---|---|
| Inventory | Advanced Inventory controls; transaction-scoped stock side effects | `Inventory` + append-only `InventoryMovement` |
| Returns | `ReturnsModule` / `ReturnsService` | `SaleReturn`, `PurchaseReturn`, `OrderReturn`; inventory/accounting links |
| Accounting | `AccountingCoreModule` / `AccountingCoreService` | `AccountingEvent` -> `JournalEntry` / `JournalLine` |
| Payments | Commerce payment lifecycle; `PaymentsService` is provider ingress | `Payment` + idempotent `PaymentProviderEvent` |
| Notifications | API queue + asynchronous worker delivery | `Notification` / `NotificationTemplate` |
| Payroll | `PayrollModule` / `PayrollService` | `PayrollRun`, `PayrollResult`, canonical accounting links |
| Assets | `AssetsModule` / `AssetsService` | `Asset`, `AssetTransaction`, canonical accounting links |
| Marketplace | Extensions marketplace import adapter | `MarketplaceOrder` linked to canonical internal `Order` |
| Summaries | Admin-explicit materialization | rebuildable `Daily*Summary`; transaction ledgers stay authoritative |

## P4 gates

- `npm run audit:canonical:ownership` validates the ownership map, source files, required domains, removed aliases, and active-consumer cleanliness.
- `node --test tests/product-completion-p4-canonical-ownership.test.mjs` protects the source contract and GitHub gate wiring.
- `npm run ci:p4:probe` runs on the exact non-production PostgreSQL runtime in both heavy GitHub workflows.
- `handoff/quality/github-p4-canonical-ownership-probe-latest.json` must be `PASS`, match the current source fingerprint, and report `productionTouched=false` before P4 becomes `RUNTIME_VERIFIED`.

Human Stage-20 remains separate and pending until the final product acceptance phase.
