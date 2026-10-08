# F8 Automation + Scheduled Reports Completion

Status: **SOURCE IMPLEMENTATION COMPLETE**. Runtime/browser/human UAT remains deferred by operator instruction.

## Business rule lifecycle

- Existing `BusinessRule` remains the canonical rule definition; no second rule engine was introduced.
- Admin/API now support create, edit, activate, and deactivate lifecycle.
- Rule definitions validate JSON condition shape and supported actions before persistence.
- Supported rule actions include notification, approval, reorder suggestion, outbox emission, maintenance automation, and canonical report-job enqueue.
- Rule mutations are tenant-scoped and audited; `automation.manage` protects mutations.

## Automation execution history

- Existing `AutomationJob` remains the canonical execution ledger.
- Operator APIs expose tenant/branch-scoped job history and detail/audit trail.
- PENDING/RETRYING jobs can be cancelled before execution.
- FAILED/CANCELLED jobs can be replayed safely through the existing retry lifecycle.
- Worker execution remains idempotent and uses serializable transactions for DB side effects.

## Scheduled reports

- Added first-class `ReportSchedule`, branch-scoped to the authenticated tenant.
- Schedules support DAILY, WEEKLY, and MONTHLY recurrence at local company time.
- Company timezone is authoritative; client cannot inject arbitrary tenant scope.
- Due schedules are atomically materialized by the worker into the existing canonical `ReportJob` queue.
- `(scheduleId, scheduledFor)` uniqueness plus transactional schedule advancement prevents duplicate scheduled jobs across concurrent workers.
- Manual **run now** creates a canonical `ReportJob`; exports still use the existing CSV/XLSX/PDF report worker.
- Report completion/failure updates schedule health (`lastJobId`, `lastError`).

## Database / migration

- `ReportJob` gains nullable `scheduleId` and `scheduledFor` for traceability.
- New `ReportSchedule` model is included in SQLite and PostgreSQL Prisma profiles.
- Expand-only migrations are under `database/migrations/T360-20260923-f8-report-schedule/`.
- Migrations are included but intentionally not auto-applied.

## Operator UI

Admin **Sistem & Akses → Automation** exposes:

- business rule create/edit/activate/deactivate;
- automation execution history with status filter;
- cancel and replay controls;
- scheduled report create/activate/deactivate/run-now;
- last/next run and failure visibility.

## Verification

- Focused F8 + existing automation: **21/21 PASS**.
- `npm run workflow:validate`: **PASS**.
- `npm run validate:repo`: **PASS** (178 Prisma models at the time of this wave, 180 now; SQLite/PostgreSQL profiles valid).
- `npm run test:dependency-free`: **791/791 PASS**.
- Runtime/browser/human UAT: **DEFERRED**.

Next locked phase: **F9 WhatsApp / Telegram notification center**.
