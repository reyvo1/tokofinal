# T360-20260923 product multi-UOM

Expand-only foundation for first-class ProductUnit. Product.unit remains the authoritative base inventory unit. ProductUnit stores alternative sale/purchase packaging with integer base-unit factors. Barcode and price rows may reference ProductUnit while retaining unitCode/quantityFactor snapshot fields for backward compatibility and F11 transaction integration. Runtime application/backfill is intentionally deferred.
