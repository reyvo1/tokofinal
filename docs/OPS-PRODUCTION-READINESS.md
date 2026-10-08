# Operations / Approval / Automation Production Readiness

Updated: 2026-09-11

This checkpoint hardens platform-level controls used across Toko360.

## Approval workflow

- Approval requests now carry an explicit `branchId` for new records.
- Existing records are backfilled from the requester branch when possible.
- Legacy rows without branchId remain visible only through the prior requester-branch fallback.
- Approval policies must contain at least one valid step.
- Steps may restrict approvers by `roles` and/or required `permissions`.
- The requester cannot approve their own request.
- APPROVED advances one step at a time; only the final step closes the request as APPROVED.
- REJECTED closes the request immediately.
- The same approver cannot decide the same step twice.
- Decision mutation uses a serializable transaction and compare/update on `currentStep` to reject concurrent stale decisions.

## Webhook safety

- Production webhooks require HTTPS unless `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` is explicitly set for controlled local/test use.
- Localhost, loopback, RFC1918/private, link-local, and private IPv6 targets are rejected by the worker after DNS resolution when private targets are not allowed.
- Webhook headers are redacted from normal API list/create responses so Authorization/API-key headers are not echoed to clients.
- Delivery retry remains bounded and uses exponential backoff.

`WEBHOOK_ALLOW_PRIVATE_TARGETS=true` must never be enabled in public production unless the network design explicitly requires it and egress is separately controlled.

## Settings and secrets

`SystemSetting.isSecret=true` values are returned as `***REDACTED***` by platform listing APIs. Secret material still requires an external secret-management/encryption strategy for strong at-rest protection; this checkpoint prevents routine API disclosure but does not claim HSM/KMS-backed encryption.

## Notification worker concurrency

External and console notifications now acquire a five-minute scheduling lease with an atomic `updateMany` claim before sending. This prevents two workers from selecting the same QUEUED row at the same time. If a worker crashes after claiming, the scheduled lease expires and the message becomes eligible for retry.

Provider-level idempotency remains recommended because no distributed system can eliminate the commit-after-send/response-loss window without provider support.

## Worker correctness

A duplicate `const dateOnly` declaration in report boundary parsing was removed. This was a real syntax defect in the worker source and is covered by regression protection.

## Deployment

For an existing database apply:

- `database/migrations/T360-20260911-ops-production-readiness/postgresql-expand.sql`, or
- `database/migrations/T360-20260911-ops-production-readiness/sqlite-expand.sql`

before deploying the API/worker source.

Then run runtime integration in TEST/STAGING, especially:

1. two-step approval with different users/roles;
2. concurrent approval attempts against the same current step;
3. automation-generated approval request visibility by branch;
4. webhook delivery to a controlled HTTPS endpoint;
5. rejection of localhost/private webhook targets;
6. two worker instances competing for notification delivery;
7. worker report export smoke test.
