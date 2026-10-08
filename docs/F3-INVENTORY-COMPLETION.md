# F3 Inventory / Batch / Expiry / Condition — Source Completion

Updated: 2026-09-23 Asia/Makassar

Status: **SOURCE IMPLEMENTATION COMPLETE — RUNTIME/BROWSER/HUMAN UAT DEFERRED**.

## Completion matrix

| Capability | Source status | Evidence |
|---|---|---|
| Dynamic warehouse lifecycle | COMPLETE | Admin create/edit/default/activate/deactivate via tenant-scoped master-data API |
| Warehouse/bin/location visibility | COMPLETE | location balances + relocation use canonical aggregate/location invariants |
| Batch / lot | COMPLETE | `InventoryBatch` remains authoritative; receipts, fulfillment, transfer, opname reconcile batch quantity |
| Production / expiry dates | COMPLETE | `producedAt` + `expiryDate`; `trackExpiry` requires batch; expired inbound/fulfillment fail closed |
| FEFO/FIFO | COMPLETE | dated non-expired batches FEFO; undated batches fallback FIFO-compatible order |
| Serial numbers | COMPLETE | receipt manifest is atomic; shipment reservation/sale exists; warehouse transfer uses explicit `IN_TRANSIT` state |
| Condition buckets | COMPLETE | AVAILABLE/DAMAGED/QUARANTINE/LOST persisted per location; IN_TRANSIT derived from StockTransfer ledger to avoid double-counting warehouse stock |
| Transfer traceability | COMPLETE | tracked products require batch/serial manifests; ship decrements source batch/stock and marks serials IN_TRANSIT; receive restores batch/serial at destination |
| Stock opname | COMPLETE | whole-warehouse opname snapshots tracked products per batch and posts batch + aggregate/location adjustments |
| Adjustment / relocation | COMPLETE | movement-ledger based; condition/location invariants remain fail-closed |
| Minimum stock / reorder visibility | COMPLETE | Admin shows current available, inbound in-transit, projected available, and shortage versus product minimum stock |
| Audit/outbox/accounting | COMPLETE | condition/transfer/opname canonical paths retain audit, outbox and accounting events where monetary inventory movement applies |

## F3 invariants

1. Warehouse aggregate, location balances, and persisted condition balances must reconcile.
2. AVAILABLE condition is the only sellable/reservable condition.
3. IN_TRANSIT is not copied into warehouse condition balances. It is derived as `shippedQty - receivedQty` from open StockTransfer items, preventing physical stock from being counted in both source/destination warehouses.
4. Batch-tracked whole-warehouse opname fails closed when aggregate quantity and batch quantity drift.
5. Serial-tracked transfer requires one serial identity per unit and moves serial status `AVAILABLE -> IN_TRANSIT -> AVAILABLE` atomically with transfer stages.
6. Expired batches cannot be received as new valid inventory or consumed by fulfillment, and cannot be shipped as AVAILABLE transfer stock.
7. Runtime migrations are expand-only and are not automatically applied by patch scripts.

## Static verification

- F3 focused regression: **20/20 PASS**
- `npm run workflow:validate`: **PASS**
- `npm run validate:repo`: **PASS**
- Full dependency-free regression: **757/757 PASS**
- Prisma models: **177 at the time of this wave** (180 now), SQLite/PostgreSQL parity verified by repository validator

## Deferred verification

Runtime database migration execution, authenticated browser UAT, and human UAT are intentionally deferred until implementation phases are complete per operator instruction. This document does not claim those gates are complete.
