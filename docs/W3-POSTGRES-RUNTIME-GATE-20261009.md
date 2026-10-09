# W3 exact-source PostgreSQL financial runtime gate — 2026-10-09

## Authority and scope

Work item `T360-20261009-101100` (W3 IMPLEMENTATION). The existing POS SalesService and Accounting Core are unchanged. This gate is a new **real PostgreSQL integration probe**, not another source-marker test or physical-device simulator. The GitHub jobs already build six apps, provide PostgreSQL 16 bootstrap staging, and start the exact runtime. Probe uses that same API and Prisma client.

## Execution and protection

`npm run ci:w3:postgres-probe` runs **after exact built runtime starts**, in both heavy GitHub workflows. `DATABASE_URL` must be a PostgreSQL local test/staging database matching `T360_CI_EXPECTED_HOST` / `T360_CI_EXPECTED_DATABASE`; API must be `http://localhost:4000/api/v1` (127.0.0.1 accepted). Any different/production target fails before importing Prisma or making API requests. Source identity matches the GitHub expected fingerprint if supplied. The probe creates a dedicated CASHIER actor and Finance-owned test accounts/rules in the disposable CI DB; posted accounting records remain for audit and are never deleted to fake rollback.

## Mandatory runtime invariants

- Trusted company/branch plus genuinely authenticated CASHIER session; rules go through existing Admin-authorized Accounting Core API.
- CASH_IN / CASH_OUT movement and exactly one POSTED event with two matching journal lines (correct debit and credit sides/accounts).
- Duplicate key replay returns original receipt; altered payload is refused; no duplicate movement/event.
- More than two decimal places and overdraft are rejected before writes.
- Exact shift closure creates no variance posting; shortage posts Dr EXPENSE/Cr drawer 1101; overage posts Dr drawer/Cr REVENUE; repeated close cannot post twice.
- Check amounts and journal balance in integer minor units. No automatic Human Stage-20 acceptance.

## Evidence and release gates

`handoff/quality/github-w3-cash-postgres-probe-latest.json` writes initial FAIL and only becomes PASS after all checks. Both GitHub workflows require this step; aggregate summary and R8 evidence must see same-source PASS, otherwise FAIL/NOT_RUN. The real PostgreSQL run remains **PENDING** until the operator pushes this source and GitHub runs. Simulated hardware/provider evidence and human visual review remain separate. No new schema/migration or accounting/tax semantics introduced by this probe.

## Rollback

Disable the CI probe step only by reverting this source change under workflow governance, not by downgrading the release gate. In non-production test DB, discard the entire staging database after retaining sanitized evidence. Never delete individual POSTED journals or change a production DB to clean up test fixtures.
