# F8 Scheduled reports

Expand-only migration for first-class report schedules and schedule-to-job traceability.

- Existing `ReportJob` rows remain valid with nullable `scheduleId` / `scheduledFor`.
- `ReportSchedule` is branch-scoped and materialized by the worker into canonical `ReportJob` rows.
- The patch does not auto-run this migration.
