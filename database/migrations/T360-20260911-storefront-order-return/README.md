# T360-20260911 Storefront Order Return

Additive migration for customer-account order return requests and line-level return quantities. Apply expand SQL before deploying API code that uses `OrderReturn` / `OrderReturnItem`.

The workflow is intentionally separate from POS `SaleReturn`: online orders retain their original `Order` / `OrderItem` source document, customer ownership, inspection, refund, inventory reversal, tax reversal, and accounting event lineage.
