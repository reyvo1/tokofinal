# T360-20260911 Storefront Customer Account

Expand-only migration adding password-backed customer accounts, revocable opaque sessions, and optional `Order.customerId` ownership. Existing guest orders remain valid with `customerId = NULL`; no destructive backfill is attempted.

Rollback is application-first: stop writing customer ownership/sessions, then remove these structures only after confirming no active storefront accounts rely on them.
