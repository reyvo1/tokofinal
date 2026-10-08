# F2 ProductVariant expand migration

Adds first-class product variants and optional variant ownership on barcode and price rows.

Rules:
- variants remain owned by one Product, therefore tenant scope is inherited and validated through Product.companyId;
- variant code is unique per product; optional variant SKU remains globally unique, matching the existing global Product.sku policy;
- barcode and price rows with `variantId = NULL` remain backward-compatible product-level records;
- variant-specific barcode/price rows must reference a variant of the same product;
- migration is expand-only; existing product/barcode/price rows remain valid.

Apply the matching SQLite/PostgreSQL migration before application code writes ProductVariant or variantId.
