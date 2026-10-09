# P5 Full UI Root Audit — V4.9 Four-Product Root Design System

## Scope

- API: **43 controllers / 509 handlers / 195 Prisma models**.
- Admin: **15 primary workspaces / 70 contextual views**.
- POS: **4 views**; Storefront: **5 views**; Employee Portal: **7 views**.
- Static interaction inventory: **514 controls**.

## Presentation authority

| Surface | Files | Lines | Required semantic classes | Missing |
|---|---:|---:|---:|---:|
| admin | 50 | 10327 | 34 | 0 |
| pos | 10 | 1977 | 5 | 0 |
| storefront | 7 | 1079 | 30 | 0 |
| employee-portal | 11 | 1096 | 21 | 0 |

## Interaction inventory

| Surface | Buttons | Links | Inert buttons | Inert links |
|---|---:|---:|---:|---:|
| admin | 390 | 2 | 0 | 0 |
| pos | 54 | 1 | 0 | 0 |
| storefront | 45 | 1 | 0 | 0 |
| employee-portal | 20 | 1 | 0 | 0 |

## Admin domain/subdomain authority

All **70/70** contextual destinations are source-mapped. No canonical Admin contextual domain is unmapped.

- **Dashboard** `/dashboard`: overview/root only
- **Penjualan & Order** `/commerce`: `orders`, `fulfillment`, `returns`, `channels`
- **Pembelian** `/procurement`: `requests`, `orders`, `receipts`, `supplier`
- **Produksi** `/manufacturing`: `recipes`, `orders`
- **Persediaan** `/inventory-control`: `overview`, `traceability`, `transfers`, `stocktake`, `returns`
- **Kontrol Operasional** `/operations-control`: `inspections`, `evidence`, `gate-pass`, `delivery`
- **Produk & Master Data** `/master-data`: `catalog`, `customers`, `products`, `pricing`, `references`, `bulk-labels`
- **Keuangan** `/finance`: `ledger`, `tax`, `fiscal`, `payables`, `receivables`, `banking`
- **Laporan & Analitik** `/reports`: `financial`, `operations`, `scheduled`, `owner`
- **HRIS & Payroll** `/people`: `employees`, `attendance`, `payroll`, `compliance`
- **Aset & Armada** `/assets-fleet`: `assets`, `maintenance`, `vehicles`, `trips`
- **Forecast & Otomasi** `/intelligence`: `ai`, `forecast`, `automation`, `schedules`
- **Integrasi & Notifikasi** `/integrations`: `providers`, `notifications`, `connections`, `devices`, `loyalty`, `ppob`
- **Tenant & Organisasi** `/organization`: `organization`, `locations`, `references`
- **Pengaturan & Akses** `/settings`: `features`, `users`, `platform`, `custom-fields`, `approvals`, `webhooks`, `ui-config`, `audit-ops`, `security`, `api-keys`, `data-governance`, `branch-sync`, `mobile-ops`, `setup`

## Capability exposure truth

| ID | Capability | Exposure | UI apps | Depth/readiness note |
|---|---|---|---|---|
| F2 | Master Product + Multi-UOM | **EXPOSED** | admin, pos, storefront | Multi-UOM berbasis barcode/factor sudah ada, tetapi ProductVariant dan model konversi UOM first-class belum terlihat sebagai model dedicated. F2 harus menormalkan master produk/variant/UOM tanpa merusak POS yang sudah memakai quantityFactor. |
| F3 | Inventory / batch / expiry / condition | **EXPOSED** | admin, pos | Batch, serial, location, transfer, opname sudah kuat. Condition bucket general seperti AVAILABLE/DAMAGED/QUARANTINE/LOST belum terlihat sebagai inventory condition ledger first-class. |
| F4 | Accounting workspace enterprise | **EXPOSED** | admin | Accounting core kuat dan UI ledger sudah ada, tetapi posting rule/account mapping/version management serta source→event→journal→line drill-down belum terbukti lengkap di operator UI. |
| F5 | Tax workspace dinamis | **EXPOSED** | admin | Tax engine/model tersedia, tetapi tax transaction/document ledger, effective-dated rule management, preview, reconciliation, dan audit trail belum seluruhnya terekspos di UI. |
| F6 | Financial reporting + drill-down | **EXPOSED** | admin | ReportJob dan katalog report tersedia. F6 harus menambah dynamic filters, period comparison, branch/cost-center dimensions, dan report→account→journal→source drill-down. |
| F7 | AR / AP / Cash / Bank / Reconciliation | **EXPOSED** | admin | Operational AP/AR dan bank reconciliation sudah ada. Aging, statement/detail navigation, settlement trace, dan reconciliation operator flow perlu diperdalam. |
| F8 | Automation + scheduled reports | **EXPOSED** | admin | Automation worker tersedia, tetapi scheduler/report schedule first-class dan operator execution history/rule management belum lengkap. |
| F9 | WhatsApp / Telegram notification center | **PARTIAL** | admin, employee-portal | Template, queue, Telegram worker, WhatsApp provider adapter, dan UI queue sudah ada. Provider setup/verification, channel binding UX, scheduled report destinations, retry diagnostics, dan production readiness masih harus dituntaskan. |
| F10 | AI / forecasting / operator assistant | **EXPOSED** | admin | Source implementation lengkap: explainable forecast/reorder, permission-scoped deterministic operator assistant, anomaly insights, confidence, source links, dan human-confirmation guardrail tersedia. Runtime/browser/human UAT tetap wajib sebelum closure. |
| F11 | Purchase / Sales / POS integration ke UOM baru | **EXPOSED** | admin, pos, storefront | Sales/POS multi-UOM sudah jauh lebih matang. Purchase request/PO/receipt masih berbasis orderedQty/unitCost tanpa purchase UOM conversion first-class; ini blocker utama F11. |

## API-only / missing useful UI

- The only controller without direct operator UI exposure is `apps/api/src/extensions/edge-sync.controller.ts`; it is device/system-facing and intentionally API-only.
- The canonical digital receipt endpoint is exposed from POS after a completed sale.
- No direct no-op click handlers, inert buttons, inert anchors, or permanent `disabled={true}` controls are present in the audited source.

## Remaining non-cosmetic gaps

- **F9 remains PARTIAL**: WhatsApp/Telegram UI exists, but external provider production readiness and diagnostics remain incomplete.
- **F10 source implementation is complete / runtime pending**: explainable forecast/reorder, permission-scoped deterministic assistant, anomaly insights, source links, confidence, history, and human-confirmation guardrails are present. Runtime/browser/human evidence remains mandatory.

## Verification boundary

Static source evidence does **not** substitute for real Next production builds or Human Visual Acceptance. P5 stays OPEN and P6 stays BLOCKED until those gates pass.
