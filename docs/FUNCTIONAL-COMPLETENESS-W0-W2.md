# Functional Completeness — W0–W2

Updated: 2026-09-11

This file tracks **real executable workflow coverage**, not visual completeness and not merely model/API presence. Development Kit remains the source of truth.

## Implemented in this batch

### POS core transaction

- Cashier shift remains mandatory for a sale.
- Hold/recall transaction is available on the POS terminal and isolated per cashier browser identity.
- Manual cashier drawer movement supports audited `CASH_IN` and `CASH_OUT`; the movement is included in expected-cash reconciliation.
- Split payment supports CASH / QRIS / TRANSFER / CARD and requires the split total to match the server-authoritative sale total exactly.
- Split settlement posts through the dedicated `SALE_SPLIT` accounting rule.
- Offline replay remains deliberately restricted to a single CASH settlement; split/non-cash/promotion cannot be silently queued offline.

### Promotions

- A promotion code sent by POS is resolved on the server during both quote and sale creation.
- Promotion validity, branch/company scope, date range, minimum spend, and computed discount are server-authoritative.
- The resulting promotion discount participates in the real sale total and accounting payload.
- Advanced promotion semantics that require richer basket/member conditions are still not marked fully complete; unsupported member-tier rules fail explicitly instead of being guessed.

### Sale return / refund

- POS can select a real recent sale, choose returned quantities, reason, and refund method, then create a server-side SaleReturn request.
- Server prevents cumulative over-return of a sold item.
- A return creates an operational inspection using `RETURN-INBOUND-STANDARD`.
- Admin Operations Control can complete/approve SaleReturn and PurchaseReturn inspections rather than only GoodsReceipt/Shipment.
- Admin Retur & Transfer can finalize an eligible SaleReturn.
- Completion posts restock/inventory movement, accounting, tax reversal, outbox/audit evidence, and loyalty REFUND correction atomically.
- Admin now displays `refundAmount`, the actual API field, instead of the nonexistent/incorrect `grossAmount` field.

### Integration path corrections

The Admin/POS clients no longer call nonexistent `/extensions/...` paths for root-level ExtensionsController endpoints. Current corrected root paths include customers, loyalty, shipments, and notifications.

## Still open — do not claim complete

The following Development Kit areas are intentionally still open and require later functional batches: full master-data surface, API-key runtime administration, richer promotion types/stacking/member rules, payment-provider callbacks and settlement reconciliation, customer self-service/mobile completion, marketplace/shipping provider adapters, bidirectional edge/cloud sync completeness, broader notification providers, complete reporting/export catalog, and remaining W3–W7 workflows.

UI polish is explicitly deferred until functional closure is further advanced.
