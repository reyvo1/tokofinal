-- TEMPLATE ONLY. Apply through a rehearsed PostgreSQL migration, not directly on production.
-- AttendanceEvent is append-only and is the main HR table expected to grow rapidly.

-- Future physical table example using snake_case mapping or a reporting store:
-- CREATE TABLE attendance_events_partitioned (
--   LIKE attendance_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS
-- ) PARTITION BY RANGE (occurred_at);
--
-- CREATE TABLE attendance_events_2026_07
-- PARTITION OF attendance_events_partitioned
-- FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
--
-- CREATE INDEX CONCURRENTLY attendance_events_2026_07_employee_time_idx
-- ON attendance_events_2026_07 (employee_id, occurred_at DESC);
--
-- CREATE INDEX CONCURRENTLY attendance_events_2026_07_branch_time_idx
-- ON attendance_events_2026_07 (company_id, branch_id, occurred_at DESC);

-- Candidates for time partitioning after measured thresholds:
-- AttendanceEvent.occurredAt
-- AttendanceRecord.workDate
-- EmployeeNotificationDelivery.createdAt
-- PayrollLine through PayrollResult/PayrollPeriod reporting tables

-- Keep PayrollResult/Payslip immutable. Archive evidence files through object-storage
-- lifecycle policies, while retaining hashes, audit references, and legal holds.
