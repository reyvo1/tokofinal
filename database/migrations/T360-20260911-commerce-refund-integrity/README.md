# T360 commerce/refund integrity migration

Adds persisted split accounting for supplier returns that touch invoices already paid:

- `PurchaseReturn.payableOffsetAmount`: portion that reduces Accounts Payable (2101).
- `PurchaseReturn.supplierReceivableAmount`: portion owed back by supplier (1202).
- `PurchaseReturn.supplierCreditNoteNumber`: supplier acknowledgement/reference.
- PostgreSQL enum value `SUPPLIER_REFUND` for finance settlement transactions.

After applying the expand SQL, run the canonical seed so accounts `1202` / `1203` / `2105` and the updated posting rules are upserted. New SQLite installs using Prisma `db push` receive the schema directly.
