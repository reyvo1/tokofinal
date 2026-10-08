# T360 Asset/Fleet Reconciliation migration

Expand-only migration for the Asset/Fleet integrity stage.

Changes:

- add `FuelTransaction.supplierId` so credit fuel purchases have an auditable supplier payable source;
- add supplier/date index for payable and reporting queries.

The source stage also adds canonical accounts `4202` / `6202` and posting rules `ASSET-MAINTENANCE-PARTS` / `ASSET-DISPOSAL`. These are configuration upserts, not DDL.

Deployment for an existing database:

1. Backup TEST/STAGING and verify restore point.
2. Apply the matching expand SQL for the active database profile.
3. Deploy source.
4. Run the canonical configuration seed/upsert through the environment-safe deployment procedure so accounts and posting rules are available.
5. Reconcile any historical `FLEET_FUEL_CREDIT` rows created before this migration. They have no supplier trace and must not be auto-settled without verified evidence.
6. Run Asset/Fleet runtime + accounting reconciliation tests in TEST/STAGING before production.

Do not run demo reset/seed against production data.
