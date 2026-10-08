# Runtime / Staging Certification migration

Adds server-side authentication sessions and database-backed login throttling.

## Required deployment order

1. Take and verify a TEST/STAGING backup.
2. Apply the provider-specific expand SQL.
3. Configure `SECRET_MASTER_KEY` (32-byte hex/base64) and `SECRET_KEY_ID` before production startup.
4. Deploy API and worker together.
5. Existing JWTs created before this migration intentionally become invalid because they do not contain a registered `sid`; users must login again.
6. Run `npm run secrets:migrate -- --apply` in TEST/STAGING to encrypt legacy secret settings, integration secrets and webhook headers. Run without `--apply` first for a dry-run count. This migrates legacy plaintext only; re-key rotation is a separate operational procedure.
7. Run multi-worker webhook/outbox tests and restore rehearsal before production cutover.

Rollback of the session tables is intentionally not automated while active sessions exist. Database rollback must follow the documented release rollback procedure.
