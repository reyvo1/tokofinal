# T360-20260911 Purchase Request

Expand-only migration for the procurement request lifecycle introduced before direct Purchase Order creation.

Workflow: `DRAFT -> PENDING_APPROVAL -> APPROVED/REJECTED -> CONVERTED` with optional cancellation before approval/conversion. Approval uses the canonical `ApprovalRequest` workflow; conversion uses an idempotency key derived from the Purchase Request id so retries cannot create duplicate Purchase Orders.

Apply the profile-specific `*-expand.sql` through the normal migration gate. Local development may continue to use the repository's Prisma `db push` workflow.
