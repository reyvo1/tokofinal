# Final Production Readiness — Control Plane & Disaster Recovery

Updated: 2026-09-11 (Asia/Makassar)

This checkpoint extends the Operations/Production Readiness baseline with fail-safe control-plane behavior.

## Approval expiry, escalation, and delegation

Approval requests now persist `expiresAt`, `escalatedAt`, and delegation metadata. Approval policy steps may define:

```json
{
  "step": 1,
  "roles": ["FINANCE"],
  "permissions": ["approval.manage"],
  "expiresInMinutes": 120,
  "escalationRoles": ["OWNER"],
  "escalationMinutes": 60
}
```

The worker processes expired requests. The first timeout may escalate to configured escalation roles and extend the deadline once. A second timeout closes the request as `EXPIRED`. Delegation is branch-safe and the target must satisfy the role/permission requirements of the current step. Requesters still cannot approve their own request.

## Dead-letter / operator replay

Audited replay controls now exist for failed operational records:

- `POST /platform/automation-jobs/:id/replay`
- `POST /platform/webhook-deliveries/:id/replay`
- `POST /platform/outbox/:id/replay`
- `POST /platform/notifications/:id/replay`

Replay is company/branch scoped and only accepts terminal failed/cancelled states appropriate to the record type. Automation workers also reclaim stale `PROCESSING` jobs after a ten-minute lock timeout.

## Feature rollout safety

Feature flag `config.rolloutPercentage` supports values from 0 through 100. Runtime manifest evaluation uses a deterministic SHA-256 bucket based on tenant + branch + feature + user/branch subject. The same subject therefore remains in the same rollout bucket instead of randomly changing on each request.

The manifest returns both effective `enabled` and raw `configuredEnabled` so operators can distinguish rollout result from configured state.

## Security defaults

Production startup now refuses:

- the development JWT secret or a JWT secret shorter than 32 characters;
- an empty `CORS_ORIGINS` configuration.

The API emits baseline security headers (`nosniff`, frame deny, referrer policy, permissions policy, and HSTS in production). Login has a local per-process failure throttle after repeated bad credentials and records failed attempts for known users.

The local throttle is not a distributed rate limiter. Multi-instance production should still enforce Redis/gateway/WAF-based throttling.

## Central audit review

`GET /platform/audit-logs` provides a tenant/branch-scoped operational review stream with bounded pagination and optional `action` / `entityType` filters. Records without branch evidence are not exposed merely because their company matches; branch evidence must be present in payload or user relation.

## Backup and verification

Run from repository root with the active environment loaded:

```bash
npm run db:backup
```

The backup command supports:

- SQLite: quiescent guarded copy into `BACKUP_DIR` (default `./backups`); active WAL/rollback journal or source mutation aborts the backup;
- PostgreSQL: `pg_dump --format=custom --no-owner --no-privileges`.

Every backup gets a sidecar JSON containing timestamp, source metadata without password, byte size, and SHA-256. Verify it using:

```bash
npm run db:backup:verify -- backups/<backup>.json
```

For PostgreSQL the password is passed to `pg_dump` through `PGPASSWORD`, not command-line arguments. `backups/` remains ignored by source packaging.

### Restore policy

There is intentionally no one-click production restore command. Use `npm run db:restore:rehearse` only against an isolated TEST/STAGING target, then run integrity/smoke checks before any production recovery decision. SQLite rehearsal requires a fresh target path with no existing main/WAL/SHM/journal state; PostgreSQL rehearsal rejects the normalized active host/port/database, including common loopback aliases.

## Existing database migration

Apply the provider-specific expand migration in:

`database/migrations/T360-20260911-final-production-readiness/`

before deploying the new API/worker. PostgreSQL migration adds the `EXPIRED` approval enum value and new request fields/indexes. SQLite adds the request fields/indexes.

## Remaining production gates

Source-functional controls have advanced beyond the original version of this document: distributed rate limiting/session revocation, refresh rotation/2FA, and scoped API-key create/authenticate/rotate/revoke are implemented and regression-covered. They still require runtime verification and operator policy before go-live.

This checkpoint does not claim runtime production certification. Remaining high-value gates are now:

1. deployment secret-manager/KMS bootstrap and protected backup encryption/retention evidence;
2. infrastructure egress allowlists for webhook destinations when webhook delivery is enabled;
3. PostgreSQL backup + restore rehearsal on the same non-production database used for release certification;
4. representative load/index profiling and queue/backpressure evidence;
5. full multi-instance staging/UAT evidence for the exact promoted source fingerprint;
6. dependency/SAST/DAST/penetration-security review;
7. provider certification/reconciliation where external providers are enabled;
8. explicit cutover, rollback, monitoring and opening-balance approval;
9. production deploy/migrations followed by read-only Prisma/PostgreSQL schema-contract verification, source+DB-identity-locked smoke, and deployment attestation.

See `docs/PRODUCTION-PROMOTION-GATE.md` for the machine-verifiable promotion and final production-ready evidence chain.
