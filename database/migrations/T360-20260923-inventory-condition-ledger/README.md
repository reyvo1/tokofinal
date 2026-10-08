# F3 Inventory condition ledger — expand migration

Adds first-class inventory condition classification without replacing canonical `Inventory`, `InventoryLocationBalance`, or append-only `InventoryMovement`.

Condition rules:
- `AVAILABLE` is physically on-hand stock that may be reserved/sold.
- `DAMAGED`, `QUARANTINE`, and `LOST` remain physically classified on-hand buckets but are excluded from sellable `available` quantity.
- condition movement never changes total physical `Inventory.quantity`; moving into/out of `AVAILABLE` changes only sellable `Inventory.available` and location `available`.
- reserved stock cannot be moved out of `AVAILABLE`.
- existing location inventory is lazily materialized as `AVAILABLE` when condition-aware flow is first used, then drift checks become fail-closed.
- all explicit condition changes create immutable `InventoryConditionMovement`, audit log, and outbox event.

This migration is expand-only and intentionally is not auto-applied by the patch.
