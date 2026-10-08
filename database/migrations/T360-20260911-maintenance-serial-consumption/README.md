# Maintenance serial consumption

Adds the `CONSUMED` serial lifecycle state used when a serial-tracked inventory item is consumed as a maintenance part.

PostgreSQL: run `postgresql-expand.sql` before deploying the regenerated Prisma client/API.
SQLite: no physical enum change; regenerate Prisma Client and run normal `db push`/validation.

The maintenance transaction only consumes serials that are `AVAILABLE`, belong to the selected warehouse/product, and match the requested quantity. It updates serial state, inventory quantity, movement, accounting, audit and work-order completion in the same database transaction.
