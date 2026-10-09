# W2 PPOB paid fulfillment — expand-only

Nullable columns preserve historical provider transactions. Legacy rows with no posted prepayment cannot be dispatched or settled. Production requires versioned expand migration and staging rehearsal; no destructive rollback. Rollback application, retain ledger, audit, provider responses and nullable columns, reconcile unsettled customer-advance liabilities before deployment.
