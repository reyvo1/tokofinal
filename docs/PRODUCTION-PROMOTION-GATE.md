# Production Promotion Gate

Updated: 2026-09-12 (Asia/Makassar)

This gate is intentionally separate from the UAT-candidate gate. A UAT candidate is still non-production. Toko360 must pass a staged promotion evidence chain before cutover, and must pass production smoke plus deployment attestation before it may be called production-ready.

## Runtime source identity

`GET /api/v1/health` exposes non-secret release identity:

- application version;
- `T360_SOURCE_FINGERPRINT` supplied by the deployment/runtime wrapper;
- optional build id;
- exact `T360_BUILD_ARTIFACT_ID` produced by the deterministic six-app build manifest;
- non-secret runtime database target identity (`profile`, hashed PostgreSQL host, hashed database name).

Build gate computes a SHA-256 identity for the runtime outputs of API, worker, Storefront, Admin, POS, and Employee Portal. Built-browser UAT and Stage-20 inject both the current repository fingerprint and this exact build artifact ID into the API runtime. Browser/staging/production checks reject a runtime that reports a different or missing source fingerprint **or build artifact ID**. Staging certification and production smoke also reject a runtime whose hashed PostgreSQL host/database identity differs from the explicitly expected target. This prevents evidence from a newer checkout from being combined with a stale deployed build, and prevents a correct build connected to the wrong database from being certified.

## Gate A — promotion ready, still not production ready

The following evidence must all belong to the current source fingerprint **and the same build artifact ID**:

1. UAT candidate PASS;
2. Stage-20 automated + exactly 12 human UAT scenarios PASS;
3. staging certification PASS against a runtime reporting the same source fingerprint;
4. representative load test meeting its explicit thresholds;
5. PostgreSQL index profile from the same Stage-20 database;
   Load evidence must first pass runtime identity preflight against the same source fingerprint and PostgreSQL target; traffic against an unverified runtime is not promotion evidence;
6. PostgreSQL backup/restore DR rehearsal from the same Stage-20 database, restored to a different TEST/STAGING scratch database and smoke-tested;
7. explicit human promotion approval covering secrets/security, SAST/dependency/DAST/pentest review, refresh/2FA/rate-limit controls, encrypted/protected backup retention, queue capacity/backpressure, monitoring, cutover, rollback, opening balances, privacy/retention, index review, provider certification/reconciliation, and API-key lifecycle when external API access is enabled.

Run DR rehearsal only on non-production source/restore targets:

```bash
export T360_DR_TARGET=STAGING
export T360_DR_CONFIRM=RUN_T360_POSTGRES_DR_NON_PRODUCTION
export T360_DR_SOURCE_DATABASE_URL=...
export T360_DR_SOURCE_EXPECTED_HOST=...
export T360_DR_SOURCE_EXPECTED_DATABASE=...
export T360_DR_RESTORE_DATABASE_URL=...
export T360_DR_RESTORE_EXPECTED_HOST=...
export T360_DR_RESTORE_EXPECTED_DATABASE=...
npm run db:dr:rehearse:postgres
```

Run staging certification with an exact runtime identity lock:

```bash
export STAGING_BASE_URL=https://staging.example.com
export STAGING_EXPECTED_HOST=staging.example.com
export STAGING_EXPECTED_SOURCE_FINGERPRINT='<current source fingerprint>'
export STAGING_EXPECTED_DB_HOST='<exact PostgreSQL staging hostname>'
export STAGING_EXPECTED_DB_NAME='<exact PostgreSQL staging database name>'
export STAGING_TEST_EMAIL=...
export STAGING_TEST_PASSWORD=...
npm run certify:staging
```

Capture representative load/index evidence:

```text
node scripts/load-test.mjs --url https://staging.example.com/api/v1/health --requests 2000 --concurrency 50 --max-p95-ms 500 --max-p99-ms 1000 --max-error-rate 0 --min-rps 50 --expected-source-fingerprint <current source fingerprint> --expected-build-artifact-id <build artifact id from manifest> --expected-db-host <exact PostgreSQL staging hostname> --expected-db-name <exact PostgreSQL staging database name>
npm run db:index:profile
```

Copy `config/production-promotion-approval.json.example` to `production-promotion-approval.json`, fill only reviewed non-secret evidence, then run:

```bash
npm run production:promotion:verify
```

A PASS here means **promotionReady=true, productionReady=false**.

## Gate B — deploy and production smoke

Production deployment itself remains infrastructure/operator controlled. Do not add a generic one-click database restore/deploy command to this repository.

Production deployment must reuse the **same tested build outputs**, not rebuild them. The deployed API must receive `T360_SOURCE_FINGERPRINT` and `T360_BUILD_ARTIFACT_ID` equal to the promoted evidence. Then run the production smoke from that same artifact-bearing checkout:

```bash
export T360_PRODUCTION_SMOKE_CONFIRM=RUN_T360_PRODUCTION_SMOKE
export T360_PRODUCTION_BASE_URL=https://app.example.com
export T360_PRODUCTION_EXPECTED_HOST=app.example.com
export T360_PRODUCTION_EXPECTED_SOURCE_FINGERPRINT='<current source fingerprint>'
export T360_PRODUCTION_EXPECTED_BUILD_ARTIFACT_ID='<promoted build artifact id>'
export T360_PRODUCTION_EXPECTED_DB_HOST='<exact PostgreSQL production hostname>'
export T360_PRODUCTION_EXPECTED_DB_NAME='<exact PostgreSQL production database name>'
export T360_PRODUCTION_TEST_EMAIL=...
export T360_PRODUCTION_TEST_PASSWORD=...
npm run production:smoke
```

The smoke is deliberately narrow: HTTPS health/release identity + expected PostgreSQL target identity + security headers, login/session registration, read-only operations health, read-only financial integrity, and logout/revocation. It does not create business transactions.

Before cutover, create the real PostgreSQL production backup with the canonical backup tool, then verify the artifact locally/read-only against the exact production DB identity. The verifier never connects to production and never restores production:

```bash
export T360_PRODUCTION_BACKUP_CONFIRM=VERIFY_T360_PRODUCTION_BACKUP
export T360_PRODUCTION_BACKUP_METADATA='<path-to-backup.dump.json>'
export T360_PRODUCTION_EXPECTED_DB_HOST='<exact PostgreSQL production hostname>'
export T360_PRODUCTION_EXPECTED_DB_NAME='<exact PostgreSQL production database name>'
npm run production:backup:verify
```

The backup must be checksum/size valid, fresh (default <=120 minutes; configurable up to 24 hours), created after promotion PASS, and verified before production smoke. Final production-ready verification rejects a backup from any other database target.

After the production deployment/migrations are applied but **before production smoke credentials are sent**, run the read-only PostgreSQL schema-contract verifier from the exact promoted checkout:

```bash
export T360_PRODUCTION_SCHEMA_CONFIRM=VERIFY_T360_PRODUCTION_SCHEMA_READ_ONLY
export T360_PRODUCTION_SCHEMA_DATABASE_URL='<protected production PostgreSQL URL>'
export T360_PRODUCTION_EXPECTED_DB_HOST='<exact PostgreSQL production hostname>'
export T360_PRODUCTION_EXPECTED_DB_NAME='<exact PostgreSQL production database name>'
npm run production:schema:verify
```

This verifier requires current-source promotion + production-backup PASS first, opens a `SET TRANSACTION READ ONLY` transaction, and compares the generated Prisma datamodel against production tables/columns, PostgreSQL enum values, and release-critical indexes. It writes only hashed target identity/counts/missing contract items; credentials/URL are not written to evidence. Production smoke refuses to start unless this schema evidence is PASS for the same source and database.

After reviewing the actual cutover, copy `config/production-deployment-attestation.json.example` to `production-deployment-attestation.json`, record the exact promoted `buildArtifactId`, application-host hash plus PostgreSQL host/database hashes from smoke evidence, and confirm the machine-verified/protected pre-deploy backup, migrations, six runtime services, web surfaces, monitoring, queue health, rollback readiness, smoke review, and financial integrity review.

Finally run:

```bash
npm run production:ready:verify
```

Only this final PASS sets `productionReady=true`. Post-release monitoring remains mandatory even after PASS.

## Evidence files

- `handoff/quality/build-artifact-manifest-latest.json`
- `handoff/quality/uat-candidate-latest.json`
- `logs/stage20-release-readiness/latest.json`
- `handoff/quality/staging-certification-latest.json`
- `handoff/quality/load-health-latest.json`
- `handoff/quality/postgres-index-profile-latest.json`
- `handoff/quality/postgres-dr-drill-latest.json`
- `handoff/quality/production-promotion-latest.json`
- `handoff/quality/production-backup-latest.json`
- `handoff/quality/production-schema-latest.json`
- `handoff/quality/production-smoke-latest.json`
- `handoff/quality/production-ready-latest.json`

Credentials, database URLs, passwords, tokens and secret material must never be copied into these evidence JSON files.
