# F9 WhatsApp / Telegram Notification Center Completion

Status: **SOURCE IMPLEMENTATION COMPLETE**. Runtime/browser/human UAT remains deferred by operator instruction.

## Provider configuration

- Existing `IntegrationConnection` remains the canonical provider configuration store; no second notification-provider table or engine was introduced.
- Notification providers use `type = NOTIFICATION` and can be company-wide or branch-specific.
- Provider secrets remain encrypted in `encryptedSecrets` and are never returned by the notification-provider read model.
- Telegram supports the native Bot API adapter from the connected integration.
- WhatsApp and other external channels use the provider-neutral HTTP POST adapter from encrypted integration configuration.
- Environment-based Telegram/WhatsApp credentials remain compatibility fallback only when no matching connected integration exists.
- Provider failures mark the selected integration `DEGRADED` with health/error visibility; successful sends refresh health state.

## Notification templates and queue

- Existing `NotificationTemplate` and `Notification` remain authoritative.
- Templates stay tenant-scoped and channel-specific.
- Queueing derives company/branch from authenticated context and persists the branch envelope in notification data.
- Notification history can be filtered by supported channel/status while preserving company and branch isolation.

## Delivery lifecycle

- External notifications keep the existing worker lease/retry/backoff flow.
- Connected provider selection is tenant/channel aware and prefers branch-specific connection over company-wide fallback.
- Stable notification ID is used as idempotency identity for generic provider delivery.
- PENDING delivery work can be cancelled while still queued.
- FAILED/CANCELLED notifications can be replayed safely by resetting the canonical notification lifecycle rather than creating duplicate notification records.
- Linked employee notification delivery state is reset together with notification replay/cancel lifecycle.

## Operator UI

Admin Notification Center exposes:

- WhatsApp/Telegram provider connection health and activate/deactivate controls;
- encrypted provider configuration through the existing integration-management API;
- notification-template create/edit lifecycle;
- manual queueing through the existing notification API;
- delivery history with channel, recipient, provider, attempts, status, and last error;
- cancel for queued delivery and replay for failed/cancelled delivery.

## Tenant and permission safety

- Company/branch identity comes from authenticated context, never free client authority.
- Provider listing is company-scoped and branch-aware.
- Notification history is company-scoped and enforces the stored branch envelope before channel/status filters.
- Notification mutation remains protected by `notification.manage`; integration lifecycle uses the existing integration permission model.
- Legacy tenant regression was hardened to verify the actual structural tenant contract instead of brittle source-line formatting.

## Database / migration

- No schema change is required for F9.
- Existing `IntegrationConnection`, `NotificationTemplate`, `Notification`, and `EmployeeNotificationDelivery` remain canonical.
- No database migration is included.

## Verification

- Focused F9 + tenant/legacy notification regression: **18/18 PASS**.
- `npm run workflow:validate`: **PASS**.
- `npm run validate:repo`: **PASS** (178 Prisma models, SQLite/PostgreSQL profiles valid).
- `npm run test:dependency-free`: **796/796 PASS**.
- Runtime/browser/human UAT: **DEFERRED**.

Next locked phase: **F10 AI / forecasting / operator assistant**.
