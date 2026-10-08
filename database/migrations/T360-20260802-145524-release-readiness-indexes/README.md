# Stage 20 critical indexes

Additive indexes required by the staging release-readiness gate for tenant filters and cursor-style ordering.

- Product: company, active flag, name, id.
- Warehouse: branch.
- Inventory: warehouse, updated timestamp, id.
- AccountingEvent: company, branch, created timestamp, id.
- PayrollRun: company, branch, created timestamp.

`postgresql-expand.sql` is idempotent through `CREATE INDEX IF NOT EXISTS`. Apply on TEST/STAGING first. Production application requires change approval, maintenance/lock review, monitoring, and rollback readiness.
