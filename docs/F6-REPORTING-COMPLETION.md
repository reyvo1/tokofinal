# F6 Financial Reporting + Drill-down — Source Completion

Updated: 2026-09-23 Asia/Makassar

F6 source implementation is complete. Runtime/browser/human UAT remains deferred by operator instruction.

## Authoritative report sources

- Profit & Loss, Trial Balance, Balance Sheet, Cash Flow and General Ledger are derived from posted journal/account activity.
- Tax reporting is derived from posted TaxTransaction rows linked to versioned TaxCode data.
- Inventory valuation uses live branch warehouse inventory and product cost snapshots.
- Margin uses completed Sale cost snapshots for operational margin analysis while P&L remains journal-authoritative.

## Dynamic reporting

The Finance > Reports workspace now provides one period filter across:

- Profit & Loss;
- Trial Balance;
- Balance Sheet;
- Cash Flow;
- inventory valuation;
- sales margin;
- tax summary;
- current-vs-previous period comparison;
- branch comparison (company-wide only for OWNER/SUPER_ADMIN, otherwise current branch);
- accounting event cost-center dimensions.

## Drill-down

Report account drill-down follows the authoritative chain:

`report account -> JournalLine -> JournalEntry -> AccountingPosting -> AccountingEvent -> sourceType/sourceId`

The branch and company envelope always comes from authenticated context.

## Async exports

ReportJob remains the large-export path. CSV/XLSX/PDF worker support now also covers:

- INVENTORY_VALUATION;
- BRANCH_COMPARISON;
- COST_CENTER;
- PERIOD_COMPARISON.

Report filters are validated before queueing. Account and warehouse filters must resolve inside the active tenant/branch.

## Cost-center limitation

Cost-center reporting uses `AccountingEventLine.dimensions.costCenterId`. Events without that dimension are reported as `UNASSIGNED`; F6 does not invent dimensions from unrelated master data.

## Verification

- focused F6/reporting regression: PASS;
- workflow validation: PASS;
- repository validation: PASS;
- full dependency-free regression: PASS (see handoff/current session output).
- runtime/browser/human UAT: deferred.
