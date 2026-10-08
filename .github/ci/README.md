# GitHub CI / system simulation

GitHub is the heavy-test environment for Toko360. Local/chat validation should stay cheap; the full dependency/runtime simulation runs after a large batch is pushed.

## Workflow split

- `ci.yml` — pull-request validation: repository/workflow checks, full regression/workspace tests, SQLite integration, PostgreSQL schema/build smoke.
- `full-system-simulation.yml` — every push and manual dispatch. This is the primary heavy simulation and runs one exact build artifact through PostgreSQL + browser/runtime gates.
- `workflow-governance.yml` — manifest and PR policy; intentionally dependency-free.
- `performance-smoke.yml` — manual focused performance smoke.
- `release-candidate.yml` — separate release/UAT flow; automated GitHub simulation does **not** replace human Stage-20 UAT.

## Full system simulation contract

The full simulation intentionally pins `ubuntu-24.04` and PostgreSQL **16** server/client parity (important for `pg_dump`/`pg_restore` rehearsals). The current worker uses database polling, so the heavy workflow deliberately does **not** provision an unused Redis service. Real staging still certifies the actual deployment PostgreSQL version. It performs:

1. deterministic `npm ci` through `build:gate`;
2. workflow/repository validation, lint, all root/workspace tests, Prisma SQLite/PostgreSQL validation/generation, and six-app production build;
3. exact build artifact manifest + source fingerprint;
4. bootstrap PostgreSQL schema/seed;
5. Stage-18 ownership migration + backup/restore rehearsal;
6. payroll-adjustment PostgreSQL migration rehearsal;
7. Stage-19 real HTTP/DB tenant integration **without rebuilding** the tested artifact;
8. six-process built browser UAT (API, worker, Storefront, Admin, POS, Employee Portal), then a process-group-managed runtime for certification/load so all child processes are terminated cleanly;
9. staging certification, identity-locked load smoke, index profile and PostgreSQL DR rehearsal;
10. Stage-20 automated checks using exactly 12 `PENDING` human UAT scenarios;
11. an explicit negative assertion that `verify-uat-candidate` remains blocked until human Stage-20 evidence exists;
12. an always-written current-source simulation summary (missing/stale gates are explicit), then upload of the exact tested runtime outputs plus all logs/evidence; Next.js `.next` directories are explicitly included (cache excluded), and GitHub's immutable artifact SHA-256 digest is recorded as transport evidence.

The automated GitHub simulation may report **simulation PASS**, but it must never claim `UAT candidate`, `promotion ready`, or `production ready` by itself.

## Security / safety

All DB names used by the workflow contain staging/restore markers. CI scripts reject `prod`, `production`, and `live` targets. The workflow never invokes production smoke/schema/promotion actions and never needs production credentials.
