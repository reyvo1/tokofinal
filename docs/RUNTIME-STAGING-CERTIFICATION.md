# Runtime / Staging Certification — 2026-09-11

This stage prepares Toko360 for repeatable staging certification after the static hardening gates.

## Authentication and sessions

- New JWTs carry a random `sid` and every protected request checks an active `AuthSession` row.
- `POST /api/v1/auth/logout` revokes the current session immediately.
- `POST /api/v1/auth/logout-all` revokes all active sessions for the current user.
- `GET /api/v1/auth/sessions` exposes only safe session metadata.
- Tokens issued before this migration have no registered `sid` and intentionally require re-login.
- Login failure throttling is stored in `RateLimitBucket`, so multiple API instances share the same counters.

## Secret storage

`SystemSetting.isSecret`, integration secrets, and new webhook headers are encrypted with AES-256-GCM before database storage. Configure a 32-byte `SECRET_MASTER_KEY` (64 hex chars or base64) and optional `SECRET_KEY_ID`.

For staging and production, inject the master key from the deployment secret manager or protected runtime configuration. Production should use the deployment secret manager or KMS bootstrap. The repository does **not** contain a provider-specific AWS/GCP/Azure KMS client and does not claim HSM-backed encryption by itself.

Legacy plaintext rows remain readable for backward compatibility where necessary. Run:

```text
npm run secrets:migrate
npm run secrets:migrate -- --apply
```

The first command is a dry run. The second encrypts legacy plaintext settings/integration secrets/webhook headers. This script is not a re-key rotation engine.

## Multi-worker reliability

- Event outbox uses a 10-minute processing lease and can reclaim abandoned `PROCESSING` rows.
- Webhook delivery claims a row before the HTTP request and reclaims abandoned processing after the lease expires.
- Every webhook includes a stable `Idempotency-Key` equal to the delivery id. Receivers should persist and deduplicate this value, because response loss can still cause a retry after the receiver already committed the request.
- Endpoint custom headers may not override Toko360 integrity headers (`Content-Type`, `User-Agent`, event id/type, `Idempotency-Key`, or signature). Collisions are rejected case-insensitively before network send because Fetch normalizes header names.
- On staging/production, a webhook delivery is not sent unless `WEBHOOK_SIGNING_SECRET` is configured as a non-placeholder secret of at least 32 characters. This keeps webhook usage optional while preventing unsigned protected-environment delivery.

## Backup / restore rehearsal

Create and verify a backup:

```text
npm run db:backup
npm run db:backup:verify -- <backup-file>.json
```

Restore rehearsal is deliberately restricted to non-production targets:

```text
npm run db:restore:rehearse -- <backup-file>.json --target-url <isolated-target-url> --target-env staging
```

`development`, `test`, and `staging` are accepted. `production` is rejected by design. PostgreSQL restoration uses `pg_restore` without shell execution; credentials are passed through environment variables. Restore additionally rejects a target that resolves to the active SQLite file or the same normalized PostgreSQL host/port/database even when URL spelling, user, query, relative path, or existing symlink differs.

SQLite backup uses a conservative quiescent-copy rule. A non-empty `-wal` or `-journal` aborts the backup, and a source file that changes during copy also aborts and removes the partial artifact. Stop/checkpoint local writers before retrying; a checksum-valid main `.db` copy that omits committed WAL pages is not accepted as a valid rehearsal backup.
SQLite restore rehearsal also requires a **fresh target path**: an existing main database, `-wal`, `-shm`, or `-journal` file causes restore to abort before mutation. This prevents a restored main file from being combined with stale scratch state.

PostgreSQL active-target comparison normalizes common loopback aliases (`localhost`, `localhost.`, `127.0.0.1`, and IPv6 loopback) in addition to host case/default port/database identity. This closes the local-alias bypass without pretending to solve arbitrary DNS aliases; real staging restore must still use a separately provisioned database.

The historical `node apps/api/scripts/backup-drill.mjs` entry point is retained only as a SQLite compatibility wrapper. It delegates to these canonical hardened tools and has no raw file-copy fallback.

## Protected runtime configuration

For `NODE_ENV=staging` or `production`:

- configure a unique `JWT_SECRET` of at least 32 characters; placeholder values are rejected;
- configure explicit `CORS_ORIGINS`; wildcard `*` is rejected;
- configure a valid 32-byte `SECRET_MASTER_KEY` (or temporary legacy `ENCRYPTION_KEY` alias);
- leave `WEBHOOK_SIGNING_SECRET` blank only if webhook delivery is not used; before any protected-environment webhook delivery, configure a unique signing secret of at least 32 characters.

`.env.postgres.example` intentionally leaves these values blank so a copied profile cannot accidentally pass with repository-known placeholder credentials.

## Staging certification runner

Set:

```text
STAGING_BASE_URL=https://staging.example
STAGING_EXPECTED_HOST=staging.example
STAGING_EXPECTED_SOURCE_FINGERPRINT=<current source fingerprint>
STAGING_EXPECTED_DB_HOST=<exact PostgreSQL staging hostname>
STAGING_EXPECTED_DB_NAME=<exact PostgreSQL staging database name>
STAGING_TEST_EMAIL=...
STAGING_TEST_PASSWORD=...
STAGING_CERT_OUTPUT=handoff/quality/staging-certification.json
```

Run:

```text
npm run certify:staging
```

The runner verifies the local build-artifact manifest first, then checks public health, exact deployed source fingerprint, exact runtime build artifact ID, hashed PostgreSQL target identity, login/session registration, session list, operations health, financial-integrity endpoint, logout, and verifies that the revoked JWT is rejected with HTTP 401. Source/database identity is validated before staging credentials are sent.

## Load evidence

`test:load` supports machine thresholds and optional JSON output:

```text
node scripts/load-test.mjs \
  --url https://staging.example/api/v1/health \
  --requests 2000 --concurrency 50 \
  --max-p95-ms 500 --max-p99-ms 1000 \
  --max-error-rate 0 --min-rps 50 \
  --expected-source-fingerprint <current source fingerprint> \
  --expected-build-artifact-id <build artifact id from handoff/quality/build-artifact-manifest-latest.json> \
  --expected-db-host <exact PostgreSQL staging hostname> \
  --expected-db-name <exact PostgreSQL staging database name> \
  --output handoff/quality/load-health.json
```

For promotion evidence, the load runner first verifies the health endpoint reports the expected source fingerprint, exact build artifact ID, and hashed PostgreSQL target; only then does it start load traffic. Choose thresholds from the real staging capacity/SLO; the example values are not production promises. Numeric arguments fail closed before traffic starts: NaN/non-finite values, negative latency/RPS thresholds, `max-error-rate` outside 0..1, and timeout values below 100 ms are rejected with exit code 1.

## PostgreSQL index profiling

After representative staging traffic:

```text
npm run db:index:profile -- --output handoff/quality/postgres-index-profile.json
```

The profiler reports high sequential-scan candidates, large unused-index candidates, and dead-tuple ratios from `pg_stat_*`. It never creates or drops an index. Confirm every candidate with `EXPLAIN (ANALYZE, BUFFERS)` on staging before schema changes.

## Mandatory remaining runtime gates

1. Apply the runtime-certification migration to an isolated TEST/STAGING clone.
2. Generate Prisma clients/build all workspaces with the real dependency set.
3. Run the staging certification runner.
4. Run at least two API instances and two workers against the same PostgreSQL database.
5. Exercise webhook response-loss/retry using a receiver that deduplicates `Idempotency-Key`.
6. Rehearse PostgreSQL backup + restore to a fresh isolated database and run smoke/integrity checks against it.
7. Collect load/index evidence under representative data volume.
8. Execute the full business E2E matrix (POS online/offline, procurement/AP, storefront/AR, payroll, asset/fleet, approvals/automation/reporting).
9. Capture cutover and rollback evidence before production release.
