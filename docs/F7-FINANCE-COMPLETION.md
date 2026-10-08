# F7 AR/AP/Cash/Bank/Reconciliation — Source Completion

Status: **SOURCE IMPLEMENTATION COMPLETE**. Runtime/browser/human UAT remains deferred by operator instruction.

## Accounts Receivable
- COD/INVOICE receivables remain derived from canonical Order/Payment and posted customer-receipt settlements.
- AR aging endpoint groups open documents into CURRENT, 1–30, 31–60, 61–90, and 90+ day buckets.
- Aging is tenant/branch scoped and settlement remains server-authoritative with over-collection protection.
- Operator can open settlement trace from Order to finance transaction, accounting event, journal, and account lines.

## Accounts Payable
- Supplier payable remains derived from posted Goods Receipt, credit Asset acquisition, Maintenance, and Fuel documents.
- Purchase returns reduce payable before cash settlement; supplier refund receivable stays separate.
- Supplier `paymentTermDays` drives due-date aging for AP documents.
- AP aging uses the same CURRENT / 1–30 / 31–60 / 61–90 / 90+ buckets and supports supplier filter.
- Settlement trace connects payable source to operational finance transaction, accounting event, and journal.

## Cash / Bank
- Cash/bank position is journal-backed, not client-calculated.
- Active ASSET settlement accounts used by canonical finance transactions or bank statements are shown with book balance.
- Latest imported statement balance and delta against book balance are exposed to operators.
- Operational cash/bank transfers continue through Accounting Core and fiscal-period controls.

## Bank Reconciliation
- Existing canonical statement import, idempotent file identity, statement-period validation, server book balance, auto-match, manual match/unmatch, and completion invariant remain authoritative.
- Operator workspace keeps statement import and reconciliation lifecycle and now pairs it with current cash/bank book position.

## Security / Integrity
- Company and branch come from authenticated tenant context.
- AR/AP/cash-bank/trace reads are permissioned with `finance.view`.
- Existing finance create/approve/post/reconcile permissions remain unchanged.
- Settlement posting remains idempotent and revalidates outstanding amount at post time.
- No duplicate AR/AP ledger was introduced.

## Verification
- Focused F7 + procurement/commerce/UI: **29/29 PASS**.
- `npm run workflow:validate`: **PASS**.
- `npm run validate:repo`: **PASS** — 177 Prisma models at the time of this wave (180 now), SQLite/PostgreSQL profiles valid.
- `npm run test:dependency-free`: **781/781 PASS**.

Next locked phase: **F8 Automation + scheduled reports**.
