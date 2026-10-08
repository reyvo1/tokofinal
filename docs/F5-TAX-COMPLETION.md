# F5 Tax Dynamic — Source Completion

Status: **SOURCE IMPLEMENTATION COMPLETE**. Runtime/browser/human UAT remains deferred by operator instruction.

## Completed
- Versioned `TaxCode` identity (`companyId + code + version`) with effective dates.
- DRAFT versions can be edited; ACTIVE/INACTIVE or used versions cannot be rewritten.
- ACTIVE effective ranges for the same code cannot overlap.
- Tax account mapping is validated against active branch COA: payable=LIABILITY, receivable=ASSET, expense=EXPENSE.
- Existing `TaxTransaction.taxCodeId` remains bound to the exact historical tax version.
- Tenant/branch-scoped tax transaction ledger, tax-document list, and tax reconciliation APIs.
- Reconciliation surfaces missing accounting event, missing journal, non-posted tax rows, mapped tax-account journal movement, and period tax-document totals.
- Admin tax workspace provides version create/clone/activate/deactivate, effective dates, account mappings, ledger filters, documents, reconciliation, and accounting-event drill-down.
- SQLite/PostgreSQL expand-only migration included; not auto-applied.

## Verification
- F5 + tenant-accounting targeted tests: 15/15 PASS.
- `npm run workflow:validate`: PASS.
- `npm run validate:repo`: PASS.
- `npm run test:dependency-free`: 771/771 PASS.
