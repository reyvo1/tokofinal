# T360-20260928-053000 — continuation checklist

- [x] Preserve existing dirty tree; work-item branch created.
- [x] Read current checkpoint, work item and workflow; initial validation.
- [x] Audit source navigation, bootstrap, role guards and branch switching.
- [x] Implement UIA-01 through UIA-08 (see docs/UI-BUSINESS-AUDIT-20260929.md).
- [x] Eight focused regression tests and dependency-free tests pass.
- [x] Quality fast and full source audit pass.
- [x] Six-application build; final affected frontend rebuild recorded separately.
- [x] Inspect real shell components with synthetic browser data; retain evidence limitations.
- [x] Restore files missing from the copy (`.gitignore`, `.env*.example`, `.github/workflows/`, `.github/ci/`, templates) so `validate:repo` and the suite can run; `.env` deliberately not copied.
- [x] Rebuild the C3 assertion around the route instead of the `api<>()` call shape, and add two permission guards for the `read()` loader.
- [ ] Resolve backend idempotency compatibility and payroll pagination findings.
- [ ] Exact-source PostgreSQL/authenticated multi-role transaction UAT.
- [ ] Human visual acceptance / Stage-20; commit/push only afterward.

Rollback: revert only continuation hunks; no database rollback required.

Session evidence (run in this repo, not quoted): `test:dependency-free` 1089/1089, `validate:repo` PASS, `audit:full:repo` PASS. This repository has no `.git`, so the branch name in older notes cannot be confirmed from here.
