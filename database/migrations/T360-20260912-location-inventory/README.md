# Location-level inventory expand migration

Adds location balances and exact source reservations without discarding the existing warehouse aggregate.

Runtime invariant:

- `Inventory` remains the warehouse-level aggregate and compatibility contract.
- The first location-aware mutation lazily materializes an existing aggregate into one deterministic active default warehouse location.
- After materialization, every location-aware mutation verifies that `quantity`, `reserved`, and `available` exactly match the sum of location balances and fails closed with `LOCATION_INVENTORY_DRIFT` on mismatch.
- New order reservations are recorded per location in `InventoryReservation`; fulfillment and cancellation consume/release those exact allocations.
- Location-to-location relocation never changes the warehouse aggregate.

Deploy the expand migration before running application code that writes location balances. Existing inventory rows are intentionally backfilled lazily inside serializable business transactions so no offline/manual aggregate state is silently guessed during migration.
