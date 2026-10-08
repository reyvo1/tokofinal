# TOKO360 Master Recovery Workflow — 48/48

## Current recovery baseline

- Snapshot HEAD: `c391fc9fd8c42cb6352317853718cba1415a9603` (`main`).
- Working tree: F12R4 changes are present but uncommitted and are **not** accepted as final product evidence.
- Repository validation: 1,244 files, 180 Prisma models.
- Full repository audit: 959 source files, 401 API handlers, 278 UI interactive elements.
- Tailwind CSS v4 exact: `4.3.3`; PostCSS exact: `8.5.28`.
- Human Stage-20: **BLOCKED/PENDING**.

## Recovery rule

Product completeness means `DB/config → business logic → API → permission/tenant scope → operator UI → runtime evidence → documentation`. Source-contract tests remain useful guards but cannot substitute for runtime E2E evidence for CRITICAL/HIGH findings.

## Execution order

`R0 → R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8`

## R0 — Truth Reset, Audit Closure, and Work Governance

**Depends on:** none.

- Regenerate current capability/audit truth from source.
- Lock 48/48 finding coverage and work governance.
- Reconcile stale project/completion documentation.
- Block F12R4 final verification until functional recovery prerequisites close.

## R1 — Tenant, Branch, Identity, Access, and Control Plane

**Depends on:** R0.

- Tenant/company administration.
- Branch context/switching.
- User/role/permission/status administration.
- Control-plane operator surfaces and audit.

## R2 — HRIS, Attendance, Employee Self-Service, and Payroll

**Depends on:** R1.

- WorkShift/roster/AttendancePolicy.
- Attendance correction lifecycle.
- HR device/geofence/biometric management.
- Employee notification bindings.
- Payroll tax/social/accounting configuration and missing payroll methods.

## R3 — Reporting, Owner Digest, Notifications, Providers, Marketplace, and Edge Integrations

**Depends on:** R1.

- Owner digest config/security/correctness.
- Telegram/WhatsApp provider operations.
- Payment diagnostics, marketplace, edge sync, ExternalMapping.
- Verified recipients and retry/dead-letter operations.

## R4 — Core Business Hidden and Partial Flows

**Depends on:** R1.

- Supplier lifecycle.
- Inventory movement ledger.
- Goods receipt reject.
- General Ledger and hidden business reports.
- Accounting close canonicalization, promotion completeness, Storefront branch strategy.

## R5 — Assets, Fleet, Maintenance, and Operational Lifecycle

**Depends on:** R1.

- Asset maintenance plans.
- Vehicle-driver assignment.
- Asset assign/transfer/dispose and maintenance lifecycle.

## R6 — Scale, Summaries, Retention/Archive, and AI Capability Truth

**Depends on:** R0.

- Summary materialization.
- Retention/archive runtime.
- Schema-only capability review.
- Truthful AI/forecast capability and provider decision.

## R7 — Full Tailwind UI / Information Architecture Rebuild

**Depends on:** R1, R2, R3, R4, R5, R6.

- Final Tailwind IA after functional routes stabilize.
- One primary + one contextual navigation layer.
- No inert controls/hidden settings.
- Canonical charts, responsive geometry, accessibility, operator acceptance.

## R8 — GitHub Full Runtime UAT and Release Evidence

**Depends on:** R1, R2, R3, R4, R5, R6, R7.

- PostgreSQL migration rehearsal.
- Exact six-app build artifact.
- Runtime API/mutation journeys.
- Browser mutation journeys and denial matrix.
- Provider simulator full chain.
- Load/index/DR/restore evidence.
- Exact artifact identity + Human Stage-20 separation.

## 48/48 finding coverage

| ID | Severity | Domain | Primary | Secondary | Status | Finding |
|---|---|---|---|---|---|---|
| F01 | CRITICAL | TRUTH | R0 | - | OPEN_REVALIDATION_REQUIRED | F1 audit belum selesai menurut source of truth |
| F02 | CRITICAL | TRUTH | R0 | - | OPEN_REVALIDATION_REQUIRED | Audit F1 lama kontradiktif dengan datanya sendiri |
| F03 | HIGH | WORKFLOW | R0 | - | OPEN_REVALIDATION_REQUIRED | Tidak ada work item aktif pada snapshot |
| F04 | CRITICAL | UAT | R8 | R0 | OPEN_REVALIDATION_REQUIRED | Mayoritas regression adalah source-contract, bukan eksekusi bisnis |
| F05 | CRITICAL | UAT | R8 | R0 | OPEN_REVALIDATION_REQUIRED | Critical UAT coverage hanya memetakan skenario ke file |
| F06 | HIGH | UAT | R8 | R7 | OPEN_REVALIDATION_REQUIRED | Browser UAT resmi sengaja read-only |
| F07 | CRITICAL | TENANT | R1 | - | OPEN_REVALIDATION_REQUIRED | Tidak ada Company/Tenant administration CRUD |
| F08 | HIGH | TENANT | R1 | - | OPEN_REVALIDATION_REQUIRED | Tidak ada branch switcher operasional di Admin |
| F09 | HIGH | ACCESS | R1 | - | OPEN_REVALIDATION_REQUIRED | User/role API lebih lengkap daripada UI |
| F10 | HIGH | PLATFORM | R1 | R7 | OPEN_REVALIDATION_REQUIRED | Banyak control-plane API tidak punya operator UI |
| F11 | CRITICAL | HR | R2 | - | OPEN_REVALIDATION_REQUIRED | WorkShift ada di database tetapi tidak punya workflow runtime |
| F12 | CRITICAL | HR | R2 | - | OPEN_REVALIDATION_REQUIRED | EmployeeSchedule nyaris hanya dipakai sebagai hitungan |
| F13 | CRITICAL | HR | R2 | - | OPEN_REVALIDATION_REQUIRED | AttendanceCorrection menjadi blocker tanpa workflow koreksi |
| F14 | HIGH | HR | R2 | - | OPEN_REVALIDATION_REQUIRED | EmployeeAssignment tidak diimplementasikan |
| F15 | HIGH | HR | R2 | - | OPEN_REVALIDATION_REQUIRED | AttendancePolicy tidak punya management API/UI |
| F16 | HIGH | HR | R2 | - | OPEN_REVALIDATION_REQUIRED | Geofence/device/biometric API tidak punya Admin workflow |
| F17 | HIGH | HR | R2 | R3 | OPEN_REVALIDATION_REQUIRED | Portal karyawan tidak mengekspos binding Telegram/WhatsApp |
| F18 | CRITICAL | PAYROLL | R2 | - | OPEN_REVALIDATION_REQUIRED | Employee tax/social profile tidak punya management API/UI |
| F19 | CRITICAL | PAYROLL | R2 | - | OPEN_REVALIDATION_REQUIRED | PayrollAccountingMapping dibaca tetapi tidak dapat dikelola operator |
| F20 | HIGH | PAYROLL | R2 | - | OPEN_REVALIDATION_REQUIRED | Gross-up/net belum diimplementasikan |
| F21 | HIGH | PAYROLL | R2 | - | OPEN_REVALIDATION_REQUIRED | Split-period/proration payroll belum tersedia |
| F22 | CRITICAL | REPORTING | R3 | R7 | OPEN_REVALIDATION_REQUIRED | Owner Telegram daily digest tidak punya UI konfigurasi |
| F23 | CRITICAL | SECURITY | R3 | R8 | OPEN_REVALIDATION_REQUIRED | Owner daily digest mutation tidak punya permission decorator |
| F24 | HIGH | REPORTING | R3 | R8 | OPEN_REVALIDATION_REQUIRED | Daily digest enabled flag tidak mencegah manual send |
| F25 | HIGH | REPORTING | R3 | R8 | OPEN_REVALIDATION_REQUIRED | Low-stock digest bisa melewatkan stok menipis |
| F26 | HIGH | AI | R6 | R7 | OPEN_REVALIDATION_REQUIRED | Label AI lebih besar dari capability aktual |
| F27 | HIGH | SCALE | R6 | R8 | OPEN_REVALIDATION_REQUIRED | DailySalesSummary/DailyFinanceSummary tidak dipakai runtime |
| F28 | HIGH | SCALE | R6 | R8 | OPEN_REVALIDATION_REQUIRED | Retention/archive hanya model |
| F29 | HIGH | INTEGRATION | R3 | R6 | OPEN_REVALIDATION_REQUIRED | ExternalMapping model tidak dipakai runtime |
| F30 | MEDIUM | ACCOUNTING | R4 | R6 | OPEN_REVALIDATION_REQUIRED | AccountingCloseControl tidak dipakai runtime |
| F31 | HIGH | ASSET | R5 | R8 | OPEN_REVALIDATION_REQUIRED | AssetMaintenancePlan hanya hidup di worker |
| F32 | HIGH | FLEET | R5 | R8 | OPEN_REVALIDATION_REQUIRED | VehicleDriverAssignment tidak diimplementasikan |
| F33 | HIGH | ASSET | R5 | R7 | OPEN_REVALIDATION_REQUIRED | Assign/transfer/dispose backend tidak terekspos UI |
| F34 | MEDIUM | INVENTORY | R4 | R7 | OPEN_REVALIDATION_REQUIRED | Canonical inventory movement ledger tidak terekspos |
| F35 | MEDIUM | PROCUREMENT | R4 | R7 | OPEN_REVALIDATION_REQUIRED | Goods receipt reject tidak terekspos UI |
| F36 | MEDIUM | MASTER | R4 | R7 | OPEN_REVALIDATION_REQUIRED | Supplier master hanya list/create |
| F37 | HIGH | PAYMENT | R3 | R7 | OPEN_REVALIDATION_REQUIRED | Payment provider event diagnostics tidak punya UI |
| F38 | MEDIUM | REPORTING | R4 | R7 | OPEN_REVALIDATION_REQUIRED | General Ledger report tidak dipanggil UI |
| F39 | HIGH | REPORTING | R3 | R7 | OPEN_REVALIDATION_REQUIRED | Daily digest, multi-outlet, cashier target tersembunyi |
| F40 | HIGH | STOREFRONT | R4 | R7 | OPEN_REVALIDATION_REQUIRED | Storefront dikunci ke satu branch lewat environment |
| F41 | MEDIUM | PROMOTION | R4 | R8 | OPEN_REVALIDATION_REQUIRED | Advanced promotion masih eksplisit open |
| F42 | HIGH | EDGE | R3 | R8 | OPEN_REVALIDATION_REQUIRED | Device/sync backend lebih dalam daripada UI |
| F43 | HIGH | MARKETPLACE | R3 | R7 | OPEN_REVALIDATION_REQUIRED | MarketplaceOrder API tidak punya Admin UI |
| F44 | HIGH | NOTIFICATION | R3 | R8 | OPEN_REVALIDATION_REQUIRED | Owner report recipient memakai raw string tanpa binding verification |
| F45 | MEDIUM | UI | R7 | - | PARTIAL_F12R4_UNVERIFIED | Design system chart requirement tidak diikuti |
| F46 | HIGH | UI | R7 | - | PARTIAL_F12R4_UNVERIFIED | Information architecture terlalu menggabungkan domain besar |
| F47 | MEDIUM | DOC | R0 | - | OPEN_REVALIDATION_REQUIRED | Dokumen status saling bertentangan |
| F48 | HIGH | DOC | R0 | - | OPEN_REVALIDATION_REQUIRED | F1 audit lama sudah stale |

## Closure invariant

- 48/48 findings mapped; 0 unmapped.
- CRITICAL/HIGH cannot close from regex/source evidence alone.
- R7 cannot be accepted before R1–R6 functional prerequisites.
- R8 exact-artifact runtime UAT and Human Stage-20 are separate gates.
