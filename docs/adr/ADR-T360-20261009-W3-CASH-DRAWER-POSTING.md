# ADR — Canonical shift cash transfer and variance posting

Status: IMPLEMENTATION · 2026-10-09 · Work item T360-20261009-101100

## Context

POS already persists CashierCashMovement, counted physical drawer cash, shift closure and supervisor approval. These commits were not accompanied by AccountingEvent/JournalEntry. Opening float is a physical COUNT rather than journal-backed revenue. Posting inferred expenses from the cashier's free-text reason would create invalid tax and income recognition.

## Decision

Reuse AccountingCoreService.postOperationalEvent in the SAME serializable transaction as movement creation/idempotency receipt or shift closure. Four finance-versioned ACTIVE rules are mandatory for asset transfers and short/over adjustments. The till account is actual seeded 1101 ASSET (literal `accountCode: 1101` accepted because existing Admin rule editor is literal-only; API also accepts `accountCodeKey: drawerCash`). The counterparty GL account is a Finance-controlled literal in the active rule, never a POS payload, and is required to be ASSET, EXPENSE or REVENUE depending on the event. No parallel journal, new schema, guessed tax, or automatic legacy backfill. Any missing rule or closed fiscal period blocks mutation.

## Rejected alternatives

- Accept an unjournalled cash movement and reconcile later: financial drift.
- Treat all CASH_OUT as operating expense: misclassifies vault/bank transfers; bypasses Tax Core.
- Choose a revenue/expense account automatically: no source authority and tax risks.
- Let cashier specify debit/credit account: permission escalation risk.
- Invent a separate cash ledger: violates Accounting Core and unbalances GL.

## Consequences

Existing tenants must have Finance configure four rules and actual branch accounts before recording cash movements/variance close. In a missing-configuration environment POS receives an explicit refusal; ordinary zero-variance close requires no adjustment rule. Existing postings are immutable. Source-only tests cannot close required PostgreSQL/Browser/provider/human evidence.
