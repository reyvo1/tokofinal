# ADR T360-20261009 — PPOB prepayment and deferred provider resolution

**Status:** IMPLEMENTATION; TEST/UAT evidence still required.

**Context:** The legacy `DigitalServiceTransaction` + provider outbox could submit an external digital goods order without any paid receipt. A refund/settlement based on provider status alone would violate accounting truth and shift drawer reconciliation.

**Decision:** Require verified no-tax product, opt-in connected integration, bounded provider cost, tenant-account preflight, open cashier shift, POSTED Accounting Core cash-to-customer-advance in the same serializable transaction that queues provider request. Worker re-verifies event against immutable source. Manual, permissioned SUCCESS settlement and explicit FAILED cash refund use independent Accounting Core events and status/receipt guards; never create another journal ledger.

**Tradeoffs:** Payment limited to CASH while tax-verified, provider balance and posting rules are configured. No automatic refund while provider status is unknown. Legacy unpaid jobs are quarantined. Finance must resolve external provider reconciliation and failed/ambiguous cases manually. Financial completeness and Human UAT cannot be inferred from static source tests.

**Migration/rollback:** Add only nullable fields/indexes to all three Prisma schemas with provider-specific expand SQL. Feature flag defaults OFF. Preserve journal data; halt NEW capture by disabling integration flag; reconcile already queued provider work and outstanding advances before any code rollback.
