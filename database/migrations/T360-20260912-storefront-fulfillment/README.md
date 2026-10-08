# T360-20260912 Storefront Fulfillment

Expand-only migration adding server-owned customer address book and immutable fulfillment snapshots on `Order`.

- Existing orders default to `DELIVERY` and retain their original address string.
- Address rows belong to a customer and may be deactivated without changing historic order snapshots.
- Courier/pickup selection comes from `MasterReference(type=COURIER)`; shipping price is read server-side.
