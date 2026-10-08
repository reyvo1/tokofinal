# T360-20260911 unit conversion

Additive expand migration for traceable POS selling units. `SaleItem.quantity` remains the authoritative integer base-unit quantity used by inventory and returns. `unitQuantity`, `unitCode`, `quantityFactor`, and `sourceBarcode` preserve the selling unit/packaging selected at sale time. Existing rows default to a factor of 1 and need no destructive rewrite.
