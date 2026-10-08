# R1 — Tenant, Branch, Identity, Access, and Control Plane

Status: **VERIFICATION**  
Work item: `T360-20260924-022400`

R1 closes recovery findings F07–F10 without changing the product's tenant trust boundary.

## Canonical decisions

- `Company` remains the tenant root derived from authenticated user home-branch context.
- New company provisioning is **BOOTSTRAP_ONLY**. The current schema has no cross-company membership model, so exposing arbitrary company creation/switching in Admin would create an unsafe identity model.
- `User.branchId` remains the user's home branch.
- `AuthSession.activeBranchId` is the active operational branch. A switch never rewrites `User.branchId`.
- A branch target must be active and belong to the authenticated home company.
- `branch.switch` is required unless the account is `SUPER_ADMIN`.
- Refresh rotation and every JWT-authenticated request revalidate active branch against the home company.

## Operator surfaces

### Tenant & Organization

Admin now exposes current company profile (name, timezone, currency), branch create/edit/status lifecycle, and active-branch context. Company provisioning mode is visible so operators are not given a fake Create Tenant action.

### User & Role

Admin exposes user creation, activate/deactivate, multi-role assignment, role creation, and role permission management. Protected-role rules remain enforced by the API.

### Control plane

Settings & Access now exposes system settings, custom fields, approval policies/queue, webhooks, runtime UI schemas, audit logs, event outbox/replay, and ops health. Sensitive routes are explicitly permissioned by the backend.

## Migration

`T360-20260924-r1-session-branch-context` is expand-only for SQLite and PostgreSQL and adds nullable `AuthSession.activeBranchId` plus its lookup index. Old application versions can continue using `User.branchId`; therefore rollback does not require destructive schema rollback.

## Runtime evidence

`npm run ci:r1:probe` is required by both GitHub full-system workflows. It proves on live PostgreSQL runtime:

- current tenant profile read/update;
- branch create and same-company session switch;
- refresh/runtime manifest observes switched branch;
- invalid/foreign branch denial;
- foreign company query denial;
- permission catalog contains `branch.switch`;
- role create + permission update;
- user create + role change + deactivate/reactivate;
- control-plane APIs respond under the correct authenticated scope;
- branch context returns to home branch.

R1 must not be marked CLOSED until this runtime evidence passes on the exact GitHub artifact/source fingerprint. Human Stage-20 remains separate.
