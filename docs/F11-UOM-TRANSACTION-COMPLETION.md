# F11 / P2A — Transaction UOM Completion

Status: **P2A SOURCE IMPLEMENTED — EXACT-SOURCE RUNTIME EVIDENCE PENDING**

## Authority
- `Product.unit` remains the integer base inventory unit.
- `ProductUnit` is authoritative when a new sale/order chooses an alternative transaction UOM and `quantityFactor`.
- Barcode is only a shortcut to a ProductUnit or backward-compatible unit snapshot; it is not the unit master.
- After a transaction row is created, its persisted UOM snapshot becomes historical authority. Fulfillment, return and refund must not reconstruct conversion semantics from the current ProductUnit row.

## Purchase and goods receipt
- PO input quantity is expressed in the selected purchase UOM when `productUnitId` is supplied.
- PO stores `variantId`, `productUnitId`, `unitCode`, `unitQuantity`, `quantityFactor`, and purchase-unit cost.
- `orderedQty` remains canonical base-unit quantity.
- Goods receipt converts selected-unit quantities to integer base quantity before inventory, batch, serial and accounting posting and preserves its UOM snapshot.

## Sales / POS
- Sale DTO supports direct `productUnitId` and `variantId`.
- POS and online order now share `apps/api/src/common/transaction-uom.ts` as the canonical selling-UOM resolver.
- ProductUnit/variant/barcode validation and factor-safe base conversion therefore cannot drift between POS and storefront order creation.
- Unit-specific pricing is resolved server-side; package fallback scales the product/variant base price by the persisted factor.

## Online order and fulfillment
- Storefront checkout sends transaction-unit quantity plus selected `productUnitId`/`variantId`.
- `OrderItem.unitQuantity` stores transaction quantity; `OrderItem.quantity` stores canonical base quantity.
- `OrderItem` also snapshots `variantId`, `productUnitId`, `unitCode`, `quantityFactor`, and `sourceBarcode` together with historical unit price/net/tax/gross fields.
- Reservation, batch, serial and inventory fulfillment continue using base quantity.
- Shipment package metadata carries both transaction UOM and base quantity; accounting lines use transaction quantity + selling-unit amount while inventory/COGS use base quantity + base cost.

## Return and refund lineage
- `OrderReturnItem`, `SaleReturnItem`, and `PurchaseReturnItem` persist the same transaction UOM lineage fields.
- Customer order-return input is in the historical OrderItem UOM. Server converts to base quantity from the persisted OrderItem `quantityFactor`, never from current ProductUnit configuration.
- Order-return net/tax/gross reversal values are proportional copies of historical OrderItem amounts.
- Sale and purchase returns copy source UOM identity/factor; their inventory quantity remains base units for backward compatibility.
- Refund/restock/accounting/tax posting therefore uses historical source snapshots rather than current catalog configuration.

## Storefront
- Product list/detail exposes server-authoritative effective price for active ProductUnits.
- Customer can choose selling UOM/package on product detail.
- Cart identity includes product + ProductUnit + variant, clamps quantity by base stock divided by the selected factor, and displays unit price/UOM explicitly.
- Account order history and return form use the persisted transaction UOM quantity instead of presenting base quantity as if it were the customer unit.

## Database
- Original F11 migration: `database/migrations/T360-20260923-f11-transaction-uom/`.
- P2A expand-only lineage migration: `database/migrations/T360-20260925-p2a-transaction-uom-lineage/`.
- Existing rows remain compatible with `quantityFactor=1` and nullable snapshots.

## Required runtime closure
Exact-source PostgreSQL evidence must prove a mixed-UOM storefront order can be created and fulfilled, then returned/refunded after the current ProductUnit configuration is changed/deactivated, while:
1. historical UOM semantics remain unchanged;
2. inventory movement uses the original base quantity;
3. accounting remains balanced;
4. tax reversal matches the original historical tax snapshot.

That was the state as of this document's authoring (2026-09-23). `config/product-completeness.json` now records `audit:A-03 = RUNTIME_VERIFIED`, closed on exact-source commit `899685ce23c08c8a0246867afc0c78a36507e674` with the P2A mixed-UOM probe PASS. The probe evidence file itself is not present in every working copy; if you need to re-verify A-03, regenerate it rather than trusting either number.
