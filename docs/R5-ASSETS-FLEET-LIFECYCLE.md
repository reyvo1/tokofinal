# Recovery R5 — Assets, Fleet, Maintenance, and Operational Lifecycle

## Authority and scope

R5 follows `docs/TOKO360-MASTER-RECOVERY-WORKFLOW.md` and depends only on closed R1. It does not reopen R0–R4 without regression evidence.

R5 closes implementation gaps for:

- F31 — expose `AssetMaintenancePlan` management;
- F32 — implement `VehicleDriverAssignment` lifecycle;
- F33 — expose asset assign/transfer/dispose operator flow.

All three findings are HIGH and require exact-source runtime evidence before closure.

## F31 — AssetMaintenancePlan management

The existing `AssetMaintenancePlan` Prisma model remains authoritative in SQLite and PostgreSQL. No migration is introduced.

API lifecycle:

- `GET /api/v1/assets/maintenance-plans`
- `POST /api/v1/assets/maintenance-plans`
- `POST /api/v1/assets/maintenance-plans/:id/update`

Rules:

- authenticated company/branch scope is authoritative;
- the target asset must belong to the authenticated company and branch;
- at least one interval (`intervalDays` or `intervalOdometer`) is required;
- odometer interval is allowed only for vehicle assets;
- optional checklist template must be active and owned by the authenticated company;
- create/update mutations are audited.

The existing worker remains authoritative for due-plan scanning, `asset.maintenance.due`, and `CREATE_MAINTENANCE_WORK_ORDER` automation.

## F32 — VehicleDriverAssignment lifecycle

The existing `VehicleDriverAssignment` model remains authoritative. No migration is introduced.

API lifecycle:

- `GET /api/v1/fleet/driver-assignments`
- `POST /api/v1/fleet/driver-assignments`
- `POST /api/v1/fleet/driver-assignments/:id/end`

Rules:

- vehicle and employee must belong to the authenticated company/branch;
- employee must be active;
- end date cannot precede start date;
- duplicate driver/vehicle periods cannot overlap;
- primary-driver periods for the same vehicle cannot overlap;
- an active primary assignment updates `Vehicle.defaultDriverEmployeeId`;
- ending the current active primary assignment clears that projection;
- create/end mutations are audited;
- date-only `effectiveFrom`/`effectiveTo` values are company-calendar dates, resolved with `Company.timezone` rather than UTC process midnight; an effective end date is inclusive through the company-local day.

## F33 — asset lifecycle operator flow

Admin `Asset & Fleet` now exposes real operator controls for:

- asset assignment;
- Asset handover inspection create/finalize;
- asset transfer;
- asset disposal/sale.

The inspection gate is preserved. Admin does not auto-pass transfer/disposal. The operator must explicitly finalize an Asset handover inspection, and transfer/disposal only offers inspections with status `PASSED` or `APPROVED` for the same asset. Backend validation remains authoritative.

## Runtime closure gate

`npm run ci:r5:probe` exercises the real PostgreSQL API runtime and writes:

`handoff/quality/github-r5-assets-fleet-probe-latest.json`

The probe verifies:

- maintenance-plan create/list/update;
- driver-assignment create/list/end;
- company-timezone business-date activation for a primary driver, including the UTC/local-day boundary;
- active primary-driver projection and projection clear after immediate end;
- asset assignment;
- inspection-gated asset transfer;
- inspection-gated asset disposal.

Both GitHub heavy workflows run this probe. Aggregate automated evidence treats the R5 probe as required. Static/source tests are necessary but cannot close F31/F32/F33.

Human Stage-20 remains PENDING and separate from automated R5 verification.
