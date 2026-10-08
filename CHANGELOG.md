## 2026-09-24 — F12R4 full UI architecture rebuild

- Rejected the accumulated F12/F12R presentation as a valid final UI baseline and rebuilt Admin information architecture around one primary sidebar, one contextual subnav, and one content surface.
- Added explicit operator homes for Tenant & Organization, Settings & Access, Integrations & Notifications (Telegram/WhatsApp), AI & Automation, Reporting, and the other implemented business domains; inert decorative controls are forbidden by CI audit.
- Replaced the four application global stylesheets with canonical Tailwind v4 layers instead of appending overrides, while preserving F12R3 deep GitHub API/provider/browser/worker/runtime gates.
- Human Stage-20 and release readiness remain blocked until local type/build, GitHub full-system UAT, screenshot review, and operator visual acceptance pass on the rebuilt source.

## 2026-09-23 — F12R3 full Tailwind UI + deep GitHub UAT reopening

- Reopened F12 after human visual review rejected the prior layered CSS/navigation result; release/human UAT remain blocked.
- Migrated Admin, POS, Storefront, and Employee Portal presentation foundations to Tailwind CSS v4/PostCSS with flat one-accent surfaces, viewport-bound navigation/tables, responsive geometry, and Lucide icon consistency.
- Simplified Admin information architecture so Tenant/User/System, Telegram/WhatsApp/owner reporting, integrations, and AI/forecasting have explicit operator workspaces instead of mixed panels.
- Expanded GitHub automated UAT with full repository/UI interaction audits, all-OpenAPI runtime sweep, three-viewport all-navigation browser geometry + screenshots, Telegram/WhatsApp/owner-digest provider simulation, and optional protected live Telegram provider smoke.
- Full dependency-free regression: 843/843 PASS; workflow/repository/full-repo/UI audits PASS. Tailwind install/typecheck/build/runtime remain required verification gates and are not claimed PASS yet.

## 2026-09-23 — F12R2 modern visual contract

- Reopened visual acceptance after operator review found decorative gradients, glyph icons, and inconsistent iconography.
- Admin/POS now use flat dark surfaces and a single blue accent per `UI-DESIGN-SYSTEM.md`; decorative purple-blue gradients were removed.
- POS product and payment controls use Lucide icons instead of text glyphs.
- Storefront verified-state actions use Lucide `CircleCheck` instead of checkmark characters.
- Employee Portal now declares and uses `lucide-react` consistently for desktop/mobile navigation and logout action.
- Added `tests/f12r2-modern-visual-contract.test.mjs`; business/API contracts are unchanged.

## 2026-09-23 — F9 WhatsApp / Telegram Notification Center source closure
- Promoted existing `IntegrationConnection` into the authoritative tenant/channel notification-provider configuration surface with encrypted secrets and provider health.
- Added connected Telegram/native and provider-neutral external notification delivery before legacy environment fallback, while retaining worker lease/retry/idempotency behavior.
- Added notification history filters, safe cancel/replay lifecycle, and Admin Notification Center provider/template/delivery operations.
- Hardened legacy tenant notification regression to verify actual company + branch-envelope behavior instead of brittle source formatting.
- Verification: focused 18/18 PASS; workflow/repo validation PASS; dependency-free regression 796/796 PASS.


## 2026-09-23 — F7 AR/AP/Cash/Bank/Reconciliation source closure
- Added tenant-scoped AR/AP aging buckets and AP due dates from supplier payment terms.
- Added journal-backed cash/bank position with latest bank-statement comparison.
- Added settlement trace from source document through OperationalFinanceTransaction, AccountingEvent, and JournalEntry.
- Added Admin finance-depth workspace for aging, cash/bank position, and settlement drill-down while preserving canonical settlement/reconciliation flows.
- Verification: focused 29/29 PASS; workflow/repo validation PASS; dependency-free regression 781/781 PASS.

## 2026-09-23 — F6 Financial Reporting + Drill-down source closure
- Added journal-backed Cash Flow, operational Margin, period comparison, role-scoped branch comparison, and cost-center dimension reporting.
- Added account → journal → accounting event → source drill-down endpoint and Admin Reporting workspace.
- Hardened ReportJob filter validation and expanded worker exports with inventory valuation and comparison reports.
- Added F6 regression/evidence; runtime/browser/human UAT remains deferred.
## 2026-09-22 — Final automation closure
- Closed UI-P7 from authoritative full-system green commit `97346eafe34b1cad9eb24f3072f04d7fd2c0150d`.
- Final automation evidence: regression 708 PASS, Built Browser UAT PASS, Stage-18/19/20 automated PASS, aggregate PASS.
- Source fingerprint: `328cc5695ff3ab82fa8aaa5dffbbe5828a5e48c1b1f191e852a0881fd7a6c8ad`.
- Build artifact: `3e5c9d075d12974b4a0e79ae90a639a23ce087549b5aaa4a4616467630b9cbe9`.
- Human Stage-20 UAT remains PENDING 12/12 and candidate verification remains fail-closed.
- No production-readiness claim is made by this closure.


## 2026-09-22 — UI-P1 Admin Application Shell

- Added canonical Admin workspace routes and route-aware navigation.
- Admin navigation now consumes runtime module catalog, feature flags, JWT role/permission visibility, and Admin UiSchemaDefinition overrides.
- Added collapsible/searchable sidebar, breadcrumbs, company/branch context, and related-workspace rail.
- No database or business-logic changes.
# Changelog

## 2026-09-11 — Local API compile recovery

- fixed seven evidence-backed Nest/Prisma/strict-TypeScript compile failures found during real Windows startup;
- aligned `PayrollPayment` settlement fields across canonical, SQLite, and PostgreSQL schemas;
- added compile-regression guards for Prisma JSON contexts, Nest 429/body parser typing, order account maps, payroll schema parity, and offline replay JSON;
- no destructive migration or database reset is required; local Prisma Client regeneration + `db push` is sufficient.

## 2026-09-11 — Local demo seed UUID runtime fix

- fixed the deterministic demo company UUID so it satisfies the seed's own UUID version/variant validator;
- added regression coverage for the hard-coded demo seed UUID;
- real Windows evidence now proves registry access, deterministic `npm ci`, Prisma SQLite generation, and SQLite schema push;
- no schema or migration change.

## 2026-09-11 — Protected runtime + certification tooling hardening

- load-test numeric arguments now fail closed before traffic for NaN/non-finite/out-of-range values;
- staging now shares protected JWT, CORS, and secret-master-key requirements with production;
- protected-environment webhook delivery requires a non-placeholder signing secret before network send;
- PostgreSQL env example leaves runtime secrets/CORS blank instead of shipping passable placeholders;
- stage20 isolated staging runner now injects an ephemeral secret-master key and explicit CORS origin;
- regression expanded to 333/333 PASS; mock runtime proved load runner and six-step staging certification flow.

## 2026-09-11 — Runtime finalization: deterministic install & production-safe seed

- dependency installer fail-fast pada DNS/registry dan memakai `npm ci` dari lockfile;
- PostgreSQL/staging/production seed default ke bootstrap fail-closed tanpa fixture demo;
- password seed tidak dicetak ke log dan admin bootstrap wajib explicit/strong;
- `promotion.view/manage` ditambahkan ke canonical permission seed;
- PostgreSQL CI/release-candidate memakai bootstrap explicit dan smoke test menjadi seed-mode-aware;
- regression guard baru untuk keputusan di atas.


## 0.5.3 — UI/UX Final Cleanup & Runtime Truthfulness (2026-09-11)

- Membersihkan navigasi Admin sehingga hanya work area dengan view nyata yang tampil, termasuk mobile navigation dan penghapusan menu/health control dekoratif.
- Menghapus prompt browser native, credential demo prefill, angka Employee hard-coded, promo/rating storefront palsu, serta customer-facing MOCK_QRIS.
- Memisahkan loading/error/empty state pada modul operator dan mengubah Owner Suite ke local business date + jurnal POSTED language.
- Mengunci quantity Storefront ke stok, server-session revocation saat logout, dan warning degradasi customer directory POS.
- Menambahkan guard UI anti-regression dan dokumentasi `docs/UI-UX-FINAL-CLEANUP.md`.

## 0.5.3 — Runtime / Staging Certification Hardening (2026-09-11)

- Menambahkan server-side JWT session registry (`sid`) dengan logout current/all dan revocation real-time.
- Mengganti login throttle process-local menjadi database-backed rate limit lintas instance.
- Mengenkripsi secret settings, integration secrets, dan webhook headers at-rest dengan AES-256-GCM + master key server.
- Menambahkan migrator legacy plaintext secret, multi-worker outbox/webhook lease recovery, dan stable webhook `Idempotency-Key`.
- Menambahkan fail-closed restore rehearsal untuk TEST/STAGING, staging certification runner, load-test threshold evidence, dan PostgreSQL index profiler evidence-only.

## 0.5.3 — Asset & Fleet Accounting Reconciliation (2026-09-11)

- Mengunci acquisition business date/capitalization dan mewajibkan supplier untuk pembelian aset kredit.
- Mencegah depreciation run overlap/double-post dan menolak metode selain straight-line sampai implementasi resmi tersedia.
- Membuat maintenance completion atomik termasuk inspeksi, odometer, konsumsi inventory/batch part, jurnal biaya vendor, dan jurnal part.
- Menambahkan transfer aset intra-branch yang inspection-gated dan retry-safe tanpa jurnal nilai.
- Menambahkan sale/disposal dengan book-value reconciliation, output tax, gain/loss, serta menolak credit sale tanpa customer AR trace.
- Menguatkan trip/COD/odometer serta fuel receipt/evidence idempotency, supplier trace, business date, dan AP untuk BBM kredit.
- Menggabungkan supplier payable dari Goods Receipt, Asset acquisition, Maintenance Work Order, dan Fuel Transaction.
- Menambahkan summary/list endpoint Asset/Fleet, admin read model nyata, expand migration fuel supplier trace, dan regression guard Asset/Fleet.

## 0.5.3 — Core POS Integrity (2026-09-11)

- Menambahkan lifecycle shift kasir API + POS (current/open/close/recap) dan mewajibkan shift aktif untuk role CASHIER.
- Mengubah total POS menjadi server-authoritative quote; menghapus pajak 11% hard-coded dari frontend.
- Menambahkan idempotency retry stabil pada pembayaran POS dan proteksi PROCESSING dengan TTL.
- Memperbaiki expected cash agar hanya menghitung pembayaran tunai dikurangi refund tunai.
- Mengunci tax-code calculation storefront, POS, dan goods receipt ke company yang terautentikasi.
- Mengunci EventOutbox/sync pull ke company dan envelope branch serta menambahkan cursor paging.
- Mencegah retur penjualan kumulatif melebihi kuantitas terjual dan memperbaiki koreksi poin untuk retur parsial.
- Menambahkan akun seed CASHIER khusus POS dan regression test core transaction.

## 0.5.3 — Value Pack 2 (T360-20260829)

- Menambahkan laporan jam ramai (peak-hours), stok menganggur (dead-stock), dan segmentasi pelanggan RFM.
- Menambahkan eksekusi export CSV asinkron: worker memproses `ReportJob` (SALES/PRODUCTS) secara atomik dan hasil dapat diunduh via `GET /reports/jobs/{id}/download`.
- Menambahkan fondasi engine promo: model `PromoRule`, CRUD `/promotions`, dan preview diskon read-only (belum mengubah transaksi penjualan/pajak).
- Menambahkan `PATCH /products/{id}` dengan pencatatan otomatis `ProductPriceHistory` serta endpoint riwayat harga.
- Menambahkan tombol bagikan WhatsApp + CSS cetak pada struk digital publik.
- Menambahkan endpoint monitoring `GET /platform/ops-health` (outbox, webhook, report job, automation job).
- Menambahkan permission `promotion.view`/`promotion.manage` pada seed.
- Menghapus artefak stage lama yang sudah CLOSED (launcher cmd tahap 10/11/14, skrip inspeksi stage17, catatan v1.2.1).

## 0.5.3 — GROWTH PACK (T360-20260825)

- Notifikasi stok menipis real-time via Telegram (dedupe harian, ambang per `minStock`).
- Struk digital via link publik `/receipts/:saleNumber`, HTML mobile-friendly tanpa data biaya.

## 0.5.3 — Embedded Instructions & Dynamic Chat Handoff

- Added canonical project system instructions with enforced 8,000-character limit.
- Added AGENTS, Copilot, and ChatGPT instruction adapters.
- Added dynamic first-chat generator, clipboard launchers, secret-safe context snapshot, and quality-gate handoff record.
- Added automatic context refresh after setup/workflow/quality launchers.
- No business schema changes.

## 0.5.2 — One-Click Work Automation

- Menambahkan `mulai-pekerjaan-otomatis.cmd` dan memperbarui `buat-work-item.cmd` menjadi menu otomatis.
- Menambahkan backlog machine-readable berdasarkan Development Kit dan roadmap.
- Menambahkan dependency-aware next-task selection.
- Menambahkan pembuatan work item lengkap, branch Git, TASK, checklist, AI prompt, dan session handoff.
- Menambahkan resume/status launcher dan optional external-agent hook yang nonaktif secara default.
- Menambahkan validasi backlog, dokumentasi, checkpoint, dan quality governance untuk automation.

## 0.5.1 — Development Workflow Governance

- Menambahkan workflow pengembangan resmi berbasis Development Kit.
- Menambahkan delivery waves W0–W7 dan dependency/exit criteria setiap kelompok modul.
- Menambahkan work item manifest, CLI create/validate/status/advance/complete, serta machine-enforced impact checks.
- Menambahkan quality gates fast/full/release.
- Menambahkan issue forms untuk feature, bug, migration, integration, dan release.
- Menambahkan PR policy untuk branch, Conventional Commit title, work item, rollback, dan checklist.
- Menambahkan GitHub workflow governance dan release-candidate artifact dengan checksum.
- Menambahkan ADR, roadmap implementasi, checkpoint, contributing guide, dan Definition of Done.

# Changelog

## 0.5.0 - Enterprise accounting, tax, assets, fleet, and controls

- Applied one accounting/tax event engine across sales, orders, purchasing, receipts, returns, inventory, general finance, payroll, assets, fleet, and delivery.
- Added generic operational finance transactions, dynamic tax codes, versioned posting rules, and tax ledgers.
- Added movable/immovable asset lifecycle, depreciation, maintenance, and assignments.
- Added delivery vehicle, driver, trip, manifest, loading, gate pass, fuel, odometer, proof-of-delivery, and COD foundations.
- Added inbound/outbound inspections, evidence, confirmations, operation policies, and automation jobs.
- Changed goods receipts to inspection/confirmation before atomic stock and accounting posting.
- Added sale/purchase return accounting and tax reversals.
- Added accounting for stock transfers and stock-opname adjustments.
- Added enterprise documentation and repository tests.

## 0.3.2 - Windows process launcher fix

- Memperbaiki `spawn EINVAL` pada Windows saat Node.js menjalankan `npm.cmd`.
- Semua pemanggilan npm dari script Node sekarang melalui `cmd.exe /d /s /c` pada Windows.
- Memperbaiki setup, diagnosis instalasi, dan reset database lokal.
- Menambahkan pesan error eksplisit ketika command processor Windows tidak dapat dijalankan.


## 0.3.0 — No-Docker Local Development

- SQLite menjadi profil database lokal bawaan.
- PostgreSQL tetap tersedia untuk staging, production, dan GitHub integration test.
- Menambahkan schema Prisma SQLite dan PostgreSQL yang divalidasi agar selalu selaras.
- Menghapus kebutuhan Docker dari setup lokal dan memindahkan file container ke `.github/ci`.
- Menambahkan setup satu klik Windows, reset database, profile selector, dan local smoke test.
- GitHub Actions menguji repository, SQLite tanpa Docker, dan PostgreSQL service container.
- Worker lokal memakai database polling dan tidak membutuhkan Redis.
- Menambahkan panduan local no-Docker, database profiles, dan CI testing.

## 0.2.0 — Modular Foundation

- Development Kit lengkap bagian 1–36.
- Feature flags, dynamic settings, custom fields, server-driven UI, business rules, approval, API keys, webhooks, outbox, plugin SDK.
- Transfer gudang, opname, batch, serial, retur, loyalty, fiscal period, reconciliation, offline devices, forecasting, shipping, marketplace staging, notification queue.
- Worker, contracts, config package, Flutter customer starter, dan extended admin runtime configuration.

## 0.3.2

- Improved no-Docker Windows installer reliability and diagnostics.

## 0.3.3 - 2026-07-28

### Added
- Large-scale data architecture and million-record development kit.
- Cursor pagination helpers and core list endpoint pagination.
- Transaction/ledger indexes and aggregate/report/retention models.
- Dependency-free load test and manual GitHub performance workflow.
- PostgreSQL partitioning template and performance checklist.

### Changed
- Report profit/loss now aggregates in the database.
- Inventory valuation now uses cursor pagination.
- Frontends consume paginated product, supplier, inventory, PO, and receipt responses.

## 0.4.0

- Added HRIS, attendance, geofence, fingerprint/face device foundation, photo evidence, leave/overtime, payroll, tax/social rule engine, accounting posting, payslip delivery, and employee self-service portal.
- Added Telegram worker and configurable WhatsApp provider dispatch.
- Added biometric/privacy security documentation and vendor adapter templates.

### 2026-09-11 — Operations / Approval / Automation production-readiness hardening
- Approval requests gain explicit branch scope and sequential multi-step decisions with role/permission checks, self-approval prevention, and serializable concurrency guard.
- Webhook delivery gains HTTPS/private-network SSRF protection and response header redaction.
- Secret system settings are redacted from list APIs.
- Notification worker gains an atomic scheduling lease to reduce duplicate sends across workers.
- Fixed duplicate `dateOnly` declaration in worker report parsing.

### 2026-09-11 — Runtime DR / webhook integrity hardening
- Restore rehearsal canonicalizes active SQLite and PostgreSQL identities so equivalent URL/path forms cannot bypass the isolated-target guard.
- SQLite backup fails closed on non-empty WAL/rollback journal and source mutation during copy after a proof showed committed WAL data could be omitted from a checksum-valid main-file copy.
- Webhook endpoint custom headers cannot collide case-insensitively with reserved Toko360 integrity headers.
- Dependency-free regression: 337/337 PASS.

### 2026-09-11 — Recovery tooling compatibility hardening
- Replaced the legacy API backup drill implementation with a cwd-independent wrapper over canonical hardened backup/verify/restore tooling; removed raw SQLite copy fallback.
- SQLite restore rehearsal now refuses any pre-existing main/WAL/SHM/journal target state before mutation.
- PostgreSQL restore isolation now collapses common loopback aliases and trailing-dot localhost before active-target comparison.
- Retention cleanup now resolves repository config from the script path and validates retention-day bounds before purge queries.
- Dependency-free regression: 342/342 PASS.

## 2026-09-22 — UI-P2 Admin Domain Workspaces
- Closed UI-P1 after authoritative GitHub Full System Simulation PASS on `f8f79fda8aa10f98c0df332cb56951a89a98ebf0`.
- Added stable nested Admin operator routes for procurement, finance, people, assets/fleet, platform, inventory control, operations control, commerce, extensions, and master data.
- Added sticky secondary domain navigation, overview deck, contextual sub-workspace header, and third-level breadcrumbs.
- Invalid nested routes fail-safe to their canonical domain root; backend authorization and business APIs remain unchanged.

## 2026-09-22 — UI-P3 POS modernization
- Memecah POS menjadi workspace Penjualan, Shift & Kas, Retur, dan Sinkronisasi melalui reusable `PosShell`.
- Mempertahankan quote/payment/stock/idempotency/offline replay/auth guard lama tanpa perubahan business contract.
- UI-P2 ditutup berdasarkan baseline GitHub hijau `b1c561d97813f5e0916d194e0146cbec147a741e`.
- Human Stage-20 UAT tetap PENDING 12/12 dan tidak dapat dipenuhi automated simulation.

## UI-P4 Storefront productization
- Memecah storefront single-surface menjadi reusable shell + home/catalog/product/cart/account customer journeys.
- Menambahkan deep-link storefront route, catalog sort/search, product detail, dan responsive desktop/mobile navigation tanpa mengubah commerce API.

## 2026-09-22 — UI-P5 Employee Portal productization
- Memecah Employee Portal single-surface menjadi reusable shell dan self-service workspace home, attendance, leave, overtime, payslips, history, dan profile.
- Mempertahankan kontrak browser/login existing serta seluruh backend authorization/evidence/approval behavior.
- Human Stage-20 UAT tetap manual dan tidak diubah.

## UI-P6 server-driven Admin UI
- Added runtime-resolved nested Admin domain views.
- Admin UiSchema can hide/relabel/reorder canonical nested views only.
- Module/feature and role/permission visibility remains fail-closed at UI level; backend authority unchanged.

## UI-P7
- Hardened Admin, POS, Storefront, dan Employee Portal untuk keyboard focus, skip-link, reduced-motion, coarse-pointer touch target, serta semantic navigation/status.
- Closed UI-P6 dari full-system green evidence `4cac591f0ba27f571e987e07b7343d85dba40241`.

## 2026-09-23 — F2 category/subcategory hierarchy
- Added tenant-scoped category parent/child hierarchy, ordering and active lifecycle with SQLite/PostgreSQL schema parity.
- Added server-side parent ownership, anti-cycle, sibling-name, and safe deactivation validation.
- Product Admin can now create, edit, reorder, parent, activate and deactivate categories/subcategories; product selection only uses active categories.


## 2026-09-23 — F3 inventory source completion
- Completed batch/expiry/serial/condition/location inventory source flows and operator visibility.
- Hardened stock transfer with batch and serial manifests, explicit serial IN_TRANSIT lifecycle, destination batch restoration, and derived in-transit reporting.
- Added batch-aware whole-warehouse stock opname and reorder visibility using inbound transfer projection.
- Full dependency-free regression: 757/757 PASS; runtime/browser/human UAT remains deferred.


## 2026-09-23 — F4 Accounting enterprise source completion
- Added branch-scoped Chart of Accounts create/update/lifecycle controls with history and active-posting-rule safety.
- Added immutable/versioned posting-rule management, effective-date overlap validation, literal account mapping validation, and ACTIVE/INACTIVE lifecycle.
- Added tenant-scoped accounting event drill-down from business source through posting rule to journal/account lines.
- Preserved legacy accounting audit action contract while adding explicit version-operation payload.
- Full dependency-free regression: 762/762 PASS; runtime/browser/human UAT remains deferred.

## 2026-09-23 — F5 Dynamic Tax source completion
- Added versioned/effective-dated TaxCode configuration without rewriting historical TaxTransaction identity.
- Added immutable-after-active/used lifecycle, effective overlap guard, branch COA mapping validation, tax ledger/document/reconciliation APIs, and full Admin tax operator workspace.
- Added expand-only SQLite/PostgreSQL tax-version migration.
- Verification: workflow/repo gates PASS; dependency-free regression 771/771 PASS. Runtime/browser/human UAT deferred.
## 2026-09-23 — F8 Automation + Scheduled Reports
- Completed source-level automation rule lifecycle and operator execution history/cancel/replay.
- Added first-class scheduled reports with company-timezone recurrence and atomic worker materialization into canonical ReportJob.
- Added report enqueue rule action, Admin automation workspace, expand-only SQLite/PostgreSQL migration, and F8 regression coverage.
- Verification: workflow/repo validation PASS; focused F8 21/21 PASS; dependency-free regression 791/791 PASS. Runtime/browser/human UAT remains deferred.



## 2026-09-23 — F10 AI / Forecasting / Operator Assistant
- Hardened canonical moving-average forecast with available-stock semantics plus explainable formula, inputs, confidence, and source evidence.
- Added tenant-scoped OperatorInsight lifecycle for stock, finance, automation, and reporting anomalies/recommendations.
- Added permission-scoped, source-grounded, read-only Operator Assistant with auditable interaction history and human-confirmation action guards.
- Added Admin AI & Forecast workspace plus expand-only SQLite/PostgreSQL migration for insight/interaction history.
- Verification: focused F10/tenant tests 20/20 PASS; workflow/repo validation PASS; dependency-free regression 805/805 PASS. Runtime/browser/human UAT remains deferred.

## F11 Purchase / Sales / POS UOM integration source closure — 2026-09-23
- F11 source implementation is COMPLETE; runtime/browser/human UAT remains deferred by operator instruction.
- ProductUnit is now the transaction authority for direct Purchase and POS/Sales UOM selection; barcode remains only a shortcut to the same unit snapshot.
- PurchaseOrderItem and GoodsReceiptItem preserve selected UOM/variant/factor/cost snapshots while ordered/received inventory quantities remain canonical integer base units.
- SaleItem preserves variant/ProductUnit identity in addition to unit/factor/barcode snapshots; pricing remains server-authoritative and variant/UOM aware.
- Admin procurement exposes purchase UOM selection and receiving in PO UOM; POS exposes direct active ProductUnit actions and keeps non-base UOM online-only.
- Expand-only SQLite/PostgreSQL migration is included but intentionally not auto-applied.
- Static gates: focused F11 + legacy unit/procurement regression 30/30 PASS, workflow validation PASS, repository validation PASS (180 Prisma models), dependency-free regression 809/809 PASS.
- Next locked phase: F12 Final UI/UX polish.

## 2026-09-23 — F12 final UI/UX polish
- Completed presentation-only final polish across Admin, POS, Storefront, and Employee Portal.
- Added consistent table/form/modal/feedback density, responsive terminal/customer/self-service layouts, and mobile ergonomics without changing business authority.
- Added F12 static regression guard and completion evidence.

## 2026-09-23 — Local candidate gate before GitHub full-system simulation
- Added `npm run uat:pre-github:local` and `RUN-LOCAL-CANDIDATE-GATE.cmd` as a fail-closed local gate after F12/UAT migration hardening.
- The gate runs SQLite expand-migration rehearsal, the canonical full local quality/build/DB-smoke gate, and 12-scenario critical-UAT coverage evidence before GitHub heavy simulation.
- Local candidate validation refuses production/live and PostgreSQL targets; PostgreSQL exact-artifact/browser/Stage-18/19/20 validation remains authoritative in GitHub Full System Simulation.
- Human Stage-20 UAT remains explicitly PENDING and is never auto-approved by the local gate.

## 2026-09-23 — Local candidate TypeScript closure
- Fixed Admin tax ledger rendering type narrowing after F5 versioned tax workspace.
- Updated seed compound unique selectors for tenant category hierarchy and versioned TaxCode schema.
- Made accounting tenant-denial guards narrow nullable Prisma rows through Promise<never> instead of leaving false-positive nullable access.
- Allowed aggregate extension audit events without a concrete entity id, matching nullable AuditLog.entityId.
- Preserved typed outstandingAmount in supplier aging rows, explicitly typed Purchase UOM prepared items, and included variant/ProductUnit identity in Sales prepared item snapshots.
- Added local-candidate TypeScript regression guards; dependency-free regression 829/829 PASS in source snapshot. Full workspace lint/build must be re-run on the local dependency-complete repository.

## 2026-09-23 — GitHub PostgreSQL migration rehearsal scratch-client fix
- Fixed full-system migration rehearsal failure after all 11 expand migrations had applied successfully.
- Migration rehearsal now generates an isolated Prisma verification client inside its temporary scratch directory instead of depending on or mutating the repository-level `@prisma/client` generation state.
- Preserves exact-build-artifact guarantees: the candidate build's global Prisma Client is not regenerated by migration rehearsal.
- Strengthened migration rehearsal regression coverage to reject a return to global `@prisma/client` verification coupling.

## 2026-09-23 — GitHub UAT bootstrap/config root fix
- Manual full UAT now uses bootstrap-safe credentials instead of demo credentials rejected by seed hardening.
- GitHub UAT env preparation preserves workflow-provided credentials instead of overwriting them.
- Stage-18 restore URL now derives host/user/password/port from the active PostgreSQL target and only changes the scratch database name.
- Added regression coverage for bootstrap credential and restore identity invariants.

## 2026-09-23 — GitHub UAT seed identity/profile root fix
- Fixed GitHub UAT bootstrap fixture IDs to standards-valid deterministic UUIDs accepted by hardened seed validation.
- Isolated build-gate SQLite compatibility preparation with `SEED_MODE=demo` so PostgreSQL bootstrap identity does not leak into SQLite DB preparation.
- Kept PostgreSQL seed hardening, DB smoke, exact-artifact, browser UAT, and Stage-18/19/20 gates fail-closed.

- GitHub build-gate root fix: SQLite compatibility DB prepare now forces `NODE_ENV=test` together with `DATABASE_PROFILE=sqlite` and `SEED_MODE=demo`, preventing staging seed policy from misclassifying the isolated SQLite rehearsal while preserving production semantics for the final six-app build.

## 2026-09-23 — F12R operational UI correction
- Reopened F12 visual closure after human visual acceptance found oversized checkbox controls, redundant horizontal navigation, forced-width tables, excessive whitespace, and poor high-mobility ergonomics.
- Admin removes the redundant workspace rail, constrains checkboxes to native compact controls, fits desktop tables to the viewport, and stacks table rows on narrow screens instead of forcing horizontal scrolling.
- POS navigation and transaction surfaces now remain inside the viewport with denser product/cart layout; Employee Portal and Storefront receive the same no-horizontal-page-overflow/mobile-density correction.
- No business/API/security logic changed. Targeted UI regression 7/7 PASS; workflow/repo validation PASS; dependency-free regression 841/841 PASS. Frontend lint/build still requires dependency-complete local repo because this sandbox has no `next` binary.

## 2026-09-24 — R0 recovery truth reset
- Reopened product completeness from a 48-finding deep functional/UI/workflow audit and mapped all findings to recovery waves R0–R8.
- Added fail-closed `npm run audit:recovery` so the recovery baseline must be regenerated whenever Prisma/API/UI-control source shape changes.
- Blocked F12R4 final verification behind R1–R6 functional prerequisites while preserving its current working-tree UI changes.
- Human Stage-20 remains BLOCKED/PENDING; historical automated green evidence is not valid release evidence for recovered source.
