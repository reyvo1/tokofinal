# P6A Retail Transaction Completion — expand migration

Additive fields preserve immutable payment-method snapshots, configured settlement/MDR accounting facts, and sale-return refund allocation snapshots. Existing rows remain readable through the legacy tender-policy fallback; no historical transaction is rewritten.

Rollback application: deploy the previous application version while leaving these nullable/additive columns in place. Do not drop columns during incident rollback.
